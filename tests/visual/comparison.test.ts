// Comparison derivation (recipe operation branch_comparison): the description the renderer draws for the
// prepared operation-order demonstration, built through Workspace.commit like every other edit. Exact values
// come from the model; these checks read the description's display data and readouts.

import { describe, it, expect } from 'vitest'
import { demoDocument, findExperiment } from '../../src/workspace/document'
import { Workspace } from '../../src/workspace/reducer'
import { orderDemoActions, reverseRouteActions, pqDemoActions, ORDER_IDS } from '../../src/demo/order'
import { deriveView, tokenSetFor } from '../../src/recipes/derive'
import { stepMotion, stepVerb, routeLines, motionLines } from '../../src/recipes/comparison'
import { ORDER_MATTERS } from '../../src/recipes/recipe'
import type { EquationDesc, OutlineDesc, PointDesc, VectorDesc, ViewDescription, ViewRole } from '../../src/rendering/viewDescription'
import { presets } from '../../src/model/linear'
import { compareClock, compareDuration, stepPosition } from '../../src/rendering/comparePlayback'

const E1 = ORDER_IDS.witness
const A = 's(1,1,0)'

function withOrder() {
  const ws = new Workspace(demoDocument())
  ws.commit({ baseRevision: 0, actions: orderDemoActions(ws.current) })
  return ws
}

const point = (d: ViewDescription, view: ViewRole, id: string) => d.primitives.find((p): p is PointDesc => p.kind === 'point' && p.view === view && p.sourceId === id)!
const eq = (d: ViewDescription, id: string) => d.primitives.find((p): p is EquationDesc => p.kind === 'equation' && p.id === id)
const clean = (v: number[]) => v.map((x) => (Object.is(x, -0) ? 0 : x))

