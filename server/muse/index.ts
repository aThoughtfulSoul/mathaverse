// POST /api/assistant and the assistant capability (docs/INTERFACES.md, WORKSPACE-AND-AI W4-W8).
//
// Lifecycle: validate the request -> rebuild the document with docFromJson -> check workspace ID and
// base revision -> recompute the context hash and exact facts -> (live) W5: resolve every evidence
// reference on the server (server/lean/evidence.ts) -> live Meta call (Responses, strict structured
// output) or a labelled synthetic fixture -> extract JSON -> parseProposal -> planTransaction
// on the rebuilt document. At most one bounded repair attempt, inside the same deadline. A proposal is
// returned only when it validated; every failure is a truthful { code, message, retryable }. The route
// never mutates anything: the client commits through its own Workspace after its staleness checks.

import { API_LIMITS, type AssistantRequest, type AssistantResponse, type EvidenceRef, type Proposal } from '../../src/workspace/actions'
import { assistantContextHash, computeFacts, type Fact } from '../../src/workspace/context'
import { type Doc, docFromJson, docToJson } from '../../src/workspace/document'
import { type ApiRequest, type ApiResult, type AssistantCapability, type RouteHandler, apiError } from '../types'
import { type Env, type MuseConfig, type ProviderStatus, fingerprint, isConfigured, newStatus, readConfig } from './config'
import { INSTRUCTIONS, buildInput, repairTurn } from './prompt'
import { ProviderAborted, ProviderError, buildResponsesRequest, extractOutput, postResponses } from './provider'
import { proposalSchema } from './schema'
import { matchFixture, normalizePrompt, FIXTURES } from './synthetic'
import { RequestError, parseAssistantRequest, parseModelText, validateProposal } from './validate'
import { type ResolvedEvidence, allUnavailable } from '../lean/evidence'

/** W5 resolution of the request's evidence references against the rebuilt document. */
export type EvidenceResolver = (doc: Doc, refs: readonly EvidenceRef[]) => Promise<ResolvedEvidence[]>

/**
 * The session's resolver: the Lean module's registry, loaded lazily like the API mount does, so a missing
 * proof service makes evidence unavailable instead of making the assistant unavailable. Any failure is
 * fail-closed: every reference is unavailable.
 */
export const defaultResolveEvidence: EvidenceResolver = async (doc, refs) => {
  if (refs.length === 0) return []
  try {
    const lean = await import('../lean/index')
    return await lean.resolveEvidence(doc, refs)
  } catch {
    return allUnavailable(refs, 'checker_unavailable')
  }
}

/** Provider deadline, inside the 45 s application timeout so a truthful error can still be sent. */
export const PROVIDER_DEADLINE_MS = 40_000
/** The repair attempt starts only if at least this much of the deadline remains. */
export const MIN_REPAIR_MS = 5_000

export interface MuseDeps {
  env?: Env
  fetchImpl?: typeof fetch
  /** Where successful authentication / live validation is recorded. */
  status?: ProviderStatus
  deadlineMs?: number
  minRepairMs?: number
  now?: () => number
  /** W5 evidence resolution (tests inject a resolver over their own receipt registry). */
  resolveEvidence?: EvidenceResolver
}

/** Process-wide status: only the default route (real fetch, process.env) writes it. */
const processStatus = newStatus()

const UNCHANGED = 'The workspace has not changed.'

/**
 * The request ended by a signal. Three distinct outcomes: the client cancelled (`cancelled`), the 45 s
 * application limit passed (`timeout`), or THIS application's provider deadline stopped the call
 * (`provider_timeout`). The last two are this app's own limits and stay retryable; an upstream Meta 504/408 is
 * `provider_gateway_timeout` from server/muse/provider.ts and is not.
 */
function abortedResult(requestSignal: AbortSignal, deadlineMs = PROVIDER_DEADLINE_MS): ApiResult {
  if (requestSignal.aborted) {
    const r = requestSignal.reason as { name?: unknown; message?: unknown } | undefined
    const timedOut = r?.name === 'TimeoutError' || (typeof r?.message === 'string' && /timeout/i.test(r.message))
    return timedOut
      ? apiError(504, 'timeout', `The assistant request exceeded this application's time limit. ${UNCHANGED}`, true)
      : apiError(499, 'cancelled', 'The assistant request was cancelled; no response was used.', false)
  }
  return apiError(504, 'provider_timeout', `Muse did not answer within this application's ${Math.round(deadlineMs / 100) / 10} s limit, so the request was stopped. ${UNCHANGED}`, true)
}

interface Prepared {
  requestId: string
  prompt: string
  doc: Doc
  facts: Fact[]
  evidence: EvidenceRef[]
  contextHash: string
}

