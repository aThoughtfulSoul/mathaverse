// Workspace document, transaction planner, undo and the P -> Q recipe rebinding (WORKSPACE W1-W4,
// ACCEPTANCE A1 P/Q fixtures, A3, A4 invalid-transaction cases). Node only; no rendering.

import { describe, expect, it } from 'vitest'
import { demoDocument, docFromJson, docToJson, DocumentError, branchMatrix, findExperiment } from '../src/workspace/document'
import { Workspace, planTransaction, TransactionError, describeClaim, displayedMatrix } from '../src/workspace/reducer'
import { exactOutputGroups, projectorNullityOne, apply, vec } from '../src/model/linear'
import { toJson } from '../src/model/rational'
import { parseProposal, ActionError } from '../src/workspace/actions'
import { parseClaimDescriptor, evaluateExactly, claimHash } from '../src/workspace/claims'
import { canonicalJson } from '../src/workspace/canonical'

const ACTIVE_RECIPE = 'what-gets-lost'
const bindQ = [
  { kind: 'create_map', name: 'q', label: 'Q', dimension: 3, definition: { preset: { kind: 'projection', keep: [false, true, true] } } },
  { kind: 'create_experiment', name: 'q', sampleSetId: 'grid3', branches: [{ id: 'main', mapIds: ['$q'] }] },
  { kind: 'bind_recipe', experimentId: '$q', recipeId: ACTIVE_RECIPE, bindings: { samples: 'grid3', map: 'main', selection: 's(1,0,1)' } },
]

const groupOf = (doc: ReturnType<typeof demoDocument>, id: string) => {
  const e = findExperiment(doc, doc.selection.experimentId)
  const set = doc.sampleSets.find((s) => s.id === e.sampleSetId)!
  return exactOutputGroups(displayedMatrix(doc), set.samples).find((g) => g.ids.includes(id))!.ids.sort()
}

describe('workspace document (W1)', () => {
  it('the demo document validates and round-trips through JSON exactly', () => {
    const doc = demoDocument()
    const back = docFromJson(JSON.parse(JSON.stringify(docToJson(doc))))
    expect(canonicalJson(docToJson(back))).toBe(canonicalJson(docToJson(doc)))
  })
  it('import rejects unknown fields, bad rationals and preset metadata that does not match the matrix', () => {
    const j = docToJson(demoDocument()) as unknown as Record<string, unknown>
    expect(() => docFromJson({ ...j, extra: 1 })).toThrow(DocumentError)
    const bad = structuredClone(docToJson(demoDocument()))
    bad.maps[0]!.matrix[0]![0] = { n: '2', d: '4' }
    expect(() => docFromJson(bad)).toThrow(/coprime/)
    const lie = structuredClone(docToJson(demoDocument()))
    lie.maps[0]!.preset = { kind: 'projection', keep: [false, true, true] }
    expect(() => docFromJson(lie)).toThrow(/preset metadata/)
  })
})

describe('P -> Q through one recipe (A1, A3)', () => {
  it('under P, u and v share (1,0,0) and the fiber runs along z', () => {
    const doc = demoDocument()
    expect(groupOf(doc, 's(1,0,1)')).toEqual(['s(1,0,-1)', 's(1,0,0)', 's(1,0,1)'])
    expect(apply(displayedMatrix(doc), vec(1, 0, 1)).map(toJson)).toEqual([toJson({ n: 1n, d: 1n }), toJson({ n: 0n, d: 1n }), toJson({ n: 0n, d: 1n })])
    expect(projectorNullityOne(displayedMatrix(doc))).toBe(2)
  })
  it('binding the same recipe to Q separates u and v, groups a with b, and moves the fiber to x', () => {
    const ws = new Workspace(demoDocument())
    const { doc } = ws.commit({ baseRevision: 0, actions: bindQ })
    expect(doc.selection).toEqual({ experimentId: 'exp-q', sampleId: 's(1,0,1)', item: null })
    expect(findExperiment(doc, 'exp-q').binding?.recipeId).toBe(ACTIVE_RECIPE)
    const Q = displayedMatrix(doc)
    expect(apply(Q, vec(1, 0, 1)).map((x) => `${x.n}/${x.d}`)).toEqual(['0/1', '0/1', '1/1'])
    expect(apply(Q, vec(1, 0, -1)).map((x) => `${x.n}/${x.d}`)).toEqual(['0/1', '0/1', '-1/1'])
    expect(groupOf(doc, 's(1,0,1)')).not.toContain('s(1,0,-1)')
    expect(groupOf(doc, 's(1,1,0)')).toEqual(['s(-1,1,0)', 's(0,1,0)', 's(1,1,0)'])
    expect(projectorNullityOne(Q)).toBe(0)
    expect(doc.mathRevision).toBe(1)
    // Undo restores P through a new revision.
    const back = ws.undo()!
    expect(back.selection.experimentId).toBe('exp-p')
    expect(back.revision).toBe(2)
  })
  it('the P experiment keeps its own map: rebinding never edits P', () => {
    const ws = new Workspace(demoDocument())
    const { doc } = ws.commit({ baseRevision: 0, actions: bindQ })
    expect(projectorNullityOne(branchMatrix(doc, findExperiment(doc, 'exp-p'), 'main'))).toBe(2)
  })
})

