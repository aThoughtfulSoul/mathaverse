// Assistant request lifecycle (WORKSPACE-AND-AI W4-W5, MUSE-INTEGRATION-DESIGN "One request"). One active
// request; a new one supersedes (aborts) the previous. At dispatch the request ID, workspace ID, base
// revision and canonical context hash are stored. A proposal auto-applies only if all of them still match,
// no drag preview is active and the request was not cancelled; otherwise its explanation is kept as a stale
// suggestion and nothing is applied. Application goes through the same transaction planner as every local
// edit (all or nothing), and synthetic responses are always labelled as synthetic. Each result also records
// what it was about (the displayed experiment and selection when asked, and after an applied proposal), so
// the panel can scope application-computed facts to it.

import type { App } from '../app'
import { type Doc, type VectorWalkExperiment, docToJson } from '../workspace/document'
import { assistantContextHash } from '../workspace/context'
import { type AssistantRequest, type AssistantResponse, type ApiError, type EvidenceRef, type AssistantContext, parseProposal, API_LIMITS } from '../workspace/actions'
import type { Effect } from '../workspace/reducer'
import { toJson } from '../model/rational'

/**
 * What a request was about: the displayed experiment, its selection item and (for a vector walk) its stored
 * inputs, as plain JSON strings (no bigints), so it can travel in the state and its render key. The panel
 * scopes its application-computed facts to this and marks them historical when the workspace moves on.
 */
export interface ScopeSnapshot {
  experimentId: string
  item: string | null
  /** Canonical JSON of the displayed vector walk's inputs (dimension, vectors, order, signs), else null. */
  walk: string | null
}

export interface AnswerScope {
  /** The workspace when the request was sent. */
  request: ScopeSnapshot
  /** After an applied proposal: the committed workspace (null when nothing was applied). */
  committed: ScopeSnapshot | null
}

/** Canonical JSON of a vector walk's stored inputs (identity and order included; derived values excluded). */
export function walkInputsJson(e: VectorWalkExperiment): string {
  return JSON.stringify({ dimension: e.dimension, vectors: e.vectors.map((v) => ({ id: v.id, coords: v.coords.map(toJson) })), order: e.order, signs: e.signs })
}

/** The displayed experiment and selection of a document, as a scope snapshot. */
export function scopeSnapshot(doc: Doc): ScopeSnapshot {
  const e = doc.experiments.find((x) => x.id === doc.selection.experimentId)
  return { experimentId: doc.selection.experimentId, item: doc.selection.item, walk: e && e.domain === 'vector_walk' ? walkInputsJson(e) : null }
}

/**
 * What the panel may offer after a failed request. `retry`: resending the same text may succeed (rate limit,
 * transient outage, network). `smaller`: the upstream gateway timed out, so an unchanged resend is not the
 * remedy; only a new, smaller or simpler request is offered. `none`: neither (configuration, invalid input).
 */
export type ErrorRemedy = 'retry' | 'smaller' | 'none'

/** Upstream Meta HTTP 504 / 408 (server/muse/provider.ts): distinct from this application's own deadline. */
export const GATEWAY_TIMEOUT_CODE = 'provider_gateway_timeout'

export function errorRemedy(e: Pick<ApiError, 'code' | 'retryable'>): ErrorRemedy {
  if (e.code === GATEWAY_TIMEOUT_CODE) return 'smaller'
  return e.retryable ? 'retry' : 'none'
}

export type AssistantState =
  | { kind: 'idle' }
  | { kind: 'pending'; requestId: string; prompt: string; startedAt: number }
  | { kind: 'applied'; requestId: string; prompt: string; response: AssistantResponse; summary: string[]; sceneChangeMs: number; scope?: AnswerScope }
  | { kind: 'answered'; requestId: string; prompt: string; response: AssistantResponse; scope?: AnswerScope }
  | { kind: 'stale'; requestId: string; prompt: string; response: AssistantResponse; reason: string; scope?: AnswerScope }
  | { kind: 'rejected'; requestId: string; prompt: string; response: AssistantResponse; reason: string; scope?: AnswerScope }
  | { kind: 'error'; requestId: string; prompt: string; error: ApiError }
  | { kind: 'canceled'; requestId: string; prompt: string }

interface Dispatch {
  requestId: string
  prompt: string
  workspaceId: string
  baseRevision: number
  contextHash: string
  startedAt: number
  abort: AbortController
  /** The displayed experiment and selection when the request was sent. */
  scope: ScopeSnapshot
}

