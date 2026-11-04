// W5 in the assistant route (MOCKED fetch, synthetic replies): the model input carries only server-resolved
// evidence, built before the input, with the statement and provenance for verified claims only. Receipts
// come from the check route with an injected runner that passes the audit (no Lean here). The context hash
// and the response envelope are unchanged by resolution.

import { describe, expect, it } from 'vitest'
import type { AssistantResponse, EvidenceRef } from '../../src/workspace/actions'
import type { CheckResponse, ClaimRequest } from '../../src/workspace/claims'
import { assistantContextHash } from '../../src/workspace/context'
import { type Doc, demoDocument, docToJson } from '../../src/workspace/document'
import { Workspace, describeClaim } from '../../src/workspace/reducer'
import { createAssistantRoute, defaultResolveEvidence, type EvidenceResolver } from '../../server/muse/index'
import { newStatus } from '../../server/muse/config'
import { INSTRUCTIONS } from '../../server/muse/prompt'
import { createChecker } from '../../server/lean/index'
import { createReceiptRegistry } from '../../server/lean/receipts'
import { resolveEvidenceWith } from '../../server/lean/evidence'
import { TOOLCHAIN_ID, type RunResult } from '../../server/lean/runner'
import type { ApiResult } from '../../server/types'
import { LIVE_ENV, apiRequest, assistantRequest, mockFetch, syntheticProposal, syntheticReply } from './helpers'

const AUDIT_OK = JSON.stringify({ severity: 'information', data: "'MathWorkspace.claim' does not depend on any axioms", caption: '', fileName: 'Claim.lean' })
const passing = async (): Promise<RunResult> => ({ code: 0, stdout: `${AUDIT_OK}\n`, stderr: '', timedOut: false, aborted: false, overflow: false, spawnError: null, ms: 1 })
const bindQ = [
  { kind: 'create_map', name: 'q', label: 'Q', dimension: 3, definition: { preset: { kind: 'projection', keep: [false, true, true] } } },
  { kind: 'create_experiment', name: 'q', sampleSetId: 'grid3', branches: [{ id: 'main', mapIds: ['$q'] }] },
  { kind: 'bind_recipe', experimentId: '$q', recipeId: 'what-gets-lost', bindings: { samples: 'grid3', map: 'main', selection: 's(1,0,1)' } },
]
const pSame: ClaimRequest = { kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: 's(1,0,1)', v: 's(1,0,-1)' }

function proofService() {
  const receipts = createReceiptRegistry()
  const { checkRoute } = createChecker({ run: passing, probe: async () => TOOLCHAIN_ID, receipts })
  const checked = async (doc: Doc, claim: ClaimRequest): Promise<EvidenceRef> => {
    const r = (await checkRoute({ method: 'POST', path: '/api/check', body: { requestId: 'req-e', claim: describeClaim(doc, claim) }, signal: new AbortController().signal })).json as CheckResponse
    return { claim, claimHash: r.claimHash, receiptId: r.receipt!.id }
  }
  const resolver: EvidenceResolver = (doc, refs) => resolveEvidenceWith(doc, refs, (id, h) => receipts.resolve(id, h))
  return { checked, resolver }
}

/** One live request (mocked provider) and the evidence block the model received. */
async function ask(doc: Doc, evidence: EvidenceRef[], resolveEvidence?: EvidenceResolver) {
  const m = mockFetch(syntheticReply(syntheticProposal([])))
  const route = createAssistantRoute({ env: LIVE_ENV, fetchImpl: m.fetchImpl, status: newStatus(), minRepairMs: 0, ...(resolveEvidence ? { resolveEvidence } : {}) })
  const body = assistantRequest('Is this claim Lean-checked?', doc, { context: { contextVersion: 1, document: docToJson(doc), evidence } })
  const res: ApiResult = await route(apiRequest(body))
  const ctx = JSON.parse((m.calls[0]!.body.input as { content: { text: string }[] }[])[0]!.content[1]!.text.replace(/^[^\n]*\n/, ''))
  return { res, body, ctx, evidence: ctx.evidence as { note: string; verified: number; unavailable: number; references: Record<string, unknown>[] } }
}

