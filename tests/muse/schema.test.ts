// The strict structured-output schema (server/muse/schema.ts) against the documented strict subset and
// against the real validators. Synthetic fixtures only; no provider is called.

import { describe, expect, it } from 'vitest'
import { ACTION_KINDS, parseProposal } from '../../src/workspace/actions'
import { CLAIM_KINDS } from '../../src/workspace/claims'
import { demoDocument, findExperiment } from '../../src/workspace/document'
import { ORDER_MATTERS, OPERATION_KINDS, WHAT_GETS_LOST } from '../../src/recipes/recipe'
import { Workspace, planTransaction } from '../../src/workspace/reducer'
import { ORDER_IDS, orderDemoActions, reverseRouteActions } from '../../src/demo/order'
import { bindingPortSets, proposalSchema } from '../../server/muse/schema'
import { FIXTURES } from '../../server/muse/synthetic'
import { schemaError } from './helpers'

type S = Record<string, unknown>
const ALLOWED = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'anyOf', 'enum', 'description'])

function walk(s: S, visit: (s: S, depth: number) => void, depth = 1): void {
  visit(s, depth)
  const inner = depth + (s.type === 'object' || s.type === 'array' ? 1 : 0)
  if (s.properties) for (const p of Object.values(s.properties as Record<string, S>)) walk(p, visit, inner)
  if (s.items) walk(s.items as S, visit, inner)
  if (s.anyOf) for (const v of s.anyOf as S[]) walk(v, visit, depth)
}

/** Kinds named by the `kind` enum of each anyOf variant under a path. */
const kinds = (variants: S[]) => variants.map((v) => ((v.properties as Record<string, S>).kind!.enum as string[])[0])

const bindQ = [
  { kind: 'create_map', name: 'q', label: 'Q', dimension: 3, definition: { preset: { kind: 'projection', keep: [false, true, true] } } },
  { kind: 'create_experiment', name: 'q', sampleSetId: 'grid3', branches: [{ id: 'main', mapIds: ['$q'] }] },
  { kind: 'bind_recipe', experimentId: '$q', recipeId: 'what-gets-lost', bindings: { samples: 'grid3', map: 'main', selection: 's(1,0,1)' } },
]

describe('proposal schema: documented strict subset', () => {
  const schema = proposalSchema(demoDocument())

  it('has a plain object root with no anyOf/oneOf/allOf/enum/not', () => {
    expect(schema.type).toBe('object')
    for (const k of ['anyOf', 'oneOf', 'allOf', 'enum', 'not']) expect(schema).not.toHaveProperty(k)
  })

  it('closes every object, requires every property and uses only documented keywords', () => {
    let objects = 0
    walk(schema, (s) => {
      for (const k of Object.keys(s)) expect(ALLOWED.has(k), `keyword ${k}`).toBe(true)
      if (s.type === 'object') {
        objects++
        expect(s.additionalProperties).toBe(false)
        expect([...(s.required as string[])].sort()).toEqual(Object.keys(s.properties as object).sort())
      }
    })
    expect(objects).toBeGreaterThan(30)
    expect(JSON.stringify(schema)).not.toMatch(/"(oneOf|allOf|\$ref|pattern|minLength|maxLength|minItems|maxItems|minimum|maximum)"/)
  })

  it('stays within the documented size limits (object/array nesting <= 10, < 120,000 characters)', () => {
    let maxDepth = 0
    walk(schema, (_, d) => (maxDepth = Math.max(maxDepth, d)))
    expect(maxDepth).toBeLessThanOrEqual(10)
    expect(JSON.stringify(schema).length).toBeLessThan(120_000)
  })

  it('has one action variant per W4 action kind, and the recipe and claim kinds of this build', () => {
    const actions = (schema.properties as Record<string, S>).actions!.items as S
    // Plus use_prepared, which names a prepared template and is expanded by the server (tests/muse/prepared.test.ts).
    expect(kinds(actions.anyOf as S[]).sort()).toEqual([...ACTION_KINDS, 'use_prepared'].sort())
    const save = (actions.anyOf as S[]).find((v) => kinds([v])[0] === 'save_recipe')!
    const recipe = (save.properties as Record<string, S>).recipe!
    const ops = ((recipe.properties as Record<string, S>).operations!.items as S).anyOf as S[]
    expect(kinds(ops).sort()).toEqual([...OPERATION_KINDS].sort())
    const check = (actions.anyOf as S[]).find((v) => kinds([v])[0] === 'request_check')!
    expect(kinds(((check.properties as Record<string, S>).claim!.anyOf as S[])).sort()).toEqual([...CLAIM_KINDS].sort())
  })

  it('derives bind_recipe port sets from the document recipes, plus the W2 and comparison ports', () => {
    const doc = demoDocument()
    const base = [['samples', 'map', 'selection'], ['samples', 'left', 'right', 'selection'], ['group', 'operation'], ['group', 'selection'], ['word', 'compare'], ['walk']]
    expect(bindingPortSets(doc)).toEqual(base)
    doc.recipes.push({ schemaVersion: 1, id: 'two-port', name: 'Two ports', inputs: { pts: WHAT_GETS_LOST.inputs.samples!, f: { type: 'linear_branch', sameDimensionAs: 'pts' } }, operations: [{ kind: 'linked_views', samples: 'pts', map: 'f' }] })
    expect(bindingPortSets(doc)).toEqual([...base, ['pts', 'f']])
  })
})

