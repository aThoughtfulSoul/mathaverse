// Lean check visibility (src/ui/assistant/checkStatus.ts): the status-line text for a running, checked
// (current), historical, not established, refused and failed check, how long a settled result holds the line,
// which entry the line follows, and the answer card's "Lean check: …" line, which follows the evidence entry
// the proposal's own check created and never says "checked" before the store reports a `checked` entry.
// Pure; synthetic evidence items only (no Lean service).

import { describe, expect, it } from 'vitest'
import {
  HOLD_MS, type CheckLink, answerCheck, applyCheckStatus, checkScope, currentReceipt, newestEvidenceId, requestedCheck, sameClaim, statusEntry, statusLineFor,
} from '../../../src/ui/assistant/checkStatus'
import type { AssistantState } from '../../../src/assistant/client'
import type { ClaimRequest } from '../../../src/workspace/claims'
import type { EvidenceItem, StatusView } from '../../../src/ui/model'
import { docs, response } from './helpers'

const WALK: ClaimRequest = { kind: 'walk_reorder_instance', experimentId: 'exp-walk' }
const DIFF: ClaimRequest = { kind: 'map_difference_witness', left: { experimentId: 'exp-p', branchId: 'main' }, right: { experimentId: 'exp-q', branchId: 'main' }, basisIndex: 2 }
const SAME: ClaimRequest = { kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: 's(1,0,1)', v: 's(1,0,-1)' }
const EQ: ClaimRequest = { kind: 'map_equality', left: { experimentId: 'exp-cmp', branchId: 'left' }, right: { experimentId: 'exp-cmp', branchId: 'right' } }

function item(id: number, status: EvidenceItem['status'], over: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id, claim: WALK, label: 'this 6-arrow walk and its signs', status, current: true, holds: true,
    statement: status === 'checked' ? 'walk_reorder_instance …' : null,
    provenance: status === 'checked' ? 'Lean 4 · walkReorder · receipt rc-1' : null,
    message: status === 'error' ? 'HTTP 503' : null,
    ...over,
  }
}

const BOUND: StatusView = { phase: 'ready', text: '6 arrows return home · peak 1.414 inside source bound 2', tone: 'normal' }
/** Never "checked"/"receipt" as a success before the store says `checked` (the word "Checking"/"checking" is fine). */
const SAYS_CHECKED = /\bchecked\b|· receipt/i

function applied(claim: ClaimRequest | null, requestId = 'r1'): AssistantState {
  const r = response('meta')
  r.proposal = { ...r.proposal, title: 'Check this example', explanation: 'Requesting a Lean check of this finite example.', actions: claim ? [{ kind: 'request_check', claim }] : [] }
  return { kind: 'applied', requestId, prompt: 'Check this example', response: r, summary: ['Request a Lean check'], sceneChangeMs: 3 }
}

describe('status line text', () => {
  it('running, checked (current), historical, not established, not sent and error, for the finite example', () => {
    expect(statusLineFor(item(1, 'checking'))).toEqual({ text: 'Lean checking this finite example…', tone: 'normal' })
    expect(statusLineFor(item(1, 'checked'))).toEqual({ text: 'Lean checked · receipt for this finite example', tone: 'normal' })
    const hist = statusLineFor(item(1, 'checked', { current: false }))
    expect(hist.text).toBe('Lean checked earlier data · historical receipt, not for this finite example as shown now')
    expect(hist.tone).toBe('warning')
    expect(statusLineFor(item(1, 'not_established', { message: 'no proof found' }))).toEqual({ text: 'Not verified by Lean · no receipt for this finite example', tone: 'warning' })
    expect(statusLineFor(item(1, 'not_established', { holds: false })).text).toBe('Computed exactly: the claim is false · no Lean receipt for this finite example')
    expect(statusLineFor(item(1, 'not_sent')).text).toBe('Not sent to Lean (another check was running) · no receipt for this finite example')
    expect(statusLineFor(item(1, 'error'))).toEqual({ text: 'Lean check error (HTTP 503) · no receipt for this finite example', tone: 'error' })
    expect(statusLineFor(item(1, 'checking', { current: false })).text).toBe('Lean still checking earlier data · this finite example has changed since')
  })

  it('linear-map claims are worded by their kind', () => {
    expect(statusLineFor(item(1, 'checking', { claim: DIFF })).text).toBe('Lean checking this map difference…')
    expect(statusLineFor(item(1, 'checked', { claim: SAME })).text).toBe('Lean checked · receipt for this same-output pair')
    expect(statusLineFor(item(1, 'checking', { claim: EQ })).text).toBe('Lean checking this map equality…')
  })

  it('only a checked entry says checked or receipt', () => {
    for (const s of ['computed', 'checking', 'not_established', 'not_sent', 'error'] as const) {
      expect(statusLineFor(item(1, s)).text, s).not.toMatch(SAYS_CHECKED)
      expect(statusLineFor(item(1, s, { current: false })).text, s).not.toMatch(SAYS_CHECKED)
    }
  })
})

