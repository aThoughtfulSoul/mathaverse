// The proof presenter's evidence and explanation fixes (PROOF-EXPLORER-UI-REVIEW items 1, 2 and 4;
// LOCAL-SUBMISSION-META-STT-HANDOFF section 2): the "Lean receipt" badge needs a current, successful receipt
// for this exact walk claim; historical, pending, failed and unchecked states carry no badge; the Why heading
// states the selected endpoint's actual verdict; the branch step is stated precisely for zero and nonzero
// totals, apart from the whole lemma's applicability; the exact squared comparison and the length are
// separately labelled; arrows carry the scene's names (IDs stay in actions).

import { describe, expect, it } from 'vitest'
import { Workspace } from '../../src/workspace/reducer'
import { type Doc, demoDocument, findWalkExperiment, walkInputOf } from '../../src/workspace/document'
import { PROOF_IDS, caseActions, endpointActions, proofActions } from '../../src/demo/proof'
import { presentProof, whyTitle } from '../../src/ui/presenters/proof'
import { endpointBound, surdText } from '../../src/workspace/context'
import { deriveWalk } from '../../src/algebra/walk'
import { q } from '../../src/model/rational'
import { IDLE_PLAYBACK } from '../../src/domains/scene'
import type { DetailItem, DetailSection, DomainPresentation, EvidenceItem, PresenterInput } from '../../src/ui/model'
import type { WalkStage } from '../../src/domains/inputs'

const commit = (ws: Workspace, actions: unknown[]) => ws.commit({ baseRevision: ws.current.revision, actions })
const input = (doc: Doc, stage: WalkStage, over: Partial<PresenterInput> = {}): PresenterInput => ({
  doc, demo: 'proof', experimentId: doc.selection.experimentId, linear: null, scene: null, sceneProblem: null, playback: IDLE_PLAYBACK,
  drag: null, dragMode: 'fiber', evidence: [], detailsOpen: true, lesson: { stage }, ...over,
})
const lesson = () => {
  const ws = new Workspace(demoDocument())
  commit(ws, proofActions(ws.current))
  return ws
}
const walk = (ws: Workspace) => findWalkExperiment(ws.current, PROOF_IDS.experiment)
const at = (ws: Workspace, k: number) => {
  commit(ws, endpointActions(walk(ws), k))
  return ws.current
}
const open = () => {
  const ws = lesson()
  commit(ws, caseActions(walk(ws), 'open-two'))
  return ws
}
const section = (p: DomainPresentation, title: string | RegExp) => p.detail.sections.find((s) => (typeof title === 'string' ? s.title === title : title.test(s.title)))
const whyOf = (p: DomainPresentation) => section(p, /^(Why )?W[₀-₉]+ (is|happens)/)!
const texts = (s: DetailSection) => s.items.flatMap((i: DetailItem) => (i.kind === 'text' ? [i.text] : i.kind === 'formula' ? [i.formula.plain] : i.kind === 'pairs' ? i.rows.map((r) => `${r.key.plain}: ${r.value.plain}`) : []))
const row = (s: DetailSection, key: string) => s.items.flatMap((i) => (i.kind === 'pairs' ? i.rows : [])).find((r) => r.key.plain === key)?.value.plain

const claim = { kind: 'walk_reorder_instance' as const, experimentId: PROOF_IDS.experiment }
const entry = (status: EvidenceItem['status'], current: boolean, over: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id: 1, claim, label: 'reordering bound, this 12-arrow example', status, current, statement: status === 'checked' ? 'statement' : null,
  provenance: status === 'checked' ? 'Lean 4.26.0 · walk_reorder_instance · receipt r1' : null, message: null, ...over,
})
const lean = (doc: Doc, evidence: EvidenceItem[]) => section(presentProof(input(doc, 'why', { evidence })), 'Lean check of this finite example')!

