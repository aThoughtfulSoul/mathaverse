// Lean check progress and results where the learner looks: the status line under the stage and the line under
// an Ask Meta Muse AI answer that requested a check. Both are derived ONLY from the app's own evidence store
// (src/evidence/client.ts, mapped to EvidenceItem by the controller) and its status / current flags: never
// from the model's prose, never from a proposal alone. "Checked" appears only once the store reports a
// `checked` entry (a server response with a receipt whose claim hash matched the requested claim), and an
// entry whose claim no longer matches the current document is labelled historical, like the proof
// presenter's Lean section and the answer facts block (answerFacts.ts).
//
// Status line: while a check about the displayed experiment runs it reads "Lean checking this finite
// example…" (or the linear claim's wording); when it settles, the result is shown for HOLD_MS or until the
// presenter's own status changes (the next relevant state change), then the presenter's line returns. It
// follows the most recently settled entry, so a request refused while another check ran (not_sent) never
// replaces the result of that check, and a failed re-check says an earlier receipt for the same claim is still
// current rather than "no receipt". The controller owns the clock and the hold record; everything here is pure
// (unit-tested in node).
//
// Answer card: the controller links an applied (or answered) proposal containing request_check to the first
// evidence entry for that exact claim created after the proposal arrived; this module turns that entry into
// "Lean check: running…", "Lean check: checked · receipt in Show mathematics", or the honest failure text.

import type { AssistantState } from '../../assistant/client'
import { type DemoKind, demoOf } from '../../demo/order'
import type { ClaimRequest } from '../../workspace/claims'
import type { Doc } from '../../workspace/document'
import type { AnswerCheckLink, EvidenceItem, StatusView } from '../model'

/** How long a settled result stays in the status line (unless the presenter's status changes first). */
export const HOLD_MS = 8000

/** Same values as view.ts Tone (kept local: view.ts imports this module). */
export type CheckTone = 'neutral' | 'busy' | 'ok' | 'warning' | 'error'

export type CheckPhase = 'running' | 'checked' | 'historical' | 'not_established' | 'not_sent' | 'error'

const RUNNING: ReadonlySet<EvidenceItem['status']> = new Set(['computed', 'checking'])

export const isRunning = (e: EvidenceItem): boolean => RUNNING.has(e.status)

/** The phase of one evidence entry ("checked" only for a server `checked` entry that is still current). */
export function checkPhase(e: EvidenceItem): CheckPhase {
  if (isRunning(e)) return 'running'
  switch (e.status) {
    case 'checked':
      return e.current ? 'checked' : 'historical'
    case 'not_established':
      return 'not_established'
    case 'not_sent':
      return 'not_sent'
    default:
      return 'error'
  }
}

/** The experiments a claim is about. */
export function claimExperiments(c: ClaimRequest): string[] {
  return c.kind === 'same_image_witness' ? [c.branch.experimentId] : c.kind === 'walk_reorder_instance' ? [c.experimentId] : [c.left.experimentId, c.right.experimentId]
}

/**
 * The experiments whose checks belong to the displayed one: every P/Q map of the P/Q demonstration (its
 * checks span P and Q, as the presenter's checks section lists them), else the displayed experiment itself.
 */
export function checkScope(doc: Doc, demo: DemoKind, experimentId: string): Set<string> {
  if (demo !== 'pq') return new Set([experimentId])
  const ids = doc.experiments.filter((x) => x.domain === 'linear' && demoOf(doc, x) === 'pq').map((x) => x.id)
  return new Set([experimentId, ...ids])
}

/** The claim in a few words, for the status line. */
export function claimNoun(c: ClaimRequest | undefined): string {
  switch (c?.kind) {
    case 'walk_reorder_instance':
      return 'this finite example'
    case 'same_image_witness':
      return 'this same-output pair'
    case 'map_equality':
      return 'this map equality'
    case 'map_difference_witness':
      return 'this map difference'
    default:
      return 'this claim'
  }
}

const short = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t)

/**
 * A current `checked` entry for the same claim as `e` other than `e` itself: another check's receipt that still
 * stands for the claim as shown now, else null.
 */
export function currentReceipt(e: EvidenceItem, evidence: readonly EvidenceItem[]): EvidenceItem | null {
  if (!e.claim) return null
  for (const x of evidence) if (x.id !== e.id && x.status === 'checked' && x.current && x.claim && sameClaim(e.claim, x.claim)) return x
  return null
}

/**
 * The status-line text of one entry (application wording; the entry's own label stays in Show mathematics).
 * A failure is worded as the result of this check, not of the claim: when `evidence` holds a current receipt
 * for the same claim, the line says that receipt is still current instead of "no receipt for …".
 */
