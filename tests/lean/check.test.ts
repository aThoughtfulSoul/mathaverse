// Lean track: real compiles with the pinned toolchain through the mounted route (MATHEMATICAL-CONTRACT M9,
// ACCEPTANCE A5). Six compiles: the P collision, P vs Q on e1, P then P equals P, the A1 R/S order, and
// the 3D operation-order comparison (SR e1 != RS e1; equality once both routes are [S, R]), whose real
// receipts are then resolved through W5 (resolveEvidence). Skipped when the pinned toolchain is absent.

import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { type CheckResponse, type ClaimDescriptor, claimHash, parseClaimDescriptor } from '../../src/workspace/claims'
import { checkRoute, leanCapabilities, resolveEvidence, resolveReceipt } from '../../server/lean/index'
import { describeClaim } from '../../src/workspace/reducer'
import type { Doc } from '../../src/workspace/document'
import type { ClaimRequest } from '../../src/workspace/claims'
import { TOOLCHAIN_ID, probeToolchain } from '../../server/lean/runner'
import { TEMPLATE_VERSION, THEOREM } from '../../server/lean/template'
import { orderDiffers, orderEqual, orderWorkspace, pCollision, ppEqualsP, pVsQ, reverseLeft, rsOrder } from './fixtures'

const lean = await probeToolchain()

async function check(claim: ClaimDescriptor): Promise<CheckResponse> {
  const res = await checkRoute({ method: 'POST', path: '/api/check', body: { requestId: 'req-1', claim }, signal: new AbortController().signal })
  expect(res.status).toBe(200)
  return res.json as CheckResponse
}

async function expectChecked(claim: ClaimDescriptor): Promise<CheckResponse> {
  const r = await check(claim)
  expect(r.reason).toBeNull()
  expect(r.status).toBe('checked')
  const hash = await claimHash(parseClaimDescriptor(claim))
  expect(r.claimHash).toBe(hash)
  expect(r.provenance).toEqual({ templateVersion: TEMPLATE_VERSION, toolchain: TOOLCHAIN_ID, theorem: THEOREM, axioms: [], inputHash: hash })
  expect(resolveReceipt(r.receipt!.id, hash)).toMatchObject({ claimHash: hash, theorem: THEOREM, axioms: [] })
  expect(resolveReceipt(r.receipt!.id, '0'.repeat(64))).toBeNull()
  return r
}

const tempDirs = async () => (await readdir(tmpdir())).filter((n) => n.startsWith('mw-lean-')).length

