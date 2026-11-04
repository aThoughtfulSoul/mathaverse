// Lean track: POST /api/check with an injected runner (no Lean). Malformed input, false claims, audit
// anomalies, timeout, busy, abort and receipts (ACCEPTANCE A5, WORKSPACE-AND-AI W6). None of the failure
// cases may issue a receipt.

import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { type CheckResponse, type ClaimDescriptor, claimHash, parseClaimDescriptor } from '../../src/workspace/claims'
import { type CheckerDeps, createChecker } from '../../server/lean/index'
import { type RunResult, TOOLCHAIN_ID, runProcess } from '../../server/lean/runner'
import { createReceiptRegistry } from '../../server/lean/receipts'
import { auditRun } from '../../server/lean/audit'
import { pCollision, pEqualsQ, pVsQ, ppEqualsP, r, rsOrder } from './fixtures'

const msg = (data: string, severity = 'information') => JSON.stringify({ severity, data, caption: '', fileName: 'Claim.lean' })
const AUDIT_OK = msg("'MathWorkspace.claim' does not depend on any axioms")
const result = (over: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: `${AUDIT_OK}\n`, stderr: '', timedOut: false, aborted: false, overflow: false, spawnError: null, ms: 5, ...over })

function setup(run: CheckerDeps['run'] = async () => result(), probe: CheckerDeps['probe'] = async () => TOOLCHAIN_ID) {
  const receipts = createReceiptRegistry()
  const spy = vi.fn(run)
  const { checkRoute, leanCapabilities } = createChecker({ run: spy, probe, receipts })
  const post = (body: unknown, signal = new AbortController().signal) => checkRoute({ method: 'POST', path: '/api/check', body, signal })
  return { post, spy, receipts, leanCapabilities }
}

const body = (claim: unknown) => ({ requestId: 'req-7', claim })

function expectNoReceipt(json: unknown, status: 'not_established' | 'error') {
  const r = json as CheckResponse
  expect(r.status).toBe(status)
  expect(r.receipt).toBeNull()
  expect(r.provenance).toBeNull()
  expect(r.reason).toBeTruthy()
  return r
}

describe('request validation: 400 with no Lean run', () => {
  it.each([
    ['a non-coprime rational', () => { const c = pCollision(); if (c.kind === 'same_image_witness') c.u.coords[0] = { n: '2', d: '4' }; return body(c) }, 'invalid_claim', /coprime/],
    ['a zero denominator', () => { const c = pCollision(); if (c.kind === 'same_image_witness') c.u.coords[0] = { n: '1', d: '0' }; return body(c) }, 'invalid_claim', /denominator/],
    ['a number in place of a rational', () => { const c = pCollision() as unknown as { sequence: { matrix: unknown[][] }[] }; c.sequence[0]!.matrix[0]![0] = 1; return body(c) }, 'invalid_claim', /rational/],
    ['an unknown claim field', () => body({ ...pCollision(), proof: 'by trivial' }), 'invalid_claim', /unknown field/],
    ['a browser-supplied hash', () => ({ ...body(pCollision()), claimHash: 'f'.repeat(64) }), 'invalid_claim', /unknown field "claimHash"/],
    ['a browser-supplied result', () => ({ ...body(pCollision()), status: 'checked', receipt: { id: 'x' } }), 'invalid_claim', /unknown field/],
    ['a bad request ID', () => ({ requestId: 'x y\n', claim: pCollision() }), 'invalid_claim', /requestId/],
    ['a basis index outside the dimension', () => body({ ...rsOrder(), basisIndex: 2 }), 'invalid_claim', /basisIndex/],
    ['an entry outside the authored range', () => { const c = pCollision(); if (c.kind === 'same_image_witness') c.sequence[0]!.matrix[0]![0] = r(9); return body(c) }, 'capacity', /authored range/],
    ['a denominator above 1,000,000', () => { const c = pCollision(); if (c.kind === 'same_image_witness') c.v.coords[0] = r(1, 1_000_003); return body(c) }, 'capacity', /denominator/],
  ])('rejects %s', async (_, make, code, message) => {
    const { post, spy, receipts } = setup()
    const res = await post(make())
    expect(res.status).toBe(400)
    expect(res.json).toMatchObject({ code, retryable: false })
    expect((res.json as { message: string }).message).toMatch(message)
    expect(spy).not.toHaveBeenCalled()
    expect(receipts.size).toBe(0)
  })
})

