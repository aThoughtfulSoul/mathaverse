// The desktop content against a FAKE DOM (tests/ui/assistant/fakeDom.ts): rendering never dispatches (opening
// the panel starts neither a request nor the microphone), the draft is mirrored and restored but sent only by
// Send/Enter, typed keys never reach scene shortcuts, the microphone keeps hold-to-talk and press-twice, and
// each state's controls emit the right UiCommand. Synthetic test states only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAssistantDomContent } from '../../../src/ui/assistant/dom'
import { HOLD_MS } from '../../../src/voice/panel'
import type { UiCommand } from '../../../src/ui/model'
import { FakeDoc, type FakeEl } from './fakeDom'
import { STATES, VOICE, docs, panelInput } from './helpers'

let t = 0
beforeEach(() => {
  t = 10_000
  vi.spyOn(performance, 'now').mockImplementation(() => t)
})
afterEach(() => vi.restoreAllMocks())

function setup(over: Parameters<typeof panelInput>[1] = {}) {
  const doc = new FakeDoc()
  const page = doc.createElement('body')
  const container = doc.createElement('div')
  page.append(container)
  const sent: UiCommand[] = []
  const shortcuts: string[] = []
  page.addEventListener('keydown', (e) => shortcuts.push(e.key ?? ''))
  const content = createAssistantDomContent((c) => sent.push(c))
  content.mount(container as unknown as HTMLElement)
  let input = panelInput(docs().sculpture, over)
  content.render(input)
  const rerender = (patch: Parameters<typeof panelInput>[1]) => {
    input = { ...input, ...patch }
    content.render(input)
  }
  const $ = (v: string) => container.find('data-assistant', v)
  const actions = () => sent.map((c) => (c.kind === 'assistant' ? c.action : c))
  return { container, content, sent, actions, shortcuts, rerender, $ }
}