export function statusLineFor(e: EvidenceItem, evidence: readonly EvidenceItem[] = []): { text: string; tone: StatusView['tone'] } {
  const noun = claimNoun(e.claim)
  const falseLocally = e.holds === false
  const phase = checkPhase(e)
  const receipt = phase === 'not_established' || phase === 'not_sent' || phase === 'error' ? currentReceipt(e, evidence) : null
  const hist = e.current ? '' : ' (historical)'
  const none = (lean = '') => (receipt ? 'the earlier receipt is still current' : `no ${lean}receipt for ${noun}`)
  switch (phase) {
    case 'running':
      if (!e.current) return { text: `Lean still checking earlier data · ${noun} has changed since`, tone: 'warning' }
      return { text: `Lean checking ${noun}…${falseLocally ? ' (computed exactly: it does not hold)' : ''}`, tone: 'normal' }
    case 'checked':
      return { text: `Lean checked · receipt for ${noun}`, tone: 'normal' }
    case 'historical':
      return { text: `Lean checked earlier data · historical receipt, not for ${noun} as shown now`, tone: 'warning' }
    case 'not_established':
      return falseLocally
        ? { text: `Computed exactly: the claim is false · ${none('Lean ')}${receipt ? '' : hist}`, tone: 'warning' }
        : { text: `Not verified by Lean · ${none()}${receipt ? '' : hist}`, tone: 'warning' }
    case 'not_sent':
      return { text: `Not sent to Lean (another check was running) · ${none()}`, tone: 'warning' }
    case 'error':
      return { text: `Lean check error${e.message ? ` (${short(e.message)})` : ''} · ${none()}${receipt ? '' : hist}`, tone: 'error' }
  }
}

/**
 * Whether settled entry `a` is a more recent result than `b`: it settled later (controller clock); at the same
 * moment a refusal (not_sent) gives way to a check that ran; then the newer ID.
 */
function settledAfter(a: EvidenceItem, b: EvidenceItem, settledAt: ReadonlyMap<number, number> | undefined): boolean {
  const ta = settledAt?.get(a.id) ?? -Infinity
  const tb = settledAt?.get(b.id) ?? -Infinity
  if (ta !== tb) return ta > tb
  const ra = a.status === 'not_sent'
  const rb = b.status === 'not_sent'
  if (ra !== rb) return rb
  return a.id > b.id
}

/**
 * Which entry the status line follows for the displayed experiment: the newest running check, else the most
 * recently settled one by `settledAt` (when each entry was first seen settled). A request refused while another
 * check ran (not_sent, with a newer ID) never hides that check while it runs, nor replaces its result when it
 * settles after the refusal. Without `settledAt`, a refusal gives way to any check that ran, then the newest ID.
 * Null when no check about these experiments exists.
 */
export function statusEntry(evidence: readonly EvidenceItem[], scope: ReadonlySet<string>, settledAt?: ReadonlyMap<number, number>): EvidenceItem | null {
  let running: EvidenceItem | null = null
  let settled: EvidenceItem | null = null
  for (const e of evidence) {
    if (!e.claim || !claimExperiments(e.claim).some((id) => scope.has(id))) continue
    if (isRunning(e)) {
      if (!running || e.id > running.id) running = e
    } else if (!settled || settledAfter(e, settled, settledAt)) settled = e
  }
  return running ?? settled
}

/** A settled result shown in the status line: until `until`, or until the presenter's own text changes. */
export interface CheckHold {
  entryId: number
  /** The presenter's status text when the result first showed. */
  base: string
  until: number
  ended: boolean
}

/**
 * The status line with the check state applied. `settledAt` is when the entry was first seen settled
 * (controller clock); `hold` is the controller's record, returned (possibly new or ended) for it to keep.
 * The presenter's line is kept during a drag preview and for an error status (a scene problem). `evidence`
 * (all entries) lets a failure say an earlier receipt for the same claim is still current.
 */
export function applyCheckStatus(
  status: StatusView,
  entry: EvidenceItem | null,
  opts: { now: number; settledAt: number | null; hold: CheckHold | null; dragging: boolean; evidence?: readonly EvidenceItem[] },
): { status: StatusView; hold: CheckHold | null } {
  const { now, settledAt, dragging } = opts
  let hold = opts.hold
  // Expire first, on every path: the controller wakes up for an open hold, so an expired one must end even
  // while its entry is not shown (another experiment, a drag, a scene problem).
  if (hold && !hold.ended && now >= hold.until) hold = { ...hold, ended: true }
  if (!entry || dragging || status.tone === 'error') return { status, hold }
  const line = statusLineFor(entry, opts.evidence)
  if (isRunning(entry)) return { status: { ...status, text: line.text, tone: line.tone }, hold: null }
  const at = settledAt ?? now
  if (!hold || hold.entryId !== entry.id) {
    // A result that settled long ago (seen again after switching back, say) is not news.
    if (now - at >= HOLD_MS) return { status, hold }
    hold = { entryId: entry.id, base: status.text, until: at + HOLD_MS, ended: false }
  }
  if (hold.ended) return { status, hold }
  if (now >= hold.until || status.text !== hold.base) return { status, hold: { ...hold, ended: true } }
  return { status: { ...status, text: line.text, tone: line.tone }, hold }
}

