// Step playback of a branch comparison (TransitionSpec 'compare_steps'): the timeline and the presented
// path of one step. Pure presentation arithmetic in display floats; every step boundary shows the exact
// committed endpoint (the description's stage positions), never a trigonometric approximation of it.

import type { StepMotion } from './viewDescription'

/** Fractions of one step's duration: the input is held first, then each step moves and then holds its result. */
export const COMPARE_TIMING = { inputHold: 0.5, motion: 0.7 } as const
export const DEFAULT_STEP_DURATION = 1.6

/** Total presentation seconds for `count` steps (both routes play together; the longer one sets the count). */
export function compareDuration(count: number, stepDuration: number): number {
  return stepDuration * (COMPARE_TIMING.inputHold + count)
}

export interface CompareClock {
  /** 0 = the input is shown; k = the k-th map of each route is applied (moving, then holding its result). */
  index: number
  /** Linear progress of step `index`'s motion, 0..1 (1 while holding; 0 at the input). */
  alpha: number
  /** The step's exact result is on show (its motion is complete), or the input is held. */
  holding: boolean
}

export function compareClock(count: number, stepDuration: number, t: number): CompareClock {
  const t0 = stepDuration * COMPARE_TIMING.inputHold
  if (count === 0 || t < t0) return { index: 0, alpha: 0, holding: true }
  const k = Math.min(count, Math.floor((t - t0) / stepDuration) + 1)
  const local = t - t0 - (k - 1) * stepDuration
  const alpha = Math.min(1, Math.max(0, local / (stepDuration * COMPARE_TIMING.motion)))
  return { index: k, alpha, holding: alpha >= 1 }
}

type V3 = [number, number, number]

/** `p` rotated by `angle` about mathematical axis 0/1/2 (right-hand rule, matching the rotation presets). */
export function rotateAbout(p: readonly number[], axis: 0 | 1 | 2, angle: number): V3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const x = p[0] ?? 0
  const y = p[1] ?? 0
  const z = p[2] ?? 0
  if (axis === 0) return [x, c * y - s * z, s * y + c * z]
  if (axis === 1) return [c * x + s * z, y, -s * x + c * z]
  return [c * x - s * y, s * x + c * y, z]
}

/**
 * The presented position of one sample during a step, `alpha` already eased. A rotation step follows the
 * true angular path from `from`; any other step interpolates straight to `to` (illustrative only). At
 * alpha >= 1 the exact endpoint `to` is returned, at alpha <= 0 the start `from`.
 */
export function stepPosition(motion: StepMotion, from: readonly number[], to: readonly number[], alpha: number): V3 {
  const a: V3 = [from[0] ?? 0, from[1] ?? 0, from[2] ?? 0]
  const b: V3 = [to[0] ?? 0, to[1] ?? 0, to[2] ?? 0]
  if (alpha <= 0 || motion.kind === 'none') return alpha >= 1 ? b : a
  if (alpha >= 1) return b
  if (motion.kind === 'rotation') return rotateAbout(a, motion.axis, motion.angle * alpha)
  return [a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha]
}
