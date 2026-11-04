// Lean check visibility through the controller (src/ui/controller.ts with src/ui/assistant/checkStatus.ts):
// the rehearsal case ("Check this example" by voice; live Muse proposes request_check; the app runs a real
// check that passes in 1.3 s) now changes the status line and the answer card, from the evidence store's own
// entries only. The real presenters run on real documents; the App, the clients and the clock are stand-ins,
// and every evidence entry here is synthetic (no Lean service is called).

import { describe, expect, it, vi } from 'vitest'
import { Workspace } from '../../src/workspace/reducer'
import { UiController, type ControllerDeps } from '../../src/ui/controller'
import { PRESENTERS } from '../../src/ui/presenters'
import { assistantView } from '../../src/ui/assistant/view'
import type { AssistantState } from '../../src/assistant/client'
import type { ClaimRequest } from '../../src/workspace/claims'
import type { EvidenceStatus } from '../../src/evidence/client'
import type { Doc } from '../../src/workspace/document'
import type { DemoKind } from '../../src/demo/order'
import { HOLD_MS } from '../../src/ui/assistant/checkStatus'
import { docs, response } from './assistant/helpers'

const WALK: ClaimRequest = { kind: 'walk_reorder_instance', experimentId: 'exp-walk' }

interface Entry {
  id: number
  request: ClaimRequest
  label: string
  status: EvidenceStatus
  current: boolean
  local: { holds: boolean; detail: string }
  response: { statement: string; provenance: { toolchain: string; theorem: string }; receipt: { id: string } | null; reason: string | null } | null
  error: string | null
}

function setup(doc: Doc, demo: DemoKind) {
  let t = 0
  const workspace = new Workspace(doc)
  let walkStage = 'walk'
  const app = {
    workspace,
    demo,
    mode: 'fiber',
    sceneProblem: null,
    scene: null,
    get walkStage() {
      return walkStage
    },
    setWalkStage: (s: string) => {
      walkStage = s
    },
    playback: { active: false, playing: false, step: null, phase: 'idle', time: 0, duration: 0 },
    snapshot: () => ({ dragging: null }),
    currentDescription: () => null,
    applyPresentation: vi.fn(),
    transact: vi.fn(),
    command: vi.fn(),
    showDemo: vi.fn(),
  }
  const frames: (() => void)[] = []
  const host = { presenting: false, sessionMode: null, onSession: () => () => {}, onFrame: (fn: () => void) => (frames.push(fn), () => {}), passthroughSupported: async () => false }
  const assistantListeners = new Set<(s: AssistantState) => void>()
  const assistant = {
    state: { kind: 'idle' } as AssistantState,
    busy: false,
    subscribe: (fn: (s: AssistantState) => void) => (assistantListeners.add(fn), () => assistantListeners.delete(fn)),
    set(s: AssistantState) {
      this.state = s
      assistantListeners.forEach((fn) => fn(s))
    },
    cancel: vi.fn(),
    ask: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
  }
  const voice = { state: { kind: 'idle' }, busy: false, acquiring: false, subscribe: () => () => {}, cancel: vi.fn(), toggle: vi.fn() }
  const evidenceListeners = new Set<() => void>()
  const evidence = {
    entries: [] as Entry[],
    subscribe: (fn: () => void) => (evidenceListeners.add(fn), () => evidenceListeners.delete(fn)),
    changed: () => evidenceListeners.forEach((fn) => fn()),
    check: vi.fn(async () => null),
    /** What EvidenceClient.check does to the store: a new entry first, then its status as it changes. */
    add(request: ClaimRequest, status: EvidenceStatus = 'checking'): Entry {
      const e: Entry = { id: this.entries.reduce((m, x) => Math.max(m, x.id), 0) + 1, request, label: 'this 6-arrow walk and its signs', status, current: true, local: { holds: true, detail: 'holds' }, response: null, error: null }
      this.entries.unshift(e)
      this.changed()
      return e
    },
    settle(e: Entry, status: EvidenceStatus, error: string | null = null) {
      e.status = status
      e.error = error
      e.response = status === 'checked' ? { statement: 'walk_reorder_instance', provenance: { toolchain: 'Lean 4', theorem: 'walkReorder' }, receipt: { id: 'rc-1' }, reason: null } : null
      this.changed()
    },
  }
  const deps = {
    app, host, assistant, voice, evidence,
    workspace: { save: async () => '', reopen: async () => '', exportJson: () => '', importJson: () => {} },
    capabilities: () => null,
    now: () => t,
  } as unknown as ControllerDeps
  const ui = new UiController(deps)
  ui.setPresenters(PRESENTERS)
  return {
    ui, assistant, evidence,
    status: () => ui.view.presentation.status,
    card: () => assistantView(ui.view.assistant).exchange?.check ?? null,
    at: (ms: number) => {
      t = ms
      frames.forEach((f) => f())
    },
  }
}

