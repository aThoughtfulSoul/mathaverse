// The browser-side request rules (WORKSPACE-AND-AI W5-W6, ACCEPTANCE A4-A5): the assistant client's
// apply/stale/supersede/cancel decisions and the evidence client's freshness and wording. A mocked fetch
// stands in for the server and a minimal App wraps the real Workspace. Node only; no rendering.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoDocument } from '../src/workspace/document'
import { Workspace } from '../src/workspace/reducer'
import { assistantContextHash } from '../src/workspace/context'
import { AssistantClient, errorRemedy } from '../src/assistant/client'
import { answerFacts } from '../src/ui/assistant/answerFacts'
import { planTransaction } from '../src/workspace/reducer'
import { endpointActions, lessonExperiment, proofActions } from '../src/demo/proof'
import { EvidenceClient } from '../src/evidence/client'
import { claimHash, parseClaimDescriptor } from '../src/workspace/claims'
import type { EvidenceRef, AssistantRequest } from '../src/workspace/actions'
import type { App } from '../src/app'
import { createAssistantRoute } from '../server/muse/index'
import { apiRequest, assistantRequest, LIVE_ENV, mockFetch } from './muse/helpers'

const U = 's(1,0,1)'
const V = 's(1,0,-1)'
const W = 's(1,0,0)'
const SELECT_V = [{ kind: 'select', experimentId: 'exp-p', sampleId: V }]
const MOVE_U = [{ kind: 'update_sample', sampleSetId: 'grid3', sampleId: U, coords: [{ n: '1', d: '1' }, { n: '0', d: '1' }, { n: '2', d: '1' }] }]

function fakeApp(doc = demoDocument()) {
  const workspace = new Workspace(doc)
  let previewing = false
  const app = {
    workspace,
    transact(actions: unknown) {
      const { plan } = workspace.commit({ baseRevision: workspace.current.revision, actions })
      return { summary: plan.summary, effects: plan.effects }
    },
    isPreviewing: () => previewing,
  }
  return { app: app as unknown as App, workspace, setPreviewing: (v: boolean) => (previewing = v) }
}

interface Call { url: string; body: Record<string, unknown>; resolve: (r: Response) => void; aborted: () => boolean }

/** A fetch whose responses the test releases by hand; aborting rejects like the browser does. */
function manualFetch(): Call[] {
  const calls: Call[] = []
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    let aborted = false
    init.signal?.addEventListener('abort', () => {
      aborted = true
      reject(new DOMException('aborted', 'AbortError'))
    })
    calls.push({ url, body: JSON.parse(init.body as string), resolve, aborted: () => aborted })
  })))
  return calls
}

const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })

/** What the assistant route returns: an envelope echoing the request and hashing the context it received. */
async function envelope(body: Record<string, unknown>, actions: unknown[]) {
  const req = body as unknown as AssistantRequest
  return {
    requestId: req.requestId, source: 'synthetic', model: 'synthetic:test', baseRevision: req.baseRevision,
    contextHash: await assistantContextHash(req.context), timing: { providerMs: null, totalMs: 1 },
    proposal: { proposalVersion: 1, title: 'Select v', explanation: 'Selects v.', actions },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('assistant client (W5)', () => {
  const setup = () => {
    const f = fakeApp()
    let refs: EvidenceRef[] = []
    const client = new AssistantClient(f.app, () => refs, () => {})
    return { ...f, client, setRefs: (r: EvidenceRef[]) => (refs = r) }
  }

  it('applies a proposal whose workspace, revision and context are unchanged, through the workspace', async () => {
    const calls = manualFetch()
    const { client, workspace } = setup()
    const done = client.ask('select v')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    calls[0]!.resolve(json(await envelope(calls[0]!.body, SELECT_V)))
    await done
    expect(client.state.kind).toBe('applied')
    expect(workspace.current.selection.sampleId).toBe(V)
    expect(workspace.current.revision).toBe(1)
  })

  it('a valid proposal that changes nothing is reported as answered, not applied (nothing for Undo)', async () => {
    const calls = manualFetch()
    const { client, workspace } = setup()
    workspace.commit({ baseRevision: 0, actions: SELECT_V })
    const done = client.ask('select v')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    calls[0]!.resolve(json(await envelope(calls[0]!.body, SELECT_V)))
    await done
    expect(client.state.kind).toBe('answered')
    expect(workspace.current.revision).toBe(1)
  })

  it('keeps the proposal as a stale suggestion when the revision changed during the request', async () => {
    const calls = manualFetch()
    const { client, workspace } = setup()
    const done = client.ask('select v')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    workspace.commit({ baseRevision: 0, actions: [{ kind: 'select', experimentId: 'exp-p', sampleId: W }] })
    calls[0]!.resolve(json(await envelope(calls[0]!.body, SELECT_V)))
    await done
    expect(client.state.kind).toBe('stale')
    expect(workspace.current.selection.sampleId).toBe(W)
  })

  it('keeps it stale when the context changed without a new revision (evidence arrived)', async () => {
    const calls = manualFetch()
    const { client, workspace, setRefs } = setup()
    const done = client.ask('select v')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    setRefs([{ claim: { kind: 'map_equality', left: { experimentId: 'exp-p', branchId: 'main' }, right: { experimentId: 'exp-p', branchId: 'main' } }, claimHash: 'a'.repeat(64), receiptId: 'r1' }])
    calls[0]!.resolve(json(await envelope(calls[0]!.body, SELECT_V)))
    await done
    expect(client.state).toMatchObject({ kind: 'stale', reason: 'the workspace context changed while the request was running' })
    expect(workspace.current.revision).toBe(0)
  })

  it('keeps it stale when a drag preview is active at the response', async () => {
    const calls = manualFetch()
    const { client, workspace, setPreviewing } = setup()
    const done = client.ask('select v')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    setPreviewing(true)
    calls[0]!.resolve(json(await envelope(calls[0]!.body, SELECT_V)))
    await done
    expect(client.state).toMatchObject({ kind: 'stale', reason: 'a drag preview is active' })
    expect(workspace.current.revision).toBe(0)
  })

  it('a second request supersedes the first: the first is aborted and its response can change nothing', async () => {
    const calls = manualFetch()
    const { client, workspace } = setup()
    const first = client.ask('select v')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    const second = client.ask('select w')
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0]!.aborted()).toBe(true)
    await first
    calls[1]!.resolve(json(await envelope(calls[1]!.body, [{ kind: 'select', experimentId: 'exp-p', sampleId: W }])))
    await second
    expect(client.state.kind).toBe('applied')
    expect(workspace.current.selection.sampleId).toBe(W)
    expect(client.history.map((h) => h.outcome)).toEqual(['superseded', 'applied'])
  })

  it('two asks before the first is sent dispatch only the newer one', async () => {
    const calls = manualFetch()
    const { client } = setup()
    const a = client.ask('first')
    const b = client.ask('second')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await a
    expect(calls[0]!.body.prompt).toBe('second')
    expect(client.history[0]).toMatchObject({ prompt: 'first', outcome: 'superseded before dispatch' })
    calls[0]!.resolve(json(await envelope(calls[0]!.body, [])))
    await b
    expect(calls).toHaveLength(1)
  })

  it('cancel before the request is sent means it is never sent; cancel after aborts it', async () => {
    const calls = manualFetch()
    const { client, workspace } = setup()
    const a = client.ask('select v')
    client.cancel()
    await a
    expect(calls).toHaveLength(0)
    const b = client.ask('select v')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    client.cancel()
    await b
    expect(calls[0]!.aborted()).toBe(true)
    expect(client.state.kind).toBe('canceled')
    expect(workspace.current.revision).toBe(0)
  })

  it('a cancel before the first request is sent ends as canceled with its question, and nothing is sent or applied', async () => {
    const calls = manualFetch()
    const { client, workspace } = setup()
    const a = client.ask('select v')
    expect(client.busy).toBe(true)
    client.cancel('panel-closed')
    await a
    expect(client.state).toMatchObject({ kind: 'canceled', prompt: 'select v' })
    expect(client.busy).toBe(false)
    expect(calls).toHaveLength(0)
    expect(workspace.current.revision).toBe(0)
  })

  it('a cancel while a superseding request is still being prepared ends the old pending state', async () => {
    const calls = manualFetch()
    const { client } = setup()
    const a = client.ask('first')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    const b = client.ask('second')
    client.cancel()
    await Promise.all([a, b])
    expect(client.state).toMatchObject({ kind: 'canceled', prompt: 'first' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.aborted()).toBe(true)
  })

  it('ends with an error (nothing applied) on an envelope for another request or an invalid proposal', async () => {
    const calls = manualFetch()
    const { client, workspace } = setup()
    const a = client.ask('select v')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    calls[0]!.resolve(json({ ...(await envelope(calls[0]!.body, SELECT_V)), requestId: 'someone-else' }))
    await a
    expect(client.state).toMatchObject({ kind: 'error', error: { code: 'invalid_response' } })
    expect(workspace.current.revision).toBe(0)
    const b = client.ask('select v')
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    calls[1]!.resolve(json(await envelope(calls[1]!.body, [{ kind: 'run_python', code: 'print(1)' }])))
    await b
    expect(client.state).toMatchObject({ kind: 'error', error: { code: 'invalid_proposal' } })
    expect(workspace.current.revision).toBe(0)
  })
})

describe('assistant client: answer scope and failure remedies', () => {
  const heroAt = (k: number) => {
    const pq = demoDocument()
    const lesson = planTransaction(pq, proofActions(pq)).doc
    return planTransaction(lesson, endpointActions(lessonExperiment(lesson)!, k)).doc
  }
  const setup = (doc = demoDocument()) => {
    const f = fakeApp(doc)
    return { ...f, client: new AssistantClient(f.app, () => [], () => {}) }
  }

  it('an answer carries the selection it was asked from; an applied one also carries the committed selection', async () => {
    const calls = manualFetch()
    const { client, workspace } = setup(heroAt(9))
    const e = lessonExperiment(workspace.current)!
    const a = client.ask('Why is W9 inside?')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    calls[0]!.resolve(json(await envelope(calls[0]!.body, [])))
    await a
    expect(client.state).toMatchObject({ kind: 'answered', scope: { request: { experimentId: e.id, item: 'walk:reordered:9' }, committed: null } })
    expect(client.state.kind === 'answered' && client.state.scope?.request.walk).toContain('"signs":[1,-1,1,-1')
    expect(answerFacts(client.state, workspace.current)).toMatchObject({ endpoint: 'W₉', current: true })
    // The state (scope included) stays plain JSON: it is part of the UI view key.
    expect(() => JSON.stringify(client.state)).not.toThrow()

    const b = client.ask('Show W3')
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    calls[1]!.resolve(json(await envelope(calls[1]!.body, endpointActions(e, 3))))
    await b
    expect(client.state).toMatchObject({ kind: 'applied', scope: { request: { item: 'walk:reordered:9' }, committed: { item: 'walk:reordered:3' } } })
    expect(answerFacts(client.state, workspace.current)).toMatchObject({ endpoint: 'W₃', current: true })
  })

  it('a non-walk answer carries a scope with no walk, so no facts block', async () => {
    const calls = manualFetch()
    const { client, workspace } = setup()
    const a = client.ask('select v')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    calls[0]!.resolve(json(await envelope(calls[0]!.body, SELECT_V)))
    await a
    expect(client.state).toMatchObject({ kind: 'applied', scope: { request: { experimentId: 'exp-p', walk: null }, committed: { walk: null } } })
    expect(answerFacts(client.state, workspace.current)).toBeNull()
  })

  it('remedies: an upstream gateway timeout is "smaller", retryable failures are "retry", others "none"', () => {
    expect(errorRemedy({ code: 'provider_gateway_timeout', retryable: false })).toBe('smaller')
    expect(errorRemedy({ code: 'provider_gateway_timeout', retryable: true })).toBe('smaller')
    expect(errorRemedy({ code: 'provider_timeout', retryable: true })).toBe('retry')
    expect(errorRemedy({ code: 'provider_rate_limited', retryable: true })).toBe('retry')
    expect(errorRemedy({ code: 'provider_unavailable', retryable: true })).toBe('retry')
    expect(errorRemedy({ code: 'provider_auth', retryable: false })).toBe('none')
  })

  // The route's actual error body for each upstream outcome (mocked Meta fetch), fed to the client as the server reply.
  async function routeError(reply: Response | ((init: RequestInit) => Promise<Response>), deadlineMs?: number) {
    const route = createAssistantRoute({ env: LIVE_ENV, fetchImpl: mockFetch(reply).fetchImpl, minRepairMs: 0, ...(deadlineMs ? { deadlineMs } : {}) })
    const r = await route(apiRequest(assistantRequest('Explain every endpoint in detail')))
    return { status: r.status, body: r.json }
  }
  const hang = (init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))

  it.each([
    ['upstream 504', () => routeError(new Response('{}', { status: 504 })), 'provider_gateway_timeout', 'smaller', 1],
    ["this app's provider deadline", () => routeError(hang, 30), 'provider_timeout', 'retry', 2],
    ['429 rate limited', () => routeError(new Response('{}', { status: 429, headers: { 'retry-after': '2' } })), 'provider_rate_limited', 'retry', 2],
    ['503 transient', () => routeError(new Response('{}', { status: 503 })), 'provider_unavailable', 'retry', 2],
  ] as const)('%s: an error with no scene update; Retry resends only when the remedy is retry', async (_, make, code, remedy, sentAfterRetry) => {
    const { status, body } = await make()
    const calls = manualFetch()
    const { client, workspace } = setup()
    const a = client.ask('Explain every endpoint in detail')
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    calls[0]!.resolve(json(body, status))
    await a
    expect(client.state).toMatchObject({ kind: 'error', prompt: 'Explain every endpoint in detail', error: { code } })
    expect(client.state.kind === 'error' && errorRemedy(client.state.error)).toBe(remedy)
    expect(workspace.current.revision).toBe(0)
    void client.retry()
    await new Promise((r) => setTimeout(r, 20))
    expect(calls).toHaveLength(sentAfterRetry)
    client.cancel()
  })
})

