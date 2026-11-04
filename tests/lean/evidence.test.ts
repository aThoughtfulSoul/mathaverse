// W5 server-resolved evidence (server/lean/evidence.ts): receipts are issued by the check route (injected
// runner that passes the audit; no Lean here), then every reference is resolved against a server-rebuilt
// document. The boundary cases of PQ-ARCHITECTURE-DECISIONS "Live Muse and W5", for both demonstrations.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { EvidenceRef } from '../../src/workspace/actions'
import { type CheckResponse, type ClaimRequest, claimHash, parseClaimDescriptor } from '../../src/workspace/claims'
import { type Doc, demoDocument, findExperiment } from '../../src/workspace/document'
import { Workspace, describeClaim } from '../../src/workspace/reducer'
import { ORDER_IDS, orderDemoActions, reverseRouteActions } from '../../src/demo/order'
import { createChecker } from '../../server/lean/index'
import { type ReceiptRegistry, createReceiptRegistry } from '../../server/lean/receipts'
import { type ResolvedEvidence, allUnavailable, resolveEvidenceWith } from '../../server/lean/evidence'
import { TOOLCHAIN_ID, type RunResult } from '../../server/lean/runner'
import { TEMPLATE_VERSION, THEOREM, generateClaim } from '../../server/lean/template'

const AUDIT_OK = JSON.stringify({ severity: 'information', data: "'MathWorkspace.claim' does not depend on any axioms", caption: '', fileName: 'Claim.lean' })
const passing = async (): Promise<RunResult> => ({ code: 0, stdout: `${AUDIT_OK}\n`, stderr: '', timedOut: false, aborted: false, overflow: false, spawnError: null, ms: 1 })

const bindQ = [
  { kind: 'create_map', name: 'q', label: 'Q', dimension: 3, definition: { preset: { kind: 'projection', keep: [false, true, true] } } },
  { kind: 'create_experiment', name: 'q', sampleSetId: 'grid3', branches: [{ id: 'main', mapIds: ['$q'] }] },
  { kind: 'bind_recipe', experimentId: '$q', recipeId: 'what-gets-lost', bindings: { samples: 'grid3', map: 'main', selection: 's(1,0,1)' } },
]
const P = { experimentId: 'exp-p', branchId: 'main' }
const Q = { experimentId: 'exp-q', branchId: 'main' }
const LEFT = { experimentId: ORDER_IDS.experiment, branchId: 'left' }
const RIGHT = { experimentId: ORDER_IDS.experiment, branchId: 'right' }
const pSame: ClaimRequest = { kind: 'same_image_witness', branch: P, u: 's(1,0,1)', v: 's(1,0,-1)' }
const rsDiffer: ClaimRequest = { kind: 'map_difference_witness', left: LEFT, right: RIGHT, basisIndex: 0 }
const rsEqual: ClaimRequest = { kind: 'map_equality', left: LEFT, right: RIGHT }

function setup() {
  const receipts = createReceiptRegistry()
  const { checkRoute } = createChecker({ run: passing, probe: async () => TOOLCHAIN_ID, receipts })
  /** Check a claim of `doc` through the route and return the reference a client would record. */
  const checked = async (doc: Doc, claim: ClaimRequest): Promise<EvidenceRef> => {
    const res = await checkRoute({ method: 'POST', path: '/api/check', body: { requestId: 'req-w5', claim: describeClaim(doc, claim) }, signal: new AbortController().signal })
    const r = res.json as CheckResponse
    expect(r.status).toBe('checked')
    return { claim, claimHash: r.claimHash, receiptId: r.receipt!.id }
  }
  const resolve = (doc: Doc, refs: EvidenceRef[], registry: ReceiptRegistry = receipts) => resolveEvidenceWith(doc, refs, (id, h) => registry.resolve(id, h))
  return { receipts, checked, resolve }
}

const one = async (p: Promise<ResolvedEvidence[]>) => (await p)[0]!

function expectUnavailable(r: ResolvedEvidence, reason: ResolvedEvidence['reason']) {
  expect(r.status).toBe('unavailable')
  expect(r.reason).toBe(reason)
  expect(r.statement).toBeNull()
  expect(r.provenance).toBeNull()
  expect(r.claimHash).toBeNull()
  expect(r.note).toMatch(/^Unavailable/)
}