describe('false claims: computed exactly, never submitted to Lean', () => {
  it.each([
    ['a false same-image claim', pCollision('s(0,0,1)'), /outputs differ: \(1, 0, 0\) and \(0, 0, 0\)/],
    ['equal inputs', pCollision('s(1,0,1)'), /the two inputs are equal/],
    ['an incorrect difference witness (P, Q agree on e2)', pVsQ(1), /both send e2 to \(0, 1, 0\)/],
    ['a false map equality (P = Q)', pEqualsQ(), /some entry differs/],
  ])('%s is not_established without a run', async (_, claim, reason) => {
    const { post, spy, receipts } = setup()
    const res = await post(body(claim))
    expect(res.status).toBe(200)
    const r = expectNoReceipt(res.json, 'not_established')
    expect(r.reason).toMatch(reason)
    expect(r.reason).toMatch(/not submitted to Lean/)
    expect(r.claimHash).toBe(await claimHash(parseClaimDescriptor(claim)))
    expect(r.statement).toContain('theorem claim')
    expect(spy).not.toHaveBeenCalled()
    expect(receipts.size).toBe(0)
  })
})

describe('audit anomalies from the runner: not_established, no receipt', () => {
  it.each([
    ['a sorryAx dependency', result({ stdout: msg("'MathWorkspace.claim' depends on axioms: [sorryAx]") })],
    ['sorry with its warning (Lean exits 0)', result({ stdout: [msg("declaration uses 'sorry'", 'warning'), msg("'MathWorkspace.claim' depends on axioms: [sorryAx]")].join('\n') })],
    ['native_decide (Lean exits 0, no warning)', result({ stdout: msg("'MathWorkspace.claim' depends on axioms: [Lean.ofReduceBool, Lean.trustCompiler]") })],
    ['one extra axiom', result({ stdout: msg("'MathWorkspace.claim' depends on axioms: [propext]") })],
    ['the three standard axioms', result({ stdout: msg("'MathWorkspace.claim' depends on axioms:\n  [propext, Classical.choice, Quot.sound]") })],
    ['a custom axiom', result({ stdout: msg("'MathWorkspace.claim' depends on axioms: [MathWorkspace.trustMe]") })],
    ['a renamed theorem', result({ stdout: msg("'MathWorkspace.claim2' does not depend on any axioms") })],
    ['a missing theorem', result({ code: 1, stdout: msg('Unknown constant `MathWorkspace.claim`', 'error') })],
    ['a compile error', result({ code: 1, stdout: [msg('Tactic `decide` failed', 'error'), AUDIT_OK].join('\n') })],
    ['an extra message', result({ stdout: [msg('hello'), AUDIT_OK].join('\n') })],
    ['no audit message', result({ stdout: '' })],
    ['unparseable output', result({ stdout: "'MathWorkspace.claim' does not depend on any axioms" })],
    ['stderr output', result({ stderr: 'INTERNAL PANIC' })],
    ['a nonzero exit with clean messages', result({ code: 1 })],
    ['output above the cap', result({ overflow: true, code: null })],
    ['a timeout', result({ timedOut: true, code: null, stdout: '' })],
  ])('%s', async (_, run) => {
    const { post, spy, receipts } = setup(async () => run)
    const res = await post(body(pCollision()))
    expect(res.status).toBe(200)
    expectNoReceipt(res.json, 'not_established')
    expect(spy).toHaveBeenCalledOnce()
    expect(receipts.size).toBe(0)
  })

  it('names the specific rejection', () => {
    const audit = (stdout: string, extra: Partial<RunResult> = {}) => auditRun(result({ stdout, ...extra }), 'MathWorkspace.claim')
    expect(audit(msg("'MathWorkspace.claim' depends on axioms: [sorryAx]"))).toEqual({ ok: false, reason: 'the proof uses sorry (sorryAx)' })
    expect(audit(msg("'MathWorkspace.claim' depends on axioms: [Lean.ofReduceBool, Lean.trustCompiler]"))).toMatchObject({ reason: /Lean.ofReduceBool/ })
    expect(audit(msg("'MathWorkspace.claim' depends on axioms: [propext]"))).toEqual({ ok: false, reason: 'unapproved axioms: propext' })
    expect(audit('', { timedOut: true })).toMatchObject({ reason: /timed out .*not a disproof/ })
    expect(audit(AUDIT_OK)).toEqual({ ok: true, axioms: [] })
  })
})

