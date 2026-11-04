// Regression for the review finding "the same applied result can bloom twice": the real VoiceClient (test fakes)
// and createOrbSource driving OrbMotion frame by frame. A quick Talk tap right after a result (press, release,
// too-short error) ends the bloom: the newer voice error wins at once and the result never blooms again.

import { beforeEach, describe, expect, it } from 'vitest'
import { VoiceClient } from '../../../src/voice/client'
import type { AssistantState } from '../../../src/assistant/client'
import { createOrbSource } from '../../../src/ui/orb/source'
import { ORB_LOOKS, OrbMotion } from '../../../src/ui/orb/motion'
import { APPLIED_BLOOM_MS, type OrbPhase } from '../../../src/ui/orb/state'
import { FakeRecorder, META_CAPABILITY, controlledFetch, fakeMedia, flush } from '../../voice/fakes'

class StubAssistant {
  state: AssistantState = { kind: 'idle' }
  private readonly listeners = new Set<(s: AssistantState) => void>()
  subscribe(f: (s: AssistantState) => void) {
    this.listeners.add(f)
    return () => void this.listeners.delete(f)
  }
  set(s: AssistantState) {
    this.state = s
    this.listeners.forEach((f) => f(s))
  }
}

let clock = 0
beforeEach(() => {
  clock = 1000
  FakeRecorder.instances = []
})

function rig(withIdentity: boolean) {
  const media = fakeMedia()
  const net = controlledFetch()
  const assistant = new StubAssistant()
  const voice = new VoiceClient({ submit: () => {}, fetch: net.fetchImpl, getUserMedia: media.getUserMedia, Recorder: FakeRecorder as unknown as typeof MediaRecorder, AudioContext: null, now: () => clock })
  voice.setCapability(META_CAPABILITY)
  const src = createOrbSource({ voice, assistant, now: () => clock })
  const motion = new OrbMotion()
  const phases: OrbPhase[] = []
  let overshoots = 0
  let prev = 0
  const frame = (ms = 16) => {
    clock += ms
    const p = src.phase()
    motion.step(ms / 1000, p, src.level(), false, withIdentity ? src.bloom() : undefined)
    // The overshoot sets the radius above the applied look's; easing alone only moves toward it.
    if (motion.radius > ORB_LOOKS.applied.radius + 0.05 && motion.radius > prev + 0.05) overshoots++
    prev = motion.radius
    if (phases[phases.length - 1] !== p) phases.push(p)
    return p
  }
  return { voice, assistant, src, motion, frame, phases, get overshoots() { return overshoots } }
}

describe('orb flow with the real voice client', () => {
  for (const withIdentity of [true, false]) {
    it(`a quick Talk tap inside the bloom window: one bloom, then listening, transcribing, error (${withIdentity ? 'with' : 'without'} the bloom identity)`, async () => {
      const r = rig(withIdentity)
      r.assistant.set({ kind: 'pending', requestId: 'r1', prompt: 'q', startedAt: clock })
      r.frame()
      r.assistant.set({ kind: 'applied', requestId: 'r1', prompt: 'q', response: {} as never, summary: [], sceneChangeMs: 1 })
      const appliedAt = clock
      expect(r.frame()).toBe('applied')
      for (let i = 0; i < 10; i++) r.frame()
      await r.voice.start()
      expect(r.frame()).toBe('listening')
      for (let i = 0; i < 5; i++) r.frame()
      r.voice.stop()
      expect(r.frame()).toBe('transcribing')
      await flush()
      expect(r.voice.state.kind).toBe('error')
      expect(clock - appliedAt).toBeLessThan(APPLIED_BLOOM_MS) // still inside the old bloom's window
      // The newer voice error wins at once, for the rest of the window and after it.
      while (clock - appliedAt < APPLIED_BLOOM_MS + 200) expect(r.frame()).toBe('error')
      expect(r.phases).toEqual(['thinking', 'applied', 'listening', 'transcribing', 'error'])
      expect(r.overshoots).toBe(1)
      r.src.dispose()
      r.voice.dispose()
    })
  }
})
