// The four algebra demonstrations through the shared engine (FOUR-DEMOS-PARALLEL-HANDOFF section 11, checks
// 1-4, 6 and 7 at the coordinator's level): exact core fixtures, every new action through the planner, the
// prepared demos, the same recipe rebound from C4 to V4, schema v2 migration and round trips, Muse fixtures.

import { describe, expect, it } from 'vitest'
import { groupOf, regularPermutation, chronologicalProduct, rotationId, rotationInfo } from '../src/algebra/groups'
import { compose, cycles, transposition } from '../src/algebra/permutation'
import { DIAGONALS, KERNEL, axisClasses, classKey, phiOf, piOf, rotationForDiagonalPermutation } from '../src/algebra/cube'
import { applyRewrite, compareWords, endpointPermutation, exponentSum, invertWord } from '../src/algebra/braid'
import { Workspace, planTransaction, TransactionError } from '../src/workspace/reducer'
import { type Doc, demoDocument, docFromJson, docToJson, findGroupExperiment, findBraidExperiment } from '../src/workspace/document'
import { exportText, importText } from '../src/storage/persist'
import { computeFacts } from '../src/workspace/context'
import { FOUR_IDS, RZ90, H_TURN, braidActions, cubeActions, quotientActions, sculptureActions, sculptureRebindActions, domainControls } from '../src/demo/four'
import { orderDemoActions } from '../src/demo/order'
import { sceneInputFor } from '../src/domains/registry'
import { FIXTURES, matchFixture } from '../server/muse/synthetic'
import { parseProposal } from '../src/workspace/actions'
import { proposalSchema } from '../server/muse/schema'

const commit = (ws: Workspace, actions: unknown[]) => ws.commit({ baseRevision: ws.current.revision, actions })

describe('exact core fixtures (handoff sections 5-8)', () => {
  it('C4 and V4: orders and regular-action cycles', () => {
    const c4 = groupOf({ kind: 'cyclic', order: 4 })
    const v4 = groupOf({ kind: 'klein_four' })
    expect(c4.elements.map((e) => c4.elementOrder(e))).toEqual([1, 4, 2, 4])
    expect(v4.elements.map((e) => v4.elementOrder(e))).toEqual([1, 2, 2, 2])
    expect(cycles(regularPermutation(c4, 'c1')).map((c) => c.length)).toEqual([4])
    expect(cycles(regularPermutation(c4, 'c2')).map((c) => c.length)).toEqual([2, 2])
    for (const e of v4.elements.slice(1)) expect(cycles(regularPermutation(v4, e)).map((c) => c.length)).toEqual([2, 2])
    expect(chronologicalProduct(c4, ['c1', 'c1', 'c1', 'c1'])).toBe('c0')
    expect(chronologicalProduct(v4, ['v10', 'v10'])).toBe('v00')
  })

  it('G: 24 rotations; phi and pi fixtures; the six classes; Rz90 order 4 but order 2 on axis lines', () => {
    const G = groupOf({ kind: 'cube_rotations' })
    expect(G.order).toBe(24)
    expect(rotationId([[0, -1, 0], [1, 0, 0], [0, 0, 1]])).toBe(RZ90)
    expect(rotationId([[-1, 0, 0], [0, 0, 1], [0, 1, 0]])).toBe(H_TURN)
    expect(phiOf(RZ90)).toEqual([1, 3, 0, 2])
    expect(phiOf(H_TURN)).toEqual([1, 0, 2, 3])
    expect(rotationInfo(G.matrix(H_TURN)!).kind).toBe('edge')
    expect(G.elementOrder(RZ90)).toBe(4)
    expect(piOf(RZ90)).toEqual([1, 0, 2])
    expect(new Set(G.elements.map((e) => phiOf(e).join(''))).size).toBe(24)
    for (const a of G.elements) for (const b of G.elements) {
      expect(phiOf(G.multiply(a, b))).toEqual(compose(phiOf(a), phiOf(b)))
      expect(piOf(G.multiply(a, b))).toEqual(compose(piOf(a), piOf(b)))
    }
    const cls = axisClasses()
    expect(cls.map((c) => c.elements.length)).toEqual([4, 4, 4, 4, 4, 4])
    expect(cls.find((c) => c.key === '012')!.elements.sort()).toEqual([...KERNEL].sort())
    expect(DIAGONALS).toHaveLength(4)
  })

  it('braids: [1,1] differs from the identity by exponent sum; [1,-1] cancels; the relation rewrites', () => {
    expect(endpointPermutation([1, 1])).toEqual(endpointPermutation([]))
    expect(compareWords([1, 1], [])).toEqual({ kind: 'different', invariant: 'exponent_sum' })
    expect(applyRewrite([1, -1], { rule: 'cancel_pair', at: 0, generator: null })).toEqual([])
    expect(applyRewrite([1, 2, 1], { rule: 'braid_relation', at: 0, generator: null })).toEqual([2, 1, 2])
    expect(() => applyRewrite([1, 1], { rule: 'cancel_pair', at: 0, generator: null })).toThrow(/not inverse/)
    expect(invertWord([1, 2, -1])).toEqual([1, -2, -1])
    expect(exponentSum([1, 2, 1])).toBe(3)
    expect(compareWords([1, 2, 1], [2, 1, 2])).toEqual({ kind: 'not_established' })
  })
})

