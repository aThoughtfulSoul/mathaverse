// ONE real Meta speech-to-text call, only with SPEECH_LIVE=1 and META_API_KEY (the speech mode of
// scripts/muse-live.sh, which synthesizes SPEECH_LIVE_WAV with macOS `say` and ffmpeg). The recording goes
// through the application's own /api/transcribe route code with the real configuration (process env, real
// fetch, process status), exactly as the browser's upload would, so the check covers conversion, the Meta
// adapter and the capability report. It is a test-uploaded recording (synthesized speech), NOT a browser
// microphone. The record (safe fields only) goes to SPEECH_LIVE_DIR/stt.json; the key is never printed or recorded.
//
// In the normal test run nothing here calls a provider: the live block is skipped and only the record shape is
// checked with a hand-made route result that is never written anywhere.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseWav } from '../../server/speech/audio'
import { readSpeechConfig } from '../../server/speech/config'
import { speechCapabilities, transcribeRoute } from '../../server/speech/index'
import { ABORT_REASON, type SpeechCapability } from '../../server/types'
import { VOICE_VOCABULARY, boundHints } from '../../src/voice/protocol'
import { STT_LIVE, TEST_UPLOAD_NOTE, sttLine, sttRecord } from './sttLiveKit'

/** The application's own timeout for a route (vite.config.ts mounts /api with 45 s). */
const APP_TIMEOUT_MS = 45_000

describe.skipIf(!STT_LIVE)('Meta speech-to-text access (one real call; test-uploaded synthesized speech)', () => {
  it('transcribes the recording through /api/transcribe with SPEECH_PROVIDER=meta', async () => {
    const config = readSpeechConfig()
    // Never let a misconfigured run reach another provider and be recorded as a Meta check.
    expect(config.requested, 'SPEECH_PROVIDER=meta is required for this check').toBe('meta')
    expect(config.mode, `speech is unavailable: ${config.problem}`).toBe('meta')
    const wavPath = process.env.SPEECH_LIVE_WAV
    expect(wavPath, 'SPEECH_LIVE_WAV must name the synthesized WAV').toBeTruthy()
    const wav = readFileSync(wavPath!)
    const info = parseWav(wav)
    expect(info, 'SPEECH_LIVE_WAV is not a 16-bit PCM WAV').not.toBeNull()
    const spokenText = process.env.SPEECH_LIVE_TEXT ?? ''

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(new Error(ABORT_REASON.timeout)), APP_TIMEOUT_MS)
    const body = { requestId: `stt-live-${Date.now()}`, mimeType: 'audio/wav', audioBase64: wav.toString('base64'), durationMs: Math.min(Math.round(info!.durationMs), 30_000), hints: boundHints([...VOICE_VOCABULARY]) }
    const t0 = performance.now()
    const result = await transcribeRoute({ method: 'POST', path: '/api/transcribe', body, signal: ac.signal }).finally(() => clearTimeout(timer))
    const wallMs = performance.now() - t0
    const capabilityAfter: SpeechCapability = await speechCapabilities()

    const rec = sttRecord({ spokenText, bytes: wav.length, audioMs: info!.durationMs, config, result, wallMs, capabilityAfter, live: true })
    console.info(sttLine(rec))
    const dir = process.env.SPEECH_LIVE_DIR
    if (dir) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'stt.json'), `${JSON.stringify(rec, null, 2)}\n`)
    }

    expect(result.status, rec.error ? `${rec.error.code}: ${rec.error.message}` : '').toBe(200)
    expect(rec).toMatchObject({ outcome: 'transcript', source: 'meta', provider: 'meta-muse-voice-transcribe', model: config.meta.model })
    expect(rec.transcript?.trim()).toBeTruthy()
    expect(capabilityAfter).toMatchObject({ mode: 'meta', liveValidated: true })
  }, APP_TIMEOUT_MS + 15_000)
})

describe('speech live check (no provider call)', () => {
  it(STT_LIVE ? 'is enabled: one real Meta speech-to-text call' : 'is skipped; zsh scripts/muse-live.sh speech makes the one real call', () => {
    expect(typeof STT_LIVE).toBe('boolean')
  })

  const config = readSpeechConfig({ SPEECH_PROVIDER: 'meta', META_API_KEY: 'LLM_synthetic_record_shape_only', FFMPEG_BIN: '/fake/bin/ffmpeg' }, { isExecutable: () => true })
  const cap: SpeechCapability = { configured: true, liveValidated: false, mode: 'meta', provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0', acceptedMimeTypes: [], problem: null }

  it('records a test-uploaded synthesized recording, labelled apart from a browser microphone, with no key', () => {
    // A HAND-MADE route result (shape only): never written to docs/evidence, never presented as a Meta answer.
    const result = { status: 200, json: { requestId: 'r', transcript: 'shape check', source: 'meta', provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0', timing: { audioMs: 1800, providerMs: 600, totalMs: 700 } } }
    const rec = sttRecord({ spokenText: 'Show me what this transformation loses.', bytes: 57_644, audioMs: 1801.4, config, result, wallMs: 712.6, capabilityAfter: cap, live: false })
    expect(rec.input).toMatchObject({ kind: 'test-upload-synthesized-speech', note: TEST_UPLOAD_NOTE, synthesizer: 'macOS say', mimeType: 'audio/wav', audioMs: 1801 })
    expect(rec.input.note).toBe('test-uploaded recording (synthesized speech), not a browser microphone')
    expect(rec).toMatchObject({ live: false, httpStatus: 200, outcome: 'transcript', source: 'meta', model: 'muse-voice-transcribe-1.0', error: null, timing: { wallMs: 713, providerMs: 600, serverTotalMs: 700 } })
    expect(rec.configured).toEqual({ speechProvider: 'meta', mode: 'meta', model: 'muse-voice-transcribe-1.0', endpoint: 'https://api.meta.ai/v1/asr/transcribe', problem: null })
    for (const text of [JSON.stringify(rec), sttLine(rec)]) expect(text).not.toContain('LLM_synthetic_record_shape_only')
    expect(sttLine(rec)).toMatch(/^\[speech-live\] \{"input":"test-uploaded recording \(synthesized speech\), not a browser microphone"/)
  })

  it('a failed call is recorded as the route error with its status, and no transcript', () => {
    const result = { status: 502, json: { code: 'provider_auth', message: "Meta speech-to-text rejected the server's API key (HTTP 401). Type the request instead.", retryable: false } }
    const rec = sttRecord({ spokenText: 'x', bytes: 1, audioMs: 1, config, result, wallMs: 1, capabilityAfter: cap, live: false })
    expect(rec).toMatchObject({ httpStatus: 502, outcome: 'error', transcript: null, source: null, provider: null, error: { code: 'provider_auth', retryable: false } })
    expect(rec.error!.message).toContain('HTTP 401')
  })
})
