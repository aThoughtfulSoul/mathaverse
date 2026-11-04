// The desktop voice panel against a minimal FAKE DOM (no DOM library is installed; the browser check of
// the wired panel is the coordinator's). Covers hold-to-talk vs press/press-again, the correction field
// (Enter sends, keys never reach scene shortcuts), Cancel, unavailable and dispose. Synthetic replies.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoiceClient } from '../../src/voice/client'
import { HOLD_MS, mountVoicePanel } from '../../src/voice/panel'
import { FakeRecorder, META_CAPABILITY, controlledFetch, fakeMedia, flush } from './fakes'

type Listener = (e: FakeEvent) => void
interface FakeEvent {
  type: string
  key?: string
  shiftKey?: boolean
  button?: number
  detail?: number
  pointerId?: number
  defaultPrevented: boolean
  propagationStopped: boolean
  preventDefault(): void
  stopPropagation(): void
}

class FakeEl {
  children: FakeEl[] = []
  parent: FakeEl | null = null
  className = ''
  textContent = ''
  hidden = false
  disabled = false
  value = ''
  rows = 0
  style: Record<string, string> = {}
  attrs: Record<string, string> = {}
  listeners: Record<string, Listener[]> = {}
  constructor(readonly tagName: string, readonly ownerDocument: FakeDoc) {}
  classList = {
    toggle: (c: string, force?: boolean) => {
      const set = new Set(this.className.split(/\s+/).filter(Boolean))
      const on = force ?? !set.has(c)
      if (on) set.add(c)
      else set.delete(c)
      this.className = [...set].join(' ')
    },
    contains: (c: string) => this.className.split(/\s+/).includes(c),
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null
  }
  append(...cs: FakeEl[]) {
    for (const c of cs) {
      c.parent = this
      this.children.push(c)
    }
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this)
    this.parent = null
  }
  addEventListener(t: string, fn: Listener) {
    ;(this.listeners[t] ??= []).push(fn)
  }
  setPointerCapture() {}
  dispatch(type: string, init: Partial<FakeEvent> = {}): FakeEvent {
    const e: FakeEvent = { type, defaultPrevented: false, propagationStopped: false, preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.propagationStopped = true }, ...init }
    for (const fn of this.listeners[type] ?? []) fn(e)
    return e
  }
  find(role: string): FakeEl {
    const walk = (n: FakeEl): FakeEl | null => (n.attrs['data-voice'] === role ? n : n.children.map(walk).find(Boolean) ?? null)
    const hit = walk(this)
    if (!hit) throw new Error(`no ${role}`)
    return hit
  }
}
class FakeDoc {
  createElement(tag: string) {
    return new FakeEl(tag, this)
  }
}

let t = 0
beforeEach(() => {
  t = 10_000
  vi.spyOn(performance, 'now').mockImplementation(() => t)
  FakeRecorder.instances = []
  FakeRecorder.supported = new Set(['audio/webm;codecs=opus'])
})
afterEach(() => vi.restoreAllMocks())

function setup() {
  const doc = new FakeDoc()
  const root = doc.createElement('div')
  const net = controlledFetch()
  const submitted: string[] = []
  const client = new VoiceClient({ submit: (x) => submitted.push(x), fetch: net.fetchImpl, getUserMedia: fakeMedia().getUserMedia, Recorder: FakeRecorder as unknown as typeof MediaRecorder })
  client.setCapability(META_CAPABILITY)
  const dispose = mountVoicePanel(root as unknown as HTMLElement, client)
  const $ = (r: string) => root.find(r)
  return { root, client, net, submitted, dispose, $ }
}

