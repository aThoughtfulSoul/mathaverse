// POST /api/transcribe and the speech capability (docs/INTERFACES.md, WORKSPACE-AND-AI W6-W8, docs/VOICE.md).
//
// Lifecycle: configuration (environment only) -> strict request validation (closed fields, MIME
// allowlist, 30 s, base64 bound, hints) -> container signature must match the declared MIME type ->
// ffmpeg converts into a private temp directory (16 kHz mono 16-bit WAV) -> the decoded duration and
// level are measured -> one Meta Muse Voice Transcribe call under a deadline
// -> { requestId, transcript, source, provider, model, timing }. Never scene actions: the browser sends
// the (correctable) transcript through the ordinary typed assistant request. The request's abort signal
// kills the ffmpeg process and aborts the Meta fetch. Temp files are always removed. Audio,
// transcripts and keys are never logged.

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { TRANSCRIBE_LIMITS, TRANSCRIBE_MIME_TYPES, type TranscribeRequest, TranscribeRequestError, type TranscribeResponse, parseTranscribeRequest } from '../../src/voice/protocol'
import { API_LIMITS } from '../../src/workspace/actions'
import { ABORT_REASON, type ApiResult, type RouteHandler, type SpeechCapability, apiError } from '../types'
import { CONVERT_TIMEOUT_MS, type Container, SILENCE_PEAK, containerOf, convertArgs, parseWav, runBounded, sniffContainer } from './audio'
import { type Env, type Probe, type SpeechConfig, type SpeechStatus, fingerprint, fsProbe, newSpeechStatus, providerOf, readSpeechConfig } from './config'
import { metaProvider } from './meta'
import { type SpeechProvider, SpeechAborted, SpeechError } from './provider'

/** Provider deadline, inside the 45 s application timeout (after at most 10 s of conversion). */
export const PROVIDER_DEADLINE_MS = 30_000
/** Recorders stop a little after the requested length; the decoded duration may exceed 30 s by this much. */
const DURATION_TOLERANCE_MS = 500

export interface ConvertInput {
  bytes: Buffer
  container: Container
  /** The request's private temp directory (removed by the route). */
  dir: string
  signal: AbortSignal
}

/** Decode a recording into `dir` and return the path of a 16 kHz mono 16-bit WAV. */
export type Converter = (input: ConvertInput) => Promise<string>

export interface SpeechDeps {
  env?: Env
  probe?: Probe
  /** Tests inject a synthetic provider; production always uses the Meta adapter. */
  provider?: (config: SpeechConfig) => SpeechProvider
  /** Tests inject a decoder; by default ffmpeg. */
  convert?: Converter
  fetchImpl?: typeof fetch
  /** Where live validation is recorded (process-wide only for the default route). */
  status?: SpeechStatus
  providerDeadlineMs?: number
  now?: () => number
}

const processStatus = newSpeechStatus()

export function ffmpegConverter(ffmpeg: string): Converter {
  return async ({ bytes, container, dir, signal }) => {
    const input = join(dir, `input.${container}`)
    const output = join(dir, 'audio.wav')
    await writeFile(input, bytes)
    const maxSeconds = Math.ceil((TRANSCRIBE_LIMITS.maxDurationMs + 1000) / 1000)
    const r = await runBounded(ffmpeg, convertArgs(input, output, container, maxSeconds), { cwd: dir, env: { PATH: '/usr/bin:/bin', LANG: 'C' }, timeoutMs: CONVERT_TIMEOUT_MS, signal })
    if (r.aborted) throw new SpeechAborted()
    if (r.timedOut) throw new SpeechError('timeout', `Converting the recording took longer than ${CONVERT_TIMEOUT_MS / 1000} s.`, true)
    if (r.spawnError) throw new SpeechError('speech_unavailable', 'ffmpeg could not be started on this server.', false)
    if (r.code !== 0) throw new SpeechError('unsupported_format', `The recording could not be decoded as ${container} audio.`, false)
    return output
  }
}

/** Construct the configured Meta adapter. The route reports any error to the client. */
function defaultProvider(config: SpeechConfig, fetchImpl: typeof fetch): SpeechProvider {
  if (config.mode !== 'meta') throw new SpeechError('speech_unavailable', 'Meta speech-to-text is not configured.', false)
  return metaProvider(config, fetchImpl)
}