describe('which entry the status line follows', () => {
  it('checks about the displayed experiment only; a running check wins over a newer refusal', () => {
    const scope = new Set(['exp-walk'])
    expect(statusEntry([item(1, 'checked', { claim: DIFF })], scope)).toBeNull()
    const running = item(1, 'checking')
    expect(statusEntry([item(2, 'not_sent'), running], scope)).toBe(running)
    const newest = item(3, 'checked')
    expect(statusEntry([item(1, 'error'), newest, item(2, 'not_established')], scope)).toBe(newest)
  })

  it('P/Q checks span P and Q; other experiments use their own ID', () => {
    const d = docs()
    expect(checkScope(d.pq, 'pq', 'exp-p').has('exp-p')).toBe(true)
    expect(statusEntry([item(1, 'checking', { claim: DIFF })], checkScope(d.pq, 'pq', 'exp-p'))?.id).toBe(1)
    expect([...checkScope(d.proof, 'proof', 'exp-walk')]).toEqual(['exp-walk'])
  })
})

describe('a refused request never replaces the result of the check that settled after it (review finding 1)', () => {
  const scope = new Set(['exp-walk'])

  it('A checking, B not_sent while A ran, A checked: the line follows A by settle time, not B by ID', () => {
    const a = item(1, 'checked')
    const b = item(2, 'not_sent')
    // B was refused at 300 ms; A settled at 1300 ms.
    const at = new Map([[1, 1300], [2, 300]])
    expect(statusEntry([b, a], scope, at)).toBe(a)
    const r = applyCheckStatus(BOUND, statusEntry([b, a], scope, at), { now: 1300, settledAt: 1300, hold: null, dragging: false, evidence: [b, a] })
    expect(r.status.text).toBe('Lean checked · receipt for this finite example')
    expect(r.hold?.entryId).toBe(1)
  })

  it('same moment: a refusal gives way to a check that ran; without settle times too', () => {
    const a = item(1, 'error')
    const b = item(2, 'not_sent')
    expect(statusEntry([b, a], scope, new Map([[1, 500], [2, 500]]))).toBe(a)
    expect(statusEntry([b, a], scope)).toBe(a)
    // A refusal that settled later than every real result is the newest news, and is shown.
    expect(statusEntry([b, a], scope, new Map([[1, 100], [2, 500]]))).toBe(b)
    // Among real results the later settle wins even with a smaller ID.
    const c = item(3, 'not_established')
    expect(statusEntry([c, a], scope, new Map([[1, 900], [3, 400]]))).toBe(a)
    // Only refusals: the newest.
    const d = item(4, 'not_sent')
    expect(statusEntry([d, b], scope)).toBe(d)
  })
})

describe('a failed re-check while an earlier receipt is current (review finding 2)', () => {
  const receipt = item(1, 'checked')

  it('error, not established and not sent say the earlier receipt is still current, never "no receipt for this finite example"', () => {
    const ev = (e: EvidenceItem) => [e, receipt]
    const err = item(2, 'error')
    expect(statusLineFor(err, ev(err))).toEqual({ text: 'Lean check error (HTTP 503) · the earlier receipt is still current', tone: 'error' })
    const ne = item(2, 'not_established')
    expect(statusLineFor(ne, ev(ne))).toEqual({ text: 'Not verified by Lean · the earlier receipt is still current', tone: 'warning' })
    const ns = item(2, 'not_sent')
    expect(statusLineFor(ns, ev(ns)).text).toBe('Not sent to Lean (another check was running) · the earlier receipt is still current')
    for (const e of [err, ne, ns]) expect(statusLineFor(e, ev(e)).text).not.toMatch(/no receipt/)
    expect(currentReceipt(err, ev(err))).toBe(receipt)
  })

  it('"no receipt" stays when the earlier receipt is historical, for another claim, or the entry itself', () => {
    const err = item(2, 'error')
    expect(statusLineFor(err, [err, item(1, 'checked', { current: false })]).text).toBe('Lean check error (HTTP 503) · no receipt for this finite example')
    expect(statusLineFor(err, [err, item(1, 'checked', { claim: DIFF })]).text).toBe('Lean check error (HTTP 503) · no receipt for this finite example')
    expect(statusLineFor(err, [err, item(1, 'error')]).text).toBe('Lean check error (HTTP 503) · no receipt for this finite example')
    const ok = item(3, 'checked')
    expect(currentReceipt(ok, [ok])).toBeNull()
    expect(statusLineFor(ok, [ok]).text).toBe('Lean checked · receipt for this finite example')
  })

  it('applyCheckStatus words the held failure with the evidence it is given', () => {
    const err = item(2, 'error')
    const r = applyCheckStatus(BOUND, err, { now: 21000, settledAt: 21000, hold: null, dragging: false, evidence: [err, receipt] })
    expect(r.status).toMatchObject({ text: 'Lean check error (HTTP 503) · the earlier receipt is still current', tone: 'error' })
  })
})

