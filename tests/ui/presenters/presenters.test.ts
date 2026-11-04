// The six domain presenters (src/ui/presenters): behaviour and mathematical meaning of the derived view,
// checked against the planner and the exact core (UI-REFINEMENT-SPEC sections 4-6). No colours, no copy
// constants restated beyond the behaviour the spec names.

import { describe, expect, it } from 'vitest'
import { Workspace, planTransaction } from '../../../src/workspace/reducer'
import { type Doc, demoDocument, findGroupExperiment, findBraidExperiment, groupFor } from '../../../src/workspace/document'
import { fourDemoActions, sculptureRebindActions, FOUR_IDS, RZ90, BRAID_EXAMPLES } from '../../../src/demo/four'
import { orderDemoActions, type DemoKind } from '../../../src/demo/order'
import { rebindTarget } from '../../../src/demo/pq'
import { sceneInputFor } from '../../../src/domains/registry'
import { IDLE_PLAYBACK } from '../../../src/domains/scene'
import { deriveSculpture } from '../../../src/domains/sculpture/derive'
import { deriveCube } from '../../../src/domains/cube/derive'
import { deriveQuotient } from '../../../src/domains/quotient/derive'
import { deriveBraid } from '../../../src/domains/braid/derive'
import { primaryRewrite, rewriteSpan } from '../../../src/domains/braid/span'
import { deriveView } from '../../../src/recipes/derive'
import { phiOf } from '../../../src/algebra/cube'
import { transposition } from '../../../src/algebra/permutation'
import { chronologicalProduct } from '../../../src/algebra/groups'
import type { PlaybackState } from '../../../src/rendering/adapter'
import type { ContextItem, DetailItem, DomainPresentation, EvidenceItem, PresenterInput } from '../../../src/ui/model'
import { PRESENTERS } from '../../../src/ui/presenters'
import { NOT_ESTABLISHED } from '../../../src/ui/presenters/braid'
import { prettyPlain } from '../../../src/ui/presenters/common'

// ------------------------------------------------------------------ helpers

const commit = (ws: Workspace, actions: unknown[]) => ws.commit({ baseRevision: ws.current.revision, actions })

function inputFor(doc: Doc, demo: DemoKind, over: Partial<PresenterInput> = {}): PresenterInput {
  const si = sceneInputFor(doc)
  let scene: PresenterInput['scene'] = null
  if (si) {
    const desc = si.layout === 'braid' ? deriveBraid(si.braid) : si.layout === 'walk' ? null : si.layout === 'sculpture' ? deriveSculpture(si.group) : si.layout === 'cube' ? deriveCube(si.group) : deriveQuotient(si.group)
    scene = { layout: si.layout, desc }
  }
  return {
    doc, demo, experimentId: doc.selection.experimentId, linear: si ? null : deriveView(doc), scene, sceneProblem: null,
    playback: IDLE_PLAYBACK, drag: null, dragMode: 'fiber', evidence: [], detailsOpen: false, ...over,
  }
}

const present = (ws: Workspace, demo: DemoKind, over: Partial<PresenterInput> = {}) => PRESENTERS[demo](inputFor(ws.current, demo, over))
const items = (p: DomainPresentation): ContextItem[] => p.context.groups.flatMap((g) => g.items)
const item = (p: DomainPresentation, id: string): ContextItem => {
  const it = items(p).find((x) => x.id === id)
  if (!it) throw new Error(`no context item ${id}: ${items(p).map((x) => x.id).join(', ')}`)
  return it
}
const runActions = (it: { run: ContextItem['run'] }): unknown[] => (it.run.kind === 'actions' ? it.run.actions : [])
const press = (ws: Workspace, it: { run: ContextItem['run'] }) => commit(ws, runActions(it))
const detailActions = (p: DomainPresentation) => p.detail.sections.flatMap((s) => s.items).filter((x): x is Extract<DetailItem, { kind: 'action' }> => x.kind === 'action')
const playing = (phase: string, step: PlaybackState['step'] = null): PlaybackState => ({ active: true, playing: true, time: 0.4, duration: 1.6, phase, step })

