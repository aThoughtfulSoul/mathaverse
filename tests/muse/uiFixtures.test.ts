// SYNTHETIC fixtures for the Ask Meta Muse AI suggestions (UI-REFINEMENT-SPEC section 7 table): the spec's
// wordings match a prepared fixture; the reply is computed from the request's exact document; answer-only
// fixtures carry no actions; a request the displayed state does not support is refused honestly; action
// fixtures go through the same validation as live output; the route labels every reply synthetic. These are
// prepared examples, not Muse output.

import { prettyPlain } from '../../src/ui/presenters/common'
import { describe, expect, it } from 'vitest'
import { FIXTURES, matchFixture, normalizePrompt } from '../../server/muse/synthetic'
import { validateProposal } from '../../server/muse/validate'
import { createAssistantRoute } from '../../server/muse/index'
import { type Doc, demoDocument, findBraidExperiment, findGroupExperiment } from '../../src/workspace/document'
import { planTransaction } from '../../src/workspace/reducer'
import { braidActions, cubeActions, quotientActions, sculptureActions, sculptureRebindActions } from '../../src/demo/four'
import { ORDER_IDS, orderDemoActions } from '../../src/demo/order'
import { rebindTarget } from '../../src/demo/pq'
import type { AssistantResponse } from '../../src/workspace/actions'
import { groupOf } from '../../src/algebra/groups'
import { classKey } from '../../src/algebra/cube'
import { apiRequest, assistantRequest } from './helpers'

const plan = (doc: Doc, actions: unknown[]) => planTransaction(doc, actions).doc
const P = demoDocument()
const C4 = plan(P, sculptureActions(P))
const V4 = plan(C4, sculptureRebindActions(C4, findGroupExperiment(C4, 'exp-c4')))
const ORDER = plan(P, orderDemoActions(P))
const CUBE = plan(P, cubeActions(P))
const QUOT = plan(P, quotientActions(P))
const BRAID = plan(P, braidActions(P))
const Q = plan(P, rebindTarget(P).actions)

/** The synthetic reply to a prompt on a document, exactly as the route builds it (normalized prompt). */
function reply(doc: Doc, prompt: string) {
  const f = matchFixture(prompt)
  if (!f) throw new Error(`no fixture for "${prompt}"`)
  const raw = f.build(doc, normalizePrompt(prompt))
  const v = validateProposal(raw, doc)
  if (!v.ok) throw new Error(`${f.name}: ${v.message}`)
  return { name: f.name, ...v.proposal }
}
const refused = (r: { explanation: string; actions: unknown[] }) => r.actions.length === 0 && /^Not (applied|available)/.test(r.explanation)

const NEW = ['apply-named', 'use-on-c4', 'explain-cycle', 'use-on-p', 'explain-fiber', 'explain-results', 'explain-diagonals', 'why-six-classes', 'explain-comparison', 'braid-relation-at', 'cancel-pair-at']
const ANSWER_ONLY = ['explain-cycle', 'explain-fiber', 'explain-results', 'explain-diagonals', 'why-six-classes', 'explain-comparison']

describe('the spec wordings match a fixture', () => {
  it.each([
    ['Apply +1 again', 'apply-named'], ['Apply +1', 'apply-named'], ['Apply (1,0) again', 'apply-named'],
    ['Use this representation on V₄', 'use-klein-four'], ['use this representation on v4', 'use-klein-four'],
    ['Use this representation on C₄', 'use-on-c4'], ['Explain this cycle', 'explain-cycle'],
    ['Use this representation on P', 'use-on-p'], ['Explain the selected fiber', 'explain-fiber'],
    ['Explain why the results differ', 'explain-results'], ['Explain why the results agree', 'explain-results'],
    ['Explain how the diagonals were rearranged', 'explain-diagonals'],
    ['Group rotations by their action on the unoriented axes', 'track-face-pairs'], ['Why are there six classes?', 'why-six-classes'],
    ['Explain this comparison', 'explain-comparison'],
    ['Apply the braid relation at crossings 1–3', 'braid-relation-at'], ['Apply the braid relation at crossings 2-4', 'braid-relation-at'],
    ['Cancel the inverse pair at crossings 2–3', 'cancel-pair-at'],
  ])('%s -> %s', (prompt, name) => expect(matchFixture(prompt)?.name).toBe(name))

  it('existing phrasings still reach their own fixtures', () => {
    expect(matchFixture('Apply the braid relation')?.name).toBe('apply-rewrite')
    expect(matchFixture('Apply this operation again')?.name).toBe('apply-again')
    expect(matchFixture('Use this representation on Q')?.name).toBe('use-on-q')
    expect(matchFixture('Show C4')?.name).toBe('show-c4')
  })
})

