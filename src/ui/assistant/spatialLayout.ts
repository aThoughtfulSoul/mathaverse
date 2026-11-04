// Layout of the spatial (XR / passthrough) Ask Meta Muse AI content: from the shared AssistantView to text
// lines and button rectangles in panel metres (x right, y DOWN from the top-left corner). Pure apart from the
// text measure it is given, so it is testable in node. There is deliberately no text field: XR shows the
// source, suggestion buttons, the readable exchange (with the app-computed facts of a walk endpoint answer and
// the live Lean check line of an answer that requested a check), the transcript with its auto-submit
// countdown, and the Talk / Stop / Cancel / Send now / Retry controls (UI-REFINEMENT-SPEC section 7); an idle
// Talk has "or hold A or X to talk" beside it when the row has room.

import type { UiCommand } from '../model'
import type { AssistantView, Tone } from './view'

/** The content area (the shell's inspector frame is max(0.47, width + 2 x 0.016) wide: this fits it exactly). */
export const PANEL = { width: 0.438, height: 0.68, pad: 0.014 } as const

/** Text sizes (em, metres), matched to the spatial shell's type scale (buttons and status 17.5 mm, detail 15.8 mm,
 * small 13.8 mm); a too-long explanation steps down to the small size before anything is shortened. */
export const EM = { status: 0.0175, body: 0.0158, small: 0.0138, button: 0.0175 } as const
export const LINE = 1.35 * 1.12
const lineH = (em: number) => em * LINE

export const COLOR = {
  text: 0xe9edf5,
  dim: 0xb0b8c8,
  teal: 0x5fe0d0,
  amber: 0xffd98a,
  rose: 0xff9fae,
  ok: 0x8fe3b6,
  warning: 0xffc95c,
} as const

export interface LineSpec {
  text: string
  em: number
  color: number
  /** Left edge and vertical centre (panel metres, y down). */
  x: number
  y: number
  /** On a button plate (drawn slightly in front of it). */
  onPlate?: boolean
}

export type ButtonStyle = 'suggestion' | 'action' | 'primary' | 'record' | 'stop'

export interface ButtonSpec {
  id: string
  x: number
  y: number
  w: number
  h: number
  enabled: boolean
  command: UiCommand | null
  hint?: string
  style: ButtonStyle
}

export interface SpatialLayout {
  lines: LineSpec[]
  buttons: ButtonSpec[]
  /** Whether the explanation had to be shortened to fit (reported, never silent). */
  clamped: boolean
}

/** Width of a text at an em size, in metres. */
export type Measure = (text: string, em: number) => number

export function toneColor(t: Tone): number {
  return t === 'busy' ? COLOR.teal : t === 'ok' ? COLOR.ok : t === 'warning' ? COLOR.warning : t === 'error' ? COLOR.rose : COLOR.text
}

function sourceColor(kind: AssistantView['source']['kind']): number {
  return kind === 'synthetic' ? COLOR.amber : kind === 'live-verified' ? COLOR.teal : kind === 'unavailable' ? COLOR.rose : kind === 'checking' ? COLOR.dim : COLOR.text
}

/** Greedy word wrap; a word wider than the line is cut with an ellipsis; at most maxLines (the last gets "…"). */
export function wrap(text: string, em: number, maxW: number, maxLines: number, measure: Measure): { lines: string[]; cut: boolean } {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let line = ''
  let cut = false
  const fitWord = (w: string) => {
    if (measure(w, em) <= maxW) return w
    let s = w
    while (s.length > 1 && measure(`${s}…`, em) > maxW) s = s.slice(0, -1)
    return `${s}…`
  }
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!
    const next = line ? `${line} ${w}` : w
    if (measure(next, em) <= maxW) {
      line = next
      continue
    }
    if (line) out.push(line)
    line = fitWord(w)
    if (out.length === maxLines) {
      cut = true
      break
    }
  }
  if (!cut && line) out.push(line)
  if (out.length > maxLines) {
    out.length = maxLines
    cut = true
  }
  if (cut && out.length) {
    let l = out[out.length - 1]!
    while (l.length > 1 && measure(`${l}…`, em) > maxW) l = l.slice(0, -1).trimEnd()
    out[out.length - 1] = `${l}…`
  }
  return { lines: out, cut }
}

interface Block {
  lines: LineSpec[]
  buttons: ButtonSpec[]
  height: number
}

