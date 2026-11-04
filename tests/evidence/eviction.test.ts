// The evidence list's bound (src/evidence/client.ts): it keeps 12 entries, dropping the 'not_sent' refusals (another
// check was running; Lean was not asked) first, oldest first, then the oldest other settled entries, and never a check
// that is still computed or checking. A burst of refusals during one slow check used to evict the running check, so
// the status line and the assistant's check line lost its result; once that check settled, the next entry evicted its
// Lean receipt while 11 refusals stayed. Part 1 drives the real EvidenceClient; part 2 presses "Check in Lean" through
// the real UiController and presenters, as the desktop and XR buttons do. The Lean route is a stubbed fetch held open
// by the test: every result is synthetic.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EvidenceClient } from '../../src/evidence/client'
import { Workspace } from '../../src/workspace/reducer'
import { UiController, type ControllerDeps } from '../../src/ui/controller'
import { PRESENTERS } from '../../src/ui/presenters'
import { assistantView } from '../../src/ui/assistant/view'
import { claimHash, parseClaimDescriptor, type ClaimRequest } from '../../src/workspace/claims'
import type { AssistantState } from '../../src/assistant/client'
import { docs, response } from '../ui/assistant/helpers'

const WALK: ClaimRequest = { kind: 'walk_reorder_instance', experimentId: 'exp-walk' }
const tick = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0))
}

/** The check route, held open: each call waits until the test settles it ('checked' echoes the claim hash). */
function heldCheckRoute() {
  const pending: ((status: 'checked' | 'not_established') => void)[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    const hash = await claimHash(parseClaimDescriptor(body.claim))
    const status = await new Promise<string>((resolve) => pending.push(resolve))
    const json = status === 'checked'
      ? { status: 'checked', claimHash: hash, receipt: { id: 'rc-synthetic' }, reason: null, statement: 's', provenance: { toolchain: 'Lean 4', theorem: 't' } }
      : { status, claimHash: hash, receipt: null, reason: 'no proof found' }
    return { ok: true, status: 200, json: async () => json }
  }))
  return pending
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('EvidenceClient: the 12-entry bound drops refusals first and never an unsettled check', () => {
  it('a running check survives 12 refusals; the oldest refusals are trimmed instead, newest first kept', async () => {
    const pending = heldCheckRoute()
    const ev = new EvidenceClient({ workspace: new Workspace(docs().proof) } as never)
    const running = ev.check(WALK)
    await tick()
    expect(ev.entries.map((e) => e.status)).toEqual(['checking'])
    for (let i = 0; i < 12; i++) await ev.check(WALK)
    expect(ev.entries).toHaveLength(12)
    expect(ev.entries.at(-1)).toMatchObject({ id: 1, status: 'checking' }) // the running check stays
    expect(ev.entries.slice(0, 11).map((e) => e.id)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3]) // refusal 2 went
    expect(ev.entries.slice(0, 11).every((e) => e.status === 'not_sent')).toBe(true)
    pending[0]!('checked')
    expect(await running).toMatchObject({ id: 1, status: 'checked' })
    expect(ev.entries.find((e) => e.id === 1)?.status).toBe('checked')
    // Settled now, its receipt outlives the refusals: the next entry evicts the oldest refusal (3), not entry 1.
    const next = ev.check(WALK)
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    expect(ev.entries).toHaveLength(12)
    expect(ev.entries[0]).toMatchObject({ id: 14, status: 'checking' })
    expect(ev.entries.map((e) => e.id)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 1])
    expect(ev.entries.at(-1)).toMatchObject({ id: 1, status: 'checked', response: { receipt: { id: 'rc-synthetic' } } })
    expect(ev.refs().map((r) => r.receiptId)).toEqual(['rc-synthetic']) // still offered to the assistant
    pending[1]!('not_established')
    await next
  })

  it('refusals go first (oldest first), then the oldest other settled entries; a running check never', async () => {
    const pending = heldCheckRoute()
    const ev = new EvidenceClient({ workspace: new Workspace(docs().proof) } as never)
    const ids = () => ev.entries.map((e) => e.id)
    /** One check answered at once with `status`. */
    const settled = async (status: 'checked' | 'not_established') => {
      const n = pending.length
      const p = ev.check(WALK)
      await vi.waitFor(() => expect(pending).toHaveLength(n + 1))
      pending[n]!(status)
      await p
    }
    await settled('checked') // 1: a Lean receipt
    await settled('not_established') // 2
    const running = ev.check(WALK) // 3: held open
    await vi.waitFor(() => expect(pending).toHaveLength(3))
    for (let i = 0; i < 10; i++) await ev.check(WALK) // refusals 4..13: the 13th entry evicts refusal 4
    expect(ids()).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 3, 2, 1])
    expect(ev.entries.slice(0, 9).every((e) => e.status === 'not_sent')).toBe(true)
    pending[2]!('checked')
    await running
    // Nine more answered checks: each evicts the oldest refusal left (5, then 6 ... 13); 1, 2 and 3 all stay.
    for (let i = 0; i < 9; i++) {
      await settled('not_established')
      expect(ev.entries).toHaveLength(12)
      expect(ids().slice(-3)).toEqual([3, 2, 1])
    }
    expect(ids()).toEqual([22, 21, 20, 19, 18, 17, 16, 15, 14, 3, 2, 1])
    expect(ev.entries.some((e) => e.status === 'not_sent')).toBe(false)
    // No refusal left: the oldest settled entry goes, whatever its result (the receipt of entry 1, then entry 2).
    await settled('not_established')
    expect(ids()).toEqual([23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 3, 2])
    await settled('not_established')
    expect(ids()).toEqual([24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 3])
  })

  it('with only settled entries the bound is the old one: the oldest goes', async () => {
    const pending = heldCheckRoute()
    const ev = new EvidenceClient({ workspace: new Workspace(docs().proof) } as never)
    for (let i = 0; i < 13; i++) {
      const p = ev.check(WALK)
      await vi.waitFor(() => expect(pending.length).toBe(i + 1))
      pending[i]!('not_established')
      await p
    }
    expect(ev.entries.map((e) => e.id)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2])
  })
})

