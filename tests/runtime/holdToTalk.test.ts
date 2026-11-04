// Controller hold-to-talk (src/runtime/input.ts): A/X held for HOLD_TO_TALK is push-to-talk, a shorter press is a
// tap (play/pause, now sent on release), B/Y cancels a recording, a controller that disconnects or a session that
// ends mid-hold cancels it, and a hold whose recording ended some other way lets go of A/X. Part 1 drives the real Input with fake XR input sources and gamepads. Part 2 runs the
// same frames through HoldToTalk into the real UiController and the real VoiceClient (fake microphone, recorder and
// fetch), with the app's old A/B mapping as the fallback, exactly as App.onEvent orders them. Node only; no WebGL.
// Every transcript here is SYNTHETIC test data, never provider output.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Group, PerspectiveCamera, Scene } from 'three'
import { HOLD_TO_TALK, HoldToTalk, Input, holdToTalkBlocked, type PointerEventKind, type PointerId, type QueuedEvent, type VoiceGateInput } from '../../src/runtime/input'
import { UiController, type ControllerDeps } from '../../src/ui/controller'
import type { UiCommand, UiView } from '../../src/ui/model'
import { VoiceClient } from '../../src/voice/client'
import { demoDocument } from '../../src/workspace/document'
import { Workspace } from '../../src/workspace/reducer'
import type { SpeechCapability } from '../../server/types'
import { FakeRecorder, META_CAPABILITY, controlledFetch, fakeMedia, flush } from '../voice/fakes'

type Hand = 'left' | 'right'
const A = 4
const B = 5

function gamepad() {
  const buttons = Array.from({ length: 7 }, () => ({ pressed: false, touched: false, value: 0 }))
  const pulses: [number, number][] = []
  // Quest Browser's pulse() promise may never settle: this one never does.
  const hapticActuators = [{ pulse: (v: number, ms: number) => (pulses.push([v, ms]), new Promise<boolean>(() => {})) }]
  return { buttons, hapticActuators, pulses }
}

/** The real Input with two tracked controllers (slot 0 right, slot 1 left). Times are host milliseconds. */
function rig() {
  const rays = [new Group(), new Group()]
  const grips = [new Group(), new Group()]
  const domElement = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setPointerCapture: () => undefined,
  })
  const frame = { getPose: () => ({ emulatedPosition: false }) }
  const renderer = { xr: { getController: (i: number) => rays[i]!, getControllerGrip: (i: number) => grips[i]!, getFrame: () => frame, getReferenceSpace: () => ({}) }, domElement }
  const input = new Input(renderer as never, new PerspectiveCamera(), new Scene())
  const pads = { right: gamepad(), left: gamepad() }
  const source = (hand: Hand) => ({ handedness: hand, targetRayMode: 'tracked-pointer', gamepad: pads[hand], targetRaySpace: {}, gripSpace: {} })
  const slot = { right: 0, left: 1 } as const
  const connect = (hand: Hand) => rays[slot[hand]]!.dispatchEvent({ type: 'connected', data: source(hand) } as never)
  const disconnect = (hand: Hand) => rays[slot[hand]]!.dispatchEvent({ type: 'disconnected', data: source(hand) } as never)
  connect('right')
  connect('left')
  const state = { presenting: true }
  const set = (hand: Hand, index: number, pressed: boolean) => {
    const b = pads[hand].buttons[index]!
    b.pressed = pressed
    b.value = pressed ? 1 : 0
  }
  /** One host frame at `ms`: the A/B events it produced. */
  const at = (ms: number): QueuedEvent[] => input.update(state.presenting, ms / 1000)
  return { input, pads, state, set, at, connect, disconnect }
}

const kinds = (events: QueuedEvent[]) => events.filter((e) => e.kind.startsWith('button') || e.kind === 'cancel').map((e) => `${e.pointer}:${e.kind}`)

