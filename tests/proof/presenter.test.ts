// The proof-lesson presenter (src/ui/presenters/proof.ts): the step strip is presentation (a `stage` run, never
// actions), every number comes from the exact derivation of the current document, bounds are never called
// distances, the Why text names the right witness for both branches, and the counterexample is honest.

import { describe, expect, it } from 'vitest'
import { Workspace } from '../../src/workspace/reducer'
import { type Doc, demoDocument, findWalkExperiment } from '../../src/workspace/document'
import { PROOF_IDS, caseActions, endpointActions, proofActions } from '../../src/demo/proof'
import { presentProof } from '../../src/ui/presenters/proof'
import { IDLE_PLAYBACK } from '../../src/domains/scene'
import type { ContextItem, DomainPresentation, PresenterInput } from '../../src/ui/model'
import type { WalkStage } from '../../src/domains/inputs'

const commit = (ws: Workspace, actions: unknown[]) => ws.commit({ baseRevision: ws.current.revision, actions })
const input = (doc: Doc, stage: WalkStage, over: Partial<PresenterInput> = {}): PresenterInput => ({
  doc, demo: 'proof', experimentId: doc.selection.experimentId, linear: null, scene: null, sceneProblem: null, playback: IDLE_PLAYBACK,
  drag: null, dragMode: 'fiber', evidence: [], detailsOpen: false, lesson: { stage }, ...over,
})
const items = (p: DomainPresentation): ContextItem[] => p.context.groups.flatMap((g) => g.items)
const item = (p: DomainPresentation, id: string) => items(p).find((x) => x.id === id)!
const lesson = () => {
  const ws = new Workspace(demoDocument())
  commit(ws, proofActions(ws.current))
  return ws
}
const walk = (ws: Workspace) => findWalkExperiment(ws.current, PROOF_IDS.experiment)
const allText = (p: DomainPresentation) => JSON.stringify(p)

describe('step strip', () => {
  it('lists the five steps; pressing one is a stage run, not a transaction', () => {
    const p = presentProof(input(lesson().current, 'walk'))
    const steps = p.context.groups.find((g) => g.id === 'steps')!.items
    expect(steps.map((s) => s.label.plain)).toEqual(['Walk', 'Signs', 'Reorder', 'Why?', 'Assumptions'])
    expect(steps[0]!.selected).toBe(true)
    expect(steps[3]!.run).toEqual({ kind: 'stage', stage: 'why' })
    expect(p.subtitle.plain).toBe('Inside a published proof · Steinitz–Bergström')
  })
})

describe('honest numbers', () => {
  const ws = lesson()
  it('walk: actual peak inside the source bound, labelled approximately', () => {
    expect(presentProof(input(ws.current, 'walk')).status.text).toBe('12 arrows return home · peak ≈ 4.850 inside source bound 5')
  })
  it('reorder: new bound against source bound, actual peak separately', () => {
    expect(presentProof(input(ws.current, 'reorder')).status.text).toBe('Same arrows, new order · new bound 3 (source bound 5) · actual peak ≈ 2.425')
  })
  it('never calls a bound a maximum distance', () => {
    for (const stage of ['walk', 'signs', 'reorder', 'why', 'assumptions'] as WalkStage[]) expect(allText(presentProof(input(ws.current, stage, { detailsOpen: true })))).not.toMatch(/maximum distance|shrinks from 5 to 3/i)
  })
  it('shows the coverage map and the source declaration under Show mathematics', () => {
    const t = allText(presentProof(input(ws.current, 'walk', { detailsOpen: true })))
    expect(t).toContain('Signing bound: outside this lesson → Reordering step: interactive → Ordering result')
    expect(t).toContain('OAI.EuclideanSteinitzBergstrom.signedOrder_prefix_bound')
    expect(t).toContain('4eaee8754825')
    expect(t).toContain('not a new AI-invented lemma')
  })
})

describe('Why: both branches', () => {
  it('k = 3: positive part, j = 5', () => {
    const ws = lesson()
    commit(ws, endpointActions(walk(ws), 3))
    const p = presentProof(input(ws.current, 'why'))
    expect(p.status.text).toBe('W₃ = (U₅ + S₅)/2 · |W₃| ≤ (5 + 1)/2 = 3 · positive part')
    expect(p.context.hint).toContain('The first 3 arrows of the new order are exactly the + arrows among the first 5 original steps.')
    expect(item(p, 'negative').run).toEqual({ kind: 'actions', actions: endpointActions(walk(ws), 9) })
  })
  it('k = 9: negative part, j = 6', () => {
    const ws = lesson()
    commit(ws, endpointActions(walk(ws), 9))
    const p = presentProof(input(ws.current, 'why', { detailsOpen: true }))
    expect(p.status.text).toBe('W₉ = (S₆ − U₆)/2 · |W₉| ≤ (5 + 1)/2 = 3 · negative part')
    const why = p.detail.sections.find((s) => s.title === 'Why W₉ is inside the new bound')!
    expect(JSON.stringify(why)).toContain('(-7/5, -7/5, -7/5)')
  })
  it('without a selected point it asks for one instead of guessing', () => {
    const p = presentProof(input(lesson().current, 'why'))
    expect(p.status.text).toMatch(/^Select a point/)
    expect(item(p, 'prev').enabled).toBe(false)
  })
})

describe('signs and assumptions', () => {
  it('flipping needs a selected arrow', () => {
    const ws = lesson()
    expect(item(presentProof(input(ws.current, 'signs')), 'flip').enabled).toBe(false)
    commit(ws, [{ kind: 'select_item', experimentId: PROOF_IDS.experiment, item: 'walk:vector:v1' }])
    const flip = item(presentProof(input(ws.current, 'signs')), 'flip')
    expect(flip.enabled).toBe(true)
    expect(flip.run).toEqual({ kind: 'actions', actions: [{ kind: 'set_walk_signs', experimentId: PROOF_IDS.experiment, signs: [{ id: 'v1', sign: 1 }] }] })
  })
  it('the counterexample: residual, failed bound, no Lean check', () => {
    const ws = lesson()
    commit(ws, caseActions(walk(ws), 'open-two'))
    const p = presentProof(input(ws.current, 'assumptions'))
    expect(p.status.text).toBe('The return-to-start assumption is missing. This lemma does not apply. Here, 2 exceeds 1.5.')
    expect(item(p, 'check').enabled).toBe(false)
    expect(item(p, 'restore').run).toEqual({ kind: 'actions', actions: caseActions(walk(ws), 'hero') })
    expect(p.context.hint).toContain('Residual T = (2, 0, 0)')
  })
  it('the all-positive variation says there is no improvement', () => {
    const ws = lesson()
    commit(ws, [{ kind: 'set_walk_signs', experimentId: PROOF_IDS.experiment, signs: walk(ws).vectors.map((v) => ({ id: v.id, sign: 1 })) }])
    expect(presentProof(input(ws.current, 'reorder')).status.text).toContain('Valid bound · no improvement from these signs.')
  })
  it('the closed walk offers a real Lean check request for the current data', () => {
    const p = presentProof(input(lesson().current, 'assumptions'))
    expect(item(p, 'check').run).toEqual({ kind: 'check', claim: { kind: 'walk_reorder_instance', experimentId: PROOF_IDS.experiment } })
  })
})