/** A run of text lines starting at y (top), returns the height used. */
function textBlock(into: Block, text: string, em: number, color: number, x: number, maxW: number, maxLines: number, measure: Measure): boolean {
  const { lines, cut } = wrap(text, em, maxW, maxLines, measure)
  for (const l of lines) {
    into.lines.push({ text: l, em, color, x, y: into.height + lineH(em) / 2 })
    into.height += lineH(em)
  }
  return cut
}

function shift(b: Block, dy: number): Block {
  return { lines: b.lines.map((l) => ({ ...l, y: l.y + dy })), buttons: b.buttons.map((s) => ({ ...s, y: s.y + dy })), height: b.height }
}

const BTN_H = 0.042
const GAP = 0.01

/** A row of buttons with auto widths (label + padding). */
function buttonRow(into: Block, items: { id: string; label: string; enabled: boolean; command: UiCommand | null; hint?: string; style: ButtonStyle; minW?: number }[], x0: number, measure: Measure): void {
  let x = x0
  const y = into.height
  for (const it of items) {
    const w = Math.max(it.minW ?? 0.09, measure(it.label, EM.button) + 0.034)
    into.buttons.push({ id: it.id, x, y, w, h: BTN_H, enabled: it.enabled, command: it.enabled ? it.command : null, hint: it.hint, style: it.style })
    into.lines.push({ text: it.label, em: EM.button, color: it.enabled ? COLOR.text : COLOR.dim, x: x + (w - measure(it.label, EM.button)) / 2, y: y + BTN_H / 2, onPlate: true })
    x += w + 0.008
  }
  into.height += BTN_H
}

function sourceBlock(v: AssistantView, iw: number, measure: Measure): Block {
  const b: Block = { lines: [], buttons: [], height: 0 }
  const label = v.source.secondary ? `${v.source.label} · ${v.source.secondary}` : v.source.label
  textBlock(b, label, EM.status, sourceColor(v.source.kind), 0, iw, 1, measure)
  textBlock(b, v.source.detail, EM.small, COLOR.dim, 0, iw, 2, measure)
  textBlock(b, v.speech.available ? v.speech.label : `${v.speech.label}: ${v.speech.detail}`, EM.small, v.speech.available ? COLOR.dim : COLOR.rose, 0, iw, 2, measure)
  return b
}

function suggestionsBlock(v: AssistantView, iw: number, measure: Measure, compact: boolean): Block {
  const b: Block = { lines: [], buttons: [], height: 0 }
  if (!v.suggestions.length) {
    if (v.suggestionHint && !compact) textBlock(b, v.suggestionHint, EM.small, COLOR.dim, 0, iw, 2, measure)
    return b
  }
  textBlock(b, v.exchange ? 'Ask next' : 'Suggested questions', EM.small, COLOR.dim, 0, iw, 1, measure)
  b.height += 0.004
  const list = compact ? v.suggestions.slice(0, 2) : v.suggestions
  list.forEach((s, i) => {
    const pad = 0.008
    const inner = iw - 2 * pad - 0.016
    const t = wrap(s.text, EM.button, inner, compact ? 1 : 2, measure)
    const n = !compact && s.note ? wrap(s.note, EM.small, inner, 1, measure) : { lines: [] as string[], cut: false }
    const h = 2 * pad + t.lines.length * lineH(EM.button) + n.lines.length * lineH(EM.small)
    const y = b.height
    b.buttons.push({ id: `suggestion:${i}`, x: 0, y, w: iw, h, enabled: true, command: s.command, hint: s.text, style: 'suggestion' })
    let ly = y + pad
    for (const l of t.lines) {
      b.lines.push({ text: l, em: EM.button, color: COLOR.text, x: pad + 0.004, y: ly + lineH(EM.button) / 2, onPlate: true })
      ly += lineH(EM.button)
    }
    for (const l of n.lines) {
      b.lines.push({ text: l, em: EM.small, color: COLOR.dim, x: pad + 0.004, y: ly + lineH(EM.small) / 2, onPlate: true })
      ly += lineH(EM.small)
    }
    b.lines.push({ text: '›', em: EM.status, color: COLOR.dim, x: iw - pad - 0.01, y: y + h / 2, onPlate: true })
    b.height += h + 0.006
  })
  return b
}