/** P/Q workspace: Q created and displayed (u selected), P unchanged. */
const pqWorkspace = () => {
  const ws = new Workspace(demoDocument())
  ws.commit({ baseRevision: 0, actions: bindQ })
  return ws
}
/** Both demonstrations: P, Q and the operation-order comparison (displayed). */
const bothWorkspace = () => {
  const ws = pqWorkspace()
  ws.commit({ baseRevision: ws.current.revision, actions: orderDemoActions(ws.current) })
  return ws
}

describe('W5: a valid current receipt', () => {
  it('is verified, with the regenerated statement, current names and audited provenance', async () => {
    const { checked, resolve } = setup()
    const doc = demoDocument()
    const ref = await checked(doc, pSame)
    const r = await one(resolve(doc, [ref]))
    const exact = parseClaimDescriptor(describeClaim(doc, pSame))
    const hash = await claimHash(exact)
    expect(r).toMatchObject({ index: 0, kind: 'same_image_witness', status: 'verified', reason: null, claimHash: hash })
    expect(r.statement).toBe(generateClaim(exact, hash).statement)
    expect(r.statement).toContain('def u : Vec := [1, 0, 1]\ndef v : Vec := [1, 0, -1]')
    expect(r.provenance).toEqual({ receiptId: ref.receiptId, issuedAt: expect.any(String), templateVersion: TEMPLATE_VERSION, toolchain: TOOLCHAIN_ID, theorem: THEOREM, axioms: [] })
    expect(r.names!.branches).toEqual([{ ref: 'exp-p/main', symbol: 'P', order: 'P', displayed: true, comparisonSide: null }])
    expect(r.names!.samples).toEqual([{ sampleId: 's(1,0,1)', label: 'u', coords: '(1, 0, 1)' }, { sampleId: 's(1,0,-1)', label: 'v', coords: '(1, 0, -1)' }])
    expect(r.computed).toEqual({ holds: true, detail: 'both map to (1, 0, 0)' })
    expect(r.note).toMatch(/^Verified by the server for the current inputs/)
  })

  it('the comparison witness SR e1 != RS e1 is verified with its sides named from the binding ports', async () => {
    const { checked, resolve } = setup()
    const doc = bothWorkspace().current
    const r = await one(resolve(doc, [await checked(doc, rsDiffer)]))
    expect(r.status).toBe('verified')
    expect(r.names!.branches).toEqual([
      { ref: 'exp-order/left', symbol: 'SR', order: 'R then S', displayed: true, comparisonSide: 'left' },
      { ref: 'exp-order/right', symbol: 'RS', order: 'S then R', displayed: true, comparisonSide: 'right' },
    ])
    expect(r.names!.basis).toBe('e1')
    expect(r.computed).toEqual({ holds: true, detail: 'images of e1: (0, -1, 0) and (0, 1, 0)' })
    expect(r.statement).toContain('def a1 : Mat := [[0, -1, 0], [1, 0, 0], [0, 0, 1]]\ndef a2 : Mat := [[1, 0, 0], [0, -1, 0], [0, 0, 1]]')
  })
})

