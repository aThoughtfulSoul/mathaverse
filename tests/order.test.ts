// Shared-contract checks for the operation-order demonstration: the prepared actions, exact SR / RS on the
// witness and corners, play_comparison planning, a route reversal with Undo, and persistence.

import { describe, it, expect } from 'vitest'
import { demoDocument, docFromJson, docToJson, findExperiment, branchMatrix, branchSymbol } from '../src/workspace/document'
import { Workspace, planTransaction, describeClaim, TransactionError } from '../src/workspace/reducer'
import { parseClaimDescriptor, evaluateExactly } from '../src/workspace/claims'
import { orderDemoActions, pqDemoActions, reverseRouteActions, orderWords, demoOf, ORDER_IDS } from '../src/demo/order'
import { bindingsFor, rebindTarget } from '../src/demo/pq'
import { apply, vec, matEq } from '../src/model/linear'
import { format } from '../src/model/rational'
import { PROPOSAL_LIMITS, parseEvidenceRefs } from '../src/workspace/actions'
import { validateRule, ORDER_MATTERS, RecipeError } from '../src/recipes/recipe'
import { computeFacts } from '../src/workspace/context'

const t = (v: ReturnType<typeof vec>) => `(${v.map(format).join(', ')})`

function withOrder() {
  const ws = new Workspace(demoDocument())
  const actions = orderDemoActions(ws.current)
  const { plan } = ws.commit({ baseRevision: 0, actions })
  return { ws, actions, plan }
}

