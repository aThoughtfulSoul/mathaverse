// Server-side Meta Model API configuration (environment only) and the per-process provider status.
// WORKSPACE-AND-AI W7: "configured", "authenticated" and "live-validated" are three distinct facts.
// The key is read here and used only as the Authorization header value (provider.ts). It is never
// logged, returned, hashed into a response or placed in a URL or request body.

import { createHash } from 'node:crypto'

export const DEFAULT_MODEL = 'muse-spark-1.3'
export const DEFAULT_ENDPOINT = 'https://api.meta.ai/v1/responses'
/** dev.meta.ai/docs/protocols/responses lists minimal..xhigh ("none" returns HTTP 400 on Muse Spark);
 * dev.meta.ai/docs/models adds "max" for muse-spark-1.3 (not its -contributor variant). */
export const REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low'

export type Env = Readonly<Record<string, string | undefined>>

export interface MuseConfig {
  /** What /api/assistant answers with: a live call, labelled fixtures, or a truthful 503. */
  mode: 'meta' | 'synthetic' | 'unavailable'
  /** Present only when a key is configured (never serialized). */
  apiKey: string | null
  model: string
  endpoint: string
  reasoningEffort: ReasoningEffort
  /** Why the configuration is unusable (never contains the key). */
  problem: string | null
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

function endpointProblem(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'META_ENDPOINT is not a URL'
  }
  if (url.protocol !== 'https:') return 'META_ENDPOINT must use https'
  if (url.username || url.password) return 'META_ENDPOINT must not contain credentials'
  return null
}

/** Read the configuration from the environment on every call (no caching; a restart is not needed). */
export function readConfig(env: Env = process.env): MuseConfig {
  const forced = (env.MUSE_MODE ?? '').trim()
  // META_API_KEY is this app's name; MODEL_API_KEY is the name used in Meta's documentation examples.
  const key = (env.META_API_KEY || env.MODEL_API_KEY || '').trim()
  const model = (env.META_MODEL ?? '').trim() || DEFAULT_MODEL
  const endpoint = (env.META_ENDPOINT ?? '').trim() || DEFAULT_ENDPOINT
  const effortRaw = (env.META_REASONING_EFFORT ?? '').trim() || DEFAULT_REASONING_EFFORT
  const base = { apiKey: key || null, model, endpoint, reasoningEffort: DEFAULT_REASONING_EFFORT, problem: null }
  const bad = (problem: string): MuseConfig => ({ ...base, mode: 'unavailable', problem })

  if (forced !== '' && forced !== 'auto' && forced !== 'synthetic') return bad('MUSE_MODE must be "auto" or "synthetic"')
  if (!key) return { ...base, mode: 'synthetic' }
  if (/[\s\u0000-\u001f\u007f]/.test(key)) return bad('META_API_KEY contains whitespace or control characters')
  if (!MODEL_RE.test(model)) return bad('META_MODEL is not a valid model identifier')
  const ep = endpointProblem(endpoint)
  if (ep) return bad(ep)
  if (!(REASONING_EFFORTS as readonly string[]).includes(effortRaw)) return bad(`META_REASONING_EFFORT must be one of ${REASONING_EFFORTS.join(', ')}`)
  return { ...base, reasoningEffort: effortRaw as ReasoningEffort, mode: forced === 'synthetic' ? 'synthetic' : 'meta' }
}

/** A key, endpoint and valid model are configured (a live call is possible). */
export function isConfigured(c: MuseConfig): boolean {
  return c.apiKey !== null && c.problem === null
}

/** One-way fingerprint so a status earned with one configuration is not reported for another. */
export function fingerprint(c: MuseConfig): string | null {
  if (!isConfigured(c)) return null
  return createHash('sha256').update(`${c.endpoint}\n${c.model}\n${c.apiKey}`).digest('hex')
}

/** What real provider calls have established in this process, per configuration fingerprint. */
export interface ProviderStatus {
  authenticatedFor: string | null
  liveValidatedFor: string | null
}

export function newStatus(): ProviderStatus {
  return { authenticatedFor: null, liveValidatedFor: null }
}
