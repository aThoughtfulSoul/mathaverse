// The pure view of the Ask Meta Muse AI inspector, shared by the desktop and spatial content
// (UI-REFINEMENT-SPEC section 7, "Request and voice lifecycle"). It reads only AssistantPanelInput (the
// clients' actual states, capabilities, the draft and the document) and returns what to show and the exact
// UiCommand each control dispatches. No timers, no DOM, no clients: the request lifecycle, cancellation and
// stale-proposal protection stay in src/assistant/client.ts and src/voice/client.ts.
//
// Two independent lines are derived: the REQUEST (the latest exchange with the assistant) and VOICE (local
// push-to-talk capture and transcription). The overall `phase` follows the lifecycle table: an active voice
// stage first (recording, transcribing, transcript ready), then the request (pending, applied/answered,
// stale/rejected, error/canceled), then a finished voice error/cancel, else idle.
//
// An answer about a reordered walk endpoint carries the application-computed facts block (answerFacts.ts),
// scoped to the endpoint and input it concerned and marked historical once they change. An applied (or
// answered) proposal with request_check carries a live check line that follows the evidence entry its check
// created (checkStatus.ts): requested, running, then checked / not established / error, historical once the
// inputs change, and never "checked" before the evidence store says so. A failed request
// offers Retry only when resending the same text may succeed: an upstream Meta gateway timeout offers Edit
// (a smaller new request) instead (src/assistant/client.ts errorRemedy).

import { talkLabelFor } from '../../voice/client'
import { type AssistantState, errorRemedy } from '../../assistant/client'
import type { AssistantPanelInput, UiCommand } from '../model'
import { type AnswerFactsView, answerFacts } from './answerFacts'
import { type AnswerCheckView, answerCheck } from './checkStatus'
import { type Provenance, type SourceStatus, type SpeechStatus, responseProvenance, sourceStatus, speechStatus, transcriptProvenance } from './source'
import { type Suggestion, emptySuggestionHint, suggestionsFor } from './suggestions'

export type AssistantPhase = 'idle' | 'recording' | 'transcribing' | 'transcript' | 'pending' | 'applied' | 'answered' | 'stale' | 'rejected' | 'error' | 'canceled'

export type Tone = 'neutral' | 'busy' | 'ok' | 'warning' | 'error'

export interface ViewButton {
  id: string
  label: string
  ariaLabel: string
  command: UiCommand
  /** Why it is offered but not usable now (shown as its title; it keeps its place, so nothing shifts). Absent: usable. */
  disabled?: string
}

export interface ExchangeView {
  kind: Exclude<AssistantState['kind'], 'idle'>
  /** "Thinking…", "Applied", "Answered", "Not applied", "Request failed", "Canceled". */
  heading: string
  /** One short sentence: the reason or what happened to the workspace. */
  reason: string | null
  tone: Tone
  /** The actual submitted question. */
  question: string
  title: string | null
  explanation: string | null
  /** The validated change summary of an applied proposal. */
  changes: string[]
  /** Application-computed facts about the reordered walk endpoint the answer concerns (never the model's
   * numbers; historical when the walk or the selected endpoint changed since). Null for any other answer. */
  facts: AnswerFactsView | null
  /** The Lean check this proposal requested, from the app's evidence store (null when it requested none). */
  check: AnswerCheckView | null
  /** Provenance of the response envelope (null while pending, on error and cancel). */
  provenance: Provenance | null
  /** e.g. Undo stays in the toolbar. */
  note: string | null
  actions: ViewButton[]
}

export interface MicView {
  /** record: start; stop: stop recording; cancel: cancel the microphone request or transcription; off: disabled. */
  mode: 'record' | 'stop' | 'cancel' | 'off'
  label: string
  ariaLabel: string
  enabled: boolean
  reason: string | null
}

export interface TranscriptView {
  text: string
  /** Identity of this transcript (a field is filled once per transcript, then keeps the learner's edits). */
  requestId: string
  /** XR auto-submit time (performance.now() ms), or null when it waits for Send. */
  autoSubmitAt: number | null
  limitReached: boolean
  /** "Meta transcription · muse-voice-transcribe-1.0": separate from Muse reasoning output. */
  source: string
}

