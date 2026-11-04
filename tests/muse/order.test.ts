// The four operation-order requests through POST /api/assistant: SYNTHETIC fixtures (no key) and the live
// path with a MOCKED fetch (synthetic provider replies). Every proposal must pass parseProposal and
// planTransaction on the submitted document and commit/undo through Workspace. Left and right come from the
// displayed comparison's binding ports. Nothing here is live Muse output.

import { describe, expect, it } from 'vitest'
import type { ActionJson, AssistantResponse } from '../../src/workspace/actions'
import { parseProposal } from '../../src/workspace/actions'
import { type Doc, demoDocument, docToJson, findExperiment } from '../../src/workspace/document'
import { Workspace, planTransaction } from '../../src/workspace/reducer'
import { ORDER_IDS, orderDemoActions, orderWords, reverseRouteActions } from '../../src/demo/order'
import { createAssistantRoute } from '../../server/muse/index'
import { newStatus } from '../../server/muse/config'
import { matchFixture } from '../../server/muse/synthetic'
import { displayedComparison, preparedTemplates } from '../../server/muse/order'
import { fourTemplates } from '../../server/muse/four'
import type { ApiResult } from '../../server/types'
import { LIVE_ENV, apiRequest, assistantRequest, mockFetch, syntheticProposal, syntheticReply } from './helpers'

const synthetic = createAssistantRoute({ env: {} })
const ok = (r: ApiResult) => {
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as AssistantResponse
}
const err = (r: ApiResult) => r.json as { code: string; message: string }

/** Ask in synthetic mode, then commit the validated proposal the way the client does. */
async function askAndCommit(prompt: string, ws: Workspace) {
  const before = docToJson(ws.current)
  const j = ok(await synthetic(apiRequest(assistantRequest(prompt, ws.current))))
  expect(j.source).toBe('synthetic')
  expect(j.model).toMatch(/^synthetic:/)
  // The same validators as the server, on the submitted document.
  const plan = planTransaction(ws.current, parseProposal(j.proposal).actions)
  const res = ws.commit({ baseRevision: j.baseRevision, actions: j.proposal.actions })
  return { j, plan, res, before }
}

function orderWs(): Workspace {
  const ws = new Workspace(demoDocument())
  ws.commit({ baseRevision: 0, actions: orderDemoActions(ws.current) })
  return ws
}

/** A second comparison whose ports are bound the other way round: left port -> branch "b" = [R, S]. */
function swappedWs(): Workspace {
  const ws = orderWs()
  ws.commit({ baseRevision: ws.current.revision, actions: [
    { kind: 'create_experiment', name: 'cmp', sampleSetId: ORDER_IDS.sampleSet, branches: [{ id: 'a', mapIds: [ORDER_IDS.mapS, ORDER_IDS.mapR] }, { id: 'b', mapIds: [ORDER_IDS.mapR, ORDER_IDS.mapS] }] },
    { kind: 'bind_recipe', experimentId: '$cmp', recipeId: ORDER_IDS.recipe, bindings: { samples: ORDER_IDS.sampleSet, left: 'b', right: 'a', selection: ORDER_IDS.witness } },
  ] })
  return ws
}

