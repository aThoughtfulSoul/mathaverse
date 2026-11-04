// POST /api/assistant end to end in SYNTHETIC mode (no key): labelled fixtures against demoDocument(),
// validated by the same parseProposal + planTransaction path as live output, then committed the way
// the client would. These are prepared examples, not Muse output.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { assistantContextHash } from '../../src/workspace/context'
import { demoDocument, docToJson, findExperiment } from '../../src/workspace/document'
import { Workspace, displayedMatrix, planTransaction } from '../../src/workspace/reducer'
import { exactOutputGroups } from '../../src/model/linear'
import type { AssistantResponse, EvidenceRef } from '../../src/workspace/actions'
import { assistantRoute, createAssistantRoute, museCapabilities } from '../../server/muse/index'
import { FIXTURES } from '../../server/muse/synthetic'
import type { ApiResult } from '../../server/types'
import { apiRequest, assistantRequest } from './helpers'

const route = createAssistantRoute({ env: {} })
const ask = (body: unknown, signal?: AbortSignal) => route(apiRequest(body, signal))
const ok = (r: ApiResult) => {
  expect(r.status, JSON.stringify(r.json)).toBe(200)
  return r.json as AssistantResponse
}
const err = (r: ApiResult) => r.json as { code: string; message: string; retryable: boolean }

const bindQ = [
  { kind: 'create_map', name: 'q', label: 'Q', dimension: 3, definition: { preset: { kind: 'projection', keep: [false, true, true] } } },
  { kind: 'create_experiment', name: 'q', sampleSetId: 'grid3', branches: [{ id: 'main', mapIds: ['$q'] }] },
  { kind: 'bind_recipe', experimentId: '$q', recipeId: 'what-gets-lost', bindings: { samples: 'grid3', map: 'main', selection: 's(1,0,1)' } },
]

afterEach(() => vi.unstubAllEnvs())