describe('evidence client (W6)', () => {
  /** The check route: echo the client's claim hash; "checked" with a receipt unless told otherwise. */
  const answer = async (call: Call, status: 'checked' | 'not_established' = 'checked') => {
    const hash = await claimHash(parseClaimDescriptor(call.body.claim))
    call.resolve(json({ requestId: call.body.requestId, claimHash: hash, statement: '', status, provenance: null, receipt: status === 'checked' ? { id: 'r1', issuedAt: '2026-10-29T00:00:00Z' } : null, reason: status === 'checked' ? null : 'false claim', timing: { ms: 1 } }))
  }

  it('a checked entry becomes historical when the maths changes and current again on undo', async () => {
    const calls = manualFetch()
    const { app, workspace } = fakeApp()
    const ev = new EvidenceClient(app)
    const p = ev.check({ kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: U, v: V })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await answer(calls[0]!)
    const e = (await p)!
    expect(e).toMatchObject({ status: 'checked', current: true })
    expect(ev.refs()).toHaveLength(1)
    workspace.commit({ baseRevision: workspace.current.revision, actions: MOVE_U })
    await vi.waitFor(() => expect(e.current).toBe(false))
    expect(ev.refs()).toHaveLength(0)
    expect(EvidenceClient.describe(e)).toContain('(historical')
    workspace.undo()
    await vi.waitFor(() => expect(e.current).toBe(true))
    expect(ev.refs()).toHaveLength(1)
  })

  it('the panel and scene are notified of the result itself, not only of the request', async () => {
    const calls = manualFetch()
    const { app } = fakeApp()
    const ev = new EvidenceClient(app)
    const seen: string[] = []
    ev.subscribe(() => seen.push(`${ev.entries[0]!.status}:${ev.sceneLine()!.kind}`))
    const p = ev.check({ kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: U, v: V })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await answer(calls[0]!)
    await p
    expect(seen.at(-1)).toBe('checked:checked')
  })

  it('a revalidation overtaken by a newer document change never writes, whatever order the hashes finish in', async () => {
    const calls = manualFetch()
    const { app, workspace } = fakeApp()
    const ev = new EvidenceClient(app)
    const p = ev.check({ kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: U, v: V })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await answer(calls[0]!)
    const e = (await p)!
    // Hold every SHA-256 digest until released, so the three runs can be made to finish out of order.
    const subtle = globalThis.crypto.subtle
    const digest = subtle.digest.bind(subtle)
    const held: (() => void)[] = []
    const spy = vi.spyOn(subtle, 'digest').mockImplementation(async (alg, data) => {
      const r = await digest(alg as AlgorithmIdentifier, data as BufferSource)
      await new Promise<void>((release) => held.push(release))
      return r
    })
    try {
      workspace.commit({ baseRevision: workspace.current.revision, actions: MOVE_U }) // run 1: moved
      workspace.undo() // run 2: back to the checked data
      workspace.commit({ baseRevision: workspace.current.revision, actions: MOVE_U }) // run 3: moved (newest)
      await vi.waitFor(() => expect(held).toHaveLength(3))
      const tick = () => new Promise((r) => setTimeout(r, 0))
      held[2]!(); await tick() // the newest run writes first: historical
      held[0]!(); await tick()
      held[1]!(); await tick() // the undo run finishes last; without the generation check it would restore `current`
      expect(e.current).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('a check refused while another runs is marked not sent and does not take over the scene line', async () => {
    const calls = manualFetch()
    const { app } = fakeApp()
    const ev = new EvidenceClient(app)
    const first = ev.check({ kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: U, v: V })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    const refused = (await ev.check({ kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: U, v: W }))!
    expect(refused.status).toBe('not_sent')
    expect(EvidenceClient.describe(refused)).toMatch(/^Not sent to Lean \(another check was running\): u ≠ \(1, 0, 0\)/)
    expect(ev.sceneLine()!.tex).toMatch(/^\\textsf\{Checking: \}u \\neq v/)
    await answer(calls[0]!)
    await first
    expect(calls).toHaveLength(1)
  })

  it('panel text uses plain names for TeX labels (a_{1} reads a1)', async () => {
    const calls = manualFetch()
    const doc = demoDocument()
    ;(doc.sampleSets[0]!.samples.find((x) => x.id === 's(1,1,0)') as { label: string }).label = 'a_{1}'
    const { app } = fakeApp(doc)
    const ev = new EvidenceClient(app)
    const p = ev.check({ kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: U, v: 's(1,1,0)' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await answer(calls[0]!, 'not_established')
    const e = (await p)!
    expect(e.label).toBe('u ≠ a1 and Pu = Pa1')
    expect(ev.sceneLine()!.tex).toContain('Pa_{1}')
  })

  it('names an unlabelled witness by its exact coordinates, never by a placeholder letter', async () => {
    const calls = manualFetch()
    const { app } = fakeApp()
    const ev = new EvidenceClient(app)
    const p = ev.check({ kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: U, v: W })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    await answer(calls[0]!)
    const e = (await p)!
    expect(e.label).toBe('u ≠ (1, 0, 0) and Pu = P(1, 0, 0)')
    expect(ev.sceneLine()!.tex).toBe('\\textsf{Lean checked: }u \\neq \\left(1,\\ 0,\\ 0\\right)\\textsf{ and }Pu = P\\left(1,\\ 0,\\ 0\\right)')
  })

  it('a false claim reads as false while it is being checked and after, never as merely unverified', async () => {
    const calls = manualFetch()
    const { app, workspace } = fakeApp()
    workspace.commit({ baseRevision: 0, actions: MOVE_U }) // u = (1, 0, 2): Pu = (1, 0, 0) still, but compare u with a
    const ev = new EvidenceClient(app)
    const p = ev.check({ kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: U, v: 's(1,1,0)' })
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    const during = ev.sceneLine()!
    expect(during.kind).toBe('other')
    expect(during.tex).toBe('\\textsf{Computed exactly: }Pu \\neq Pa\\textsf{ (the requested claim is false)}')
    expect(during.plain).toMatch(/^Computed exactly: the claim u ≠ a and Pu = Pa is false/)
    await answer(calls[0]!, 'not_established')
    const e = (await p)!
    expect(e.status).toBe('not_established')
    expect(EvidenceClient.describe(e)).toMatch(/is false \(outputs differ: \(1, 0, 0\) and \(1, 1, 0\)\), so Lean was not asked to prove it$/)
  })
})

describe('assistant route, forced synthetic mode (coordinator edit, INTERFACES.md)', () => {
  it('with a key configured and MUSE_MODE=synthetic, a prompt without a fixture says the mode is forced', async () => {
    const route = createAssistantRoute({ env: { ...LIVE_ENV, MUSE_MODE: 'synthetic' } })
    const r = await route(apiRequest(assistantRequest('Make me a pie chart')))
    expect(r.status).toBe(422)
    expect((r.json as { message: string }).message).toMatch(/synthetic mode is forced by MUSE_MODE/)
  })

  it('with no key, the same prompt says Muse is not configured', async () => {
    const route = createAssistantRoute({ env: {} })
    const r = await route(apiRequest(assistantRequest('Make me a pie chart')))
    expect((r.json as { message: string }).message).toMatch(/Muse is not configured on this server/)
  })
})