describe('the four demonstrations through the planner', () => {
  it('all four presets open, and the earlier demonstrations coexist', () => {
    const ws = new Workspace(demoDocument())
    commit(ws, orderDemoActions(ws.current))
    for (const f of [sculptureActions, cubeActions, quotientActions, braidActions]) commit(ws, f(ws.current))
    expect(ws.current.experiments.map((e) => e.id)).toEqual(['exp-p', 'exp-order', FOUR_IDS.expC4, FOUR_IDS.expCube, FOUR_IDS.expQuotient, FOUR_IDS.expBraid])
    expect(ws.current.groups.map((g) => g.id)).toEqual([FOUR_IDS.groupC4, FOUR_IDS.groupCube])
    // Re-opening is a select_item, never a duplicate.
    expect(sculptureActions(ws.current)).toEqual([{ kind: 'select_item', experimentId: FOUR_IDS.expC4, item: 'c1' }])
  })

  it('group facts: "returns home" is claimed only when repeating the last operation really does (mixed histories)', () => {
    const ws = new Workspace(demoDocument())
    commit(ws, sculptureActions(ws.current))
    const stateText = (id: string) => computeFacts(ws.current).find((f) => f.id === `state:${id}`)!.text
    // C4: +1 then +2 gives k = 3; repeating +2 cycles 3 -> 1 -> 3, never 0; +1 (the inverse of 3) once does.
    commit(ws, [{ kind: 'apply_element', experimentId: FOUR_IDS.expC4, element: 'c1' }, { kind: 'apply_element', experimentId: FOUR_IDS.expC4, element: 'c2' }])
    expect(stateText(FOUR_IDS.expC4)).toContain('repeating 2 never returns home; applying 1 once does')
    expect(stateText(FOUR_IDS.expC4)).not.toMatch(/more times? returns home/)
    // C4: +1 twice gives k = 2; +1 twice more returns home.
    commit(ws, [{ kind: 'reset_group', experimentId: FOUR_IDS.expC4 }, { kind: 'apply_element', experimentId: FOUR_IDS.expC4, element: 'c1' }, { kind: 'apply_element', experimentId: FOUR_IDS.expC4, element: 'c1' }])
    expect(stateText(FOUR_IDS.expC4)).toContain('applying 1 2 more times returns home')
    // V4: (1,0) then (0,1) gives (1,1), which (0,1) never undoes; (1,1) is its own inverse.
    commit(ws, sculptureRebindActions(ws.current, findGroupExperiment(ws.current, FOUR_IDS.expC4)))
    commit(ws, [{ kind: 'apply_element', experimentId: FOUR_IDS.expV4, element: 'v10' }, { kind: 'apply_element', experimentId: FOUR_IDS.expV4, element: 'v01' }])
    expect(stateText(FOUR_IDS.expV4)).toContain('repeating (0,1) never returns home; applying (1,1) once does')
    // Cube: every claim made after mixed rotations is checked against the group itself.
    commit(ws, cubeActions(ws.current))
    const G = groupOf({ kind: 'cube_rotations' })
    for (const [a, b] of [[RZ90, H_TURN], [H_TURN, RZ90], [RZ90, RZ90]] as const) {
      commit(ws, [{ kind: 'reset_group', experimentId: FOUR_IDS.expCube }, { kind: 'apply_element', experimentId: FOUR_IDS.expCube, element: a }, { kind: 'apply_element', experimentId: FOUR_IDS.expCube, element: b }])
      const k = chronologicalProduct(G, [a, b])
      const m = stateText(FOUR_IDS.expCube).match(/applying \S+ (\d+) more times? returns home/)
      if (m) {
        let x = k
        for (let i = 0; i < Number(m[1]); i++) x = G.multiply(b, x)
        expect(x).toBe(G.identity)
      } else expect(stateText(FOUR_IDS.expCube)).toContain(`applying ${G.label(G.inverse(k)).plain.replace(/\^2/g, '²').replace(/\^3/g, '³')} once does`)
    }
  })

  it('selection summaries name items as the learner reads them (never an internal ID)', () => {
    const ws = new Workspace(demoDocument())
    commit(ws, quotientActions(ws.current))
    expect(commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expQuotient, item: 'class:102' }]).plan.summary).toEqual(['Selected the class [1,0,2]'])
    commit(ws, braidActions(ws.current))
    expect(commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expBraid, item: 'crossing:0' }]).plan.summary).toEqual(['Selected crossing 1'])
  })

  it('sculpture: apply c1 four times returns home; the SAME recipe rebinds to V4 and computes different cycles', () => {
    const ws = new Workspace(demoDocument())
    commit(ws, sculptureActions(ws.current))
    for (let k = 0; k < 4; k++) commit(ws, [{ kind: 'apply_element', experimentId: FOUR_IDS.expC4, element: 'c1' }])
    let input = sceneInputFor(ws.current)!
    expect(input.layout).toBe('sculpture')
    if (input.layout === 'braid' || input.layout === 'walk') throw new Error('unexpected')
    expect(input.group.accumulated).toBe('c0')
    expect(input.group.history).toHaveLength(4)
    const recipeId = findGroupExperiment(ws.current, FOUR_IDS.expC4).binding!.recipeId
    commit(ws, sculptureRebindActions(ws.current, findGroupExperiment(ws.current, FOUR_IDS.expC4)))
    expect(findGroupExperiment(ws.current, FOUR_IDS.expV4).binding!.recipeId).toBe(recipeId)
    commit(ws, [{ kind: 'apply_element', experimentId: FOUR_IDS.expV4, element: 'v10' }, { kind: 'apply_element', experimentId: FOUR_IDS.expV4, element: 'v10' }])
    input = sceneInputFor(ws.current)!
    if (input.layout === 'braid' || input.layout === 'walk') throw new Error('unexpected')
    expect(input.group.definition.kind).toBe('klein_four')
    expect(input.group.accumulated).toBe('v00')
    expect(input.group.operation).toBe('v10')
    // The recipe rule is untouched; its operations are the same list on both groups.
    expect(ws.current.recipes.filter((r) => r.id === recipeId)).toHaveLength(1)
  })

  it('cube: Rz90 then H composes chronologically; a swap from the objects resolves the unique rotation', () => {
    const ws = new Workspace(demoDocument())
    commit(ws, cubeActions(ws.current))
    commit(ws, [{ kind: 'apply_element', experimentId: FOUR_IDS.expCube, element: RZ90 }, { kind: 'apply_element', experimentId: FOUR_IDS.expCube, element: H_TURN }])
    const G = groupOf({ kind: 'cube_rotations' })
    const input = sceneInputFor(ws.current)!
    if (input.layout === 'braid' || input.layout === 'walk') throw new Error('unexpected')
    expect(input.group.accumulated).toBe(G.multiply(H_TURN, RZ90))
    // Swap objects 0 and 1 wherever they are now: the transposition of their current lines.
    const p = phiOf(input.group.accumulated)
    commit(ws, [{ kind: 'apply_permutation', experimentId: FOUR_IDS.expCube, representation: 'diagonal_lines', permutation: [...transposition(4, p[0]!, p[1]!)] }])
    const e = findGroupExperiment(ws.current, FOUR_IDS.expCube)
    expect(e.history[2]!.via).toBe('diagonal_lines')
    const k = chronologicalProduct(G, e.history.map((h) => h.element))
    expect(phiOf(k)).toEqual([p[1], p[0], p[2], p[3]])
    expect(rotationForDiagonalPermutation([0, 1, 2, 3])).toBe('r(x,y,z)')
    // undo_step removes exactly the last step; Return applies the inverse.
    commit(ws, [{ kind: 'undo_step', experimentId: FOUR_IDS.expCube }])
    expect(findGroupExperiment(ws.current, FOUR_IDS.expCube).history).toHaveLength(2)
    commit(ws, domainControls(ws.current, findGroupExperiment(ws.current, FOUR_IDS.expCube)).extra.actions)
    const back = findGroupExperiment(ws.current, FOUR_IDS.expCube)
    expect(chronologicalProduct(G, back.history.map((h) => h.element))).toBe(G.identity)
  })

  it('quotient: grouping, class items and representative-independent class products', () => {
    const ws = new Workspace(demoDocument())
    commit(ws, quotientActions(ws.current))
    commit(ws, [{ kind: 'set_observation', experimentId: FOUR_IDS.expQuotient, observation: 'unoriented_axis_lines' }, { kind: 'select_item', experimentId: FOUR_IDS.expQuotient, item: 'class:102' }])
    expect(ws.current.selection.item).toBe('class:102')
    const G = groupOf({ kind: 'cube_rotations' })
    for (const a of axisClasses()) for (const b of axisClasses()) {
      const keys = new Set(a.elements.flatMap((x) => b.elements.map((y) => classKey(G.multiply(y, x)))))
      expect(keys.size).toBe(1)
    }
    expect(() => commit(ws, [{ kind: 'select_item', experimentId: FOUR_IDS.expQuotient, item: 'class:999' }])).toThrow(TransactionError)
    commit(ws, [{ kind: 'set_operands', experimentId: FOUR_IDS.expQuotient, operands: [RZ90, H_TURN] }])
    const facts = computeFacts(ws.current).find((f) => f.id === `quotient:${FOUR_IDS.expQuotient}`)!.text
    expect(facts).toContain('A, then B = B·A')
  })

  it('braids: build, relation rewrite recorded as evidence, cancellation, invalid spans refused whole', () => {
    const ws = new Workspace(demoDocument())
    commit(ws, braidActions(ws.current))
    const id = FOUR_IDS.expBraid
    commit(ws, [{ kind: 'rewrite_braid', experimentId: id, rule: 'braid_relation', at: 0, generator: null }])
    let e = findBraidExperiment(ws.current, id)
    expect(e.word).toEqual([2, 1, 2])
    expect(e.origin).toEqual([1, 2, 1])
    expect(e.rewrites).toEqual([{ rule: 'braid_relation', at: 0, generator: null }])
    expect(computeFacts(ws.current).find((f) => f.id === `braid:${id}`)!.text).toContain('checked by 1 supported rewrite')
    const before = ws.current
    expect(() => commit(ws, [{ kind: 'append_crossing', experimentId: id, target: 'word', generator: 1 }, { kind: 'rewrite_braid', experimentId: id, rule: 'cancel_pair', at: 0, generator: null }])).toThrow(TransactionError)
    expect(ws.current).toBe(before)
    commit(ws, [{ kind: 'set_braid', experimentId: id, target: 'word', word: [1, -1] }, { kind: 'set_braid', experimentId: id, target: 'compare', word: [] }])
    commit(ws, [{ kind: 'rewrite_braid', experimentId: id, rule: 'cancel_pair', at: 0, generator: null }])
    e = findBraidExperiment(ws.current, id)
    expect(e.word).toEqual([])
    expect(computeFacts(ws.current).find((f) => f.id === `braid:${id}`)!.text).toMatch(/identical words.*equals the comparison braid/)
    commit(ws, [{ kind: 'set_braid', experimentId: id, target: 'word', word: [1, 1] }])
    expect(computeFacts(ws.current).find((f) => f.id === `braid:${id}`)!.text).toContain('the exponent sums differ')
  })

  it('refuses clearly: wrong domain, unknown elements, full history, play on the wrong kind', () => {
    const ws = new Workspace(demoDocument())
    commit(ws, sculptureActions(ws.current))
    const bad = (actions: unknown[], re: RegExp) => expect(() => planTransaction(ws.current, actions)).toThrow(re)
    bad([{ kind: 'apply_element', experimentId: FOUR_IDS.expC4, element: 'v10' }], /not an element/)
    bad([{ kind: 'apply_permutation', experimentId: FOUR_IDS.expC4, representation: 'diagonal_lines', permutation: [1, 0, 2, 3] }], /only the cube group/)
    bad([{ kind: 'set_observation', experimentId: FOUR_IDS.expC4, observation: 'unoriented_axis_lines' }], /cube group/)
    bad([{ kind: 'play', experimentId: FOUR_IDS.expC4, branchId: 'main', transition: 'apply_map', duration: 1 }], /not a linear|linear experiment/)
    bad([{ kind: 'select', experimentId: FOUR_IDS.expC4, sampleId: 's(1,0,1)' }], /has no samples/)
    bad([{ kind: 'select_item', experimentId: 'exp-p', item: 'c1' }], /linear experiment/)
    for (let k = 0; k < 3; k++) commit(ws, Array.from({ length: 8 }, () => ({ kind: 'apply_element', experimentId: FOUR_IDS.expC4, element: 'c1' })))
    bad([{ kind: 'apply_element', experimentId: FOUR_IDS.expC4, element: 'c1' }], /holds 24 steps/)
    expect(planTransaction(ws.current, [{ kind: 'play_steps', experimentId: FOUR_IDS.expC4, stepDuration: 1 }]).effects).toEqual([{ kind: 'play_steps', experimentId: FOUR_IDS.expC4, stepDuration: 1 }])
    // Binding the sculpture recipe to the 24-element cube group is refused (one bead per element, at most 8).
    commit(ws, cubeActions(ws.current))
    bad([{ kind: 'bind_recipe', experimentId: FOUR_IDS.expCube, recipeId: FOUR_IDS.recipeSculpture, bindings: { group: FOUR_IDS.groupCube, operation: null } }], /at most 8/)
  })
})

