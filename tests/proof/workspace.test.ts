// The vector-walk domain through the one transaction planner (PROOF-EXPLORER-SPEC section 5): schema version 3
// and the lossless migration of v1/v2 documents, the five new actions, selection items (never clamped), the
// recipe binding the same rule to the hero and the simpler walk, Undo, export/import, the walk claim locator
// (refused for an open walk) and the presentation-only stage effect.

import { describe, expect, it } from 'vitest'
import { Workspace, TransactionError, planTransaction, describeClaim } from '../../src/workspace/reducer'
import { type Doc, demoDocument, docFromJson, docToJson, findWalkExperiment, walkInputOf } from '../../src/workspace/document'
import { parseAction } from '../../src/workspace/actions'
import { claimHash, parseClaimDescriptor } from '../../src/workspace/claims'
import { sceneInputFor } from '../../src/domains/registry'
import { REARRANGE_WALK, layoutOf } from '../../src/recipes/recipe'
import { deriveWalk } from '../../src/algebra/walk'
import { CASES, caseJson, caseOf } from '../../src/lessons/steinitz/cases'
import { PROOF_IDS, allPositiveActions, caseActions, endpointActions, flipSignActions, preparedSignsActions, proofActions } from '../../src/demo/proof'
import { demoOf } from '../../src/demo/order'
import { sculptureActions, braidActions } from '../../src/demo/four'

const commit = (ws: Workspace, actions: unknown[]) => ws.commit({ baseRevision: ws.current.revision, actions })
const lesson = () => {
  const ws = new Workspace(demoDocument())
  commit(ws, proofActions(ws.current))
  return ws
}
const walkOf = (doc: Doc) => findWalkExperiment(doc, PROOF_IDS.experiment)

describe('opening the lesson', () => {
  it('creates the hero walk through ordinary actions, bound to the saved recipe', () => {
    const ws = lesson()
    const e = walkOf(ws.current)
    expect(e.lesson).toBe('steinitz-reordering')
    expect(caseOf(walkInputOf(e))).toBe('hero')
    expect(e.binding).toEqual({ recipeId: PROOF_IDS.recipe, ports: { walk: 'walk' } })
    expect(layoutOf(ws.current.recipes.find((r) => r.id === PROOF_IDS.recipe)!)).toBe('walk_reordering')
    expect(demoOf(ws.current, e)).toBe('proof')
    expect(ws.current.selection).toEqual({ experimentId: e.id, sampleId: null, item: null })
    const si = sceneInputFor(ws.current)!
    expect(si.layout).toBe('walk')
    if (si.layout !== 'walk') throw new Error('walk')
    expect(si.walk.recipe?.operations.map((o) => o.kind)).toEqual(['walk_reordering', 'walk_bounds', 'prefix_correspondence'])
    // The document stores inputs only: nothing derived.
    const stored = docToJson(ws.current).experiments.find((x) => x.domain === 'vector_walk')!
    expect(Object.keys(stored).sort()).toEqual(['binding', 'dimension', 'domain', 'id', 'lesson', 'order', 'signs', 'vectors'])
    expect(Object.keys(stored.vectors[0]!).sort()).toEqual(['coords', 'id'])
  })
  it('opens again by selection, and fits beside every other demonstration', () => {
    const ws = new Workspace(demoDocument())
    commit(ws, sculptureActions(ws.current))
    commit(ws, braidActions(ws.current))
    commit(ws, proofActions(ws.current))
    expect(proofActions(ws.current)).toEqual([{ kind: 'select_item', experimentId: PROOF_IDS.experiment, item: null }])
    expect(ws.current.experiments.length).toBeLessThanOrEqual(10)
  })
})

describe('schema version 3', () => {
  it('round-trips exactly through export and import', () => {
    const ws = lesson()
    commit(ws, [...endpointActions(walkOf(ws.current), 9), ...flipSignActions(walkOf(ws.current), 'v4')])
    const json = docToJson(ws.current)
    expect(json.schemaVersion).toBe(3)
    const back = docFromJson(JSON.parse(JSON.stringify(json)))
    expect(docToJson(back)).toEqual(json)
    expect(deriveWalk(walkInputOf(walkOf(back))).W).toEqual(deriveWalk(walkInputOf(walkOf(ws.current))).W)
  })
  it('loads version-2 and version-1 documents losslessly', () => {
    const v3 = docToJson(demoDocument()) as unknown as Record<string, unknown>
    const v2 = { ...v3, schemaVersion: 2 }
    expect(docToJson(docFromJson(v2))).toEqual(docToJson(demoDocument()))
    const v1 = { ...v3, schemaVersion: 1, experiments: (v3.experiments as Record<string, unknown>[]).map(({ domain: _d, ...e }) => e), selection: { experimentId: 'exp-p', sampleId: 's(1,0,1)' } }
    delete (v1 as Record<string, unknown>).groups
    expect(docToJson(docFromJson(v1))).toEqual(docToJson(demoDocument()))
  })
  it('refuses tampered walk data on import', () => {
    const json = docToJson(lesson().current) as unknown as { experiments: Record<string, unknown>[] }
    const walk = () => json.experiments.find((e) => e.domain === 'vector_walk')!
    const bad = (mutate: (w: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(json)) as typeof json
      mutate(copy.experiments.find((e) => e.domain === 'vector_walk')!)
      return () => docFromJson(copy)
    }
    expect(walk()).toBeTruthy()
    expect(bad((w) => ((w.order as string[])[1] = 'v0'))).toThrow(/twice/)
    expect(bad((w) => ((w.signs as number[])[0] = 0))).toThrow(/1 or -1/)
    expect(bad((w) => (w.lesson = 'https://example.com/other-proof'))).toThrow(/lesson/)
    expect(bad((w) => (w.peak = 5))).toThrow(/unknown field/)
    expect(bad((w) => (((w.vectors as { coords: unknown[] }[])[0]!.coords[0] = { n: '9', d: '1' })))).toThrow(/outside/)
  })
})

