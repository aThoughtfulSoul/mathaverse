// Shared machinery of the live Meta smoke test (docs/MUSE.md "Live smoke test"). Two opt-in modes:
// - LIVE (MUSE_LIVE=1 and META_API_KEY): REAL provider calls through the default route (process env, real fetch,
//   process status). Records go to MUSE_LIVE_DIR when it is set. The key is never printed or recorded.
// - REHEARSAL (the default without a key; MUSE_REHEARSAL=0 turns it off): the same cases on the live path with a MOCKED fetch whose reply is
//   the synthetic fixture's proposal for the case (a known-correct answer, shaped like a documented Response). It
//   checks that every assertion accepts a correct answer and rejects a valid but wrong one, before real calls are
//   spent. Rehearsal records are marked `mode: "rehearsal"`, are never written to MUSE_LIVE_DIR and are never
//   live evidence.
// Rehearsal runs in the normal test suite, so the live cases cannot silently go stale.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { AssistantResponse } from '../../src/workspace/actions'
import { type Doc, docToJson } from '../../src/workspace/document'
import { type Plan, Workspace, planTransaction } from '../../src/workspace/reducer'
import { capabilitiesFor, createAssistantRoute, museCapabilities } from '../../server/muse/index'
import { newStatus, readConfig } from '../../server/muse/config'
import { matchFixture, normalizePrompt } from '../../server/muse/synthetic'
import { USE_PREPARED, preparedCatalog } from '../../server/muse/prepared'
import { parseModelText } from '../../server/muse/validate'
import type { ApiResult } from '../../server/types'
import { LIVE_ENV, apiRequest, assistantRequest, mockFetch, syntheticReply } from './helpers'

export const LIVE = process.env.MUSE_LIVE === '1' && !!(process.env.META_API_KEY || process.env.MODEL_API_KEY)
export const REHEARSAL = !LIVE && process.env.MUSE_REHEARSAL !== '0'
export const ENABLED = LIVE || REHEARSAL
export const MODE = LIVE ? 'live' : 'rehearsal'
export const TIMEOUT = 60_000

/** What a case's assertions see: the validated response, its plan on the submitted document, and the
 *  document after committing it through Workspace.commit, as the client does. */
export interface LiveResult {
  j: AssistantResponse
  plan: Plan
  before: Doc
  after: Doc
}

export interface LiveCase {
  /** Short test name. */
  name: string
  /** The learner's request, exactly as typed or offered as a suggestion. */
  prompt: string
  /** The document the request is made on (built fresh for each run). */
  doc: () => Doc
  /** Assertions on the meaning of the answer, not its exact wording or action list: a live model may reach
   *  the same result with different valid actions (an extra select, a stage change). Synchronous; throws
   *  (expect) when the answer is wrong. */
  check: (r: LiveResult) => void
  /** Rehearsal: the prompt whose synthetic fixture stands in for a correct answer (default: `prompt`). */
  rehearseWith?: string
  /** Rehearsal negative control: valid actions that `check` must reject. Default: no actions, which fits every
   *  case that should change something. An answer-only case (where no actions is correct) gives valid
   *  actions that change the mathematics, or null when no meaningful wrong answer exists. */
  wrong?: ((doc: Doc) => unknown[]) | null
  /** Review flags on the explanation's wording (e.g. "calls equal braids different"). They never fail the run:
   *  pattern matching cannot judge prose reliably, so a flagged answer is recorded for a person to read. */
  flags?: (r: LiveResult) => string[]
}

export interface LiveRecord {
  mode: 'live' | 'rehearsal'
  case: string
  prompt: string
  http: number
  source: string | null
  model: string | null
  providerMs: number | null
  totalMs: number | null
  wallMs: number
  title: string | null
  explanation: string | null
  actions: unknown[] | null
  summary: string[] | null
  effects: unknown[] | null
  error: string | null
  /** Review flags on the explanation's wording (LiveCase.flags); empty when none fired. */
  flags?: string[]
  /** Only when the request failed: the model's output text from each provider attempt (the JSON it proposed,
   *  including a rejected one), to diagnose the rejection. Never headers or the rest of the provider body. */
  modelOutputs?: string[]
  /** The prepared templates the reply named with use_prepared: live, from the model's output across attempts;
   *  rehearsal, the reference the mocked reply used. */
  references?: string[]
}