describe('A/X tap or hold (Input)', () => {
  it('the hold time is 300 ms', () => {
    expect(HOLD_TO_TALK).toBe(0.3)
  })

  it('released after 299 ms: a tap, sent on release (not on press)', () => {
    const r = rig()
    r.at(990)
    r.set('right', A, true)
    expect(kinds(r.at(1000))).toEqual([]) // the press itself sends nothing now
    expect(kinds(r.at(1150))).toEqual([])
    expect(kinds(r.at(1299))).toEqual([])
    r.set('right', A, false)
    expect(kinds(r.at(1299.5))).toEqual(['right:buttonA'])
    expect(kinds(r.at(1400))).toEqual([])
  })

  it('a release seen 299 ms after the press is a tap', () => {
    const r = rig()
    r.set('right', A, true)
    r.at(1000)
    r.set('right', A, false)
    expect(kinds(r.at(1299))).toEqual(['right:buttonA'])
  })

  it('still pressed 300 ms after the press: one hold, then hold end on release, and no tap', () => {
    const r = rig()
    r.set('right', A, true)
    expect(kinds(r.at(1000))).toEqual([])
    expect(kinds(r.at(1299))).toEqual([])
    expect(kinds(r.at(1300))).toEqual(['right:buttonAHold'])
    expect(kinds(r.at(1311))).toEqual([])
    expect(kinds(r.at(2500))).toEqual([]) // once per press
    r.set('right', A, false)
    expect(kinds(r.at(2511))).toEqual(['right:buttonAHoldEnd'])
    expect(kinds(r.at(2522))).toEqual([])
  })

  it('at 90 Hz the hold arrives on the first frame at or after 300 ms', () => {
    const r = rig()
    r.set('left', A, true)
    const t0 = 1000
    const seen: { ms: number; events: string[] }[] = []
    for (let i = 0; i <= 40; i++) {
      const ms = t0 + (i * 1000) / 90
      const ev = kinds(r.at(ms))
      if (ev.length) seen.push({ ms, events: ev })
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]!.events).toEqual(['left:buttonAHold'])
    expect(seen[0]!.ms - t0).toBeGreaterThanOrEqual(300 - 1e-6)
    expect(seen[0]!.ms - t0).toBeLessThan(300 + 1000 / 90)
  })

  it('either hand: X on the left controller behaves like A on the right, independently', () => {
    const r = rig()
    r.set('left', A, true)
    r.at(1000)
    r.set('right', A, true)
    r.at(1100)
    expect(kinds(r.at(1300))).toEqual(['left:buttonAHold'])
    r.set('right', A, false)
    expect(kinds(r.at(1350))).toEqual(['right:buttonA'])
    r.set('left', A, false)
    expect(kinds(r.at(1400))).toEqual(['left:buttonAHoldEnd'])
  })

  it('B/Y still fires on press, from either hand', () => {
    const r = rig()
    r.set('right', B, true)
    expect(kinds(r.at(1000))).toEqual(['right:buttonB'])
    expect(kinds(r.at(1500))).toEqual([])
    r.set('right', B, false)
    expect(kinds(r.at(1600))).toEqual([])
    r.set('left', B, true)
    expect(kinds(r.at(1700))).toEqual(['left:buttonB'])
  })

  it('a controller that disconnects mid-hold cancels the hold (before the pointer cancel); no tap, no hold end', () => {
    const r = rig()
    r.set('right', A, true)
    r.at(1000)
    expect(kinds(r.at(1300))).toEqual(['right:buttonAHold'])
    r.disconnect('right')
    expect(kinds(r.at(1311))).toEqual(['right:buttonAHoldCancel', 'right:cancel'])
    r.set('right', A, false)
    expect(kinds(r.at(1322))).toEqual([])
  })

  it('a controller that disconnects before 300 ms sends nothing for A (it was never a tap or a hold)', () => {
    const r = rig()
    r.set('right', A, true)
    r.at(1000)
    r.disconnect('right')
    expect(kinds(r.at(1100))).toEqual(['right:cancel'])
    expect(kinds(r.at(1400))).toEqual([])
  })

  it('the session ending mid-hold cancels the hold', () => {
    const r = rig()
    r.set('left', A, true)
    r.at(1000)
    expect(kinds(r.at(1300))).toEqual(['left:buttonAHold'])
    r.state.presenting = false
    expect(kinds(r.at(1311))).toEqual(['left:buttonAHoldCancel'])
    r.set('left', A, false)
    expect(kinds(r.at(1322))).toEqual([])
  })

  it('a press that spans a hidden session (system UI) never becomes a hold, nor a tap after 300 ms', () => {
    const r = rig()
    r.set('right', A, true)
    r.at(1000)
    r.input.setSuspended(true)
    r.at(1100)
    r.input.setSuspended(false)
    expect(kinds(r.at(1400))).toEqual([])
    r.set('right', A, false)
    expect(kinds(r.at(1500))).toEqual([])
    // The next press is a normal one again.
    r.set('right', A, true)
    r.at(2000)
    expect(kinds(r.at(2300))).toEqual(['right:buttonAHold'])
  })

  it('a short tap during a suspended session is still a tap (unchanged play/pause)', () => {
    const r = rig()
    r.input.setSuspended(true)
    r.set('right', A, true)
    r.at(1000)
    r.set('right', A, false)
    expect(kinds(r.at(1100))).toEqual(['right:buttonA'])
  })

  it('nothing from the controllers while not presenting (desktop)', () => {
    const r = rig()
    r.state.presenting = false
    r.set('right', A, true)
    r.set('right', B, true)
    r.at(1000)
    expect(kinds(r.at(1500))).toEqual([])
    r.set('right', A, false)
    expect(kinds(r.at(1600))).toEqual([])
  })

  it('pulse() is fire-and-forget: it returns at once although the actuator promise never settles', () => {
    const r = rig()
    r.at(1000)
    expect(r.input.pulse('right', 2, 500)).toBe(true)
    expect(r.pads.right.pulses).toEqual([[1, 100]]) // clamped to [0, 1] and at most 100 ms
    expect(r.input.pulse('mouse')).toBe(false)
    r.disconnect('left')
    expect(r.input.pulse('left')).toBe(false)
  })
})

// ------------------------------------------------------------------ through the UI controller and the voice client

const UNAVAILABLE_SPEECH: SpeechCapability = { configured: false, liveValidated: false, mode: 'unavailable', provider: null, model: null, acceptedMimeTypes: [], problem: 'speech is not configured on the server' }

let clock = 0