describe('synthetic fixtures against the demo document', () => {
  it('"Show me what this transformation loses" selects u and explains from exact facts', async () => {
    const body = assistantRequest('Show me what this transformation loses')
    const j = ok(await ask(body))
    expect(j.source).toBe('synthetic')
    expect(j.model).toBe('synthetic:what-gets-lost')
    expect(j.requestId).toBe(body.requestId)
    expect(j.timing.providerMs).toBeNull()
    expect(j.proposal.actions).toEqual([{ kind: 'select', experimentId: 'exp-p', sampleId: 's(1,0,1)' }])
    expect(j.proposal.explanation).toContain('Pu = P(1, 0, 1) = (1, 0, 0)')
    expect(j.proposal.explanation).toContain('v')
    expect(j.proposal.explanation).toMatch(/line along z/)
    expect(j.proposal.explanation.length).toBeLessThanOrEqual(700)
    // The client can commit it (revision and context still match).
    const ws = new Workspace(demoDocument())
    expect(() => ws.commit({ baseRevision: j.baseRevision, actions: j.proposal.actions })).not.toThrow()
  })

  it('"Use this representation on Q" is exactly the bindQ transaction and separates u from v', async () => {
    const j = ok(await ask(assistantRequest('Use this representation on Q.')))
    expect(j.model).toBe('synthetic:use-on-q')
    expect(j.proposal.actions).toEqual(bindQ)
    expect(j.proposal.explanation).toContain('Qu = Q(1, 0, 1) = (0, 0, 1)')
    expect(j.proposal.explanation).toContain('Qv = (0, 0, -1)')
    expect(j.proposal.explanation).toContain('Qa = Qb = (0, 1, 0)')
    expect(j.proposal.explanation).toMatch(/line along x/)
    const { doc } = new Workspace(demoDocument()).commit({ baseRevision: j.baseRevision, actions: j.proposal.actions })
    expect(doc.selection).toEqual({ experimentId: 'exp-q', sampleId: 's(1,0,1)', item: null })
    expect(findExperiment(doc, 'exp-q').binding?.recipeId).toBe('what-gets-lost')
    const set = doc.sampleSets[0]!.samples
    expect(exactOutputGroups(displayedMatrix(doc), set).find((g) => g.ids.includes('s(1,0,1)'))!.ids).not.toContain('s(1,0,-1)')
  })

  it('"Check that u and v have the same image" requests a same_image_witness check on the displayed experiment', async () => {
    const j = ok(await ask(assistantRequest('check that u and v have the same image')))
    expect(j.model).toBe('synthetic:check-same-image')
    expect(j.proposal.actions).toEqual([{ kind: 'request_check', claim: { kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: 's(1,0,1)', v: 's(1,0,-1)' } }])
    expect(j.proposal.explanation).toMatch(/Nothing is Lean-checked/)
    const plan = planTransaction(demoDocument(), j.proposal.actions)
    expect(plan.changed).toBe(false)
    expect(plan.effects).toEqual([{ kind: 'request_check', claim: (j.proposal.actions[0] as { claim: unknown }).claim }])
  })

  it('the check targets whichever experiment is displayed (Q after rebinding)', async () => {
    const { doc } = new Workspace(demoDocument()).commit({ baseRevision: 0, actions: bindQ })
    const j = ok(await ask(assistantRequest('Check that u and v have the same image', doc)))
    expect(j.baseRevision).toBe(1)
    expect(JSON.stringify(j.proposal.actions)).toContain('"experimentId":"exp-q"')
    expect(j.proposal.explanation).toContain('Qu = (0, 0, 1) and Qv = (0, 0, -1)')
  })

  it.each([
    ['Rotate by 30 degrees', 'synthetic:unsupported-rotation', /quarter turns/],
    ['Run this Python: print(open("/etc/passwd").read())', 'synthetic:unsupported-code', /cannot run Python/],
  ])('"%s" is an explanation with no actions', async (prompt, model, text) => {
    const j = ok(await ask(assistantRequest(prompt)))
    expect(j.model).toBe(model)
    expect(j.proposal.actions).toEqual([])
    expect(j.proposal.explanation).toMatch(text)
  })

  it('an answer-only fixture returns facts and actions: []', async () => {
    const j = ok(await ask(assistantRequest('What does this map do?')))
    expect(j.proposal.actions).toEqual([])
    expect(j.proposal.explanation).toMatch(/Coordinate projection discarding z/)
    expect(j.proposal).not.toHaveProperty('mode')
  })

  it('an unknown prompt gets an honest "no fixture" error, never invented output', async () => {
    const r = await ask(assistantRequest('Explain eigenvalues to me'))
    expect(r.status).toBe(422)
    expect(err(r)).toMatchObject({ code: 'synthetic_no_fixture', retryable: false })
    expect(err(r).message).toMatch(/^Synthetic mode has no fixture for this prompt/)
    for (const f of FIXTURES) expect(err(r).message).toContain(f.example)
  })

  it('fixture output is validated like live output: Q cannot be created twice', async () => {
    const { doc } = new Workspace(demoDocument()).commit({ baseRevision: 0, actions: bindQ })
    const r = await ask(assistantRequest('Use this representation on Q', doc))
    expect(r.status).toBe(422)
    expect(err(r)).toMatchObject({ code: 'proposal_rejected', retryable: false })
    expect(err(r).message).toMatch(/map-q already exists/)
    expect(r.json).not.toHaveProperty('proposal')
  })

  it('every fixture explanation fits the 700-character limit on the demo and the Q documents', async () => {
    const q = new Workspace(demoDocument()).commit({ baseRevision: 0, actions: bindQ }).doc
    for (const doc of [demoDocument(), q]) for (const f of FIXTURES) expect(f.build(doc).explanation.length, f.name).toBeLessThanOrEqual(700)
  })
})