describe('operation-order demonstration (shared contract)', () => {
  it('is created by at most eight validated actions and replays as a comparison', () => {
    const { ws, actions, plan } = withOrder()
    expect(actions.length).toBeLessThanOrEqual(PROPOSAL_LIMITS.actions)
    expect(plan.effects).toEqual([{ kind: 'play_comparison', experimentId: ORDER_IDS.experiment, stepDuration: 1.6 }])
    const e = findExperiment(ws.current, ORDER_IDS.experiment)
    expect(ws.current.selection).toEqual({ experimentId: ORDER_IDS.experiment, sampleId: ORDER_IDS.witness, item: null })
    expect(demoOf(ws.current, e)).toBe('order')
    expect(orderWords(ws.current, e, 'left')).toBe('R then S')
    expect(branchSymbol(ws.current, e, 'left')).toBe('SR')
    expect(branchSymbol(ws.current, e, 'right')).toBe('RS')
  })

  it('resolves SR and RS exactly (handoff table)', () => {
    const { ws } = withOrder()
    const e = findExperiment(ws.current, ORDER_IDS.experiment)
    const SR = branchMatrix(ws.current, e, 'left')
    const RS = branchMatrix(ws.current, e, 'right')
    expect(SR.map((r) => r.map(format))).toEqual([['0', '-1', '0'], ['-1', '0', '0'], ['0', '0', '1']])
    expect(RS.map((r) => r.map(format))).toEqual([['0', '1', '0'], ['1', '0', '0'], ['0', '0', '1']])
    const e1 = vec(1, 0, 0)
    const a = vec(1, 1, 0)
    expect(t(apply(SR, e1))).toBe('(0, -1, 0)')
    expect(t(apply(RS, e1))).toBe('(0, 1, 0)')
    expect(t(apply(SR, a))).toBe('(-1, -1, 0)')
    expect(t(apply(RS, a))).toBe('(1, 1, 0)')
    // The first step of each route: R e1 = (0, 1, 0); S e1 = e1 (fixed).
    const R = ws.current.maps.find((m) => m.id === ORDER_IDS.mapR)!.matrix
    const S = ws.current.maps.find((m) => m.id === ORDER_IDS.mapS)!.matrix
    expect(t(apply(R, e1))).toBe('(0, 1, 0)')
    expect(t(apply(S, e1))).toBe('(1, 0, 0)')
  })

  it('witnesses SR e1 != RS e1 with the existing map_difference_witness claim', () => {
    const { ws } = withOrder()
    const claim = { kind: 'map_difference_witness' as const, left: { experimentId: ORDER_IDS.experiment, branchId: 'left' }, right: { experimentId: ORDER_IDS.experiment, branchId: 'right' }, basisIndex: 0 }
    const r = evaluateExactly(parseClaimDescriptor(describeClaim(ws.current, claim)))
    expect(r).toEqual({ holds: true, detail: 'images of e1: (0, -1, 0) and (0, 1, 0)' })
  })

  it('reverses a route through set_branch; equal routes agree; Undo restores the order', () => {
    const { ws } = withOrder()
    const e = findExperiment(ws.current, ORDER_IDS.experiment)
    ws.commit({ baseRevision: ws.current.revision, actions: reverseRouteActions(e, 'left') })
    const e2 = findExperiment(ws.current, ORDER_IDS.experiment)
    expect(orderWords(ws.current, e2, 'left')).toBe('S then R')
    expect(matEq(branchMatrix(ws.current, e2, 'left'), branchMatrix(ws.current, e2, 'right'))).toBe(true)
    const eq = evaluateExactly(parseClaimDescriptor(describeClaim(ws.current, { kind: 'map_equality', left: { experimentId: e2.id, branchId: 'left' }, right: { experimentId: e2.id, branchId: 'right' } })))
    expect(eq.holds).toBe(true)
    ws.undo()
    expect(orderWords(ws.current, findExperiment(ws.current, ORDER_IDS.experiment), 'left')).toBe('R then S')
  })

  it('refuses one-branch play on a comparison and play_comparison on linked views', () => {
    const { ws } = withOrder()
    expect(() => planTransaction(ws.current, [{ kind: 'play', experimentId: ORDER_IDS.experiment, branchId: 'left', transition: 'apply_map', duration: 2 }])).toThrow(/use play_comparison/)
    const pq = new Workspace(demoDocument())
    expect(() => planTransaction(pq.current, [{ kind: 'play_comparison', experimentId: 'exp-p', stepDuration: 2 }])).toThrow(TransactionError)
  })

  it('switches demos without touching the P-to-Q experiments, and keeps Use on Q to P/Q', () => {
    const { ws } = withOrder()
    expect(rebindTarget(ws.current).actions).toEqual([])
    ws.commit({ baseRevision: ws.current.revision, actions: pqDemoActions(ws.current, 'exp-p', 's(1,0,1)') })
    expect(ws.current.selection).toEqual({ experimentId: 'exp-p', sampleId: 's(1,0,1)', item: null })
    const q = rebindTarget(ws.current)
    expect(q.label).toBe('Use on Q')
    ws.commit({ baseRevision: ws.current.revision, actions: q.actions })
    expect(ws.current.experiments.map((e) => e.id)).toEqual(['exp-p', 'exp-order', 'exp-q'])
    expect(rebindTarget(ws.current).label).toBe('Show P')
    // Back to the comparison: a select, nothing recreated.
    expect(orderDemoActions(ws.current)).toEqual([{ kind: 'select', experimentId: ORDER_IDS.experiment, sampleId: ORDER_IDS.witness }])
  })

  it('a representation saved after Q exists is reused on Q (rebound), not just navigated to', () => {
    const ws = new Workspace(demoDocument())
    const commitAll = (actions: unknown[]) => ws.commit({ baseRevision: ws.current.revision, actions })
    commitAll(rebindTarget(ws.current).actions) // Use on Q: creates Q with P's recipe
    commitAll(rebindTarget(ws.current).actions) // Show P (both share the recipe)
    expect(ws.current.selection.experimentId).toBe('exp-p')
    const p = ws.current.experiments.find((e) => e.id === 'exp-p')!
    const recipe = ws.current.recipes.find((r) => r.id === (p as { binding: { recipeId: string } }).binding.recipeId)!
    commitAll([
      { kind: 'save_recipe', name: 'adapted1', recipe: { name: 'adapted', inputs: recipe.inputs, operations: recipe.operations.slice(0, 2) } },
      { kind: 'bind_recipe', experimentId: 'exp-p', recipeId: '$adapted1', bindings: bindingsFor({ ...ws.current, recipes: [...ws.current.recipes, { schemaVersion: 1, id: 'recipe-adapted1', name: 'adapted', inputs: recipe.inputs, operations: recipe.operations.slice(0, 2) }] }, 'recipe-adapted1', 'grid3', 'main', ws.current.selection.sampleId) },
    ])
    const reuse = rebindTarget(ws.current)
    expect(reuse.label).toBe('Use on Q')
    expect(reuse.actions).toEqual([expect.objectContaining({ kind: 'bind_recipe', experimentId: 'exp-q', recipeId: 'recipe-adapted1' })])
    commitAll(reuse.actions)
    expect(ws.current.selection.experimentId).toBe('exp-q')
    expect(ws.current.experiments.find((e) => e.id === 'exp-q')!.binding!.recipeId).toBe('recipe-adapted1')
    // Now both use it: the control only shows the other experiment.
    expect(rebindTarget(ws.current)).toMatchObject({ label: 'Show P', actions: [{ kind: 'select', experimentId: 'exp-p' }] })
  })

  it('saves and reopens with branch order, sample identities and the bound recipe intact', () => {
    const { ws } = withOrder()
    const e = findExperiment(ws.current, ORDER_IDS.experiment)
    ws.commit({ baseRevision: ws.current.revision, actions: reverseRouteActions(e, 'right') })
    const back = docFromJson(JSON.parse(JSON.stringify(docToJson(ws.current))))
    expect(docToJson(back)).toEqual(docToJson(ws.current))
    const e2 = findExperiment(back, ORDER_IDS.experiment)
    expect(e2.branches).toEqual([{ id: 'left', mapIds: ['map-r', 'map-s'] }, { id: 'right', mapIds: ['map-r', 'map-s'] }])
    expect(e2.binding).toEqual({ recipeId: ORDER_IDS.recipe, ports: { samples: ORDER_IDS.sampleSet, left: 'left', right: 'right', selection: 'workspace.selection' } })
    expect(back.sampleSets.find((s) => s.id === ORDER_IDS.sampleSet)!.samples.map((s) => `${s.id}:${s.label}`)).toEqual(['s(1,1,0):a', 's(-1,1,0):b', 's(-1,-1,0):c', 's(1,-1,0):d', 's(1,0,0):e_{1}'])
  })

  it('states the order and the comparison as exact facts', () => {
    const { ws } = withOrder()
    const facts = computeFacts(ws.current).filter((f) => f.kind === 'order' || f.kind === 'comparison').map((f) => f.text)
    expect(facts).toContain('the left route (exp-order/left) applies R then S, resolving to SR')
    expect(facts.find((f) => f.startsWith('SR (left) and RS (right) differ'))).toContain('SRe_{1} = (0, -1, 0), RSe_{1} = (0, 1, 0)')
  })

  it('validates the new recipe operations closed', () => {
    expect(validateRule(ORDER_MATTERS)).toEqual(ORDER_MATTERS)
    expect(() => validateRule({ ...ORDER_MATTERS, operations: [{ kind: 'branch_comparison', samples: 'samples', left: 'left', right: 'left' }] })).toThrow(RecipeError)
    expect(() => validateRule({ ...ORDER_MATTERS, operations: [{ kind: 'sample_outline', samples: 'samples', vertices: ['s(1,1,0)'] }] })).toThrow(/2\.\.8/)
    expect(() => validateRule({ ...ORDER_MATTERS, operations: [...ORDER_MATTERS.operations, { kind: 'linked_views', samples: 'samples', map: 'left' }] })).toThrow(/alternative layouts/)
  })

  it('parses W5 evidence references closed', () => {
    const claim = { kind: 'map_equality', left: { experimentId: 'exp-p', branchId: 'main' }, right: { experimentId: 'exp-q', branchId: 'main' } }
    expect(parseEvidenceRefs([{ claim, claimHash: 'a'.repeat(64), receiptId: '7f1c2b8e-0000-4000-8000-000000000000' }])).toHaveLength(1)
    expect(() => parseEvidenceRefs([{ claimHash: 'a'.repeat(64), receiptId: 'x' }])).toThrow(/missing field "claim"/)
    expect(() => parseEvidenceRefs([{ claim, claimHash: 'zz', receiptId: 'x' }])).toThrow(/SHA-256/)
  })
})