function world(opts: { speech?: SpeechCapability; assistantMode?: 'meta' | 'synthetic' | 'unavailable'; noShell?: boolean; inspector?: 'math' | null } = {}) {
  const r = rig()
  const media = fakeMedia()
  const net = controlledFetch()
  const submitted: string[] = []
  const voice = new VoiceClient({ submit: (t) => submitted.push(t), fetch: net.fetchImpl, getUserMedia: media.getUserMedia, Recorder: FakeRecorder as unknown as typeof MediaRecorder, now: () => clock })
  const speech = opts.speech ?? META_CAPABILITY
  voice.setCapability(speech)
  const caps = { assistant: { configured: true, authenticated: false, liveValidated: false, model: 'test-model', mode: opts.assistantMode ?? 'synthetic' }, speech }
  const commands: string[] = []
  const workspace = new Workspace(demoDocument())
  const app = {
    workspace,
    demo: 'pq',
    mode: 'fiber',
    sceneProblem: null,
    scene: null,
    walkStage: 'walk',
    playback: { active: false, playing: false, step: null, phase: 'idle', time: 0, duration: 0 },
    snapshot: () => ({ dragging: null }),
    currentDescription: () => null,
    applyPresentation: () => {},
    transact: () => ({ summary: [], effects: [] }),
    command: (c: string) => commands.push(c),
    showDemo: () => ({ summary: [] }),
  }
  const frames: (() => void)[] = []
  const host = { presenting: true, sessionMode: 'vr', onSession: () => () => {}, onFrame: (fn: () => void) => (frames.push(fn), () => {}), passthroughSupported: async () => false }
  const assistant = { state: { kind: 'idle' }, busy: false, subscribe: () => () => {}, cancel: vi.fn(), ask: vi.fn(async () => {}), retry: vi.fn(async () => {}) }
  const evidence = { entries: [], subscribe: () => () => {}, check: vi.fn(async () => {}) }
  const ui = new UiController({
    app, host, assistant, voice, evidence,
    workspace: { save: async () => 'saved', reopen: async () => 'reopened', exportJson: () => '', importJson: () => {} },
    capabilities: () => caps,
  } as unknown as ControllerDeps)
  // The assistant inspector starts open (first visit); a test may start with it closed or showing the mathematics.
  if (opts.inspector !== undefined) ui.dispatch({ kind: 'inspector', which: opts.inspector })
  // What App.renderSpatialShell caches: the assistant part of each published view (and passes to hold-to-talk).
  let published: VoiceGateInput | null = null
  let lastView: UiView | null = null
  ui.subscribe((v) => {
    lastView = v
    published = { open: v.assistant.open, voice: v.assistant.voice, voiceAcquiring: v.assistant.voiceAcquiring, capability: v.assistant.capability }
    hold.viewed(published) // views are published from the frames below, after `hold` exists
  })
  const sent: UiCommand[] = []
  const dispatch = (c: UiCommand) => {
    sent.push(c)
    ui.dispatch(c)
  }
  const flags = { dragging: false }
  const pulses: PointerId[] = []
  const notes: { event: string; detail?: unknown }[] = []
  const hold = new HoldToTalk({
    dispatch: () => (opts.noShell ? null : dispatch),
    voice: () => published,
    dragging: () => flags.dragging,
    presenting: () => host.presenting,
    pulse: (p) => pulses.push(p),
    note: (event, detail) => notes.push({ event, detail }),
  })
  /** The app's old A/B mapping (App.onEvent after HoldToTalk declined the event): through the spatial shell, or the
   * app's own commands in the legacy controls. A declined hold end is a tap. */
  const fallback = (pointer: PointerId, kind: PointerEventKind) => {
    if (kind === 'buttonA' || kind === 'buttonAHoldEnd') opts.noShell ? app.command('toggle') : dispatch({ kind: 'playPause' })
    else if (kind === 'buttonB') opts.noShell ? app.command('replay') : dispatch({ kind: 'replay' })
    void pointer
  }
  /** App's onVisibility(false) handler, in its order: the input suspends, then hold-to-talk ends (src/app.ts). */
  const hidden = () => {
    r.input.setSuspended(true)
    hold.end('session-hidden')
  }
  const visible = () => r.input.setSuspended(false)
  /** One host frame: input, then events (hold-to-talk first), then the UI controller publishes. */
  const frame = (ms: number) => {
    clock = ms
    for (const e of r.at(ms)) if (!hold.handle(e.pointer, e.kind)) fallback(e.pointer, e.kind)
    frames.forEach((f) => f())
  }
  frame(900)
  const voiceSent = () => sent.filter((c) => c.kind === 'assistant')
  return { ...r, voice, media, net, submitted, ui, host, hold, sent, voiceSent, commands, flags, pulses, notes, frame, hidden, visible, assistant, published: () => published, lastView: () => lastView }
}

const START: UiCommand = { kind: 'assistant', action: { kind: 'voiceToggle' } }
const STOP: UiCommand = { kind: 'assistant', action: { kind: 'voiceStop' } }
const CANCEL: UiCommand = { kind: 'assistant', action: { kind: 'voiceCancel' } }
/** The toolbar's Ask Meta Muse AI command (src/ui/shell/logic.ts toolbarCommand). */
const OPEN: UiCommand = { kind: 'inspector', which: 'assistant' }

