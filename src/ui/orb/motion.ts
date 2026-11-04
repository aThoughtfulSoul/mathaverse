// The math glyph orb's motion (the approved mock-up's state parameters, colours and easing): each phase has a
// target look; the drawn parameters ease toward it (rate 4/s), so phases blend; the voice level eases at 14/s
// and is used only while listening. Shared by the desktop canvas and the XR instanced mesh; no allocations.
//
// Unlike the mock-up (rotation = time x spin), the rotation angle is integrated (angle += spin dt), so a change of
// spin never jumps the sphere. Every periodic term has period 2π/k in time, so time is kept in [0, 2π).
// Reduced motion: a third of the speed, no voice ripple, no bloom overshoot (the core glow still follows the level).
//
// The bloom overshoot starts once per bloom: when the caller gives the bloom's identity (OrbSource.bloom), only
// when that identity changes; otherwise when the phase changes to 'applied'. snap() is for an orb shown again
// after being hidden: it takes the current phase's look at once (no easing from a phase that has ended, no
// overshoot for a bloom it did not show from the start).

import type { OrbPhase } from './state'

export interface OrbLook {
  radius: number
  spin: number
  bright: number
  swirl: number
  wave: number
  /** sRGB, 0..255. */
  tint: readonly [number, number, number]
  core: number
}

export const ORB_LOOKS: Readonly<Record<OrbPhase, OrbLook>> = {
  idle: { radius: 1.0, spin: 0.12, bright: 0.62, swirl: 0, wave: 0, tint: [69, 208, 191], core: 0.12 },
  listening: { radius: 1.04, spin: 0.22, bright: 0.85, swirl: 0, wave: 0, tint: [120, 236, 222], core: 0.3 },
  transcribing: { radius: 0.74, spin: 0.9, bright: 0.8, swirl: 1, wave: 0, tint: [140, 220, 255], core: 0.35 },
  thinking: { radius: 0.92, spin: 0.55, bright: 0.72, swirl: 0.25, wave: 1, tint: [160, 170, 255], core: 0.26 },
  applied: { radius: 1.22, spin: 0.2, bright: 1.0, swirl: 0, wave: 0, tint: [255, 217, 138], core: 0.5 },
  error: { radius: 0.9, spin: 0.05, bright: 0.38, swirl: 0, wave: 0, tint: [255, 159, 174], core: 0.06 },
}

/** The bloom starts beyond the applied radius and settles. */
export const BLOOM_START_RADIUS = 1.4
/** The sphere's fixed tilt toward the viewer (radians). */
export const ORB_TILT = 0.38
const TAU = Math.PI * 2
const REDUCED_RATE = 0.3

/** What a renderer reads from OrbMotion (verification). */
export type OrbLookState = Readonly<Pick<OrbMotion, 'radius' | 'spin' | 'bright' | 'swirl' | 'wave' | 'core' | 'tint' | 'level' | 'phase'>>

export class OrbMotion {
  radius: number
  spin: number
  bright: number
  swirl: number
  wave: number
  core: number
  readonly tint: [number, number, number]
  /** Eased voice level (0..1; 0 unless listening). */
  level = 0
  /** Rotation about the vertical axis (radians, [0, 2π)). */
  angle = 0
  /** Animation time (seconds, wrapped to [0, 2π)). */
  time = 0
  /** Voice ripple amplitude factor (0 under reduced motion). */
  ripple = 1
  phase: OrbPhase = 'idle'
  /** The bloom (identity from OrbSource.bloom) this look already accounts for: its overshoot never starts again. */
  bloom: string | null = null

  constructor() {
    const l = ORB_LOOKS.idle
    this.radius = l.radius
    this.spin = l.spin
    this.bright = l.bright
    this.swirl = l.swirl
    this.wave = l.wave
    this.core = l.core
    this.tint = [l.tint[0], l.tint[1], l.tint[2]]
  }

  /**
   * Advance by dt seconds (clamped to 0.05) toward the look of `phase`; `level` is the recording's input level.
   * `bloom` is the identity of the latest bloom (OrbSource.bloom): with it the overshoot starts only when it
   * changes while the phase is 'applied'; without it (undefined), on each change of the phase to 'applied'.
   */
  step(dt: number, phase: OrbPhase, level: number, reduced = false, bloom?: string | null): void {
    const d = Math.min(0.05, Math.max(0, Number.isFinite(dt) ? dt : 0))
    const overshoot = phase === 'applied' && (bloom === undefined ? phase !== this.phase : bloom !== this.bloom)
    if (overshoot && !reduced) this.radius = BLOOM_START_RADIUS
    this.phase = phase
    if (bloom !== undefined) this.bloom = bloom
    const t = ORB_LOOKS[phase]
    const k = 1 - Math.exp(-d * 4)
    this.radius += (t.radius - this.radius) * k
    this.spin += (t.spin - this.spin) * k
    this.bright += (t.bright - this.bright) * k
    this.swirl += (t.swirl - this.swirl) * k
    this.wave += (t.wave - this.wave) * k
    this.core += (t.core - this.core) * k
    for (let i = 0; i < 3; i++) this.tint[i] = this.tint[i]! + (t.tint[i]! - this.tint[i]!) * k
    const want = phase === 'listening' && Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
    this.level += (want - this.level) * (1 - Math.exp(-d * 14))
    const rate = reduced ? REDUCED_RATE : 1
    this.angle = (this.angle + this.spin * 2.2 * d * rate) % TAU
    this.time = (this.time + d * rate) % TAU
    this.ripple = reduced ? 0 : 1
  }

  /**
   * Take the look of `phase` at once (the orb is shown again after being hidden): no easing from the look it last
   * showed, no bloom overshoot, the voice level from 0. `bloom` (OrbSource.bloom) is recorded as already shown.
   * Rotation and animation time carry on.
   */
  snap(phase: OrbPhase, bloom?: string | null): void {
    const l = ORB_LOOKS[phase]
    this.radius = l.radius
    this.spin = l.spin
    this.bright = l.bright
    this.swirl = l.swirl
    this.wave = l.wave
    this.core = l.core
    for (let i = 0; i < 3; i++) this.tint[i] = l.tint[i]!
    this.level = 0
    this.phase = phase
    if (bloom !== undefined) this.bloom = bloom
  }
}