describe('schema version 2 (persistence)', () => {
  function everything(): Doc {
    const ws = new Workspace(demoDocument())
    commit(ws, orderDemoActions(ws.current))
    for (const f of [sculptureActions, cubeActions, quotientActions, braidActions]) commit(ws, f(ws.current))
    commit(ws, [{ kind: 'apply_element', experimentId: FOUR_IDS.expCube, element: RZ90 }, { kind: 'rewrite_braid', experimentId: FOUR_IDS.expBraid, rule: 'braid_relation', at: 0, generator: null }])
    commit(ws, [{ kind: 'set_operands', experimentId: FOUR_IDS.expQuotient, operands: [RZ90, null] }, { kind: 'select_item', experimentId: FOUR_IDS.expQuotient, item: 'class:102' }])
    return ws.current
  }

  it('exports and imports every domain losslessly (save/reopen uses the same validator)', () => {
    const doc = everything()
    const text = exportText(doc)
    const back = importText(text)
    expect(exportText(back)).toBe(text)
    expect(docToJson(back)).toEqual(docToJson(doc))
  })

  it('loads version-1 documents through the explicit migration', () => {
    const v1 = docToJson(demoDocument()) as unknown as Record<string, unknown>
    const old = { ...v1, schemaVersion: 1, experiments: (v1.experiments as Record<string, unknown>[]).map(({ domain: _d, ...e }) => e), selection: { experimentId: 'exp-p', sampleId: 's(1,0,1)' } }
    delete (old as Record<string, unknown>).groups
    const doc = docFromJson(old)
    expect(doc.schemaVersion).toBe(3)
    expect(doc.experiments[0]!.domain).toBe('linear')
    expect(doc.selection.item).toBeNull()
    expect(docToJson(doc)).toEqual(docToJson(demoDocument()))
  })

  it('refuses a tampered rewrite record and unknown domains', () => {
    const json = docToJson(everything()) as unknown as { experiments: Record<string, unknown>[] }
    const braid = json.experiments.find((e) => e.domain === 'braid')!
    braid.word = [1, 2, 1]
    expect(() => docFromJson(json)).toThrow(/rewrites do not take origin to word/)
    braid.domain = 'knot'
    expect(() => docFromJson(json)).toThrow(/domain/)
  })
})