/** Press A/X on `hand` at `ms` and keep it held through the 300 ms frame; the microphone is granted. */
async function holdA(w: ReturnType<typeof world>, hand: Hand, ms: number) {
  w.set(hand, A, true)
  w.frame(ms)
  w.frame(ms + 300)
  await flush()
  w.frame(ms + 311)
}

beforeEach(() => {
  clock = 0
  FakeRecorder.instances = []
  FakeRecorder.supported = new Set(['audio/webm;codecs=opus', 'audio/webm'])
})
afterEach(() => vi.useRealTimers())

describe('hold-to-talk through the UI command path (HoldToTalk + UiController + VoiceClient)', () => {
  it('hold start dispatches the Talk control\'s start command once; the voice client records', async () => {
    const w = world()
    w.set('right', A, true)
    w.frame(1000)
    w.frame(1299)
    expect(w.voiceSent()).toEqual([])
    w.frame(1300)
    expect(w.voiceSent()).toEqual([START])
    await flush()
    for (let ms = 1311; ms < 2500; ms += 11) w.frame(ms)
    expect(w.voiceSent()).toEqual([START]) // once per hold
    expect(w.voice.state).toEqual({ kind: 'recording', startedAt: 1300 })
    expect(w.ui.view.assistant.voice.kind).toBe('recording')
    expect(w.pulses).toEqual(['right'])
    expect(w.commands).toEqual([]) // no play/pause
    expect(w.sent).toEqual([START]) // the panel was open: no inspector command (it would toggle the panel closed)
    expect(w.ui.store.state.inspector).toBe('assistant')
  })

  it('release dispatches voiceStop; the transcript then follows the XR Talk flow (sent after the auto-send delay)', async () => {
    const w = world()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await holdA(w, 'right', 1000)
    w.set('right', A, false)
    w.frame(2800)
    expect(w.voiceSent()).toEqual([START, STOP])
    expect(w.voice.state).toMatchObject({ kind: 'transcribing', durationMs: 1500 })
    expect(w.pulses).toEqual(['right', 'right'])
    await flush()
    expect(w.net.calls).toHaveLength(1)
    w.net.reply('replay the comparison') // synthetic test transcript
    await flush()
    expect(w.voice.state).toMatchObject({ kind: 'transcript', text: 'replay the comparison', autoSubmitAt: 2800 + 2500 })
    expect(w.submitted).toEqual([])
    vi.advanceTimersByTime(2500)
    expect(w.submitted).toEqual(['replay the comparison'])
    expect(w.commands).toEqual([])
  })

  it('a 299 ms press is a tap: play/pause on release, no voice command', async () => {
    const w = world()
    w.set('right', A, true)
    w.frame(1000)
    w.frame(1200)
    w.set('right', A, false)
    w.frame(1299)
    await flush()
    expect(w.voiceSent()).toEqual([])
    expect(w.sent).toEqual([{ kind: 'playPause' }])
    expect(w.commands).toEqual(['toggle'])
    expect(w.voice.state.kind).toBe('idle')
  })

  it('X on the left controller works the same', async () => {
    const w = world()
    await holdA(w, 'left', 1000)
    expect(w.voiceSent()).toEqual([START])
    w.set('left', A, false)
    w.frame(2000)
    expect(w.voiceSent()).toEqual([START, STOP])
    expect(w.pulses).toEqual(['left', 'left'])
  })

  it('a second hold (other hand) while one is recording starts nothing; its release stops nothing', async () => {
    const w = world()
    await holdA(w, 'right', 1000)
    w.set('left', A, true)
    w.frame(1400)
    w.frame(1700)
    await flush()
    expect(w.voiceSent()).toEqual([START])
    w.set('left', A, false)
    w.frame(1800)
    expect(w.voiceSent()).toEqual([START])
    expect(w.commands).toEqual([]) // an ignored hold is not a tap either
    expect(w.voice.state.kind).toBe('recording')
    w.set('right', A, false)
    w.frame(1900)
    expect(w.voiceSent()).toEqual([START, STOP])
  })

  it('B/Y while recording cancels it: nothing is uploaded or sent, and the later A release does nothing', async () => {
    const w = world()
    await holdA(w, 'right', 1000)
    w.set('left', B, true)
    w.frame(1500)
    expect(w.voiceSent()).toEqual([START, CANCEL])
    expect(w.voice.state.kind).toBe('canceled')
    expect(w.commands).toEqual([]) // no replay
    w.set('right', A, false)
    w.frame(1600)
    await flush()
    expect(w.voiceSent()).toEqual([START, CANCEL])
    expect(w.net.calls).toHaveLength(0)
    expect(w.submitted).toEqual([])
    expect(w.commands).toEqual([])
  })

  it('B/Y while waiting for the microphone cancels the request', async () => {
    const w = world()
    w.media.holdNext() // the permission prompt is showing
    w.set('right', A, true)
    w.frame(1000)
    w.frame(1300)
    w.frame(1311)
    expect(w.voice.acquiring).toBe(true)
    expect(w.ui.view.assistant.voiceAcquiring).toBe(true)
    w.set('right', B, true)
    w.frame(1400)
    expect(w.voiceSent()).toEqual([START, CANCEL])
    expect(w.voice.state.kind).toBe('canceled')
    w.media.grant()
    await flush()
    expect(w.voice.state.kind).toBe('canceled') // the late grant changes nothing
    expect(w.media.streams.every((s) => s.released)).toBe(true)
  })

  it('B/Y cancels a recording started by the Talk control, too', async () => {
    const w = world()
    w.ui.dispatch(START) // the XR Talk control
    await flush()
    w.frame(1000)
    expect(w.voice.state.kind).toBe('recording')
    w.set('right', B, true)
    w.frame(1100)
    expect(w.voiceSent()).toEqual([CANCEL])
    expect(w.voice.state.kind).toBe('canceled')
    expect(w.commands).toEqual([])
  })

  it('B/Y when nothing is recording keeps replay', async () => {
    const w = world()
    w.set('right', B, true)
    w.frame(1000)
    w.set('right', B, false)
    w.set('left', B, true)
    w.frame(1100)
    expect(w.voiceSent()).toEqual([])
    expect(w.sent).toEqual([{ kind: 'replay' }, { kind: 'replay' }])
    expect(w.commands).toEqual(['replay', 'replay'])
  })

  it('B/Y while a transcript waits to be sent keeps replay (the panel\'s Cancel handles that window)', async () => {
    const w = world()
    await holdA(w, 'right', 1000)
    w.set('right', A, false)
    w.frame(2800)
    await flush()
    w.net.reply('order demo') // synthetic test transcript
    await flush()
    w.frame(2900)
    expect(w.voice.state.kind).toBe('transcript')
    w.set('right', B, true)
    w.frame(3000)
    expect(w.voiceSent()).toEqual([START, STOP])
    expect(w.commands).toEqual(['replay'])
  })

  it('the controller disconnecting mid-hold cancels the recording; nothing is uploaded', async () => {
    const w = world()
    await holdA(w, 'right', 1000)
    w.disconnect('right')
    w.frame(1500)
    expect(w.voiceSent()).toEqual([START, CANCEL])
    expect(w.voice.state.kind).toBe('canceled')
    await flush()
    expect(w.net.calls).toHaveLength(0)
    expect(w.media.streams.every((s) => s.released)).toBe(true)
  })

  it('the session ending mid-hold cancels the recording once (App calls end(); the input then reports the lost hold)', async () => {
    const w = world()
    await holdA(w, 'left', 1000)
    // App's onSession(false) handler runs first, then frames continue without presenting.
    w.host.presenting = false
    w.hold.end('session-end')
    expect(w.voiceSent()).toEqual([START, CANCEL])
    w.frame(1500)
    w.disconnect('left')
    w.frame(1511)
    expect(w.voiceSent()).toEqual([START, CANCEL])
    expect(w.voice.state.kind).toBe('canceled')
  })

  it('the session ending mid-hold cancels the recording when only the input notices it', async () => {
    const w = world()
    await holdA(w, 'right', 1000)
    w.state.presenting = false // the Input sees no presenting frame
    w.frame(1500)
    expect(w.voiceSent()).toEqual([START, CANCEL])
    expect(w.voice.state.kind).toBe('canceled')
  })

  it('speech unavailable: a hold sends no voice command and is not a tap', async () => {
    const w = world({ speech: UNAVAILABLE_SPEECH })
    expect(w.voice.state.kind).toBe('unavailable')
    await holdA(w, 'right', 1000)
    w.set('right', A, false)
    w.frame(2000)
    expect(w.voiceSent()).toEqual([])
    expect(w.sent).toEqual([])
    expect(w.commands).toEqual([])
    expect(w.pulses).toEqual([])
    expect(w.voice.state.kind).toBe('unavailable')
    expect(w.notes.find((n) => n.event === 'voiceHoldIgnored')?.detail).toMatchObject({ reason: 'speech-unavailable' })
    // Taps keep working.
    w.set('right', A, true)
    w.frame(3000)
    w.set('right', A, false)
    w.frame(3100)
    expect(w.sent).toEqual([{ kind: 'playPause' }])
  })

  it('assistant unavailable (the Talk control shows "No voice"): a hold sends nothing', async () => {
    const w = world({ assistantMode: 'unavailable' })
    await holdA(w, 'right', 1000)
    expect(w.voiceSent()).toEqual([])
    expect(w.voice.state.kind).toBe('idle')
  })

  it('during a drag a hold sends nothing', async () => {
    const w = world()
    w.flags.dragging = true
    await holdA(w, 'right', 1000)
    w.set('right', A, false)
    w.frame(2000)
    expect(w.voiceSent()).toEqual([])
    expect(w.voice.state.kind).toBe('idle')
  })

  it('while a transcription runs a hold sends nothing (it does not cancel it)', async () => {
    const w = world()
    await holdA(w, 'right', 1000)
    w.set('right', A, false)
    w.frame(2800)
    await flush()
    w.frame(2811)
    expect(w.voice.state.kind).toBe('transcribing')
    await holdA(w, 'left', 3000)
    expect(w.voiceSent()).toEqual([START, STOP])
    expect(w.voice.state.kind).toBe('transcribing')
    expect(w.net.calls[0]!.signal.aborted).toBe(false)
  })

  it('without the spatial shell (legacy controls) a hold starts no recording and B keeps its old meaning', async () => {
    const w = world({ noShell: true })
    await holdA(w, 'right', 1000)
    expect(w.voiceSent()).toEqual([])
    expect(w.voice.state.kind).toBe('idle')
    expect(w.hold.handle('right', 'buttonB')).toBe(false)
  })
})

