// Meta Muse Voice Transcribe adapter: the file endpoint, POST /v1/asr/transcribe (multipart).
//
// Facts used here come from dev.meta.ai documentation (docs/speech-to-text, api-reference/voice/transcribe,
// api-reference/voice/schemas, error-handling, models; read 2026-10-29). Automated tests use a mocked
// endpoint; historical builder-reported live checks are documented separately in docs/VOICE.md:
//   - Authorization: Bearer <key>; optional sessionId query parameter, echoed in the response.
//   - multipart/form-data with a `request` part (JSON, application/json) and an `audio` part (audio/wav).
//   - request fields: model (required), audioEncoding "WAV" (required, no default), mode PUSH_TO_TALK
//     (default) | ENDPOINTING | DIARIZATION, keywords: string[] (bias, no documented limits),
//     languageBias: language names such as "English".
//   - audio: RIFF/WAVE mono 16-bit PCM at 16 or 24 kHz; at most 10 minutes; body at most 32 MB.
//   - 200 application/json: { sessionId, transcript, audioDurationMs, turns } (turns empty in PUSH_TO_TALK).
//   - errors: 400 unsupported WAV / too long / not multipart, 401 invalid key, 402 billing, 403 no
//     permission, 404 unknown path or model, 406 Accept, 413 body, 429 rate limit (Retry-After),
//     500 processing failed, 503 transient, 504 gateway_timeout.
//
// Never logged or returned: the key, request headers, provider error bodies, raw provider responses,
// audio. The key is used only as the Authorization header value.
//
// This is the submission speech path (scripts/muse-live.sh selects SPEECH_PROVIDER=meta). A failure here
// is reported with Meta's HTTP status so the interface can distinguish authentication,
// rate-limit and service failures from the application's own timeout.

import { randomBytes } from 'node:crypto'
import type { SpeechConfig } from './config'
import { type ProviderInput, type SpeechProvider, SpeechAborted, SpeechError } from './provider'

export const META_RESPONSE_LIMIT = 256 * 1024

export interface MetaTranscribeRequest {
  model: string
  audioEncoding: 'WAV'
  mode: 'PUSH_TO_TALK'
  languageBias: string[]
  keywords?: string[]
}

export function metaRequestBody(config: SpeechConfig, hints: string[]): MetaTranscribeRequest {
  const body: MetaTranscribeRequest = { model: config.meta.model, audioEncoding: 'WAV', mode: 'PUSH_TO_TALK', languageBias: ['English'] }
  if (hints.length) body.keywords = hints
  return body
}