function exchangeBlock(v: AssistantView, iw: number, measure: Measure, explanationLines: number, bodyEm: number): { block: Block; cut: boolean; explanationTotal: number } {
  const b: Block = { lines: [], buttons: [], height: 0 }
  const x = v.exchange
  if (!x) return { block: b, cut: false, explanationTotal: 0 }
  textBlock(b, x.heading, EM.status, toneColor(x.tone), 0, iw, 1, measure)
  if (x.reason) textBlock(b, x.reason, EM.small, COLOR.dim, 0, iw, 2, measure)
  textBlock(b, `You asked: “${x.question}”`, EM.small, COLOR.dim, 0, iw, 2, measure)
  if (x.title) {
    b.height += 0.004
    textBlock(b, x.title, EM.body, COLOR.text, 0, iw, 2, measure)
  }
  let cut = false
  let explanationTotal = 0
  if (x.explanation) {
    explanationTotal = wrap(x.explanation, bodyEm, iw, 1000, measure).lines.length
    cut = textBlock(b, x.explanation, bodyEm, COLOR.text, 0, iw, Math.max(1, explanationLines), measure)
  }
  // Application-computed facts beside the prose (squared length against R², the length labelled
  // approximate, the bound); a historical block says so first, in the warning colour.
  if (x.facts) {
    const f = x.facts
    b.height += 0.006
    textBlock(b, `${f.label} · ${f.endpoint} · not by Meta Muse AI`, EM.small, f.current ? COLOR.teal : COLOR.warning, 0, iw, 2, measure)
    if (f.note) textBlock(b, f.note, EM.small, COLOR.warning, 0, iw, 2, measure)
    for (const r of f.rows) textBlock(b, r.label === 'Exact' ? r.text : `${r.label}: ${r.text}`, r.label === 'Exact' ? bodyEm : EM.small, r.label === 'Exact' ? COLOR.text : COLOR.dim, 0, iw, 2, measure)
  }
  if (x.changes.length) {
    b.height += 0.004
    textBlock(b, `Changed: ${x.changes.join(' · ')}`, EM.small, COLOR.ok, 0, iw, 2, measure)
  }
  // The requested Lean check, as the evidence store reports it (under the change it requested).
  if (x.check) textBlock(b, x.check.text, EM.small, toneColor(x.check.tone), 0, iw, 2, measure)
  if (x.provenance) {
    b.height += 0.004
    textBlock(b, `${x.provenance.label} · ${x.provenance.detail}`, EM.small, x.provenance.live ? COLOR.teal : COLOR.amber, 0, iw, 2, measure)
  }
  if (cut) textBlock(b, 'The full explanation is in the desktop panel.', EM.small, COLOR.dim, 0, iw, 1, measure)
  if (x.note) textBlock(b, x.note, EM.small, COLOR.dim, 0, iw, 1, measure)
  if (x.actions.length) {
    b.height += 0.006
    buttonRow(b, x.actions.map((a) => ({ id: `action:${a.id}`, label: a.label, enabled: true, command: a.command, hint: a.ariaLabel, style: a.id === 'retry' ? 'primary' : 'action' })), 0, measure)
  }
  return { block: b, cut, explanationTotal }
}

