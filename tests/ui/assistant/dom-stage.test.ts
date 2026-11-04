// The orb's stage in the desktop assistant content (FAKE DOM, tests/ui/assistant/fakeDom.ts, with a layout model of
// the panel's body patched onto the elements that are measured): one empty aria-hidden slot in the voice area,
// directly above the input rows. When the suggestions on screen give way (a recording, a typed question), the stage
// takes exactly the room they leave and keeps absorbing what else changes, so the microphone (Stop, Send) and the
// answer above never move, in a body that scrolls or not, with or without an orb. Once the question is sent the stage
// keeps at least 120 px in a body that does not scroll: the rows move once, eased, and the stage has that room from
// the first frame. With no new exchange the suggestions wait while the orb is on the stage or flying home and take the
// room back when it lands (what they do not fill exactly eases), a canceled request included; a new answer shows at once.
// The model follows the content's CSS: the order of the blocks, where the voice status sits (data-voice), the
// stage's room and the parts the pinned rows cover and the body scrolled away (--mwa-stage-room, --mwa-stage-cut,
// --mwa-stage-top), the middle's hidden part
// (max-height), sticky rows in a body that scrolls (with the shell slot's padding under the content), and the
// browser clamping the body's scroll position on a layout read. With `frames`, a fake window runs the content's own
// animation frames on a clock the test advances. Synthetic states only.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAssistantDomContent } from '../../../src/ui/assistant/dom'
import type { AssistantState } from '../../../src/assistant/client'
import { FakeDoc, type FakeEl } from './fakeDom'
import { STATES, VOICE, docs, panelInput } from './helpers'
import { EDIT_WITH_DRAFT } from '../../../src/ui/assistant/view'

beforeEach(() => void vi.spyOn(performance, 'now').mockImplementation(() => 10_000))
const live: { dispose(): void }[] = []
afterEach(() => {
  for (const c of live.splice(0)) c.dispose()
  vi.restoreAllMocks()
})

const GAP = 14
const BODY_TOP = 100
const SOURCE_H = 120
const ROWS_PAD_TOP = 8
const ROWS_PAD = 18
const ROW_GAP = 8
const INPUT_H = 42
const VOICE_H = 36
/** A voice status long enough to wrap (a too-short recording's advice) makes its row this tall. */
const VOICE_H_LONG = 54
const TRANSCRIPT_H = 100
/** The least room once the question is sent, and how long the content's own moves take (src/ui/assistant/dom.ts). */
const STAGE_MIN = 120
const EASE_MS = 400
/** Heights of the parts of an exchange, by class (padding and border: 13 px; 8 px between parts). */
const PART: Record<string, number> = {
  'mwa-head': 20, 'mwa-q': 19, 'mwa-small': 18, 'mwa-title': 22, 'mwa-expl': 120, 'mwa-facts': 80, 'mwa-changes': 40,
  'mwa-check': 30, 'mwa-prov': 28, 'mwa-actions': 33,
}

/** Distinct requests (helpers.ts uses one requestId for every state). */
const answer = (requestId: string) => ({ ...STATES.applied(), requestId }) as AssistantState
const pending = (requestId: string) => ({ ...STATES.pending, requestId }) as AssistantState
const canceled = (requestId: string) => ({ ...STATES.canceled, requestId }) as AssistantState
/** A rejected synthetic proposal: Edit question is its only action. */
const rejected = (requestId: string) => ({ ...STATES.rejected('synthetic'), requestId }) as AssistantState
/** The voice client's too-short error, word for word (its status wraps). */
const tooShort = { kind: 'error', code: 'too_short', message: 'That recording was too short. Hold Talk while you speak, or press it once to start and again to stop.' } as const

function fakeStyle() {
  const props: Record<string, string> = {}
  return {
    props,
    setProperty: (k: string, v: string) => void (props[k] = v),
    removeProperty: (k: string) => void delete props[k],
    getPropertyValue: (k: string) => props[k] ?? '',
  }
}

interface RigOptions {
  /** The body's visible height (the panel's scrollport). */
  bodyH?: number
  narrow?: boolean
  /** The suggestions block's height (default: from the number of suggestions shown). */
  suggH?: number
  /** The source block's height (default 120; 84.4 in the wide panel at 1600 x 1000). */
  sourceH?: number
  /** The shell slot's padding under the content, inside the scrolling body (22 px in the app). */
  pad?: number
  assistant?: AssistantState
  /** A window with animation frames on a test clock (and its reduced-motion preference). */
  frames?: boolean | 'reduced'
}