// ------------------------------------------------------------------ the answer card's check line

/** Which evidence entry an answer's check is: the first entry for its claim created after the proposal arrived. */
export type CheckLink = AnswerCheckLink

export interface AnswerCheckView {
  phase: 'requested' | CheckPhase | 'missing'
  /** "Lean check: running…", "Lean check: checked · receipt in Show mathematics", … */
  text: string
  tone: CheckTone
  /** False once the checked claim no longer matches the current document (historical). */
  current: boolean
  entryId: number | null
}

/** The request_check claim of an applied or answered proposal, else null (stale and rejected ones requested nothing). */
export function requestedCheck(state: AssistantState): ClaimRequest | null {
  if (state.kind !== 'applied' && state.kind !== 'answered') return null
  const a = state.response.proposal.actions.find((x) => x.kind === 'request_check')
  return a && a.kind === 'request_check' ? a.claim : null
}

/** Structural equality of a proposed claim and a checked one; a proposal's `$name` reference matches any ID. */
export function sameClaim(proposed: unknown, actual: unknown): boolean {
  if (typeof proposed === 'string' && proposed.startsWith('$')) return typeof actual === 'string'
  if (proposed === null || actual === null || typeof proposed !== 'object' || typeof actual !== 'object') return proposed === actual
  if (Array.isArray(proposed) !== Array.isArray(actual)) return false
  const a = proposed as Record<string, unknown>
  const b = actual as Record<string, unknown>
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) if (!sameClaim(a[k], b[k])) return false
  return true
}

/** The newest evidence ID (0 for none). */
export const newestEvidenceId = (entries: readonly { id: number }[]): number => entries.reduce((m, e) => Math.max(m, e.id), 0)

/** The evidence entry a link names: its pinned entry, else the first one for this claim after the proposal. */
export function linkedEntry(claim: ClaimRequest, link: CheckLink, evidence: readonly EvidenceItem[]): EvidenceItem | null {
  if (link.entryId !== null) return evidence.find((e) => e.id === link.entryId) ?? null
  let best: EvidenceItem | null = null
  for (const e of evidence) if (e.id > link.afterId && e.claim && sameClaim(claim, e.claim) && (!best || e.id < best.id)) best = e
  return best
}

/** The check line of an answer card, or null when the answer requested no check (or is not linked). */
export function answerCheck(state: AssistantState, link: CheckLink | null | undefined, evidence: readonly EvidenceItem[]): AnswerCheckView | null {
  const claim = requestedCheck(state)
  if (!claim || !link || !('requestId' in state) || state.requestId !== link.requestId) return null
  const e = linkedEntry(claim, link, evidence)
  if (!e) {
    return link.entryId !== null
      ? { phase: 'missing', text: 'Lean check: no longer in the evidence list', tone: 'neutral', current: false, entryId: link.entryId }
      : { phase: 'requested', text: 'Lean check: requested…', tone: 'busy', current: true, entryId: null }
  }
  const phase = checkPhase(e)
  const hist = e.current ? '' : ' (historical: the inputs changed since)'
  const base = { phase, current: e.current, entryId: e.id }
  switch (phase) {
    case 'running':
      return { ...base, text: `Lean check: running…${hist}`, tone: e.current ? 'busy' : 'warning' }
    case 'checked':
      return { ...base, text: 'Lean check: checked · receipt in Show mathematics', tone: 'ok' }
    case 'historical':
      return { ...base, text: 'Lean check: checked earlier inputs · historical receipt in Show mathematics', tone: 'warning' }
    case 'not_established':
      return { ...base, text: `Lean check: not established · no receipt${e.holds === false ? ' (computed exactly: the claim is false)' : ''}${hist}`, tone: 'warning' }
    case 'not_sent':
      return { ...base, text: `Lean check: not sent · another check was running${hist}`, tone: 'warning' }
    case 'error':
      return { ...base, text: `Lean check: error · no receipt${e.message ? ` (${short(e.message)})` : ''}${hist}`, tone: 'error' }
  }
}
