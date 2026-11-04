// Meta Model API Responses adapter (POST /v1/responses). Provider translation is isolated here (W7):
// the rest of the service sees a request body, output text, or a ProviderError.
//
// Facts used here come from dev.meta.ai documentation and are NOT yet verified against a live call:
// request fields model / instructions / input / text.format / store / max_output_tokens / reasoning;
// output text in output[] items of type "message", content parts of type "output_text"; refusal parts
// of type "refusal"; status "completed" | "incomplete" | "failed" | ...; error statuses 400, 401, 402,
// 403, 404, 413, 429 (with Retry-After), 500, 503 (with Retry-After), 504 gateway_timeout (not to be
// simply retried).
//
// Never logged or returned: the key, request headers, provider error bodies, raw provider responses.

import type { MuseConfig } from './config'
import type { InputItem } from './prompt'
import { type JsonSchema, SCHEMA_NAME } from './schema'

/** Visible output plus reasoning shares this budget (minimum 16 per the documentation). */
export const MAX_OUTPUT_TOKENS = 8000
/** The Response object echoes instructions and text.format, so allow well above the proposal size. */
export const PROVIDER_BODY_LIMIT = 512 * 1024

export class ProviderError extends Error {
  override name = 'ProviderError'
  constructor(readonly code: string, readonly status: number, message: string, readonly retryable: boolean) {
    super(message)
  }
}

export interface ResponsesRequest {
  model: string
  instructions: string
  input: InputItem[]
  text: { format: { type: 'json_schema'; name: string; schema: JsonSchema; strict: true } }
  store: false
  max_output_tokens: number
  reasoning: { effort: string }
}

/** The Responses request body. The key is not part of it. */
export function buildResponsesRequest(config: MuseConfig, instructions: string, input: InputItem[], schema: JsonSchema): ResponsesRequest {
  return {
    model: config.model,
    instructions,
    input,
    text: { format: { type: 'json_schema', name: SCHEMA_NAME, schema, strict: true } },
    // Nothing is stored server-side; every request resends the authoritative workspace.
    store: false,
    max_output_tokens: MAX_OUTPUT_TOKENS,
    reasoning: { effort: config.reasoningEffort },
  }
}

function retryAfterSeconds(res: Response): number | null {
  const h = res.headers.get('retry-after')
  if (h === null || !/^\d{1,4}$/.test(h.trim())) return null
  return Number(h.trim())
}

/**
 * Map a non-2xx status to a truthful application error. The provider body is discarded unread.
 *
 * Timeouts are kept apart: an upstream 504 gateway_timeout (or 408) is `provider_gateway_timeout` and is NOT
 * retryable as-is (Meta's error guide: do not simply resend; reduce the work per request), while this
 * application's own provider deadline is `provider_timeout` (server/muse/index.ts) and the 45 s application
 * limit is `timeout`. 429 (rate limited, Retry-After) and other 5xx such as 503 (transient, Retry-After) stay
 * retryable.
 */