function abortedResult(signal: AbortSignal): ApiResult {
  const r = signal.reason as { name?: unknown; message?: unknown } | undefined
  const timedOut = r?.name === 'TimeoutError' || r?.message === ABORT_REASON.timeout
  return timedOut
    ? apiError(504, 'timeout', 'The transcription exceeded the application time limit.', true)
    : apiError(499, 'canceled', 'The transcription was canceled; no transcript was used.', false)
}

const fromError = (e: SpeechError) => apiError(e.status, e.code, e.message, e.retryable)

/** Provider text -> transcript: whitespace collapsed, a lone non-speech marker such as "[BLANK_AUDIO]" dropped. */
export function cleanTranscript(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  if (/^[[(][^\])]{0,40}[\])]$/.test(t)) return ''
  return t.slice(0, API_LIMITS.prompt)
}

/** Above this compression ratio (zlib), reject repetitive transcript output. */
export const LOOP_COMPRESSION_RATIO = 2.4
/** A word said this many times running is a decoding loop, not a request. */
const LOOP_RUN = 5
/** A transcript that starts with this many hints, in their order, is the prompt read back. */
const ECHO_HINTS = 3

const wordsOf = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

/**
 * Why a transcript is a model failure rather than speech (null when it is not): a decoding loop (one
 * word LOOP_RUN times running, or compression above LOOP_COMPRESSION_RATIO) or the vocabulary hints read
 * back in order. This guard rejects unusable text even when audio passes the peak check.
 */
export function hallucinationOf(transcript: string, hints: readonly string[]): 'loop' | 'hint_echo' | null {
  const w = wordsOf(transcript)
  for (let i = 1, run = 1; i < w.length; i++) {
    run = w[i] === w[i - 1] ? run + 1 : 1
    if (run >= LOOP_RUN) return 'loop'
  }
  const bytes = Buffer.from(transcript, 'utf8')
  if (bytes.length / deflateSync(bytes).length > LOOP_COMPRESSION_RATIO) return 'loop'
  if (hints.length < ECHO_HINTS) return null
  let at = 0
  for (const h of hints.slice(0, ECHO_HINTS)) {
    const hw = wordsOf(h)
    if (!hw.length || hw.some((x, j) => w[at + j] !== x)) return null
    at += hw.length
  }
  return 'hint_echo'
}

