// The orb's phase comes only from the voice and assistant clients' real states: every transition, that
// "thinking" needs a real pending request, that "applied" blooms once per applied result (timed from the event,
// never for a result that was already there), and that an error dims only while it is the latest event.

import { describe, expect, it } from 'vitest'
import type { AssistantState } from '../../../src/assistant/client'
import type { VoiceState } from '../../../src/voice/client'
import { APPLIED_BLOOM_MS, type OrbMemory, initialMemory, observe, orbPhase } from '../../../src/ui/orb/state'
import { createOrbSource, type OrbAssistant, type OrbVoice } from '../../../src/ui/orb/source'

const V = {
  idle: (): VoiceState => ({ kind: 'idle' }),
  recording: (): VoiceState => ({ kind: 'recording', startedAt: 1 }),
  transcribing: (): VoiceState => ({ kind: 'transcribing', requestId: 'v1', durationMs: 1500 }),
  transcript: (): VoiceState => ({ kind: 'transcript', text: 'rotate', response: {} as never, autoSubmitAt: null }),
  submitted: (): VoiceState => ({ kind: 'submitted', text: 'rotate' }),
  error: (): VoiceState => ({ kind: 'error', code: 'too_short', message: 'That recording was too short.' }),
  canceled: (): VoiceState => ({ kind: 'canceled' }),
  unavailable: (): VoiceState => ({ kind: 'unavailable', reason: 'no microphone' }),
}
const A = {
  idle: (): AssistantState => ({ kind: 'idle' }),
  pending: (id = 'r1'): AssistantState => ({ kind: 'pending', requestId: id, prompt: 'q', startedAt: 0 }),
  applied: (id = 'r1'): AssistantState => ({ kind: 'applied', requestId: id, prompt: 'q', response: {} as never, summary: ['done'], sceneChangeMs: 10 }),
  answered: (id = 'r1'): AssistantState => ({ kind: 'answered', requestId: id, prompt: 'q', response: {} as never }),
  stale: (id = 'r1'): AssistantState => ({ kind: 'stale', requestId: id, prompt: 'q', response: {} as never, reason: 'changed' }),
  error: (id = 'r1'): AssistantState => ({ kind: 'error', requestId: id, prompt: 'q', error: { code: 'network', message: 'down', retryable: true } }),
  canceled: (id = 'r1'): AssistantState => ({ kind: 'canceled', requestId: id, prompt: 'q' }),
}

/** A little timeline: observe states at times and read the phase. */
function timeline(voice = V.idle(), assistant = A.idle()) {
  let m: OrbMemory = initialMemory(voice, assistant)
  let v = voice
  let a = assistant
  let acquiring = false
  let t = 0
  return {
    at(ms: number) {
      t = ms
      return this
    },
    voice(s: VoiceState, acq = false) {
      v = s
      acquiring = acq
      m = observe(m, v, a, acquiring, t)
      return this
    },
    acquiring(on: boolean) {
      acquiring = on
      m = observe(m, v, a, acquiring, t)
      return this
    },
    assistant(s: AssistantState) {
      a = s
      m = observe(m, v, a, acquiring, t)
      return this
    },
    phase(ms = t) {
      return orbPhase(m, ms)
    },
    get memory() {
      return m
    },
  }
}

