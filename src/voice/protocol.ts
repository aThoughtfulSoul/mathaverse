// POST /api/transcribe protocol (WORKSPACE-AND-AI W6/W7), shared by the browser voice client and the
// server speech route. Pure TypeScript, no DOM or Node APIs. The route returns a transcript and its
// provenance only: never scene actions. The transcript reaches the assistant only through the same
// typed request path as typed input (AssistantClient.ask).

/** Recording formats the route accepts (what browsers' MediaRecorder produces), in preference order. */
export const TRANSCRIBE_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'] as const
export type TranscribeMimeType = (typeof TRANSCRIBE_MIME_TYPES)[number]

export const TRANSCRIBE_LIMITS = {
  /** W6: audio at most 30 s. */
  maxDurationMs: 30_000,
  /** Base64 characters: about 1.07 MiB of audio, under the route's 1.5 MiB body limit with room for JSON. */
  maxAudioBase64: 1_500_000,
  /** Shorter than this is not a usable utterance (a tap, not a hold). */
  minDurationMs: 200,
  maxHints: 40,
  maxHintLength: 48,
  maxRequestIdLength: 64,
} as const

export interface TranscribeRequest {
  requestId: string
  mimeType: TranscribeMimeType
  audioBase64: string
  /** Recorded duration measured by the client (the server measures the decoded audio itself). */
  durationMs: number
  /** Vocabulary hints: mathematical terms and displayed labels (bias only; never guaranteed spelling). */
  hints: string[]
}

export interface TranscribeResponse {
  requestId: string
  transcript: string
  /** Production success comes only from Meta speech. Tests use clearly labelled injected fixtures. */
  source: 'meta'
  provider: string
  model: string
  timing: {
    /** Decoded audio duration measured by the server. */
    audioMs: number
    /** Time inside the Meta request. */
    providerMs: number
    /** Route total, including validation and format conversion. */
    totalMs: number
  }
}

/** Error codes of /api/transcribe and their HTTP statuses (errors are { code, message, retryable }). */
export const TRANSCRIBE_ERRORS = {
  invalid_request: 400,
  unsupported_format: 415,
  audio_too_long: 413,
  no_speech: 422,
  canceled: 499,
  provider_error: 502,
  provider_auth: 502,
  speech_unavailable: 503,
  busy: 503,
  timeout: 504,
} as const
export type TranscribeErrorCode = keyof typeof TRANSCRIBE_ERRORS

export class TranscribeRequestError extends Error {
  override name = 'TranscribeRequestError'
  constructor(readonly code: 'invalid_request' | 'unsupported_format' | 'audio_too_long', message: string) {
    super(message)
  }
  get status(): number {
    return TRANSCRIBE_ERRORS[this.code]
  }
}

/** Canonical form of a MIME type string ("audio/ogg; codecs=opus" -> "audio/ogg;codecs=opus"). */
export function normalizeMime(raw: string): string {
  return raw.toLowerCase().replace(/\s+/g, '')
}

export function isAcceptedMime(raw: string): raw is TranscribeMimeType {
  return (TRANSCRIBE_MIME_TYPES as readonly string[]).includes(normalizeMime(raw))
}

const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/
const FIELDS = ['requestId', 'mimeType', 'audioBase64', 'durationMs', 'hints']