describe('sculpture', () => {
  it('Apply +1 / (1,0) applies the named element; a name outside the shown group is refused', () => {
    expect(reply(C4, 'Apply +1 again').actions).toEqual([{ kind: 'apply_element', experimentId: 'exp-c4', element: 'c1' }])
    expect(reply(C4, 'Apply +2').actions).toEqual([{ kind: 'apply_element', experimentId: 'exp-c4', element: 'c2' }])
    expect(reply(V4, 'Apply (1,0) again').actions).toEqual([{ kind: 'apply_element', experimentId: 'exp-v4', element: 'v10' }])
    for (const [doc, p] of [[C4, 'Apply +5'], [C4, 'Apply (1,0)'], [V4, 'Apply +1'], [CUBE, 'Apply +1']] as const) expect(refused(reply(doc, p)), p).toBe(true)
    expect(reply(C4, 'Apply +5').explanation).toMatch(/\+0, \+1, \+2, \+3/)
  })

  it('Use this representation on V₄ is the use-klein-four proposal; on C₄ shows C4 again from V4', () => {
    expect(reply(C4, 'Use this representation on V₄').actions).toEqual(reply(C4, 'Use the same experiment with the Klein four-group').actions)
    expect(reply(V4, 'Use this representation on C₄').actions).toEqual(sculptureRebindActions(V4, findGroupExperiment(V4, 'exp-v4')))
    expect(refused(reply(C4, 'Use this representation on C₄'))).toBe(true)
  })

  it('Explain this cycle: the exact regular action and order of the selected operation', () => {
    const one = reply(C4, 'Explain this cycle')
    expect(one.actions).toEqual([])
    expect(one.explanation).toContain('(0 1 2 3)')
    expect(one.explanation).toMatch(/order 4/)
    const two = reply(plan(C4, [{ kind: 'select_item', experimentId: 'exp-c4', item: 'c2' }]), 'Explain this cycle')
    expect(two.explanation).toContain('(0 2)(1 3)')
    expect(two.explanation).toMatch(/order 2/)
    expect(reply(V4, 'Explain this cycle').explanation).toMatch(/order 2/)
    expect(refused(reply(plan(C4, [{ kind: 'select_item', experimentId: 'exp-c4', item: null }]), 'Explain this cycle'))).toBe(true)
  })

  it('no fixture claims its own return home: after +1, the order of +2 brings the beads back where they were, not home', () => {
    const mixed = plan(C4, [{ kind: 'apply_element', experimentId: 'exp-c4', element: 'c1' }, { kind: 'select_item', experimentId: 'exp-c4', item: 'c2' }])
    const r = reply(mixed, 'Explain this cycle')
    expect(r.explanation).toMatch(/applying it 2 times in a row brings every bead back to the slot it was in before\./)
    expect(r.explanation).not.toMatch(/2 times in a row brings every bead home/)
    expect(reply(C4, "Show each element's order").explanation).not.toMatch(/every bead is home/)
  })
})