describe('desktop assistant content (fake DOM)', () => {
  it('mounting and rendering dispatch nothing: no request, no microphone', () => {
    const { sent, $ } = setup()
    expect(sent).toEqual([])
    expect($('mic').getAttribute('aria-label')).toBe('Record a question for Meta Muse AI')
    expect($('question').getAttribute('aria-label')).toBe('Question for Meta Muse AI')
    expect($('question').placeholder).toBe('Ask about this experiment…')
    expect($('source').textContent).toContain('Synthetic demo')
    expect($('send').disabled).toBe(true)
  })

  it('order: source, suggestions (idle), then the input controls; with a result, the answer first and follow-ups below it', () => {
    const { container, rerender } = setup()
    const root = container.children[0]!
    const order = () => [...root.children, ...root.children.flatMap((c) => c.children)].map((c) => c.attrs['data-assistant']).filter((x) => x === 'source' || x === 'suggestions' || x === 'exchange')
    expect(order().slice(0, 2)).toEqual(['source', 'suggestions'])
    expect(root.children.at(-1)!.all('data-assistant', 'input')).toHaveLength(1)
    rerender({ assistant: STATES.answered() })
    expect(order().slice(0, 3)).toEqual(['source', 'exchange', 'suggestions'])
    expect(root.children.at(-1)!.all('data-assistant', 'input')).toHaveLength(1)
    rerender({ assistant: STATES.pending })
    expect(container.find('data-assistant', 'suggestions').hidden).toBe(true)
  })

  it('typing mirrors the draft; Send and Enter ask with the field text; keys never reach the scene shortcuts', () => {
    const { $, actions, shortcuts, rerender } = setup()
    const field = $('question')
    field.value = 'Why four moves?'
    field.dispatch('input')
    rerender({ draft: 'Why four moves?' })
    expect(actions()).toEqual([{ kind: 'draft', text: 'Why four moves?' }])
    expect($('send').disabled).toBe(false)
    for (const key of ['r', ' ', 'z', 'T']) field.dispatch('keydown', { key })
    expect(shortcuts).toEqual([])
    field.dispatch('keydown', { key: 'Enter' })
    $('send').dispatch('click')
    expect(actions().slice(1)).toEqual([{ kind: 'ask', text: 'Why four moves?' }, { kind: 'ask', text: 'Why four moves?' }])
    expect(shortcuts).toEqual([])
    // Space/Enter on a panel button stays there too.
    $('send').dispatch('keydown', { key: ' ' })
    expect(shortcuts).toEqual([])
  })

  it('the draft is restored from input.draft and cleared after it was sent; it is never sent on its own', () => {
    const { $, sent, rerender } = setup({ draft: 'kept while closed' })
    expect($('question').value).toBe('kept while closed')
    rerender({ draft: '' })
    expect($('question').value).toBe('')
    rerender({ assistant: STATES.error('network', true) })
    $('action-edit').dispatch('click')
    expect(sent.at(-1)).toEqual({ kind: 'assistant', action: { kind: 'draft', text: 'Explain this cycle' } })
    expect(sent.filter((c) => c.kind === 'assistant' && c.action.kind === 'ask')).toEqual([])
  })

  it('an upstream gateway timeout shows no Retry, only Edit (a smaller new request); a rate limit keeps Retry', () => {
    const { $, container, sent, rerender } = setup()
    rerender({ assistant: STATES.error('provider_gateway_timeout', false) })
    expect($('request-status').textContent).toContain('Timed out at Meta')
    expect(container.all('data-assistant', 'action-retry')).toHaveLength(0)
    $('action-edit').dispatch('click')
    expect(sent.at(-1)).toEqual({ kind: 'assistant', action: { kind: 'draft', text: 'Explain this cycle' } })
    expect(sent.filter((c) => c.kind === 'assistant' && (c.action.kind === 'ask' || c.action.kind === 'retry'))).toEqual([])
    rerender({ assistant: STATES.error('provider_rate_limited', true) })
    expect(container.all('data-assistant', 'action-retry')).toHaveLength(1)
    $('action-retry').dispatch('click')
    expect(sent.at(-1)).toEqual({ kind: 'assistant', action: { kind: 'retry' } })
  })

  it('a suggestion asks exactly its text and leaves the draft alone', () => {
    const { container, sent } = setup({ draft: 'my draft' })
    const first = container.all('data-assistant', 'suggestion')[0]!
    first.dispatch('click')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ kind: 'assistant', action: { kind: 'ask' } })
    expect(first.textContent.startsWith((sent[0] as { action: { text: string } }).action.text)).toBe(true)
  })

  it('microphone: a quick press starts and a second press stops; holding stops on release; keyboard toggles', () => {
    const { $, actions, rerender } = setup()
    const mic = $('mic')
    mic.dispatch('pointerdown', { button: 0, pointerId: 1 })
    t += 100
    mic.dispatch('pointerup')
    expect(actions()).toEqual([{ kind: 'voiceStart' }])
    rerender({ voice: VOICE.recording })
    expect(mic.getAttribute('aria-label')).toBe('Stop recording')
    mic.dispatch('pointerdown', { button: 0, pointerId: 1 })
    expect(actions().at(-1)).toEqual({ kind: 'voiceStop' })
    rerender({ voice: { kind: 'idle' } })
    mic.dispatch('pointerdown', { button: 0, pointerId: 2 })
    t += HOLD_MS + 50
    mic.dispatch('pointerup')
    expect(actions().slice(-2)).toEqual([{ kind: 'voiceStart' }, { kind: 'voiceStop' }])
    mic.dispatch('click', { detail: 0 })
    expect(actions().at(-1)).toEqual({ kind: 'voiceStart' })
  })

  it('recording shows Cancel; transcribing turns the microphone into Cancel', () => {
    const { $, actions, rerender } = setup({ voice: VOICE.recording })
    expect($('record-cancel').shown).toBe(true)
    $('record-cancel').dispatch('click')
    expect(actions().at(-1)).toEqual({ kind: 'voiceCancel' })
    rerender({ voice: VOICE.transcribing })
    expect($('record-cancel').shown).toBe(false)
    expect($('mic').getAttribute('aria-label')).toBe('Cancel')
    $('mic').dispatch('pointerdown', { button: 0 })
    expect(actions().at(-1)).toEqual({ kind: 'voiceCancel' })
    expect($('voice-status').textContent).toMatch(/^Transcribing/)
  })

  it('transcript ready: an editable correction field with Send replaces the question field', () => {
    const { container, $, actions, rerender } = setup({ draft: 'unsent' })
    rerender({ voice: VOICE.transcriptDesktop })
    expect($('input').shown).toBe(false)
    const area = container.all('data-assistant', 'transcript')[0]!
    expect(area.shown).toBe(true)
    const text = area.children.find((c) => c.tagName === 'TEXTAREA')!
    expect(text.value).toBe('apply it again')
    text.value = 'apply it twice'
    text.dispatch('input')
    expect(actions().at(-1)).toEqual({ kind: 'transcriptEdit', text: 'apply it twice' })
    rerender({ voice: { ...VOICE.transcriptDesktop, text: 'apply it twice' } })
    expect(text.value).toBe('apply it twice')
    text.dispatch('keydown', { key: 'Enter' })
    expect(actions().at(-1)).toEqual({ kind: 'transcriptSubmit', text: 'apply it twice' })
    rerender({ voice: VOICE.submitted, assistant: { ...STATES.pending, prompt: 'apply it twice' } })
    expect($('input').shown).toBe(true)
    expect($('question').value).toBe('unsent')
  })

  it('pending shows the actual question and Cancel; a synthetic answer is labelled beside it', () => {
    const { $, actions, rerender } = setup({ assistant: STATES.pending })
    expect($('exchange').textContent).toContain('Thinking…')
    expect($('exchange').textContent).toContain(STATES.pending.prompt)
    $('action-cancel').dispatch('click')
    expect(actions().at(-1)).toEqual({ kind: 'cancel' })
    rerender({ assistant: STATES.applied('synthetic') })
    expect($('provenance').textContent).toContain('Synthetic demo · not a live Meta response')
    expect($('exchange').textContent).toContain('Applied +1 to exp-c4')
  })

  it('dispose removes the content and its listeners', () => {
    const { container, content } = setup()
    content.dispose()
    expect(container.children).toEqual([] as FakeEl[])
  })
})