/** Strict validation of a request body (closed fields). Throws TranscribeRequestError. */
export function parseTranscribeRequest(json: unknown): TranscribeRequest {
  const bad = (m: string) => new TranscribeRequestError('invalid_request', m)
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw bad('the body must be a JSON object')
  const o = json as Record<string, unknown>
  const extra = Object.keys(o).filter((k) => !FIELDS.includes(k))
  if (extra.length) throw bad(`unknown field ${extra[0]}`)
  const { requestId, mimeType, audioBase64, durationMs, hints } = o
  if (typeof requestId !== 'string' || !requestId || requestId.length > TRANSCRIBE_LIMITS.maxRequestIdLength || !REQUEST_ID_RE.test(requestId)) throw bad(`requestId must be 1-${TRANSCRIBE_LIMITS.maxRequestIdLength} characters of A-Z a-z 0-9 . _ : -`)
  if (typeof mimeType !== 'string' || mimeType.length > 64) throw bad('mimeType must be a string')
  if (!isAcceptedMime(mimeType)) throw new TranscribeRequestError('unsupported_format', `the recording format ${JSON.stringify(mimeType.slice(0, 64))} is not accepted; use one of ${TRANSCRIBE_MIME_TYPES.join(', ')}`)
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) throw bad('durationMs must be a non-negative number')
  if (durationMs > TRANSCRIBE_LIMITS.maxDurationMs) throw new TranscribeRequestError('audio_too_long', `the recording is ${(durationMs / 1000).toFixed(1)} s; at most ${TRANSCRIBE_LIMITS.maxDurationMs / 1000} s is accepted`)
  if (typeof audioBase64 !== 'string' || !audioBase64) throw bad('audioBase64 must be a non-empty string')
  if (audioBase64.length > TRANSCRIBE_LIMITS.maxAudioBase64) throw new TranscribeRequestError('audio_too_long', `the recording is above the ${Math.floor((TRANSCRIBE_LIMITS.maxAudioBase64 * 3) / 4 / 1024)} KiB audio limit`)
  if (audioBase64.length % 4 !== 0 || !BASE64_RE.test(audioBase64)) throw bad('audioBase64 is not valid base64')
  if (!Array.isArray(hints)) throw bad('hints must be an array of strings')
  if (hints.length > TRANSCRIBE_LIMITS.maxHints) throw bad(`at most ${TRANSCRIBE_LIMITS.maxHints} hints`)
  for (const h of hints) {
    if (typeof h !== 'string' || !h.trim() || h.length > TRANSCRIBE_LIMITS.maxHintLength || CONTROL_RE.test(h)) throw bad(`each hint must be 1-${TRANSCRIBE_LIMITS.maxHintLength} printable characters`)
  }
  return { requestId, mimeType: normalizeMime(mimeType) as TranscribeMimeType, audioBase64, durationMs, hints: hints as string[] }
}

/** Client-side re-validation of a success body. Returns null when it is not a response to this request. */
export function parseTranscribeResponse(json: unknown, requestId: string): TranscribeResponse | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Partial<TranscribeResponse>
  const t = o.timing as Partial<TranscribeResponse['timing']> | undefined
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  if (o.requestId !== requestId || typeof o.transcript !== 'string' || o.source !== 'meta') return null
  if (typeof o.provider !== 'string' || typeof o.model !== 'string' || !t || !num(t.audioMs) || !num(t.providerMs) || !num(t.totalMs)) return null
  return { requestId, transcript: o.transcript, source: o.source, provider: o.provider, model: o.model, timing: { audioMs: t.audioMs!, providerMs: t.providerMs!, totalMs: t.totalMs! } }
}

/** Bounded, de-duplicated hints (the client trims and drops what the route would reject). */
export function boundHints(raw: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    const h = r.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, TRANSCRIBE_LIMITS.maxHintLength).trim()
    if (!h || seen.has(h.toLowerCase())) continue
    seen.add(h.toLowerCase())
    out.push(h)
    if (out.length === TRANSCRIBE_LIMITS.maxHints) break
  }
  return out
}

/** Vocabulary of the two demonstrations and their requests (merged with the displayed labels). */
export const VOICE_VOCABULARY = [
  'rotate', 'rotation', 'reflect', 'reflection', 'order', 'left', 'right', 'route', 'replay', 'reverse',
  'comparison', 'compare', 'matrix', 'linear map', 'projection', 'vector', 'basis vector', 'square',
  'fiber', 'kernel', 'image', 'recipe', 'Lean', 'witness', 'differ', 'equal',
]
