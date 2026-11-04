// Record shape of the one-call Meta speech-to-text access check (`zsh scripts/muse-live.sh speech`,
// tests/voice/sttLive.test.ts). Only safe fields: provider, model, transcript, timing, status. Never the key,
// request headers, the provider body or the audio.
//
// The input is always a TEST-UPLOADED recording of synthesized speech (macOS `say`, converted to 16 kHz mono
// 16-bit WAV), sent through the application's own /api/transcribe route code in process. It is NOT a browser
// microphone run: that evidence comes from the app itself (VoiceClient timing/history: input
// "browser-microphone"). The two are told apart by `input.kind`.

import type { ApiResult, SpeechCapability } from '../../server/types'
import type { SpeechConfig } from '../../server/speech/config'
import type { TranscribeResponse } from '../../src/voice/protocol'

/** Real calls only with SPEECH_LIVE=1 and a key in the environment (the speech mode of scripts/muse-live.sh). */
export const STT_LIVE = process.env.SPEECH_LIVE === '1' && !!(process.env.META_API_KEY || process.env.MODEL_API_KEY)

export const TEST_UPLOAD_KIND = 'test-upload-synthesized-speech' as const
export const TEST_UPLOAD_NOTE = 'test-uploaded recording (synthesized speech), not a browser microphone' as const

export interface SttLiveRecord {
  recordedAt: string
  check: 'meta-speech-to-text-access'
  /** True only for a record of a real provider call (records are written only in live mode). */
  live: boolean
  input: {
    kind: typeof TEST_UPLOAD_KIND
    note: typeof TEST_UPLOAD_NOTE
    synthesizer: 'macOS say'
    /** The sentence given to `say`: compare meaning with the transcript, not exact wording. */
    spokenText: string
    mimeType: 'audio/wav'
    format: '16 kHz mono 16-bit PCM WAV'
    bytes: number
    audioMs: number
  }
  route: 'POST /api/transcribe (application route code, called in process)'
  configured: { speechProvider: string; mode: SpeechConfig['mode']; model: string; endpoint: string; problem: string | null }
  httpStatus: number
  outcome: 'transcript' | 'error'
  source: TranscribeResponse['source'] | null
  provider: string | null
  model: string | null
  transcript: string | null
  error: { code: string; message: string; retryable: boolean } | null
  timing: { wallMs: number; audioMs: number | null; providerMs: number | null; serverTotalMs: number | null }
  capabilityAfter: Pick<SpeechCapability, 'mode' | 'model' | 'liveValidated'>
}

export interface SttLiveInput {
  spokenText: string
  bytes: number
  audioMs: number
  config: SpeechConfig
  result: ApiResult
  wallMs: number
  capabilityAfter: SpeechCapability
  live: boolean
  now?: Date
}

/** The record of one check, from the route's result (only the documented response fields are read). */
export function sttRecord(i: SttLiveInput): SttLiveRecord {
  const ok = i.result.status === 200
  const body = (i.result.json ?? {}) as Partial<TranscribeResponse> & { code?: unknown; message?: unknown; retryable?: unknown }
  return {
    recordedAt: (i.now ?? new Date()).toISOString(),
    check: 'meta-speech-to-text-access',
    live: i.live,
    input: { kind: TEST_UPLOAD_KIND, note: TEST_UPLOAD_NOTE, synthesizer: 'macOS say', spokenText: i.spokenText, mimeType: 'audio/wav', format: '16 kHz mono 16-bit PCM WAV', bytes: i.bytes, audioMs: Math.round(i.audioMs) },
    route: 'POST /api/transcribe (application route code, called in process)',
    configured: { speechProvider: i.config.requested, mode: i.config.mode, model: i.config.meta.model, endpoint: i.config.meta.endpoint, problem: i.config.problem },
    httpStatus: i.result.status,
    outcome: ok ? 'transcript' : 'error',
    source: ok && body.source === 'meta' ? body.source : null,
    provider: ok && typeof body.provider === 'string' ? body.provider : null,
    model: ok && typeof body.model === 'string' ? body.model : null,
    transcript: ok && typeof body.transcript === 'string' ? body.transcript : null,
    error: ok ? null : { code: typeof body.code === 'string' ? body.code : `http_${i.result.status}`, message: typeof body.message === 'string' ? body.message : '', retryable: body.retryable === true },
    timing: {
      wallMs: Math.round(i.wallMs),
      audioMs: ok && body.timing ? body.timing.audioMs : null,
      providerMs: ok && body.timing ? body.timing.providerMs : null,
      serverTotalMs: ok && body.timing ? body.timing.totalMs : null,
    },
    capabilityAfter: { mode: i.capabilityAfter.mode, model: i.capabilityAfter.model, liveValidated: i.capabilityAfter.liveValidated },
  }
}

/** The one line the script prints (safe fields only). */
export function sttLine(r: SttLiveRecord): string {
  const { input, httpStatus, outcome, provider, model, transcript, error, timing, capabilityAfter } = r
  return `[speech-live] ${JSON.stringify({ input: input.note, spokenText: input.spokenText, httpStatus, outcome, provider, model, transcript, error, timing, liveValidatedAfter: capabilityAfter.liveValidated })}`
}
