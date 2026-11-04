// Where the orb sits: 'rest' (small: the assistant panel's header on the desktop, above the inspector's corner in
// XR) or 'stage' (grown: the voice area on the desktop, beside the panel in XR) while the assistant is working
// with the learner's words. Pure: the caller passes the clock.
//
//   stage   the microphone is being requested, a recording, a transcription, a transcript waiting to be sent
//           (desktop Send, or the XR auto-send countdown), a pending request, or the applied bloom
//   rest    anything else (idle, error)
//
// Leaving the stage waits STAGE_LINGER_MS, so the hand-offs between those states (transcribing -> transcript ->
// submitted -> pending) never send the orb back and forth, and a voice error is seen on the stage before the orb
// returns. Entering the stage is immediate.

import type { VoiceState } from '../../voice/client'
import type { OrbPhase } from './state'

export type OrbPlace = 'rest' | 'stage'

/** How long the orb stays on the stage after the last moment it was wanted there (ms). */
export const STAGE_LINGER_MS = 900

/** The phases drawn on the stage. */
const STAGE_PHASES: ReadonlySet<OrbPhase> = new Set<OrbPhase>(['listening', 'transcribing', 'thinking', 'applied'])

/** Whether the orb belongs on the stage now (before the linger). */
export function wantsStage(phase: OrbPhase, voice: Pick<VoiceState, 'kind'>, acquiring: boolean): boolean {
  return acquiring || voice.kind === 'transcript' || STAGE_PHASES.has(phase)
}

/** The orb's place over time: immediate entry, delayed exit. One per orb (the desktop and the XR orb each own one). */
export class OrbPlacement {
  private placeNow: OrbPlace = 'rest'
  private lastWanted = -Infinity

  constructor(private readonly linger = STAGE_LINGER_MS) {}

  get place(): OrbPlace {
    return this.placeNow
  }

  /** Record whether the stage is wanted at `now` (ms) and return the place to draw. */
  update(wanted: boolean, now: number): OrbPlace {
    if (wanted) {
      this.lastWanted = now
      this.placeNow = 'stage'
    } else if (this.placeNow === 'stage' && now - this.lastWanted >= this.linger) {
      this.placeNow = 'rest'
    }
    return this.placeNow
  }

  /** Take the current place at once (an orb shown again after being hidden: no linger from an old stage). */
  snap(wanted: boolean, now: number): OrbPlace {
    this.placeNow = wanted ? 'stage' : 'rest'
    this.lastWanted = wanted ? now : -Infinity
    return this.placeNow
  }
}
