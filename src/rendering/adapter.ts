// The visual adapter contract (RUNTIME-ADAPTER R3). Application-owned; the manim-web backend in
// manimAdapter.ts implements it. The adapter never creates a canvas, renderer or camera, never
// schedules frames and never submits a render: the host calls step() once per frame before rendering.

import type { Object3D, Ray } from 'three'
import type { FrameContext } from '../runtime/host'
import type { ViewDescription, ViewRole } from './viewDescription'

export interface Capabilities {
  dependency: { name: string; version: string; patched: string[] }
  primitives: string[]
  transitions: string[]
  equations: { kind: 'vector-geometry'; engine: string; limitations: string[] }
  depth: string
  limitations: string[]
}

export type TransitionSpec =
  | { kind: 'apply_map'; /** Seconds of presentation time. */ duration: number }
  /** A branch comparison resolved step by step (input, first operation, second ...), both routes together. */
  | { kind: 'compare_steps'; /** Seconds per step. */ stepDuration: number }

export type PlaybackCommand = 'play' | 'pause' | 'toggle' | 'replay' | 'finish' | { seek: number }

export interface PlaybackState {
  active: boolean
  playing: boolean
  /** Presentation seconds into the transition. */
  time: number
  duration: number
  phase: string
  /** Comparison playback: step 0 = input shown, k = after the k-th operation of each route; null otherwise. */
  step: { index: number; count: number; label: string } | null
}

/** The in-scene voice caption (push-to-talk): plain text, set from application events only. */
export interface VoiceLine {
  text: string
  state: 'recording' | 'pending' | 'transcript' | 'error'
}

export interface PickResult {
  id: string
  sourceId: string
  view: ViewRole
  role: 'handle' | 'select'
  distance: number
}

export interface VisualAdapter {
  mount(parent: Object3D): void
  capabilities(): Capabilities
  prepare(desc: ViewDescription): Promise<{ ok: true } | { ok: false; failures: string[] }>
  apply(desc: ViewDescription, transition?: TransitionSpec): void
  step(ctx: FrameContext): void
  setPlayback(cmd: PlaybackCommand): PlaybackState
  pick(ray: Ray): PickResult | null
  dispose(): void
}