describe.skipIf(!lean)('pinned Lean compiles and audits (real toolchain)', () => {
  it('capabilities report the pinned toolchain and the four kinds (the proof lesson adds walk_reorder_instance)', async () => {
    expect(await leanCapabilities()).toEqual({ available: true, toolchain: 'leanprover/lean4:v4.26.0 (d8204c9fd894)', templateVersion: TEMPLATE_VERSION, claimKinds: ['same_image_witness', 'map_equality', 'map_difference_witness', 'walk_reorder_instance'] })
  })

  it('same_image_witness: the P collision, u = (1,0,1) and v = (1,0,-1) under P = diag(1,1,0)', async () => {
    const before = await tempDirs()
    const r = await expectChecked(pCollision())
    expect(r.statement).toContain('def a1 : Mat := [[1, 0, 0], [0, 1, 0], [0, 0, 0]]')
    expect(r.statement).toContain('def u : Vec := [1, 0, 1]\ndef v : Vec := [1, 0, -1]')
    expect(r.statement).toContain('theorem claim : ¬ SameVec u v ∧ SameVec (A.mulVec u) (A.mulVec v)')
    expect(await tempDirs()).toBe(before)
  }, 20_000)

  it('map_difference_witness: P and Q = diag(0,1,1) differ on e1', async () => {
    const r = await expectChecked(pVsQ(0))
    expect(r.statement).toContain('def b1 : Mat := [[0, 0, 0], [0, 1, 0], [0, 0, 1]]')
    expect(r.statement).toContain('def e1 : Vec := [1, 0, 0]')
    expect(r.statement).toContain('theorem claim : ¬ SameVec (A.mulVec e1) (B.mulVec e1)')
  }, 20_000)

  it('map_equality: P then P equals P', async () => {
    const r = await expectChecked(ppEqualsP())
    expect(r.statement).toContain('Steps a1 → a2 (a1 acts first), so A = a2 · a1.')
    expect(r.statement).toContain('theorem claim : SameMat A B')
  }, 20_000)

  it('A1 order: R then S and S then R differ on e1', async () => {
    const r = await expectChecked(rsOrder(0))
    expect(r.statement).toContain('def a1 : Mat := [[0, -1], [1, 0]]\ndef a2 : Mat := [[1, 0], [0, -1]]')
    expect(r.statement).toContain('def A : Mat := compose 2 [a1, a2]')
    expect(r.statement).toContain('def B : Mat := compose 2 [b1, b2]')
    expect(r.statement).toContain('def e1 : Vec := [1, 0]')
  }, 20_000)

  const R3 = '[[0, -1, 0], [1, 0, 0], [0, 0, 1]]'
  const S3 = '[[1, 0, 0], [0, -1, 0], [0, 0, 1]]'
  const ref = async (doc: Doc, claim: ClaimRequest) => {
    const r = await expectChecked(describeClaim(doc, claim))
    return { r, ref: { claim, claimHash: r.claimHash, receiptId: r.receipt!.id } }
  }

  it('3D order comparison: R then S and S then R differ on e1 (SR e1 = (0,-1,0), RS e1 = (0,1,0))', async () => {
    const { r } = await ref(orderWorkspace().current, orderDiffers)
    expect(r.statement).toContain(`def a1 : Mat := ${R3}\ndef a2 : Mat := ${S3}`)
    expect(r.statement).toContain('Steps a1 → a2 (a1 acts first), so A = a2 · a1.')
    expect(r.statement).toContain(`def b1 : Mat := ${S3}\ndef b2 : Mat := ${R3}`)
    expect(r.statement).toContain('def e1 : Vec := [1, 0, 0]')
    expect(r.statement).toContain('theorem claim : ¬ SameVec (A.mulVec e1) (B.mulVec e1)')
  }, 20_000)

  it('3D order comparison: once both routes are [S, R], map_equality is checked', async () => {
    const ws = orderWorkspace()
    reverseLeft(ws)
    const { r } = await ref(ws.current, orderEqual)
    expect(r.statement).toContain(`def a1 : Mat := ${S3}\ndef a2 : Mat := ${R3}`)
    expect(r.statement).toContain(`def b1 : Mat := ${S3}\ndef b2 : Mat := ${R3}`)
    expect(r.statement).toContain('theorem claim : SameMat A B')
  }, 20_000)

  it('W5 with real receipts: current while the data matches, historical after a branch edit, current again after undo', async () => {
    const ws = orderWorkspace()
    const differ = (await ref(ws.current, orderDiffers)).ref
    expect((await resolveEvidence(ws.current, [differ]))[0]).toMatchObject({ status: 'verified', claimHash: differ.claimHash, provenance: { receiptId: differ.receiptId, toolchain: TOOLCHAIN_ID, theorem: THEOREM, axioms: [] } })
    reverseLeft(ws)
    expect((await resolveEvidence(ws.current, [differ]))[0]).toMatchObject({ status: 'unavailable', reason: 'historical', statement: null })
    const equal = (await ref(ws.current, orderEqual)).ref
    expect((await resolveEvidence(ws.current, [equal]))[0]!.status).toBe('verified')
    ws.undo()
    const [d, e] = await resolveEvidence(ws.current, [differ, equal])
    expect(d!.status).toBe('verified')
    expect(e).toMatchObject({ status: 'unavailable', reason: 'historical' })
  }, 40_000)
})
