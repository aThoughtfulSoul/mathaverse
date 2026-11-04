// The orb's motion: the bloom overshoot starts once per bloom (by its identity when the caller gives it, else on
// entry into 'applied'), and snap() takes the current phase's look at once for an orb shown again after being
// hidden (no 'thinking' wave or tint left over, no overshoot, the voice level from 0).

import { describe, expect, it } from 'vitest'
import { BLOOM_START_RADIUS, ORB_LOOKS, OrbMotion } from '../../../src/ui/orb/motion'
import { ORB_PHASES, type OrbPhase } from '../../../src/ui/orb/state'

const DT = 1 / 72

function run(m: OrbMotion, phase: OrbPhase, seconds: number, bloom?: string | null, level = 0) {
  for (let i = 0; i < Math.round(seconds * 72); i++) m.step(DT, phase, level, false, bloom)
}

function expectLook(m: OrbMotion, phase: OrbPhase) {
  const l = ORB_LOOKS[phase]
  expect(m.phase).toBe(phase)
  expect(m.radius).toBe(l.radius)
  expect(m.spin).toBe(l.spin)
  expect(m.bright).toBe(l.bright)
  expect(m.swirl).toBe(l.swirl)
  expect(m.wave).toBe(l.wave)
  expect(m.core).toBe(l.core)
  expect([...m.tint]).toEqual([...l.tint])
}

describe('orb motion: snap', () => {
  it('takes the look of the phase at once, for every phase, with no overshoot and the level from 0', () => {
    for (const p of ORB_PHASES) {
      const m = new OrbMotion()
      run(m, 'listening', 1, undefined, 1)
      expect(m.level).toBeGreaterThan(0.5)
      m.snap(p)
      expectLook(m, p)
      expect(m.level).toBe(0)
    }
  })

  it('review finding: shown again in idle after hiding mid-thinking, the first frame has no thinking wave or tint', () => {
    const m = new OrbMotion()
    run(m, 'thinking', 2)
    expect(m.wave).toBeGreaterThan(0.9)
    // Hidden for a while (no steps); the request ended. Shown again: snap, then the first frame.
    m.snap('idle')
    m.step(DT, 'idle', 0)
    expect(m.wave).toBe(0)
    expect(m.tint.map((x) => Math.round(x))).toEqual([...ORB_LOOKS.idle.tint])
    expect(m.radius).toBe(ORB_LOOKS.idle.radius)
  })

  it('shown again during a bloom: the applied look without the overshoot, then it settles as usual', () => {
    const m = new OrbMotion()
    run(m, 'thinking', 1)
    m.snap('applied')
    m.step(DT, 'applied', 0)
    expect(m.radius).toBe(ORB_LOOKS.applied.radius)
    // The same with a bloom identity: snapping records it, so the next steps do not overshoot either.
    const k = new OrbMotion()
    k.snap('applied', 'r1')
    k.step(DT, 'applied', 0, false, 'r1')
    expect(k.radius).toBe(ORB_LOOKS.applied.radius)
    run(k, 'idle', 3, 'r1')
    expect(k.radius).toBeCloseTo(ORB_LOOKS.idle.radius, 3)
  })

  it('keeps rotation and animation time going (no jump of the sphere)', () => {
    const m = new OrbMotion()
    run(m, 'transcribing', 0.5)
    const { angle, time } = m
    m.snap('idle')
    expect(m.angle).toBe(angle)
    expect(m.time).toBe(time)
  })
})

describe('orb motion: one overshoot per bloom', () => {
  it('with the bloom identity: re-entering applied for the same bloom never overshoots again; a new bloom does', () => {
    const m = new OrbMotion()
    run(m, 'thinking', 0.5, null)
    m.step(DT, 'applied', 0, false, 'r1')
    const peak = m.radius
    expect(peak).toBeGreaterThan(ORB_LOOKS.applied.radius + 0.1)
    run(m, 'listening', 0.2, 'r1')
    run(m, 'error', 0.2, 'r1')
    const before = m.radius
    m.step(DT, 'applied', 0, false, 'r1')
    expect(m.radius).toBeLessThanOrEqual(Math.max(before, ORB_LOOKS.applied.radius))
    expect(m.radius).toBeLessThan(ORB_LOOKS.applied.radius + 0.05)
    run(m, 'thinking', 0.5, 'r1')
    m.step(DT, 'applied', 0, false, 'r2')
    expect(m.radius).toBeGreaterThan(ORB_LOOKS.applied.radius + 0.1)
  })

  it('without the identity: the overshoot starts on each entry into applied (the phase is then once per bloom by state.ts)', () => {
    const m = new OrbMotion()
    m.step(DT, 'applied', 0)
    expect(m.radius).toBeGreaterThan(ORB_LOOKS.applied.radius + 0.1)
    expect(m.radius).toBeLessThanOrEqual(BLOOM_START_RADIUS)
    run(m, 'applied', 0.5)
    expect(m.radius).toBeLessThan(BLOOM_START_RADIUS - 0.1)
  })

  it('reduced motion never overshoots', () => {
    const m = new OrbMotion()
    m.step(DT, 'applied', 0, true, 'r1')
    expect(m.radius).toBeLessThan(ORB_LOOKS.applied.radius)
    const n = new OrbMotion()
    n.step(DT, 'applied', 0, true)
    expect(n.radius).toBeLessThan(ORB_LOOKS.applied.radius)
  })
})