export interface VoiceView {
  phase: 'idle' | 'acquiring' | 'recording' | 'transcribing' | 'transcript' | 'submitted' | 'error' | 'canceled' | 'unavailable'
  /** Status line near the voice controls (null when nothing to say). */
  status: string | null
  tone: Tone
  /** performance.now() at the recording start (renderers show the elapsed time). */
  recordingStartedAt: number | null
  transcript: TranscriptView | null
  /** Desktop microphone control (hold to talk, or press to start and again to stop). */
  mic: MicView
  /** Desktop: the separate Cancel while recording (Stop keeps the audio, Cancel discards it). */
  cancel: ViewButton | null
  /** XR: the single Talk control (press to record, press to stop, press to cancel while sending). */
  talk: { label: 'Talk' | 'Stop' | 'Cancel' | 'No voice'; enabled: boolean; hint: string; command: UiCommand }
  /** XR: a short line beside an idle Talk ("or hold A or X to talk"); null otherwise and on the desktop. */
  holdHint: string | null
  /** XR: Cancel beside Stop while recording, and beside the auto-submit countdown. */
  xrCancel: ViewButton | null
  /** Send the transcript now (desktop Send; XR "Send now" during the countdown). */
  send: ViewButton | null
}

export interface AssistantView {
  surface: 'desktop' | 'xr'
  phase: AssistantPhase
  /** The phase in one short line ("Listening…", "Transcribing…", "Thinking…", "Applied"). */
  status: { text: string; tone: Tone }
  source: SourceStatus
  speech: SpeechStatus
  /** Shown when nothing is in progress (empty otherwise or when none is usable). */
  suggestions: Suggestion[]
  /** At rest with no usable suggestion: what to do instead (null otherwise). */
  suggestionHint: string | null
  exchange: ExchangeView | null
  voice: VoiceView
  /** Desktop question field: hidden while a transcript is being corrected (one field, one Send at a time). */
  input: { visible: boolean; enabled: boolean; reason: string | null; draft: string; sendEnabled: boolean }
}

export const QUESTION_FIELD_NAME = 'Question for Meta Muse AI'
export const QUESTION_PLACEHOLDER = 'Ask about this experiment…'
export const MIC_RECORD_NAME = 'Record a question for Meta Muse AI'
/** Why Edit question is disabled while the question field holds a draft. */
export const EDIT_WITH_DRAFT = 'Clear the question field to put this question back into it'
/** XR Talk: hold A or X on a controller to talk (a tap keeps play / pause), or press Talk to start and stop. */
export const TALK_HINT_XR = 'Hold A or X to talk, or press Talk to start and stop'
export const HOLD_HINT_XR = 'or hold A or X to talk'
/** The XR recording status: a recording started by holding A or X ends on release, one started with Talk on Stop. */
export const XR_RECORDING_STATUS = 'Listening… press Stop or release A/X when you are done'
/** XR wording for a too-short recording, refused by the voice client (too_short) or by the speech route (no_speech):
 * their "Hold Talk" advice is the desktop control's (the XR Talk control toggles; the hold is on A or X). */
export const XR_TOO_SHORT_STATUS = 'That recording was too short. Hold A or X while you speak, or press Talk to start and stop.'

/** Whether a voice error is a too-short recording with the desktop's advice: the voice client's too_short, or the
 * speech route's 422 no_speech for decoded audio under its minimum ("too short; hold Talk while speaking",
 * server/speech/index.ts). The route's other no_speech refusals (silent, nothing recognized) are not. */
const desktopTooShort = (v: { code: string; message: string }) =>
  /too short/i.test(v.message) && (v.code === 'too_short' || (v.code === 'no_speech' && /hold Talk/i.test(v.message)))

/** The voice error line: the voice client's message (a route error's own message), except a too-short recording in
 * XR (XR_TOO_SHORT_STATUS). The other too_short case, a release before the microphone was ready, already says
 * "Press Talk again" and is kept. */
function voiceErrorStatus(v: { code: string; message: string }, xr: boolean): string {
  return xr && desktopTooShort(v) ? XR_TOO_SHORT_STATUS : v.message
}

const A = (action: Extract<UiCommand, { kind: 'assistant' }>['action']): UiCommand => ({ kind: 'assistant', action })

const quote = (t: string) => `“${t}”`

const short = (t: string, n = 220) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)

/** The server's message, ending with "Nothing changed." unless it already says what changed. */
const unchangedReason = (message: string) => {
  const m = short(message)
  return /changed/i.test(m) ? m : `${m.replace(/\.?$/, '.')} Nothing changed.`
}