// ------------------------------------------------------------------ review findings (hold-to-talk fix pass)

describe('a hold with the assistant inspector not open opens it first (nothing records out of sight)', () => {
  for (const which of [null, 'math'] as const) {
    it(`inspector ${which === null ? 'closed' : "showing the mathematics"}: the hold opens the assistant, then records; the transcript is sent with the panel showing`, async () => {
      const w = world({ inspector: which })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      expect(w.ui.store.state.inspector).toBe(which)
      expect(w.published()?.open).toBe(false)
      w.set('right', A, true)
      w.frame(1000)
      w.frame(1299)
      expect(w.sent).toEqual([]) // nothing before the hold
      w.frame(1300)
      // The toolbar's command first, then the Talk control's; nothing else (no cancel of the opened panel).
      expect(w.sent).toEqual([OPEN, START])
      expect(w.ui.store.state.inspector).toBe('assistant')
      await flush()
      w.frame(1311)
      // What the spatial shell draws from: the assistant inspector (content and orb) with the listening state.
      expect(w.lastView()?.inspector).toBe('assistant')
      expect(w.published()).toMatchObject({ open: true, voice: { kind: 'recording' } })
      expect(w.notes.find((n) => n.event === 'voiceHoldStart')?.detail).toEqual({ pointer: 'right', openedPanel: true })
      expect(w.assistant.cancel).not.toHaveBeenCalled()
      w.set('right', A, false)
      w.frame(2800)
      expect(w.sent).toEqual([OPEN, START, STOP])
      await flush()
      w.net.reply('synthetic test words') // synthetic test transcript
      await flush()
      w.frame(2811)
      expect(w.published()).toMatchObject({ open: true, voice: { kind: 'transcript', autoSubmitAt: 2800 + 2500 } })
      vi.advanceTimersByTime(2500)
      expect(w.submitted).toEqual(['synthetic test words'])
      expect(w.ui.store.state.inspector).toBe('assistant')
      expect(w.commands).toEqual([]) // no play/pause
    })
  }

  it('an ignored hold (speech unavailable) with the panel closed opens nothing', async () => {
    const w = world({ speech: UNAVAILABLE_SPEECH, inspector: null })
    await holdA(w, 'right', 1000)
    w.set('right', A, false)
    w.frame(2000)
    expect(w.sent).toEqual([])
    expect(w.ui.store.state.inspector).toBeNull()
  })

  it('a hold during a drag with the mathematics inspector showing leaves it showing', async () => {
    const w = world({ inspector: 'math' })
    w.flags.dragging = true
    await holdA(w, 'left', 1000)
    expect(w.sent).toEqual([])
    expect(w.ui.store.state.inspector).toBe('math')
  })

  it('while the published view is out of date (an inspector press in the same frame) a hold neither toggles the panel nor records', () => {
    const sent: UiCommand[] = []
    const hold = new HoldToTalk({ dispatch: () => (c) => sent.push(c), voice: () => null, dragging: () => false, presenting: () => true })
    expect(hold.handle('right', 'buttonAHold')).toBe(true)
    expect(hold.handle('right', 'buttonAHoldEnd')).toBe(true)
    expect(sent).toEqual([])
  })
})

