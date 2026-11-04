// Closed validation of the incoming AssistantRequest (W5, W6) and of a candidate proposal (W4): one
// path for live and synthetic output. Structure first (parseProposal), then semantics on a temporary
// copy of the rebuilt document (planTransaction). Nothing here mutates the document.

import { API_LIMITS, PROPOSAL_LIMITS, type AssistantRequest, type EvidenceRef, type Proposal, parseEvidenceRefs, parseProposal } from '../../src/workspace/actions'
import { type Doc, ID_RE } from '../../src/workspace/document'
import { type Plan, planTransaction } from '../../src/workspace/reducer'
import { expandPrepared, explainExpanded } from './prepared'

export class RequestError extends Error {
  override name = 'RequestError'
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function closed(o: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new RequestError(400, 'invalid_request', `${where}: unknown field "${k.slice(0, 40)}"`)
  for (const k of allowed) if (!(k in o)) throw new RequestError(400, 'invalid_request', `${where}: missing field "${k}"`)
}

/** Structural validation of the request envelope. The document itself is validated by docFromJson. */
export function parseAssistantRequest(body: unknown): AssistantRequest {
  let bytes: number
  try {
    bytes = Buffer.byteLength(JSON.stringify(body) ?? '', 'utf8')
  } catch {
    throw new RequestError(400, 'invalid_request', 'request body is not JSON')
  }
  if (bytes > API_LIMITS.requestBytes) throw new RequestError(413, 'request_too_large', `request above ${API_LIMITS.requestBytes / 1024} KiB`)
  if (!isObj(body)) throw new RequestError(400, 'invalid_request', 'request: expected a JSON object')
  closed(body, ['requestId', 'workspaceId', 'baseRevision', 'prompt', 'context'], 'request')
  const { requestId, workspaceId, baseRevision, prompt, context } = body
  if (typeof requestId !== 'string' || !ID_RE.test(requestId)) throw new RequestError(400, 'invalid_request', 'request.requestId: invalid ID')
  if (typeof workspaceId !== 'string' || !ID_RE.test(workspaceId)) throw new RequestError(400, 'invalid_request', 'request.workspaceId: invalid ID')
  if (typeof baseRevision !== 'number' || !Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new RequestError(400, 'invalid_request', 'request.baseRevision: expected a non-negative integer')
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new RequestError(400, 'invalid_request', 'request.prompt: expected a non-empty string')
  if (prompt.length > API_LIMITS.prompt) throw new RequestError(400, 'prompt_too_long', `request.prompt: at most ${API_LIMITS.prompt} characters`)
  if (!isObj(context)) throw new RequestError(400, 'invalid_request', 'request.context: expected an object')
  closed(context, ['contextVersion', 'document', 'evidence'], 'request.context')
  if (context.contextVersion !== 1) throw new RequestError(400, 'invalid_request', 'request.context.contextVersion: must be 1')
  // W5 references: closed {claim, claimHash, receiptId}, at most API_LIMITS.evidenceRefs. Structure only;
  // the server resolves each one against the rebuilt document (server/lean/evidence.ts).
  let evidence: EvidenceRef[]
  try {
    evidence = parseEvidenceRefs(context.evidence)
  } catch (e) {
    throw new RequestError(400, 'invalid_request', `request.context.${(e as Error).message.slice(0, 200)}`)
  }
  // The document stays unknown JSON here; docFromJson is the only parser for it.
  return { requestId, workspaceId, baseRevision, prompt: prompt.trim(), context: { contextVersion: 1, document: context.document as AssistantRequest['context']['document'], evidence } }
}

const MAX_REASON = 300
const clip = (s: string) => (s.length > MAX_REASON ? `${s.slice(0, MAX_REASON)}…` : s)

export type Validated =
  | { ok: true; proposal: Proposal; plan: Plan }
  | { ok: false; stage: 'structure' | 'semantic'; message: string }

/** W4 then W3: closed envelope and actions, then all-or-nothing planning on the rebuilt document. A
 *  use_prepared reference is first replaced by its template's actions (server/muse/prepared.ts), so what is
 *  validated and returned is always ordinary actions. */
export function validateProposal(raw: unknown, doc: Doc): Validated {
  const expanded = expandPrepared(raw, doc)
  if (!expanded.ok) return { ok: false, stage: 'structure', message: clip(expanded.message) }
  const x = expanded.expansion
  // After an expansion, restate positions and counts for the model (they are the expanded list's).
  const say = (m: string) => clip(x ? explainExpanded(m, x, (raw as { actions: unknown[] }).actions.length, PROPOSAL_LIMITS.actions) : m)
  let proposal: Proposal
  try {
    proposal = parseProposal(expanded.value)
  } catch (e) {
    return { ok: false, stage: 'structure', message: say((e as Error).message) }
  }
  try {
    return { ok: true, proposal, plan: planTransaction(doc, proposal.actions) }
  } catch (e) {
    return { ok: false, stage: 'semantic', message: say((e as Error).message) }
  }
}

/** Model text -> JSON value. Accepts bare JSON, or JSON wrapped in one Markdown code fence. */
export function parseModelText(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed)
  try {
    return { ok: true, value: JSON.parse(fenced ? fenced[1]! : trimmed) }
  } catch {
    return { ok: false, message: 'the output is not a single JSON object' }
  }
}