describe('the new actions', () => {
  it('set_walk_signs changes the derived walk, keeps the rest, and is undoable', () => {
    const ws = lesson()
    const before = deriveWalk(walkInputOf(walkOf(ws.current)))
    const r = commit(ws, flipSignActions(walkOf(ws.current), 'v1'))
    expect(r.plan.math).toBe(true)
    const e = walkOf(ws.current)
    expect(e.signs.slice(0, 3)).toEqual([1, 1, 1])
    const after = deriveWalk(walkInputOf(e))
    expect(after.permutation).not.toEqual(before.permutation)
    expect(after.U).toEqual(before.U) // the source walk and B never change with signs
    expect(after.B).toBe(before.B)
    expect(caseOf(walkInputOf(e))).toBeNull()
    ws.undo()
    expect(caseOf(walkInputOf(walkOf(ws.current)))).toBe('hero')
  })
  it('all positive gives the valid no-improvement case; prepared signs restore the hero', () => {
    const ws = lesson()
    commit(ws, allPositiveActions(walkOf(ws.current)))
    expect(caseOf(walkInputOf(walkOf(ws.current)))).toBe('all-positive')
    expect(deriveWalk(walkInputOf(walkOf(ws.current))).comparison).toBe('same')
    commit(ws, preparedSignsActions(walkOf(ws.current)))
    expect(caseOf(walkInputOf(walkOf(ws.current)))).toBe('hero')
    expect(preparedSignsActions(walkOf(ws.current))).toEqual([])
  })
  it('set_walk_order keeps each sign with its occurrence', () => {
    const ws = lesson()
    const e = walkOf(ws.current)
    commit(ws, [{ kind: 'set_walk_order', experimentId: e.id, order: [...e.order].reverse() }])
    const f = deriveWalk(walkInputOf(walkOf(ws.current)))
    expect(f.ids[0]).toBe('v11')
    expect(f.signs[0]).toBe(-1) // v11's sign, not position 0's
    expect(f.boundHolds).toBe(true)
    expect(() => commit(ws, [{ kind: 'set_walk_order', experimentId: e.id, order: e.order.slice(1) }])).toThrow(TransactionError)
    expect(() => commit(ws, [{ kind: 'set_walk_order', experimentId: e.id, order: [...e.order.slice(1), 'v1'] }])).toThrow(/twice/)
  })
  it('set_vector_walk swaps prepared cases atomically; Undo restores the previous case; a stale item is cleared', () => {
    const ws = lesson()
    commit(ws, endpointActions(walkOf(ws.current), 9))
    commit(ws, caseActions(walkOf(ws.current), 'open-two'))
    expect(caseOf(walkInputOf(walkOf(ws.current)))).toBe('open-two')
    expect(ws.current.selection.item).toBeNull() // walk:reordered:9 does not exist in a 2-arrow walk
    expect(walkOf(ws.current).binding).toEqual({ recipeId: PROOF_IDS.recipe, ports: { walk: 'walk' } })
    ws.undo()
    expect(caseOf(walkInputOf(walkOf(ws.current)))).toBe('hero')
    expect(ws.current.selection.item).toBe('walk:reordered:9')
  })
  it('select_item validates the walk grammar and never clamps', () => {
    const ws = lesson()
    const e = walkOf(ws.current)
    for (const item of ['walk:reordered:0', 'walk:reordered:12', 'walk:source:6', 'walk:signed:1', 'walk:vector:v11']) {
      commit(ws, [{ kind: 'select_item', experimentId: e.id, item }])
      expect(ws.current.selection.item).toBe(item)
    }
    for (const item of ['walk:reordered:13', 'walk:vector:v12', 'walk:source:-1', 'reordered:3', 'c1']) expect(() => commit(ws, [{ kind: 'select_item', experimentId: e.id, item }]), item).toThrow(TransactionError)
  })
  it('structural validation rejects malformed walk actions', () => {
    const hero = caseJson('hero')
    expect(() => parseAction({ kind: 'create_vector_walk', name: 'w', ...hero, lesson: 'other' })).toThrow()
    expect(() => parseAction({ kind: 'create_vector_walk', name: 'w', ...hero, signs: hero.signs.slice(1), lesson: null })).toThrow()
    expect(() => parseAction({ kind: 'set_walk_signs', experimentId: 'exp-walk', signs: [{ id: 'v0', sign: 1 }, { id: 'v0', sign: -1 }] })).toThrow()
    expect(() => parseAction({ kind: 'set_walk_signs', experimentId: 'exp-walk', signs: [{ id: 'v0', sign: 2 }] })).toThrow()
    expect(() => parseAction({ kind: 'show_walk_stage', experimentId: 'exp-walk', stage: 'proof' })).toThrow()
    expect(() => parseAction({ kind: 'set_vector_walk', experimentId: 'exp-walk', ...hero, vectors: [...hero.vectors, ...hero.vectors] })).toThrow()
  })
  it('semantic validation: unknown occurrences, coordinate bounds and other domains', () => {
    const ws = lesson()
    const e = walkOf(ws.current)
    expect(() => commit(ws, [{ kind: 'set_walk_signs', experimentId: e.id, signs: [{ id: 'v99', sign: 1 }] }])).toThrow(/no occurrence/)
    const big = caseJson('hero')
    big.vectors[0]!.coords[0] = { n: '5', d: '1' }
    expect(() => commit(ws, [{ kind: 'set_vector_walk', experimentId: e.id, ...big }])).toThrow(/outside/)
    expect(() => commit(ws, [{ kind: 'set_walk_signs', experimentId: 'exp-p', signs: [{ id: 'v0', sign: 1 }] }])).toThrow(/not a vector-walk/)
  })
})