describe('a hold in progress ends when the session is hidden (system UI)', () => {
  it('hidden mid-hold: one voiceCancel at once; nothing is uploaded; the later release is neither a stop nor a tap', async () => {
    const w = world()
    await holdA(w, 'right', 1000)
    expect(w.voice.state.kind).toBe('recording')
    w.hidden()
    expect(w.voiceSent()).toEqual([START, CANCEL])
    expect(w.voice.state.kind).toBe('canceled')
    expect(w.notes.filter((n) => n.event === 'voiceHoldCancel').map((n) => n.detail)).toEqual([{ pointer: 'right', reason: 'session-hidden' }])
    // The system UI stays up for a while with A still pressed (a 'visible-blurred' session still runs frames).
    for (let ms = 1400; ms < 4100; ms += 11) w.frame(ms)
    w.visible()
    w.frame(4200)
    w.set('right', A, false)
    w.frame(4300)
    await flush()
    expect(w.voiceSent()).toEqual([START, CANCEL])
    expect(w.commands).toEqual([])
    expect(w.sent).toEqual([START, CANCEL])
    expect(w.net.calls).toHaveLength(0)
    expect(w.submitted).toEqual([])
    expect(w.media.streams.every((s) => s.released)).toBe(true)
    // The next hold records again.
    await holdA(w, 'right', 5000)
    expect(w.voiceSent()).toEqual([START, CANCEL, START])
    expect(w.voice.state.kind).toBe('recording')
  })

  it('hidden while the microphone is being requested: the request is cancelled and a late grant records nothing', async () => {
    const w = world()
    w.media.holdNext()
    w.set('left', A, true)
    w.frame(1000)
    w.frame(1300)
    expect(w.voice.acquiring).toBe(true)
    w.hidden()
    expect(w.voiceSent()).toEqual([START, CANCEL])
    w.media.grant()
    await flush()
    expect(w.voice.state.kind).toBe('canceled')
    expect(w.media.streams.every((s) => s.released)).toBe(true)
  })

  it('hidden, then the session ends: still a single voiceCancel', async () => {
    const w = world()
    await holdA(w, 'left', 1000)
    w.hidden()
    // App's onSession(false) handler, then the input sees the lost hold.
    w.host.presenting = false
    w.hold.end('session-end')
    w.state.presenting = false
    w.frame(1500)
    w.disconnect('left')
    w.frame(1511)
    expect(w.voiceSent()).toEqual([START, CANCEL])
    expect(w.commands).toEqual([])
  })

  it('a hidden session with no hold in progress sends nothing', () => {
    const w = world()
    w.hidden()
    w.frame(1000)
    expect(w.sent).toEqual([])
  })
})