describe('Lean receipt badge: only a current successful receipt for this exact walk claim', () => {
  const hero = lesson().current
  it('unchecked: no badge, "Not checked yet"', () => {
    const s = lean(hero, [])
    expect(s.provenance).toBeUndefined()
    expect(texts(s).join(' ')).toContain('Not checked yet.')
  })
  it('pending: no badge, no receipt yet', () => {
    const s = lean(hero, [entry('checking', true)])
    expect(s.provenance).toBeUndefined()
    expect(texts(s)).toContain('Checking: no receipt yet.')
  })
  it('current checked receipt: the badge, scoped to the finite claim', () => {
    const s = lean(hero, [entry('checked', true)])
    expect(s.provenance).toBe('Lean receipt')
    expect(texts(s).join(' ')).toMatch(/^Current receipt: Lean checked this finite claim for the walk shown now\. A check covers these exact vectors and signs only: not the general lemma/)
    expect(s.items[0]).toEqual({ kind: 'evidence', items: [entry('checked', true)] })
  })
  it('historical receipt: labelled historical, no badge', () => {
    const s = lean(hero, [entry('checked', false)])
    expect(s.provenance).toBeUndefined()
    expect(texts(s).join(' ')).toContain('Historical receipt: it was issued for earlier data (other vectors or signs), not for the walk shown now. Check this example again for the current data.')
  })
  it('error, not established and not sent: no badge, no receipt', () => {
    for (const status of ['error', 'not_established', 'not_sent', 'computed'] as const) {
      const s = lean(hero, [entry(status, true)])
      expect(s.provenance, status).toBeUndefined()
      expect(JSON.stringify(s), status).not.toContain('Current receipt')
    }
    expect(texts(lean(hero, [entry('error', true)]))).toContain('No receipt: the latest check for this data did not succeed.')
  })
  it('a checked entry without receipt provenance, or about another experiment or claim, is no receipt here', () => {
    expect(lean(hero, [entry('checked', true, { provenance: null })]).provenance).toBeUndefined()
    const other = entry('checked', true, { claim: { kind: 'walk_reorder_instance', experimentId: 'exp-other' } })
    const linear = entry('checked', true, { claim: { kind: 'map_equality', left: { experimentId: PROOF_IDS.experiment, branchId: 'b' }, right: { experimentId: PROOF_IDS.experiment, branchId: 'c' } } })
    const unclaimed = entry('checked', true, { claim: undefined })
    for (const e of [other, linear, unclaimed]) {
      const s = lean(hero, [e])
      expect(s.provenance).toBeUndefined()
      expect(s.items.some((i) => i.kind === 'evidence')).toBe(false)
      expect(texts(s).join(' ')).toContain('Not checked yet.')
    }
    // A current receipt beside a historical one: the current one decides the badge.
    expect(lean(hero, [entry('checked', false), { ...entry('checked', true), id: 2 }]).provenance).toBe('Lean receipt')
  })
  it('counterexample: never a badge; an old receipt is historical and the open walk cannot be checked', () => {
    const doc = open().current
    const none = lean(doc, [])
    expect(none.provenance).toBeUndefined()
    expect(none.items.find((i) => i.kind === 'action')).toMatchObject({ enabled: false, reason: 'The return-to-start assumption is missing' })
    const hist = lean(doc, [entry('checked', false)])
    expect(hist.provenance).toBeUndefined()
    expect(texts(hist).join(' ')).toContain('Historical receipt: it was issued for earlier data (other vectors or signs), not for the walk shown now. The walk shown now cannot be checked: the return-to-start assumption is missing.')
  })
})

describe('Why heading: the selected endpoint\'s actual verdict', () => {
  it('inside: "Why W₉ is inside the new bound" (and W₃, W₀)', () => {
    for (const k of [0, 3, 9]) expect(whyOf(presentProof(input(at(lesson(), k), 'why'))).title).toBe(`Why W${'₀₁₂₃₄₅₆₇₈₉'[k]} is inside the new bound`)
  })
  it('outside: the open walk\'s W₂ is outside the proposed bound; W₁ (positive) is inside it by a valid calculation', () => {
    const ws = open()
    expect(whyOf(presentProof(input(at(ws, 2), 'why'))).title).toBe('W₂ is outside the proposed bound')
    expect(whyOf(presentProof(input(at(ws, 1), 'why'))).title).toBe('Why W₁ is inside the proposed bound')
  })
  it('a negative endpoint inside only by chance on an open walk "happens to be inside"', () => {
    const f = deriveWalk(custom())
    expect([f.zeroSum, f.witnesses[3]!.branch, f.witnesses[3]!.withinBound]).toEqual([false, 'negative', true])
    expect(whyTitle(f, 3)).toBe('W₃ happens to be inside the proposed bound')
  })
  it('never titles every endpoint "inside"', () => {
    for (const [ws, k] of [[open(), 2]] as const) expect(whyOf(presentProof(input(at(ws, k), 'why'))).title).not.toMatch(/inside/)
  })
})

