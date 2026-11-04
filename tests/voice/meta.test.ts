// The Meta Muse Voice Transcribe adapter through the route, with a MOCKED fetch. Every provider reply
// here is SYNTHETIC: shaped like the documented TranscribeResponse, never recorded from a live call.
// These tests establish adapter behavior only, not live verification (see docs/VOICE.md).

import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { capabilitiesFor, createTranscribeRoute } from '../../server/speech/index'
import { newSpeechStatus } from '../../server/speech/config'
import type { ApiResult } from '../../server/types'
import type { TranscribeResponse } from '../../src/voice/protocol'
import { ALL_PRESENT, apiRequest, fakeConverter, toneWav, transcribeBody } from './helpers'

/** A fake, clearly synthetic key. Never a real credential. */
const SYNTHETIC_KEY = `LLM_synthetictest_${randomUUID().replace(/-/g, '')}`
const META_ENV = { SPEECH_PROVIDER: 'auto', META_API_KEY: SYNTHETIC_KEY, FFMPEG_BIN: '/fake/bin/ffmpeg' }
const WAV = toneWav(1200)

interface Call {
  url: string
  init: RequestInit
}

function mockFetch(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call = { url, init }
    calls.push(call)
    return reply(call)
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const documented = (transcript: string) => new Response(JSON.stringify({ sessionId: 'synthetic-session', transcript, audioDurationMs: 1200, turns: [] }), { status: 200, headers: { 'content-type': 'application/json' } })

const observed: string[] = []
const consoleSpies: ReturnType<typeof vi.spyOn>[] = []
beforeEach(() => {
  observed.length = 0
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) consoleSpies.push(vi.spyOn(console, m))
})
afterEach(() => {
  const logged = consoleSpies.flatMap((s) => s.mock.calls.map((c) => JSON.stringify(c)))
  for (const text of [...observed, ...logged]) expect(text).not.toContain(SYNTHETIC_KEY)
  consoleSpies.splice(0).forEach((s) => s.mockRestore())
})

async function run(m: ReturnType<typeof mockFetch>, opts: { signal?: AbortSignal; env?: Record<string, string>; status?: ReturnType<typeof newSpeechStatus> } = {}) {
  const status = opts.status ?? newSpeechStatus()
  const route = createTranscribeRoute({ env: opts.env ?? META_ENV, probe: ALL_PRESENT, fetchImpl: m.fetchImpl, convert: fakeConverter(WAV).convert, status })
  const body = transcribeBody({ hints: ['rotate', 'reflect', 'R', 'S'] })
  const res = await route(apiRequest(body, opts.signal))
  observed.push(JSON.stringify(res), ...m.calls.map((c) => c.url))
  return { res, body, status }
}
const err = (r: ApiResult) => r.json as { code: string; message: string; retryable: boolean }

/** Split a multipart body into its parts (headers + payload). */
function parts(init: RequestInit): { headers: string; payload: Buffer }[] {
  const type = (init.headers as Record<string, string>)['Content-Type']!
  const boundary = /boundary=(.+)$/.exec(type)![1]!
  const body = Buffer.from(init.body as Uint8Array)
  const out: { headers: string; payload: Buffer }[] = []
  const sep = Buffer.from(`--${boundary}`)
  let at = body.indexOf(sep)
  while (at >= 0) {
    const start = at + sep.length
    if (body.subarray(start, start + 2).toString() === '--') break
    const next = body.indexOf(sep, start)
    const chunk = body.subarray(start + 2, next - 2) // skip CRLF after the boundary and before the next
    const split = chunk.indexOf('\r\n\r\n')
    out.push({ headers: chunk.subarray(0, split).toString(), payload: chunk.subarray(split + 4) })
    at = next
  }
  return out
}