describe('a hold whose recording ended some other way lets go of A/X (verify finding: stale hold hand)', () => {
  const REPLAY: UiCommand = { kind: 'replay' }

  it('the panel Cancel while A is held, then a recording started with Talk: releasing A neither stops it nor taps', async () => {
    const w = world()
    await holdA(w, 'right', 1000)
    expect(w.hold.holding).toBe('right')
    w.ui.dispatch(CANCEL) // the panel's Cancel (a ray press: not through hold-to-talk)
    w.frame(1500)
    expect(w.voice.state.kind).toBe('canceled')
    expect(w.hold.holding).toBeNull()
    expect(w.notes.filter((n) => n.event === 'voiceHoldDropped').map((n) => n.detail)).toEqual([{ pointer: 'right', reason: 'capture-ended', voice: 'canceled' }])
    w.ui.dispatch(START) // the XR Talk control
    await flush()
    w.frame(1600)
    expect(w.voice.state.kind).toBe('recording')
    w.set('right', A, false)
    w.frame(2000)
    await flush()
    w.frame(2011)
    expect(w.voice.state.kind).toBe('recording') // still the Talk control's recording, until its Stop
    expect(w.sent).toEqual([START]) // the hold's own start only: no voiceStop, no play/pause
    expect(w.commands).toEqual([])
    expect(w.net.calls).toHaveLength(0)
  })

  it('the panel Close ended it: B/Y replays again, and the other hand may hold while A is still held', async () => {
    const w = world()
    await holdA(w, 'right', 1000)
    w.ui.dispatch(OPEN) // the toolbar's Ask Meta Muse AI with the panel open: closes it, which cancels voice
    w.frame(1500)
    expect(w.ui.store.state.inspector).toBeNull()
    expect(w.voice.state.kind).toBe('canceled')
    w.set('left', B, true)
    w.frame(1600)
    w.set('left', B, false)
    w.frame(1650)
    expect(w.sent).toEqual([START, REPLAY]) // not swallowed as a cancel of nothing
    expect(w.commands).toEqual(['replay'])
    await holdA(w, 'left', 2000)
    expect(w.sent).toEqual([START, REPLAY, OPEN, START]) // not refused as 'already-holding'
    expect(w.voice.state.kind).toBe('recording')
    expect(w.notes.some((n) => n.event === 'voiceHoldIgnored')).toBe(false)
    w.set('right', A, false)
    w.frame(2600)
    expect(w.voice.state.kind).toBe('recording') // the stale hand's release stops nothing
    w.set('left', A, false)
    w.frame(2700)
    expect(w.voiceSent()).toEqual([START, START, STOP]) // the left hold's own release stops its recording
    expect(w.voice.state.kind).toBe('transcribing')
  })

  it('the recording limit stopped it: the transcript follows, and the release later stops nothing', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const w = world()
    await holdA(w, 'right', 1000)
    w.frame(16_300) // A still held; the voice client's clock reaches the limit
    vi.advanceTimersByTime(15_000)
    w.frame(16_311)
    expect(w.voice.state).toMatchObject({ kind: 'transcribing', limitReached: true })
    expect(w.hold.holding).toBeNull()
    await flush()
    w.net.reply('synthetic limit words') // synthetic test transcript
    await flush()
    w.frame(16_500)
    expect(w.voice.state.kind).toBe('transcript')
    w.set('right', A, false)
    w.frame(17_000)
    expect(w.sent).toEqual([START])
    expect(w.voice.state.kind).toBe('transcript')
  })

  it('a microphone error ended it: a recording started with Talk afterwards survives the release', async () => {
    const w = world()
    await holdA(w, 'left', 1000)
    FakeRecorder.instances[0]!.endUnexpectedly() // the microphone track ended
    await flush()
    w.frame(1500)
    expect(w.voice.state).toMatchObject({ kind: 'error', code: 'recorder_error' })
    expect(w.hold.holding).toBeNull()
    w.ui.dispatch(START)
    await flush()
    w.frame(1600)
    w.set('left', A, false)
    w.frame(1700)
    expect(w.voice.state.kind).toBe('recording')
    expect(w.sent).toEqual([START])
  })

  it('views that have not shown the capture yet keep the hold; the capture shown, then ended, drops it once', () => {
    const sent: UiCommand[] = []
    const notes: string[] = []
    const idle: VoiceGateInput = { open: true, voice: { kind: 'idle' }, voiceAcquiring: false, capability: null }
    const hold = new HoldToTalk({ dispatch: () => (c) => sent.push(c), voice: () => idle, dragging: () => false, presenting: () => true, note: (e) => notes.push(e) })
    hold.viewed({ ...idle, voice: { kind: 'canceled' } }) // no hold: nothing to drop
    expect(hold.handle('right', 'buttonAHold')).toBe(true)
    expect(sent).toEqual([START])
    hold.viewed(idle) // before the start shows (or a view of something else)
    hold.viewed(null)
    expect(hold.holding).toBe('right')
    hold.viewed({ ...idle, voiceAcquiring: true })
    hold.viewed({ ...idle, voice: { kind: 'recording', startedAt: 0 } })
    expect(hold.holding).toBe('right')
    hold.viewed({ ...idle, voice: { kind: 'transcribing', requestId: 'r', durationMs: 1 } })
    expect(hold.holding).toBeNull()
    hold.viewed({ ...idle, voice: { kind: 'canceled' } })
    expect(hold.handle('right', 'buttonAHoldEnd')).toBe(true) // no tap
    expect(sent).toEqual([START])
    expect(notes.filter((e) => e === 'voiceHoldDropped')).toHaveLength(1)
    // The next hold watches its own capture from the start: a view without capture does not drop it.
    expect(hold.handle('left', 'buttonAHold')).toBe(true)
    hold.viewed(idle)
    expect(hold.holding).toBe('left')
    expect(hold.handle('left', 'buttonAHoldEnd')).toBe(true)
    expect(sent).toEqual([START, START, STOP])
  })
})