/** Error code -> a short, honest sentence (nothing changed on error). */
function errorReason(code: string, message: string, xr: boolean): { heading: string; reason: string } {
  switch (code) {
    case 'synthetic_no_fixture':
      return { heading: 'No prepared reply', reason: 'The synthetic demo has no prepared reply for this question, so nothing changed. Try a suggested question.' }
    case 'network':
      return { heading: 'Request failed', reason: 'The assistant service could not be reached. Nothing changed.' }
    case 'proposal_rejected':
      return { heading: 'Not applied', reason: short(message) }
    case 'prompt_too_long':
      return { heading: 'Question too long', reason: short(message) }
    // Upstream Meta 504/408: an unchanged resend is not the remedy, a smaller new request may be.
    case 'provider_gateway_timeout': {
      const http = /HTTP (\d{3})/.exec(message)?.[1]
      return {
        heading: 'Timed out at Meta',
        reason: xr
          ? `Ask a smaller question with Talk or a suggestion. Meta timed out${http ? ` (HTTP ${http})` : ''}; nothing changed.`
          : `Meta timed out${http ? ` (HTTP ${http})` : ''}, so the scene did not change. Sending the same question again is not advised; edit it into a smaller or simpler question and send that.`,
      }
    }
    // This application's own limits (the 40 s provider deadline, the 45 s request limit).
    case 'provider_timeout':
    case 'timeout':
      return { heading: 'No answer in time', reason: unchangedReason(message) }
    case 'provider_rate_limited':
      return { heading: 'Rate limited', reason: unchangedReason(message) }
    case 'provider_unavailable':
      return { heading: 'Meta unavailable', reason: unchangedReason(message) }
    default:
      return { heading: 'Request failed', reason: unchangedReason(message) }
  }
}

function exchangeView(input: AssistantPanelInput, xr: boolean): ExchangeView | null {
  const s = input.assistant
  if (s.kind === 'idle') return null
  const retry: ViewButton = { id: 'retry', label: 'Retry', ariaLabel: 'Retry: send the question again', command: A({ kind: 'retry' }) }
  // Recoverable input (desktop only: XR has no text field): put the question back into the empty field. While the
  // learner has a draft it stays, disabled (a draft is never overwritten, and the answer keeps its height as typing
  // starts).
  const edit: ViewButton | null = xr ? null : {
    id: 'edit', label: 'Edit question', ariaLabel: 'Edit the question in the question field', command: A({ kind: 'draft', text: s.prompt }),
    ...(input.draft.trim() === '' ? {} : { disabled: EDIT_WITH_DRAFT }),
  }
  const withEdit = (b: ViewButton[]) => (edit ? [...b, edit] : b)
  const base = { question: s.prompt, title: null, explanation: null, changes: [] as string[], facts: null, check: null, provenance: null, note: null }
  const check = answerCheck(s, input.checkLink, input.evidence ?? [])
  switch (s.kind) {
    case 'pending':
      return { ...base, kind: 'pending', heading: 'Thinking…', reason: null, tone: 'busy', actions: [{ id: 'cancel', label: 'Cancel', ariaLabel: 'Cancel the request', command: A({ kind: 'cancel' }) }] }
    case 'applied':
      return {
        ...base, kind: 'applied', heading: 'Applied', reason: null, tone: 'ok',
        title: s.response.proposal.title, explanation: s.response.proposal.explanation || null,
        changes: s.summary, facts: answerFacts(s, input.doc), check, provenance: responseProvenance(s.response),
        note: 'Undo in the toolbar reverses this change.', actions: [],
      }
    case 'answered':
      return {
        ...base, kind: 'answered', heading: 'Answered', reason: 'The scene did not change.', tone: 'ok',
        title: s.response.proposal.title, explanation: s.response.proposal.explanation || null,
        facts: answerFacts(s, input.doc), check, provenance: responseProvenance(s.response), actions: [],
      }
    case 'stale':
      return {
        ...base, kind: 'stale', heading: 'Not applied', reason: `${s.reason.charAt(0).toUpperCase()}${s.reason.slice(1)}, so nothing was applied. The explanation is kept below.`, tone: 'warning',
        title: s.response.proposal.title, explanation: s.response.proposal.explanation || null,
        facts: answerFacts(s, input.doc), provenance: responseProvenance(s.response), actions: [retry],
      }
    case 'rejected':
      return {
        ...base, kind: 'rejected', heading: 'Not applied', reason: `The proposal failed validation (${short(s.reason, 160)}). Nothing changed.`, tone: 'warning',
        title: s.response.proposal.title, explanation: s.response.proposal.explanation || null,
        facts: answerFacts(s, input.doc), provenance: responseProvenance(s.response),
        // A prepared fixture answers the same way again; a live model may not.
        actions: withEdit(s.response.source === 'meta' ? [retry] : []),
      }
    case 'error': {
      const r = errorReason(s.error.code, s.error.message, xr)
      const remedy = errorRemedy(s.error)
      // An upstream gateway timeout offers no Retry of the same text: only Edit, to send a smaller new request.
      const editSmaller: ViewButton | null = edit && remedy === 'smaller' ? { ...edit, ariaLabel: 'Edit the question to send a smaller or simpler new request' } : null
      const actions = remedy === 'retry' ? withEdit([retry]) : remedy === 'smaller' ? (editSmaller ? [editSmaller] : []) : withEdit([])
      return { ...base, kind: 'error', heading: r.heading, reason: r.reason, tone: 'error', actions }
    }
    case 'canceled':
      return { ...base, kind: 'canceled', heading: 'Canceled', reason: 'Nothing was applied.', tone: 'neutral', actions: withEdit([retry]) }
  }
}

