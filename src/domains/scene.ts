// The scene contract for the four new demonstrations (FOUR-DEMOS-PARALLEL-HANDOFF sections 2, 9). A scene
// shows a derived description inside the existing host: it is mounted under the workbench (so the grip
// move, the controls and stereo rendering work unchanged), stepped once per host frame, and picked with the
// same rays as everything else. A scene never edits the document: a press returns validated workspace
// actions, which the app commits through the planner (Undo, persistence and the assistant use the same path).
//
// Bench-local frame: metres, +x right, +y up, +z toward the viewer; the bench origin sits about 0.8 m in front
// of a seated viewer at eye height. The spatial controls panel hangs below at y = -0.36, z = 0.17. Keep a
// scene inside roughly x in [-0.5, 0.5], y in [-0.24, 0.32], z in [-0.25, 0.15].

import { Vector3, type Object3D, type Ray } from 'three'
import type { FrameContext } from '../runtime/host'
import type { PlaybackCommand, PlaybackState } from '../rendering/adapter'
import type { SceneLayout, WalkStage } from './inputs'
import type { ScenePresentation } from '../ui/model'

export interface ScenePick {
  /** The pickable object's ID (hover feedback goes through setHover). */
  id: string
  /** Distance along the ray, metres. */
  distance: number
  /** Workspace actions a press proposes (JSON of the closed action vocabulary, docs/INTERFACES.md); [] for none. */
  actions: unknown[]
  /** A press that only controls presentation instead (replay or play/pause of this scene's animation). */
  presentation?: 'replay' | 'toggle'
  /** Short plain words for the status line while hovered ("Apply 1", "Swap lines 0 and 1"). */
  hint?: string
}

/** How a committed change is shown: animate from the previous description, or jump (open, undo of many). */
export type SceneTransition = 'animate' | 'snap'

export interface DomainScene<D> {
  readonly layout: SceneLayout
  /** Build the scene's objects under `parent` (the workbench). Called once. */
  mount(parent: Object3D): void
  setVisible(visible: boolean): void
  /**
   * Show a committed description. The scene keeps the previous one and diffs it to choose motion (a new
   * history step, a rewrite, a regrouping). An apply during an animation first finishes that animation at its
   * exact committed end (edit-during-playback semantics); nothing interpolated is ever treated as exact.
   */
  apply(desc: D, transition: SceneTransition): void
  /** Per frame, before the host renders: advance animation, billboard text toward ctx.head. */
  step(ctx: FrameContext): void
  /** Replay the construction (history, word) from its start, pause/resume, or finish at the end state. */
  setPlayback(cmd: PlaybackCommand): PlaybackState
  /** Optional: seconds per step for the next replay (the `play_steps` action's stepDuration, 0.3-5 s). */
  setStepDuration?(seconds: number): void
  /** Optional (UI refinement): hide the scene's own controls when the shell provides them; show formal
   * annotations only while Show mathematics is open. Objects, paths and stage hit testing stay. */
  setPresentation?(p: ScenePresentation): void
  /** Optional (proof lesson): show one step of the staged explanation. Presentation only: it never edits the
   * document; 'animate' runs that step's construction from the current state, 'snap' shows its settled state. */
  setStage?(stage: WalkStage, transition: SceneTransition): void
  playback(): PlaybackState
  pick(ray: Ray): ScenePick | null
  setHover(id: string | null): void
  /** One plain status line for the controls panel ("C4: applying 1 four times returns every bead"). */
  status(): string
  /** Plain data for verification and docs (positions, clearances, the exact values shown). */
  report(): Record<string, unknown>
  dispose(): void
}

/** The mathematical-to-display embedding E3(x, y, z) = (x, z, -y) used by every 3D view (z up on screen). */
export function embed3(x: number, y: number, z: number, scale = 1, out = new Vector3()): Vector3 {
  return out.set(x * scale, z * scale, -y * scale)
}

/** Idle playback state (no animation). */
export const IDLE_PLAYBACK: PlaybackState = { active: false, playing: false, time: 0, duration: 0, phase: 'idle', step: null }
