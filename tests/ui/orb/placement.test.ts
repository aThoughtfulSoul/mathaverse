// The orb's place: on the stage for the whole spoken exchange (microphone request, recording, transcription, a
// transcript waiting to be sent, the pending request, the bloom), with a linger so the hand-offs between those
// states never send it back and forth; at rest otherwise.

import { describe, expect, it } from 'vitest'
import type { AssistantState } from '../../../src/assistant/client'
import type { VoiceState } from '../../../src/voice/client'
import { OrbPlacement, STAGE_LINGER_MS, wantsStage } from '../../../src/ui/orb/placement'
import { createOrbSource, type OrbAssistant, type OrbVoice } from '../../../src/ui/orb/source'
import { APPLIED_BLOOM_MS, type OrbPhase } from '../../../src/ui/orb/state'

describe('wantsStage', () => {
  const idle: Pick<VoiceState, 'kind'> = { kind: 'idle' }
  it('the active phases are on the stage, idle and error are not', () => {
    const on: OrbPhase[] = ['listening', 'transcribing', 'thinking', 'applied']
    for (const p of on) expect(wantsStage(p, idle, false), p).toBe(true)
    expect(wantsStage('idle', idle, false)).toBe(false)
    expect(wantsStage('error', idle, false)).toBe(false)
  })
  it('a transcript waiting to be sent and a microphone request are on the stage', () => {
    expect(wantsStage('idle', { kind: 'transcript' }, false)).toBe(true)
    expect(wantsStage('idle', idle, true)).toBe(true)
    expect(wantsStage('idle', { kind: 'submitted' }, false)).toBe(false)
    expect(wantsStage('error', { kind: 'error' }, false)).toBe(false)
  })
})

describe('OrbPlacement', () => {
  it('enters at once and leaves only after the linger', () => {
    const p = new OrbPlacement()
    expect(p.update(false, 0)).toBe('rest')
    expect(p.update(true, 100)).toBe('stage')
    expect(p.update(false, 100 + STAGE_LINGER_MS - 1)).toBe('stage')
    expect(p.update(false, 100 + STAGE_LINGER_MS)).toBe('rest')
  })
  it('a short gap between staged states never sends it back', () => {
    const p = new OrbPlacement()
    p.update(true, 0) // transcribing
    expect(p.update(false, 200)).toBe('stage') // a gap (e.g. submitted before pending)
    expect(p.update(true, 300)).toBe('stage') // thinking
    expect(p.update(false, 300 + STAGE_LINGER_MS - 1)).toBe('stage')
    expect(p.update(false, 300 + STAGE_LINGER_MS)).toBe('rest')
  })
  it('snap takes the current place with no linger', () => {
    const p = new OrbPlacement()
    p.update(true, 0)
    expect(p.snap(false, 10)).toBe('rest')
    expect(p.update(false, 11)).toBe('rest')
    expect(p.snap(true, 20)).toBe('stage')
    expect(p.update(false, 21)).toBe('stage')
  })
})

describe('createOrbSource().stage()', () => {
  function fakes() {
    let vs: VoiceState = { kind: 'idle' }
    let as: AssistantState = { kind: 'idle' }
    let acquiring = false
    const vl = new Set<(s: VoiceState) => void>()
    const al = new Set<(s: AssistantState) => void>()
    const voice: OrbVoice = {
      get state() {
        return vs
      },
      get acquiring() {
        return acquiring
      },
      subscribe: (fn) => (vl.add(fn), () => vl.delete(fn)),
      inputLevel: () => 0,
    }
    const assistant: OrbAssistant = {
      get state() {
        return as
      },
      subscribe: (fn) => (al.add(fn), () => al.delete(fn)),
    }
    return {
      voice, assistant,
      setVoice(s: VoiceState, acq = false) {
        vs = s
        acquiring = acq
        vl.forEach((f) => f(s))
      },
      setAssistant(s: AssistantState) {
        as = s
        al.forEach((f) => f(s))
      },
    }
  }

  it('follows a whole spoken exchange', () => {
    let t = 0
    const f = fakes()
    const src = createOrbSource({ voice: f.voice, assistant: f.assistant, now: () => t })
    expect(src.stage()).toBe(false)
    f.setVoice({ kind: 'idle' }, true)
    expect(src.stage()).toBe(true) // microphone requested
    f.setVoice({ kind: 'recording', startedAt: 0 })
    expect(src.stage()).toBe(true)
    f.setVoice({ kind: 'transcribing', requestId: 'v', durationMs: 1000 })
    expect(src.stage()).toBe(true)
    f.setVoice({ kind: 'transcript', text: 'q', response: {} as never, autoSubmitAt: 2500 })
    expect(src.phase()).toBe('idle')
    expect(src.stage()).toBe(true) // waiting to be sent
    f.setVoice({ kind: 'submitted', text: 'q' })
    f.setAssistant({ kind: 'pending', requestId: 'r', prompt: 'q', startedAt: 0 })
    expect(src.stage()).toBe(true)
    t = 1000
    f.setAssistant({ kind: 'applied', requestId: 'r', prompt: 'q', response: {} as never, summary: [], sceneChangeMs: 1 })
    expect(src.phase()).toBe('applied')
    expect(src.stage()).toBe(true)
    t = 1000 + APPLIED_BLOOM_MS
    expect(src.stage()).toBe(false)
  })

  it('a voice error is not on the stage (the placement linger shows it there briefly)', () => {
    const f = fakes()
    const src = createOrbSource({ voice: f.voice, assistant: f.assistant, now: () => 0 })
    f.setVoice({ kind: 'recording', startedAt: 0 })
    f.setVoice({ kind: 'error', code: 'too_short', message: 'short' })
    expect(src.phase()).toBe('error')
    expect(src.stage()).toBe(false)
  })
})