/** multipart/form-data with exactly the documented two parts (built by hand so the parts match the curl example). */
export function multipart(request: MetaTranscribeRequest, wav: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----mw-speech-${randomBytes(12).toString('hex')}`
  const head = (name: string, type: string, filename?: string) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ''}\r\nContent-Type: ${type}\r\n\r\n`, 'utf8')
  const body = Buffer.concat([
    head('request', 'application/json'), Buffer.from(JSON.stringify(request), 'utf8'), Buffer.from('\r\n'),
    head('audio', 'audio/wav', 'audio.wav'), wav, Buffer.from('\r\n'),
    Buffer.from(`--${boundary}--\r\n`, 'utf8'),
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

function retryAfter(res: Response): string {
  const h = res.headers.get('retry-after')
  return h !== null && /^\d{1,4}$/.test(h.trim()) ? `try again in about ${h.trim()} s` : 'try again shortly'
}

/** How every Meta transcription error names its source (Meta speech-to-text, never Muse reasoning). */
export const META_STT = 'Meta speech-to-text'
const TYPE = 'Type the request instead.'

/**
 * Map a non-2xx status to a truthful application error that names Meta's actual HTTP status. The provider
 * body is discarded unread. There is no fallback: the learner sees this error and can type the request.
 * A 504 is Meta's own gateway timeout: Meta's error guide advises against an unchanged retry, so it is not
 * retryable and suggests a shorter recording (the application's own deadline is reported by the route).
 */
export function metaStatusError(res: Response): SpeechError {
  const s = res.status
  if (s === 401) return new SpeechError('provider_auth', `${META_STT} rejected the server's API key (HTTP 401). ${TYPE}`, false)
  if (s === 403) return new SpeechError('provider_auth', `${META_STT} denied this key access to the transcription model (HTTP 403). ${TYPE}`, false)
  if (s === 402) return new SpeechError('provider_auth', `${META_STT} reported a billing problem for this account (HTTP 402). ${TYPE}`, false)
  if (s === 429) return new SpeechError('provider_error', `${META_STT} is rate-limiting requests (HTTP 429); ${retryAfter(res)}, or type the request.`, true)
  if (s === 504) return new SpeechError('timeout', `${META_STT} timed out (HTTP 504); nothing was transcribed. Record a shorter request, or type it.`, false)
  if (s === 408) return new SpeechError('timeout', `${META_STT} timed out receiving the recording (HTTP 408); try again, or type the request.`, true)
  if (s === 503) return new SpeechError('provider_error', `${META_STT} is temporarily unavailable (HTTP 503); try again shortly, or type the request.`, true)
  if (s === 404) return new SpeechError('provider_error', `${META_STT} did not find the configured endpoint or model (HTTP 404). ${TYPE}`, false)
  if (s === 400) return new SpeechError('provider_error', `${META_STT} rejected the converted recording (HTTP 400). ${TYPE}`, false)
  if (s >= 500) return new SpeechError('provider_error', `${META_STT} could not process the recording (HTTP ${s}); try again, or type the request.`, true)
  return new SpeechError('provider_error', `${META_STT} rejected the request (HTTP ${s}). ${TYPE}`, false)
}

async function readBounded(res: Response, limit: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        await reader.cancel().catch(() => undefined)
        throw new SpeechError('provider_error', `${META_STT} returned a response above the size limit.`, false)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The documented success body: a transcript string (audioDurationMs and turns are not needed here). */
export function extractTranscript(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const t = (json as { transcript?: unknown }).transcript
  return typeof t === 'string' ? t : null
}

export function metaProvider(config: SpeechConfig, fetchImpl: typeof fetch): SpeechProvider {
  return {
    source: 'meta',
    provider: 'meta-muse-voice-transcribe',
    model: config.meta.model,
    async transcribe(input: ProviderInput): Promise<string> {
      const { signal } = input
      if (!config.apiKey) throw new SpeechError('speech_unavailable', `${META_STT} has no API key configured on this server. ${TYPE}`, false)
      const url = new URL(config.meta.endpoint)
      url.searchParams.set('sessionId', input.requestId)
      const { body, contentType } = multipart(metaRequestBody(config, input.hints), input.wav)
      let res: Response
      try {
        res = await fetchImpl(url.toString(), {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': contentType, Accept: 'application/json' },
          body: new Uint8Array(body),
          signal,
          redirect: 'error',
        })
      } catch {
        if (signal.aborted) throw new SpeechAborted()
        throw new SpeechError('provider_error', `${META_STT} could not be reached (network error, no HTTP status); try again, or type the request.`, true)
      }
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined)
        throw metaStatusError(res)
      }
      let text: string
      try {
        text = await readBounded(res, META_RESPONSE_LIMIT)
      } catch (e) {
        if (signal.aborted) throw new SpeechAborted()
        if (e instanceof SpeechError) throw e
        throw new SpeechError('provider_error', `The ${META_STT} response could not be read completely; try again, or type the request.`, true)
      }
      if (signal.aborted) throw new SpeechAborted()
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch {
        throw new SpeechError('provider_error', `${META_STT} returned a response that is not JSON.`, true)
      }
      const transcript = extractTranscript(json)
      if (transcript === null) throw new SpeechError('provider_error', `${META_STT} returned a response without a transcript.`, true)
      return transcript
    },
  }
}