describe('orb phase from the clients', () => {
  it('idle with no voice activity and no pending request', () => {
    expect(timeline().phase()).toBe('idle')
    for (const v of [V.idle(), V.transcript(), V.submitted(), V.canceled(), V.unavailable()]) expect(timeline(v).phase()).toBe('idle')
    for (const a of [A.answered(), A.stale(), A.canceled()]) expect(timeline(V.idle(), a).phase()).toBe('idle')
  })

  it('listening only while recording (not while the microphone is still being requested)', () => {
    const t = timeline()
    t.acquiring(true)
    expect(t.phase()).toBe('idle')
    t.voice(V.recording())
    expect(t.phase()).toBe('listening')
  })

  it('transcribing after release while the transcript request is in flight, then idle with the transcript', () => {
    const t = timeline().voice(V.recording()).voice(V.transcribing())
    expect(t.phase()).toBe('transcribing')
    t.voice(V.transcript())
    expect(t.phase()).toBe('idle')
  })

  it('thinking requires a real pending request', () => {
    // A submitted transcript is not a request yet (the context is still being prepared): no thinking.
    const t = timeline().voice(V.submitted())
    expect(t.phase()).toBe('idle')
    t.assistant(A.pending())
    expect(t.phase()).toBe('thinking')
    for (const a of [A.answered(), A.stale(), A.canceled(), A.idle()]) expect(timeline(V.idle(), a).phase()).not.toBe('thinking')
  })

  it('a recording takes over from a pending request, and the request shows again after it', () => {
    const t = timeline().assistant(A.pending()).voice(V.recording())
    expect(t.phase()).toBe('listening')
    t.voice(V.canceled())
    expect(t.phase()).toBe('thinking')
  })

  it('applied blooms once when a result becomes applied, then settles to idle after about 1.2 s', () => {
    const t = timeline().at(1000).assistant(A.pending('r1')).at(3000).assistant(A.applied('r1'))
    expect(t.phase(3000)).toBe('applied')
    expect(t.phase(3000 + APPLIED_BLOOM_MS - 1)).toBe('applied')
    expect(t.phase(3000 + APPLIED_BLOOM_MS)).toBe('idle')
    expect(APPLIED_BLOOM_MS).toBeGreaterThanOrEqual(1000)
    expect(APPLIED_BLOOM_MS).toBeLessThanOrEqual(1500)
  })

  it('the same applied result never blooms twice (re-emitted, or an equal state object)', () => {
    const t = timeline().at(0).assistant(A.pending('r1')).at(100).assistant(A.applied('r1'))
    const first = t.memory.bloom
    t.at(5000).assistant(A.applied('r1')) // a new object for the same result
    expect(t.memory.bloom).toBe(first)
    expect(t.phase(5000)).toBe('idle')
  })

  it('each new applied result blooms again', () => {
    const t = timeline().at(0).assistant(A.applied('r1'))
    expect(t.phase(0)).toBe('applied')
    t.at(4000).assistant(A.pending('r2'))
    expect(t.phase()).toBe('thinking')
    t.at(6000).assistant(A.applied('r2'))
    expect(t.phase(6000)).toBe('applied')
    expect(t.phase(6000 + APPLIED_BLOOM_MS)).toBe('idle')
  })

  it('an applied result already present when observation starts never blooms', () => {
    const t = timeline(V.idle(), A.applied('old'))
    expect(t.phase(0)).toBe('idle')
    t.at(10).voice(V.idle())
    expect(t.phase(10)).toBe('idle')
  })

  it('re-observing identical states returns the same memory (no allocation per frame)', () => {
    const v = V.idle()
    const a = A.idle()
    const m = initialMemory(v, a)
    expect(observe(m, v, a, false, 123)).toBe(m)
  })

  it('error when the latest voice or assistant event is an error', () => {
    expect(timeline().voice(V.recording()).voice(V.transcribing()).voice(V.error()).phase()).toBe('error')
    expect(timeline().assistant(A.pending()).assistant(A.error()).phase()).toBe('error')
    // From the start (both clients already in an error state).
    expect(timeline(V.error(), A.idle()).phase()).toBe('error')
    expect(timeline(V.idle(), A.error()).phase()).toBe('error')
  })

  it('an error is not shown once a later event replaced it', () => {
    // Voice error, then a typed request that is applied: bloom, then idle (not the old voice error).
    const t = timeline().at(0).voice(V.error())
    expect(t.phase()).toBe('error')
    t.at(100).assistant(A.pending('r1')).at(900).assistant(A.applied('r1'))
    expect(t.phase(900)).toBe('applied')
    expect(t.phase(900 + APPLIED_BLOOM_MS + 1)).toBe('idle')
    // Assistant error, then a new recording that is canceled: idle.
    const u = timeline().assistant(A.error()).voice(V.recording())
    expect(u.phase()).toBe('listening')
    u.voice(V.canceled())
    expect(u.phase()).toBe('idle')
    // A new utterance begins after a voice error: while the microphone is requested the error is not shown.
    const w = timeline().voice(V.error()).acquiring(true)
    expect(w.phase()).toBe('idle')
  })

  it('a pending request beats an earlier voice error, and a voice error after a result dims', () => {
    const t = timeline().voice(V.error()).assistant(A.pending())
    expect(t.phase()).toBe('thinking')
    const u = timeline().at(0).assistant(A.applied('r1')).at(5000).voice(V.error())
    expect(u.phase(5000)).toBe('error')
  })

  it('a later voice event inside the bloom window ends the bloom for good: listening, then error, never applied again', () => {
    // Review finding: a quick Talk tap 200 ms after the result (recording, release, too-short error) went back to
    // 'applied' for the same result and covered the newer voice error until the window ended.
    const t = timeline().at(0).assistant(A.pending('r1')).at(1000).assistant(A.applied('r1'))
    expect(t.phase(1000)).toBe('applied')
    t.at(1200).voice(V.recording())
    expect(t.phase(1200)).toBe('listening')
    t.at(1300).voice(V.transcribing())
    expect(t.phase(1300)).toBe('transcribing')
    t.at(1320).voice(V.error())
    for (const ms of [1320, 1500, 1000 + APPLIED_BLOOM_MS - 1, 1000 + APPLIED_BLOOM_MS + 1]) expect(t.phase(ms), `at ${ms}`).toBe('error')
    // Even an error that was canceled straight away, inside the window: idle, not the old bloom.
    const u = timeline().at(0).assistant(A.applied('r1')).at(100).voice(V.recording()).at(150).voice(V.canceled())
    expect(u.phase(150)).toBe('idle')
    expect(u.phase(600)).toBe('idle')
  })

  it('a press on Talk inside the bloom window (the microphone requested) ends the bloom', () => {
    const t = timeline().at(0).assistant(A.applied('r1')).at(300).acquiring(true)
    expect(t.phase(300)).toBe('idle')
    t.at(350).acquiring(false) // the request was canceled before a recording began
    expect(t.phase(350)).toBe('idle')
    expect(t.phase(APPLIED_BLOOM_MS - 1)).toBe('idle')
  })

  it('the same result re-emitted after the bloom ended never blooms again, even inside its window', () => {
    const t = timeline().at(0).assistant(A.applied('r1')).at(100).voice(V.recording()).at(200).voice(V.canceled())
    t.at(300).assistant(A.applied('r1')) // a new object for the same result, now the latest event again
    expect(t.phase(300)).toBe('idle')
    // Another assistant state in the window ends it too, and coming back to the same result does not bloom.
    const u = timeline().at(0).assistant(A.applied('r1')).at(100).assistant(A.idle())
    expect(u.phase(100)).toBe('idle')
    u.at(200).assistant(A.applied('r1'))
    expect(u.phase(200)).toBe('idle')
    // A re-emitted equal result while the bloom runs neither restarts nor ends it.
    const w = timeline().at(0).assistant(A.applied('r1')).at(500).assistant(A.applied('r1'))
    expect(w.phase(500)).toBe('applied')
    expect(w.phase(APPLIED_BLOOM_MS)).toBe('idle')
  })

  it('a new result after an ended bloom blooms as usual', () => {
    const t = timeline().at(0).assistant(A.applied('r1')).at(100).voice(V.error())
    expect(t.phase(100)).toBe('error')
    t.at(200).assistant(A.pending('r2')).at(400).assistant(A.applied('r2'))
    expect(t.phase(400)).toBe('applied')
    expect(t.phase(400 + APPLIED_BLOOM_MS)).toBe('idle')
  })
})