function workspaceWith(demo: Exclude<DemoKind, 'pq' | 'proof'>): Workspace {
  const ws = new Workspace(demoDocument())
  commit(ws, demo === 'order' ? orderDemoActions(ws.current) : fourDemoActions(ws.current, demo))
  return ws
}

// ------------------------------------------------------------------ sculpture

describe('sculpture (C4 / V4)', () => {
  it('reference C4 state: cards select, one Apply +1, status Ready with 0 moves, nothing to replay', () => {
    const ws = workspaceWith('sculpture')
    const p = present(ws, 'sculpture')
    expect(p.subtitle.plain).toContain('C₄')
    expect(p.context.title).toBe('Choose an operation')
    const cards = items(p).filter((x) => x.role === 'choice')
    expect(cards.map((c) => c.label.plain)).toEqual(['0', '1', '2', '3'])
    expect(cards.filter((c) => c.selected).map((c) => c.label.plain)).toEqual(['1'])
    const primaries = items(p).filter((x) => x.role === 'primary')
    expect(primaries).toHaveLength(1)
    expect(primaries[0]!.label.plain).toBe('Apply +1')
    expect(p.status).toMatchObject({ phase: 'ready', text: 'Ready · 0 moves · Starting arrangement' })
    expect(p.playback.replay.enabled).toBe(false)
    expect(p.playback.replay.reason).toBeTruthy()
    expect(p.scene.inSceneControls).toBe(false)
  })

  it('pressing any card (including the selected one) only selects; Apply is the one execution path', () => {
    const ws = workspaceWith('sculpture')
    const p = present(ws, 'sculpture')
    for (const c of items(p).filter((x) => x.role === 'choice')) {
      expect(runActions(c).map((a) => (a as { kind: string }).kind)).toEqual(['select_item'])
    }
    // Re-selecting the selected card changes nothing (no history step, no Undo entry).
    const before = ws.current.revision
    press(ws, item(p, 'op:c1'))
    expect(ws.current.revision).toBe(before)
    expect(findGroupExperiment(ws.current, FOUR_IDS.expC4).history).toHaveLength(0)
    // Selecting 2 relabels Apply; applying appends exactly that element.
    press(ws, item(p, 'op:c2'))
    const q = present(ws, 'sculpture')
    expect(item(q, 'apply').label.plain).toBe('Apply +2')
    press(ws, item(q, 'apply'))
    expect(findGroupExperiment(ws.current, FOUR_IDS.expC4).history.map((h) => h.element)).toEqual(['c2'])
  })

  it('applying the identity is a valid operation', () => {
    const ws = workspaceWith('sculpture')
    press(ws, item(present(ws, 'sculpture'), 'op:c0'))
    const p = present(ws, 'sculpture')
    expect(item(p, 'apply')).toMatchObject({ enabled: true, label: { plain: 'Apply +0' } })
    press(ws, item(p, 'apply'))
    expect(findGroupExperiment(ws.current, FOUR_IDS.expC4).history.map((h) => h.element)).toEqual(['c0'])
  })

  it('V4 through the same saved recipe: Apply (1,0), never "+1"; Use on C4 returns', () => {
    const ws = workspaceWith('sculpture')
    const p = present(ws, 'sculpture')
    const rebind = item(p, 'rebind')
    expect(rebind.role).toBe('secondary')
    expect(rebind.label.plain).toBe('Use on V₄')
    expect(runActions(rebind)).toEqual(sculptureRebindActions(ws.current, findGroupExperiment(ws.current, FOUR_IDS.expC4)))
    press(ws, rebind)
    const v4 = findGroupExperiment(ws.current, FOUR_IDS.expV4)
    expect(v4.binding!.recipeId).toBe(findGroupExperiment(ws.current, FOUR_IDS.expC4).binding!.recipeId)
    const q = present(ws, 'sculpture')
    expect(q.subtitle.plain).toContain('V₄')
    const apply = item(q, 'apply')
    expect(apply.label.plain).toBe('Apply (1,0)')
    expect(apply.label.plain).not.toMatch(/\+|quarter/)
    expect(item(q, 'rebind').label.plain).toBe('Use on C₄')
  })

  it('status never says home while beads move; the target is described instead', () => {
    const ws = workspaceWith('sculpture')
    for (let i = 0; i < 4; i++) press(ws, item(present(ws, 'sculpture'), 'apply'))
    const k = chronologicalProduct(groupFor(ws.current, findGroupExperiment(ws.current, FOUR_IDS.expC4)), ['c1', 'c1', 'c1', 'c1'])
    expect(k).toBe('c0')
    const moving = present(ws, 'sculpture', { playback: playing('apply', { index: 4, count: 4, label: '1 · step 4 of 4' }) })
    expect(moving.status.phase).toBe('animating')
    expect(moving.status.text).not.toMatch(/is home|are home|home again/)
    expect(moving.status.text).toMatch(/showing the move to/)
    const paused = present(ws, 'sculpture', { playback: { ...playing('apply'), playing: false } })
    expect(paused.status.phase).toBe('paused')
    const rest = present(ws, 'sculpture')
    expect(rest.status.phase).toBe('result')
    expect(rest.status.text).toMatch(/every bead is home again/)
  })

  it('the count of moves is not an order: mixed steps name the inverse of k, repeats name what remains', () => {
    const ws = workspaceWith('sculpture')
    press(ws, item(present(ws, 'sculpture'), 'apply'))
    press(ws, item(present(ws, 'sculpture'), 'op:c2'))
    press(ws, item(present(ws, 'sculpture'), 'apply'))
    // k = 2 + 1 = 3: one application of +1 (the inverse of 3) brings every bead home.
    const mixed = present(ws, 'sculpture').status.text
    expect(mixed).toContain('k = 3')
    expect(mixed).toContain('apply +1 once')
    expect(mixed).not.toMatch(/order/)
    const ws2 = workspaceWith('sculpture')
    press(ws2, item(present(ws2, 'sculpture'), 'apply'))
    press(ws2, item(present(ws2, 'sculpture'), 'apply'))
    expect(present(ws2, 'sculpture').status.text).toContain('apply +1 two more times')
  })

  it('Reset experiment empties the history and is disabled (with a reason) when there is nothing to reset', () => {
    const ws = workspaceWith('sculpture')
    const r0 = present(ws, 'sculpture').resets
    expect(r0).toHaveLength(1)
    expect(r0[0]).toMatchObject({ enabled: false })
    expect(r0[0]!.reason).toBeTruthy()
    press(ws, item(present(ws, 'sculpture'), 'apply'))
    const r1 = present(ws, 'sculpture').resets[0]!
    expect(r1.enabled).toBe(true)
    press(ws, r1)
    expect(findGroupExperiment(ws.current, FOUR_IDS.expC4).history).toHaveLength(0)
    expect(present(ws, 'sculpture').playback.replay.enabled).toBe(false)
  })
})