describe('request validation and context', () => {
  it('echoes the base revision and a server-recomputed context hash equal to the client computation', async () => {
    const body = assistantRequest('Show me what this transformation loses')
    const j = ok(await ask(body))
    expect(j.baseRevision).toBe(body.baseRevision)
    expect(j.contextHash).toMatch(/^[0-9a-f]{64}$/)
    expect(j.contextHash).toBe(await assistantContextHash(body.context))
  })

  it('never accepts a client-supplied hash (closed request fields)', async () => {
    const r = await ask({ ...assistantRequest('Show me what this transformation loses'), contextHash: '0'.repeat(64) })
    expect(r.status).toBe(400)
    expect(err(r).message).toMatch(/unknown field "contextHash"/)
  })

  it.each([
    ['a prompt above 2,000 characters', { prompt: 'x'.repeat(2001) }, 'prompt_too_long'],
    ['an empty prompt', { prompt: '   ' }, 'invalid_request'],
    ['a non-integer baseRevision', { baseRevision: 0.5 }, 'invalid_request'],
    ['an invalid requestId', { requestId: 'bad id with spaces' }, 'invalid_request'],
    ['a workspaceId that does not match the document', { workspaceId: 'ws-other' }, 'context_mismatch'],
    ['a baseRevision that does not match the document', { baseRevision: 3 }, 'context_mismatch'],
  ])('rejects %s', async (_, over, code) => {
    const r = await ask({ ...assistantRequest('Show me what this transformation loses'), ...over })
    expect(r.status).toBe(400)
    expect(err(r).code).toBe(code)
  })

  it('accepts exactly 2,000 characters', async () => {
    const r = await ask(assistantRequest('y'.repeat(2000)))
    expect(err(r).code).toBe('synthetic_no_fixture')
  })

  it('rejects an invalid document with the strict import validator', async () => {
    const body = assistantRequest('Show me what this transformation loses')
    const bad = structuredClone(body)
    bad.context.document.maps[0]!.matrix[0]![0] = { n: '2', d: '4' }
    const r = await ask(bad)
    expect(r.status).toBe(400)
    expect(err(r).code).toBe('invalid_document')
    expect(err(r).message).toMatch(/coprime/)
  })

  it('rejects malformed W5 evidence references and unknown context fields', async () => {
    const body = assistantRequest('Show me what this transformation loses')
    const claim = { kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: 's(1,0,1)', v: 's(1,0,-1)' }
    const good = { claim, claimHash: 'a'.repeat(64), receiptId: '7f1c2b8e-0000-4000-8000-000000000000' }
    const withEvidence = (evidence: unknown[]) => ({ ...body, context: { ...body.context, evidence } })
    for (const [bad, message] of [
      [{ claimHash: 'a'.repeat(64), receiptId: good.receiptId }, /missing field "claim"/],
      [{ ...good, claimHash: 'nope' }, /SHA-256/],
      [{ ...good, receiptId: null }, /receipt ID/],
      [{ ...good, status: 'checked' }, /unknown field "status"/],
      [{ ...good, claim: { ...claim, kind: 'universal_theorem' } }, /unknown claim kind/],
    ] as const) {
      const r = await ask(withEvidence([bad]))
      expect(r.status, JSON.stringify(bad)).toBe(400)
      expect(err(r).code).toBe('invalid_request')
      expect(err(r).message).toMatch(message)
    }
    expect(err(await ask(withEvidence(Array(9).fill(good)))).message).toMatch(/at most 8 references/)
    expect((await ask({ ...body, context: { ...body.context, facts: [] } })).status).toBe(400)
    const okEvidence = withEvidence([good])
    const j = ok(await ask(okEvidence))
    expect(j.contextHash).toBe(await assistantContextHash({ ...okEvidence.context, evidence: [good as EvidenceRef] }))
    expect(j.contextHash).not.toBe(await assistantContextHash(body.context))
  })

  it('rejects a non-object body, an oversize body and non-POST methods', async () => {
    expect((await ask('hello')).status).toBe(400)
    const big = assistantRequest('Show me what this transformation loses')
    const r = await ask({ ...big, context: { ...big.context, document: { ...big.context.document, pad: 'x'.repeat(300 * 1024) } } })
    expect(r.status).toBe(413)
    expect((await route({ method: 'GET', path: '/api/assistant', body: undefined, signal: new AbortController().signal })).status).toBe(405)
  })

  it('a request aborted before the answer returns no proposal', async () => {
    const ctl = new AbortController()
    ctl.abort(new Error('client disconnected'))
    const r = await ask(assistantRequest('Show me what this transformation loses'), ctl.signal)
    expect(r.status).toBe(499)
    expect(err(r).code).toBe('cancelled')
  })

  it('the request document is never mutated', async () => {
    const body = assistantRequest('Use this representation on Q')
    const before = JSON.stringify(body)
    ok(await ask(body))
    expect(JSON.stringify(body)).toBe(before)
    expect(body.context.document).toEqual(docToJson(demoDocument()))
  })
})

describe('default exports without a key', () => {
  it('museCapabilities() is all false in synthetic mode', () => {
    vi.stubEnv('META_API_KEY', '')
    vi.stubEnv('MODEL_API_KEY', '')
    vi.stubEnv('MUSE_MODE', '')
    expect(museCapabilities()).toEqual({ configured: false, authenticated: false, liveValidated: false, model: null, mode: 'synthetic' })
  })

  it('assistantRoute answers with a labelled synthetic fixture', async () => {
    vi.stubEnv('META_API_KEY', '')
    vi.stubEnv('MODEL_API_KEY', '')
    vi.stubEnv('MUSE_MODE', '')
    const r = await assistantRoute(apiRequest(assistantRequest('Show me what this transformation loses')))
    expect(ok(r)).toMatchObject({ source: 'synthetic', model: 'synthetic:what-gets-lost' })
  })
})