describe('W5 evidence in the model input', () => {
  it('a verified reference carries its statement, current names and provenance; an unavailable one does not', async () => {
    const { checked, resolver } = proofService()
    const doc = demoDocument()
    const ref = await checked(doc, pSame)
    const forged = { ...ref, receiptId: '00000000-0000-4000-8000-000000000000' }
    const { res, body, evidence } = await ask(doc, [ref, forged], resolver)
    expect(evidence.verified).toBe(1)
    expect(evidence.unavailable).toBe(1)
    const [v, u] = evidence.references
    expect(v).toMatchObject({ status: 'verified', reason: null, kind: 'same_image_witness', locator: pSame, claimHash: ref.claimHash, provenance: { receiptId: ref.receiptId, toolchain: TOOLCHAIN_ID, axioms: [] } })
    expect(v!.statement).toContain('theorem claim : ¬ SameVec u v ∧ SameVec (A.mulVec u) (A.mulVec v)')
    expect(v!.claim).toBe('u = (1, 0, 1) and v = (1, 0, -1) are different and have the same image under P (exp-p/main, P)')
    expect(u).toMatchObject({ status: 'unavailable', reason: 'no_receipt', computed: { holds: true } })
    expect(u).not.toHaveProperty('statement')
    expect(u).not.toHaveProperty('provenance')
    // Resolution leaves the context hash and the envelope exactly as before.
    const j = res.json as AssistantResponse
    expect(j.contextHash).toBe(await assistantContextHash(body.context))
    expect(Object.keys(j).sort()).toEqual(['baseRevision', 'contextHash', 'model', 'proposal', 'requestId', 'source', 'timing'])
  })

  it('with Q displayed, P\'s proof stays P\'s: verified for exp-p, unavailable when pointed at exp-q', async () => {
    const { checked, resolver } = proofService()
    const ws = new Workspace(demoDocument())
    const ref = await checked(ws.current, pSame)
    ws.commit({ baseRevision: 0, actions: bindQ })
    const atQ = { ...ref, claim: { ...pSame, branch: { experimentId: 'exp-q', branchId: 'main' } } }
    const { ctx, evidence } = await ask(ws.current, [ref, atQ], resolver)
    expect(ctx.displayedExperiment).toBe('exp-q')
    expect(evidence.references[0]).toMatchObject({ status: 'verified', references: { branches: [{ ref: 'exp-p/main', displayed: false }] } })
    expect(evidence.references[1]).toMatchObject({ status: 'unavailable', reason: 'historical', computed: { holds: false, detail: 'outputs differ: (0, 0, 1) and (0, 0, -1)' } })
    expect(evidence.references[1]).not.toHaveProperty('statement')
  })

  it('the default resolver uses the session registry: an unknown receipt is unavailable', async () => {
    const doc = demoDocument()
    const ref = { claim: pSame, claimHash: 'a'.repeat(64), receiptId: 'never-issued' }
    expect(await defaultResolveEvidence(doc, [])).toEqual([])
    const { evidence } = await ask(doc, [ref])
    expect(evidence.references[0]).toMatchObject({ status: 'unavailable', reason: 'hash_mismatch' })
  })

  it('a failing resolver is fail-closed: the request proceeds and every reference is unavailable', async () => {
    const { evidence, res } = await ask(demoDocument(), [{ claim: pSame, claimHash: 'a'.repeat(64), receiptId: 'x' }], async () => {
      throw new Error('registry exploded')
    })
    expect(res.status).toBe(200)
    expect(evidence.references[0]).toMatchObject({ status: 'unavailable', reason: 'checker_unavailable' })
  })

  it('the instructions bind proof language to verified evidence only', () => {
    expect(INSTRUCTIONS).toContain('Only a verified claim may be called Lean-checked')
    expect(INSTRUCTIONS).toContain('call it historical at most, never a proof about the changed inputs')
    expect(INSTRUCTIONS).toContain('a proof about P says nothing about Q, and a P/Q receipt says nothing about the comparison routes or an edited branch')
    expect(INSTRUCTIONS).toContain('Your explanation is never proof authority.')
    expect(INSTRUCTIONS).not.toContain('Lean evidence is not available to you in this build')
  })
})