describe('"Check in Lean" pressed again and again during one slow check (UiController + presenters)', () => {
  function setup() {
    let t = 0
    const workspace = new Workspace(docs().proof)
    let walkStage = 'why'
    const app = {
      workspace, demo: 'proof', mode: 'fiber', sceneProblem: null, scene: null,
      get walkStage() { return walkStage },
      setWalkStage: (s: string) => { walkStage = s },
      playback: { active: false, playing: false, step: null, phase: 'idle', time: 0, duration: 0 },
      snapshot: () => ({ dragging: null }), currentDescription: () => null,
      applyPresentation: vi.fn(), transact: vi.fn(), command: vi.fn(), showDemo: vi.fn(), isPreviewing: () => false,
    }
    const pending = heldCheckRoute()
    const evidence = new EvidenceClient(app as never)
    const frames: (() => void)[] = []
    const host = { presenting: false, sessionMode: null, onSession: () => () => {}, onFrame: (fn: () => void) => (frames.push(fn), () => {}), passthroughSupported: async () => false }
    const al = new Set<(s: AssistantState) => void>()
    const assistant = {
      state: { kind: 'idle' } as AssistantState, busy: false,
      subscribe: (fn: (s: AssistantState) => void) => (al.add(fn), () => al.delete(fn)),
      set(s: AssistantState) { this.state = s; al.forEach((fn) => fn(s)) },
      cancel: vi.fn(), ask: vi.fn(), retry: vi.fn(),
    }
    const voice = { state: { kind: 'idle' }, busy: false, acquiring: false, subscribe: () => () => {}, cancel: vi.fn(), toggle: vi.fn() }
    const ui = new UiController({ app, host, assistant, voice, evidence, workspace: { save: async () => '', reopen: async () => '', exportJson: () => '', importJson: () => {} }, capabilities: () => null, now: () => t } as unknown as ControllerDeps)
    ui.setPresenters(PRESENTERS)
    return {
      evidence, assistant, pending,
      press: () => ui.dispatch({ kind: 'context', id: 'check' }),
      status: () => ui.view.presentation.status.text,
      card: () => assistantView(ui.view.assistant).exchange?.check?.text ?? null,
      at: (ms: number) => { t = ms; frames.forEach((f) => f()) },
    }
  }

  it('12 refusals: the status line still shows the running check, then its result', async () => {
    const s = setup()
    s.press()
    await tick()
    for (let i = 0; i < 12; i++) {
      s.at(100 + i * 100)
      s.press()
      await tick()
    }
    expect(s.evidence.entries).toHaveLength(12)
    expect(s.status()).toBe('Lean checking this finite example…')
    s.at(3000)
    s.pending[0]!('checked')
    await tick()
    expect(s.status()).toBe('Lean checked · receipt for this finite example')
  })

  it('the answer card pinned to the proposal\'s check keeps following it through the refusals', async () => {
    const s = setup()
    const r = response('meta')
    r.proposal = { ...r.proposal, title: 'Check this example', explanation: 'A Lean check is requested.', actions: [{ kind: 'request_check', claim: WALK }] }
    s.assistant.set({ kind: 'applied', requestId: 'r1', prompt: 'Check this example', response: r, summary: ['Request a Lean check'], sceneChangeMs: 4 })
    s.press() // the proposal's check (same claim): entry 1
    await tick()
    for (let i = 0; i < 12; i++) {
      s.at(100 + i * 100)
      s.press()
      await tick()
    }
    expect(s.card()).toBe('Lean check: running…')
    s.at(3000)
    s.pending[0]!('checked')
    await tick()
    expect(s.card()).toBe('Lean check: checked · receipt in Show mathematics') // not "no longer in the evidence list"
  })
})