// ------------------------------------------------------------------ cube

describe('cube', () => {
  it('after a first diagonal the hint names it; each swap is resolved by the CURRENT slots', () => {
    const ws = workspaceWith('cube')
    // Rotate first, so identities and slots differ.
    press(ws, item(present(ws, 'cube'), 'rotate:rz'))
    const k = findGroupExperiment(ws.current, FOUR_IDS.expCube).history.map((h) => h.element)
    expect(k).toEqual([RZ90])
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expCube, item: 'line:0' }])
    const p = present(ws, 'cube')
    expect(p.context.hint).toBe('Choose another diagonal to swap with 0')
    const phi = phiOf(RZ90)
    for (const j of [1, 2, 3]) {
      const swap = item(p, `swap:${j}`)
      expect(swap.label.plain).toBe(`Swap 0 and ${j}`)
      const ap = runActions(swap)[0] as { kind: string; permutation: number[] }
      expect(ap.kind).toBe('apply_permutation')
      expect(ap.permutation).toEqual([...transposition(4, phi[0]!, phi[j]!)])
    }
    // Committing "Swap 0 and 2" puts object 0 where object 2 was, and 2 where 0 was; 1 and 3 stay.
    press(ws, item(p, 'swap:2'))
    const e = findGroupExperiment(ws.current, FOUR_IDS.expCube)
    const g = groupFor(ws.current, e)
    const after = phiOf(chronologicalProduct(g, e.history.map((h) => h.element)))
    expect([after[0], after[2], after[1], after[3]]).toEqual([phi[2], phi[0], phi[1], phi[3]])
    expect(ws.current.selection.item).toBeNull()
  })

  it('Return by inverse appears only away from the identity, and returns there as a new step', () => {
    const ws = workspaceWith('cube')
    expect(items(present(ws, 'cube')).some((x) => x.id === 'return')).toBe(false)
    press(ws, item(present(ws, 'cube'), 'rotate:rx'))
    press(ws, item(present(ws, 'cube'), 'rotate:rz'))
    const ret = item(present(ws, 'cube'), 'return')
    expect(ret.label.plain).toBe('Return by inverse')
    press(ws, ret)
    const e = findGroupExperiment(ws.current, FOUR_IDS.expCube)
    expect(e.history).toHaveLength(3)
    expect(chronologicalProduct(groupFor(ws.current, e), e.history.map((h) => h.element))).toBe(groupFor(ws.current, e).identity)
    expect(present(ws, 'cube').status.text).toMatch(/back at the identity/)
  })

  it('the detail writes φ and superscripts as the rest of the UI does', () => {
    const ws = workspaceWith('cube')
    for (let i = 0; i < 3; i++) press(ws, item(present(ws, 'cube'), 'rotate:rz'))
    const formulas = present(ws, 'cube', { detailsOpen: true }).detail.sections.flatMap((x) => x.items).filter((x): x is Extract<DetailItem, { kind: 'formula' }> => x.kind === 'formula').map((x) => x.formula.plain)
    expect(formulas.some((f) => f.startsWith('φ(k) = '))).toBe(true)
    expect(formulas.some((f) => /^phi/.test(f))).toBe(false)
    expect(formulas).toContain('k = Rz³')
    expect(JSON.stringify(present(ws, 'cube', { detailsOpen: true }).detail.sections.map((x) => x.items.map((i) => ('text' in i ? i.text : i.kind === 'list' ? i.items.map((l) => l.plain) : i.kind === 'formula' ? i.formula.plain : ''))))).not.toMatch(/\^\d/)
  })
})

