// The answer card's Lean check line in the desktop panel (fake DOM) and the XR layout, the empty orb slot in
// the desktop frame header, and the XR Talk hint (hold A or X). Synthetic states and evidence items only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAssistantDomContent } from '../../../src/ui/assistant/dom'
import { HOLD_HINT_XR, TALK_HINT_XR, XR_RECORDING_STATUS, assistantView } from '../../../src/ui/assistant/view'
import { PANEL, layoutSpatial } from '../../../src/ui/assistant/spatialLayout'
import type { AssistantState } from '../../../src/assistant/client'
import type { ClaimRequest } from '../../../src/workspace/claims'
import type { AnswerCheckLink, AssistantPanelInput, EvidenceItem } from '../../../src/ui/model'
import { FakeDoc, type FakeEl } from './fakeDom'
import { docs, panelInput, response } from './helpers'

beforeEach(() => {
  vi.spyOn(performance, 'now').mockImplementation(() => 10_000)
})
afterEach(() => vi.restoreAllMocks())

const WALK: ClaimRequest = { kind: 'walk_reorder_instance', experimentId: 'exp-walk' }
const LINK: AnswerCheckLink = { requestId: 'r1', afterId: 0, entryId: null }

function applied(): AssistantState {
  const r = response('meta')
  r.proposal = { ...r.proposal, title: 'Check this example', explanation: 'A Lean check of this finite example is requested.', actions: [{ kind: 'request_check', claim: WALK }] }
  return { kind: 'applied', requestId: 'r1', prompt: 'Check this example', response: r, summary: ['Request a Lean check'], sceneChangeMs: 4 }
}

const entry = (status: EvidenceItem['status'], current = true): EvidenceItem => ({
  id: 1, claim: WALK, label: 'this 6-arrow walk', status, current, holds: true, statement: null,
  provenance: status === 'checked' ? 'Lean 4 · walkReorder · receipt rc-1' : null, message: status === 'error' ? 'HTTP 503' : null,
})

const input = (over: Partial<AssistantPanelInput> = {}) => panelInput(docs().proof, { assistant: applied(), checkLink: LINK, evidence: [], ...over })

/** The shell's inspector frame (src/ui/shell/desktop.ts): card > head > [title, close], body > slot. */
function frame() {
  const doc = new FakeDoc()
  const card = doc.createElement('section')
  card.className = 'mw-insp-card'
  const head = doc.createElement('div')
  head.className = 'mw-insp-head'
  const title = doc.createElement('h2')
  title.className = 'mw-insp-title'
  title.textContent = 'Ask Meta Muse AI'
  const close = doc.createElement('button')
  close.className = 'mw-insp-close'
  head.append(title, close)
  const body = doc.createElement('div')
  body.className = 'mw-insp-body'
  const slot = doc.createElement('div')
  slot.className = 'mw-assistant-slot'
  body.append(slot)
  card.append(head, body)
  return { doc, card, head, title, slot }
}