describe('branch comparison description', () => {
  it('describes both routes in words, products and steps (left = output, right = output2)', () => {
    const d = deriveView(withOrder().current)
    const c = d.comparison!
    expect(c.left).toMatchObject({ branchId: 'left', view: 'output', symbol: 'SR', order: 'R then S', steps: 2 })
    expect(c.right).toMatchObject({ branchId: 'right', view: 'output2', symbol: 'RS', order: 'S then R', steps: 2 })
    expect(c.mapsEqual).toBe(false)
    expect(d.mapSymbol).toBe('SR')
    expect(d.matrix.map(clean)).toEqual([[0, -1, 0], [-1, 0, 0], [0, 0, 1]])
    expect(d.fiberAvailable).toBe(false)
    expect(d.fiberAxis).toBeNull()
    expect(c.left.stages.map((s) => s.symbol)).toEqual(['R', 'SR'])
    expect(c.right.stages.map((s) => s.symbol)).toEqual(['S', 'RS'])
    expect(eq(d, 'eq:route:output')!.captionPlain).toBe('Rotate 90° about z, then reflect (negate y)')
    expect(eq(d, 'eq:route:output2')!.captionPlain).toBe('Reflect (negate y), then rotate 90° about z')
    expect(eq(d, 'eq:route:output')!.plain).toBe('SR = [[0, -1, 0], [-1, 0, 0], [0, 0, 1]]')
    expect(eq(d, 'eq:route:output2')!.plain).toBe('RS = [[0, 1, 0], [1, 0, 0], [0, 0, 1]]')
    expect(c.statusPlain).toBe('R then S (left) vs S then R (right): select a point, or drag the selected one')
    // Never "reflection across the x-axis" as a map of R^3.
    expect(JSON.stringify(d)).not.toMatch(/across the x-axis/)
  })

  it('reproduces the exact witness table step by step, stating the fixed step', () => {
    const d = deriveView(withOrder().current)
    expect(eq(d, 'eq:sel')!.plain).toBe('e1 = (1, 0, 0)')
    expect(eq(d, 'eq:step:output:1')!.plain).toBe('first R: Re1 = (0, 1, 0)')
    expect(eq(d, 'eq:step:output:2')!.plain).toBe('then S: SRe1 = (0, -1, 0)')
    expect(eq(d, 'eq:step:output2:1')!.plain).toBe('first S: Se1 = e1 (fixed)')
    expect(eq(d, 'eq:step:output2:2')!.plain).toBe('then R: RSe1 = (0, 1, 0)')
    expect(eq(d, 'eq:verdict')!.plain).toBe('SRe1 ≠ RSe1')
    expect(eq(d, 'eq:verdict')!.captionPlain).toBe('the routes differ')
    const c = d.comparison!
    expect(c.left.stages.map((s) => s.selectedFixed)).toEqual([false, false])
    expect(c.right.stages.map((s) => s.selectedFixed)).toEqual([true, false])
    // Step endpoints per route (display copies of exact values).
    expect(clean(c.left.stages[0]!.at[E1]!)).toEqual([0, 1, 0])
    expect(clean(c.left.stages[1]!.at[E1]!)).toEqual([0, -1, 0])
    expect(clean(c.right.stages[0]!.at[E1]!)).toEqual([1, 0, 0])
    expect(clean(c.right.stages[1]!.at[E1]!)).toEqual([0, 1, 0])
    expect(clean(c.left.stages[1]!.at[A]!)).toEqual([-1, -1, 0])
    expect(clean(c.right.stages[1]!.at[A]!)).toEqual([1, 1, 0])
    // The final points of each view are the routes' results.
    expect(clean(point(d, 'output', A).at)).toEqual([-1, -1, 0])
    expect(clean(point(d, 'output2', A).at)).toEqual([1, 1, 0])
    expect(clean(point(d, 'output', E1).at)).toEqual([0, -1, 0])
    expect(clean(point(d, 'output2', E1).at)).toEqual([0, 1, 0])
  })

  it('keeps every labelled sample identifiable in all three views (name, colour index, selection arrow)', () => {
    const d = deriveView(withOrder().current)
    for (const view of ['input', 'output', 'output2'] as const) {
      const pts = d.primitives.filter((p): p is PointDesc => p.kind === 'point' && p.view === view)
      expect(pts.map((p) => `${p.label}:${p.ident}`)).toEqual(['a:0', 'b:1', 'c:2', 'd:3', 'e_{1}:4'])
      expect(pts.find((p) => p.sourceId === E1)!.emphasis).toBe('focus')
      const v = d.primitives.find((p): p is VectorDesc => p.kind === 'vector' && p.view === view)!
      expect(v.sourceId).toBe(E1)
    }
    expect(point(d, 'input', E1).interaction).toBe('handle')
    expect(point(d, 'output2', E1).interaction).toBe('select')
  })

  it('chooses each step motion from its exact matrix, not its name', () => {
    const c = deriveView(withOrder().current).comparison!
    expect(c.left.stages.map((s) => s.motion)).toEqual([{ kind: 'rotation', axis: 2, angle: Math.PI / 2 }, { kind: 'straight' }])
    expect(c.right.stages.map((s) => s.motion)).toEqual([{ kind: 'straight' }, { kind: 'rotation', axis: 2, angle: Math.PI / 2 }])
    expect(stepMotion(presets.rotation(3, 1, 0))).toEqual({ kind: 'rotation', axis: 0, angle: Math.PI / 2 })
    expect(stepMotion(presets.rotation(3, 2, 2)).kind).toBe('rotation')
    expect(stepMotion(presets.shear(3, 0, 1, { n: 1n, d: 2n })).kind).toBe('straight')
    expect(stepVerb(presets.reflection(3, 1), 'S')).toBe('reflect (negate y)')
    expect(motionLines(presets.reflection(3, 1), 'S')).toEqual(['S: straight path to the image;', 'only its end is the reflection'])
    expect(motionLines(presets.rotation(3, 1, 2), 'R')).toEqual(['R: rotating 90° about z', '(a true rotation path)'])
    expect(routeLines([])).toEqual(['No maps: the identity'])
  })

  it('reversing a route through set_branch makes the outputs and matrices agree; Undo restores', () => {
    const ws = withOrder()
    ws.commit({ baseRevision: ws.current.revision, actions: reverseRouteActions(findExperiment(ws.current, ORDER_IDS.experiment), 'left') })
    const d = deriveView(ws.current)
    const c = d.comparison!
    expect(c.left.order).toBe('S then R')
    expect(c.mapsEqual).toBe(true)
    for (const p of d.primitives.filter((x): x is PointDesc => x.kind === 'point' && x.view === 'output')) expect(p.at).toEqual(point(d, 'output2', p.sourceId).at)
    expect(eq(d, 'eq:verdict')!.plain).toBe('RS = RS')
    expect(eq(d, 'eq:verdict')!.captionPlain).toBe('both routes give the same map')
    ws.undo()
    expect(deriveView(ws.current).comparison!.left.order).toBe('R then S')
  })

  it('draws the outline through its vertices\' current coordinates, and follows a moved corner', () => {
    const ws = withOrder()
    const outline = (d: ViewDescription, view: ViewRole) => d.primitives.find((p): p is OutlineDesc => p.kind === 'outline' && p.view === view)!
    const d0 = deriveView(ws.current)
    expect(outline(d0, 'input').vertexIds).toEqual(['s(1,1,0)', 's(-1,1,0)', 's(-1,-1,0)', 's(1,-1,0)'])
    expect(outline(d0, 'input').points.map(clean)).toEqual([[1, 1, 0], [-1, 1, 0], [-1, -1, 0], [1, -1, 0]])
    ws.commit({ baseRevision: ws.current.revision, actions: [{ kind: 'update_sample', sampleSetId: ORDER_IDS.sampleSet, sampleId: A, coords: [{ n: '2', d: '1' }, { n: '1', d: '1' }, { n: '0', d: '1' }] }] })
    const d1 = deriveView(ws.current)
    expect(clean(outline(d1, 'input').points[0]!)).toEqual([2, 1, 0])
    // SR (2, 1, 0) = (-1, -2, 0); RS (2, 1, 0) = (1, 2, 0)
    expect(clean(outline(d1, 'output').points[0]!)).toEqual([-1, -2, 0])
    expect(clean(outline(d1, 'output2').points[0]!)).toEqual([1, 2, 0])
  })

  it('omits an outline whose vertex is missing, with an explanation', () => {
    const ws = withOrder()
    const rule = { ...ORDER_MATTERS, name: 'Missing corner', operations: ORDER_MATTERS.operations.map((o) => (o.kind === 'sample_outline' ? { ...o, vertices: ['s(1,1,0)', 's(9,9,0)'] } : o)) }
    ws.commit({ baseRevision: ws.current.revision, actions: [
      { kind: 'save_recipe', name: 'missing', recipe: rule },
      { kind: 'bind_recipe', experimentId: ORDER_IDS.experiment, recipeId: '$missing', bindings: { samples: ORDER_IDS.sampleSet, left: 'left', right: 'right', selection: E1 } },
    ] })
    const d = deriveView(ws.current)
    expect(d.primitives.some((p) => p.kind === 'outline')).toBe(false)
    expect(d.notes).toContain('Outline omitted: s(9,9,0) is not in sample set set-square.')
  })

  it('names a different selection and the case where both routes agree on it', () => {
    const ws = withOrder()
    ws.commit({ baseRevision: ws.current.revision, actions: [{ kind: 'select', experimentId: ORDER_IDS.experiment, sampleId: A }] })
    const d = deriveView(ws.current)
    expect(eq(d, 'eq:step:output:2')!.plain).toBe('then S: SRa = (-1, -1, 0)')
    expect(eq(d, 'eq:step:output2:2')!.plain).toBe('then R: RSa = (1, 1, 0)')
    expect(eq(d, 'eq:verdict')!.plain).toBe('SRa ≠ RSa')
    // The origin is fixed by both routes although the maps differ.
    ws.commit({ baseRevision: ws.current.revision, actions: [{ kind: 'update_sample', sampleSetId: ORDER_IDS.sampleSet, sampleId: A, coords: [{ n: '0', d: '1' }, { n: '0', d: '1' }, { n: '0', d: '1' }] }] })
    const d2 = deriveView(ws.current)
    expect(eq(d2, 'eq:verdict')!.plain).toBe('SRa = RSa')
    expect(eq(d2, 'eq:verdict')!.captionPlain).toBe('the same here, but SR ≠ RS')
  })

  it('prepares every glyph token the comparison readouts use', () => {
    const doc = withOrder().current
    const d = deriveView(doc)
    const set = new Set(tokenSetFor(doc))
    const tokens = d.primitives.flatMap((p) => (p.kind === 'equation' ? [...(p.tokens ?? []), ...(p.captionTokens ?? [])] : [])).concat(d.comparison!.statusTokens)
    expect(tokens.filter((t) => !set.has(t.tex)).map((t) => t.tex)).toEqual([])
  })

  it('leaves the P-to-Q linked views a linked-view description, and shows every named label there', () => {
    const ws = withOrder()
    ws.commit({ baseRevision: ws.current.revision, actions: pqDemoActions(ws.current, 'exp-p', 's(1,0,1)') })
    const d = deriveView(ws.current)
    expect(d.comparison).toBeNull()
    expect(d.mapSymbol).toBe('P')
    expect(d.primitives.some((p) => p.view === 'output2')).toBe(false)
    // The label policy is a presentation decision now: "Pa" is described; the adapter decides where it reads.
    const labels = d.primitives.filter((p) => p.kind === 'label').map((p) => (p.kind === 'label' ? p.plain : ''))
    expect(labels).toContain('Pu = Pv = Pw')
    expect(labels).toContain('Pa')
    expect(labels).toContain('Pb')
  })
})