describe('proposal schema agrees with the validators', () => {
  const doc = demoDocument()
  const schema = proposalSchema(doc)

  it('accepts every synthetic fixture and the P -> Q transaction', () => {
    for (const f of FIXTURES) {
      const p = f.build(doc)
      expect(schemaError(schema, p), f.name).toBeNull()
      expect(() => planTransaction(doc, parseProposal(p).actions), f.name).not.toThrow()
    }
    expect(schemaError(schema, { proposalVersion: 1, title: 'Use Q', explanation: '', actions: bindQ })).toBeNull()
  })

  it('accepts every fixture on the comparison documents (prepared, reversed, displayed again after Q)', () => {
    const ws = new Workspace(demoDocument())
    ws.commit({ baseRevision: 0, actions: orderDemoActions(ws.current) })
    const order = ws.current
    ws.commit({ baseRevision: ws.current.revision, actions: reverseRouteActions(findExperiment(order, ORDER_IDS.experiment), 'left') })
    for (const d of [order, ws.current]) {
      const sch = proposalSchema(d)
      for (const f of FIXTURES) {
        const p = f.build(d)
        expect(schemaError(sch, p), f.name).toBeNull()
        expect(() => planTransaction(d, parseProposal(p).actions), f.name).not.toThrow()
      }
    }
  })

  it('accepts the prepared comparison (save_recipe ORDER_MATTERS, two-branch experiment, comparison bindings, play_comparison)', () => {
    const p = { proposalVersion: 1, title: 'Prepared comparison', explanation: '', actions: orderDemoActions(doc) }
    expect(p.actions).toHaveLength(7)
    expect(schemaError(schema, p)).toBeNull()
    expect(schemaError(schema, { ...p, actions: [{ kind: 'save_recipe', name: 'compare', recipe: ORDER_MATTERS }] })).toBeNull()
    expect(schemaError(schema, { ...p, actions: [{ kind: 'play_comparison', experimentId: 'exp-order', stepDuration: 1.6 }] })).toBeNull()
    expect(schemaError(schema, { ...p, actions: [{ kind: 'play_comparison', experimentId: 'exp-order', stepDuration: 1.6, branchId: 'left' }] })).toMatch(/anyOf/)
  })

  it('accepts the other action shapes the planner accepts', () => {
    const actions = [
      { kind: 'create_samples', name: 'g', dimension: 2, source: { preset: 'cartesian_-1_0_1' } },
      { kind: 'create_map', name: 'r', label: 'R', dimension: 3, definition: { matrix: [[{ n: '0', d: '1' }, { n: '-1', d: '1' }, { n: '0', d: '1' }], [{ n: '1', d: '1' }, { n: '0', d: '1' }, { n: '0', d: '1' }], [{ n: '0', d: '1' }, { n: '0', d: '1' }, { n: '1', d: '2' }]] } },
      { kind: 'set_branch', experimentId: 'exp-p', branchId: 'main', mapIds: ['map-p', '$r'] },
      { kind: 'set_view', ghostCube: false, sampleLabels: true },
      { kind: 'select', experimentId: 'exp-p', sampleId: null },
      { kind: 'play', experimentId: 'exp-p', branchId: 'main', transition: 'apply_map', duration: 1.5 },
      { kind: 'save_recipe', name: 'mine', recipe: { name: 'Groups only', inputs: { samples: { type: 'sample_set', dimensions: [3] }, map: { type: 'linear_branch', sameDimensionAs: 'samples' } }, operations: [{ kind: 'exact_output_groups', samples: 'samples', map: 'map' }] } },
      { kind: 'request_check', claim: { kind: 'map_difference_witness', left: { experimentId: 'exp-p', branchId: 'main' }, right: { experimentId: 'exp-p', branchId: 'main' }, basisIndex: 2 } },
    ]
    const proposal = { proposalVersion: 1, title: 'All shapes', explanation: 'Synthetic shapes.', actions }
    expect(schemaError(schema, proposal)).toBeNull()
    expect(() => planTransaction(doc, parseProposal(proposal).actions)).not.toThrow()
  })

  it('rejects an unknown field, an unknown action kind and a missing field', () => {
    expect(schemaError(schema, { proposalVersion: 1, title: 'x', explanation: '', actions: [], mode: 'answer' })).toMatch(/unknown field mode/)
    expect(schemaError(schema, { proposalVersion: 1, title: 'x', explanation: '', actions: [{ kind: 'run_code', source: 'print(1)' }] })).toMatch(/anyOf/)
    expect(schemaError(schema, { proposalVersion: 1, title: 'x', explanation: '' })).toMatch(/missing actions/)
  })
})