export class AssistantClient {
  state: AssistantState = { kind: 'idle' }
  private active: Dispatch | null = null
  /** The question of an ask() whose context is still being hashed (not yet sent). */
  private preparing: string | null = null
  /** Bumped by every ask() and cancel(); an ask() whose number is no longer current is never sent. */
  private seq = 0
  private readonly listeners = new Set<(s: AssistantState) => void>()
  /** Every request made this session (application events, for evidence and timing). */
  readonly history: { requestId: string; prompt: string; outcome: string; source: string | null; model: string | null; ms: number | null }[] = []

  constructor(
    private readonly app: App,
    private readonly evidence: () => EvidenceRef[],
    private readonly onEffects: (effects: Effect[]) => void,
  ) {}

  subscribe(fn: (s: AssistantState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(s: AssistantState): void {
    this.state = s
    this.listeners.forEach((fn) => fn(s))
  }

  private context(): AssistantContext {
    return { contextVersion: 1, document: docToJson(this.app.workspace.current), evidence: this.evidence() }
  }

  /** Send a typed request (the transcript of a future voice request uses this same path). */
  async ask(prompt: string): Promise<void> {
    const text = prompt.trim()
    if (!text) return
    if (text.length > API_LIMITS.prompt) {
      this.set({ kind: 'error', requestId: '', prompt: text, error: { code: 'prompt_too_long', message: `A request is at most ${API_LIMITS.prompt} characters.`, retryable: false } })
      return
    }
    this.cancel('superseded')
    const mine = ++this.seq
    const doc = this.app.workspace.current
    const context = this.context()
    this.preparing = text
    const contextHash = await assistantContextHash(context)
    if (mine === this.seq) this.preparing = null
    // A newer ask() or a cancel() arrived while the hash was computed: this request is never sent.
    if (mine !== this.seq) {
      this.history.push({ requestId: '', prompt: text, outcome: 'superseded before dispatch', source: null, model: null, ms: null })
      return
    }
    const d: Dispatch = {
      requestId: crypto.randomUUID(),
      prompt: text,
      workspaceId: doc.workspaceId,
      baseRevision: doc.revision,
      contextHash,
      startedAt: performance.now(),
      abort: new AbortController(),
      scope: scopeSnapshot(doc),
    }
    this.active = d
    this.set({ kind: 'pending', requestId: d.requestId, prompt: text, startedAt: d.startedAt })
    const body: AssistantRequest = { requestId: d.requestId, workspaceId: d.workspaceId, baseRevision: d.baseRevision, prompt: text, context }
    let res: Response
    try {
      res = await fetch('/api/assistant', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: d.abort.signal })
    } catch (e) {
      if (this.active !== d) return // cancelled or superseded: nothing from this request may change state
      this.finish(d, { kind: 'error', requestId: d.requestId, prompt: text, error: { code: 'network', message: (e as Error).message, retryable: true } }, 'network error', null)
      return
    }
    let json: unknown
    try {
      json = await res.json()
    } catch {
      json = null
    }
    if (this.active !== d) return
    if (!res.ok) {
      const err = (json ?? {}) as Partial<ApiError>
      this.finish(d, { kind: 'error', requestId: d.requestId, prompt: text, error: { code: err.code ?? `http_${res.status}`, message: err.message ?? `HTTP ${res.status}`, retryable: err.retryable ?? false } }, `error ${err.code ?? res.status}`, null)
      return
    }
    // The context as it is now (document and evidence references): a change that did not bump the
    // revision, such as a Lean check completing, still makes the proposal stale.
    const contextHashNow = await assistantContextHash(this.context())
    if (this.active !== d) return
    this.receive(d, json, contextHashNow)
  }

  private receive(d: Dispatch, json: unknown, contextHashNow: string): void {
    const env = json as AssistantResponse
    // The client re-validates the envelope: a body that is not an envelope for this request ends the
    // request as an error (nothing applies) instead of leaving it pending.
    if (!env || env.requestId !== d.requestId) {
      this.finish(d, { kind: 'error', requestId: d.requestId, prompt: d.prompt, error: { code: 'invalid_response', message: !env ? 'the response was not a JSON envelope' : 'the response was for a different request', retryable: true } }, 'invalid response', null)
      return
    }
    let proposal
    try {
      proposal = parseProposal(env.proposal)
    } catch (e) {
      this.finish(d, { kind: 'error', requestId: d.requestId, prompt: d.prompt, error: { code: 'invalid_proposal', message: (e as Error).message, retryable: true } }, 'invalid proposal', env)
      return
    }
    const response: AssistantResponse = { ...env, proposal }
    const scope: AnswerScope = { request: d.scope, committed: null }
    const doc = this.app.workspace.current
    const staleReason =
      doc.workspaceId !== d.workspaceId ? 'a different workspace is open'
      : doc.revision !== d.baseRevision ? 'the workspace changed while the request was running'
      : env.contextHash !== d.contextHash ? 'the server saw a different context'
      : contextHashNow !== d.contextHash ? 'the workspace context changed while the request was running'
      : this.app.isPreviewing() ? 'a drag preview is active'
      : null
    if (!proposal.actions.length) {
      this.finish(d, { kind: 'answered', requestId: d.requestId, prompt: d.prompt, response, scope }, 'answered', env)
      return
    }
    if (staleReason) {
      this.finish(d, { kind: 'stale', requestId: d.requestId, prompt: d.prompt, response, reason: staleReason, scope }, `stale: ${staleReason}`, env)
      return
    }
    try {
      const before = this.app.workspace.current
      const { summary, effects } = this.app.transact(proposal.actions, `assistant:${env.source}`)
      const ms = performance.now() - d.startedAt
      // A valid proposal that changes nothing and plays nothing (e.g. selecting what is already selected) is an
      // answer, not a change: there is nothing for Undo to reverse.
      if (this.app.workspace.current === before && !effects.length) {
        this.finish(d, { kind: 'answered', requestId: d.requestId, prompt: d.prompt, response, scope }, 'answered (no change)', env, ms)
        return
      }
      const committed = { ...scope, committed: scopeSnapshot(this.app.workspace.current) }
      this.finish(d, { kind: 'applied', requestId: d.requestId, prompt: d.prompt, response, summary, sceneChangeMs: ms, scope: committed }, 'applied', env, ms)
      this.onEffects(effects)
    } catch (e) {
      this.finish(d, { kind: 'rejected', requestId: d.requestId, prompt: d.prompt, response, reason: (e as Error).message, scope }, 'rejected by the planner', env)
    }
  }

  private finish(d: Dispatch, s: AssistantState, outcome: string, env: AssistantResponse | null, ms: number | null = null): void {
    this.active = null
    this.history.push({ requestId: d.requestId, prompt: d.prompt, outcome, source: env?.source ?? null, model: env?.model ?? null, ms: ms === null ? null : Math.round(ms) })
    if (this.history.length > 50) this.history.shift()
    this.set(s)
  }

  /** A request is being prepared (its context hashed) or is in flight. */
  get busy(): boolean {
    return this.preparing !== null || this.active !== null || this.state.kind === 'pending'
  }

  /** Cancel the active request; its eventual response can never change state. */
  cancel(reason = 'canceled'): void {
    this.seq++ // also drops an ask() that has not been sent yet
    const d = this.active
    if (!d) {
      const preparing = this.preparing
      this.preparing = null
      // A request superseded by one that is still being prepared leaves the old "pending" state up
      // until the new one is sent; a user cancel in that gap must still end it. A request cancelled
      // before it was sent ends as canceled too (its question stays recoverable).
      if (reason === 'superseded') return
      if (this.state.kind === 'pending') this.set({ kind: 'canceled', requestId: this.state.requestId, prompt: this.state.prompt })
      else if (preparing !== null) this.set({ kind: 'canceled', requestId: '', prompt: preparing })
      return
    }
    this.active = null
    d.abort.abort(new Error(reason))
    this.history.push({ requestId: d.requestId, prompt: d.prompt, outcome: reason, source: null, model: null, ms: null })
    if (reason !== 'superseded') this.set({ kind: 'canceled', requestId: d.requestId, prompt: d.prompt })
  }

  /** Re-send the last prompt against the current workspace (the stale-suggestion "Retry"). A failure whose
   * remedy is not an unchanged resend (an upstream gateway timeout, a configuration error) sends nothing. */
  retry(): Promise<void> {
    const s = this.state
    if (s.kind === 'error' && errorRemedy(s.error) !== 'retry') return Promise.resolve()
    return 'prompt' in s ? this.ask(s.prompt) : Promise.resolve()
  }
}

/** One-line provenance label for a response. Synthetic output is never presented as live Muse. */
export function sourceLabel(r: AssistantResponse): string {
  return r.source === 'synthetic' ? `Synthetic response (${r.model}) - not live Muse output` : `Muse (${r.model}), ${Math.round(r.timing.totalMs)} ms`
}