function rig(o: RigOptions = {}) {
  const doc = new FakeDoc()
  let now = 10_000
  const queued = new Map<number, (t: number) => void>()
  let nextId = 1
  if (o.frames) {
    Object.assign(doc, {
      defaultView: {
        requestAnimationFrame: (cb: (t: number) => void) => (queued.set(nextId, cb), nextId++),
        cancelAnimationFrame: (id: number) => void queued.delete(id),
        performance: { now: () => now },
        matchMedia: () => ({ matches: o.frames === 'reduced' }),
      },
    })
  }
  const shell = doc.createElement('div')
  shell.className = 'mw-shell'
  if (o.narrow) shell.setAttribute('data-narrow', '')
  const body = doc.createElement('div')
  body.className = 'mw-insp-body'
  const container = doc.createElement('div')
  shell.append(body)
  body.append(container)
  const content = createAssistantDomContent(() => {})
  live.push(content)
  content.mount(container as unknown as HTMLElement)
  const root = container.find('data-assistant', 'content')
  const byClass = (cls: string) => {
    const walk = (n: FakeEl): FakeEl | null => (n.className === cls ? n : n.children.map(walk).find(Boolean) ?? null)
    return walk(root)!
  }
  const css = root.children[0]!.textContent
  const source = byClass('mwa-source')
  const mid = byClass('mwa-mid')
  const foot = byClass('mwa-foot')
  const rows = byClass('mwa-foot-rows')
  const voiceRow = byClass('mwa-voicerow')
  const transcript = byClass('mwa-transcript')
  const inputRow = container.find('data-assistant', 'input')
  const stage = container.find('data-assistant', 'orb-stage')
  const sugg = container.find('data-assistant', 'suggestions')
  const exchange = container.find('data-assistant', 'exchange')
  const stageStyle = fakeStyle()
  const midStyle = fakeStyle()
  Object.assign(stage, { style: stageStyle })
  Object.assign(mid, { style: midStyle })
  Object.assign(root, { style: fakeStyle() })
  const bodyH = o.bodyH ?? 2000
  const pad = o.pad ?? 0
  const SOURCE = o.sourceH ?? SOURCE_H
  let scrollTop = 0

  // ---- the CSS the model follows
  const order = (cls: string) => Number(new RegExp(`\\.${cls} \\{ order: (\\d+);`).exec(css)?.[1] ?? '0')
  const voiceAbove = () =>
    (root.getAttribute('data-voice') === 'above' && css.includes('.mwa[data-voice="above"] .mwa-foot-rows > .mwa-voicerow { order: 0; }')) ||
    (!!o.narrow && css.includes('.mw-shell[data-narrow] .mwa-foot-rows > .mwa-voicerow { order: 0; }'))
  const px = (k: string) => {
    const v = parseFloat(stageStyle.props[k] ?? '')
    return Number.isFinite(v) ? v : null
  }
  // The drawer as it was: the foot is the pinned block, the open stage an 84 px column beside the rows, and the
  // content held at --mwa-hold with the foot pushed to its bottom.
  const columnDrawer = !!o.narrow && css.includes('.mw-shell[data-narrow] .mwa-foot { order: 3; display: flex;')
  const column = () => (columnDrawer && stage.getAttribute('data-open') !== null ? 84 : 0)
  function stageGeo(): { mt: number; h: number; mb: number } {
    if (css.includes('.mwa-orb-stage[data-room="on"]')) {
      if (stage.getAttribute('data-room') === 'on') {
        const r = px('--mwa-stage-room') ?? 0
        const c = px('--mwa-stage-cut') ?? 0
        const tp = px('--mwa-stage-top') ?? 0
        return { mt: Math.min(0, r) + tp, h: Math.max(0, r - c - tp), mb: c }
      }
    } else if (stage.getAttribute('data-open') !== null) return { mt: 0, h: px('--mwa-stage-room') ?? 158, mb: 0 }
    return { mt: -GAP, h: 0, mb: 0 }
  }
  const exchangeH = () => {
    const parts = exchange.children.map((c) => PART[c.className.split(' ')[0]!] ?? 18)
    return parts.length ? 13 + parts.reduce((a, b) => a + b, 0) + 8 * (parts.length - 1) : 0
  }
  const suggestionsH = () => {
    if (sugg.hidden) return 0
    if (o.suggH !== undefined) return o.suggH
    const n = sugg.all('data-assistant', 'suggestion').length
    const hint = sugg.find('data-assistant', 'suggestion-hint').hidden ? 0 : 20
    return root.getAttribute('data-layout') === 'after' ? 35 + 39 * n + hint : 26 + 44 * n + hint
  }
  const midParts = () => mid.children.map((c) => (c === sugg ? suggestionsH() : exchangeH())).filter((h) => h > 0)
  const rowSeq = () => (voiceAbove() ? [voiceRow, transcript, inputRow] : [transcript, inputRow, voiceRow]).filter((e) => !e.hidden)
  const voiceText = () => byClass('mwa-voice').textContent
  const rowH = (e: FakeEl) => (e === voiceRow ? (voiceText().length > 80 ? VOICE_H_LONG : VOICE_H) : e === transcript ? TRANSCRIPT_H : INPUT_H)
  const innerRows = () => {
    const s = rowSeq()
    return s.reduce((a, b) => a + rowH(b), 0) + ROW_GAP * Math.max(0, s.length - 1)
  }
  /** The middle's content height, and its height as laid out (its max-height while part of it is hidden). */
  const midNatural = () => {
    const p = midParts()
    return p.reduce((a, b) => a + b, 0) + GAP * Math.max(0, p.length - 1)
  }
  const heightOf = (e: FakeEl) => {
    if (e === source) return SOURCE
    if (e === mid) {
      const cap = parseFloat(midStyle.props['max-height'] ?? '')
      return Number.isFinite(cap) ? Math.min(midNatural(), cap) : midNatural()
    }
    return ROWS_PAD + Math.max(innerRows(), column())
  }

  /** The body's layout now (content coordinates: 0 is the content's top). */
  function lay() {
    const items = ([[order('mwa-source'), source], [order('mwa-mid'), mid], [order('mwa-orb-stage'), stage], [order('mwa-foot-rows'), rows]] as const)
      .slice()
      .sort((a, b) => a[0] - b[0])
      .map((x) => x[1])
    const top = new Map<FakeEl, number>()
    let stageBox = { top: 0, h: 0 }
    let y = 0
    let first = true
    for (const el of items) {
      if (el.hidden || (el === stage && columnDrawer)) continue
      if (!first) y += GAP
      first = false
      if (el === stage) {
        const g = stageGeo()
        y += g.mt
        stageBox = { top: y, h: g.h }
        y += g.h + g.mb
        continue
      }
      top.set(el, y)
      y += heightOf(el)
    }
    const rowsH = heightOf(rows)
    const hold = parseFloat((root as unknown as { style: ReturnType<typeof fakeStyle> }).style.props['--mwa-hold'] ?? '')
    if (columnDrawer && root.getAttribute('data-hold') === 'on' && hold > y) {
      top.set(rows, hold - rowsH)
      y = hold
    }
    const rowsFlow = top.get(rows)!
    // Sticky to the body's bottom: never drawn below its visible part.
    const rowsDrawn = Math.min(rowsFlow, scrollTop + bodyH - rowsH)
    let inputTop: number | null = null
    let off = ROWS_PAD_TOP + Math.max(0, column() - innerRows()) // the rows are bottom-aligned beside a column
    if (column()) stageBox = { top: rowsDrawn + ROWS_PAD_TOP, h: column() }
    for (const e of rowSeq()) {
      if (e === inputRow) inputTop = rowsDrawn + off
      off += rowH(e) + ROW_GAP
    }
    const midTop = top.get(mid) ?? null
    const suggH = suggestionsH()
    const exH = exchangeH()
    const exTop = exH && midTop !== null ? midTop + (mid.children[0] === sugg && suggH ? suggH + GAP : 0) : null
    return { contentH: y, rowsH, rowsFlow, rowsDrawn, inputTop, exTop, exH, suggH, stageBox, midTop, midH: heightOf(mid) }
  }
  const vp = (y: number) => BODY_TOP + y - scrollTop
  type Box = { top: number; height: number; bottom: number; width: number }
  const boxOf = (e: FakeEl) => (e as unknown as { getBoundingClientRect(): Box }).getBoundingClientRect()
  const rect = (topY: number, height: number, width = 338) => ({ top: topY, height, bottom: topY + height, left: 1213, width, right: 1213 + width })
  const scrollMax = () => Math.max(0, Math.ceil(lay().contentH + pad) - bodyH)
  /** A layout read: the browser clamps the scroll position to what the content now allows. */
  const laid = () => {
    scrollTop = Math.min(scrollTop, scrollMax())
    return lay()
  }
  Object.assign(root, { getBoundingClientRect: () => rect(vp(0), laid().contentH) })
  Object.assign(rows, { getBoundingClientRect: () => { const l = laid(); return rect(vp(l.rowsDrawn), l.rowsH) } })
  Object.assign(source, { getBoundingClientRect: () => (laid(), rect(vp(0), SOURCE)) })
  Object.assign(mid, { getBoundingClientRect: () => { const l = laid(); return l.midTop === null ? rect(0, 0, 0) : rect(vp(l.midTop), l.midH) } })
  Object.defineProperty(mid, 'scrollHeight', { get: () => midNatural() })
  Object.assign(stage, { getBoundingClientRect: () => { const l = laid(); return rect(vp(l.stageBox.top), l.stageBox.h, column() || (o.narrow ? 760 : 338)) } })
  Object.assign(body, { getBoundingClientRect: () => rect(BODY_TOP, bodyH) })
  Object.defineProperty(body, 'scrollHeight', { get: () => (laid(), Math.ceil(lay().contentH + pad)) })
  Object.defineProperty(body, 'clientHeight', { get: () => bodyH })
  Object.defineProperty(body, 'scrollTop', { get: () => scrollTop, set: (y: number) => void (scrollTop = Math.max(0, Math.min(y, scrollMax()))) })

  let input = panelInput(docs().pq, o.assistant ? { assistant: o.assistant } : {})
  content.render(input)
  const set = (patch: Partial<typeof input>) => {
    input = { ...input, ...patch }
    content.render(input)
  }
  /** The orb on the stage (data-open), flying home (data-leaving), landed; the content lays out again each time. */
  const orb = {
    /** As DesktopOrb.openStage: it opens the stage, and keeps it only when the box has room for it. */
    tryOpen() {
      stage.setAttribute('data-open', '')
      const b = boxOf(stage)
      if (!(Math.min(b.width, b.height) > 40)) delete stage.attrs['data-open']
      content.render(input)
      return stage.getAttribute('data-open') !== null
    },
    open() {
      stage.setAttribute('data-open', '')
      content.render(input)
    },
    leave() {
      delete stage.attrs['data-open']
      stage.setAttribute('data-leaving', '')
      content.render(input)
    },
    land() {
      delete stage.attrs['data-leaving']
      content.render(input)
    },
  }
  /** Where the microphone's row is drawn (viewport y; null: hidden), and the exchange's first line. */
  const mic = () => {
    const t = lay().inputTop
    return t === null ? null : vp(t)
  }
  const ex = () => {
    const t = lay().exTop
    return t === null ? null : vp(t)
  }
  /** The microphone's row in every frame for `ms` (the content's own frames; 16 ms apart). */
  const frames = (ms: number) => {
    const at: number[] = []
    for (let end = now + ms; now < end; ) {
      now += 16
      const run = [...queued.values()]
      queued.clear()
      for (const cb of run) cb(now)
      at.push(mic() ?? NaN)
    }
    return at
  }
  return {
    content, css, root, foot, rows, stage, sugg, mid, voiceRow, stageStyle, midStyle, lay, mic, ex, set, orb, frames,
    /** The largest move of the microphone's row from one frame to the next (the first: from `from`). */
    step: (from: number, at: number[]) => Math.max(...at.map((y, i) => Math.abs(y - (i ? at[i - 1]! : from)))),
    /** Frames still asked for. */
    pending: () => queued.size,
    /** The learner scrolls the body (the content follows with a scroll event). */
    scroll(y: number) {
      ;(body as unknown as { scrollTop: number }).scrollTop = y
      body.dispatch('scroll')
    },
    scrollTop: () => scrollTop,
    scrollMax,
    /** The stage's box as the orb reads it, and the pinned rows (viewport). */
    stageBox: () => boxOf(stage),
    rowsBox: () => boxOf(rows),
    room: () => Number.parseFloat(stageStyle.props['--mwa-stage-room'] ?? 'NaN'),
  }
}


