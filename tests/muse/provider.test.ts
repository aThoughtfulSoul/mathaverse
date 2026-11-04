// The Meta Responses adapter through the route, with a MOCKED fetch. Every provider reply here is
// SYNTHETIC: shaped like the documented Response object, never recorded from a live call. Live
// provider verification is PENDING (docs/MUSE.md).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assistantContextHash } from '../../src/workspace/context'
import { demoDocument, docToJson } from '../../src/workspace/document'
import { capabilitiesFor, createAssistantRoute, type MuseDeps } from '../../server/muse/index'
import { newStatus } from '../../server/muse/config'
import { INSTRUCTIONS } from '../../server/muse/prompt'
import type { ApiResult } from '../../server/types'
import { LIVE_ENV, SYNTHETIC_KEY, apiRequest, assistantRequest, hangUntilAborted, mockFetch, syntheticProposal, syntheticReply } from './helpers'

const bindQ = [
  { kind: 'create_map', name: 'q', label: 'Q', dimension: 3, definition: { preset: { kind: 'projection', keep: [false, true, true] } } },
  { kind: 'create_experiment', name: 'q', sampleSetId: 'grid3', branches: [{ id: 'main', mapIds: ['$q'] }] },
  { kind: 'bind_recipe', experimentId: '$q', recipeId: 'what-gets-lost', bindings: { samples: 'grid3', map: 'main', selection: 's(1,0,1)' } },
]
const selectU = [{ kind: 'select', experimentId: 'exp-p', sampleId: 's(1,0,1)' }]

// Everything the tests observe, checked for the key at the end of each test.
const observed: string[] = []
const consoleSpies: ReturnType<typeof vi.spyOn>[] = []
beforeEach(() => {
  observed.length = 0
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) consoleSpies.push(vi.spyOn(console, m))
})
afterEach(() => {
  const logged = consoleSpies.flatMap((s) => s.mock.calls.map((c) => JSON.stringify(c)))
  for (const text of [...observed, ...logged]) expect(text).not.toContain(SYNTHETIC_KEY)
  consoleSpies.splice(0).forEach((s) => s.mockRestore())
})

async function run(fetchMock: ReturnType<typeof mockFetch>, prompt = 'Show me what this transformation loses', extra: Partial<MuseDeps> & { signal?: AbortSignal } = {}) {
  const status = extra.status ?? newStatus()
  const route = createAssistantRoute({ env: LIVE_ENV, fetchImpl: fetchMock.fetchImpl, status, minRepairMs: 0, ...extra })
  const body = assistantRequest(prompt)
  const res = await route(apiRequest(body, extra.signal))
  observed.push(JSON.stringify(res), ...fetchMock.calls.map((c) => JSON.stringify(c.body) + c.url))
  return { res, body, status }
}
const err = (r: ApiResult) => r.json as { code: string; message: string; retryable: boolean }