describe('status line hold', () => {
  const run = (entry: EvidenceItem | null, now: number, settledAt: number | null, hold: Parameters<typeof applyCheckStatus>[2]['hold'], status = BOUND, dragging = false) =>
    applyCheckStatus(status, entry, { now, settledAt, hold, dragging })

  it('running replaces the bound text; a settled result shows until HOLD_MS, then the presenter line returns', () => {
    expect(run(item(1, 'checking'), 0, null, null).status.text).toBe('Lean checking this finite example…')
    const a = run(item(1, 'checked'), 1300, 1300, null)
    expect(a.status.text).toBe('Lean checked · receipt for this finite example')
    expect(a.status.phase).toBe('ready')
    const b = run(item(1, 'checked'), 1300 + HOLD_MS - 1, 1300, a.hold)
    expect(b.status.text).toBe('Lean checked · receipt for this finite example')
    const c = run(item(1, 'checked'), 1300 + HOLD_MS, 1300, b.hold)
    expect(c.status).toBe(BOUND)
    expect(c.hold?.ended).toBe(true)
    // Once ended it stays ended, even if the presenter text goes back.
    expect(run(item(1, 'checked'), 1300 + HOLD_MS + 5, 1300, c.hold).status).toBe(BOUND)
  })

  it('the next relevant state change (the presenter status changes) ends the hold early', () => {
    const a = run(item(1, 'checked'), 100, 100, null)
    const moved = { ...BOUND, text: 'Signed walk stays within signed bound 2' }
    const b = run(item(1, 'checked'), 200, 100, a.hold, moved)
    expect(b.status).toBe(moved)
    expect(b.hold?.ended).toBe(true)
  })

  it('a historical receipt, a failure and an error are shown honestly while held', () => {
    expect(run(item(1, 'checked', { current: false }), 10, 10, null).status).toMatchObject({ text: /historical receipt/, tone: 'warning' })
    expect(run(item(1, 'not_established'), 10, 10, null).status).toMatchObject({ text: 'Not verified by Lean · no receipt for this finite example', tone: 'warning' })
    expect(run(item(1, 'error'), 10, 10, null).status).toMatchObject({ text: /^Lean check error/, tone: 'error' })
  })

  it('an old result is not news; a drag preview and a scene problem keep their own line', () => {
    expect(run(item(1, 'checked'), HOLD_MS + 50, 0, null).status).toBe(BOUND)
    expect(run(item(1, 'checking'), 0, null, null, BOUND, true).status).toBe(BOUND)
    const problem: StatusView = { phase: 'ready', text: 'Not available: no scene', tone: 'error' }
    expect(run(item(1, 'checking'), 0, null, null, problem).status).toBe(problem)
    expect(run(null, 0, null, null).status).toBe(BOUND)
  })

  it('an open hold expires on every path (so the controller stops waking up for it)', () => {
    const a = run(item(1, 'checked'), 0, 0, null)
    expect(a.hold?.ended).toBe(false)
    expect(run(null, HOLD_MS, null, a.hold).hold?.ended).toBe(true)
    expect(run(item(1, 'checked'), HOLD_MS, 0, a.hold, BOUND, true).hold?.ended).toBe(true)
    expect(run(null, HOLD_MS - 1, null, a.hold).hold?.ended).toBe(false)
  })
})