function applied(claim: ClaimRequest, requestId = 'r1'): AssistantState {
  const r = response('meta')
  r.proposal = { ...r.proposal, title: 'Check this example', explanation: 'A Lean check of this finite example is requested; its result comes from the checker.', actions: [{ kind: 'request_check', claim }] }
  return { kind: 'applied', requestId, prompt: 'Check this example', response: r, summary: ['Request a Lean check'], sceneChangeMs: 4 }
}

describe('Lean check visibility through the controller', () => {
  it('the rehearsal case: running, then checked for a while, then the bound text again; the answer card follows the same entry', () => {
    const { assistant, evidence, status, card, at } = setup(docs().proof, 'proof')
    const bound = status().text
    expect(bound).toMatch(/return home/)
    expect(card()).toBeNull()
    // Muse's proposal applies (the assistant notifies before it hands the check to the evidence client).
    assistant.set(applied(WALK))
    expect(card()).toMatchObject({ phase: 'requested', text: 'Lean check: requested…' })
    expect(status().text).toBe(bound)
    const e = evidence.add(WALK)
    expect(status()).toMatchObject({ text: 'Lean checking this finite example…', tone: 'normal' })
    expect(card()).toMatchObject({ phase: 'running', text: 'Lean check: running…' })
    expect(card()!.text).not.toMatch(/\bchecked\b/)
    at(1300)
    evidence.settle(e, 'checked')
    expect(status()).toMatchObject({ text: 'Lean checked · receipt for this finite example', tone: 'normal' })
    expect(card()).toMatchObject({ phase: 'checked', text: 'Lean check: checked · receipt in Show mathematics', current: true })
    at(1300 + HOLD_MS - 10)
    expect(status().text).toBe('Lean checked · receipt for this finite example')
    at(1300 + HOLD_MS)
    expect(status().text).toBe(bound)
    expect(card()!.phase).toBe('checked')
    // The workspace changed the walk since (the store revalidates the entry): the card says historical.
    e.current = false
    evidence.changed()
    expect(card()).toMatchObject({ phase: 'historical', current: false, text: 'Lean check: checked earlier inputs · historical receipt in Show mathematics' })
    expect(status().text).toBe(bound)
  })

  it('the next relevant state change ends the result early; failures and errors are reported honestly', () => {
    const { ui, assistant, evidence, status, card, at } = setup(docs().proof, 'proof')
    assistant.set(applied(WALK))
    const e = evidence.add(WALK)
    at(500)
    evidence.settle(e, 'not_established', 'no proof found')
    expect(status()).toMatchObject({ text: 'Not verified by Lean · no receipt for this finite example', tone: 'warning' })
    expect(card()).toMatchObject({ text: 'Lean check: not established · no receipt', tone: 'warning' })
    ui.dispatch({ kind: 'context', id: 'stage:signs' })
    expect(status().text).toMatch(/^Signed walk stays within signed bound/)
    // A manual check that fails to run: the status line says so; the answer card keeps its own entry.
    const e2 = evidence.add(WALK)
    expect(status().text).toBe('Lean checking this finite example…')
    at(900)
    evidence.settle(e2, 'error', 'HTTP 503')
    expect(status()).toMatchObject({ text: 'Lean check error (HTTP 503) · no receipt for this finite example', tone: 'error' })
    expect(card()!.entryId).toBe(e.id)
    expect(card()!.text).toBe('Lean check: not established · no receipt')
  })

  it('a receipt that existed before the proposal is never shown as this answer’s result', () => {
    const { assistant, evidence, card, status } = setup(docs().proof, 'proof')
    const old = evidence.add(WALK)
    evidence.settle(old, 'checked')
    assistant.set(applied(WALK))
    expect(card()).toMatchObject({ phase: 'requested', text: 'Lean check: requested…' })
    const mine = evidence.add(WALK)
    expect(card()).toMatchObject({ phase: 'running', entryId: mine.id })
    expect(status().text).toBe('Lean checking this finite example…')
    // A new request replaces the answer and its line.
    assistant.set({ kind: 'pending', requestId: 'r2', prompt: 'Why?', startedAt: 1 })
    expect(card()).toBeNull()
  })

  it('P/Q and order map claims use the same status line, worded by claim kind', () => {
    const pq = setup(docs().pq, 'pq')
    const pqClaim: ClaimRequest = { kind: 'same_image_witness', branch: { experimentId: 'exp-p', branchId: 'main' }, u: 's(1,0,1)', v: 's(1,0,-1)' }
    const a = pq.evidence.add(pqClaim)
    expect(pq.status().text).toBe('Lean checking this same-output pair…')
    pq.at(200)
    pq.evidence.settle(a, 'checked')
    expect(pq.status().text).toBe('Lean checked · receipt for this same-output pair')
    const order = setup(docs().order, 'order')
    const id = order.ui.displayed.experimentId
    const b = order.evidence.add({ kind: 'map_equality', left: { experimentId: id, branchId: 'left' }, right: { experimentId: id, branchId: 'right' } })
    expect(order.status().text).toBe('Lean checking this map equality…')
    order.evidence.settle(b, 'not_sent', 'another check was running')
    expect(order.status().text).toBe('Not sent to Lean (another check was running) · no receipt for this map equality')
  })

  it('review finding 1: A checking -> B not_sent (refused while A ran) -> A checked shows A\'s receipt, not the refusal', () => {
    const { evidence, status, at } = setup(docs().proof, 'proof')
    const a = evidence.add(WALK)
    at(300)
    // A second press (or a voice / Muse request_check) while A runs: a newer entry, refused locally.
    const b = evidence.add(WALK, 'computed')
    evidence.settle(b, 'not_sent', 'another check was running')
    expect(status().text).toBe('Lean checking this finite example…')
    at(1300)
    evidence.settle(a, 'checked')
    expect(status()).toMatchObject({ text: 'Lean checked · receipt for this finite example', tone: 'normal' })
    at(1300 + HOLD_MS - 10)
    expect(status().text).toBe('Lean checked · receipt for this finite example')
    at(1300 + HOLD_MS)
    expect(status().text).toMatch(/return home/)
  })

  it('review finding 1, via an answer: the card keeps its own refused entry while the status line shows the manual check that passed', () => {
    const { assistant, evidence, status, card, at } = setup(docs().proof, 'proof')
    const a = evidence.add(WALK)
    at(200)
    assistant.set(applied(WALK))
    const b = evidence.add(WALK, 'computed')
    evidence.settle(b, 'not_sent', 'another check was running')
    at(1300)
    evidence.settle(a, 'checked')
    expect(status().text).toBe('Lean checked · receipt for this finite example')
    expect(card()).toMatchObject({ phase: 'not_sent', entryId: b.id, text: 'Lean check: not sent · another check was running' })
  })

  it('review finding 2: a failed re-check while the earlier receipt is current says so, never "no receipt for this finite example"', () => {
    const { ui, evidence, status, at } = setup(docs().proof, 'proof')
    const a = evidence.add(WALK)
    at(1000)
    evidence.settle(a, 'checked')
    at(20000)
    expect(status().text).toMatch(/return home/)
    const b = evidence.add(WALK)
    at(21000)
    evidence.settle(b, 'error', 'HTTP 503')
    expect(status()).toMatchObject({ text: 'Lean check error (HTTP 503) · the earlier receipt is still current', tone: 'error' })
    // Show mathematics says the same: the earlier receipt is current.
    const lean = ui.view.presentation.detail.sections.find((x) => /Lean check/.test(x.title))
    expect(JSON.stringify(lean)).toMatch(/Current receipt/)
    // Once that receipt is historical (the walk changed), the failure says there is no receipt.
    at(40000)
    const c = evidence.add(WALK)
    a.current = false
    at(41000)
    evidence.settle(c, 'not_established', 'no proof found')
    expect(status().text).toBe('Not verified by Lean · no receipt for this finite example')
  })

  it('experiments without Lean checks keep their own status line', () => {
    const s = setup(docs().sculpture, 'sculpture')
    const before = s.status().text
    s.evidence.add(WALK)
    expect(s.status().text).toBe(before)
  })
})