describe('answer card check line (desktop)', () => {
  it('requested, running, checked, historical, not established and error, updated in place under the changes', () => {
    const { slot } = frame()
    const content = createAssistantDomContent(() => {})
    content.mount(slot as unknown as HTMLElement)
    content.render(input())
    const $ = (v: string) => slot.find('data-assistant', v)
    const line = $('check-status')
    expect(line.textContent).toBe('Lean check: requested…')
    const ex = $('exchange').children
    const changes = ex.findIndex((c) => c.className === 'mwa-changes')
    expect(changes).toBeGreaterThanOrEqual(0)
    expect(ex[changes + 1]).toBe(line)
    const shown: [string, string | null][] = []
    for (const evidence of [[entry('checking')], [entry('checked')], [entry('checked', false)], [entry('not_established')], [entry('error')]]) {
      content.render(input({ evidence }))
      expect($('check-status')).toBe(line) // the same element: the answer is not rebuilt or scrolled
      shown.push([line.textContent, line.getAttribute('data-tone')])
    }
    expect(shown).toEqual([
      ['Lean check: running…', 'busy'],
      ['Lean check: checked · receipt in Show mathematics', 'ok'],
      ['Lean check: checked earlier inputs · historical receipt in Show mathematics', 'warning'],
      ['Lean check: not established · no receipt', 'warning'],
      ['Lean check: error · no receipt (HTTP 503)', 'error'],
    ])
    content.render(input({ evidence: [entry('checked', false)] }))
    expect(line.getAttribute('data-current')).toBe('false')
  })

  it('no check line for an answer without request_check, and none in a stale proposal', () => {
    const { slot } = frame()
    const content = createAssistantDomContent(() => {})
    content.mount(slot as unknown as HTMLElement)
    const plain = response('meta', 1)
    content.render(input({ assistant: { kind: 'applied', requestId: 'r1', prompt: 'Apply it', response: plain, summary: ['Applied'], sceneChangeMs: 3 }, evidence: [entry('checked')] }))
    expect(slot.all('data-assistant', 'check-status')).toHaveLength(0)
    const a = applied() as Extract<AssistantState, { kind: 'applied' }>
    content.render(input({ assistant: { kind: 'stale', requestId: 'r1', prompt: a.prompt, response: a.response, reason: 'the workspace changed while the request was running' }, evidence: [entry('checked')] }))
    expect(slot.all('data-assistant', 'check-status')).toHaveLength(0)
  })
})