describe('voice panel (fake DOM)', () => {
  it('mounts one HUD card with its own scoped style', () => {
    const { root, $ } = setup()
    expect(root.children).toHaveLength(1)
    expect(root.children[0]!.className).toBe('card mw-voice')
    expect(root.children[0]!.children[0]!.tagName).toBe('style')
    expect($('record').disabled).toBe(false)
    expect($('cancel').disabled).toBe(true)
    expect($('edit').hidden).toBe(true)
    expect($('mode').textContent).toBe('Meta speech-to-text muse-voice-transcribe-1.0 · live call unverified')
    expect($('status').textContent).toMatch(/Hold Record/)
  })

  it('a quick press keeps recording; pressing again stops and transcribes', async () => {
    const { $, client, net } = setup()
    $('record').dispatch('pointerdown', { button: 0, pointerId: 1 })
    await flush()
    t += 100
    $('record').dispatch('pointerup')
    expect(client.state.kind).toBe('recording')
    expect($('record').textContent).toBe('Stop')
    expect($('record').classList.contains('on')).toBe(true)
    t += 1500
    $('record').dispatch('pointerdown', { button: 0, pointerId: 1 })
    expect(client.state.kind).toBe('transcribing')
    expect($('record').disabled).toBe(true)
    expect($('cancel').disabled).toBe(false)
    await flush()
    net.reply('Reverse the order on the left')
    await flush()
    expect($('edit').hidden).toBe(false)
    expect($('text').value).toBe('Reverse the order on the left')
    expect($('source').textContent).toMatch(/^Meta speech-to-text transcription \(muse-voice-transcribe-1\.0\) · \d+ ms after release$/)
  })

  it('holding Record records until release', async () => {
    const { $, client } = setup()
    $('record').dispatch('pointerdown', { button: 0, pointerId: 1 })
    await flush()
    t += HOLD_MS + 900
    $('record').dispatch('pointerup')
    expect(client.state.kind).toBe('transcribing')
  })

  it('the correction field: keys stay out of scene shortcuts, Enter sends the edited text, Shift+Enter does not', async () => {
    const { $, client, net, submitted } = setup()
    $('record').dispatch('pointerdown', { button: 0, pointerId: 1 })
    await flush()
    t += HOLD_MS + 900
    $('record').dispatch('pointerup')
    await flush()
    net.reply('Reverse the order on the lift')
    await flush()
    const text = $('text')
    text.value = 'Reverse the order on the left'
    text.dispatch('input')
    const z = text.dispatch('keydown', { key: 'z' })
    expect(z.propagationStopped).toBe(true)
    const shift = text.dispatch('keydown', { key: 'Enter', shiftKey: true })
    expect(shift.defaultPrevented).toBe(false)
    expect(submitted).toEqual([])
    const enter = text.dispatch('keydown', { key: 'Enter' })
    expect(enter.propagationStopped).toBe(true)
    expect(enter.defaultPrevented).toBe(true)
    expect(submitted).toEqual(['Reverse the order on the left'])
    expect(client.state.kind).toBe('submitted')
    expect($('status').textContent).toContain('Sent as your request')
  })

  it('Cancel and Escape cancel; Space on a panel button does not reach the scene', async () => {
    const { $, client, net } = setup()
    $('record').dispatch('pointerdown', { button: 0, pointerId: 1 })
    await flush()
    $('cancel').dispatch('click')
    expect(client.state.kind).toBe('canceled')
    expect($('status').textContent).toBe('Canceled; nothing was sent.')
    expect(net.calls).toHaveLength(0)
    expect($('record').dispatch('keydown', { key: ' ' }).propagationStopped).toBe(true)
    // Keyboard activation (click with detail 0) toggles.
    $('record').dispatch('click', { detail: 0 })
    await flush()
    expect(client.state.kind).toBe('recording')
    t += 1000
    $('record').dispatch('click', { detail: 0 })
    await flush()
    net.reply('hello')
    await flush()
    $('text').dispatch('keydown', { key: 'Escape' })
    expect(client.state.kind).toBe('canceled')
  })

  it('unavailable: Record is disabled and typing is suggested', () => {
    const { $, client } = setup()
    client.setCapability({ ...META_CAPABILITY, mode: 'unavailable', configured: false, acceptedMimeTypes: [], problem: 'no Meta API key is configured' })
    expect($('record').disabled).toBe(true)
    expect($('mode').textContent).toBe('speech unavailable')
    expect($('status').textContent).toBe('Speech unavailable: no Meta API key is configured. Type the request in Ask instead.')
    expect($('status').className).toContain('err')
  })

  it('dispose removes the card and stops rendering', async () => {
    const { root, dispose, client } = setup()
    dispose()
    expect(root.children).toHaveLength(0)
    await client.start() // no render into a removed panel throws
  })
})