// ------------------------------------------------------------------ quotient

describe('quotient', () => {
  it('observation, selection and operands are separate; A then B composes to BA', () => {
    const ws = workspaceWith('quotient')
    const p = present(ws, 'quotient')
    expect(item(p, 'chooseA')).toMatchObject({ enabled: false })
    expect(item(p, 'chooseA').reason).toBeTruthy()
    press(ws, item(p, 'observe:axes'))
    expect(findGroupExperiment(ws.current, FOUR_IDS.expQuotient).observation).toBe('unoriented_axis_lines')
    expect(present(ws, 'quotient').playback.replay.enabled).toBe(true)
    // Select Rz, choose it as A (the primary next step), then H as B.
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expQuotient, item: RZ90 }])
    const a = item(present(ws, 'quotient'), 'chooseA')
    expect(a.role).toBe('primary')
    press(ws, a)
    const H = 'r(-x,z,y)'
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expQuotient, item: H }])
    const b = item(present(ws, 'quotient'), 'chooseB')
    expect(b.role).toBe('primary')
    press(ws, b)
    const e = findGroupExperiment(ws.current, FOUR_IDS.expQuotient)
    expect(e.operands).toEqual([RZ90, H])
    const g = groupFor(ws.current, e)
    const s = present(ws, 'quotient').status
    expect(s.phase).toBe('result')
    expect(s.text).toContain(`BA = ${prettyPlain(g.label(g.multiply(H, RZ90)).plain)}`)
    expect(s.text).toContain('[B][A]')
  })

  it('one chosen operand is not a result yet; the detail uses the same superscripts as the stage', () => {
    const ws = workspaceWith('quotient')
    press(ws, item(present(ws, 'quotient'), 'observe:axes'))
    const RZ3 = 'r(-y,x,z)'
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expQuotient, item: RZ3 }])
    press(ws, item(present(ws, 'quotient'), 'chooseA'))
    const half = present(ws, 'quotient').status
    expect(half.text).toContain('choose B')
    expect(half.phase).toBe('ready')
    const RZ2 = 'r(-x,-y,z)'
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expQuotient, item: RZ2 }])
    press(ws, item(present(ws, 'quotient'), 'chooseB'))
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expQuotient, item: RZ2 }])
    const text = JSON.stringify(present(ws, 'quotient', { detailsOpen: true }).detail)
    expect(text).toContain('Rz²')
    expect(text).not.toMatch(/\^\d/)
  })
})