describe('P / Q and the order comparison', () => {
  it('Use this representation on P selects P again once Q exists; refused while P is shown', () => {
    expect(Q.selection.experimentId).toBe('exp-q')
    expect(reply(Q, 'Use this representation on P').actions).toEqual(rebindTarget(Q).actions)
    expect(refused(reply(P, 'Use this representation on P'))).toBe(true)
  })

  it('Explain the selected fiber: the exact line through the selected sample; refused without a selection', () => {
    const r = reply(P, 'Explain the selected fiber')
    expect(r.actions).toEqual([])
    expect(r.explanation).toContain('(1, 0, t)')
    expect(r.explanation).toContain('Pu = P(1, 0, 1) = (1, 0, 0)')
    expect(r.explanation).toMatch(/finite segment/)
    expect(reply(Q, 'Explain the selected fiber').explanation).toContain('(t, 0, 1)')
    expect(refused(reply(plan(P, [{ kind: 'select', experimentId: 'exp-p', sampleId: null }]), 'Explain the selected fiber'))).toBe(true)
  })

  it('Explain why the results differ / agree: from the exact matrices, no re-selection', () => {
    const d = reply(ORDER, 'Explain why the results differ')
    expect(d.actions).toEqual([])
    expect(d.title).toBe('Why the results differ')
    expect(d.explanation).toMatch(/the two maps differ/)
    const equal = plan(ORDER, [{ kind: 'set_branch', experimentId: ORDER_IDS.experiment, branchId: ORDER_IDS.left, mapIds: [ORDER_IDS.mapS, ORDER_IDS.mapR] }])
    const a = reply(equal, 'Explain why the results differ')
    expect(a.title).toBe('Why the results agree')
    expect(a.explanation).toMatch(/^Computed exactly, the two results do not differ here/)
    expect(refused(reply(P, 'Explain why the results differ'))).toBe(true)
  })
})