/** E, E, −E with signs + − +: an open walk (T = E) whose negative endpoint W₃ = T is inside 1.5 by chance. */
function custom() {
  const one = [{ n: '1', d: '1' }, { n: '0', d: '1' }, { n: '0', d: '1' }]
  const minus = [{ n: '-1', d: '1' }, { n: '0', d: '1' }, { n: '0', d: '1' }]
  const ws = lesson()
  commit(ws, [{ kind: 'set_vector_walk', experimentId: PROOF_IDS.experiment, dimension: 3, vectors: [{ id: 'v0', coords: one }, { id: 'v1', coords: one }, { id: 'v2', coords: minus }], order: ['v0', 'v1', 'v2'], signs: [1, -1, 1] }])
  return walkInputOf(walk(ws))
}

describe('Why: the branch step, precisely, for zero and nonzero totals', () => {
  it('positive, zero total (W₃): the triangle-inequality chain, no lemma warning', () => {
    const s = whyOf(presentProof(input(at(lesson(), 3), 'why')))
    const t = texts(s)
    expect(t[0]).toBe('Two half-sized arrows, one from each old walk, land exactly on this point, so it is no farther from home than half the two bounds combined.')
    expect(t).toContain('|W₃| = |U₅ + S₅|/2 ≤ (|U₅| + |S₅|)/2 ≤ (B + D)/2 = 3')
    expect(row(s, '+ arrows among the first 5 steps')).toBe('a₁ b₁ c₁')
    expect(t.join(' ')).not.toMatch(/does not apply|happens to/)
  })
  it('negative, zero total (W₉): T is dropped because the walk returns home', () => {
    const s = whyOf(presentProof(input(at(lesson(), 9), 'why')))
    const t = texts(s).join(' ')
    expect(t).toContain('|W₉| = |S₆ − U₆|/2 ≤ (|S₆| + |U₆|)/2 ≤ (B + D)/2 = 3')
    expect(t).toContain('W₉ = T + (S₆ − U₆)/2, and the walk returns home (T = 0), so T is dropped.')
    expect(row(s, '− arrows among the first 6 steps (not used yet)')).toBe('a₂ b₂ c₂')
  })
  it('positive, nonzero total (open W₁): the calculation is valid without a zero total; the lemma warning is separate', () => {
    const s = whyOf(presentProof(input(at(open(), 1), 'why')))
    const t = texts(s)
    expect(t[0]).toBe('Two half-sized arrows, one from each old walk, still land exactly on this point, so it is within the proposed bound even though the walk does not return home.')
    expect(t).toContain('|W₁| = |U₁ + S₁|/2 ≤ (|U₁| + |S₁|)/2 ≤ (B + D)/2 = 1.5')
    const step = t.find((x) => x.startsWith('Positive part'))!
    expect(step).toContain('This calculation is valid for W₁: the identity W₁ = (U₁ + S₁)/2 and its triangle-inequality bound do not need a zero total.')
    expect(step).not.toMatch(/does not apply/)
    expect(t.at(-1)).toBe('The whole lemma, separately: The return-to-start assumption is missing. This lemma does not apply. Its hypothesis that the walk returns to its start fails (T = (2, 0, 0)), so it guarantees nothing about the new walk as a whole, even though the calculation for W₁ is valid.')
  })
  it('negative, nonzero total (open W₂): the triangle inequality stays valid; dropping T needs a zero total', () => {
    const s = whyOf(presentProof(input(at(open(), 2), 'why')))
    const t = texts(s)
    const all = t.join(' ')
    expect(t).toContain('W₂ = T + (S₀ − U₀)/2 = (2, 0, 0) + (0, 0, 0) = (2, 0, 0)')
    expect(all).toContain('The triangle inequality is still valid: it bounds (S₀ − U₀)/2 by (B + D)/2 = 1.5. Dropping T to reach W₂ requires a zero total, and here T = (2, 0, 0) is not zero, so that bound is not guaranteed for W₂.')
    expect(all).not.toContain('triangle-inequality step does not apply')
    expect(t.at(-1)).toMatch(/^The whole lemma, separately: .* guarantees nothing about the new walk as a whole\.$/)
    expect(row(s, 'Residual T')).toBe('(2, 0, 0) (not zero: the assumption is missing)')
    // The context card's hint keeps the residual for the open walk (never "the walk returns home").
    const hint = presentProof(input(at(open(), 2), 'why')).context.hint!
    expect(hint).toContain('the walk does not return home, so the new point is the leftover total T minus their sum')
    expect(hint).not.toContain('the walk returns home')
  })
})

