// Live cases for P → Q and the operation-order comparison (docs/MUSE.md checklist items 1–7, plus the
// UI-REFINEMENT-SPEC section 7 suggestions for these experiments). Assertions check the meaning of an answer,
// so a live model may reach it with different valid actions.

import { expect } from 'vitest'
import { type Doc, branchMatrix, demoDocument, findExperiment } from '../../../src/workspace/document'
import { Workspace, describeClaim, displayedMatrix, planTransaction } from '../../../src/workspace/reducer'
import { parseClaimDescriptor, evaluateExactly } from '../../../src/workspace/claims'
import { ORDER_IDS, orderDemoActions, orderWords } from '../../../src/demo/order'
import { rebindTarget } from '../../../src/demo/pq'
import { matEq, presets } from '../../../src/model/linear'
import { matchFixture, normalizePrompt } from '../../../server/muse/synthetic'
import { displayedComparison } from '../../../server/muse/order'
import { type LiveCase, type LiveResult, noMathChange } from '../liveKit'

export function orderDoc(): Doc {
  const ws = new Workspace(demoDocument())
  return ws.commit({ baseRevision: 0, actions: orderDemoActions(ws.current) }).doc
}
const qDoc = (): Doc => {
  const p = demoDocument()
  return planTransaction(p, rebindTarget(p).actions).doc
}
/** The synthetic fixture's actions for a prompt (used only to build valid but wrong control answers). */
const fixtureActions = (prompt: string) => (doc: Doc) => matchFixture(prompt)!.build(doc, normalizePrompt(prompt)).actions

const qOnDisplay = ({ after }: LiveResult) => {
  expect(matEq(displayedMatrix(after), presets.projection([false, true, true])), 'the displayed map is not Q = diag(0, 1, 1)').toBe(true)
  expect(matEq(after.maps.find((m) => m.id === 'map-p')!.matrix, demoDocument().maps[0]!.matrix), 'P changed').toBe(true)
}

const leftReversed = ({ before, after }: LiveResult) => {
  const b = findExperiment(before, ORDER_IDS.experiment)
  const a = findExperiment(after, ORDER_IDS.experiment)
  expect(orderWords(after, a, 'left')).toBe('S then R')
  expect(orderWords(after, a, 'right')).toBe(orderWords(before, b, 'right'))
  expect(matEq(branchMatrix(after, a, 'left'), branchMatrix(after, a, 'right'))).toBe(true)
}

export const PQ_ORDER_CASES: LiveCase[] = [
  {
    name: 'P: "Show me what this transformation loses" shows a sample and its fiber on P',
    prompt: 'Show me what this transformation loses',
    doc: demoDocument,
    check: ({ after }) => {
      expect(after.selection.experimentId).toBe('exp-p')
      expect(after.selection.sampleId, 'no sample is selected, so no fiber is shown').not.toBeNull()
    },
    wrong: () => [{ kind: 'select', experimentId: 'exp-p', sampleId: null }],
  },
  {
    name: 'Q: "Use this representation on Q" adds Q with the same recipe; P unchanged',
    prompt: 'Use this representation on Q',
    doc: demoDocument,
    check: (r) => {
      qOnDisplay(r)
      expect(findExperiment(r.after, r.after.selection.experimentId).binding?.recipeId).toBe('what-gets-lost')
    },
  },
  {
    name: 'Q paraphrase with no synthetic fixture is handled the same way',
    prompt: 'Now show me the same picture for the map that keeps y and z and sends x to zero',
    rehearseWith: 'Use this representation on Q',
    doc: demoDocument,
    check: (r) => {
      expect(matchFixture('Now show me the same picture for the map that keeps y and z and sends x to zero')).toBeNull()
      qOnDisplay(r)
    },
  },
  {
    name: 'P again: "Use this representation on P" (spec suggestion, Q shown) shows P',
    prompt: 'Use this representation on P',
    doc: qDoc,
    check: ({ after }) => {
      expect(after.selection.experimentId).toBe('exp-p')
      expect(findExperiment(after, 'exp-p').binding?.recipeId).toBe('what-gets-lost')
    },
  },
  {
    name: 'fiber: "Explain the selected fiber" (spec suggestion) explains without changing the mathematics',
    prompt: 'Explain the selected fiber',
    doc: demoDocument,
    check: (r) => {
      noMathChange(r)
      expect(r.after.selection.sampleId).toBe(r.before.selection.sampleId)
      expect(r.j.proposal.explanation.length).toBeGreaterThan(0)
    },
    wrong: fixtureActions('Use this representation on Q'),
  },
  {
    name: 'order: "Show me why rotation and reflection order matters" opens a comparison whose routes differ',
    prompt: 'Show me why rotation and reflection order matters',
    doc: demoDocument,
    check: ({ after, plan }) => {
      const c = displayedComparison(after)
      expect(c).not.toBeNull()
      expect(c!.mapsEqual).toBe(false)
      expect(plan.effects.map((e) => e.kind)).toContain('play_comparison')
    },
  },
  {
    name: 'order: "Reverse the order on the left" reverses the displayed left route only',
    prompt: 'Reverse the order on the left',
    doc: orderDoc,
    check: leftReversed,
  },
  {
    name: 'order: "Reverse the left branch" (spec suggestion) reverses the displayed left route only',
    prompt: 'Reverse the left branch',
    doc: orderDoc,
    check: leftReversed,
  },
  {
    name: 'order: "Replay the comparison" is play_comparison on the displayed comparison',
    prompt: 'Replay the comparison',
    doc: orderDoc,
    check: ({ plan }) => {
      expect(plan.effects).toEqual([expect.objectContaining({ kind: 'play_comparison', experimentId: ORDER_IDS.experiment })])
      expect(plan.math).toBe(false)
    },
  },
  {
    name: 'order: "Check that these two maps differ" requests a true difference witness on the displayed routes',
    prompt: 'Check that these two maps differ',
    doc: orderDoc,
    check: ({ plan, before }) => {
      const check = plan.effects.find((e) => e.kind === 'request_check')
      expect(check).toBeDefined()
      if (check?.kind !== 'request_check') return
      expect(check.claim).toMatchObject({ kind: 'map_difference_witness', left: { experimentId: ORDER_IDS.experiment, branchId: 'left' }, right: { experimentId: ORDER_IDS.experiment, branchId: 'right' } })
      expect(evaluateExactly(parseClaimDescriptor(describeClaim(before, check.claim))).holds).toBe(true)
    },
  },
  {
    name: 'order: "Explain why the results differ" (spec suggestion) explains without changing the mathematics',
    prompt: 'Explain why the results differ',
    doc: orderDoc,
    check: (r) => {
      noMathChange(r)
      expect(r.j.proposal.explanation.length).toBeGreaterThan(0)
    },
    wrong: fixtureActions('Reverse the order on the left'),
  },
]