describe('process limits through the route', () => {
  it('busy: a second proof while one runs gets 429 checker_busy (retryable), never a queue', async () => {
    let release!: (r: RunResult) => void
    let calls = 0
    const { post, spy } = setup(() => (calls++ === 0 ? new Promise((res) => (release = res)) : Promise.resolve(result())))
    const first = post(body(pCollision()))
    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce())
    const second = await post(body(ppEqualsP()))
    expect(second.status).toBe(429)
    expect(second.json).toEqual({ code: 'checker_busy', message: expect.any(String), retryable: true })
    // A false claim needs no Lean and is answered even while busy.
    expect(((await post(body(pEqualsQ()))).json as CheckResponse).status).toBe('not_established')
    release(result())
    expect(((await first).json as CheckResponse).status).toBe('checked')
    expect(((await post(body(ppEqualsP()))).json as CheckResponse).status).toBe('checked')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('abort: the request signal kills the running process and nothing is established', async () => {
    const { post } = setup((_, opts) => runProcess('/bin/sleep', ['10'], tmpdir(), opts))
    const ac = new AbortController()
    const t0 = performance.now()
    const pending = post(body(pCollision()), ac.signal)
    setTimeout(() => ac.abort(), 50)
    const r = expectNoReceipt((await pending).json, 'error')
    expect(r.reason).toMatch(/cancelled/)
    expect(performance.now() - t0).toBeLessThan(3000)
  })

  it('a process that cannot start is an error, not a disproof', async () => {
    const { post } = setup((_, opts) => runProcess('/nonexistent/lean', [], tmpdir(), opts))
    expect(expectNoReceipt((await post(body(pCollision()))).json, 'error').reason).toMatch(/could not be started/)
  })

  it('a missing toolchain answers 503 and capabilities say unavailable', async () => {
    const { post, spy, leanCapabilities } = setup(undefined, async () => null)
    const res = await post(body(pCollision()))
    expect(res.status).toBe(503)
    expect(res.json).toMatchObject({ code: 'checker_unavailable', retryable: false })
    expect(spy).not.toHaveBeenCalled()
    expect(await leanCapabilities()).toEqual({ available: false, toolchain: null, templateVersion: null, claimKinds: [] })
  })
})

describe('receipts', () => {
  it('a successful audit issues a receipt bound to the server-recomputed hash', async () => {
    const { post, receipts } = setup()
    const claim: ClaimDescriptor = rsOrder(0)
    const r = (await post(body(claim))).json as CheckResponse
    const hash = await claimHash(parseClaimDescriptor(claim))
    expect(r).toMatchObject({ requestId: 'req-7', claimHash: hash, status: 'checked', reason: null })
    expect(r.provenance).toEqual({ templateVersion: 'mw-lean-claims-1', toolchain: TOOLCHAIN_ID, theorem: 'MathWorkspace.claim', axioms: [], inputHash: hash })
    expect(receipts.resolve(r.receipt!.id, hash)).toMatchObject({ claimHash: hash, issuedAt: r.receipt!.issuedAt })
    expect(receipts.resolve(r.receipt!.id, await claimHash(parseClaimDescriptor(rsOrder(1))))).toBeNull()
    expect(receipts.resolve('not-a-receipt', hash)).toBeNull()
  })

  it('labels and IDs change neither the hash nor the statement', async () => {
    const { post } = setup()
    const a = pCollision()
    const b = structuredClone(a)
    if (b.kind === 'same_image_witness') {
      b.u.label = '*/ evil -/'
      b.sequence[0]!.label = 'by sorry'
      b.sequence[0]!.mapId = 'other-map'
    }
    const ra = (await post(body(a))).json as CheckResponse
    const rb = (await post(body(b))).json as CheckResponse
    expect(rb.claimHash).toBe(ra.claimHash)
    expect(rb.statement).toBe(ra.statement)
    expect(rb.statement).not.toMatch(/evil|sorry|other-map/)
  })

  it('the registry is bounded: the oldest receipt is evicted', () => {
    const reg = createReceiptRegistry({ limit: 2 })
    const bind = (h: string) => ({ claimHash: h, templateVersion: 't', toolchain: 'l', theorem: 'T', axioms: [] })
    const [x, y, z] = ['a', 'b', 'c'].map((h) => reg.issue(bind(h.repeat(64))))
    expect(reg.size).toBe(2)
    expect(reg.resolve(x!.id, 'a'.repeat(64))).toBeNull()
    expect(reg.resolve(y!.id, 'b'.repeat(64))).not.toBeNull()
    expect(reg.resolve(z!.id, 'c'.repeat(64))).not.toBeNull()
  })
})
