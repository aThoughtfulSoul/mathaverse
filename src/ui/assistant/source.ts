// Service status and provenance wording of the Ask Meta Muse AI inspector (UI-REFINEMENT-SPEC section 7).
// Source status comes only from GET /api/capabilities; a returned answer is labelled with the provenance of
// its own response envelope (source + model), never with the configured mode. Meta speech transcription is labelled
// separately from the assistant reasoning response. No credential ever reaches these strings: the
// capability record carries none.

import type { AssistantResponse } from '../../workspace/actions'
import type { TranscribeResponse } from '../../voice/protocol'
import type { VoiceState } from '../../voice/client'
import type { AssistantPanelInput } from '../model'

/** The spec's source-status vocabulary (plus a transient "checking" while capabilities load). */
export const SOURCE_LABEL = {
  notConfigured: 'Not configured',
  synthetic: 'Synthetic demo',
  unverified: 'Configured · live call unverified',
  /** Only when the server reports liveValidated (a real request produced a validated proposal). */
  verified: 'Configured · live call verified',
  unavailable: 'Unavailable',
  checking: 'Checking service…',
} as const

/** Beside every synthetic answer (spec section 7, exact wording). */
export const SYNTHETIC_ANSWER_LABEL = 'Synthetic demo · not a live Meta response'
/** Beside an answer whose envelope says it came from a real Meta call. */
export const LIVE_ANSWER_LABEL = 'Live Meta response'

export type SourceKind = 'synthetic' | 'live-unverified' | 'live-verified' | 'unavailable' | 'checking'

export interface SourceStatus {
  /** Primary status (SOURCE_LABEL vocabulary). */
  label: string
  /** A second status from the same vocabulary, e.g. "Not configured" beside "Synthetic demo". */
  secondary: string | null
  /** One plain sentence: what answers will be and why. */
  detail: string
  kind: SourceKind
  /** A request can reach a responder (labelled fixtures or a configured live model). */
  canAsk: boolean
  /** Answers come from prepared, labelled fixtures. */
  synthetic: boolean
}

export function sourceStatus(cap: AssistantPanelInput['capability']): SourceStatus {
  if (cap === null) {
    return { label: SOURCE_LABEL.checking, secondary: null, detail: 'Loading the assistant status from the server.', kind: 'checking', canAsk: true, synthetic: false }
  }
  const a = cap.assistant
  if (!a) {
    return {
      label: SOURCE_LABEL.unavailable,
      secondary: null,
      detail: 'The assistant status could not be loaded, so a request may fail. The mathematical controls still work.',
      kind: 'unavailable',
      canAsk: true,
      synthetic: false,
    }
  }
  if (a.mode === 'unavailable') {
    return {
      label: SOURCE_LABEL.unavailable,
      secondary: a.configured ? null : SOURCE_LABEL.notConfigured,
      detail: 'The assistant service is unavailable on this server (its configuration, or its status, could not be used), so no request can be answered. The mathematical controls still work.',
      kind: 'unavailable',
      canAsk: false,
      synthetic: false,
    }
  }
  if (a.mode === 'synthetic') {
    return {
      label: SOURCE_LABEL.synthetic,
      secondary: a.configured ? null : SOURCE_LABEL.notConfigured,
      detail: a.configured
        ? 'Live calls are switched off on this server. Answers are prepared, labelled examples.'
        : 'Answers are prepared, labelled examples, not live Meta responses.',
      kind: 'synthetic',
      canAsk: true,
      synthetic: true,
    }
  }
  const model = a.model ? `Model ${a.model}. ` : ''
  return a.liveValidated
    ? { label: SOURCE_LABEL.verified, secondary: null, detail: `${model}A live request succeeded on this server in this session.`, kind: 'live-verified', canAsk: true, synthetic: false }
    : { label: SOURCE_LABEL.unverified, secondary: null, detail: `${model}No live request has succeeded yet in this session.`, kind: 'live-unverified', canAsk: true, synthetic: false }
}

export interface Provenance {
  /** Shown beside the answer. */
  label: string
  /** Model / fixture and timing, when known. */
  detail: string
  /** Only true for a response envelope whose source is a real Meta call. */
  live: boolean
}

/** The provenance of one response envelope. Synthetic output is never presented as live. */
export function responseProvenance(r: AssistantResponse): Provenance {
  if (r.source === 'meta') {
    const secs = Number.isFinite(r.timing?.totalMs) ? ` · ${(r.timing.totalMs / 1000).toFixed(1)} s` : ''
    return { label: LIVE_ANSWER_LABEL, detail: `${r.model}${secs}`, live: true }
  }
  const fixture = r.model.startsWith('synthetic:') ? r.model.slice('synthetic:'.length) : r.model
  return { label: SYNTHETIC_ANSWER_LABEL, detail: `Prepared fixture “${fixture}”`, live: false }
}

export interface SpeechStatus {
  /** "Voice: Meta speech-to-text transcription"; separate from the assistant answer. */
  label: string
  detail: string
  available: boolean
}

/**
 * Where a transcript comes from: Meta speech-to-text with its model.
 * A transcript is speech-to-text output, labelled apart from Muse reasoning: it never says "Muse" beyond the
 * transcription model's own identifier.
 */
export function transcriptProvenance(r: TranscribeResponse): string {
  return `Meta transcription · ${r.model}`
}

export function speechStatus(input: Pick<AssistantPanelInput, 'capability' | 'voice'>): SpeechStatus {
  const v: VoiceState = input.voice
  const cap = input.capability?.speech ?? null
  if (v.kind === 'unavailable') return { label: 'Voice unavailable', detail: `${v.reason}. Type the question instead.`, available: false }
  if (!cap) return { label: 'Voice', detail: input.capability === null ? 'Checking the speech service…' : 'The speech service status is unknown.', available: true }
  if (cap.mode === 'unavailable') return { label: 'Voice unavailable', detail: `${cap.problem ?? 'speech is not configured on the server'}. Type the question instead.`, available: false }
  // "live call unverified" stays until the server reports a real Meta transcription in this process.
  return {
    label: `Voice: Meta speech-to-text transcription${cap.liveValidated ? '' : ' · live call unverified'}`,
    detail: `${cap.model ? `${cap.model}, ` : ''}called by the server. Transcription only, separate from the assistant's answer; you see the text before it is sent.`,
    available: true,
  }
}