describe('exact squared comparison and the length, separately labelled', () => {
  it('hero W₉: 147/25 ≤ 9 = R²; |W₉| = √147/5 ≈ 2.425 ≤ 3 = R', () => {
    const s = whyOf(presentProof(input(at(lesson(), 9), 'why')))
    expect(row(s, 'Exact (squared lengths)')).toBe('|W₉|² = 147/25 ≤ 9 = R²')
    expect(row(s, 'Length (approximate)')).toBe('|W₉| = √147/5 ≈ 2.425 ≤ 3 = R')
  })
  it('open W₂: 4 > 9/4 = R²; |W₂| = 2 > 1.5 = R (an exact length)', () => {
    const s = whyOf(presentProof(input(at(open(), 2), 'why')))
    expect(row(s, 'Exact (squared lengths)')).toBe('|W₂|² = 4 > 9/4 = R²')
    expect(row(s, 'Length')).toBe('|W₂| = 2 > 1.5 = R')
  })
  it('every endpoint compares squared with R² and length with R, never one with the other', () => {
    for (const [ws, n] of [[lesson(), 12], [open(), 2]] as const) {
      for (let k = 0; k <= n; k++) {
        const s = whyOf(presentProof(input(at(ws, k), 'why')))
        expect(row(s, 'Exact (squared lengths)')).toMatch(/^\|W[₀-₉]+\|² = \S+ (≤|>) \S+ = R²$/)
        expect(row(s, 'Length (approximate)') ?? row(s, 'Length')).toMatch(/^\|W[₀-₉]+\| = .+ (≤|>) \S+ = R$/)
        expect(JSON.stringify(s)).not.toMatch(/147\/25 (≤|<|>) 3(?![²\d/])|588\/25 (≤|<) 5(?![²\d/])/)
      }
    }
  })
  it('surdText and endpointBound', () => {
    expect([surdText(q(147, 25)), surdText(q(4)), surdText(q(9, 4)), surdText(q(2)), surdText(q(9, 2)), surdText(q(3, 2))]).toEqual(['√147/5', '2', '1.5', '√2', '3/√2', '√(3/2)'])
    const f = deriveWalk(walkInputOf(walk(lesson())))
    expect(endpointBound(f, 3)).toEqual({ name: 'W₃', within: true, relation: '≤', squared: '|W₃|² = 147/25 ≤ 9 = R²', length: '|W₃| = √147/5 ≈ 2.425 ≤ 3 = R', lengthExact: false })
    expect(endpointBound(f, 0)).toMatchObject({ squared: '|W₀|² = 0 ≤ 9 = R²', length: '|W₀| = 0 ≤ 3 = R', lengthExact: true })
  })
})

describe('arrow names in the mathematics panel and the context card', () => {
  it('the new order and the flip control use the scene\'s names; the action keeps the ID', () => {
    const ws = lesson()
    const order = row(section(presentProof(input(ws.current, 'reorder')), 'This walk')!, 'New order (+ arrows | − arrows reversed)')
    expect(order).toBe('a₁ b₁ c₁ −a₁ −b₁ −c₁ | −c₂ −b₂ −a₂ c₂ b₂ a₂')
    commit(ws, [{ kind: 'select_item', experimentId: PROOF_IDS.experiment, item: 'walk:vector:v4' }])
    const p = presentProof(input(ws.current, 'signs'))
    const flip = p.context.groups.flatMap((g) => g.items).find((x) => x.id === 'flip')!
    expect(flip.label.plain).toBe('Flip sign of c₁')
    expect(flip.run).toEqual({ kind: 'actions', actions: [{ kind: 'set_walk_signs', experimentId: PROOF_IDS.experiment, signs: [{ id: 'v4', sign: -1 }] }] })
    expect(p.context.hint).toBe('c₁ (source step 5) is + · signed bound 1')
    expect(JSON.stringify(p)).not.toMatch(/#\d/)
  })
  it('names follow the occurrence when the order changes; walks without scene names show their IDs', () => {
    const ws = lesson()
    commit(ws, [{ kind: 'set_walk_order', experimentId: PROOF_IDS.experiment, order: [...walk(ws).order].reverse() }, { kind: 'select_item', experimentId: PROOF_IDS.experiment, item: 'walk:vector:v4' }])
    const p = presentProof(input(ws.current, 'signs'))
    expect(p.context.groups.flatMap((g) => g.items).find((x) => x.id === 'flip')!.label.plain).toBe('Flip sign of c₁')
    expect(p.context.hint).toBe('c₁ (source step 8) is + · signed bound 1')
    const line = lesson()
    commit(line, caseActions(walk(line), 'line-six'))
    expect(row(section(presentProof(input(line.current, 'reorder')), 'This walk')!, 'New order (+ arrows | − arrows reversed)')).toBe('v0 v2 v3 v5 | v4 v1')
  })
})