async function prepare(body: unknown): Promise<Prepared | ApiResult> {
  let req: AssistantRequest
  try {
    req = parseAssistantRequest(body)
  } catch (e) {
    if (e instanceof RequestError) return apiError(e.status, e.code, e.message, false)
    return apiError(400, 'invalid_request', 'The request could not be read.', false)
  }
  let doc: Doc
  let facts: Fact[]
  try {
    doc = docFromJson(req.context.document)
    facts = computeFacts(doc)
  } catch (e) {
    return apiError(400, 'invalid_document', `The workspace document is invalid: ${(e as Error).message.slice(0, 300)}`, false)
  }
  if (doc.workspaceId !== req.workspaceId) return apiError(400, 'context_mismatch', 'request.workspaceId does not match the document.', false)
  if (doc.revision !== req.baseRevision) return apiError(400, 'context_mismatch', 'request.baseRevision does not match the document revision.', false)
  // Recomputed from the validated, normalized document; a client hash is never accepted.
  const contextHash = await assistantContextHash({ contextVersion: 1, document: docToJson(doc), evidence: req.context.evidence })
  return { requestId: req.requestId, prompt: req.prompt, doc, facts, evidence: req.context.evidence, contextHash }
}

function envelope(p: Prepared, source: 'meta' | 'synthetic', model: string, proposal: Proposal, providerMs: number | null, totalMs: number): ApiResult {
  const json: AssistantResponse = { requestId: p.requestId, source, model, baseRevision: p.doc.revision, contextHash: p.contextHash, timing: { providerMs, totalMs }, proposal }
  if (Buffer.byteLength(JSON.stringify(json), 'utf8') > API_LIMITS.responseBytes) return apiError(502, 'response_too_large', `The proposal is above the response size limit. ${UNCHANGED}`, false)
  return { status: 200, json }
}

function synthetic(p: Prepared, signal: AbortSignal, elapsed: () => number, configured: boolean): ApiResult {
  const fixture = matchFixture(p.prompt)
  if (!fixture) {
    const examples = FIXTURES.map((f) => `"${f.example}"`).join(', ')
    const why = configured ? 'synthetic mode is forced by MUSE_MODE' : 'Muse is not configured on this server'
    return apiError(422, 'synthetic_no_fixture', `Synthetic mode has no fixture for this prompt (${why}). Prepared synthetic prompts: ${examples}.`, false)
  }
  let raw: unknown
  try {
    raw = fixture.build(p.doc, normalizePrompt(p.prompt))
  } catch (e) {
    return apiError(422, 'proposal_rejected', `The synthetic fixture "${fixture.name}" does not apply to this workspace: ${(e as Error).message.slice(0, 200)}. ${UNCHANGED}`, false)
  }
  const v = validateProposal(raw, p.doc)
  if (!v.ok) {
    return v.stage === 'semantic'
      ? apiError(422, 'proposal_rejected', `The synthetic fixture "${fixture.name}" does not apply to this workspace: ${v.message}. ${UNCHANGED}`, false)
      : apiError(500, 'synthetic_fixture_invalid', `The synthetic fixture "${fixture.name}" is malformed: ${v.message}.`, false)
  }
  if (signal.aborted) return abortedResult(signal)
  return envelope(p, 'synthetic', `synthetic:${fixture.name}`, v.proposal, null, elapsed())
}