/** The voice block (anchored at the bottom): status, transcript with countdown, Talk / Stop / Cancel / Send now. */
function voiceBlock(v: AssistantView, iw: number, measure: Measure, now: number): Block {
  const b: Block = { lines: [], buttons: [], height: 0 }
  const vv = v.voice
  if (vv.phase === 'recording' && vv.recordingStartedAt !== null) {
    const secs = Math.max(0, Math.floor((now - vv.recordingStartedAt) / 1000))
    textBlock(b, `Listening… ${secs} s · press Stop or release A/X when you are done`, EM.body, COLOR.teal, 0, iw, 2, measure)
  } else if (vv.transcript) {
    textBlock(b, `You said: “${vv.transcript.text}”`, EM.body, COLOR.text, 0, iw, 3, measure)
    textBlock(b, vv.transcript.source, EM.small, COLOR.dim, 0, iw, 1, measure)
    if (vv.transcript.autoSubmitAt !== null) {
      const left = Math.max(0, Math.ceil((vv.transcript.autoSubmitAt - now) / 1000))
      textBlock(b, `Sending in ${left} s · press Cancel to stop`, EM.body, COLOR.teal, 0, iw, 1, measure)
    } else if (vv.status) textBlock(b, vv.status, EM.small, COLOR.dim, 0, iw, 2, measure)
  } else if (vv.status) {
    textBlock(b, vv.status, EM.small, toneColor(vv.tone), 0, iw, 2, measure)
  } else if (vv.phase === 'unavailable') {
    textBlock(b, `Voice unavailable: ${v.speech.detail}`, EM.small, COLOR.rose, 0, iw, 2, measure)
  }
  if (b.height) b.height += 0.006
  const t = vv.talk
  const talkStyle: ButtonStyle = t.label === 'Stop' ? 'stop' : t.label === 'Talk' ? 'record' : 'action'
  const row: Parameters<typeof buttonRow>[1] = [{ id: 'talk', label: t.label, enabled: t.enabled, command: t.command, hint: t.hint, style: talkStyle, minW: 0.13 }]
  // Talk already reads "Cancel" while the microphone is requested, while transcribing and during the
  // auto-submit window: no second Cancel then.
  if (vv.xrCancel && t.label !== 'Cancel') row.push({ id: 'voiceCancel', label: vv.xrCancel.label, enabled: true, command: vv.xrCancel.command, hint: vv.xrCancel.ariaLabel, style: 'action', minW: 0.11 })
  if (vv.send) row.push({ id: 'transcriptSend', label: vv.send.label, enabled: true, command: vv.send.command, hint: vv.send.ariaLabel, style: 'primary', minW: 0.12 })
  const rowY = b.height
  buttonRow(b, row, 0, measure)
  // Beside the row, on the same line (no extra height), only when it fits whole.
  const last = b.buttons[b.buttons.length - 1]
  if (vv.holdHint && last) {
    const hx = last.x + last.w + 0.012
    if (hx + measure(vv.holdHint, EM.small) <= iw) b.lines.push({ text: vv.holdHint, em: EM.small, color: COLOR.dim, x: hx, y: rowY + BTN_H / 2 })
  }
  return b
}

/**
 * Lay out the panel. `now` is performance.now() (recording time and the auto-submit countdown). The source
 * block is at the top and the voice controls at the bottom; between them the suggestions and the exchange
 * share the space, with the explanation shrunk, then shortened, only when it cannot fit.
 */
export function layoutSpatial(v: AssistantView, now: number, measure: Measure): SpatialLayout {
  const { width, height, pad } = PANEL
  const iw = width - 2 * pad
  const top = sourceBlock(v, iw, measure)
  const bottom = voiceBlock(v, iw, measure, now)
  const avail = height - 2 * pad - top.height - bottom.height - 2 * GAP
  let clamped = false
  let middle: Block[] = []
  if (!v.exchange) {
    middle = [suggestionsBlock(v, iw, measure, false)]
  } else {
    let chosen: { sugg: Block; ex: Block } | null = null
    // Prefer full suggestions with the whole explanation, then compact ones, then none; then a smaller font;
    // only then shorten the explanation (and say so).
    outer: for (const em of [EM.body, EM.small]) {
      for (const mode of ['full', 'compact', 'none'] as const) {
        const sugg = mode === 'none' ? { lines: [], buttons: [], height: 0 } : suggestionsBlock(v, iw, measure, mode === 'compact')
        const room = avail - (sugg.height ? sugg.height + GAP : 0)
        const probe = exchangeBlock(v, iw, measure, 1000, em)
        if (probe.block.height <= room) {
          chosen = { sugg, ex: probe.block }
          break outer
        }
      }
    }
    if (!chosen) {
      const em = EM.small
      const probe = exchangeBlock(v, iw, measure, 1000, em)
      const over = probe.block.height - avail
      const keep = Math.max(2, probe.explanationTotal - Math.ceil(over / lineH(em)) - 2)
      const r = exchangeBlock(v, iw, measure, keep, em)
      clamped = r.cut
      chosen = { sugg: { lines: [], buttons: [], height: 0 }, ex: r.block }
    }
    // With a result up, the answer comes first and the (compact) follow-up suggestions below it.
    middle = [chosen.ex, chosen.sugg]
  }
  const lines: LineSpec[] = []
  const buttons: ButtonSpec[] = []
  const add = (b: Block, y: number) => {
    const s = shift(b, y)
    for (const l of s.lines) lines.push({ ...l, x: l.x + pad })
    for (const btn of s.buttons) buttons.push({ ...btn, x: btn.x + pad })
  }
  let y = pad
  add(top, y)
  y += top.height + GAP
  for (const m of middle) {
    if (!m.height) continue
    add(m, y)
    y += m.height + GAP
  }
  add(bottom, height - pad - bottom.height)
  return { lines, buttons, clamped }
}
