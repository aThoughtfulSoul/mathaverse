// The XR content's layout (logic, with a fixed-width text measure): everything stays inside the panel, the
// controls carry the right commands (a disabled one carries none), the countdown and Cancel appear for an
// auto-submitting transcript, there is no text field, and a too-long explanation is shortened only after the
// suggestions and the font size gave way, and then says so.

import { describe, expect, it } from 'vitest'
import { PANEL, layoutSpatial, wrap } from '../../../src/ui/assistant/spatialLayout'
import { assistantView } from '../../../src/ui/assistant/view'
import { STATES, VOICE, docs, panelInput, response } from './helpers'

const measure = (t: string, em: number) => t.length * em * 0.5
const xr = (over: Parameters<typeof panelInput>[1] = {}) => assistantView(panelInput(docs().sculpture, { surface: 'xr', ...over }))
const ids = (l: ReturnType<typeof layoutSpatial>) => l.buttons.map((b) => b.id)

function inside(l: ReturnType<typeof layoutSpatial>) {
  for (const b of l.buttons) {
    expect(b.x).toBeGreaterThanOrEqual(0)
    expect(b.x + b.w).toBeLessThanOrEqual(PANEL.width + 1e-9)
    expect(b.y).toBeGreaterThanOrEqual(0)
    expect(b.y + b.h).toBeLessThanOrEqual(PANEL.height + 1e-9)
  }
  for (const t of l.lines) {
    expect(t.y).toBeGreaterThan(0)
    expect(t.y).toBeLessThan(PANEL.height)
    expect(t.x + measure(t.text, t.em)).toBeLessThanOrEqual(PANEL.width + 1e-9)
  }
}

describe('spatial layout', () => {
  it('idle: source, suggestion buttons asking their text, and Talk (voiceToggle); no text field', () => {
    const v = xr()
    const l = layoutSpatial(v, 0, measure)
    inside(l)
    expect(ids(l)).toEqual([...v.suggestions.map((_, i) => `suggestion:${i}`), 'talk'])
    expect(l.buttons[0]!.command).toEqual(v.suggestions[0]!.command)
    expect(l.buttons.at(-1)!.command).toEqual({ kind: 'assistant', action: { kind: 'voiceToggle' } })
    expect(l.lines.some((t) => /Ask about this experiment/.test(t.text))).toBe(false)
    expect(l.lines[0]!.text).toContain('Synthetic demo')
  })

  it('recording: Stop and a separate Cancel; the elapsed time is from the real start', () => {
    const l = layoutSpatial(xr({ voice: VOICE.recording }), 4200, measure)
    expect(ids(l)).toEqual(['talk', 'voiceCancel'])
    expect(l.lines.some((t) => t.text.startsWith('Listening… 3 s'))).toBe(true)
  })

  it('auto-submitting transcript: the countdown, Talk reading Cancel, Send now; no duplicate Cancel', () => {
    const l = layoutSpatial(xr({ voice: VOICE.transcriptXr }), 3600, measure)
    inside(l)
    expect(ids(l)).toEqual(['talk', 'transcriptSend'])
    expect(l.lines.some((t) => t.text === 'Sending in 2 s · press Cancel to stop')).toBe(true)
    expect(l.lines.some((t) => t.text.startsWith('You said: “apply it again”'))).toBe(true)
    const talk = l.buttons.find((b) => b.id === 'talk')!
    expect(talk.command).toEqual({ kind: 'assistant', action: { kind: 'voiceToggle' } })
    expect(l.lines.find((t) => t.onPlate && Math.abs(t.y - (talk.y + talk.h / 2)) < 1e-9 && t.x >= talk.x && t.x < talk.x + talk.w)?.text).toBe('Cancel')
  })

  it('pending: the question and a Cancel for the request', () => {
    const l = layoutSpatial(xr({ assistant: STATES.pending }), 0, measure)
    expect(ids(l)).toEqual(['action:cancel', 'talk'])
    expect(l.lines.some((t) => t.text.includes('Apply the selected operation again'))).toBe(true)
  })

  it('a disabled Talk carries no command', () => {
    const l = layoutSpatial(xr({ voice: VOICE.unavailable }), 0, measure)
    const talk = l.buttons.find((b) => b.id === 'talk')!
    expect(talk.enabled).toBe(false)
    expect(talk.command).toBeNull()
  })

  it('answers keep their provenance line; a long explanation drops suggestions first, then is shortened and says so', () => {
    const shortAnswer = layoutSpatial(xr({ assistant: STATES.answered('synthetic') }), 0, measure)
    inside(shortAnswer)
    expect(shortAnswer.clamped).toBe(false)
    expect(shortAnswer.lines.some((t) => t.text.startsWith('Synthetic demo · not a live Meta response'))).toBe(true)
    expect(ids(shortAnswer).some((id) => id.startsWith('suggestion:'))).toBe(true)
    const answered = (explanation: string) => {
      const r = response('synthetic')
      r.proposal = { ...r.proposal, explanation }
      return xr({ assistant: { kind: 'answered', requestId: 'r', prompt: 'Explain', response: r } })
    }
    // The protocol's longest explanation (700 characters) fits once the suggestions step aside.
    const max = layoutSpatial(answered('word '.repeat(140).trim()), 0, measure)
    inside(max)
    expect(max.clamped).toBe(false)
    expect(ids(max).some((id) => id.startsWith('suggestion:'))).toBe(false)
    expect(max.lines.some((t) => t.text.startsWith('Synthetic demo · not a live Meta response'))).toBe(true)
    // Beyond what fits: shortened, and the panel says where the rest is.
    const over = layoutSpatial(answered('word '.repeat(400).trim()), 0, measure)
    inside(over)
    expect(over.clamped).toBe(true)
    expect(over.lines.some((t) => /full explanation is in the desktop panel/.test(t.text))).toBe(true)
    expect(over.lines.some((t) => t.text.startsWith('Synthetic demo · not a live Meta response'))).toBe(true)
  })

  it('wrap never exceeds the width or the line budget and marks a cut', () => {
    const r = wrap('one two three four five six seven eight nine ten', 0.01, 0.08, 2, measure)
    expect(r.lines).toHaveLength(2)
    expect(r.cut).toBe(true)
    expect(r.lines[1]!.endsWith('…')).toBe(true)
    for (const line of r.lines) expect(measure(line, 0.01)).toBeLessThanOrEqual(0.08)
    expect(wrap('short', 0.01, 0.08, 2, measure)).toEqual({ lines: ['short'], cut: false })
  })
})