describe('cube, quotient and braids', () => {
  it('Explain how the diagonals were rearranged: phi of the accumulated rotation', () => {
    const r = reply(plan(CUBE, [{ kind: 'apply_element', experimentId: 'exp-cube', element: 'r(y,-x,z)' }]), 'Explain how the diagonals were rearranged')
    expect(r.actions).toEqual([])
    expect(r.explanation).toContain('phi = [1,3,0,2]')
    expect(refused(reply(CUBE, 'Explain how the diagonals were rearranged'))).toBe(true)
  })

  it('Group rotations by their action on the unoriented axes groups the classes; why six: 24 / 4 = 6', () => {
    expect(reply(QUOT, 'Group rotations by their action on the unoriented axes').actions).toEqual([{ kind: 'set_observation', experimentId: 'exp-quotient', observation: 'unoriented_axis_lines' }])
    const r = reply(QUOT, 'Why are there six classes?')
    expect(r.actions).toEqual([])
    expect(r.explanation).toContain('24 / 4 = 6')
    expect(r.explanation).toMatch(/kernel K = \{/)
  })

  it('Compose these two: the class of B·A is shown whole (never cut), for every choice of A and B', () => {
    // The review case: A = Rz chosen, then Rx selected; Rx∘Rz maps (x, y, z) to (y, z, x), class [2,0,1].
    const grouped = plan(QUOT, [{ kind: 'set_observation', experimentId: 'exp-quotient', observation: 'unoriented_axis_lines' }])
    const picked = plan(grouped, [{ kind: 'set_operands', experimentId: 'exp-quotient', operands: ['r(y,-x,z)', null] }, { kind: 'select_item', experimentId: 'exp-quotient', item: 'r(x,z,-y)' }])
    const r = reply(picked, 'Compose these two')
    expect(r.actions).toEqual([{ kind: 'set_operands', experimentId: 'exp-quotient', operands: ['r(y,-x,z)', 'r(x,z,-y)'] }])
    expect(r.explanation).toMatch(/A = Rz \(class \[1,0,2\]\), B = Rx \(class \[0,2,1\]\): A, then B = B·A = \S+, class \[2,0,1\] \(the same for every choice of representatives\)\.$/)
    expect(r.explanation).not.toMatch(/accumulated element/)
    const G = groupOf({ kind: 'cube_rotations' })
    const key = (x: string) => `[${classKey(x).split('').join(',')}]`
    for (const A of G.elements) {
      for (const B of G.elements) {
        const e = reply(plan(grouped, [{ kind: 'set_operands', experimentId: 'exp-quotient', operands: [A, B] }]), 'Compose these two').explanation
        expect(e.length, `${A}, ${B}`).toBeLessThanOrEqual(700)
        expect(e.endsWith(`B·A = ${prettyPlain(G.label(G.multiply(B, A)).plain)}, class ${key(G.multiply(B, A))} (the same for every choice of representatives).`), `${A}, ${B}: ${e.slice(-90)}`).toBe(true)
      }
    }
  })

  it('Explain this comparison never claims equality the checks have not established', () => {
    const r = reply(BRAID, 'Explain this comparison')
    expect(r.actions).toEqual([])
    expect(r.explanation).toMatch(/equivalence is not established/)
    expect(r.explanation).not.toMatch(/same braid/)
    expect(r.explanation).toMatch(/braid relation at crossings 1–3/)
    const rewritten = plan(BRAID, [{ kind: 'rewrite_braid', experimentId: 'exp-braid', rule: 'braid_relation', at: 0, generator: null }])
    expect(reply(rewritten, 'Explain this comparison').explanation).toMatch(/same braid \(checked by supported rewrite rules\)/)
    const double = plan(BRAID, [{ kind: 'set_braid', experimentId: 'exp-braid', target: 'word', word: [1, 1] }, { kind: 'set_braid', experimentId: 'exp-braid', target: 'compare', word: [] }])
    expect(reply(double, 'Explain this comparison').explanation).toMatch(/different braids: their exponent sums differ/)
  })

  it('rewrites at a named span: applied when the span matches, refused otherwise', () => {
    expect(reply(BRAID, 'Apply the braid relation at crossings 1–3').actions).toEqual([{ kind: 'rewrite_braid', experimentId: 'exp-braid', rule: 'braid_relation', at: 0, generator: null }])
    for (const p of ['Apply the braid relation at crossings 2–4', 'Apply the braid relation at crossings 1–2', 'Cancel the inverse pair at crossings 1–2']) expect(refused(reply(BRAID, p)), p).toBe(true)
    const pair = plan(BRAID, [{ kind: 'set_braid', experimentId: 'exp-braid', target: 'word', word: [1, -1] }])
    expect(findBraidExperiment(pair, 'exp-braid').word).toEqual([1, -1])
    expect(reply(pair, 'Cancel the inverse pair at crossings 1-2').actions).toEqual([{ kind: 'rewrite_braid', experimentId: 'exp-braid', rule: 'cancel_pair', at: 0, generator: null }])
  })
})

describe('every new fixture on every demonstration', () => {
  const docs = { P, Q, C4, V4, ORDER, CUBE, QUOT, BRAID }
  it('validates, fits the explanation limit, and answer-only fixtures never carry actions (with and without a prompt)', () => {
    for (const name of NEW) {
      const f = FIXTURES.find((x) => x.name === name)!
      expect(f, name).toBeDefined()
      for (const [label, doc] of Object.entries(docs)) {
        for (const prompt of [undefined, normalizePrompt(f.example)]) {
          const raw = f.build(doc, prompt)
          const v = validateProposal(raw, doc)
          expect(v.ok, `${name} on ${label}`).toBe(true)
          expect(raw.explanation.length, `${name} on ${label}`).toBeLessThanOrEqual(700)
          expect(raw.explanation.length, `${name} on ${label}`).toBeGreaterThan(0)
          if (ANSWER_ONLY.includes(name)) expect(raw.actions, `${name} on ${label}`).toEqual([])
        }
      }
    }
  })

  it('the route labels the replies synthetic and an answer-only reply has no actions', async () => {
    const route = createAssistantRoute({ env: {} })
    const r = await route(apiRequest(assistantRequest('Explain this cycle', C4)))
    expect(r.status).toBe(200)
    const j = r.json as AssistantResponse
    expect(j.source).toBe('synthetic')
    expect(j.model).toBe('synthetic:explain-cycle')
    expect(j.proposal.actions).toEqual([])
    const a = await route(apiRequest(assistantRequest('Apply +1 again', C4)))
    expect((a.json as AssistantResponse).model).toBe('synthetic:apply-named')
    expect((a.json as AssistantResponse).proposal.actions).toHaveLength(1)
  })
})
