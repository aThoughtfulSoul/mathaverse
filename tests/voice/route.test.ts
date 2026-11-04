// POST /api/transcribe validation, errors, cancellation and capabilities with an injected FAKE provider
// and decoder. Browser-format conversion is covered separately in audioFormats.e2e.test.ts.

import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { capabilitiesFor, cleanTranscript, createTranscribeRoute, hallucinationOf } from '../../server/speech/index'
import { newSpeechStatus, readSpeechConfig, type Probe } from '../../server/speech/config'
import { SpeechError } from '../../server/speech/provider'
import { ABORT_REASON, type ApiResult } from '../../server/types'
import { TRANSCRIBE_LIMITS, type TranscribeResponse } from '../../src/voice/protocol'
import { ALL_PRESENT, TEST_META_ENV, OGG_BYTES, apiRequest, fakeConverter, fakeProvider, toneWav, transcribeBody } from './helpers'

const err = (r: ApiResult) => r.json as { code: string; message: string; retryable: boolean }

function route(opts: { text?: string; error?: Error; hang?: boolean; wav?: Buffer; env?: Record<string, string>; deadline?: number } = {}) {
  const p = fakeProvider(opts.text !== undefined || opts.error || opts.hang ? { text: opts.text, error: opts.error, hang: opts.hang } : undefined)
  const c = fakeConverter(opts.wav)
  const status = newSpeechStatus()
  const handler = createTranscribeRoute({ env: opts.env ?? TEST_META_ENV, probe: ALL_PRESENT, provider: p.provider, convert: c.convert, status, providerDeadlineMs: opts.deadline })
  return { handler, calls: p.calls, dirs: c.dirs, status }
}

describe('success', () => {
  it('returns a transcript with provenance and timing, and no scene actions', async () => {
    const { handler, calls, dirs } = route()
    const body = transcribeBody()
    const r = await handler(apiRequest(body))
    expect(r.status).toBe(200)
    const j = r.json as TranscribeResponse
    expect(Object.keys(j).sort()).toEqual(['model', 'provider', 'requestId', 'source', 'timing', 'transcript'])
    expect(j).toMatchObject({ requestId: body.requestId, transcript: 'reverse the order on the left', source: 'meta', provider: 'fake-test-provider', model: 'fake' })
    expect(j.timing.audioMs).toBe(1200)
    expect(j.timing.totalMs).toBeGreaterThanOrEqual(j.timing.providerMs)
    expect(calls[0]!.hints).toEqual(['rotate', 'reflect'])
    expect(dirs).toHaveLength(1)
    expect(existsSync(dirs[0]!)).toBe(false) // the temp directory is always removed
  })

  it('accepts browser MIME spellings with spaces and case', async () => {
    const { handler } = route()
    const r = await handler(apiRequest(transcribeBody({ mimeType: 'audio/ogg; codecs=OPUS' as never }, OGG_BYTES)))
    expect(r.status).toBe(200)
  })

  it('whitespace is collapsed; a lone non-speech marker is no speech', () => {
    expect(cleanTranscript('  Reverse   the order\n on the left. ')).toBe('Reverse the order on the left.')
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('')
    expect(cleanTranscript('(silence)')).toBe('')
  })
})