describe('W5: unavailable evidence', () => {
  it('a fabricated receipt ID is unavailable even with the correct hash', async () => {
    const { resolve } = setup()
    const doc = demoDocument()
    const hash = await claimHash(parseClaimDescriptor(describeClaim(doc, pSame)))
    expectUnavailable(await one(resolve(doc, [{ claim: pSame, claimHash: hash, receiptId: randomUUID() }])), 'no_receipt')
  })

  it('a recorded hash that does not match the current claim is a mismatch', async () => {
    const { checked, resolve } = setup()
    const doc = demoDocument()
    const ref = await checked(doc, pSame)
    const r = await one(resolve(doc, [{ ...ref, claimHash: 'a'.repeat(64) }]))
    expectUnavailable(r, 'hash_mismatch')
    // The current claim is still named and computed (exactly), never called checked.
    expect(r.names!.branches[0]!.ref).toBe('exp-p/main')
    expect(r.computed!.holds).toBe(true)
  })

  it('an edited matrix makes the receipt historical, even though the edited claim still holds', async () => {
    const { checked, resolve } = setup()
    const ws = new Workspace(demoDocument())
    const ref = await checked(ws.current, pSame)
    ws.commit({ baseRevision: 0, actions: [{ kind: 'update_map', mapId: 'map-p', label: 'P', definition: { preset: { kind: 'projection', keep: [true, false, false] } } }] })
    const r = await one(resolve(ws.current, [ref]))
    expectUnavailable(r, 'historical')
    expect(r.note).toMatch(/At most historical; it is not evidence about the current inputs/)
    expect(r.computed).toEqual({ holds: true, detail: 'both map to (1, 0, 0)' })
  })

  it('an edited witness makes the receipt historical', async () => {
    const { checked, resolve } = setup()
    const ws = new Workspace(demoDocument())
    const ref = await checked(ws.current, pSame)
    ws.commit({ baseRevision: 0, actions: [{ kind: 'update_sample', sampleSetId: 'grid3', sampleId: 's(1,0,-1)', coords: [{ n: '1', d: '1' }, { n: '0', d: '1' }, { n: '-2', d: '1' }] }] })
    expectUnavailable(await one(resolve(ws.current, [ref])), 'historical')
  })

  it('unresolved or deleted references are unavailable, with no names', async () => {
    const { checked, resolve } = setup()
    const ws = pqWorkspace()
    const qRef = await checked(ws.current, { kind: 'same_image_witness', branch: Q, u: 's(1,1,0)', v: 's(-1,1,0)' })
    ws.undo() // Q no longer exists
    const missingBranch = { ...qRef, claim: { kind: 'same_image_witness' as const, branch: { experimentId: 'exp-p', branchId: 'nope' }, u: 's(1,1,0)', v: 's(-1,1,0)' } }
    const missingSample = { ...qRef, claim: { ...pSame, v: 's(9,9,9)' } }
    const local = { ...qRef, claim: { ...pSame, branch: { experimentId: '$q', branchId: 'main' } } }
    const rs = await resolve(ws.current, [qRef, missingBranch, missingSample, local])
    expect(rs.map((r) => r.index)).toEqual([0, 1, 2, 3])
    for (const r of rs) {
      expectUnavailable(r, 'unresolved_reference')
      expect(r.names).toBeNull()
      expect(r.computed).toBeNull()
    }
  })

  it('a server restart (an empty registry) needs a new check', async () => {
    const { checked, resolve } = setup()
    const doc = demoDocument()
    const ref = await checked(doc, pSame)
    expect((await one(resolve(doc, [ref]))).status).toBe('verified')
    expectUnavailable(await one(resolve(doc, [ref], createReceiptRegistry())), 'no_receipt')
  })

  it('a receipt without the audited provenance is rejected', async () => {
    const doc = demoDocument()
    const hash = await claimHash(parseClaimDescriptor(describeClaim(doc, pSame)))
    const forged = { id: 'r1', claimHash: hash, templateVersion: TEMPLATE_VERSION, toolchain: TOOLCHAIN_ID, theorem: 'MathWorkspace.other', axioms: [], issuedAt: new Date(0).toISOString() }
    const r = await one(resolveEvidenceWith(doc, [{ claim: pSame, claimHash: hash, receiptId: 'r1' }], (id, h) => (id === 'r1' && h === hash ? forged : null)))
    expectUnavailable(r, 'provenance_rejected')
    const extraAxiom = { ...forged, theorem: THEOREM, axioms: ['propext'] }
    expectUnavailable(await one(resolveEvidenceWith(doc, [{ claim: pSame, claimHash: hash, receiptId: 'r1' }], () => extraAxiom)), 'provenance_rejected')
  })

  it('an unreachable proof service makes every reference unavailable', () => {
    const rs = allUnavailable([{ claim: pSame, claimHash: 'a'.repeat(64), receiptId: 'x' }], 'checker_unavailable')
    expectUnavailable(rs[0]!, 'checker_unavailable')
  })
})