function voiceView(input: AssistantPanelInput, canAsk: boolean, speech: SpeechStatus): VoiceView {
  const v = input.voice
  const acquiring = input.voiceAcquiring
  const xr = input.surface === 'xr'
  const toggle = A({ kind: 'voiceToggle' })
  const talkLabel = !canAsk && !(acquiring || v.kind === 'recording' || v.kind === 'transcribing') ? 'No voice' : talkLabelFor(v, acquiring)
  const talkHint =
    talkLabel === 'No voice' ? (v.kind === 'unavailable' ? `Voice unavailable: ${v.reason}` : 'Meta Muse AI is unavailable')
    : talkLabel === 'Stop' ? 'Stop recording and transcribe'
    : talkLabel === 'Cancel' ? 'Cancel: nothing is sent'
    : xr ? TALK_HINT_XR
    : 'Record a question for Meta Muse AI (press again to stop)'
  const talk = { label: talkLabel, enabled: talkLabel !== 'No voice', hint: talkHint, command: toggle }
  const holdHint = xr && talkLabel === 'Talk' ? HOLD_HINT_XR : null
  const off = (reason: string): MicView => ({ mode: 'off', label: 'Record', ariaLabel: MIC_RECORD_NAME, enabled: false, reason })
  const record: MicView = canAsk ? { mode: 'record', label: 'Record', ariaLabel: MIC_RECORD_NAME, enabled: true, reason: null } : off('Meta Muse AI is unavailable')
  const cancelBtn = (aria: string): ViewButton => ({ id: 'voiceCancel', label: 'Cancel', ariaLabel: aria, command: A({ kind: 'voiceCancel' }) })
  const base = { recordingStartedAt: null, transcript: null, cancel: null, xrCancel: null, send: null, talk, holdHint }
  if (acquiring) {
    return { ...base, phase: 'acquiring', status: 'Waiting for the microphone… (allow it in the browser prompt)', tone: 'busy', mic: { mode: 'cancel', label: 'Cancel', ariaLabel: 'Cancel', enabled: true, reason: null }, xrCancel: null }
  }
  switch (v.kind) {
    case 'unavailable':
      return { ...base, phase: 'unavailable', status: null, tone: 'neutral', mic: off(speech.detail) }
    case 'recording':
      return {
        ...base, phase: 'recording', status: xr ? XR_RECORDING_STATUS : 'Listening… release, or press Stop, when you are done', tone: 'busy',
        recordingStartedAt: v.startedAt,
        mic: { mode: 'stop', label: 'Stop', ariaLabel: 'Stop recording', enabled: true, reason: null },
        cancel: cancelBtn('Cancel recording'), xrCancel: cancelBtn('Cancel recording'),
      }
    case 'transcribing':
      return {
        ...base, phase: 'transcribing', tone: 'busy',
        status: `Transcribing ${(v.durationMs / 1000).toFixed(1)} s of audio…${v.limitReached ? ' (stopped at the recording limit)' : ''}`,
        mic: { mode: 'cancel', label: 'Cancel', ariaLabel: 'Cancel', enabled: true, reason: null },
      }
    case 'transcript': {
      const auto = v.autoSubmitAt !== null
      const t: TranscriptView = { text: v.text, requestId: v.response.requestId, autoSubmitAt: v.autoSubmitAt, limitReached: !!v.limitReached, source: transcriptProvenance(v.response) }
      return {
        ...base, phase: 'transcript', tone: 'neutral',
        status: xr
          ? auto ? 'Sending your question… press Cancel to stop' : 'Check the transcript, then Send'
          : `${v.limitReached ? 'Recording stopped at the length limit. ' : ''}Check the transcript, correct it if needed, then Send.`,
        transcript: t,
        mic: record,
        cancel: cancelBtn('Discard the transcript'),
        xrCancel: cancelBtn('Cancel: do not send the transcript'),
        send: canAsk ? { id: 'transcriptSend', label: xr && auto ? 'Send now' : 'Send', ariaLabel: 'Send the transcript to Meta Muse AI', command: A({ kind: 'transcriptSubmit' }) } : null,
      }
    }
    case 'error':
      return { ...base, phase: 'error', status: voiceErrorStatus(v, xr), tone: 'error', mic: record }
    case 'canceled':
      return { ...base, phase: 'canceled', status: 'Voice canceled · nothing was sent.', tone: 'neutral', mic: record }
    case 'submitted':
      return { ...base, phase: 'submitted', status: null, tone: 'neutral', mic: record }
    default:
      return { ...base, phase: 'idle', status: null, tone: 'neutral', mic: record }
  }
}

