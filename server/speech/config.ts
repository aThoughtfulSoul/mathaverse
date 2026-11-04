// Speech-to-text configuration. Environment values are re-read for every request.
// SPEECH_PROVIDER: auto (default, Meta when a key is present), meta, or off.
// META_API_KEY / MODEL_API_KEY: server-side credential shared with the assistant.
// META_TRANSCRIBE_MODEL: muse-voice-transcribe-1.0 by default; separate from the reasoning model.
// META_TRANSCRIBE_ENDPOINT: https://api.meta.ai/v1/asr/transcribe by default.
// FFMPEG_BIN: optional absolute executable path; otherwise PATH and standard Homebrew locations.
// ffmpeg converts recordings on the server; the Meta API returns their transcripts.

import { createHash } from 'node:crypto'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'

export type Env = Readonly<Record<string, string | undefined>>

export const DEFAULT_META_MODEL = 'muse-voice-transcribe-1.0'
export const DEFAULT_META_ENDPOINT = 'https://api.meta.ai/v1/asr/transcribe'
const FFMPEG_FALLBACKS = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']

export interface SpeechConfig {
  requested: 'auto' | 'meta' | 'off'
  /** What /api/transcribe will use right now. */
  mode: 'meta' | 'unavailable'
  /** Present only when a key is configured (never serialized). */
  apiKey: string | null
  meta: { model: string; endpoint: string }
  ffmpeg: string | null
  /** Why speech is unavailable (never contains the key). */
  problem: string | null
}

/** Filesystem lookups, injectable so configuration tests do not depend on this machine. */
export interface Probe {
  isExecutable(path: string): boolean
}

export const fsProbe: Probe = {
  isExecutable(path) {
    try {
      accessSync(path, constants.X_OK)
      return statSync(path).isFile()
    } catch {
      return false
    }
  },
}

function which(name: string, env: Env, probe: Probe): string | null {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue
    const p = join(dir, name)
    if (probe.isExecutable(p)) return p
  }
  return null
}

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

function endpointProblem(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'META_TRANSCRIBE_ENDPOINT is not a URL'
  }
  if (url.protocol !== 'https:') return 'META_TRANSCRIBE_ENDPOINT must use https'
  if (url.username || url.password) return 'META_TRANSCRIBE_ENDPOINT must not contain credentials'
  return null
}

function findFfmpeg(env: Env, probe: Probe): string | null {
  const explicit = (env.FFMPEG_BIN ?? '').trim()
  if (explicit) return isAbsolute(explicit) && probe.isExecutable(explicit) ? explicit : null
  return which('ffmpeg', env, probe) ?? FFMPEG_FALLBACKS.find((p) => probe.isExecutable(p)) ?? null
}

export function readSpeechConfig(env: Env = process.env, probe: Probe = fsProbe): SpeechConfig {
  const raw = (env.SPEECH_PROVIDER ?? '').trim().toLowerCase() || 'auto'
  const key = (env.META_API_KEY || env.MODEL_API_KEY || '').trim()
  const metaModel = (env.META_TRANSCRIBE_MODEL ?? '').trim() || DEFAULT_META_MODEL
  const endpoint = (env.META_TRANSCRIBE_ENDPOINT ?? '').trim() || DEFAULT_META_ENDPOINT
  const requested = (['auto', 'meta', 'off'] as const).find((r) => r === raw)
  const base: SpeechConfig = { requested: requested ?? 'auto', mode: 'unavailable', apiKey: key || null, meta: { model: metaModel, endpoint }, ffmpeg: null, problem: null }
  const bad = (problem: string): SpeechConfig => ({ ...base, mode: 'unavailable', problem })
  if (!requested) return bad('SPEECH_PROVIDER must be auto, meta or off')
  if (requested === 'off') return bad('speech is turned off on this server (SPEECH_PROVIDER=off)')

  // `auto` enables speech when the required credentials are configured.
  // Missing credentials disable voice; typed requests remain available.
  if (!key) return bad(`Meta speech-to-text is selected (SPEECH_PROVIDER=${requested}) but no META_API_KEY is configured on the server`)
  if (/[\s\u0000-\u001f\u007f]/.test(key)) return bad('META_API_KEY contains whitespace or control characters')
  if (!MODEL_RE.test(metaModel)) return bad('META_TRANSCRIBE_MODEL is not a valid model identifier')
  const ep = endpointProblem(endpoint)
  if (ep) return bad(ep)
  const ffmpeg = findFfmpeg(env, probe)
  if (!ffmpeg) return bad('ffmpeg was not found (it converts recordings to the WAV the Meta file endpoint requires; set FFMPEG_BIN)')
  return { ...base, ffmpeg, mode: 'meta' }
}

/** Provider identifiers reported to clients. */
export function providerOf(c: SpeechConfig): { provider: string; model: string } | null {
  if (c.mode === 'meta') return { provider: 'meta-muse-voice-transcribe', model: c.meta.model }
  return null
}

/** One-way fingerprint so "live-validated" earned with one configuration is not reported for another. */
export function fingerprint(c: SpeechConfig): string | null {
  if (c.mode === 'meta') return createHash('sha256').update(`meta\n${c.meta.endpoint}\n${c.meta.model}\n${c.apiKey}`).digest('hex')
  return null
}

export interface SpeechStatus {
  liveValidatedFor: string | null
}

export function newSpeechStatus(): SpeechStatus {
  return { liveValidatedFor: null }
}