const records: LiveRecord[] = []
export const record = (r: LiveRecord) => {
  records.push(r)
  console.info(`[muse-${r.mode}] ${JSON.stringify(r)}`)
}

/** Write this file's live records to MUSE_LIVE_DIR/<tag>.json (live mode only; never rehearsal). */
export function writeRecords(tag: string): void {
  const dir = process.env.MUSE_LIVE_DIR
  if (!LIVE || !dir) return
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${tag}.json`), `${JSON.stringify({ recordedAt: new Date().toISOString(), configuredModel: readConfig().model, records }, null, 2)}\n`)
}

/** The model's output text from each provider response of the current request (message output_text parts only). */
let outputs: string[] = []
const capturingFetch: typeof fetch = async (input, init) => {
  const res = await globalThis.fetch(input, init)
  try {
    const body = (await res.clone().json()) as { output?: { type?: string; content?: { type?: string; text?: string }[] }[] }
    for (const item of body.output ?? []) if (item.type === 'message') for (const part of item.content ?? []) if (part.type === 'output_text' && part.text) outputs.push(part.text)
  } catch {
    /* not JSON: nothing to capture */
  }
  return res
}
// The default route's environment and process status, with the model's output captured for diagnosis.
const liveRoute = createAssistantRoute({ fetchImpl: capturingFetch })
const rehearsalStatus = newStatus()

/** The capabilities after the calls so far: the process status (live) or the rehearsal's own status. */
export const capabilitiesNow = () => (LIVE ? museCapabilities() : capabilitiesFor(LIVE_ENV, rehearsalStatus))
/** The model a live-path answer must report. */
export const expectedModel = () => readConfig(LIVE ? process.env : LIVE_ENV).model

/** The synthetic fixture's proposal for `prompt` on `doc`, as a provider reply body (rehearsal only). When its
 *  actions are exactly a prepared template, the reply names it with use_prepared, as a live model is told to. */
function fixtureReply(prompt: string, doc: Doc): Response {
  const f = matchFixture(prompt)
  if (!f) throw new Error(`rehearsal: no synthetic fixture for "${prompt}"; give the case a rehearseWith prompt`)
  const p = f.build(doc, normalizePrompt(prompt))
  const same = JSON.stringify(p.actions)
  const name = p.actions.length ? [...preparedCatalog(doc)].find(([, t]) => JSON.stringify(t) === same)?.[0] : undefined
  rehearsedReferences = name ? [name] : []
  return syntheticReply(JSON.stringify(name ? { ...p, actions: [{ kind: USE_PREPARED, template: name }] } : p))
}

/** The prepared templates a live reply named (use_prepared), from the model's captured output (read as the route
 *  reads it, fenced JSON included). */
function referencesIn(texts: string[]): string[] {
  const names: string[] = []
  for (const t of texts) {
    const parsed = parseModelText(t)
    if (!parsed.ok) continue
    for (const a of (parsed.value as { actions?: { kind?: string; template?: string }[] }).actions ?? []) if (a?.kind === USE_PREPARED && a.template) names.push(a.template)
  }
  return names
}

/** Rehearsal: the reference the last mocked reply used (fixtureReply), and how many replies used one so far. */
let rehearsedReferences: string[] = []
let rehearsalReferenceCount = 0
export const rehearsalReferences = () => rehearsalReferenceCount

/** One request on the live path. Live: a real provider call. Rehearsal: the fixture's answer through a mocked fetch. */
export async function ask(c: Pick<LiveCase, 'name' | 'prompt' | 'rehearseWith'>, doc: Doc): Promise<{ j: AssistantResponse; plan: Plan }> {
  const route = LIVE ? liveRoute : createAssistantRoute({ env: LIVE_ENV, fetchImpl: mockFetch(fixtureReply(c.rehearseWith ?? c.prompt, doc)).fetchImpl, status: rehearsalStatus, minRepairMs: 0 })
  outputs = []
  const t0 = performance.now()
  const res: ApiResult = await route(apiRequest(assistantRequest(c.prompt, doc)))
  const wallMs = Math.round(performance.now() - t0)
  const ok = res.status === 200
  const j = res.json as AssistantResponse
  const plan = ok ? planTransaction(doc, j.proposal.actions) : null
  record({
    mode: MODE, case: c.name, prompt: c.prompt, http: res.status, source: ok ? j.source : null, model: ok ? j.model : null,
    providerMs: ok ? j.timing.providerMs : null, totalMs: ok ? j.timing.totalMs : null, wallMs,
    title: ok ? j.proposal.title : null, explanation: ok ? j.proposal.explanation : null,
    actions: ok ? j.proposal.actions : null, summary: plan?.summary ?? null, effects: plan?.effects ?? null, error: ok ? null : JSON.stringify(res.json),
    ...(ok || !LIVE ? {} : { modelOutputs: outputs }),
    references: LIVE ? referencesIn(outputs) : rehearsedReferences,
  })
  if (REHEARSAL && rehearsedReferences.length) rehearsalReferenceCount++
  expect(res.status, JSON.stringify(res.json)).toBe(200)
  // Labelled "meta" only after a provider response validated, with the configured model.
  expect(j.source).toBe('meta')
  expect(j.model).toBe(expectedModel())
  expect(typeof j.timing.providerMs).toBe('number')
  return { j, plan: plan! }
}

const content = (d: Doc) => JSON.stringify(docToJson({ ...d, revision: 0, mathRevision: 0 }))

/** Commit `actions` on `before` as the client does, run `check`, then Undo and confirm the content is restored.
 *  Returns the committed result (for review flags). */
export function commitCheckUndo(before: Doc, j: AssistantResponse, plan: Plan, check: LiveCase['check']): LiveResult {
  const ws = new Workspace(before)
  const { doc: after } = ws.commit({ baseRevision: before.revision, actions: j.proposal.actions })
  const r = { j, plan, before, after }
  check(r)
  if (j.proposal.actions.length) {
    ws.undo()
    expect(content(ws.current)).toBe(content(before))
  }
  return r
}

/** A valid answer with the given actions on `doc`, as a LiveResult (for negative controls). */
function resultOf(doc: Doc, actions: unknown[]): LiveResult {
  const plan = planTransaction(doc, actions)
  const j = { requestId: 'req-control', source: 'meta', model: expectedModel(), baseRevision: doc.revision, contextHash: '', timing: { providerMs: 0, totalMs: 0 }, proposal: { proposalVersion: 1, title: 'Control', explanation: 'Control answer.', actions } } as unknown as AssistantResponse
  const after = new Workspace(doc).commit({ baseRevision: doc.revision, actions }).doc
  return { j, plan, before: doc, after }
}

/** Run one case: ask, commit, check, Undo; in rehearsal also confirm the check rejects the wrong answer. */
export async function runCase(c: LiveCase): Promise<void> {
  const doc = c.doc()
  const { j, plan } = await ask(c, doc)
  const flags = c.flags?.(commitCheckUndo(doc, j, plan, c.check)) ?? []
  // Attach the flags to this request's record (ask() logged it just before).
  const rec = records[records.length - 1]!
  rec.flags = flags
  if (flags.length) console.info(`[muse-${MODE}] review flags for "${c.name}": ${JSON.stringify(flags)}`)
  if (REHEARSAL && c.wrong !== null) {
    const wrong = (c.wrong ?? (() => []))(doc)
    expect(() => c.check(resultOf(doc, wrong)), `${c.name}: the check accepts the wrong answer ${JSON.stringify(wrong)}`).toThrow()
  }
}

/** A real request with a random invalid key (live), or a mocked 401 (rehearsal): an error, never a fallback. */
export async function askWithInvalidKey(prompt: string, doc: Doc): Promise<ApiResult> {
  const badKey = `LLM_invalid_${crypto.randomUUID().replace(/-/g, '')}`
  const route = LIVE
    ? createAssistantRoute({ env: { ...process.env, META_API_KEY: badKey, MODEL_API_KEY: '' }, status: newStatus() })
    : createAssistantRoute({ env: { META_API_KEY: badKey }, status: newStatus(), fetchImpl: mockFetch(new Response('{"error":{"type":"authentication_error","code":"invalid_api_key"}}', { status: 401 })).fetchImpl })
  const res = await route(apiRequest(assistantRequest(prompt, doc)))
  record({ mode: MODE, case: 'invalid key', prompt, http: res.status, source: null, model: null, providerMs: null, totalMs: null, wallMs: 0, title: null, explanation: null, actions: null, summary: null, effects: null, error: JSON.stringify(res.json) })
  return res
}

/** No mathematical change: for answer-only requests (an explanation may still select or show something). */
export const noMathChange = (r: LiveResult) => expect(r.plan.math, `math changed: ${r.plan.summary.join('; ')}`).toBe(false)
