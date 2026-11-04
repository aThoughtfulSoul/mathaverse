// Route contract between the coordinator's API mount (server/index.ts) and the service tracks
// (server/muse, server/lean). Handlers receive a parsed JSON body and an abort signal (client
// disconnect or supersession) and return a status plus a JSON body. Errors use { code, message,
// retryable } (WORKSPACE-AND-AI W6). Handlers never return or log secrets or raw provider bodies.

import type { ApiError } from '../src/workspace/actions'

/** Reasons the API mount aborts a handler's signal (route code tells a timeout from a disconnect by these). */
export const ABORT_REASON = { disconnect: 'client disconnected', timeout: 'application timeout' } as const

export interface ApiRequest {
  method: string
  path: string
  /** Parsed JSON (already size-limited by the mount). `undefined` for GET. */
  body: unknown
  /** Aborted when the client disconnects or the application timeout elapses. */
  signal: AbortSignal
}

export interface ApiResult {
  status: number
  json: unknown
}

export type RouteHandler = (req: ApiRequest) => Promise<ApiResult>

export function apiError(status: number, code: string, message: string, retryable = false): ApiResult {
  const json: ApiError = { code, message, retryable }
  return { status, json }
}

/** Assistant status reported by GET /api/capabilities (W7: three distinct statuses). */
export interface AssistantCapability {
  /** An API key and endpoint are configured server-side. */
  configured: boolean
  /** A real authenticated request has succeeded in this process. */
  authenticated: boolean
  /** A real request produced a validated, applicable proposal in this process. */
  liveValidated: boolean
  /** The configured model identifier (from server configuration, never from the client). */
  model: string | null
  /** What /api/assistant will answer with right now. */
  mode: 'meta' | 'synthetic' | 'unavailable'
}

export interface ProofCapability {
  available: boolean
  toolchain: string | null
  templateVersion: string | null
  claimKinds: string[]
}

/** Speech-to-text status reported by GET /api/capabilities (W7 distinctions; voice is a separate adapter). */
export interface SpeechCapability {
  /** A Meta key and the ffmpeg audio converter are configured. */
  configured: boolean
  /** A real transcription has succeeded in this process with this configuration. */
  liveValidated: boolean
  /** What /api/transcribe will use right now. `meta` = Meta speech API. */
  mode: 'meta' | 'unavailable'
  /** Provider and model identifiers (from server configuration, never from the client). */
  provider: string | null
  model: string | null
  /** Recording MIME types the provider path accepts (the browser picks one it can produce). */
  acceptedMimeTypes: string[]
  /** Why speech is unavailable, when it is. */
  problem: string | null
}

/** Request-body limits per route (bytes). Recorded audio needs more room than JSON requests. */
export const BODY_LIMITS: Record<string, number> = { '/api/transcribe': 1536 * 1024 }
export const DEFAULT_BODY_LIMIT = 256 * 1024
