// The orb's state source: subscribes to the real voice and assistant clients, so every transition is recorded
// when it happens (even while the orb is hidden), and answers the current phase (state.ts) and the recording's
// real input level (VoiceClient.inputLevel). One source serves the desktop and the XR orb.

import type { AssistantState } from '../../assistant/client'
import type { VoiceState } from '../../voice/client'
import { wantsStage } from './placement'
import { type OrbMemory, type OrbPhase, initialMemory, observe, orbPhase } from './state'

/** The parts of VoiceClient the orb reads. */
export interface OrbVoice {
  readonly state: VoiceState
  readonly acquiring: boolean
  subscribe(fn: (s: VoiceState) => void): () => void
  /** The current recording's input level (0..1; 0 when not recording). */
  inputLevel(): number
}

/** The parts of AssistantClient the orb reads. */
export interface OrbAssistant {
  readonly state: AssistantState
  subscribe(fn: (s: AssistantState) => void): () => void
}

export interface OrbSource {
  /** The orb's phase now. */
  phase(): OrbPhase
  /** The recording's real input level (0..1; 0 when not recording). */
  level(): number
  /**
   * The identity of the latest bloom (the applied result's requestId; null: none). OrbMotion starts the bloom
   * overshoot only when it changes. Optional: without it the overshoot starts on each entry into 'applied'.
   */
  bloom?(): string | null
  /**
   * Whether the orb belongs on the stage now (placement.ts wantsStage, before the linger). Optional: without it
   * the orb stays at rest.
   */
  stage?(): boolean
}

export function createOrbSource(o: { voice: OrbVoice; assistant: OrbAssistant; now?: () => number }): OrbSource & { bloom(): string | null; stage(): boolean; dispose(): void } {
  const now = o.now ?? (() => performance.now())
  let mem: OrbMemory = initialMemory(o.voice.state, o.assistant.state, o.voice.acquiring)
  const sync = () => {
    mem = observe(mem, o.voice.state, o.assistant.state, o.voice.acquiring, now())
  }
  const offs = [o.voice.subscribe(sync), o.assistant.subscribe(sync)]
  return {
    phase() {
      sync()
      return orbPhase(mem, now())
    },
    bloom() {
      sync()
      return mem.bloom?.requestId ?? null
    },
    stage() {
      sync()
      return wantsStage(orbPhase(mem, now()), mem.voice, mem.acquiring)
    },
    level() {
      try {
        const v = o.voice.inputLevel()
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
      } catch {
        return 0
      }
    },
    dispose() {
      for (const off of offs.splice(0)) off()
    },
  }
}
