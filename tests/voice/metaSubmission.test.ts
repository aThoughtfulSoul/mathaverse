// The submission speech path (SPEECH_PROVIDER=meta, as scripts/muse-live.sh sets it) with a MOCKED Meta fetch.
// Every provider reply here is SYNTHETIC, shaped like the documented responses; nothing is a live result.
//
// Checked: every Meta failure is reported as itself (Meta's HTTP status in the message, a truthful code), with
// exactly one call to the Meta endpoint; a missing key is "unavailable" with no provider request. The browser client shows the
// route's error and the typed Ask path stays available; cancellation during the Meta call aborts it and sends
// nothing; the capability report and the labels name Meta speech-to-text, never Muse output.

import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { capabilitiesFor, createTranscribeRoute, speechCapabilities } from '../../server/speech/index'
import { newSpeechStatus } from '../../server/speech/config'
import type { ApiResult, RouteHandler, SpeechCapability } from '../../server/types'
import { MICROPHONE_INPUT, VoiceClient, transcriptSource } from '../../src/voice/client'
import type { TranscribeResponse } from '../../src/voice/protocol'
import { speechStatus, transcriptProvenance } from '../../src/ui/assistant/source'
import { assistantView } from '../../src/ui/assistant/view'
import { CAP, docs, panelInput } from '../ui/assistant/helpers'
import { FakeRecorder } from './fakes'
import { ALL_PRESENT, TEST_META_ENV, apiRequest, fakeConverter, toneWav, transcribeBody } from './helpers'

/** A fake, clearly synthetic key. Never a real credential. */
const SYNTHETIC_KEY = `LLM_synthetictest_${randomUUID().replace(/-/g, '')}`
/** Meta configuration for the mocked endpoint. No real key or network call. */
const META_ENV = { ...TEST_META_ENV, SPEECH_PROVIDER: 'meta', META_API_KEY: SYNTHETIC_KEY }
const ENDPOINT = 'https://api.meta.ai/v1/asr/transcribe'
const MODEL = 'muse-voice-transcribe-1.0'

interface MetaCall {
  url: string
  signal: AbortSignal
}

