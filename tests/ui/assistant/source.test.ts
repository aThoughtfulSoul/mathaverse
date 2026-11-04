// Source status and provenance (UI-REFINEMENT-SPEC section 7): the service status comes only from the
// capability record; an answer is labelled by its own response envelope, so a synthetic answer is never
// presented as live (whatever the configured mode says), and speech transcription is separate from assistant reasoning.

import { describe, expect, it } from 'vitest'
import { responseProvenance, sourceStatus, speechStatus, SOURCE_LABEL } from '../../../src/ui/assistant/source'
import { assistantView } from '../../../src/ui/assistant/view'
import { CAP, SPEECH, STATES, VOICE, docs, panelInput, response } from './helpers'

describe('service source status from capabilities', () => {
  it('maps each server mode to its status; verified-live only when the server says liveValidated', () => {
    expect(sourceStatus({ assistant: CAP.synthetic, speech: null })).toMatchObject({ label: SOURCE_LABEL.synthetic, secondary: SOURCE_LABEL.notConfigured, synthetic: true, canAsk: true })
    expect(sourceStatus({ assistant: CAP.forcedSynthetic, speech: null })).toMatchObject({ label: SOURCE_LABEL.synthetic, secondary: null, synthetic: true })
    expect(sourceStatus({ assistant: CAP.live, speech: null })).toMatchObject({ label: SOURCE_LABEL.unverified, synthetic: false, canAsk: true })
    expect(sourceStatus({ assistant: { ...CAP.live, authenticated: true }, speech: null }).label).toBe(SOURCE_LABEL.unverified)
    expect(sourceStatus({ assistant: CAP.liveVerified, speech: null }).label).toBe(SOURCE_LABEL.verified)
    expect(sourceStatus({ assistant: CAP.unavailable, speech: null })).toMatchObject({ label: SOURCE_LABEL.unavailable, canAsk: false })
    expect(sourceStatus({ assistant: null, speech: null }).label).toBe(SOURCE_LABEL.unavailable)
    expect(sourceStatus(null).kind).toBe('checking')
  })

  it('opening the panel or configuring credentials does not establish a live call', () => {
    for (const cap of [CAP.synthetic, CAP.forcedSynthetic, CAP.live]) {
      const s = sourceStatus({ assistant: cap, speech: null })
      expect(s.kind).not.toBe('live-verified')
      expect(s.label).not.toBe(SOURCE_LABEL.verified)
    }
  })

  it('never carries credentials (the capability record has none; the model name is the only identifier shown)', () => {
    const s = sourceStatus({ assistant: CAP.live, speech: null })
    expect(s.detail).toContain('muse-spark-1.3')
    expect(JSON.stringify(s)).not.toMatch(/key|token|secret/i)
  })
})

describe('answer provenance from the response envelope', () => {
  it('synthetic answers are labelled synthetic and never live; only a meta envelope is a live Meta response', () => {
    const syn = responseProvenance(response('synthetic'))
    expect(syn.live).toBe(false)
    expect(syn.label).toBe('Synthetic demo · not a live Meta response')
    expect(syn.detail).toContain('apply-again')
    const meta = responseProvenance(response('meta'))
    expect(meta.live).toBe(true)
    expect(meta.detail).toContain('muse-spark-1.3')
  })

  it('a synthetic answer stays synthetic even when the server is configured for live calls', () => {
    const doc = docs().sculpture
    for (const st of [STATES.applied('synthetic'), STATES.answered('synthetic'), STATES.stale, STATES.rejected('synthetic')]) {
      const v = assistantView(panelInput(doc, { assistant: st, capability: { assistant: CAP.liveVerified, speech: SPEECH } }))
      expect(v.exchange?.provenance?.live).toBe(false)
    }
    const v = assistantView(panelInput(doc, { assistant: STATES.answered('meta'), capability: { assistant: CAP.synthetic, speech: SPEECH } }))
    expect(v.exchange?.provenance?.live).toBe(true)
  })

  it('no provenance is shown while pending, on error or cancel (nothing was answered)', () => {
    const doc = docs().sculpture
    for (const st of [STATES.pending, STATES.error('network', true), STATES.canceled]) expect(assistantView(panelInput(doc, { assistant: st })).exchange?.provenance).toBeNull()
  })
})

describe('speech provenance', () => {
  it('Meta transcription is separate from assistant reasoning', () => {
    const s = speechStatus({ capability: { assistant: CAP.synthetic, speech: SPEECH }, voice: { kind: 'idle' } })
    expect(s.label).toMatch(/Meta speech-to-text transcription/)
    expect(`${s.label} ${s.detail}`).not.toMatch(/Muse/)
    const v = assistantView(panelInput(docs().pq, { voice: VOICE.transcriptDesktop }))
    expect(v.voice.transcript?.source).toMatch(/^Meta transcription · /)
    expect(`${v.voice.status} ${v.voice.transcript?.source}`).not.toMatch(/Muse/)
    expect(v.status.text).not.toMatch(/Muse|reason/i)
    expect(assistantView(panelInput(docs().pq, { voice: VOICE.transcribing })).status.text).not.toMatch(/Muse|think/i)
  })

  it('unavailable speech names its reason', () => {
    expect(speechStatus({ capability: { assistant: null, speech: { ...SPEECH, mode: 'unavailable', configured: false, problem: 'ffmpeg was not found' } }, voice: { kind: 'idle' } })).toMatchObject({ available: false, detail: expect.stringContaining('ffmpeg') })
    expect(speechStatus({ capability: null, voice: VOICE.unavailable }).available).toBe(false)
  })
})