describe('comparison playback (pure timing and paths)', () => {
  it('holds the input, then plays each step and holds its exact endpoint', () => {
    expect(compareDuration(2, 1.6)).toBeCloseTo(4.0)
    expect(compareClock(2, 1.6, 0.2)).toEqual({ index: 0, alpha: 0, holding: true })
    const mid = compareClock(2, 1.6, 0.8 + 0.56)
    expect(mid.index).toBe(1)
    expect(mid.alpha).toBeCloseTo(0.5)
    expect(compareClock(2, 1.6, 0.8 + 1.5)).toEqual({ index: 1, alpha: 1, holding: true })
    expect(compareClock(2, 1.6, 4.0).index).toBe(2)
    expect(compareClock(0, 1.6, 3).index).toBe(0)
  })

  it('moves a rotation step along a true angular path and a reflection step straight', () => {
    const rot = { kind: 'rotation' as const, axis: 2 as const, angle: Math.PI / 2 }
    for (const a of [0.1, 0.3, 0.5, 0.9]) {
      const p = stepPosition(rot, [1, 1, 0], [-1, 1, 0], a)
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(Math.SQRT2, 12)
    }
    expect(stepPosition(rot, [1, 1, 0], [-1, 1, 0], 1)).toEqual([-1, 1, 0])
    const half = stepPosition({ kind: 'straight' }, [1, 1, 0], [1, -1, 0], 0.5)
    expect(half).toEqual([1, 0, 0]) // collapses through the mirror plane: an illustrative path, not a reflection
    expect(stepPosition({ kind: 'straight' }, [1, 0, 0], [1, 0, 0], 0.4)).toEqual([1, 0, 0])
  })
})