// ------------------------------------------------------------------ braids

describe('braids', () => {
  it('[1,2,1] vs [2,1,2]: no equality claim before a rewrite; the named rule rewrites and is then witnessed', () => {
    const ws = workspaceWith('braid')
    const p0 = present(ws, 'braid')
    expect(p0.status.text).toContain(NOT_ESTABLISHED)
    expect(p0.status.text).not.toMatch(/same braid/i)
    // Displayed crossing 1 is internal index 0.
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expBraid, item: 'crossing:0' }])
    const p = present(ws, 'braid')
    const rel = items(p).find((x) => x.label.plain === 'Apply braid relation')!
    expect(rel).toMatchObject({ role: 'primary', enabled: true })
    const cancel = items(p).find((x) => x.label.plain === 'Cancel inverse pair')!
    expect(cancel.enabled).toBe(false)
    expect(cancel.reason).toBeTruthy()
    expect(p.context.hint).toContain('crossings 1–3')
    // The scene highlights exactly the span the presenter's primary rule rewrites.
    const desc = inputFor(ws.current, 'braid').scene!.desc as ReturnType<typeof deriveBraid>
    expect(rewriteSpan(primaryRewrite(desc.options)!)).toEqual({ at: 0, length: 3 })
    press(ws, rel)
    const after = present(ws, 'braid').status
    expect(after.phase).toBe('result')
    expect(after.text).toMatch(/^Same braid: .* by 1 supported rewrite \(checked\)$/)
  })

  it('the double crossing differs by its exponent sum; an inverse pair cancels at the selected crossing', () => {
    const ws = workspaceWith('braid')
    const dbl = item(present(ws, 'braid'), 'example:double')
    expect(dbl.selected).toBe(false)
    press(ws, dbl)
    expect(present(ws, 'braid').status.text).toMatch(/^Different braids: exponent sums differ/)
    press(ws, item(present(ws, 'braid'), 'example:cancel'))
    expect(present(ws, 'braid').status.text).toContain(NOT_ESTABLISHED)
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expBraid, item: 'crossing:1' }])
    const p = present(ws, 'braid')
    const cancel = items(p).find((x) => x.label.plain === 'Cancel inverse pair')!
    expect(cancel).toMatchObject({ role: 'primary', enabled: true })
    press(ws, cancel)
    expect(findBraidExperiment(ws.current, FOUR_IDS.expBraid).word).toEqual([])
  })

  it('Clear braid and Restore example are separate resets with distinct targets', () => {
    const ws = workspaceWith('braid')
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expBraid, item: 'crossing:0' }])
    press(ws, items(present(ws, 'braid')).find((x) => x.label.plain === 'Apply braid relation')!)
    const resets = present(ws, 'braid').resets
    expect(resets.map((r) => r.label)).toEqual(['Clear braid', 'Restore example'])
    expect(new Set(resets.map((r) => r.helper)).size).toBe(2)
    const [clear, restore] = resets
    press(ws, clear!)
    expect(findBraidExperiment(ws.current, FOUR_IDS.expBraid).word).toEqual([])
    press(ws, present(ws, 'braid').resets[1]!)
    const e = findBraidExperiment(ws.current, FOUR_IDS.expBraid)
    expect(e.word).toEqual([...BRAID_EXAMPLES[0].word])
    expect(e.compare).toEqual([...BRAID_EXAMPLES[0].compare])
    expect(restore!.enabled).toBe(true)
  })

  it('append and invert are detail tools, not default context actions; Clear braid is only the More reset; a preset can replay', () => {
    const ws = workspaceWith('braid')
    const p = present(ws, 'braid')
    expect(items(p).some((x) => /append|invert|clear/i.test(x.label.plain))).toBe(false)
    expect(detailActions(p).map((a) => a.id)).toEqual(expect.arrayContaining(['append:1', 'invert']))
    // One entry per reset operation (spec section 4): no second "Clear braid" among the word tools.
    expect(detailActions(p).some((a) => a.id === 'clear' || /clear/i.test(a.label.plain))).toBe(false)
    expect(p.resets.filter((r) => r.label === 'Clear braid')).toHaveLength(1)
    expect(p.playback.replay.enabled).toBe(true)
  })

  it('selecting a crossing keeps the rewrite slots: both insertions are listed, disabled with a reason until then', () => {
    const ws = workspaceWith('braid')
    const rewrite = (p: DomainPresentation) => p.context.groups.find((g) => g.id === 'rewrite')!.items
    const p0 = rewrite(present(ws, 'braid'))
    const inserts0 = p0.filter((x) => x.label.plain.startsWith('Insert σ'))
    expect(inserts0.map((x) => x.label.plain)).toEqual(['Insert σ1 σ1⁻¹', 'Insert σ2 σ2⁻¹'])
    expect(inserts0.every((x) => !x.enabled && x.reason === 'Select a crossing first')).toBe(true)
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expBraid, item: 'crossing:0' }])
    const p1 = rewrite(present(ws, 'braid'))
    expect(p1.map((x) => x.label.plain)).toEqual(p0.map((x) => x.label.plain))
    const inserts1 = p1.filter((x) => x.label.plain.startsWith('Insert σ'))
    expect(inserts1.every((x) => x.enabled)).toBe(true)
    expect(runActions(inserts1[1]!)).toEqual([{ kind: 'rewrite_braid', experimentId: FOUR_IDS.expBraid, rule: 'insert_pair', at: 0, generator: 2 }])
  })

  it('the identity braid offers the insertion its hint names (at position 0)', () => {
    const ws = workspaceWith('braid')
    press(ws, present(ws, 'braid').resets.find((r) => r.id === 'clear')!)
    const p = present(ws, 'braid')
    expect(p.context.hint).toContain('insert a pair')
    const ins = items(p).find((x) => x.label.plain === 'Insert σ1 σ1⁻¹')!
    expect(ins.enabled).toBe(true)
    expect(() => planTransaction(ws.current, runActions(ins))).not.toThrow()
    press(ws, ins)
    expect(findBraidExperiment(ws.current, FOUR_IDS.expBraid).word).toEqual([1, -1])
  })

  it('while a rewrite animates, the hint does not claim the highlight the stage hides', () => {
    const ws = workspaceWith('braid')
    commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expBraid, item: 'crossing:0' }])
    press(ws, items(present(ws, 'braid')).find((x) => x.label.plain === 'Apply braid relation')!)
    const moving = present(ws, 'braid', { playback: playing('relation:0') })
    expect(moving.context.hint).not.toMatch(/highlighted/i)
    expect(moving.context.hint).toContain('offered: braid relation at crossings 1–3')
    expect(JSON.stringify(moving.detail)).not.toMatch(/Highlighted span/)
    const rest = present(ws, 'braid')
    expect(rest.context.hint).toContain('highlighted: crossings 1–3')
  })
})