/** The mocked Meta endpoint: answers with `reply`, or holds the request until its signal aborts. */
function metaFetch(reply: Response | (() => Response | Promise<Response>) | 'hang') {
  const calls: MetaCall[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, signal: init.signal! })
    if (reply === 'hang') {
      return new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
    }
    return typeof reply === 'function' ? reply() : reply
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const documented = (transcript: string) => new Response(JSON.stringify({ sessionId: 'synthetic-session', transcript, audioDurationMs: 1200, turns: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
const providerBody = () => JSON.stringify({ error: { message: `secret provider detail ${SYNTHETIC_KEY}`, type: 'x', param: null, code: null } })

function metaRoute(m: ReturnType<typeof metaFetch>, opts: { env?: Record<string, string>; deadline?: number } = {}): RouteHandler {
  return createTranscribeRoute({ env: opts.env ?? META_ENV, probe: ALL_PRESENT, fetchImpl: m.fetchImpl, convert: fakeConverter(toneWav(1200)).convert, status: newSpeechStatus(), providerDeadlineMs: opts.deadline })
}

const err = (r: ApiResult) => r.json as { code: string; message: string; retryable: boolean }

const observed: string[] = []
const consoleSpies: ReturnType<typeof vi.spyOn>[] = []
beforeEach(() => {
  observed.length = 0
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) consoleSpies.push(vi.spyOn(console, m))
})
afterEach(() => {
  const logged = consoleSpies.flatMap((s) => s.mock.calls.map((c) => JSON.stringify(c)))
  for (const text of [...observed, ...logged]) {
    expect(text).not.toContain(SYNTHETIC_KEY)
    expect(text).not.toContain('secret provider detail')
  }
  consoleSpies.splice(0).forEach((s) => s.mockRestore())
  vi.unstubAllEnvs()
})

describe('Meta failures on the submission path: truthful status, no fallback (synthetic mock)', () => {
  const cases: { meta: number | 'network'; headers?: Record<string, string>; status: number; code: string; retryable: boolean; message: RegExp }[] = [
    { meta: 401, status: 502, code: 'provider_auth', retryable: false, message: /rejected the server's API key \(HTTP 401\)/ },
    { meta: 402, status: 502, code: 'provider_auth', retryable: false, message: /billing problem .*\(HTTP 402\)/ },
    { meta: 403, status: 502, code: 'provider_auth', retryable: false, message: /denied this key access .*\(HTTP 403\)/ },
    { meta: 429, headers: { 'retry-after': '2' }, status: 502, code: 'provider_error', retryable: true, message: /rate-limiting requests \(HTTP 429\); try again in about 2 s/ },
    { meta: 503, status: 502, code: 'provider_error', retryable: true, message: /temporarily unavailable \(HTTP 503\)/ },
    { meta: 504, status: 504, code: 'timeout', retryable: false, message: /timed out \(HTTP 504\); nothing was transcribed\. Record a shorter request/ },
    { meta: 500, status: 502, code: 'provider_error', retryable: true, message: /could not process the recording \(HTTP 500\)/ },
    { meta: 'network', status: 502, code: 'provider_error', retryable: true, message: /could not be reached \(network error, no HTTP status\)/ },
  ]
  for (const c of cases) {
    it(`Meta ${c.meta} -> ${c.status} ${c.code}, one Meta call, no fallback`, async () => {
      const m = metaFetch(c.meta === 'network' ? () => Promise.reject(new TypeError('fetch failed')) : () => new Response(providerBody(), { status: c.meta as number, headers: c.headers }))
      const res = await metaRoute(m)(apiRequest(transcribeBody()))
      observed.push(JSON.stringify(res))
      expect(res.status).toBe(c.status)
      expect(err(res)).toMatchObject({ code: c.code, retryable: c.retryable })
      expect(err(res).message).toMatch(c.message)
      expect(err(res).message).toMatch(/^Meta speech-to-text /)
      expect(err(res).message).toMatch(/type (the request|it)/i) // the typed request path is named as the way on
      expect(res.json).not.toHaveProperty('transcript')
      expect(res.json).not.toHaveProperty('source')
      expect(m.calls.map((x) => x.url.split('?')[0])).toEqual([ENDPOINT])
    })
  }

  it("Meta's own 504, this application's deadline and a 429/503 are told apart", async () => {
    const upstream = await metaRoute(metaFetch(() => new Response('', { status: 504 })))(apiRequest(transcribeBody()))
    const deadline = await metaRoute(metaFetch('hang'), { deadline: 30 })(apiRequest(transcribeBody()))
    expect(upstream.status).toBe(504)
    expect(deadline.status).toBe(504)
    expect(err(upstream).message).toContain('HTTP 504')
    expect(err(upstream).message).not.toMatch(/application/)
    expect(err(upstream).retryable).toBe(false) // Meta advises against an unchanged retry of its gateway timeout
    expect(err(deadline).message).toMatch(/did not answer within this application's 0\.03 s limit/)
    expect(err(deadline).message).not.toContain('HTTP')
    for (const s of [429, 503]) {
      const r = await metaRoute(metaFetch(() => new Response('', { status: s })))(apiRequest(transcribeBody()))
      expect(r.status).toBe(502)
      expect(err(r).message).toContain(`HTTP ${s}`)
      expect(err(r).message).not.toMatch(/timed out/)
    }
  })

  it('SPEECH_PROVIDER=meta without a key is unavailable (503), no call at all', async () => {
    const m = metaFetch(documented('should never be requested'))
    const env = { ...TEST_META_ENV, SPEECH_PROVIDER: 'meta', META_API_KEY: '' }
    const res = await metaRoute(m, { env })(apiRequest(transcribeBody()))
    expect(res.status).toBe(503)
    expect(err(res)).toMatchObject({ code: 'speech_unavailable', retryable: false })
    expect(err(res).message).toMatch(/Meta speech-to-text is selected \(SPEECH_PROVIDER=meta\) but no META_API_KEY is configured.*Typed requests still work/)
    expect(m.calls).toEqual([])
  })
})

describe('capabilities on the submission path', () => {
  it('SPEECH_PROVIDER=meta with a key: Meta speech-to-text, configured, not yet live-validated, no key in the record', () => {
    const c = capabilitiesFor(META_ENV, newSpeechStatus(), ALL_PRESENT)
    expect(c).toEqual({ configured: true, liveValidated: false, mode: 'meta', provider: 'meta-muse-voice-transcribe', model: MODEL, acceptedMimeTypes: ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'], problem: null })
    expect(JSON.stringify(c)).not.toContain(SYNTHETIC_KEY)
    expect(speechStatus({ capability: { assistant: CAP.live, speech: c }, voice: { kind: 'idle' } })).toMatchObject({ label: 'Voice: Meta speech-to-text transcription · live call unverified', available: true })
  })

  it('SPEECH_PROVIDER=meta without a key: unavailable with the reason, and voice is off in the UI', () => {
    const c = capabilitiesFor({ ...TEST_META_ENV, SPEECH_PROVIDER: 'meta', META_API_KEY: '' }, newSpeechStatus(), ALL_PRESENT)
    expect(c).toMatchObject({ configured: false, liveValidated: false, mode: 'unavailable', acceptedMimeTypes: [] })
    expect(c.provider).toBeNull()
    expect(c.problem).toMatch(/SPEECH_PROVIDER=meta.*no META_API_KEY/)
    const s = speechStatus({ capability: { assistant: CAP.live, speech: c }, voice: { kind: 'idle' } })
    expect(s).toMatchObject({ label: 'Voice unavailable', available: false })
    expect(s.detail).toMatch(/no META_API_KEY.*Type the question instead/)
  })

  it('the process capability report shows Meta or unavailable without making an API call', async () => {
    vi.stubEnv('SPEECH_PROVIDER', 'meta')
    vi.stubEnv('META_API_KEY', SYNTHETIC_KEY)
    vi.stubEnv('MODEL_API_KEY', '')
    const c = await speechCapabilities()
    observed.push(JSON.stringify(c))
    expect(['meta', 'unavailable']).toContain(c.mode) // unavailable only if this machine has no ffmpeg
    vi.stubEnv('META_API_KEY', '')
    expect((await speechCapabilities()).mode).toBe('unavailable')
  })
})

// ---- the browser client against the real route (mocked Meta endpoint, fake microphone) ----

let clock = 0
/** The client's fetch, answered by the route in process; the client's abort signal is the request's signal. */
function routeFetch(route: RouteHandler) {
  const results: ApiResult[] = []
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const r = await route(apiRequest(JSON.parse(String(init.body)), init.signal!))
    results.push(r)
    observed.push(JSON.stringify(r))
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchImpl, results }
}

function metaClient(m: ReturnType<typeof metaFetch>, env: Record<string, string> = META_ENV) {
  const net = routeFetch(metaRoute(m, { env }))
  const submitted: string[] = []
  const client = new VoiceClient({
    submit: (t) => submitted.push(t),
    fetch: net.fetchImpl,
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) as unknown as MediaStream,
    Recorder: FakeRecorder as unknown as typeof MediaRecorder,
    now: () => clock,
  })
  const capability: SpeechCapability = capabilitiesFor(env, newSpeechStatus(), ALL_PRESENT)
  client.setCapability(capability)
  return { client, net, submitted, capability }
}

async function speak(c: VoiceClient) {
  await c.start()
  clock += 1500
  c.stop()
}

describe('the browser client on the Meta path (synthetic mock)', () => {
  beforeEach(() => {
    clock = 1000
    FakeRecorder.instances = []
    FakeRecorder.supported = new Set(['audio/webm;codecs=opus', 'audio/webm'])
  })

  it('a Meta 401 is shown as the error it is; nothing is sent, and the typed Ask path stays available', async () => {
    const { client, net, submitted, capability } = metaClient(metaFetch(() => new Response(providerBody(), { status: 401 })))
    await speak(client)
    await vi.waitFor(() => expect(client.state.kind).toBe('error'))
    expect(client.state).toEqual({ kind: 'error', code: 'provider_auth', message: "Meta speech-to-text rejected the server's API key (HTTP 401). Type the request instead." })
    expect(net.results.map((r) => r.status)).toEqual([502])
    expect(submitted).toEqual([])
    expect(client.history.at(-1)).toMatchObject({ outcome: 'provider_auth', input: MICROPHONE_INPUT })
    const v = assistantView(panelInput(docs().pq, { voice: client.state, capability: { assistant: CAP.live, speech: capability } }))
    expect(v.voice).toMatchObject({ phase: 'error', tone: 'error' })
    expect(v.voice.status).toContain('HTTP 401')
    expect(v.input).toMatchObject({ visible: true, enabled: true })
    // Voice can be tried again: the failure did not switch speech off or to another provider.
    expect(client.speechCapability?.mode).toBe('meta')
    await client.start()
    expect(client.state.kind).toBe('recording')
    client.cancel()
  })

  it('cancel during the Meta call aborts it; the late result is ignored and nothing is sent', async () => {
    const m = metaFetch('hang')
    const { client, net, submitted } = metaClient(m)
    await speak(client)
    await vi.waitFor(() => expect(m.calls).toHaveLength(1))
    expect(client.state.kind).toBe('transcribing')
    client.cancel()
    expect(client.state).toEqual({ kind: 'canceled' })
    await vi.waitFor(() => expect(net.results).toHaveLength(1))
    expect(m.calls[0]!.signal.aborted).toBe(true) // the server's Meta request was aborted, not left running
    expect(net.results[0]).toMatchObject({ status: 499, json: { code: 'canceled' } })
    expect(client.state).toEqual({ kind: 'canceled' })
    expect(submitted).toEqual([])
    expect(m.calls).toHaveLength(1)
  })

  it('a Meta transcript is labelled Meta speech-to-text with its model, microphone input, and is sent only on Send', async () => {
    const { client, submitted, capability } = metaClient(metaFetch(() => documented('Show me what this transformation loses.')))
    await speak(client)
    await vi.waitFor(() => expect(client.state.kind).toBe('transcript'))
    const s = client.state as Extract<typeof client.state, { kind: 'transcript' }>
    expect(s.response).toMatchObject({ source: 'meta', provider: 'meta-muse-voice-transcribe', model: MODEL })
    expect(client.lastTiming).toMatchObject({ input: 'browser-microphone', source: 'meta', model: MODEL })
    expect(transcriptProvenance(s.response)).toBe(`Meta transcription · ${MODEL}`)
    expect(transcriptSource(s.response)).toBe(`Meta speech-to-text transcription (${MODEL})`)
    const v = assistantView(panelInput(docs().pq, { voice: s, capability: { assistant: CAP.live, speech: capability } }))
    expect(v.voice.transcript?.source).toBe(`Meta transcription · ${MODEL}`)
    // Transcription is labelled apart from Muse reasoning: no "Muse" except inside the model identifier.
    for (const text of [v.voice.transcript!.source, v.speech.label, v.speech.detail, v.voice.status ?? '']) expect(text.replaceAll(MODEL, '')).not.toMatch(/muse/i)
    expect(submitted).toEqual([])
    client.edit('Show me what this map loses.')
    client.submit()
    expect(submitted).toEqual(['Show me what this map loses.'])
  })
})

describe('speech labels (no call)', () => {
  const response: TranscribeResponse = { requestId: 'r', transcript: 'x', source: 'meta', provider: 'meta-muse-voice-transcribe', model: MODEL, timing: { audioMs: 1, providerMs: 1, totalMs: 1 } }
  const cap = (liveValidated: boolean): SpeechCapability => ({ configured: true, liveValidated, mode: 'meta', provider: 'meta-muse-voice-transcribe', model: MODEL, acceptedMimeTypes: ['audio/webm'], problem: null })

  it('"live call unverified" stays until the server reports a real Meta transcription', () => {
    expect(speechStatus({ capability: { assistant: CAP.live, speech: cap(false) }, voice: { kind: 'idle' } }).label).toBe('Voice: Meta speech-to-text transcription · live call unverified')
    expect(speechStatus({ capability: { assistant: CAP.live, speech: cap(true) }, voice: { kind: 'idle' } }).label).toBe('Voice: Meta speech-to-text transcription')
  })

  it('Meta transcription is labelled separately from Muse reasoning', () => {
    const s = speechStatus({ capability: { assistant: CAP.liveVerified, speech: cap(false) }, voice: { kind: 'idle' } })
    expect(`${s.label} ${s.detail}`.replaceAll(MODEL, '')).not.toMatch(/muse/i)
    expect(s.detail).toContain(MODEL)
    expect(s.detail).toMatch(/Transcription only, separate from the assistant's answer/)
    expect(transcriptProvenance(response)).toBe(`Meta transcription · ${MODEL}`)
    expect(transcriptSource(response)).toBe(`Meta speech-to-text transcription (${MODEL})`)
  })
})
