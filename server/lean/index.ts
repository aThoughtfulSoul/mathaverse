// POST /api/check, the proof capability and W5 evidence resolution (WORKSPACE-AND-AI W5/W6,
// MATHEMATICAL-CONTRACT M9, docs/INTERFACES.md).
// Order: closed request validation (400, no Lean) -> authored bounds and exact evaluation (400 capacity)
// -> server claim hash and generated statement -> a false claim stops here as "not_established" -> one
// pinned Lean run at a time (429 when busy) -> audit -> only then a receipt. The browser supplies exact
// data only; any hash, status or receipt field it adds is rejected by the closed envelope.

import { CLAIM_KINDS, ClaimError, type CheckResponse, type CheckStatus, type ExactClaim, claimHash, evaluateExactly, parseClaimDescriptor } from '../../src/workspace/claims'
import { CapacityError } from '../../src/model/rational'
import { checkAuthoredMatrix, checkAuthoredVector } from '../../src/model/linear'
import { type ApiRequest, type ApiResult, type ProofCapability, type RouteHandler, apiError } from '../types'
import { TEMPLATE_VERSION, THEOREM, TemplateError } from './template'
import { generateAny, templateVersionFor } from './templates'
import { type RunOptions, type RunResult, probeToolchain, runLean } from './runner'
import { auditRun } from './audit'
import { type ReceiptRecord, type ReceiptRegistry, createReceiptRegistry } from './receipts'
import { type ResolvedEvidence, resolveEvidenceWith } from './evidence'
import type { EvidenceRef } from '../../src/workspace/actions'
import type { Doc } from '../../src/workspace/document'

export interface CheckerDeps {
  /** Compile one Lean source under the process limits (injected in tests). */
  run: (source: string, opts: RunOptions) => Promise<RunResult>
  /** The verified toolchain identifier, or null when the pinned toolchain is unavailable. */
  probe: () => Promise<string | null>
  receipts: ReceiptRegistry
}

const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/

function parseEnvelope(body: unknown): { requestId: string; claim: unknown } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new ClaimError('request: expected an object')
  const o = body as Record<string, unknown>
  for (const k of Object.keys(o)) if (k !== 'requestId' && k !== 'claim') throw new ClaimError(`request: unknown field "${k}"`)
  if (typeof o.requestId !== 'string' || !REQUEST_ID_RE.test(o.requestId)) throw new ClaimError('request.requestId: 1-64 characters [A-Za-z0-9_.:-]')
  if (!('claim' in o)) throw new ClaimError('request: missing field "claim"')
  return { requestId: o.requestId, claim: o.claim }
}

/** M1 authored bounds on every step entry and witness coordinate (CapacityError beyond them). */
function checkBounds(c: ExactClaim): void {
  // Walk claims were bounded by parseClaimDescriptor (WALK_LIMITS in src/algebra/walk.ts).
  if (c.kind === 'walk_reorder_instance') return
  const steps = c.kind === 'same_image_witness' ? c.sequence : [...c.left, ...c.right]
  steps.forEach((m) => checkAuthoredMatrix(m))
  if (c.kind === 'same_image_witness') {
    checkAuthoredVector(c.u, 'u')
    checkAuthoredVector(c.v, 'v')
  }
}

export function createChecker(deps: CheckerDeps): { checkRoute: RouteHandler; leanCapabilities: () => Promise<ProofCapability> } {
  let busy = false

  async function checkRoute(req: ApiRequest): Promise<ApiResult> {
    const start = performance.now()
    let requestId: string
    let claim: ExactClaim
    let holds: boolean
    let detail: string
    try {
      const envelope = parseEnvelope(req.body)
      requestId = envelope.requestId
      claim = parseClaimDescriptor(envelope.claim)
      checkBounds(claim)
      ;({ holds, detail } = evaluateExactly(claim))
    } catch (e) {
      if (e instanceof CapacityError) return apiError(400, 'capacity', e.message, false)
      if (e instanceof ClaimError || e instanceof TemplateError) return apiError(400, 'invalid_claim', e.message, false)
      throw e
    }
    const hash = await claimHash(claim)
    let statement: string
    let source: string
    try {
      ;({ statement, source } = generateAny(claim, hash))
    } catch (e) {
      if (e instanceof TemplateError) return apiError(400, 'invalid_claim', e.message, false)
      throw e
    }
    const respond = (status: CheckStatus, reason: string | null, receipt: ReceiptRecord | null = null): ApiResult => {
      const json: CheckResponse = {
        requestId,
        claimHash: hash,
        statement,
        status,
        provenance: receipt && { templateVersion: receipt.templateVersion, toolchain: receipt.toolchain, theorem: receipt.theorem, axioms: receipt.axioms, inputHash: receipt.claimHash },
        receipt: receipt && { id: receipt.id, issuedAt: receipt.issuedAt },
        reason,
        timing: { ms: Math.round(performance.now() - start) },
      }
      return { status: 200, json }
    }

    if (!holds) return respond('not_established', `Computed exactly, the claim is false: ${detail}. It was not submitted to Lean.`)
    const toolchain = await deps.probe()
    if (!toolchain) return apiError(503, 'checker_unavailable', 'The pinned Lean toolchain is not available.', false)
    // No await between the test and the set: one proof at a time, never a queue.
    if (busy) return apiError(429, 'checker_busy', 'Another proof is running. Retry when it finishes.', true)
    busy = true
    let run: RunResult
    try {
      run = await deps.run(source, { signal: req.signal })
    } finally {
      busy = false
    }
    const audit = auditRun(run, THEOREM)
    if (!audit.ok) return respond(run.aborted || run.spawnError ? 'error' : 'not_established', audit.reason)
    const receipt = deps.receipts.issue({ claimHash: hash, templateVersion: templateVersionFor(claim.kind), toolchain, theorem: THEOREM, axioms: audit.axioms })
    return respond('checked', null, receipt)
  }

  async function leanCapabilities(): Promise<ProofCapability> {
    const toolchain = await deps.probe()
    return toolchain
      ? { available: true, toolchain, templateVersion: TEMPLATE_VERSION, claimKinds: [...CLAIM_KINDS] }
      : { available: false, toolchain: null, templateVersion: null, claimKinds: [] }
  }

  return { checkRoute, leanCapabilities }
}

// The session instance mounted by server/index.ts. Its registry lives as long as this module.
const receipts = createReceiptRegistry()
const checker = createChecker({ run: runLean, probe: probeToolchain, receipts })

export const checkRoute: RouteHandler = checker.checkRoute
export const leanCapabilities: () => Promise<ProofCapability> = checker.leanCapabilities

/** For other server modules: a receipt this session issued for exactly this claim hash, else null. */
export function resolveReceipt(id: string, hash: string): ReceiptRecord | null {
  return receipts.resolve(id, hash)
}

/**
 * W5: resolve assistant evidence references against the server-rebuilt document and this session's
 * registry (server/lean/evidence.ts). Used by the assistant route before it builds the model input.
 */
export function resolveEvidence(doc: Doc, refs: readonly EvidenceRef[]): Promise<ResolvedEvidence[]> {
  return resolveEvidenceWith(doc, refs, (id, hash) => receipts.resolve(id, hash))
}