// ------------------------------------------------------------------ linear demonstrations

describe('P / Q and the order comparison', () => {
  it('P: selected pair, drag mode, recipe reuse on Q and a claim-specific Lean check', () => {
    const ws = new Workspace(demoDocument())
    const p = present(ws, 'pq')
    expect(p.subtitle.plain).toContain('P')
    expect(p.status.text).toMatch(/u selected · \d+ samples share its exact output Pu/)
    expect(item(p, 'drag:fiber')).toMatchObject({ selected: true, enabled: true })
    expect(item(p, 'drag:free').run).toEqual({ kind: 'dragMode' })
    const reuse = item(p, 'rebind')
    expect(reuse.label.plain).toBe(rebindTarget(ws.current).label)
    const check = detailActions(p).find((a) => a.id === 'check:same')!
    expect(check.run).toMatchObject({ kind: 'check', claim: { kind: 'same_image_witness', u: 's(1,0,1)' } })
    expect(p.playback.replay.enabled).toBe(true)
    // While dragging the status is the preview, never the committed readout.
    const d = present(ws, 'pq', { drag: { sampleId: 's(1,0,1)', mode: 'fiber', preview: '(1, 0, 2)', lost: false } })
    expect(d.status.text).toMatch(/^Preview: sliding u along its fiber/)
    // The hint row stays while dragging (the context card keeps its height): the same statement, in progress.
    expect(p.context.hint).toMatch(/^Drag u along its fiber/)
    expect(d.context.hint).toMatch(/^Dragging u along its fiber: the input changes, Pu stays/)
    press(ws, reuse)
    const q = present(ws, 'pq')
    expect(q.subtitle.plain).toContain('Q')
    expect(detailActions(q).find((a) => a.id === 'check:diff')).toMatchObject({ enabled: true, run: { kind: 'check', claim: { kind: 'map_difference_witness', basisIndex: 0 } } })
  })

  it('order: the routes are named in chronological order; Reverse left order is primary and exact', () => {
    const ws = workspaceWith('order')
    const p = present(ws, 'order')
    expect(p.context.groups.map((g) => g.label)).toEqual(['Left: R then S', 'Right: S then R'])
    expect(p.context.hint).toBe('R then S gives SR; S then R gives RS')
    const rev = item(p, 'reverse:left')
    expect(rev.role).toBe('primary')
    expect(item(p, 'reverse:right').role).toBe('secondary')
    expect(p.status.text).toContain('differ')
    expect(detailActions(p)[0]!.run).toMatchObject({ kind: 'check', claim: { kind: 'map_difference_witness', basisIndex: 0 } })
    press(ws, rev)
    const q = present(ws, 'order')
    expect(q.context.groups[0]!.label).toBe('Left: S then R')
    expect(q.status.text).toContain('give the same map')
    expect(detailActions(q)[0]!.run).toMatchObject({ kind: 'check', claim: { kind: 'map_equality' } })
  })

  it('"Lean receipt" tags the checks section only once a listed entry is a receipt', () => {
    const checksSection = (p: DomainPresentation) => p.detail.sections.find((x) => x.title === 'Checks and receipts')!
    const entry = (experimentId: string, status: EvidenceItem['status']): EvidenceItem => ({
      id: 1, claim: { kind: 'map_equality', left: { experimentId, branchId: 'b' }, right: { experimentId, branchId: 'c' } },
      label: 'claim', status, current: true, statement: null, provenance: null, message: null,
    })
    const ws = new Workspace(demoDocument())
    const pqId = ws.current.selection.experimentId
    expect(checksSection(present(ws, 'pq')).provenance).toBeUndefined()
    for (const status of ['computed', 'checking', 'not_sent', 'not_established', 'error'] as const) {
      expect(checksSection(present(ws, 'pq', { evidence: [entry(pqId, status)] })).provenance).toBeUndefined()
    }
    expect(checksSection(present(ws, 'pq', { evidence: [entry(pqId, 'checked')] })).provenance).toBe('Lean receipt')
    // A receipt about another experiment is not listed here, so it tags nothing.
    const order = workspaceWith('order')
    const orderId = order.current.selection.experimentId
    expect(checksSection(present(order, 'order')).provenance).toBeUndefined()
    expect(checksSection(present(order, 'order', { evidence: [entry(pqId, 'checked')] })).provenance).toBeUndefined()
    expect(checksSection(present(order, 'order', { evidence: [entry(orderId, 'checked')] })).provenance).toBe('Lean receipt')
  })
})