describe('W5: what keeps a claim current', () => {
  it('a rename and presentation moves keep it verified; names come from the current document', async () => {
    const { checked, resolve } = setup()
    const ws = new Workspace(demoDocument())
    const ref = await checked(ws.current, pSame)
    const before = await one(resolve(ws.current, [ref]))
    ws.commit({ baseRevision: 0, actions: [
      { kind: 'update_map', mapId: 'map-p', label: 'T', definition: { preset: { kind: 'projection', keep: [true, true, false] } } },
      { kind: 'set_view', ghostCube: false, sampleLabels: false },
      { kind: 'select', experimentId: 'exp-p', sampleId: 's(1,1,0)' },
    ] })
    const r = await one(resolve(ws.current, [ref]))
    expect(r.status).toBe('verified')
    expect(r.statement).toBe(before.statement)
    expect(r.names!.branches[0]).toMatchObject({ symbol: 'T', order: 'T' })
    expect(r.names!.claim).toContain('under T (exp-p/main, T)')
  })

  it('undo to identical mathematical content makes it current again (same receipt)', async () => {
    const { checked, resolve } = setup()
    const ws = new Workspace(demoDocument())
    const ref = await checked(ws.current, pSame)
    ws.commit({ baseRevision: 0, actions: [{ kind: 'update_map', mapId: 'map-p', label: 'P', definition: { preset: { kind: 'projection', keep: [true, false, true] } } }] })
    expect((await one(resolve(ws.current, [ref]))).reason).toBe('historical')
    ws.undo()
    const r = await one(resolve(ws.current, [ref]))
    expect(r.status).toBe('verified')
    expect(r.provenance!.receiptId).toBe(ref.receiptId)
  })
})

describe('W5: no transfer of authority between claims', () => {
  it('switching the display to Q does not transfer P\'s proof to Q (Pu = Pv but Qu != Qv)', async () => {
    const { checked, resolve } = setup()
    const ws = new Workspace(demoDocument())
    const pRef = await checked(ws.current, pSame)
    ws.commit({ baseRevision: 0, actions: bindQ })
    expect(ws.current.selection.experimentId).toBe('exp-q')
    // P is still a valid, current claim elsewhere in the document: verified, named as P, not displayed.
    const p = await one(resolve(ws.current, [pRef]))
    expect(p.status).toBe('verified')
    expect(p.names!.branches[0]).toEqual({ ref: 'exp-p/main', symbol: 'P', order: 'P', displayed: false, comparisonSide: null })
    // The same receipt pointed at the displayed Q: never verified. The Q claim is false, computed exactly.
    const moved: EvidenceRef = { ...pRef, claim: { ...pSame, branch: Q } }
    const q = await one(resolve(ws.current, [moved]))
    expectUnavailable(q, 'historical')
    expect(q.computed).toEqual({ holds: false, detail: 'outputs differ: (0, 0, 1) and (0, 0, -1)' })
    expect(await claimHash(parseClaimDescriptor(describeClaim(ws.current, moved.claim)))).not.toBe(pRef.claimHash)
    // Q's own claim with P's receipt ID and Q's current hash: no receipt covers it.
    const qHash = await claimHash(parseClaimDescriptor(describeClaim(ws.current, moved.claim)))
    expectUnavailable(await one(resolve(ws.current, [{ ...moved, claimHash: qHash }])), 'no_receipt')
  })

  it('a P/Q receipt is not authority for the R/S comparison', async () => {
    const { checked, resolve } = setup()
    const ws = bothWorkspace()
    const pq = await checked(ws.current, { kind: 'map_difference_witness', left: P, right: Q, basisIndex: 0 })
    expect((await one(resolve(ws.current, [pq]))).status).toBe('verified')
    expectUnavailable(await one(resolve(ws.current, [{ ...pq, claim: rsDiffer }])), 'historical')
    const rsHash = await claimHash(parseClaimDescriptor(describeClaim(ws.current, rsDiffer)))
    expectUnavailable(await one(resolve(ws.current, [{ ...pq, claim: rsDiffer, claimHash: rsHash }])), 'no_receipt')
  })

  it('an edited branch makes the comparison receipt historical; the equality receipt is current only while the routes agree', async () => {
    const { checked, resolve } = setup()
    const ws = bothWorkspace()
    const differ = await checked(ws.current, rsDiffer)
    const e = findExperiment(ws.current, ORDER_IDS.experiment)
    ws.commit({ baseRevision: ws.current.revision, actions: reverseRouteActions(e, 'left') })
    const afterEdit = await resolve(ws.current, [differ])
    expectUnavailable(afterEdit[0]!, 'historical')
    expect(afterEdit[0]!.names!.branches[0]).toMatchObject({ order: 'S then R', comparisonSide: 'left' })
    expect(afterEdit[0]!.computed).toEqual({ holds: false, detail: 'both send e1 to (0, 1, 0)' })
    const equal = await checked(ws.current, rsEqual)
    expect((await one(resolve(ws.current, [equal]))).status).toBe('verified')
    ws.undo()
    const [d, q] = await resolve(ws.current, [differ, equal])
    expect(d!.status).toBe('verified')
    expectUnavailable(q!, 'historical')
  })
})