describe('validation', () => {
  const cases: [string, unknown, number, string][] = [
    ['unknown field', { ...transcribeBody(), actions: [] }, 400, 'invalid_request'],
    ['missing requestId', { ...transcribeBody(), requestId: undefined }, 400, 'invalid_request'],
    ['bad requestId', transcribeBody({ requestId: 'a b' }), 400, 'invalid_request'],
    ['unsupported MIME', transcribeBody({ mimeType: 'audio/flac' as never }), 415, 'unsupported_format'],
    ['declared too long', transcribeBody({ durationMs: 30_001 }), 413, 'audio_too_long'],
    ['negative duration', transcribeBody({ durationMs: -1 }), 400, 'invalid_request'],
    ['base64 above the bound', transcribeBody({ audioBase64: 'A'.repeat(TRANSCRIBE_LIMITS.maxAudioBase64 + 4) }), 413, 'audio_too_long'],
    ['invalid base64', transcribeBody({ audioBase64: 'not base64!' }), 400, 'invalid_request'],
    ['empty audio', transcribeBody({ audioBase64: '' }), 400, 'invalid_request'],
    ['too many hints', transcribeBody({ hints: Array.from({ length: 41 }, (_, i) => `h${i}`) }), 400, 'invalid_request'],
    ['long hint', transcribeBody({ hints: ['x'.repeat(49)] }), 400, 'invalid_request'],
    ['control character in a hint', transcribeBody({ hints: ['a\u0007'] }), 400, 'invalid_request'],
    ['hints not an array', { ...transcribeBody(), hints: 'rotate' }, 400, 'invalid_request'],
    ['not an object', [], 400, 'invalid_request'],
    ['declared webm, bytes are ogg', transcribeBody({}, OGG_BYTES), 415, 'unsupported_format'],
    ['declared webm, bytes are nothing known', transcribeBody({}, Buffer.from('hello world, not audio')), 415, 'unsupported_format'],
  ]
  for (const [name, body, status, code] of cases) {
    it(`${name} -> ${status} ${code}; the provider is never called`, async () => {
      const { handler, calls } = route()
      const r = await handler(apiRequest(body))
      expect(r.status, JSON.stringify(r.json)).toBe(status)
      expect(err(r).code).toBe(code)
      expect(calls).toHaveLength(0)
    })
  }

  it('the decoded audio is measured: longer than 30 s is refused whatever the client declared', async () => {
    const { handler, calls } = route({ wav: toneWav(31_000) })
    const r = await handler(apiRequest(transcribeBody({ durationMs: 2000 })))
    expect(r.status).toBe(413)
    expect(err(r).code).toBe('audio_too_long')
    expect(calls).toHaveLength(0)
  })

  it('a silent recording is no speech, without running the model', async () => {
    const { handler, calls } = route({ wav: toneWav(1500, 0) })
    const r = await handler(apiRequest(transcribeBody()))
    expect(r.status).toBe(422)
    expect(err(r)).toMatchObject({ code: 'no_speech', retryable: true })
    expect(err(r).message).toMatch(/silent/)
    expect(calls).toHaveLength(0)
  })

  it('a decoder failure is unsupported_format', async () => {
    const handler = createTranscribeRoute({ env: TEST_META_ENV, probe: ALL_PRESENT, provider: fakeProvider().provider, convert: async () => { throw new SpeechError('unsupported_format', 'The recording could not be decoded as webm audio.', false) }, status: newSpeechStatus() })
    const r = await handler(apiRequest(transcribeBody()))
    expect(r.status).toBe(415)
    expect(err(r).code).toBe('unsupported_format')
  })

  it('GET is not allowed', async () => {
    const { handler } = route()
    expect((await handler(apiRequest(undefined, undefined, 'GET'))).status).toBe(405)
  })
})