const PHASE_STATUS: Record<AssistantPhase, { text: string; tone: Tone }> = {
  idle: { text: 'Ready', tone: 'neutral' },
  recording: { text: 'Listening…', tone: 'busy' },
  transcribing: { text: 'Transcribing…', tone: 'busy' },
  transcript: { text: 'Transcript ready', tone: 'neutral' },
  pending: { text: 'Thinking…', tone: 'busy' },
  applied: { text: 'Applied', tone: 'ok' },
  answered: { text: 'Answered', tone: 'ok' },
  stale: { text: 'Not applied', tone: 'warning' },
  rejected: { text: 'Not applied', tone: 'warning' },
  error: { text: 'Error', tone: 'error' },
  canceled: { text: 'Canceled', tone: 'neutral' },
}

/** The lifecycle phase (spec section 7 table) from the clients' actual states. */
export function phaseOf(input: Pick<AssistantPanelInput, 'assistant' | 'voice' | 'voiceAcquiring'>): AssistantPhase {
  const v = input.voice
  if (input.voiceAcquiring || v.kind === 'recording') return 'recording'
  if (v.kind === 'transcribing') return 'transcribing'
  if (v.kind === 'transcript') return 'transcript'
  const a = input.assistant
  if (a.kind !== 'idle') return a.kind
  if (v.kind === 'error') return 'error'
  if (v.kind === 'canceled') return 'canceled'
  return 'idle'
}

const AT_REST: ReadonlySet<AssistantPhase> = new Set(['idle', 'applied', 'answered', 'stale', 'rejected', 'error', 'canceled'])

export function assistantView(input: AssistantPanelInput): AssistantView {
  const xr = input.surface === 'xr'
  const source = sourceStatus(input.capability)
  const speech = speechStatus(input)
  const phase = phaseOf(input)
  const exchange = exchangeView(input, xr)
  const voice = voiceView(input, source.canAsk, speech)
  let status = PHASE_STATUS[phase]
  if (phase === 'recording' && input.voiceAcquiring) status = { text: 'Waiting for the microphone…', tone: 'busy' }
  else if ((phase === 'error' || phase === 'canceled') && exchange === null) status = { text: phase === 'error' ? 'Voice error' : 'Voice canceled', tone: phase === 'error' ? 'error' : 'neutral' }
  else if (exchange && phase === exchange.kind) status = { text: exchange.heading, tone: exchange.tone }
  // Suggestions whenever nothing is in progress (they are real requests: never while one is pending).
  const suggestions = source.canAsk && AT_REST.has(phase) ? suggestionsFor(input) : []
  const suggestionHint = source.canAsk && AT_REST.has(phase) && !suggestions.length ? emptySuggestionHint(input) : null
  const enabled = source.canAsk
  return {
    surface: input.surface,
    phase,
    status,
    source,
    speech,
    suggestions,
    suggestionHint,
    exchange,
    voice,
    input: {
      visible: !xr && phase !== 'transcript',
      enabled,
      reason: enabled ? null : 'Meta Muse AI is unavailable on this server',
      draft: input.draft,
      sendEnabled: enabled && input.draft.trim().length > 0,
    },
  }
}

export { quote }