describe('synthetic: "Show me why rotation and reflection order matters"', () => {
  it('is the prepared template, described as prepared, with exact SR / RS on e1; Undo restores P', async () => {
    const ws = new Workspace(demoDocument())
    const { j, plan } = await askAndCommit('Show me why rotation and reflection order matters', ws)
    expect(j.model).toBe('synthetic:order-demo')
    expect(j.proposal.actions).toEqual(orderDemoActions(demoDocument()))
    expect(j.proposal.actions.length).toBeLessThanOrEqual(8)
    expect(plan.effects).toEqual([{ kind: 'play_comparison', experimentId: ORDER_IDS.experiment, stepDuration: 1.6 }])
    const x = j.proposal.explanation
    expect(x).toMatch(/^This is a prepared comparison \(an application template/)
    expect(x).toContain('R = rotation by 90° about z; S = reflection negating y (across the xz-plane; on z = 0, across the x-axis)')
    expect(x).toContain('The left route applies R then S (SR); the right route applies S then R (RS).')
    expect(x).toContain('SRe1 = (0, -1, 0) but RSe1 = (0, 1, 0)')
    expect(x).toContain('the first step S leaves e1 fixed at (1, 0, 0) while 4 other labelled samples move')
    expect(x.length).toBeLessThanOrEqual(700)
    expect(ws.current.selection).toEqual({ experimentId: ORDER_IDS.experiment, sampleId: ORDER_IDS.witness, item: null })
    ws.undo()
    expect(docToJson({ ...ws.current, revision: 0, mathRevision: 0 })).toEqual(docToJson(demoDocument()))
  })

  it('is a single select when the comparison already exists', async () => {
    const ws = orderWs()
    ws.commit({ baseRevision: ws.current.revision, actions: [{ kind: 'select', experimentId: 'exp-p', sampleId: 's(1,0,1)' }] })
    const { j } = await askAndCommit('Show me why rotation and reflection order matters', ws)
    expect(j.proposal.actions).toEqual([{ kind: 'select', experimentId: ORDER_IDS.experiment, sampleId: ORDER_IDS.witness }])
    expect(j.proposal.explanation).toMatch(/^This shows the prepared comparison exp-order again \(a select\)/)
    expect(ws.current.selection.experimentId).toBe(ORDER_IDS.experiment)
  })

  it.each(['Why does order matter?', 'Show me why the order of rotation and reflection matters', 'Does the order of the operations matter', 'explain why order matters'])('paraphrase "%s" uses the same template', (prompt) => {
    expect(matchFixture(prompt)?.name).toBe('order-demo')
  })
})

describe('synthetic: "Reverse the order on the left"', () => {
  it('reverses the displayed left route and replays; equal routes agree; Undo restores R then S', async () => {
    const ws = orderWs()
    const { j, plan } = await askAndCommit('Reverse the order on the left', ws)
    expect(j.model).toBe('synthetic:reverse-left')
    expect(j.proposal.actions).toEqual([...reverseRouteActions(findExperiment(orderWs().current, ORDER_IDS.experiment), 'left'), { kind: 'play_comparison', experimentId: ORDER_IDS.experiment, stepDuration: 1.6 }])
    expect(plan.effects).toEqual([{ kind: 'play_comparison', experimentId: ORDER_IDS.experiment, stepDuration: 1.6 }])
    expect(j.proposal.explanation).toContain('it applies S then R instead of R then S')
    expect(j.proposal.explanation).toContain('Both resolve to the same matrix')
    const e = findExperiment(ws.current, ORDER_IDS.experiment)
    expect(orderWords(ws.current, e, 'left')).toBe('S then R')
    expect(displayedComparison(ws.current)).toMatchObject({ mapsEqual: true, firstDifferingBasisIndex: null })
    ws.undo()
    expect(orderWords(ws.current, findExperiment(ws.current, ORDER_IDS.experiment), 'left')).toBe('R then S')
  })

  it('resolves "left" from the binding ports, never from branch IDs or order', async () => {
    const ws = swappedWs()
    expect(ws.current.selection.experimentId).toBe('exp-cmp')
    const { j } = await askAndCommit('Reverse the order on the left', ws)
    expect(j.proposal.actions[0]).toEqual({ kind: 'set_branch', experimentId: 'exp-cmp', branchId: 'b', mapIds: [ORDER_IDS.mapS, ORDER_IDS.mapR] })
    const { j: right } = await askAndCommit('Reverse the order on the right', swappedWs())
    expect(right.proposal.actions[0]).toEqual({ kind: 'set_branch', experimentId: 'exp-cmp', branchId: 'a', mapIds: [ORDER_IDS.mapR, ORDER_IDS.mapS] })
  })

  it('without a displayed comparison it explains and changes nothing', async () => {
    const ws = new Workspace(demoDocument())
    const { j, res } = await askAndCommit('Reverse the order on the left', ws)
    expect(j.proposal.actions).toEqual([])
    expect(j.proposal.explanation).toMatch(/No branch comparison is displayed/)
    expect(res.plan.changed).toBe(false)
  })

  it.each(['Swap the order on the left', 'reverse the left route', 'Flip the order of the left branch'])('paraphrase "%s"', (prompt) => {
    expect(matchFixture(prompt)?.name).toBe('reverse-left')
  })
})

describe('synthetic: "Replay the comparison"', () => {
  it('is play_comparison on the displayed comparison and changes no document field', async () => {
    const ws = orderWs()
    const rev = ws.current.revision
    const { j, plan } = await askAndCommit('Replay the comparison', ws)
    expect(j.proposal.actions).toEqual([{ kind: 'play_comparison', experimentId: ORDER_IDS.experiment, stepDuration: 1.6 }])
    expect(plan.changed).toBe(false)
    expect(plan.effects).toEqual([{ kind: 'play_comparison', experimentId: ORDER_IDS.experiment, stepDuration: 1.6 }])
    expect(ws.current.revision).toBe(rev)
  })

  it('selects the comparison first, explicitly, when P is displayed', async () => {
    const ws = orderWs()
    ws.commit({ baseRevision: ws.current.revision, actions: [{ kind: 'select', experimentId: 'exp-p', sampleId: null }] })
    const { j } = await askAndCommit('Replay the comparison', ws)
    expect(j.proposal.actions.map((a) => a.kind)).toEqual(['select', 'play_comparison'])
    expect(j.proposal.explanation).toMatch(/another experiment was shown/)
    expect(ws.current.selection.experimentId).toBe(ORDER_IDS.experiment)
  })

  it('explains when there is no comparison', async () => {
    const { j } = await askAndCommit('Replay the comparison', new Workspace(demoDocument()))
    expect(j.proposal.actions).toEqual([])
  })

  it.each(['Play the comparison again', 'replay both routes', 'Show the comparison again'])('paraphrase "%s"', (prompt) => {
    expect(matchFixture(prompt)?.name).toBe('replay-comparison')
  })
})

describe('synthetic: "Check that these two maps differ"', () => {
  it('requests map_difference_witness on the displayed left/right routes at e1, computed exactly', async () => {
    const ws = orderWs()
    const { j, plan } = await askAndCommit('Check that these two maps differ', ws)
    const claim = { kind: 'map_difference_witness', left: { experimentId: ORDER_IDS.experiment, branchId: 'left' }, right: { experimentId: ORDER_IDS.experiment, branchId: 'right' }, basisIndex: 0 }
    expect(j.proposal.actions).toEqual([{ kind: 'request_check', claim }])
    expect(plan.effects).toEqual([{ kind: 'request_check', claim }])
    expect(j.proposal.explanation).toContain('Computed exactly: SRe1 = (0, -1, 0) and RSe1 = (0, 1, 0).')
    expect(j.proposal.explanation).toContain('Nothing is Lean-checked until the checker answers.')
  })

  it('on the swapped comparison the left side is branch "b"', async () => {
    const { j } = await askAndCommit('Check that these two maps differ', swappedWs())
    expect((j.proposal.actions[0] as Extract<ActionJson, { kind: 'request_check' }>).claim).toMatchObject({ left: { experimentId: 'exp-cmp', branchId: 'b' }, right: { experimentId: 'exp-cmp', branchId: 'a' } })
  })

  it('when the routes are equal it says so and claims no difference; the equality check is offered', async () => {
    const ws = orderWs()
    ws.commit({ baseRevision: ws.current.revision, actions: reverseRouteActions(findExperiment(ws.current, ORDER_IDS.experiment), 'left') })
    const { j } = await askAndCommit('Check that these two maps differ', ws)
    expect(j.proposal.actions).toEqual([])
    expect(j.proposal.title).toBe('The two maps are equal')
    expect(j.proposal.explanation).toMatch(/computed exactly, the two maps are equal, so there is no difference to check/)
    const { j: eq } = await askAndCommit('Check that these two maps are equal', ws)
    expect(eq.proposal.actions).toEqual([{ kind: 'request_check', claim: { kind: 'map_equality', left: { experimentId: ORDER_IDS.experiment, branchId: 'left' }, right: { experimentId: ORDER_IDS.experiment, branchId: 'right' } } }])
  })

  it.each(['Verify that the two routes are different', 'prove that these maps differ', 'Check the two maps are not equal'])('paraphrase "%s"', (prompt) => {
    expect(matchFixture(prompt)?.name).toBe('check-maps-differ')
  })
})

describe('synthetic: P-to-Q requests while the comparison is displayed', () => {
  it.each(['Show me what this transformation loses', 'Use this representation on Q', 'Check that u and v have the same image'])('"%s" explains instead of guessing', async (prompt) => {
    const { j, res } = await askAndCommit(prompt, orderWs())
    expect(j.proposal.actions).toEqual([])
    expect(j.proposal.explanation).toMatch(/operation-order comparison exp-order/)
    expect(res.plan.changed).toBe(false)
  })

  it('P -> Q still works after the comparison exists and P is displayed again', async () => {
    const ws = orderWs()
    ws.commit({ baseRevision: ws.current.revision, actions: [{ kind: 'select', experimentId: 'exp-p', sampleId: 's(1,0,1)' }] })
    const { j } = await askAndCommit('Use this representation on Q', ws)
    expect(j.model).toBe('synthetic:use-on-q')
    expect(ws.current.experiments.map((e) => e.id)).toEqual(['exp-p', 'exp-order', 'exp-q'])
    expect(ws.current.selection).toEqual({ experimentId: 'exp-q', sampleId: 's(1,0,1)', item: null })
  })
})

describe('live path with the order requests (synthetic mock)', () => {
  async function live(doc: Doc, ...replies: Response[]) {
    const m = mockFetch(...replies)
    const route = createAssistantRoute({ env: LIVE_ENV, fetchImpl: m.fetchImpl, status: newStatus(), minRepairMs: 0 })
    const res = await route(apiRequest(assistantRequest('Show me why rotation and reflection order matters', doc)))
    const ctx = JSON.parse((m.calls[0]!.body.input as { content: { text: string }[] }[])[0]!.content[1]!.text.replace(/^[^\n]*\n/, ''))
    return { res, ctx, calls: m.calls }
  }

  it('the model input offers the prepared template verbatim; a verbatim reply validates as source "meta"', async () => {
    const doc = demoDocument()
    const { res, ctx } = await live(doc, syntheticReply(syntheticProposal(orderDemoActions(doc))))
    expect(ctx.prepared.orderComparison).toEqual({ actions: orderDemoActions(doc) })
    const j = ok(res)
    expect(j.source).toBe('meta')
    expect(j.proposal.actions).toEqual(orderDemoActions(doc))
  })

  it('the displayed comparison is described from its binding ports, with validated templates', async () => {
    const doc = swappedWs().current
    const { ctx } = await live(doc, syntheticReply(syntheticProposal([])))
    expect(ctx.prepared).toEqual(JSON.parse(JSON.stringify({ ...preparedTemplates(doc), four: fourTemplates(doc) })))
    const c = ctx.prepared.displayedComparison
    expect(c).toMatchObject({ experimentId: 'exp-cmp', left: { port: 'left', branchId: 'b', order: 'R then S', symbol: 'SR' }, right: { port: 'right', branchId: 'a', order: 'S then R', symbol: 'RS' }, mapsEqual: false, firstDifferingBasisIndex: 0, checkEquality: null })
    expect(c.reverseLeft.actions[0]).toEqual({ kind: 'set_branch', experimentId: 'exp-cmp', branchId: 'b', mapIds: [ORDER_IDS.mapS, ORDER_IDS.mapR] })
    expect(c.checkDifference.actions[0].claim).toMatchObject({ kind: 'map_difference_witness', basisIndex: 0 })
    expect(ctx.facts.map((f: { kind: string }) => f.kind)).toEqual(expect.arrayContaining(['order', 'comparison']))
  })

  it('one-branch play on the comparison is refused, never reinterpreted as play_comparison', async () => {
    const doc = orderWs().current
    const play = [{ kind: 'play', experimentId: ORDER_IDS.experiment, branchId: 'left', transition: 'apply_map', duration: 2 }]
    const { res, calls } = await live(doc, syntheticReply(syntheticProposal(play)), syntheticReply(syntheticProposal(play)))
    expect(calls).toHaveLength(2)
    expect(res.status).toBe(422)
    expect(err(res).code).toBe('proposal_rejected')
    expect(err(res).message).toMatch(/use play_comparison/)
  })

  it('a stepDuration outside 0.5-5 s is rejected', async () => {
    const doc = orderWs().current
    const bad = [{ kind: 'play_comparison', experimentId: ORDER_IDS.experiment, stepDuration: 0.2 }]
    const { res } = await live(doc, syntheticReply(syntheticProposal(bad)), syntheticReply(syntheticProposal(bad)))
    expect(err(res).code).toBe('invalid_output')
    expect(err(res).message).toMatch(/0\.5 to 5 seconds/)
  })
})