/** The largest one-frame step of an eased move of `d` px over EASE_MS (smoothstep: 1.5 times the average), plus slack. */
const easedStep = (d: number) => (1.5 * Math.abs(d) * 16) / EASE_MS + 0.05

describe('the orb stage in the desktop assistant content', () => {
  it('one empty, aria-hidden slot in the voice area, directly above the input rows, empty in every state', () => {
    const { root, foot, rows, stage, set } = rig()
    expect(root.children.at(-1)).toBe(foot)
    expect(foot.children).toEqual([stage, rows])
    expect(stage.className).toBe('mwa-orb-stage')
    expect(stage.getAttribute('data-assistant')).toBe('orb-stage')
    expect(stage.getAttribute('aria-hidden')).toBe('true')
    expect(rows.all('data-assistant', 'input')).toHaveLength(1)
    expect(rows.all('data-assistant', 'voice-status')).toHaveLength(1)
    for (const over of [{ voice: VOICE.recording }, { voice: VOICE.transcriptDesktop }, { voice: VOICE.submitted, assistant: STATES.pending }, { voice: { kind: 'idle' as const }, assistant: STATES.applied() }]) {
      set(over)
      expect(stage.children).toEqual([])
      expect(stage.textContent).toBe('')
    }
  })

  it('a spoken question from the idle panel: the stage takes exactly the room the suggestions leave, and the microphone never moves while recording (no orb needed)', () => {
    const s = rig()
    const at = s.mic()!
    const suggRoom = s.lay().midH
    s.set({ voiceAcquiring: true }) // the microphone is requested: the suggestions give way
    expect(s.mic()).toBeCloseTo(at, 6)
    expect(s.sugg.hidden).toBe(true)
    expect(s.mid.hidden).toBe(true) // no empty middle (and no gap) above the stage
    expect(s.stageStyle.props['--mwa-stage-room']).toBe(`${suggRoom.toFixed(2)}px`)
    expect(s.root.getAttribute('data-voice')).toBe('below') // a body that does not scroll: the status under the rows
    for (const over of [{ voiceAcquiring: false, voice: VOICE.recording }, { voice: VOICE.transcribing }, { voice: VOICE.canceled }]) {
      s.set(over)
      expect(s.mic()).toBeCloseTo(at, 6)
    }
    s.set({ voice: VOICE.recording })
    s.set({ voice: VOICE.transcriptDesktop }) // the correction field replaces the question field
    expect(s.mic()).toBeNull()
    // Sent: "Thinking..." takes room from the stage, which keeps STAGE_MIN; the rows make up the rest (at once here:
    // no frames to ease in).
    s.set({ voice: VOICE.submitted, assistant: pending('r1') })
    const left = suggRoom - s.lay().midH - GAP
    expect(s.room()).toBeCloseTo(STAGE_MIN, 6)
    expect(s.mic()).toBeCloseTo(at + STAGE_MIN - left, 6)
    expect(s.root.getAttribute('data-hold')).toBe('on')
  })

  it('R2 at the 1600 x 1000 geometry: spoken from idle, the orb keeps a stage of 120 px from the first frame of "Thinking..." through the bloom; the rows move once, eased', () => {
    // The wide panel at 1600 x 1000: source 84.4, two suggestions 153.5, "Thinking..." 101 (38.5 px would be left).
    const s = rig({ sourceH: 84.4, suggH: 153.5, frames: true })
    const at = s.mic()!
    s.set({ voiceAcquiring: true })
    s.set({ voiceAcquiring: false, voice: VOICE.recording })
    expect(s.orb.tryOpen()).toBe(true)
    expect(s.stageBox().height).toBeCloseTo(153.5, 6)
    expect(s.frames(500).every((y) => Math.abs(y - at) < 1e-6)).toBe(true) // recording: Stop never moves
    s.set({ voice: VOICE.transcribing })
    s.set({ voice: VOICE.transcriptDesktop })
    s.set({ voice: VOICE.submitted, assistant: pending('r1') })
    expect(s.lay().exH).toBe(101)
    // The first frame: the stage already has 120 px (the orb stays: more than 110 px), and the rows have not moved.
    expect(s.room()).toBeCloseTo(STAGE_MIN, 6)
    expect(s.stageBox().height).toBeCloseTo(STAGE_MIN, 6)
    expect(s.orb.tryOpen()).toBe(true)
    expect(s.mic()).toBeCloseTo(at, 6)
    expect(s.stage.getAttribute('data-easing')).toBe('on')
    const first = s.ex()!
    const moved = s.frames(EASE_MS + 100)
    expect(moved.at(-1)).toBeCloseTo(at + 81.5, 1) // once, by what the stage needed
    expect(s.step(at, moved)).toBeLessThan(easedStep(81.5)) // eased: never a one-frame jump
    expect(Math.abs(moved[0]! - at)).toBeLessThan(1) // the first frame barely moves
    expect(s.ex()).toBeCloseTo(first, 6) // "Thinking..." stays; its bottom is revealed as the rows move
    expect(s.midStyle.props['max-height']).toBeUndefined()
    expect(s.stage.getAttribute('data-easing')).toBe('off')
    expect(s.stageBox().height).toBeCloseTo(STAGE_MIN, 6)
    // The answer: it and its follow-ups show at once, the orb keeps its 120 px through the bloom, then the stage
    // closes, eased, as the orb leaves; the answer's first line never moves once shown.
    s.set({ voice: { kind: 'idle' }, assistant: answer('r1') })
    expect(s.sugg.hidden).toBe(false)
    expect(s.room()).toBeCloseTo(STAGE_MIN, 6)
    expect(s.orb.tryOpen()).toBe(true)
    const line = s.ex()!
    const landed = s.mic()!
    s.orb.leave()
    const back = s.frames(EASE_MS + 100)
    expect(s.step(landed, back)).toBeLessThan(easedStep(STAGE_MIN + GAP))
    expect(back.at(-1)).toBeCloseTo(landed - STAGE_MIN - GAP, 1)
    expect(s.ex()).toBeCloseTo(line, 6)
    s.orb.land()
    expect([s.stage.getAttribute('data-room'), s.mic()]).toEqual(['off', back.at(-1)])
  })

  it('R2 + R3: a typed question from the idle panel: the stage has 120 px at once, Send moves once, eased; under reduced motion in one frame', () => {
    for (const frames of [true, 'reduced'] as const) {
      const s = rig({ sourceH: 84.4, suggH: 153.5, frames })
      const at = s.mic()!
      s.set({ draft: 'Use this representation on Q' })
      s.set({ draft: '', assistant: pending('r1') })
      expect(s.stageBox().height).toBeCloseTo(STAGE_MIN, 6)
      expect(s.orb.tryOpen()).toBe(true)
      if (frames === 'reduced') {
        expect(s.mic()).toBeCloseTo(at + 81.5, 6)
        expect(s.pending()).toBe(0)
        continue
      }
      expect(s.mic()).toBeCloseTo(at, 6)
      const moved = s.frames(EASE_MS + 100)
      expect(moved.at(-1)).toBeCloseTo(at + 81.5, 1)
      expect(s.step(at, moved)).toBeLessThan(easedStep(81.5))
      expect(s.pending()).toBe(0) // no frames asked for once nothing eases
    }
  })

  it('review 1: wide panel, body overflowing: the voice status grows upward from the pinned rows and Stop stays under the pointer', () => {
    for (const bottom of [false, true]) {
      const s = rig({ bodyH: 520, assistant: answer('r1') })
      expect(s.lay().contentH).toBeGreaterThan(520) // the answer overflows the body
      if (bottom) s.scroll(s.lay().contentH - 520)
      const at = s.mic()!
      const first = s.ex()!
      const height = s.lay().contentH
      s.set({ voiceAcquiring: true })
      s.set({ voiceAcquiring: false, voice: VOICE.recording })
      expect(s.voiceRow.hidden).toBe(false)
      expect(s.mic()).toBeCloseTo(at, 6) // the microphone (now Stop) did not move
      expect(s.root.getAttribute('data-voice')).toBe('above')
      expect(s.ex()).toBeCloseTo(first, 6)
      expect(s.lay().contentH).toBeCloseTo(height, 6) // the content keeps its height: no scroll moves
      s.set({ voice: VOICE.canceled })
      expect(s.mic()).toBeCloseTo(at, 6)
    }
  })

  it('D2: in a scrolled body the first render of the hold keeps the scroll position (a layout read with the suggestions gone clamps it)', () => {
    for (const ending of [VOICE.recording, pending('r2')]) {
      const s = rig({ bodyH: 520, pad: 22, assistant: answer('r1') })
      s.scroll(s.scrollMax())
      const scrolled = s.scrollTop()
      expect(scrolled).toBeGreaterThan(0)
      const at = s.mic()!
      const first = s.ex()!
      if ('kind' in ending && ending.kind === 'recording') s.set({ voice: ending })
      else s.set({ assistant: ending as AssistantState })
      expect(s.scrollTop()).toBeCloseTo(scrolled, 6)
      expect(s.mic()).toBeCloseTo(at, 6)
      if (s.lay().exH === 101) continue // "Thinking..." replaced the answer: its first line is the new exchange's
      expect(s.ex()).toBeCloseTo(first, 6)
    }
  })

  it('review 2: suggestions shorter than 96 px: the stage takes just their room (no minimum while recording), so the rows do not move', () => {
    const s = rig({ suggH: 57 })
    const at = s.mic()!
    s.set({ voice: VOICE.recording })
    expect(s.stageStyle.props['--mwa-stage-room']).toBe('57.00px')
    expect(s.mic()).toBeCloseTo(at, 6)
  })

  for (const [name, end] of [['canceled', VOICE.canceled], ['a voice error', VOICE.error]] as const) {
    it(`review 3 and 7: an earlier answer shown, then ${name}: 'Ask next' waits while the orb is on the stage and flying home, and comes back as it lands`, () => {
      const s = rig({ assistant: answer('r1'), frames: true })
      const at = s.mic()!
      const first = s.ex()!
      s.set({ voice: VOICE.recording })
      s.orb.open()
      s.set({ voice: end })
      expect(s.sugg.hidden).toBe(true) // the orb lingers: the room stays the stage's
      expect(s.mic()).toBeCloseTo(at, 6)
      s.orb.leave() // flying home: still the stage's room (the orb never flies over the suggestions)
      expect(s.sugg.hidden).toBe(true)
      expect(s.mic()).toBeCloseTo(at, 6)
      s.orb.land()
      expect(s.sugg.hidden).toBe(false)
      expect([s.stage.getAttribute('data-room'), s.stage.getAttribute('data-easing')]).toEqual(['off', 'off']) // they fill it exactly
      expect(s.root.getAttribute('data-hold')).toBe('off')
      expect(s.mic()).toBeCloseTo(at, 6)
      expect(s.ex()).toBeCloseTo(first, 6)
      expect(s.frames(EASE_MS).every((y) => Math.abs(y - at) < 1e-6)).toBe(true)
    })
  }

  it('D1 + R1: a request canceled while "Thinking..." (with or without an earlier answer): nothing moves from the press until the orb lands, and what the exchange changed eases as Ask next comes back', () => {
    for (const earlier of [true, false]) {
      const s = rig({ frames: true, ...(earlier ? { assistant: answer('r1') } : { sourceH: 84.4, suggH: 153.5 }) })
      s.set({ assistant: pending('r2') })
      s.frames(EASE_MS + 50)
      s.orb.open()
      const at = s.mic()!
      const line = s.ex()!
      s.set({ assistant: canceled('r2') }) // Cancel pressed: "Canceled" replaces "Thinking..." in place
      expect(s.sugg.hidden).toBe(true) // Ask next waits while the orb lingers and flies home
      expect(s.mic()).toBeCloseTo(at, 6)
      expect(s.ex()).toBeCloseTo(line, 6)
      expect(s.frames(500).every((y) => Math.abs(y - at) < 1e-6)).toBe(true) // no minimum any more: nothing pending
      s.orb.leave()
      expect(s.frames(300).every((y) => Math.abs(y - at) < 1e-6)).toBe(true)
      s.orb.land()
      expect(s.sugg.hidden).toBe(false)
      expect(s.mic()).toBeCloseTo(at, 6) // the landing frame: Ask next takes the room, the rest still to come
      const back = s.frames(EASE_MS + 100)
      expect(Math.abs(back.at(-1)! - at)).toBeGreaterThan(5) // the exchange changed during the hold: the rows do move,
      expect(s.step(at, back)).toBeLessThan(easedStep(back.at(-1)! - at)) // eased
      expect(s.ex()).toBeCloseTo(line, 6)
      expect([s.stage.getAttribute('data-room'), s.midStyle.props['max-height']]).toEqual(['off', undefined])
    }
  })

  it('D3: the voice status still shown when the orb lands keeps its side: a body that does not scroll is not turned into one with the status above', () => {
    // The answer fits; the recording's status fits under the rows; the longer too-short advice overflows by 13 px
    // (the slot's padding keeps the rows in flow).
    const probe = rig({ assistant: answer('r1'), pad: 22 })
    const bodyH = probe.lay().contentH + 22 + VOICE_H + ROW_GAP + 5
    probe.content.dispose()
    const s = rig({ assistant: answer('r1'), pad: 22, bodyH, frames: true })
    const at = s.mic()!
    s.set({ voice: VOICE.recording })
    expect(s.root.getAttribute('data-voice')).toBe('below')
    s.orb.open()
    s.set({ voice: tooShort })
    expect(s.lay().contentH + 22).toBeGreaterThan(bodyH) // it overflows now
    expect(s.mic()).toBeCloseTo(at, 6)
    s.orb.leave()
    s.orb.land()
    expect(s.root.getAttribute('data-voice')).toBe('below') // not decided again while the status is shown
    expect(s.mic()).toBeCloseTo(at, 6)
    expect(s.frames(EASE_MS).every((y) => Math.abs(y - at) < 1e-6)).toBe(true)
    s.set({ voice: { kind: 'idle' } }) // the status goes: its side may be decided again (nothing to move)
    expect(s.voiceRow.hidden).toBe(true)
  })

  it('D4: a body scrolled to its bottom, a voice cancel or error with an answer shown: as the orb lands the rows do not drop in one frame; what the status still takes eases', () => {
    for (const end of [VOICE.canceled, VOICE.error]) {
      const s = rig({ bodyH: 520, pad: 22, assistant: answer('r1'), frames: true })
      s.scroll(s.scrollMax())
      const at = s.mic()!
      s.set({ voice: VOICE.recording })
      expect(s.root.getAttribute('data-voice')).toBe('above')
      expect(s.mic()).toBeCloseTo(at, 6)
      s.orb.open()
      s.set({ voice: end })
      s.orb.leave()
      expect(s.mic()).toBeCloseTo(at, 6)
      s.orb.land()
      expect(s.sugg.hidden).toBe(false)
      expect(s.mic()).toBeCloseTo(at, 6) // the landing frame: the end of Ask next is hidden for now instead
      const after = s.frames(EASE_MS + 100)
      // The hidden 44 px (the status row and its gap) are revealed, eased; the rows follow to the body's bottom.
      expect(s.step(at, after)).toBeLessThan(easedStep(VOICE_H + ROW_GAP))
      expect(after.at(-1)! - at).toBeLessThanOrEqual(22 + 1e-6) // to the body's bottom: the slot's padding at most
      expect(s.midStyle.props['max-height']).toBeUndefined()
    }
  })

  it('review 3: a new answer shows at once with its follow-ups; the lingering orb keeps at most its own room, which closes, eased, as it leaves', () => {
    const s = rig({ assistant: answer('r1'), frames: true })
    s.set({ voice: VOICE.recording })
    s.orb.open()
    s.set({ voice: VOICE.submitted, assistant: pending('r2') })
    expect(s.room()).toBeGreaterThan(150) // "Thinking..." left a large room
    s.set({ voice: { kind: 'idle' }, assistant: answer('r2') })
    expect(s.sugg.hidden).toBe(false)
    expect(s.root.getAttribute('data-hold')).toBe('off')
    expect(s.stageStyle.props['--mwa-stage-room']).toBe('150.00px')
    const at = s.mic()!
    s.orb.leave()
    expect([s.stage.getAttribute('data-room'), s.stage.getAttribute('data-easing')]).toEqual(['on', 'on'])
    const back = s.frames(EASE_MS + 50)
    expect(s.step(at, back)).toBeLessThan(easedStep(150 + GAP))
    expect(s.stage.getAttribute('data-room')).toBe('off')
    // With no orb on the stage when the answer comes, the room goes at once.
    const t = rig({ frames: true })
    t.set({ voice: VOICE.recording })
    t.set({ voice: VOICE.submitted, assistant: pending('r3') })
    t.set({ voice: { kind: 'idle' }, assistant: answer('r3') })
    expect([t.stage.getAttribute('data-room'), t.stage.getAttribute('data-easing'), t.midStyle.props['max-height']]).toEqual(['off', 'off', undefined])
  })

  it('an answer that makes the body scroll closes the stage at once (its closing would move the answer once shown)', () => {
    const s = rig({ bodyH: 600, frames: true })
    s.set({ voice: VOICE.recording })
    s.orb.open()
    s.set({ voice: VOICE.submitted, assistant: pending('r1') })
    s.frames(EASE_MS + 50)
    s.set({ voice: { kind: 'idle' }, assistant: answer('r1') })
    expect(s.lay().contentH).toBeGreaterThan(600)
    expect(s.stage.getAttribute('data-room')).toBe('off')
  })

  it('review 4: with an answer shown, a spoken follow-up never moves the answer: the stage replaces Ask next in place, above the rows', () => {
    const s = rig({ assistant: answer('r1') })
    const first = s.ex()!
    const at = s.mic()!
    const l0 = s.lay()
    const askNextTop = l0.exTop! + l0.exH + GAP
    s.set({ voice: VOICE.recording })
    expect(s.ex()).toBeCloseTo(first, 6)
    expect(s.mic()).toBeCloseTo(at, 6)
    const l = s.lay()
    expect(l.stageBox.top).toBeCloseTo(askNextTop, 6) // in Ask next's place, after the answer
    expect(l.stageBox.h).toBeCloseTo(l0.suggH, 6)
    expect(l.stageBox.top + l.stageBox.h + GAP).toBeCloseTo(l.rowsFlow, 6) // directly above the rows
    // The follow-up is sent: "Thinking..." replaces the answer; the stage absorbs it, nothing below moves.
    s.set({ voice: VOICE.submitted, assistant: pending('r2') })
    expect(s.ex()).toBeCloseTo(first, 6)
    expect(s.mic()).toBeCloseTo(at, 6)
  })

  it('review 6: stacked drawer (a scrolling body): the stage is never in the pinned rows block and only its part in view (below the body\'s top, above the pinned rows) is a box', () => {
    const s = rig({ narrow: true, bodyH: 230 })
    expect(s.lay().contentH).toBeGreaterThan(230)
    const at = s.mic()!
    const rowsBefore = s.rowsBox()
    s.set({ voice: VOICE.recording })
    const opened = s.orb.tryOpen()
    // The pinned block grows only by the voice status (no stage column beside the rows).
    expect(s.rowsBox().height).toBeCloseTo(rowsBefore.height + VOICE_H + ROW_GAP, 6)
    expect(s.mic()).toBeCloseTo(at, 6)
    s.set({ voice: VOICE.submitted, assistant: pending('r1') }) // "Thinking..." with its Cancel
    s.orb.tryOpen()
    expect(s.rowsBox().height).toBeCloseTo(rowsBefore.height, 6) // the block keeps its own height
    expect(s.ex()! + 13).toBeLessThan(s.rowsBox().top) // "Thinking..." is in view, above the rows
    expect(s.mic()).toBeCloseTo(at, 6)
    expect(opened).toBe(false) // too little of the stage in view: the orb stays in the header
    expect(s.root.getAttribute('data-voice')).toBe('above')
    s.set({ voice: VOICE.recording, assistant: { kind: 'idle' } })
    const box = s.stageBox()
    expect(box.height === 0 || box.top + box.height <= s.rowsBox().top + 1e-6).toBe(true) // none of it under the rows
    expect(box.height).toBeLessThanOrEqual(40) // too little in view for the orb here: it stays in the header
    // Scrolled to the bottom, the whole room is in view: the box is all of it, directly above the rows.
    expect(s.room()).toBeGreaterThan(40)
    s.scroll(s.lay().contentH - 230)
    expect(s.stageBox().height).toBeCloseTo(s.room(), 6)
    expect(s.stageBox().bottom + GAP).toBeCloseTo(s.rowsBox().top, 6)
    s.scroll(0)
    expect(s.stageBox().height).toBeLessThanOrEqual(40)
    expect(s.mic()).toBeCloseTo(at, 6)
    expect(s.css).not.toContain('84px')
  })

  it('a stage taller than the body shows: the part scrolled away above the body is a margin too (the orb never sits half out of view)', () => {
    const s = rig({ narrow: true, bodyH: 230, assistant: answer('r1') })
    s.set({ voice: VOICE.recording })
    s.set({ voice: VOICE.submitted, assistant: pending('r2') }) // "Thinking..." replaced the answer: a large room
    s.scroll(s.scrollMax())
    const b = s.stageBox()
    expect(s.room()).toBeGreaterThan(230)
    expect(b.top).toBeCloseTo(BODY_TOP, 6) // from the body's top...
    expect(b.bottom + GAP).toBeCloseTo(s.rowsBox().top, 6) // ...to the pinned rows
    expect(s.orb.tryOpen()).toBe(b.height > 40)
  })

  it("a recording started while the stage is still easing closed counts the stage's current share (that move stops there)", () => {
    const s = rig({ assistant: answer('r1'), frames: true })
    s.set({ voice: VOICE.recording })
    s.orb.open()
    s.set({ voice: VOICE.submitted, assistant: pending('r2') })
    s.set({ voice: { kind: 'idle' }, assistant: answer('r2') }) // the orb lingers on 150 px
    s.orb.leave()
    s.orb.land()
    s.frames(EASE_MS / 2) // half way closed
    expect(s.stage.getAttribute('data-easing')).toBe('on')
    const atEasing = s.mic()!
    s.set({ voice: VOICE.recording })
    expect(s.mic()).toBeCloseTo(atEasing, 6)
    expect(s.stage.getAttribute('data-easing')).toBe('off')
    expect(s.frames(EASE_MS).every((y) => Math.abs(y - atEasing) < 1e-6)).toBe(true)
  })

  it('a typed question with an answer shown: the stage gets the room left (large), so Send does not move', () => {
    const t = rig({ assistant: answer('r1') })
    const at = t.mic()!
    t.set({ assistant: pending('r2') })
    expect(t.mic()).toBeCloseTo(at, 6)
    expect(t.room()).toBeGreaterThan(150)
  })

  it('D5: typing the first character of a draft keeps Edit question (disabled, with the reason), so the rows do not move', () => {
    const s = rig({ assistant: rejected('r1') }) // Edit question is its only action
    const at = s.mic()!
    const edit = s.root.find('data-assistant', 'action-edit')
    expect(edit.disabled).toBe(false)
    s.set({ draft: 'W' })
    expect(s.root.all('data-assistant', 'action-edit')).toEqual([edit]) // the same button, in place
    expect(edit.disabled).toBe(true)
    expect(edit.title).toBe(EDIT_WITH_DRAFT)
    expect(s.mic()).toBeCloseTo(at, 6)
    s.set({ draft: '' })
    expect([edit.disabled, edit.title, s.mic()]).toEqual([false, '', at])
  })

  it('the CSS: the stage after the middle, room only when given, the covered part a margin, no transition (the content eases it), the voice status by data-voice', () => {
    const { css } = rig()
    expect(css).toContain('.mwa-mid { order: 1; }')
    expect(css).toContain('.mwa-orb-stage { order: 2; flex: none; display: flex; align-items: center; justify-content: center; height: 0; margin: -14px 0 0; }')
    expect(css).toContain('.mwa-orb-stage[data-room="on"] { height: max(0px, calc(var(--mwa-stage-room, 0px) - var(--mwa-stage-cut, 0px) - var(--mwa-stage-top, 0px)));')
    expect(css).toContain('margin: calc(min(0px, var(--mwa-stage-room, 0px)) + var(--mwa-stage-top, 0px)) 0 var(--mwa-stage-cut, 0px); }')
    expect(css).not.toMatch(/transition: (height|margin)/)
    expect(css).toContain('.mwa-foot { display: contents; }')
    expect(css).toContain('.mwa-foot-rows > .mwa-voicerow { order: 1; }')
    expect(css).toContain('.mwa[data-voice="above"] .mwa-foot-rows > .mwa-voicerow { order: 0; }')
    expect(css).not.toMatch(/\[data-narrow\] \.mwa-(foot|orb-stage)/) // the stacked drawer is laid out the same way
    // The header slot keeps its fixed box when the orb leaves it (the title never shifts).
    expect(css).toMatch(/\.mwa-orb-slot \{ display: inline-flex; flex: none; width: 40px; height: 40px;/)
  })

  it('dispose removes the stage with the content and asks for no more frames', () => {
    const s = rig({ frames: true, sourceH: 84.4, suggH: 153.5 })
    s.set({ assistant: pending('r1') })
    expect(s.pending()).toBe(1)
    const parent = s.root.parent!
    s.content.dispose()
    expect(parent.all('data-assistant', 'orb-stage')).toHaveLength(0)
    expect(s.pending()).toBe(0)
  })
})

// A hold that begins while the rows still ease DOWN after a hold ended (the middle's bottom clipped by max-height)
// keeps the rows' real place: the press frame moves neither the microphone (R1) nor Send at once (R2).
describe('a press during the landing ease', () => {
  const landed = (geo: object) => {
    const s = rig({ frames: true, ...geo })
    s.set({ assistant: pending('r2') })
    s.frames(EASE_MS + 50)
    s.orb.open()
    s.set({ assistant: canceled('r2') })
    s.orb.leave()
    s.orb.land()
    s.frames(96) // ~100 ms into the eased move down
    expect(s.midStyle.props['max-height']).toBeDefined() // the middle's bottom is still hidden
    return s
  }
  for (const [name, geo] of [['default', {}], ['1600 x 1000 geometry', { sourceH: 84.4, suggH: 153.5 }]] as const) {
    it(`${name}: the mic pressed ~100 ms after the orb lands (request canceled from idle): Stop does not move in the press frame`, () => {
      const s = landed(geo)
      const at = s.mic()!
      s.set({ voiceAcquiring: true })
      expect(s.mic()).toBeCloseTo(at, 3)
    })
    it(`${name}: a suggestion (or Send) pressed ~100 ms after the orb lands: Send moves only eased`, () => {
      const s = landed(geo)
      const at = s.mic()!
      s.set({ assistant: pending('r3') })
      expect(Math.abs(s.mic()! - at)).toBeLessThan(easedStep(200))
    })
  }
  it('scrolled body (data-voice above), a too-short recording, the retry pressed ~100 ms after the orb lands: Stop does not move', () => {
    const s = rig({ bodyH: 520, pad: 22, assistant: answer('r1'), frames: true })
    s.scroll(s.scrollMax())
    s.set({ voice: VOICE.recording })
    s.orb.open()
    s.set({ voice: tooShort as never })
    s.orb.leave()
    s.orb.land()
    s.frames(112)
    expect(s.midStyle.props['max-height']).toBeDefined()
    const at = s.mic()!
    s.set({ voice: { kind: 'idle' }, voiceAcquiring: true })
    expect(s.mic()).toBeCloseTo(at, 3)
  })
})