describe('request shape (synthetic mock)', () => {
  it('posts the documented multipart request; the key is only in the Authorization header', async () => {
    const m = mockFetch(() => documented('Reverse the order on the left.'))
    const { res, body } = await run(m)
    expect(res.status).toBe(200)
    expect(m.calls).toHaveLength(1)
    const { url, init } = m.calls[0]!
    expect(url).toBe(`https://api.meta.ai/v1/asr/transcribe?sessionId=${body.requestId}`)
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('error')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${SYNTHETIC_KEY}`)
    expect(headers.Accept).toBe('application/json')
    expect(Object.entries(headers).filter(([, v]) => v.includes(SYNTHETIC_KEY)).map(([k]) => k)).toEqual(['Authorization'])
    expect(Buffer.from(init.body as Uint8Array).includes(SYNTHETIC_KEY)).toBe(false)
    const [request, audio, ...rest] = parts(init)
    expect(rest).toEqual([])
    expect(request!.headers).toBe('Content-Disposition: form-data; name="request"\r\nContent-Type: application/json')
    expect(JSON.parse(request!.payload.toString())).toEqual({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK', languageBias: ['English'], keywords: ['rotate', 'reflect', 'R', 'S'] })
    expect(audio!.headers).toBe('Content-Disposition: form-data; name="audio"; filename="audio.wav"\r\nContent-Type: audio/wav')
    expect(audio!.payload.equals(WAV)).toBe(true)
  })

  it('labels the result as Meta with the configured model', async () => {
    const m = mockFetch(() => documented('  Replay the comparison. '))
    const { res, body } = await run(m, { env: { ...META_ENV, META_TRANSCRIBE_MODEL: 'muse-voice-transcribe-1.0', META_TRANSCRIBE_ENDPOINT: 'https://api.meta.ai/v1/asr/transcribe' } })
    const j = res.json as TranscribeResponse
    expect(j).toMatchObject({ requestId: body.requestId, transcript: 'Replay the comparison.', source: 'meta', provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0' })
  })

  it('an empty documented transcript is no speech', async () => {
    const { res } = await run(mockFetch(() => documented('')))
    expect(res.status).toBe(422)
    expect(err(res).code).toBe('no_speech')
  })
})

describe('documented errors (synthetic mock)', () => {
  const cases: [number, Record<string, string>, number, string, boolean, RegExp][] = [
    [401, {}, 502, 'provider_auth', false, /rejected the server's API key \(HTTP 401\)/],
    [403, {}, 502, 'provider_auth', false, /denied this key access .*\(HTTP 403\)/],
    [402, {}, 502, 'provider_auth', false, /billing.*\(HTTP 402\)/],
    [400, {}, 502, 'provider_error', false, /rejected the converted recording \(HTTP 400\)/],
    [404, {}, 502, 'provider_error', false, /did not find.*\(HTTP 404\)/],
    [408, {}, 504, 'timeout', true, /timed out receiving the recording \(HTTP 408\)/],
    [429, { 'retry-after': '3' }, 502, 'provider_error', true, /rate-limiting.*\(HTTP 429\).*about 3 s/],
    [429, { 'retry-after': 'soon' }, 502, 'provider_error', true, /\(HTTP 429\); try again shortly/],
    [500, {}, 502, 'provider_error', true, /could not process the recording \(HTTP 500\)/],
    [503, {}, 502, 'provider_error', true, /temporarily unavailable \(HTTP 503\)/],
    // Meta's gateway timeout: not an unchanged retry (Meta's error guide); a shorter recording is suggested.
    [504, {}, 504, 'timeout', false, /timed out \(HTTP 504\).*shorter request/],
    [418, {}, 502, 'provider_error', false, /rejected the request \(HTTP 418\)/],
  ]
  for (const [status, headers, ours, code, retryable, msg] of cases) {
    it(`HTTP ${status}${headers['retry-after'] ? ` (Retry-After ${headers['retry-after']})` : ''} -> ${ours} ${code}; the provider body is not echoed`, async () => {
      const providerBody = JSON.stringify({ error: { message: `secret detail ${SYNTHETIC_KEY}`, type: 'x', param: null, code: null } })
      const { res } = await run(mockFetch(() => new Response(providerBody, { status, headers })))
      expect(res.status).toBe(ours)
      expect(err(res)).toMatchObject({ code, retryable })
      expect(err(res).message).toMatch(msg)
      expect(JSON.stringify(res.json)).not.toContain('secret detail')
    })
  }

  it('network failure, non-JSON, a missing transcript and an oversized body are provider errors', async () => {
    for (const reply of [
      () => Promise.reject(new TypeError('fetch failed')),
      () => new Response('<html>', { status: 200 }),
      () => new Response(JSON.stringify({ sessionId: 's', turns: [] }), { status: 200 }),
      () => new Response('x'.repeat(300 * 1024), { status: 200 }),
    ]) {
      const { res } = await run(mockFetch(reply))
      expect(res.status).toBe(502)
      expect(err(res).code).toBe('provider_error')
    }
  })

  it('a client disconnect aborts the Meta request', async () => {
    const ac = new AbortController()
    let seen: AbortSignal | null = null
    const m = mockFetch((c) => {
      seen = c.init.signal!
      setTimeout(() => ac.abort(new Error('client disconnected')), 10)
      return new Promise<Response>((_, reject) => c.init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
    })
    const { res } = await run(m, { signal: ac.signal })
    expect(res.status).toBe(499)
    expect(err(res).code).toBe('canceled')
    expect(seen!.aborted).toBe(true)
  })
})

describe('configuration (no live call)', () => {
  it('capabilities: configured, not live-validated, with no key in the output', () => {
    const c = capabilitiesFor(META_ENV, newSpeechStatus(), ALL_PRESENT)
    expect(c).toEqual({ configured: true, liveValidated: false, mode: 'meta', provider: 'meta-muse-voice-transcribe', model: 'muse-voice-transcribe-1.0', acceptedMimeTypes: ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'], problem: null })
    expect(JSON.stringify(c)).not.toContain(SYNTHETIC_KEY)
  })

  it('a mocked success marks only the test status record, for this exact configuration', async () => {
    const status = newSpeechStatus()
    await run(mockFetch(() => documented('ok')), { status })
    expect(capabilitiesFor(META_ENV, status, ALL_PRESENT).liveValidated).toBe(true)
    expect(capabilitiesFor({ ...META_ENV, META_API_KEY: `${SYNTHETIC_KEY}x` }, status, ALL_PRESENT).liveValidated).toBe(false)
  })

  it('a bad endpoint or model identifier is unavailable, and the key never appears in the problem', () => {
    for (const env of [{ META_TRANSCRIBE_ENDPOINT: 'http://api.meta.ai/v1/asr/transcribe' }, { META_TRANSCRIBE_ENDPOINT: 'https://u:p@x.test/' }, { META_TRANSCRIBE_MODEL: 'bad model' }, { META_API_KEY: 'has space' }]) {
      const c = capabilitiesFor({ ...META_ENV, ...env }, newSpeechStatus(), ALL_PRESENT)
      expect(c.mode).toBe('unavailable')
      expect(c.problem).toBeTruthy()
      expect(c.problem).not.toContain(SYNTHETIC_KEY)
    }
  })
})
