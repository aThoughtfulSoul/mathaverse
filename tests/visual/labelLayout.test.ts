// Label layout policy (PQ-ARCHITECTURE-DECISIONS "Label policy: selected relationship first"), as the pure
// function the adapter runs on projected bounds at the viewing pose.

import { describe, it, expect } from 'vitest'
import { layoutLabels, labelRect, intersects, type LayoutItem, type Placement } from '../../src/rendering/labelLayout'

const O = { gap: 0.006, farGap: 0.03, margin: 0.0025 }
const item = (id: string, x: number, y: number, over: Partial<LayoutItem> = {}): LayoutItem => ({ id, x, y, hw: 0.03, hh: 0.01, r: 0.005, priority: 20, mustShow: false, prefer: [0, 1], ...over })

function shownRects(items: LayoutItem[], out: Map<string, Placement>) {
  return items.filter((it) => out.get(it.id)!.shown).map((it) => ({ id: it.id, r: labelRect(it, out.get(it.id)!.dx, out.get(it.id)!.dy) }))
}

function noOverlap(items: LayoutItem[], out: Map<string, Placement>) {
  const rs = shownRects(items, out)
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (intersects(rs[i]!.r, rs[j]!.r)) return `${rs[i]!.id} overlaps ${rs[j]!.id}`
  return null
}

describe('label layout', () => {
  it('keeps the resting offset when nothing collides', () => {
    const it0 = item('a', 0, 0, { legacy: [-0.03, 0.02] })
    const out = layoutLabels([it0], [], null, O)
    expect(out.get('a')).toMatchObject({ key: 'legacy', dx: -0.03, dy: 0.02, shown: true, leader: false })
  })

  it('places the selected relationship first and moves or hides lower-priority labels, never overlapping', () => {
    // Four labels on almost the same point (the P origin-group case): the selected one must read.
    const items = [
      item('focus', 0, 0, { priority: 100, mustShow: true, hw: 0.06 }),
      item('multi', 0.004, 0.002, { priority: 35, hw: 0.04 }),
      item('pa', 0.006, 0.001, { priority: 20 }),
      item('pb', -0.004, 0.003, { priority: 20 }),
    ]
    const out = layoutLabels(items, [], null, O)
    expect(out.get('focus')!.shown).toBe(true)
    expect(noOverlap(items, out)).toBeNull()
    // Everything that is shown is next to its own point (near ring) or carries a leader (far ring).
    for (const [, pl] of out) if (pl.shown) expect(pl.key.startsWith('n:') || pl.key === 'legacy' || pl.leader).toBe(true)
  })

  it('hides a label only when no place is clear, and keeps its point (it is simply not placed)', () => {
    const wall = { x0: -1, x1: 1, y0: -1, y1: 1 }
    const out = layoutLabels([item('low', 0, 0)], [wall], null, O)
    expect(out.get('low')!.shown).toBe(false)
    const must = layoutLabels([item('sel', 0, 0, { mustShow: true })], [wall], null, O)
    expect(must.get('sel')!.shown).toBe(true)
  })

  it('does not let a label be blocked by its own point', () => {
    const own = { x0: -0.005, x1: 0.005, y0: -0.005, y1: 0.005, owner: 'input:p' }
    const out = layoutLabels([item('p', 0, 0, { owner: 'input:p', legacy: [0, 0] })], [own], null, O)
    expect(out.get('p')!.key).toBe('legacy')
  })

  it('uses a far place with a leader when the near ring is taken', () => {
    const items = [item('sel', 0, 0, { priority: 100, mustShow: true })]
    // Fixed text all around the near ring, but not further out.
    const near = 0.005 + O.gap
    const ring = [
      { x0: -near - 0.07, x1: near + 0.07, y0: near, y1: near + 0.025 },
      { x0: -near - 0.07, x1: near + 0.07, y0: -near - 0.025, y1: -near },
      { x0: near, x1: near + 0.07, y0: -near, y1: near },
      { x0: -near - 0.07, x1: -near, y0: -near, y1: near },
    ]
    const out = layoutLabels(items, ring, null, O)
    expect(out.get('sel')!.leader).toBe(true)
    expect(out.get('sel')!.key.startsWith('f:')).toBe(true)
  })

  it('prefers the given direction (outward from a view origin)', () => {
    const out = layoutLabels([item('corner', 0.1, -0.1, { prefer: [1, -1] })], [], null, O)
    expect(out.get('corner')!.key).toBe('n:se')
  })

  it('holds its place under small movements (hysteresis) and reconsiders only beyond the margin', () => {
    const a = item('a', 0, 0, { priority: 50 })
    const b = item('b', 0.065, 0, { priority: 20, prefer: [-1, 0] })
    const first = layoutLabels([a, b], [], null, O)
    // Jitter both anchors by a millimetre-scale amount, many times: no decision changes.
    let prev = first
    let changes = 0
    for (let i = 0; i < 40; i++) {
      const j = (i % 2 ? 1 : -1) * 0.0012
      const next = layoutLabels([{ ...a, x: a.x + j }, { ...b, y: b.y - j }], [], prev, O)
      for (const [id, pl] of next) if (pl.key !== prev.get(id)!.key || pl.shown !== prev.get(id)!.shown) changes++
      prev = next
    }
    expect(changes).toBe(0)
  })

  it('a shown label keeps a place that overlaps by less than the margin; a new decision needs the margin', () => {
    const it0 = item('x', 0, 0, { legacy: [0, 0.03] })
    const first = layoutLabels([it0], [], null, O)
    expect(first.get('x')!.key).toBe('legacy')
    // An obstacle now reaches 1 mm into the label's place (less than the 2.5 mm margin).
    const r = labelRect(it0, 0, 0.03)
    const nudge = [{ x0: r.x1 - 0.001, x1: r.x1 + 0.05, y0: r.y0, y1: r.y1 }]
    expect(layoutLabels([it0], nudge, first, O).get('x')!.key).toBe('legacy')
    expect(layoutLabels([it0], nudge, null, O).get('x')!.key).not.toBe('legacy')
  })

  it('clears the relative stereo parallax of labels at different depths (one decision for both eyes)', () => {
    // Two labels side by side, 4 mm apart for the centre eye; their depths differ, so the eyes see them shifted.
    const near = item('near', 0, 0, { legacy: [0, 0], par: 0.04 })
    const far = item('far', 0.064, 0, { legacy: [0, 0], par: 0.032 })
    const flat = layoutLabels([near, { ...far, par: 0.04 }], [], null, O)
    expect([flat.get('near')!.key, flat.get('far')!.key]).toEqual(['legacy', 'legacy'])
    const stereo = layoutLabels([near, far], [], null, O)
    expect([stereo.get('near')!.key, stereo.get('far')!.key]).not.toEqual(['legacy', 'legacy'])
  })
})