describe('orb slot (desktop header)', () => {
  it('one empty span immediately before the title text, with no content in any state', () => {
    const { head, title, slot } = frame()
    const content = createAssistantDomContent(() => {})
    content.mount(slot as unknown as HTMLElement)
    const orb = head.children[0]!
    expect(head.children[1]).toBe(title)
    expect(orb.tagName).toBe('SPAN')
    expect(orb.className).toBe('mwa-orb-slot')
    expect(orb.attrs).toEqual({ 'data-assistant': 'orb-slot', 'aria-hidden': 'true' })
    const empty = (el: FakeEl) => el.children.length === 0 && el.textContent === '' && el.innerHTML === ''
    expect(empty(orb)).toBe(true)
    for (const over of [{}, { evidence: [entry('checked')] }, { assistant: { kind: 'idle' } as AssistantState }]) {
      content.render(input(over))
      expect(empty(orb)).toBe(true)
    }
    expect(head.all('data-assistant', 'orb-slot')).toHaveLength(1)
    expect(slot.all('data-assistant', 'orb-slot')).toHaveLength(0)
    expect(title.textContent).toBe('Ask Meta Muse AI')
    // 40 x 40, inline-flex, flex none; hidden when the frame shows Show mathematics instead.
    const css = slot.children[0]!.children[0]!.textContent
    expect(css).toMatch(/\.mwa-orb-slot \{ display: inline-flex; flex: none; width: 40px; height: 40px;/)
    expect(css).toContain('.mw-insp-card[data-mode="math"] .mwa-orb-slot { display: none; }')
    // Re-mounting or disposing never leaves a second slot behind.
    content.mount(slot as unknown as HTMLElement)
    expect(head.all('data-assistant', 'orb-slot')).toHaveLength(1)
    content.dispose()
    expect(head.all('data-assistant', 'orb-slot')).toHaveLength(0)
    expect(head.children.map((c) => c.className)).toEqual(['mw-insp-title', 'mw-insp-close'])
  })

  it('outside the shell frame the slot is at the top of the content', () => {
    const doc = new FakeDoc()
    const container = doc.createElement('div')
    const content = createAssistantDomContent(() => {})
    content.mount(container as unknown as HTMLElement)
    expect(container.all('data-assistant', 'orb-slot')).toHaveLength(1)
    expect(container.children[0]!.children[1]!.attrs['data-assistant']).toBe('orb-slot')
  })
})

describe('XR', () => {
  const measure = (t: string, em: number) => t.length * em * 0.5
  const xr = (over: Partial<AssistantPanelInput> = {}) => assistantView(input({ surface: 'xr', ...over }))

  it('the answer card shows the same check line in the XR layout', () => {
    for (const [evidence, text] of [[[], 'Lean check: requested…'], [[entry('checking')], 'Lean check: running…'], [[entry('checked')], 'Lean check: checked · receipt in Show mathematics']] as const) {
      const l = layoutSpatial(xr({ evidence: [...evidence] }), 0, measure)
      expect(l.lines.map((x) => x.text).join(' ')).toContain(text)
      for (const t of l.lines) expect(t.x + measure(t.text, t.em)).toBeLessThanOrEqual(PANEL.width + 1e-9)
    }
  })

  it('Talk mentions holding A or X; the beside-line fits on the Talk row inside the panel', () => {
    const v = xr({ assistant: { kind: 'idle' }, checkLink: null })
    expect(v.voice.talk.label).toBe('Talk')
    expect(v.voice.talk.hint).toBe(TALK_HINT_XR)
    expect(v.voice.talk.hint).toMatch(/hold A or X/i)
    expect(v.voice.holdHint).toBe(HOLD_HINT_XR)
    const l = layoutSpatial(v, 0, measure)
    const talk = l.buttons.find((b) => b.id === 'talk')!
    expect(talk.hint).toBe(TALK_HINT_XR)
    const hint = l.lines.find((t) => t.text === HOLD_HINT_XR)!
    expect(hint).toBeDefined()
    expect(Math.abs(hint.y - (talk.y + talk.h / 2))).toBeLessThan(1e-9)
    expect(hint.x).toBeGreaterThan(talk.x + talk.w)
    expect(hint.x + measure(hint.text, hint.em)).toBeLessThanOrEqual(PANEL.width - PANEL.pad + 1e-9)
    // Not while recording (Stop) or on the desktop.
    expect(xr({ voice: { kind: 'recording', startedAt: 1 } }).voice.holdHint).toBeNull()
    expect(assistantView(input()).voice.holdHint).toBeNull()
  })

  it('recording in XR: the status says Stop or release A/X, and fits inside the panel uncut', () => {
    const rec = xr({ voice: { kind: 'recording', startedAt: 1 } })
    expect(rec.voice.phase).toBe('recording')
    expect(rec.voice.status).toBe(XR_RECORDING_STATUS)
    expect(XR_RECORDING_STATUS).toBe('Listening… press Stop or release A/X when you are done')
    // The desktop wording is unchanged.
    expect(assistantView(input({ voice: { kind: 'recording', startedAt: 1 } })).voice.status).toBe('Listening… release, or press Stop, when you are done')
    // Drawn where the layout shows voice.status (no start time): whole, within the panel's two status lines.
    const l = layoutSpatial({ ...rec, voice: { ...rec.voice, recordingStartedAt: null } }, 0, measure)
    const drawn = l.lines.filter((t) => !t.onPlate && XR_RECORDING_STATUS.includes(t.text))
    expect(drawn.map((t) => t.text).join(' ')).toBe(XR_RECORDING_STATUS)
    for (const t of l.lines) {
      expect(t.x + measure(t.text, t.em)).toBeLessThanOrEqual(PANEL.width + 1e-9)
      expect(t.y).toBeGreaterThan(0)
      expect(t.y).toBeLessThan(PANEL.height)
    }
    for (const b of l.buttons) expect(b.y + b.h).toBeLessThanOrEqual(PANEL.height + 1e-9)
    // With the elapsed time (the layout's own recording line) everything still stays inside the panel.
    const timed = layoutSpatial(rec, 4200, measure)
    for (const t of timed.lines) expect(t.x + measure(t.text, t.em)).toBeLessThanOrEqual(PANEL.width + 1e-9)
  })
})
