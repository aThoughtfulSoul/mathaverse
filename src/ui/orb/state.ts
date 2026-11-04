// The math glyph orb's state, derived only from the real states of the voice client (src/voice/client.ts) and
// the assistant client (src/assistant/client.ts). Pure: no clients, no timers, no DOM.
//
//   listening     the voice client is recording (its real input level drives the ripple and the core glow)
//   transcribing  the recording was released and the transcript request is in flight
//   thinking      an assistant request is pending (state 'pending'; never while it is only being prepared)
//   applied       a one-shot bloom of APPLIED_BLOOM_MS when an assistant result becomes 'applied' (once per result,
//                 and only while that result is the latest event: a later voice event ends the bloom for good)
//   error         the latest voice or assistant event is an error (the panel text says what failed)
//   idle          anything else
//
// observe() records each client state change in order, and the moment a new applied result was first seen. An
// error dims the orb only while it is the latest event: a voice error followed by a typed request that is applied
// is not an error any more. An applied result that was already there when observation began never blooms, and
// a bloom is timed from the event itself, so an orb shown later never blooms for an old result. Any later event
// (a press on Talk, a recording, a voice error, another assistant state) ends the bloom at once and for good, so
// it never resumes inside its window (re-emitting the same applied result neither restarts nor ends it).

import type { AssistantState } from '../../assistant/client'
import type { VoiceState } from '../../voice/client'

export type OrbPhase = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'applied' | 'error'

export const ORB_PHASES: readonly OrbPhase[] = ['idle', 'listening', 'transcribing', 'thinking', 'applied', 'error']

/** Length of the bloom after an applied result (ms). */
export const APPLIED_BLOOM_MS = 1200

export interface OrbMemory {
  readonly voice: VoiceState
  readonly assistant: AssistantState
  /** The voice client is requesting the microphone (a new utterance has begun). */
  readonly acquiring: boolean
  /** Order of the latest change of each client's state (0: none observed since the start). */
  readonly voiceSeq: number
  readonly assistantSeq: number
  readonly seq: number
  /**
   * The applied result that last started a bloom and when it was first observed (ms). -Infinity: it never blooms
   * (it was already there when observation began, or a later event ended its bloom).
   */
  readonly bloom: { readonly requestId: string; readonly at: number } | null
}

/** The memory at the start of observation: an applied result already present never blooms. */
export function initialMemory(voice: VoiceState, assistant: AssistantState, acquiring = false): OrbMemory {
  return {
    voice, assistant, acquiring, voiceSeq: 0, assistantSeq: 0, seq: 0,
    bloom: assistant.kind === 'applied' ? { requestId: assistant.requestId, at: -Infinity } : null,
  }
}

/**
 * Record the clients' current states. A state counts as a change when it is a different state object (the clients
 * create one per transition; re-emitting the same state is not an event). Returns `m` itself when nothing changed.
 */
export function observe(m: OrbMemory, voice: VoiceState, assistant: AssistantState, acquiring: boolean, now: number): OrbMemory {
  const voiceChanged = voice !== m.voice
  const assistantChanged = assistant !== m.assistant
  const acquiringChanged = acquiring !== m.acquiring
  if (!voiceChanged && !assistantChanged && !acquiringChanged) return m
  let seq = m.seq
  const voiceSeq = voiceChanged ? ++seq : m.voiceSeq
  const assistantSeq = assistantChanged ? ++seq : m.assistantSeq
  let bloom = m.bloom
  const sameResult = assistant.kind === 'applied' && assistant.requestId === bloom?.requestId
  if (assistantChanged && assistant.kind === 'applied' && !sameResult) {
    // A new applied result (the assistant change is the latest event of this observation): a new bloom.
    bloom = { requestId: assistant.requestId, at: now }
  } else if (bloom !== null && bloom.at !== -Infinity && (voiceChanged || acquiringChanged || (assistantChanged && !sameResult))) {
    // A later event: the bloom ends now and never resumes for this result.
    bloom = { requestId: bloom.requestId, at: -Infinity }
  }
  return { voice, assistant, acquiring, voiceSeq, assistantSeq, seq, bloom }
}

/** The orb's phase at time `now` (ms, the clock observe() was given). */
export function orbPhase(m: OrbMemory, now: number): OrbPhase {
  const v = m.voice
  const a = m.assistant
  if (v.kind === 'recording') return 'listening'
  if (v.kind === 'transcribing') return 'transcribing'
  if (a.kind === 'pending') return 'thinking'
  const b = m.bloom
  // Only while the applied result is the latest event (observe() also ends the bloom on any later event).
  if (a.kind === 'applied' && b !== null && b.requestId === a.requestId && m.assistantSeq > m.voiceSeq && now >= b.at && now - b.at < APPLIED_BLOOM_MS) return 'applied'
  // A new utterance has begun (the microphone is being requested): an earlier error is no longer the latest event.
  if (m.acquiring) return 'idle'
  if (v.kind === 'error' && m.voiceSeq >= m.assistantSeq) return 'error'
  if (a.kind === 'error' && m.assistantSeq >= m.voiceSeq) return 'error'
  return 'idle'
}