describe('orb source', () => {
  function clients() {
    const vl = new Set<(s: VoiceState) => void>()
    const al = new Set<(s: AssistantState) => void>()
    let level = 0
    const voice: Omit<OrbVoice, 'state'> & { state: VoiceState; set(s: VoiceState): void; setLevel(l: number): void; listeners: number } = {
      state: V.idle(),
      acquiring: false,
      subscribe: (fn) => {
        vl.add(fn)
        return () => void vl.delete(fn)
      },
      inputLevel: () => level,
      set(s) {
        this.state = s
        vl.forEach((f) => f(s))
      },
      setLevel(l) {
        level = l
      },
      get listeners() {
        return vl.size + al.size
      },
    }
    const assistant: Omit<OrbAssistant, 'state'> & { state: AssistantState; set(s: AssistantState): void } = {
      state: A.idle(),
      subscribe: (fn) => {
        al.add(fn)
        return () => void al.delete(fn)
      },
      set(s) {
        this.state = s
        al.forEach((f) => f(s))
      },
    }
    return { voice, assistant }
  }

  it('times a bloom from the event, even when nobody read the phase then (a hidden orb never blooms late)', () => {
    let now = 0
    const { voice, assistant } = clients()
    const src = createOrbSource({ voice, assistant, now: () => now })
    assistant.set(A.pending('r1'))
    now = 1000
    assistant.set(A.applied('r1'))
    now = 1000 + APPLIED_BLOOM_MS + 500 // the orb is shown only now
    expect(src.phase()).toBe('idle')
    src.dispose()
  })

  it('reads the recording level only from the voice client, clamped to 0..1', () => {
    const { voice, assistant } = clients()
    const src = createOrbSource({ voice, assistant })
    voice.setLevel(0.42)
    expect(src.level()).toBe(0.42)
    voice.setLevel(7)
    expect(src.level()).toBe(1)
    voice.setLevel(Number.NaN)
    expect(src.level()).toBe(0)
  })

  it('gives the identity of the latest bloom (the applied requestId), which a later event does not change', () => {
    let now = 0
    const { voice, assistant } = clients()
    const src = createOrbSource({ voice, assistant, now: () => now })
    expect(src.bloom()).toBeNull()
    assistant.set(A.applied('r1'))
    expect(src.phase()).toBe('applied')
    expect(src.bloom()).toBe('r1')
    now = 200
    voice.set(V.recording())
    expect(src.phase()).toBe('listening')
    voice.set(V.error())
    expect(src.phase()).toBe('error')
    expect(src.bloom()).toBe('r1')
    assistant.set(A.applied('r2'))
    expect(src.bloom()).toBe('r2')
    src.dispose()
  })

  it('follows the clients and unsubscribes on dispose', () => {
    const { voice, assistant } = clients()
    const src = createOrbSource({ voice, assistant })
    expect(voice.listeners).toBe(2)
    voice.set(V.recording())
    expect(src.phase()).toBe('listening')
    voice.set(V.transcribing())
    expect(src.phase()).toBe('transcribing')
    src.dispose()
    expect(voice.listeners).toBe(0)
  })
})