export function statusError(res: Response): ProviderError {
  const s = res.status
  const unchanged = 'The workspace has not changed.'
  if (s === 401 || s === 403) return new ProviderError('provider_auth', 503, `Meta did not accept the configured access (HTTP ${s}). Check the server's API configuration. ${unchanged}`, false)
  if (s === 402) return new ProviderError('provider_billing', 503, `Meta reported a billing problem for the configured account (HTTP 402). ${unchanged}`, false)
  if (s === 429) {
    const wait = retryAfterSeconds(res)
    return new ProviderError('provider_rate_limited', 429, `Meta is rate-limiting requests${wait !== null ? `; try again in about ${wait} s` : '; try again shortly'}. ${unchanged}`, true)
  }
  if (s === 408 || s === 504) {
    return new ProviderError('provider_gateway_timeout', 504, `Meta timed out ${s === 504 ? 'before Muse finished this request (HTTP 504 gateway timeout)' : 'receiving this request (HTTP 408)'}. ${unchanged} Sending the same request again unchanged is not the remedy; a smaller or simpler request may succeed.`, false)
  }
  if (s === 503) {
    const wait = retryAfterSeconds(res)
    return new ProviderError('provider_unavailable', 502, `Meta is temporarily unavailable (HTTP 503)${wait !== null ? `; try again in about ${wait} s` : '; try again shortly'}. ${unchanged}`, true)
  }
  if (s >= 500) return new ProviderError('provider_unavailable', 502, `Meta could not complete the request (HTTP ${s}). ${unchanged}`, true)
  if (s === 404) return new ProviderError('provider_not_found', 502, `Meta did not find the configured endpoint or model (HTTP 404). ${unchanged}`, false)
  return new ProviderError('provider_rejected', 502, `Meta rejected the request (HTTP ${s}). ${unchanged}`, false)
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
        throw new ProviderError('provider_response_too_large', 502, 'Meta returned a response above the size limit. The workspace has not changed.', false)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Marker thrown when the signal ended the call; the route decides cancellation vs deadline. */
export class ProviderAborted extends Error {
  override name = 'ProviderAborted'
}

/** POST one Responses request and return the parsed JSON body. Throws ProviderError / ProviderAborted. */
export async function postResponses(opts: { config: MuseConfig; body: ResponsesRequest; signal: AbortSignal; fetchImpl: typeof fetch }): Promise<unknown> {
  const { config, body, signal, fetchImpl } = opts
  if (!config.apiKey) throw new ProviderError('assistant_unconfigured', 503, 'Muse is not configured on this server.', false)
  let res: Response
  try {
    res = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal,
      redirect: 'error',
    })
  } catch {
    if (signal.aborted) throw new ProviderAborted()
    throw new ProviderError('provider_network', 502, 'The request to Meta could not be completed (network error). The workspace has not changed.', true)
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined)
    throw statusError(res)
  }
  let text: string
  try {
    text = await readBounded(res, PROVIDER_BODY_LIMIT)
  } catch (e) {
    if (signal.aborted) throw new ProviderAborted()
    if (e instanceof ProviderError) throw e
    throw new ProviderError('provider_network', 502, 'The response from Meta could not be read completely. The workspace has not changed.', true)
  }
  if (signal.aborted) throw new ProviderAborted()
  try {
    return JSON.parse(text)
  } catch {
    throw new ProviderError('provider_malformed', 502, 'Meta returned a response that is not JSON. The workspace has not changed.', true)
  }
}

export type Extracted =
  | { ok: true; text: string }
  | { ok: false; reason: 'refusal' | 'failed' | 'malformed' | 'incomplete' | 'no_text'; detail: string | null }

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Find the output text of a Response object: output[] message items, output_text parts, in order. */
export function extractOutput(data: unknown): Extracted {
  if (!isObj(data) || !Array.isArray(data.output)) return { ok: false, reason: 'malformed', detail: null }
  const status = data.status
  if (status === 'failed') return { ok: false, reason: 'failed', detail: null }
  if (status === 'incomplete') {
    const why = isObj(data.incomplete_details) && typeof data.incomplete_details.reason === 'string' && /^[a-z_]{1,40}$/.test(data.incomplete_details.reason) ? data.incomplete_details.reason : null
    return { ok: false, reason: 'incomplete', detail: why }
  }
  if (status !== undefined && status !== 'completed') return { ok: false, reason: 'malformed', detail: typeof status === 'string' ? status.slice(0, 40) : null }
  const texts: string[] = []
  for (const item of data.output) {
    if (!isObj(item) || item.type !== 'message' || !Array.isArray(item.content)) continue
    for (const part of item.content) {
      if (!isObj(part)) continue
      if (part.type === 'refusal') return { ok: false, reason: 'refusal', detail: null }
      if (part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text)
    }
  }
  if (texts.length === 0) return { ok: false, reason: 'no_text', detail: null }
  return { ok: true, text: texts.join('') }
}