describe('provider outcomes', () => {
  it('an empty transcript is no speech (422)', async () => {
    const { handler } = route({ text: '   ' })
    const r = await handler(apiRequest(transcribeBody()))
    expect(r.status).toBe(422)
    expect(err(r).code).toBe('no_speech')
  })

  // The hints and transcript of the silent attempt in the 2026-10-29 device session (round B, step 5).
  const DEVICE_HINTS = ['P', 'R', 'S', 'b', 'v', 'rotate', 'reflect']
  const DEVICE_LOOP = 'P, R, S, b, ' + Array(110).fill('v').join(', ')

  it('a decoding loop or the hints read back is no speech, and not live validation', async () => {
    const { handler, status } = route({ text: DEVICE_LOOP })
    const r = await handler(apiRequest(transcribeBody({ hints: DEVICE_HINTS })))
    expect(r.status).toBe(422)
    expect(err(r)).toMatchObject({ code: 'no_speech', retryable: true })
    expect(status.liveValidatedFor).toBeNull()
    const echo = await route({ text: 'P, R, S, b, v.' }).handler(apiRequest(transcribeBody({ hints: DEVICE_HINTS })))
    expect(err(echo).code).toBe('no_speech')
  })

  it('loops and hint echoes are detected; real requests pass', () => {
    expect(hallucinationOf(DEVICE_LOOP, DEVICE_HINTS)).toBe('loop')
    expect(hallucinationOf('the order the order the order the order the order the order', [])).toBe('loop')
    expect(hallucinationOf('P, R, S, b, v.', DEVICE_HINTS)).toBe('hint_echo')
    expect(hallucinationOf('Rotate. Reflect, linear map.', ['rotate', 'reflect', 'linear map'])).toBe('hint_echo')
    for (const t of ['Reverse the order on the left.', 'Replay the comparison.', 'Hello.', 'P then R.', 'Rotate, then reflect.', 'Is S R e1 equal to R S e1?']) {
      expect(hallucinationOf(t, DEVICE_HINTS)).toBeNull()
    }
    expect(hallucinationOf('Rotate, reflect.', ['rotate', 'reflect'])).toBeNull()
  })

  it('a provider error passes through with its status', async () => {
    const { handler } = route({ error: new SpeechError('provider_error', 'Meta speech-to-text could not process the recording; try again.', true) })
    const r = await handler(apiRequest(transcribeBody()))
    expect(r.status).toBe(502)
    expect(err(r)).toEqual({ code: 'provider_error', message: 'Meta speech-to-text could not process the recording; try again.', retryable: true })
  })

  it('busy is 503 and retryable', async () => {
    const { handler } = route({ error: new SpeechError('busy', 'The transcription service is busy; try again in a moment.', true) })
    const r = await handler(apiRequest(transcribeBody()))
    expect(r.status).toBe(503)
    expect(err(r)).toMatchObject({ code: 'busy', retryable: true })
  })

  it('the provider deadline is a 504 timeout', async () => {
    const { handler, calls } = route({ hang: true, deadline: 30 })
    const r = await handler(apiRequest(transcribeBody()))
    expect(r.status).toBe(504)
    expect(err(r)).toMatchObject({ code: 'timeout', retryable: true })
    expect(calls[0]!.signal.aborted).toBe(true)
  })

  it('a client disconnect aborts the provider and answers canceled; temp files are removed', async () => {
    const { handler, calls, dirs } = route({ hang: true })
    const ac = new AbortController()
    const pending = handler(apiRequest(transcribeBody(), ac.signal))
    await new Promise((r) => setTimeout(r, 20))
    ac.abort(new Error(ABORT_REASON.disconnect))
    const r = await pending
    expect(r.status).toBe(499)
    expect(err(r).code).toBe('canceled')
    expect(calls[0]!.signal.aborted).toBe(true)
    expect(existsSync(dirs[0]!)).toBe(false)
  })

  it('the application timeout answers timeout, not canceled', async () => {
    const { handler } = route({ hang: true })
    const ac = new AbortController()
    const pending = handler(apiRequest(transcribeBody(), ac.signal))
    await new Promise((r) => setTimeout(r, 20))
    ac.abort(new Error(ABORT_REASON.timeout))
    const r = await pending
    expect(r.status).toBe(504)
    expect(err(r).code).toBe('timeout')
  })

  it('an already-aborted request does no work', async () => {
    const { handler, calls, dirs } = route()
    const ac = new AbortController()
    ac.abort(new Error(ABORT_REASON.disconnect))
    const r = await handler(apiRequest(transcribeBody(), ac.signal))
    expect(r.status).toBe(499)
    expect(calls).toHaveLength(0)
    expect(dirs).toHaveLength(0)
  })
})