// ------------------------------------------------------------------ every experiment

describe('every presenter', () => {
  function states(): { demo: DemoKind; ws: Workspace }[] {
    const out: { demo: DemoKind; ws: Workspace }[] = [{ demo: 'pq', ws: new Workspace(demoDocument()) }]
    for (const demo of ['order', 'sculpture', 'cube', 'quotient', 'braid'] as const) out.push({ demo, ws: workspaceWith(demo) })
    const cube = workspaceWith('cube')
    commit(cube, [{ kind: 'select_item', experimentId: FOUR_IDS.expCube, item: 'line:3' }])
    out.push({ demo: 'cube', ws: cube })
    const braid = workspaceWith('braid')
    commit(braid, [{ kind: 'select_item', experimentId: FOUR_IDS.expBraid, item: 'crossing:2' }])
    out.push({ demo: 'braid', ws: braid })
    return out
  }

  it('disabled items carry a reason; enabled actions pass the planner', () => {
    for (const { demo, ws } of states()) {
      for (const detailsOpen of [false, true]) {
        const p = present(ws, demo, { detailsOpen })
        const all = [...items(p), ...detailActions(p), ...p.resets]
        for (const it of all) {
          if (!it.enabled) expect(it.reason, `${demo}: ${'label' in it ? JSON.stringify(it.label) : ''}`).toBeTruthy()
          else if (it.run.kind === 'actions') expect(() => planTransaction(ws.current, it.run.kind === 'actions' ? it.run.actions : []), `${demo}: ${it.id}`).not.toThrow()
        }
        if (!p.playback.play.enabled) expect(p.playback.play.reason).toBeTruthy()
        if (!p.playback.replay.enabled) expect(p.playback.replay.reason).toBeTruthy()
        expect(p.scene).toEqual({ inSceneControls: false, detailsOpen })
        expect(items(p).filter((x) => x.role === 'primary').length).toBeLessThanOrEqual(1)
      }
    }
  })

  it('no universal Lean badge: group and braid scenes never mention Lean; a missing scene is an error', () => {
    for (const { demo, ws } of states()) {
      const text = JSON.stringify(present(ws, demo, { detailsOpen: true }))
      expect(text).not.toMatch(/Lean verified/i)
      if (demo !== 'pq' && demo !== 'order') expect(text).not.toMatch(/Lean/)
    }
    const ws = workspaceWith('cube')
    const p = PRESENTERS.cube({ ...inputFor(ws.current, 'cube'), scene: null, sceneProblem: 'cube: not in this build' })
    expect(p.status.tone).toBe('error')
  })
})
