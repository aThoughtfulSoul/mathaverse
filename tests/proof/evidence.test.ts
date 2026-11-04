// W5 for the proof lesson: a walk receipt is verified evidence for the assistant only while the server-rebuilt
// claim (current vectors and signs) has exactly the receipted hash. Selecting another endpoint keeps it
// current; a sign flip makes it historical; undo to the same data makes it current again.

import { describe, expect, it } from 'vitest'
import { Workspace, describeClaim } from '../../src/workspace/reducer'
import { demoDocument } from '../../src/workspace/document'
import { claimHash, parseClaimDescriptor, type ClaimRequest } from '../../src/workspace/claims'
import { PROOF_IDS, endpointActions, flipSignActions, proofActions } from '../../src/demo/proof'
import { findWalkExperiment } from '../../src/workspace/document'
import { createReceiptRegistry } from '../../server/lean/receipts'
import { resolveEvidenceWith } from '../../server/lean/evidence'
import { THEOREM } from '../../server/lean/template'
import { WALK_TEMPLATE_VERSION } from '../../server/lean/walkTemplate'
import { TOOLCHAIN_ID } from '../../server/lean/runner'

const commit = (ws: Workspace, actions: unknown[]) => ws.commit({ baseRevision: ws.current.revision, actions })

describe('W5 evidence for walk_reorder_instance', () => {
  it('verified while the data matches; historical after a sign flip; current again after undo', async () => {
    const ws = new Workspace(demoDocument())
    commit(ws, proofActions(ws.current))
    const claim: ClaimRequest = { kind: 'walk_reorder_instance', experimentId: PROOF_IDS.experiment }
    const hash = await claimHash(parseClaimDescriptor(describeClaim(ws.current, claim)))
    const receipts = createReceiptRegistry()
    const r = receipts.issue({ claimHash: hash, templateVersion: WALK_TEMPLATE_VERSION, toolchain: TOOLCHAIN_ID, theorem: THEOREM, axioms: [] })
    const resolve = () => resolveEvidenceWith(ws.current, [{ claim, claimHash: hash, receiptId: r.id }], (id, h) => receipts.resolve(id, h))

    let [e] = await resolve()
    expect(e!.status).toBe('verified')
    expect(e!.names!.claim).toContain('returns to its start, has source bound B = 5 and signed bound D = 1')
    expect(e!.statement).toContain('outputOrder eps = [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 3, 1]')
    expect(e!.provenance!.templateVersion).toBe(WALK_TEMPLATE_VERSION)

    commit(ws, endpointActions(findWalkExperiment(ws.current, PROOF_IDS.experiment), 9))
    ;[e] = await resolve()
    expect(e!.status).toBe('verified')

    commit(ws, flipSignActions(findWalkExperiment(ws.current, PROOF_IDS.experiment), 'v0'))
    ;[e] = await resolve()
    expect([e!.status, e!.reason]).toEqual(['unavailable', 'historical'])

    ws.undo()
    ;[e] = await resolve()
    expect(e!.status).toBe('verified')
  })

  it('a receipt carrying the linear template version is rejected for a walk claim', async () => {
    const ws = new Workspace(demoDocument())
    commit(ws, proofActions(ws.current))
    const claim: ClaimRequest = { kind: 'walk_reorder_instance', experimentId: PROOF_IDS.experiment }
    const hash = await claimHash(parseClaimDescriptor(describeClaim(ws.current, claim)))
    const receipts = createReceiptRegistry()
    const r = receipts.issue({ claimHash: hash, templateVersion: 'mw-lean-claims-1', toolchain: TOOLCHAIN_ID, theorem: THEOREM, axioms: [] })
    const [e] = await resolveEvidenceWith(ws.current, [{ claim, claimHash: hash, receiptId: r.id }], (id, h) => receipts.resolve(id, h))
    expect([e!.status, e!.reason]).toEqual(['unavailable', 'provenance_rejected'])
  })
})