/** Build the route with injectable dependencies (tests pass a fake provider, decoder and status). */
export function createTranscribeRoute(deps: SpeechDeps = {}): RouteHandler {
  const now = deps.now ?? (() => performance.now())
  const status = deps.status ?? (deps.provider ? newSpeechStatus() : processStatus)
  const deadlineMs = deps.providerDeadlineMs ?? PROVIDER_DEADLINE_MS
  return async (req) => {
    const t0 = now()
    if (req.method !== 'POST') return apiError(405, 'method_not_allowed', 'Use POST /api/transcribe.', false)
    const config = readSpeechConfig(deps.env ?? process.env, deps.probe ?? fsProbe)
    if (config.mode === 'unavailable') return apiError(503, 'speech_unavailable', `Speech is unavailable: ${config.problem}. Typed requests still work.`, false)
    let r: TranscribeRequest
    try {
      r = parseTranscribeRequest(req.body)
    } catch (e) {
      if (e instanceof TranscribeRequestError) return apiError(e.status, e.code, `Invalid transcription request: ${e.message}.`, false)
      throw e
    }
    const bytes = Buffer.from(r.audioBase64, 'base64')
    const container = containerOf(r.mimeType)
    const actual = sniffContainer(bytes)
    if (actual !== container) return apiError(415, 'unsupported_format', actual ? `The audio is ${actual} data, not ${r.mimeType}.` : `The audio is not ${r.mimeType} data.`, false)
    if (req.signal.aborted) return abortedResult(req.signal)

    const dir = await mkdtemp(join(tmpdir(), 'mw-speech-'))
    try {
      let wavPath: string
      try {
        wavPath = await (deps.convert ?? ffmpegConverter(config.ffmpeg!))({ bytes, container, dir, signal: req.signal })
      } catch (e) {
        if (req.signal.aborted || e instanceof SpeechAborted) return abortedResult(req.signal)
        if (e instanceof SpeechError) return fromError(e)
        return apiError(415, 'unsupported_format', 'The recording could not be decoded.', false)
      }
      const wav = await readFile(wavPath)
      const info = parseWav(wav)
      if (!info || info.sampleRate !== 16000 || info.channels !== 1) return apiError(415, 'unsupported_format', 'The recording could not be decoded into audio.', false)
      if (info.durationMs > TRANSCRIBE_LIMITS.maxDurationMs + DURATION_TOLERANCE_MS) return apiError(413, 'audio_too_long', `The recording is longer than ${TRANSCRIBE_LIMITS.maxDurationMs / 1000} s.`, false)
      if (info.durationMs < TRANSCRIBE_LIMITS.minDurationMs || info.peak < SILENCE_PEAK) return apiError(422, 'no_speech', info.peak < SILENCE_PEAK ? 'The recording is silent; check the microphone and try again.' : 'The recording is too short; hold Talk while speaking.', true)
      if (req.signal.aborted) return abortedResult(req.signal)

      let provider: SpeechProvider
      try {
        provider = (deps.provider ?? ((c) => defaultProvider(c, deps.fetchImpl ?? ((i, init) => globalThis.fetch(i, init)))))(config)
      } catch (e) {
        if (e instanceof SpeechError) return fromError(e)
        throw e
      }
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(deadlineMs)])
      const tp = now()
      let text: string
      try {
        text = await provider.transcribe({ wavPath, wav, hints: r.hints, requestId: r.requestId, signal })
      } catch (e) {
        if (req.signal.aborted) return abortedResult(req.signal)
        // The application's own provider deadline (Meta's own HTTP 504 arrives as a SpeechError from meta.ts).
        if (signal.aborted || e instanceof SpeechAborted) return apiError(504, 'timeout', `Meta speech-to-text did not answer within this application's ${deadlineMs / 1000} s limit; nothing was transcribed. Try again, or type the request.`, true)
        if (e instanceof SpeechError) return fromError(e)
        return apiError(502, 'provider_error', 'The transcription failed.', true)
      }
      const providerMs = now() - tp
      if (req.signal.aborted) return abortedResult(req.signal)
      const transcript = cleanTranscript(text)
      if (!transcript) return apiError(422, 'no_speech', 'No speech was recognized; try again.', true)
      if (hallucinationOf(transcript, r.hints)) return apiError(422, 'no_speech', 'No clear speech was recognized; try again.', true)
      // A real transcription by the configured provider (an injected provider never writes process status).
      status.liveValidatedFor = fingerprint(config)
      const body: TranscribeResponse = {
        requestId: r.requestId,
        transcript,
        source: provider.source,
        provider: provider.provider,
        model: provider.model,
        timing: { audioMs: Math.round(info.durationMs), providerMs: Math.round(providerMs), totalMs: Math.round(now() - t0) },
      }
      return { status: 200, json: body }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

const defaultRoute = createTranscribeRoute()

/** POST /api/transcribe (docs/INTERFACES.md). */
export const transcribeRoute: RouteHandler = (req) => defaultRoute(req)

/** Truthful status for an environment and a status record (exported for tests). */
export function capabilitiesFor(env: Env, status: SpeechStatus, probe: Probe = fsProbe): SpeechCapability {
  const c = readSpeechConfig(env, probe)
  const id = providerOf(c)
  const fp = fingerprint(c)
  const usable = c.mode !== 'unavailable'
  return {
    configured: c.mode !== 'unavailable',
    liveValidated: fp !== null && status.liveValidatedFor === fp,
    mode: usable ? c.mode : 'unavailable',
    provider: id?.provider ?? null,
    model: id?.model ?? null,
    acceptedMimeTypes: usable ? [...TRANSCRIBE_MIME_TYPES] : [],
    problem: c.problem,
  }
}

/** GET /api/capabilities reports configuration without starting any model or sending audio. */
export async function speechCapabilities(): Promise<SpeechCapability> {
  return capabilitiesFor(process.env, processStatus, fsProbe)
}