describe('transactions are all-or-nothing (A4)', () => {
  it('an invalid last action after valid edits changes nothing', () => {
    const ws = new Workspace(demoDocument())
    const before = canonicalJson(docToJson(ws.current))
    expect(() => ws.commit({ baseRevision: 0, actions: [...bindQ, { kind: 'select', experimentId: '$q', sampleId: 's(9,9,9)' }] })).toThrow(TransactionError)
    expect(canonicalJson(docToJson(ws.current))).toBe(before)
    expect(ws.canUndo).toBe(false)
  })
  it('rejects unknown actions, unknown fields, out-of-range rationals, missing IDs, dimension mismatches and a stale base', () => {
    const doc = demoDocument()
    expect(() => planTransaction(doc, [{ kind: 'run_code', source: 'alert(1)' }])).toThrow(/unknown action kind/)
    expect(() => planTransaction(doc, [{ kind: 'select', experimentId: 'exp-p', sampleId: null, extra: true }])).toThrow(/unknown field/)
    expect(() => planTransaction(doc, [{ kind: 'update_sample', sampleSetId: 'grid3', sampleId: 's(1,0,1)', coords: [{ n: '9', d: '1' }, { n: '0', d: '1' }, { n: '0', d: '1' }] }])).toThrow(/authored range/)
    expect(() => planTransaction(doc, [{ kind: 'select', experimentId: 'exp-missing', sampleId: null }])).toThrow(/unknown experiment/)
    expect(() => planTransaction(doc, [{ kind: 'create_map', name: 'r', label: 'R', dimension: 2, definition: { preset: { kind: 'identity' } } }, { kind: 'set_branch', experimentId: 'exp-p', branchId: 'main', mapIds: ['$r'] }])).toThrow(/dimension/)
    const ws = new Workspace(doc)
    expect(() => ws.commit({ baseRevision: 5, actions: [] })).toThrow(/stale/)
  })
  it('a proposal envelope is closed and bounded', () => {
    expect(() => parseProposal({ proposalVersion: 1, title: 'x', explanation: '', actions: [], mode: 'answer' })).toThrow(ActionError)
    expect(() => parseProposal({ proposalVersion: 1, title: 'x'.repeat(81), explanation: '', actions: [] })).toThrow(ActionError)
    expect(parseProposal({ proposalVersion: 1, title: 'Use Q', explanation: 'Rebind.', actions: bindQ }).actions).toHaveLength(3)
  })
})

describe('claims (M9)', () => {
  it('the P collision claim evaluates exactly and hashes without display labels', async () => {
    const doc = demoDocument()
    const d1 = describeClaim(doc, { kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: 's(1,0,1)', v: 's(1,0,-1)' })
    const exact = parseClaimDescriptor(d1)
    expect(evaluateExactly(exact).holds).toBe(true)
    const renamed = structuredClone(d1)
    if (renamed.kind === 'same_image_witness') renamed.u.label = 'z'
    expect(await claimHash(parseClaimDescriptor(renamed))).toBe(await claimHash(exact))
  })
  it('P and Q differ on e_x (map_difference_witness) and P then P equals P (map_equality)', () => {
    const ws = new Workspace(demoDocument())
    const { doc } = ws.commit({ baseRevision: 0, actions: bindQ })
    const diff = describeClaim(doc, { kind: 'map_difference_witness', left: { experimentId: 'exp-p', branchId: 'main' }, right: { experimentId: 'exp-q', branchId: 'main' }, basisIndex: 0 })
    expect(evaluateExactly(parseClaimDescriptor(diff)).holds).toBe(true)
    if (diff.kind !== 'map_difference_witness') throw new Error('unexpected kind')
    const pp = { claimVersion: 1 as const, kind: 'map_equality' as const, dimension: diff.dimension, left: diff.left, right: [...diff.left, ...diff.left] }
    expect(evaluateExactly(parseClaimDescriptor(pp)).holds).toBe(true)
  })
})