async function live(p: Prepared, config: MuseConfig, req: ApiRequest, deps: Required<Pick<MuseDeps, 'fetchImpl' | 'status' | 'deadlineMs' | 'minRepairMs' | 'now' | 'resolveEvidence'>>, t0: number): Promise<ApiResult> {
  const { fetchImpl, status, deadlineMs, minRepairMs, now } = deps
  const fp = fingerprint(config)
  const deadlineAt = t0 + deadlineMs
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(Math.max(0, Math.floor(deadlineAt - now())))])
  const schema = proposalSchema(p.doc)
  // W5 before the model input: only server-resolved evidence reaches Muse; a resolver failure is fail-closed.
  let evidence: ResolvedEvidence[]
  try {
    evidence = await deps.resolveEvidence(p.doc, p.evidence)
  } catch {
    evidence = allUnavailable(p.evidence, 'checker_unavailable')
  }
  if (req.signal.aborted) return abortedResult(req.signal)
  const input = buildInput(p.prompt, p.doc, p.facts, evidence)
  let providerMs = 0
  let failure: { stage: 'structure' | 'semantic'; message: string } | null = null
  let previous: string | null = null

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt === 1 && deadlineAt - now() < minRepairMs) break
    const body = buildResponsesRequest(config, INSTRUCTIONS, attempt === 0 ? input : [...input, ...repairTurn(previous, failure!.message)], schema)
    const started = now()
    let data: unknown
    try {
      data = await postResponses({ config, body, signal, fetchImpl })
    } catch (e) {
      providerMs += now() - started
      if (e instanceof ProviderAborted || signal.aborted) return abortedResult(req.signal, deadlineMs)
      if (e instanceof ProviderError) {
        if (e.code === 'provider_auth') {
          status.authenticatedFor = null
          status.liveValidatedFor = null
        }
        return apiError(e.status, e.code, e.message, e.retryable)
      }
      return apiError(502, 'provider_network', `The request to Meta could not be completed. ${UNCHANGED}`, true)
    }
    providerMs += now() - started
    status.authenticatedFor = fp

    const out = extractOutput(data)
    if (!out.ok) {
      if (out.reason === 'refusal') return apiError(422, 'model_refused', `Muse declined this request. ${UNCHANGED}`, false)
      if (out.reason === 'failed') return apiError(502, 'provider_failed', `Meta reported that the response failed. ${UNCHANGED}`, true)
      if (out.reason === 'malformed') return apiError(502, 'provider_malformed', `Meta returned a response in an unexpected shape. ${UNCHANGED}`, true)
      failure = { stage: 'structure', message: out.reason === 'incomplete' ? `the output was incomplete${out.detail ? ` (${out.detail})` : ''}; keep the proposal shorter` : 'the output contained no text' }
      previous = null
      continue
    }
    const parsed = parseModelText(out.text)
    if (!parsed.ok) {
      failure = { stage: 'structure', message: parsed.message }
      previous = out.text
      continue
    }
    const v = validateProposal(parsed.value, p.doc)
    if (!v.ok) {
      failure = v
      previous = out.text
      continue
    }
    if (req.signal.aborted) return abortedResult(req.signal)
    status.liveValidatedFor = fp
    return envelope(p, 'meta', config.model, v.proposal, providerMs, now() - t0)
  }
  if (req.signal.aborted) return abortedResult(req.signal)
  const reason = failure?.message ?? 'no attempt completed'
  return failure?.stage === 'semantic'
    ? apiError(422, 'proposal_rejected', `Muse's proposal could not be applied to this workspace: ${reason}. ${UNCHANGED}`, true)
    : apiError(502, 'invalid_output', `Muse did not return a valid proposal: ${reason}. ${UNCHANGED}`, true)
}

/** Build the route with injectable dependencies (tests pass a mocked fetch and their own status). */
export function createAssistantRoute(deps: MuseDeps = {}): RouteHandler {
  const now = deps.now ?? (() => performance.now())
  return async (req) => {
    const t0 = now()
    if (req.method !== 'POST') return apiError(405, 'method_not_allowed', 'Use POST /api/assistant.', false)
    const config = readConfig(deps.env ?? process.env)
    if (config.mode === 'unavailable') return apiError(503, 'assistant_misconfigured', `The assistant is not usable: ${config.problem}.`, false)
    const p = await prepare(req.body)
    if (!('doc' in p)) return p
    if (req.signal.aborted) return abortedResult(req.signal)
    if (config.mode === 'synthetic') return synthetic(p, req.signal, () => now() - t0, isConfigured(config))
    return live(p, config, req, {
      fetchImpl: deps.fetchImpl ?? ((input, init) => globalThis.fetch(input, init)),
      status: deps.status ?? processStatus,
      deadlineMs: deps.deadlineMs ?? PROVIDER_DEADLINE_MS,
      minRepairMs: deps.minRepairMs ?? MIN_REPAIR_MS,
      now,
      resolveEvidence: deps.resolveEvidence ?? defaultResolveEvidence,
    }, t0)
  }
}

const defaultRoute = createAssistantRoute()

/** POST /api/assistant (docs/INTERFACES.md). */
export const assistantRoute: RouteHandler = (req) => defaultRoute(req)

/** Truthful status for an environment and a status record (exported for tests). */
export function capabilitiesFor(env: Env, status: ProviderStatus): AssistantCapability {
  const c = readConfig(env)
  const fp = fingerprint(c)
  const configured = isConfigured(c)
  return {
    configured,
    authenticated: fp !== null && status.authenticatedFor === fp,
    liveValidated: fp !== null && status.liveValidatedFor === fp,
    model: configured ? c.model : null,
    mode: c.mode,
  }
}

/** GET /api/capabilities `assistant` (W7: three distinct statuses, plus the current mode). */
export function museCapabilities(): AssistantCapability {
  return capabilitiesFor(process.env, processStatus)
}