describe('configuration and capabilities', () => {
  const none: Probe = { isExecutable: () => false }

  it('off, unknown providers, missing credentials and missing ffmpeg are unavailable before any provider call', async () => {
    for (const [env, probe, text] of [
      [{ SPEECH_PROVIDER: 'off' }, ALL_PRESENT, 'SPEECH_PROVIDER=off'],
      [{ SPEECH_PROVIDER: 'unsupported' }, ALL_PRESENT, 'must be auto, meta or off'],
      [{ PATH: '/nowhere' }, none, 'no META_API_KEY'],
      [{ SPEECH_PROVIDER: 'meta' }, ALL_PRESENT, 'no META_API_KEY'],
      [TEST_META_ENV, none, 'ffmpeg was not found'],
    ] as const) {
      const provider = fakeProvider()
      const handler = createTranscribeRoute({ env, probe, provider: provider.provider, convert: fakeConverter().convert, status: newSpeechStatus() })
      const r = await handler(apiRequest(transcribeBody()))
      expect(r.status).toBe(503)
      expect(err(r).code).toBe('speech_unavailable')
      expect(err(r).message).toContain(text)
      expect(provider.calls).toHaveLength(0)
    }
  })

  it('default and auto require a Meta key even when all executables are present', () => {
    for (const requested of [undefined, 'auto', 'meta']) {
      expect(readSpeechConfig({ SPEECH_PROVIDER: requested }, ALL_PRESENT).mode).toBe('unavailable')
      expect(readSpeechConfig({ ...TEST_META_ENV, SPEECH_PROVIDER: requested }, ALL_PRESENT).mode).toBe('meta')
      expect(readSpeechConfig({ SPEECH_PROVIDER: requested, MODEL_API_KEY: 'synthetic-test-key' }, ALL_PRESENT).mode).toBe('meta')
    }
  })

  it('discovers ffmpeg on PATH or through an absolute override; no executable means voice is unavailable', () => {
    const probe: Probe = { isExecutable: p => p === '/opt/bin/ffmpeg' }
    const env = { PATH: '/opt/bin:/usr/bin', META_API_KEY: 'synthetic-test-key' }
    expect(readSpeechConfig(env, probe)).toMatchObject({ mode: 'meta', ffmpeg: '/opt/bin/ffmpeg' })
    expect(readSpeechConfig({ ...env, FFMPEG_BIN: '/missing/ffmpeg' }, probe).mode).toBe('unavailable')
    expect(readSpeechConfig({ ...env, FFMPEG_BIN: 'relative/ffmpeg' }, probe).mode).toBe('unavailable')
  })

  it('reports configured / liveValidated / mode / provider / model / MIME types / problem truthfully', async () => {
    const status = newSpeechStatus()
    const before = capabilitiesFor(TEST_META_ENV, status, ALL_PRESENT)
    expect(before).toEqual({ configured: true, liveValidated: false, mode: 'meta', provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0', acceptedMimeTypes: ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'], problem: null })
    const handler = createTranscribeRoute({ env: TEST_META_ENV, probe: ALL_PRESENT, provider: fakeProvider().provider, convert: fakeConverter().convert, status })
    await handler(apiRequest(transcribeBody()))
    expect(capabilitiesFor(TEST_META_ENV, status, ALL_PRESENT).liveValidated).toBe(true)
    // This test injects its own status; a changed configuration cannot reuse even that test receipt.
    expect(capabilitiesFor({ ...TEST_META_ENV, META_TRANSCRIBE_MODEL: 'another-test-model' }, status, ALL_PRESENT).liveValidated).toBe(false)
    expect(capabilitiesFor({ SPEECH_PROVIDER: 'off' }, status, ALL_PRESENT)).toEqual({ configured: false, liveValidated: false, mode: 'unavailable', provider: null, model: null, acceptedMimeTypes: [], problem: 'speech is turned off on this server (SPEECH_PROVIDER=off)' })
  })

  it('a failed transcription does not mark the configuration live-validated', async () => {
    const status = newSpeechStatus()
    const handler = createTranscribeRoute({ env: TEST_META_ENV, probe: ALL_PRESENT, provider: fakeProvider({ error: new SpeechError('provider_error', 'x', true) }).provider, convert: fakeConverter().convert, status })
    await handler(apiRequest(transcribeBody()))
    expect(status.liveValidatedFor).toBeNull()
  })
})