describe('Responses request (synthetic mock)', () => {
  it('posts the documented request shape; the key is only in the Authorization header', async () => {
    const m = mockFetch(syntheticReply(syntheticProposal(selectU)))
    const { res } = await run(m)
    expect(res.status).toBe(200)
    expect(m.calls).toHaveLength(1)
    const [call] = m.calls
    expect(call!.url).toBe('https://api.meta.ai/v1/responses')
    expect(call!.init.method).toBe('POST')
    expect(call!.init.redirect).toBe('error')
    const headers = call!.init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${SYNTHETIC_KEY}`)
    expect(headers['Content-Type']).toBe('application/json')
    expect(Object.entries(headers).filter(([, v]) => v.includes(SYNTHETIC_KEY)).map(([k]) => k)).toEqual(['Authorization'])
    expect(call!.url).not.toContain(SYNTHETIC_KEY)
    expect(String(call!.init.body)).not.toContain(SYNTHETIC_KEY)

    const b = call!.body as Record<string, any>
    expect(Object.keys(b).sort()).toEqual(['input', 'instructions', 'max_output_tokens', 'model', 'reasoning', 'store', 'text'])
    expect(b.model).toBe('muse-spark-1.3')
    expect(b.instructions).toBe(INSTRUCTIONS)
    expect(b.store).toBe(false)
    expect(b.reasoning).toEqual({ effort: 'low' })
    expect(b.text.format).toMatchObject({ type: 'json_schema', name: 'workspace_proposal', strict: true })
    expect(b.text.format.schema.type).toBe('object')
    expect(b).not.toHaveProperty('response_format')
    expect(b.input).toHaveLength(1)
    expect(b.input[0].role).toBe('user')
    expect(b.input[0].content.map((c: { type: string }) => c.type)).toEqual(['input_text', 'input_text'])
    expect(b.input[0].content[0].text).toContain('Show me what this transformation loses')
    const ctx = JSON.parse(b.input[0].content[1].text.replace(/^[^\n]*\n/, ''))
    expect(ctx.workspace).toEqual(docToJson(demoDocument()))
    expect(ctx.facts.map((f: { id: string }) => f.id)).toContain('selected:exp-p/main')
    expect(ctx.evidence).toEqual({ note: expect.stringMatching(/server-verified for the current inputs/), verified: 0, unavailable: 0, references: [] })
    expect(ctx.prepared.orderComparison.actions).toHaveLength(7)
    expect(ctx.prepared.displayedComparison).toBeNull()
  })

  it('honours META_MODEL and META_ENDPOINT from the server environment only', async () => {
    const m = mockFetch(syntheticReply(syntheticProposal(selectU)))
    const { res } = await run(m, undefined, { env: { ...LIVE_ENV, META_MODEL: 'muse-spark-1.2', META_ENDPOINT: 'https://example.test/v1/responses' } })
    expect(res.status).toBe(200)
    expect(m.calls[0]!.url).toBe('https://example.test/v1/responses')
    expect(m.calls[0]!.body.model).toBe('muse-spark-1.2')
    expect((res.json as { model: string }).model).toBe('muse-spark-1.2')
  })
})

describe('extraction and envelope (synthetic mock)', () => {
  it('reads output[] message output_text, validates and wraps it with server provenance', async () => {
    const m = mockFetch(syntheticReply(syntheticProposal(bindQ, { title: 'Use the representation on Q' })))
    const { res, body, status } = await run(m, 'Use this representation on Q')
    expect(res.status).toBe(200)
    const j = res.json as Record<string, any>
    expect(Object.keys(j).sort()).toEqual(['baseRevision', 'contextHash', 'model', 'proposal', 'requestId', 'source', 'timing'])
    expect(j.requestId).toBe(body.requestId)
    expect(j.source).toBe('meta')
    expect(j.model).toBe('muse-spark-1.3')
    expect(j.baseRevision).toBe(0)
    expect(j.contextHash).toBe(await assistantContextHash(body.context))
    expect(typeof j.timing.providerMs).toBe('number')
    expect(j.timing.totalMs).toBeGreaterThanOrEqual(j.timing.providerMs)
    expect(j.proposal.actions).toEqual(bindQ)
    expect(capabilitiesFor(LIVE_ENV, status)).toEqual({ configured: true, authenticated: true, liveValidated: true, model: 'muse-spark-1.3', mode: 'meta' })
  })

  it('accepts JSON inside one Markdown code fence', async () => {
    const m = mockFetch(syntheticReply('```json\n' + syntheticProposal(selectU) + '\n```'))
    expect((await run(m)).res.status).toBe(200)
  })

  it('model provenance cannot be injected: extra envelope fields from the model are rejected', async () => {
    const m = mockFetch(syntheticReply(syntheticProposal(selectU, { source: 'meta', model: 'gpt' })), syntheticReply(syntheticProposal(selectU, { source: 'meta' })))
    const { res } = await run(m)
    expect(res.status).toBe(502)
    expect(err(res).code).toBe('invalid_output')
  })
})

describe('one bounded repair (synthetic mock)', () => {
  it('repairs non-JSON output once, replaying the output and the validator reason', async () => {
    const m = mockFetch(syntheticReply('Sure! Here is a proposal.'), syntheticReply(syntheticProposal(selectU)))
    const { res } = await run(m)
    expect(res.status).toBe(200)
    expect(m.calls).toHaveLength(2)
    const input = m.calls[1]!.body.input as { role: string; content: { type: string; text: string }[] }[]
    expect(input).toHaveLength(3)
    expect(input[1]).toEqual({ role: 'assistant', content: [{ type: 'output_text', text: 'Sure! Here is a proposal.' }] })
    expect(input[2]!.content[0]!.text).toContain('not a single JSON object')
  })

  it('never makes a third attempt: malformed JSON twice is invalid_output', async () => {
    const m = mockFetch(syntheticReply('{"proposalVersion": 1, "title": '), syntheticReply('still not json'), syntheticReply(syntheticProposal(selectU)))
    const { res } = await run(m)
    expect(m.calls).toHaveLength(2)
    expect(res.status).toBe(502)
    expect(err(res)).toMatchObject({ code: 'invalid_output', retryable: true })
    expect(res.json).not.toHaveProperty('proposal')
  })

  it('an unknown action kind is rejected after the repair', async () => {
    const bad = syntheticProposal([{ kind: 'run_code', source: 'import os' }])
    const m = mockFetch(syntheticReply(bad), syntheticReply(bad))
    const { res } = await run(m, 'Run this Python')
    expect(res.status).toBe(502)
    expect(err(res).code).toBe('invalid_output')
    expect(err(res).message).toMatch(/unknown action kind "run_code"/)
  })

  it('an unknown field (no `mode` in v0.1) is rejected', async () => {
    const bad = syntheticProposal([], { mode: 'answer' })
    const m = mockFetch(syntheticReply(bad), syntheticReply(bad))
    const { res } = await run(m)
    expect(err(res).code).toBe('invalid_output')
    expect(err(res).message).toMatch(/unknown field "mode"/)
  })

  it('an invalid last action fails planTransaction: proposal_rejected, nothing returned', async () => {
    const bad = syntheticProposal([...bindQ, { kind: 'select', experimentId: '$q', sampleId: 's(9,9,9)' }])
    const m = mockFetch(syntheticReply(bad), syntheticReply(bad))
    const { res, body } = await run(m, 'Use this representation on Q')
    expect(res.status).toBe(422)
    expect(err(res)).toMatchObject({ code: 'proposal_rejected', retryable: true })
    expect(err(res).message).toMatch(/actions\[3\]/)
    expect(res.json).not.toHaveProperty('proposal')
    expect(body.context.document).toEqual(docToJson(demoDocument()))
    // The repair turn carries the planner's reason.
    expect(JSON.stringify(m.calls[1]!.body.input)).toContain('actions[3] (select)')
  })

  it('a semantic failure can be repaired into a valid proposal', async () => {
    const m = mockFetch(syntheticReply(syntheticProposal([{ kind: 'select', experimentId: 'exp-missing', sampleId: null }])), syntheticReply(syntheticProposal(selectU)))
    const { res } = await run(m)
    expect(res.status).toBe(200)
    expect(m.calls).toHaveLength(2)
  })

  it('an incomplete response is repaired once', async () => {
    const m = mockFetch(syntheticReply('{"proposalVersion"', { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), syntheticReply(syntheticProposal(selectU)))
    const { res } = await run(m)
    expect(res.status).toBe(200)
    expect(JSON.stringify(m.calls[1]!.body.input)).toContain('incomplete (max_output_tokens)')
  })

  it('skips the repair when too little of the deadline remains', async () => {
    const m = mockFetch(syntheticReply('not json'), syntheticReply(syntheticProposal(selectU)))
    const { res } = await run(m, undefined, { minRepairMs: 60_000 })
    expect(m.calls).toHaveLength(1)
    expect(err(res).code).toBe('invalid_output')
  })
})

describe('code execution and unsupported requests (synthetic mock)', () => {
  it('an explanation-only answer to "run this Python" is a valid proposal with no actions', async () => {
    const m = mockFetch(syntheticReply(syntheticProposal([], { title: 'Code cannot run here', explanation: 'The workspace cannot run Python.' })))
    const { res } = await run(m, 'Run this Python: import os; os.system("ls")')
    expect(res.status).toBe(200)
    expect((res.json as { proposal: { actions: unknown[] } }).proposal.actions).toEqual([])
    expect(INSTRUCTIONS).toMatch(/cannot run or write code \(JavaScript, Python, Lean, shaders\), fetch URLs, add packages or create new mathematical operations/)
  })

  it('a refusal part is reported, never turned into a proposal', async () => {
    const reply = new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'synthetic refusal' }] }] }), { status: 200 })
    const { res } = await run(mockFetch(reply))
    expect(res.status).toBe(422)
    expect(err(res)).toMatchObject({ code: 'model_refused', retryable: false })
  })
})

describe('provider failures (synthetic mock)', () => {
  it('cancellation: an aborted request uses no response', async () => {
    const ctl = new AbortController()
    const m = mockFetch((init) => {
      setTimeout(() => ctl.abort(new Error('client disconnected')), 5)
      return hangUntilAborted(init)
    })
    const { res } = await run(m, undefined, { signal: ctl.signal })
    expect(res.status).toBe(499)
    expect(err(res)).toMatchObject({ code: 'cancelled', retryable: false })
    expect(m.calls[0]!.init.signal!.aborted).toBe(true)
  })

  it('cancellation after the provider answered still uses no response', async () => {
    const ctl = new AbortController()
    const m = mockFetch(async () => {
      ctl.abort(new Error('client disconnected'))
      return syntheticReply(syntheticProposal(selectU))
    })
    const { res, status } = await run(m, undefined, { signal: ctl.signal })
    expect(res.status).toBe(499)
    expect(status.liveValidatedFor).toBeNull()
  })

  it('the application timeout (mount abort) is reported as a timeout', async () => {
    const ctl = new AbortController()
    const m = mockFetch((init) => {
      setTimeout(() => ctl.abort(new Error('application timeout')), 5)
      return hangUntilAborted(init)
    })
    const { res } = await run(m, undefined, { signal: ctl.signal })
    expect(res.status).toBe(504)
    expect(err(res)).toMatchObject({ code: 'timeout', retryable: true })
  })

  it("provider deadline: a call that never answers ends with provider_timeout, named as this application's limit", async () => {
    const { res } = await run(mockFetch(hangUntilAborted), undefined, { deadlineMs: 50 })
    expect(res.status).toBe(504)
    expect(err(res)).toMatchObject({ code: 'provider_timeout', retryable: true })
    expect(err(res).message).toMatch(/this application's 0\.1 s limit/)
    expect(err(res).message).not.toMatch(/HTTP 504|gateway/)
  })

  it('401 is an access error, not retryable, with no provider body echoed', async () => {
    const reply = new Response(JSON.stringify({ error: { message: `synthetic echo ${SYNTHETIC_KEY}`, type: 'authentication_error', param: null, code: 'invalid_api_key' } }), { status: 401 })
    const status = newStatus()
    status.authenticatedFor = 'stale'
    const { res } = await run(mockFetch(reply), undefined, { status })
    expect(res.status).toBe(503)
    expect(err(res)).toMatchObject({ code: 'provider_auth', retryable: false })
    expect(err(res).message).not.toMatch(/synthetic echo|invalid_api_key/)
    expect(status.authenticatedFor).toBeNull()
    expect(capabilitiesFor(LIVE_ENV, status)).toMatchObject({ configured: true, authenticated: false, liveValidated: false })
  })

  it('403 is an access error', async () => {
    const { res } = await run(mockFetch(new Response('{}', { status: 403 })))
    expect(err(res).code).toBe('provider_auth')
  })

  it('429 is retryable and reports Retry-After', async () => {
    const reply = new Response(JSON.stringify({ error: { message: 'Rate limit exceeded. synthetic body', type: 'rate_limit_error', code: 'rate_limit_exceeded' } }), { status: 429, headers: { 'retry-after': '15' } })
    const { res } = await run(mockFetch(reply))
    expect(res.status).toBe(429)
    expect(err(res)).toMatchObject({ code: 'provider_rate_limited', retryable: true })
    expect(err(res).message).toMatch(/about 15 s/)
    expect(err(res).message).not.toMatch(/synthetic body/)
  })

  it.each([500, 502, 503])('%i is a retryable provider_unavailable', async (s) => {
    const { res } = await run(mockFetch(new Response('{"error":{"message":"synthetic"}}', { status: s })))
    expect(res.status).toBe(502)
    expect(err(res)).toMatchObject({ code: 'provider_unavailable', retryable: true })
  })

  it('503 is transient: retryable, with its Retry-After wait', async () => {
    const { res } = await run(mockFetch(new Response('{"error":{"message":"synthetic body"}}', { status: 503, headers: { 'retry-after': '7' } })))
    expect(err(res)).toMatchObject({ code: 'provider_unavailable', retryable: true })
    expect(err(res).message).toMatch(/temporarily unavailable \(HTTP 503\); try again in about 7 s/)
    expect(err(res).message).not.toMatch(/synthetic body/)
  })

  it.each([504, 408])('upstream %i is a gateway timeout: not retryable as-is, a smaller request is the remedy', async (s) => {
    const m = mockFetch(new Response('{"error":{"type":"gateway_timeout","message":"synthetic body"}}', { status: s }))
    const { res } = await run(m)
    expect(res.status).toBe(504)
    expect(err(res)).toMatchObject({ code: 'provider_gateway_timeout', retryable: false })
    expect(err(res).message).toContain(`HTTP ${s}`)
    expect(err(res).message).toMatch(/The workspace has not changed\./)
    expect(err(res).message).toMatch(/same request again unchanged is not the remedy; a smaller or simpler request may succeed/)
    expect(err(res).message).not.toMatch(/synthetic body/)
    expect(res.json).not.toHaveProperty('proposal')
    // No repair attempt or automatic resend of the same request.
    expect(m.calls).toHaveLength(1)
  })

  it('the four outcomes stay distinct: upstream 504, this app\'s deadline, 429 and 503', async () => {
    const upstream = err((await run(mockFetch(new Response('{}', { status: 504 })))).res)
    const deadline = err((await run(mockFetch(hangUntilAborted), undefined, { deadlineMs: 50 })).res)
    const limited = err((await run(mockFetch(new Response('{}', { status: 429, headers: { 'retry-after': '3' } })))).res)
    const transient = err((await run(mockFetch(new Response('{}', { status: 503 })))).res)
    expect([upstream, deadline, limited, transient].map((e) => [e.code, e.retryable])).toEqual([
      ['provider_gateway_timeout', false],
      ['provider_timeout', true],
      ['provider_rate_limited', true],
      ['provider_unavailable', true],
    ])
  })

  it('400 is a non-retryable rejection', async () => {
    const { res } = await run(mockFetch(new Response('{"error":{"message":"synthetic","type":"invalid_request_error"}}', { status: 400 })))
    expect(err(res)).toMatchObject({ code: 'provider_rejected', retryable: false })
  })

  it('a network error is reported truthfully', async () => {
    const { res } = await run(mockFetch(new TypeError('fetch failed')))
    expect(res.status).toBe(502)
    expect(err(res)).toMatchObject({ code: 'provider_network', retryable: true })
  })

  it('a non-JSON provider body is provider_malformed (no repair: the envelope, not the model, is broken)', async () => {
    const m = mockFetch(new Response('<html>synthetic</html>', { status: 200 }))
    const { res } = await run(m)
    expect(m.calls).toHaveLength(1)
    expect(err(res).code).toBe('provider_malformed')
  })

  it('an over-size provider body is refused', async () => {
    const { res } = await run(mockFetch(new Response('x'.repeat(600 * 1024), { status: 200 })))
    expect(err(res).code).toBe('provider_response_too_large')
  })

  it('status "failed" is provider_failed', async () => {
    const { res } = await run(mockFetch(syntheticReply('', { status: 'failed', output: [] })))
    expect(err(res).code).toBe('provider_failed')
  })
})

describe('configuration and capabilities', () => {
  it('reports everything false without a key, in synthetic mode', () => {
    expect(capabilitiesFor({}, newStatus())).toEqual({ configured: false, authenticated: false, liveValidated: false, model: null, mode: 'synthetic' })
  })
  it('a key alone is configured, not authenticated', () => {
    expect(capabilitiesFor(LIVE_ENV, newStatus())).toEqual({ configured: true, authenticated: false, liveValidated: false, model: 'muse-spark-1.3', mode: 'meta' })
    expect(capabilitiesFor({ MODEL_API_KEY: SYNTHETIC_KEY }, newStatus()).configured).toBe(true)
  })
  it('a status earned under one configuration is not reported for another', async () => {
    const { status } = await run(mockFetch(syntheticReply(syntheticProposal(selectU))))
    expect(capabilitiesFor(LIVE_ENV, status).liveValidated).toBe(true)
    expect(capabilitiesFor({ ...LIVE_ENV, META_MODEL: 'muse-spark-1.2' }, status)).toMatchObject({ authenticated: false, liveValidated: false })
  })
  it('MUSE_MODE=synthetic forces labelled fixtures even with a key', async () => {
    const m = mockFetch()
    const { res } = await run(m, undefined, { env: { ...LIVE_ENV, MUSE_MODE: 'synthetic' } })
    expect(m.calls).toHaveLength(0)
    expect((res.json as { source: string }).source).toBe('synthetic')
    expect(capabilitiesFor({ ...LIVE_ENV, MUSE_MODE: 'synthetic' }, newStatus()).mode).toBe('synthetic')
  })
  it.each([
    [{ META_ENDPOINT: 'http://api.meta.ai/v1/responses' }, /https/],
    [{ META_MODEL: 'bad model' }, /META_MODEL/],
    [{ META_REASONING_EFFORT: 'none' }, /META_REASONING_EFFORT/],
    [{ MUSE_MODE: 'live' }, /MUSE_MODE/],
  ])('an unusable configuration is a truthful 503 (%o)', async (extra, msg) => {
    const m = mockFetch()
    const { res } = await run(m, undefined, { env: { ...LIVE_ENV, ...extra } })
    expect(m.calls).toHaveLength(0)
    expect(res.status).toBe(503)
    expect(err(res).code).toBe('assistant_misconfigured')
    expect(err(res).message).toMatch(msg)
    expect(capabilitiesFor({ ...LIVE_ENV, ...extra }, newStatus())).toMatchObject({ configured: false, mode: 'unavailable', model: null })
  })
})

describe('no silent synthetic fallback (synthetic mock)', () => {
  // Every prompt below has a synthetic fixture; with a key configured none of them may be answered by it.
  const fixturePrompts = ['Show me why rotation and reflection order matters', 'Show me what this transformation loses']

  it.each([
    ['401 (invalid key)', () => new Response('{}', { status: 401 }), 503, 'provider_auth'],
    ['500 (provider error)', () => new Response('{}', { status: 500 }), 502, 'provider_unavailable'],
    ['a network error', () => new TypeError('fetch failed'), 502, 'provider_network'],
  ] as const)('%s is a truthful error with no proposal and no source', async (_, reply, http, code) => {
    for (const prompt of fixturePrompts) {
      const { res, status } = await run(mockFetch(reply()), prompt)
      expect(res.status).toBe(http)
      expect(err(res).code).toBe(code)
      expect(res.json).not.toHaveProperty('source')
      expect(res.json).not.toHaveProperty('proposal')
      expect(status.liveValidatedFor).toBeNull()
    }
  })

  it('a provider timeout is a truthful error with no proposal and no source', async () => {
    const { res } = await run(mockFetch(hangUntilAborted), fixturePrompts[0], { deadlineMs: 50 })
    expect(err(res).code).toBe('provider_timeout')
    expect(res.json).not.toHaveProperty('source')
  })

  it('"meta" is reported only after a real (here: mocked) provider answer validated', async () => {
    const m = mockFetch(syntheticReply(syntheticProposal(selectU)))
    const { res, status } = await run(m)
    expect(m.calls).toHaveLength(1)
    expect((res.json as { source: string }).source).toBe('meta')
    expect(status.liveValidatedFor).not.toBeNull()
  })

  it('nine actions are rejected, never truncated to eight', async () => {
    const nine = Array.from({ length: 9 }, () => selectU[0])
    const m = mockFetch(syntheticReply(syntheticProposal(nine)), syntheticReply(syntheticProposal(nine)))
    const { res } = await run(m)
    expect(res.status).toBe(502)
    expect(err(res).code).toBe('invalid_output')
    expect(err(res).message).toMatch(/at most 8 actions/)
    expect(res.json).not.toHaveProperty('proposal')
  })
})

