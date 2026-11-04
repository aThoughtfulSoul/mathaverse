// The orb's glyph layout (the mock-up's set on a Fibonacci sphere) and its motion (the mock-up's per-state
// parameters and easing; a bloom that starts beyond the applied radius; the level used only while listening;
// reduced motion: slower, no ripple, no overshoot).

import { describe, expect, it } from 'vitest'
import { ORB_GLYPHS, ORB_GLYPH_COUNT, glyphLayout } from '../../../src/ui/orb/glyphs'
import { BLOOM_START_RADIUS, ORB_LOOKS, OrbMotion } from '../../../src/ui/orb/motion'
import { ORB_PHASES } from '../../../src/ui/orb/state'

describe('glyph layout', () => {
  const pts = glyphLayout()

  it('places 120 glyphs on the unit sphere, top to bottom', () => {
    expect(ORB_GLYPH_COUNT).toBe(120)
    expect(pts).toHaveLength(120)
    for (const p of pts) expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 10)
    for (let i = 1; i < pts.length; i++) expect(pts[i]!.y).toBeLessThan(pts[i - 1]!.y)
    expect(pts[0]!.y).toBeCloseTo(1 - 1 / 120, 10)
    expect(pts[119]!.y).toBeCloseTo(-1 + 1 / 120, 10)
  })

  it('is evenly spread (golden-angle spiral: every hemisphere and quadrant holds about a quarter)', () => {
    const quad = [0, 0, 0, 0]
    for (const p of pts) quad[(p.x >= 0 ? 0 : 1) + (p.z >= 0 ? 0 : 2)]!++
    for (const q of quad) expect(Math.abs(q - 30)).toBeLessThanOrEqual(4)
    // Nearest-neighbour distances stay within a narrow band.
    const nn = pts.map((p, i) => Math.min(...pts.filter((_, j) => j !== i).map((q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z))))
    expect(Math.min(...nn)).toBeGreaterThan(0.25)
    expect(Math.max(...nn)).toBeLessThan(0.4)
  })

  it('uses the mock-up glyph set and assignment, a fixed phase and the latitude', () => {
    expect(ORB_GLYPHS).toHaveLength(40)
    expect(ORB_GLYPHS).toContain('∫')
    expect(ORB_GLYPHS).toContain('ℏ')
    pts.forEach((p, i) => {
      expect(p.glyph).toBe((i * 7) % 40)
      expect(p.phase).toBeGreaterThanOrEqual(0)
      expect(p.phase).toBeLessThan(Math.PI * 2)
      expect(p.lat).toBeCloseTo(Math.asin(p.y), 12)
    })
    expect(glyphLayout()).toEqual(pts) // reproducible
    expect(new Set(pts.map((p) => p.glyph)).size).toBe(40)
  })
})

describe('orb motion', () => {
  it('has a look for every phase, with the mock-up colours', () => {
    for (const ph of ORB_PHASES) expect(ORB_LOOKS[ph]).toBeDefined()
    expect(ORB_LOOKS.idle.tint).toEqual([69, 208, 191])
    expect(ORB_LOOKS.applied.tint).toEqual([255, 217, 138])
    expect(ORB_LOOKS.error.bright).toBeLessThan(ORB_LOOKS.idle.bright) // error dims
  })

  it('eases toward the phase look and settles there', () => {
    const m = new OrbMotion()
    m.step(0.016, 'transcribing', 0)
    expect(m.radius).toBeLessThan(1)
    expect(m.radius).toBeGreaterThan(ORB_LOOKS.transcribing.radius)
    for (let i = 0; i < 200; i++) m.step(0.05, 'transcribing', 0)
    expect(m.radius).toBeCloseTo(ORB_LOOKS.transcribing.radius, 3)
    expect(m.swirl).toBeCloseTo(1, 3)
    expect(m.tint[2]).toBeCloseTo(255, 1)
  })

  it('starts the bloom beyond the applied radius, and settles', () => {
    const m = new OrbMotion()
    m.step(0.016, 'applied', 0)
    expect(m.radius).toBeGreaterThan(ORB_LOOKS.applied.radius)
    expect(m.radius).toBeLessThanOrEqual(BLOOM_START_RADIUS)
    for (let i = 0; i < 200; i++) m.step(0.05, 'applied', 0)
    expect(m.radius).toBeCloseTo(ORB_LOOKS.applied.radius, 3)
  })

  it('follows the level only while listening', () => {
    const m = new OrbMotion()
    for (let i = 0; i < 40; i++) m.step(0.05, 'idle', 0.9)
    expect(m.level).toBe(0)
    for (let i = 0; i < 40; i++) m.step(0.05, 'listening', 0.6)
    expect(m.level).toBeCloseTo(0.6, 3)
    for (let i = 0; i < 40; i++) m.step(0.05, 'transcribing', 0.6)
    expect(m.level).toBeLessThan(0.01)
  })

  it('integrates rotation smoothly (no jump when the spin changes) and keeps time bounded', () => {
    const m = new OrbMotion()
    for (let i = 0; i < 20; i++) m.step(0.05, 'idle', 0)
    const a = m.angle
    m.step(0.05, 'transcribing', 0)
    expect(Math.abs(m.angle - a)).toBeLessThan(0.05)
    for (let i = 0; i < 100_000; i++) m.step(0.05, 'idle', 0)
    expect(m.time).toBeGreaterThanOrEqual(0)
    expect(m.time).toBeLessThan(Math.PI * 2)
    expect(m.angle).toBeLessThan(Math.PI * 2)
    m.step(10, 'idle', 0) // a long pause is clamped
    expect(Number.isFinite(m.angle)).toBe(true)
  })

  it('reduced motion: slower, no ripple, no bloom overshoot', () => {
    const full = new OrbMotion()
    const calm = new OrbMotion()
    for (let i = 0; i < 20; i++) {
      full.step(0.05, 'idle', 0)
      calm.step(0.05, 'idle', 0, true)
    }
    expect(calm.angle).toBeLessThan(full.angle * 0.5)
    expect(calm.ripple).toBe(0)
    calm.step(0.016, 'applied', 0, true)
    expect(calm.radius).toBeLessThan(ORB_LOOKS.applied.radius)
  })
})