describe('answer card check line', () => {
  const link = (over: Partial<CheckLink> = {}): CheckLink => ({ requestId: 'r1', afterId: 0, entryId: null, ...over })

  it('requested, running, then checked; never "checked" before the store reports it', () => {
    const s = applied(WALK)
    expect(answerCheck(s, link(), [])).toMatchObject({ phase: 'requested', text: 'Lean check: requested…', tone: 'busy' })
    const running = answerCheck(s, link(), [item(1, 'checking')])!
    expect(running).toMatchObject({ phase: 'running', text: 'Lean check: running…', tone: 'busy', entryId: 1 })
    expect(running.text).not.toMatch(SAYS_CHECKED)
    expect(answerCheck(s, link(), [item(1, 'checked')])).toMatchObject({ phase: 'checked', text: 'Lean check: checked · receipt in Show mathematics', tone: 'ok', current: true })
  })

  it('historical once the inputs change; failed, refused and error are labelled', () => {
    const s = applied(WALK)
    expect(answerCheck(s, link(), [item(1, 'checked', { current: false })])).toMatchObject({ phase: 'historical', text: 'Lean check: checked earlier inputs · historical receipt in Show mathematics', tone: 'warning', current: false })
    expect(answerCheck(s, link(), [item(1, 'checking', { current: false })])?.text).toBe('Lean check: running… (historical: the inputs changed since)')
    expect(answerCheck(s, link(), [item(1, 'not_established')])).toMatchObject({ text: 'Lean check: not established · no receipt', tone: 'warning' })
    expect(answerCheck(s, link(), [item(1, 'not_established', { holds: false })])?.text).toBe('Lean check: not established · no receipt (computed exactly: the claim is false)')
    expect(answerCheck(s, link(), [item(1, 'not_sent')])?.text).toBe('Lean check: not sent · another check was running')
    expect(answerCheck(s, link(), [item(1, 'error')])).toMatchObject({ text: 'Lean check: error · no receipt (HTTP 503)', tone: 'error' })
    expect(answerCheck(s, link(), [item(1, 'error', { current: false })])?.text).toBe('Lean check: error · no receipt (HTTP 503) (historical: the inputs changed since)')
    for (const st of ['computed', 'checking', 'not_established', 'not_sent', 'error'] as const) expect(answerCheck(s, link(), [item(1, st)])!.text, st).not.toMatch(SAYS_CHECKED)
  })

  it('follows the entry its own check created: an earlier receipt for the same claim is not this answer’s result', () => {
    const s = applied(WALK)
    const earlier = item(4, 'checked')
    expect(answerCheck(s, link({ afterId: 4 }), [earlier])?.phase).toBe('requested')
    const mine = item(5, 'checking')
    const later = item(6, 'checked')
    expect(answerCheck(s, link({ afterId: 4 }), [later, mine, earlier])?.entryId).toBe(5)
    // Pinned: a later check of the same claim never takes its place; an evicted entry is not reinvented.
    expect(answerCheck(s, link({ afterId: 4, entryId: 5 }), [later, mine])?.phase).toBe('running')
    expect(answerCheck(s, link({ afterId: 4, entryId: 5 }), [later])).toMatchObject({ phase: 'missing', text: 'Lean check: no longer in the evidence list' })
    // A different claim is not this check.
    expect(answerCheck(s, link(), [item(1, 'checked', { claim: { kind: 'walk_reorder_instance', experimentId: 'exp-other' } })])?.phase).toBe('requested')
  })

  it('no line without request_check, for another request, or for proposals that were not applied', () => {
    expect(answerCheck(applied(null), link(), [item(1, 'checked')])).toBeNull()
    expect(answerCheck(applied(WALK, 'r2'), link(), [item(1, 'checked')])).toBeNull()
    expect(answerCheck(applied(WALK), null, [item(1, 'checked')])).toBeNull()
    const st = applied(WALK) as Extract<AssistantState, { kind: 'applied' }>
    const stale: AssistantState = { kind: 'stale', requestId: 'r1', prompt: st.prompt, response: st.response, reason: 'the workspace changed while the request was running' }
    const rejected: AssistantState = { kind: 'rejected', requestId: 'r1', prompt: st.prompt, response: st.response, reason: 'invalid' }
    expect(requestedCheck(stale)).toBeNull()
    expect(answerCheck(stale, link(), [item(1, 'checked')])).toBeNull()
    expect(answerCheck(rejected, link(), [item(1, 'checked')])).toBeNull()
    expect(requestedCheck(applied(DIFF))).toEqual(DIFF)
  })

  it('claims match structurally; a proposal $name reference matches the resolved ID', () => {
    expect(sameClaim({ kind: 'walk_reorder_instance', experimentId: '$walk' }, WALK)).toBe(true)
    expect(sameClaim({ ...DIFF, basisIndex: 1 }, DIFF)).toBe(false)
    expect(sameClaim({ left: DIFF.left, kind: DIFF.kind, basisIndex: 2, right: DIFF.right }, DIFF)).toBe(true)
    expect(newestEvidenceId([{ id: 3 }, { id: 7 }, { id: 5 }])).toBe(7)
    expect(newestEvidenceId([])).toBe(0)
  })
})