describe('the same recipe on two walks', () => {
  it('binds through bind_recipe to a hero experiment and a simpler one, with the same derivation', () => {
    const ws = lesson()
    commit(ws, [{ kind: 'create_vector_walk', name: 'line', ...caseJson('line-six'), lesson: null }, { kind: 'bind_recipe', experimentId: '$line', recipeId: PROOF_IDS.recipe, bindings: { walk: 'walk' } }])
    const line = findWalkExperiment(ws.current, 'exp-line')
    expect(line.binding?.recipeId).toBe(walkOf(ws.current).binding?.recipeId)
    expect(ws.current.recipes.filter((r) => r.id === PROOF_IDS.recipe)).toHaveLength(1)
    const si = sceneInputFor(ws.current)!
    if (si.layout !== 'walk') throw new Error('walk')
    expect(deriveWalk(si.walk.walk).R).toEqual(deriveWalk(CASES['line-six'].input).R)
    expect(() => commit(ws, [{ kind: 'bind_recipe', experimentId: 'exp-line', recipeId: PROOF_IDS.recipe, bindings: { walk: 'word' } }])).toThrow(/"walk"/)
  })
  it('a walk recipe cannot bind to another domain', () => {
    const ws = lesson()
    expect(() => commit(ws, [{ kind: 'bind_recipe', experimentId: 'exp-p', recipeId: PROOF_IDS.recipe, bindings: { walk: 'walk' } }])).toThrow(TransactionError)
    expect(REARRANGE_WALK.inputs.walk).toEqual({ type: 'vector_walk' })
  })
})

describe('the walk claim and the stage effect', () => {
  it('request_check resolves the current data; the hash ignores the selected endpoint and changes with a sign', async () => {
    const ws = lesson()
    const e = walkOf(ws.current)
    const claim = { kind: 'walk_reorder_instance', experimentId: e.id } as const
    const plan = planTransaction(ws.current, [{ kind: 'request_check', claim }])
    expect(plan.effects).toEqual([{ kind: 'request_check', claim }])
    const h0 = await claimHash(parseClaimDescriptor(describeClaim(ws.current, claim)))
    commit(ws, endpointActions(e, 3))
    expect(await claimHash(parseClaimDescriptor(describeClaim(ws.current, claim)))).toBe(h0)
    commit(ws, flipSignActions(walkOf(ws.current), 'v0'))
    expect(await claimHash(parseClaimDescriptor(describeClaim(ws.current, claim)))).not.toBe(h0)
  })
  it('the open walk refuses a check request: no vacuous certificate', () => {
    const ws = lesson()
    commit(ws, caseActions(walkOf(ws.current), 'open-two'))
    expect(() => planTransaction(ws.current, [{ kind: 'request_check', claim: { kind: 'walk_reorder_instance', experimentId: PROOF_IDS.experiment } }])).toThrow(/does not return to its start/)
  })
  it('show_walk_stage is an effect on the displayed walk, never a document change', () => {
    const ws = lesson()
    const plan = planTransaction(ws.current, [{ kind: 'show_walk_stage', experimentId: PROOF_IDS.experiment, stage: 'why' }])
    expect(plan.changed).toBe(false)
    expect(plan.effects).toEqual([{ kind: 'show_walk_stage', experimentId: PROOF_IDS.experiment, stage: 'why' }])
    commit(ws, [{ kind: 'select', experimentId: 'exp-p', sampleId: null }])
    expect(() => planTransaction(ws.current, [{ kind: 'show_walk_stage', experimentId: PROOF_IDS.experiment, stage: 'why' }])).toThrow(/displayed/)
  })
})