describe('assistant: schema, prepared templates and synthetic fixtures', () => {
  const prompts = [
    'Show C4', 'Apply this operation again', 'Use the same experiment with the Klein four-group', "Show each element's order", 'Why are these different?',
    'Show the four diagonals', 'Rotate a quarter turn about z', 'Swap objects 0 and 1', 'Undo that rotation',
    'Track only the opposite-face pairs', 'Expand this class', 'Choose another representative', 'Compose these two',
    'Build sigma1, sigma2, sigma1', 'Show the other side of the braid relation', 'Apply that rewrite', 'Compare two positive crossings with doing nothing', 'Undo this braid',
  ]

  it('every required request has a fixture whose proposal validates and applies (or answers truthfully)', () => {
    const ws = new Workspace(demoDocument())
    const run = (prompt: string) => {
      const f = matchFixture(prompt)
      expect(f, prompt).not.toBeNull()
      const p = parseProposal(f!.build(ws.current, prompt.toLowerCase().replace(/[.!?]+$/, '')))
      expect(p.explanation.length, prompt).toBeLessThanOrEqual(700)
      if (p.actions.length) commit(ws, p.actions)
      return p
    }
    // In the order of the filming sequences; each request acts on what the previous ones displayed.
    run('Show C4')
    run('Apply this operation again')
    expect(findGroupExperiment(ws.current, FOUR_IDS.expC4).history).toHaveLength(1)
    run('Use the same experiment with the Klein four-group')
    expect(ws.current.selection.experimentId).toBe(FOUR_IDS.expV4)
    expect(run("Show each element's order").explanation).toMatch(/order 2/)
    expect(run('Why are these different?').explanation).toMatch(/order 4/)
    run('Show the four diagonals')
    run('Rotate a quarter turn about z')
    run('Swap objects 0 and 1')
    expect(findGroupExperiment(ws.current, FOUR_IDS.expCube).history.map((h) => h.via)).toEqual(['element', 'diagonal_lines'])
    run('Undo that rotation')
    expect(findGroupExperiment(ws.current, FOUR_IDS.expCube).history).toHaveLength(1)
    run('Track only the opposite-face pairs')
    expect(run('Expand this class').actions).toEqual([])
    commit(ws, [{ kind: 'set_operands', experimentId: FOUR_IDS.expQuotient, operands: [RZ90, H_TURN] }])
    run('Expand this class')
    expect(ws.current.selection.item).toBe(`class:${classKey(RZ90)}`)
    run('Choose another representative')
    expect(findGroupExperiment(ws.current, FOUR_IDS.expQuotient).operands[0]).not.toBe(RZ90)
    expect(run('Compose these two').explanation).toMatch(/B·A/)
    run('Build sigma1, sigma2, sigma1')
    run('Show the other side of the braid relation')
    run('Apply that rewrite')
    expect(findBraidExperiment(ws.current, FOUR_IDS.expBraid).word).toEqual([2, 1, 2])
    expect(run('Compare two positive crossings with doing nothing').explanation).toMatch(/exponent sums differ/)
    run('Undo this braid')
    expect(findBraidExperiment(ws.current, FOUR_IDS.expBraid).word).toEqual([1, 1, -1, -1])
    for (const p of prompts) expect(matchFixture(p), p).not.toBeNull()
  })

  it('linear fixtures answer truthfully while a new demonstration is displayed', () => {
    const ws = new Workspace(demoDocument())
    commit(ws, sculptureActions(ws.current))
    const p = matchFixture('Use this representation on Q')!.build(ws.current)
    expect(p.actions).toEqual([])
    expect(p.explanation).toMatch(/not a linear map/)
    for (const f of FIXTURES) expect(() => parseProposal(f.build(ws.current, f.example.toLowerCase())), f.name).not.toThrow()
  })

  it('the strict schema lists the new actions', () => {
    const doc = demoDocument()
    const s = JSON.stringify(proposalSchema(doc))
    for (const k of ['apply_element', 'apply_permutation', 'undo_step', 'set_observation', 'rewrite_braid', 'create_braid_experiment', 'regular_action', 'braid_invariants']) expect(s).toContain(k)
  })
})