describe('legacy XR controls (no spatial shell): a long A/X press is still the old play/pause', () => {
  it('a 400 ms press and a 1.5 s press each toggle play/pause once, on release; no voice', async () => {
    const w = world({ noShell: true })
    await holdA(w, 'right', 1000) // held past 300 ms
    w.frame(1400)
    expect(w.commands).toEqual([]) // not on the hold
    w.set('right', A, false)
    w.frame(1411)
    expect(w.commands).toEqual(['toggle'])
    w.frame(1500)
    expect(w.commands).toEqual(['toggle']) // once
    w.set('left', A, true)
    w.frame(2000)
    for (let ms = 2011; ms < 3500; ms += 11) w.frame(ms)
    w.set('left', A, false)
    w.frame(3511)
    expect(w.commands).toEqual(['toggle', 'toggle'])
    expect(w.sent).toEqual([])
    expect(w.voice.state.kind).toBe('idle')
  })

  it('taps still toggle and B/Y still replays', () => {
    const w = world({ noShell: true })
    w.set('right', A, true)
    w.frame(1000)
    w.set('right', A, false)
    w.frame(1100)
    w.set('left', B, true)
    w.frame(1200)
    expect(w.commands).toEqual(['toggle', 'replay'])
  })

  it('a long press cut off by a disconnect is dropped, like a short one (it was never released)', async () => {
    const w = world({ noShell: true })
    await holdA(w, 'right', 1000)
    w.disconnect('right')
    w.frame(1500)
    w.set('right', A, false)
    w.connect('right')
    w.frame(1600)
    expect(w.commands).toEqual([])
  })

  it('with the spatial shell a declined hold is still not a tap', async () => {
    const w = world({ speech: UNAVAILABLE_SPEECH })
    await holdA(w, 'right', 1000)
    w.set('right', A, false)
    w.frame(2000)
    expect(w.commands).toEqual([])
    expect(w.sent).toEqual([])
  })
})

describe('holdToTalkBlocked', () => {
  const v = (voice: VoiceGateInput['voice'], extra: Partial<VoiceGateInput> = {}): VoiceGateInput => ({ open: true, voice, voiceAcquiring: false, capability: null, ...extra })
  it('starts only where the Talk control would start a recording', () => {
    expect(holdToTalkBlocked(null)).toBe('voice-state-unknown')
    expect(holdToTalkBlocked(v({ kind: 'idle' }))).toBeNull()
    expect(holdToTalkBlocked(v({ kind: 'error', code: 'too_short', message: '' }))).toBeNull()
    expect(holdToTalkBlocked(v({ kind: 'canceled' }))).toBeNull()
    expect(holdToTalkBlocked(v({ kind: 'submitted', text: 'x' }))).toBeNull()
    expect(holdToTalkBlocked(v({ kind: 'unavailable', reason: 'no' }))).toBe('speech-unavailable')
    expect(holdToTalkBlocked(v({ kind: 'idle' }, { capability: { assistant: null, speech: UNAVAILABLE_SPEECH } }))).toBe('speech-unavailable')
    expect(holdToTalkBlocked(v({ kind: 'idle' }, { voiceAcquiring: true }))).toBe('already-recording')
    expect(holdToTalkBlocked(v({ kind: 'recording', startedAt: 0 }))).toBe('already-recording')
    expect(holdToTalkBlocked(v({ kind: 'transcribing', requestId: 'r', durationMs: 1 }))).toBe('voice-busy')
    // A closed panel does not block: hold-to-talk opens it first.
    expect(holdToTalkBlocked(v({ kind: 'idle' }, { open: false }))).toBeNull()
  })
})
