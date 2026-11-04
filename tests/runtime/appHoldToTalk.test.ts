// Hold-to-talk through the real App (src/app.ts): its Input, HoldToTalk, onEvent mapping, visibility and session
// handlers and renderSpatialShell cache, wired as main.ts wires them to the real UiController and VoiceClient (fake
// microphone, recorder and fetch) and a stand-in spatial shell. Rendering is stubbed (manim-web, the adapter and the
// retired spatial controls need a browser); nothing else is. Every transcript here is SYNTHETIC test data.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three'

vi.mock('manim-web', () => ({ MathTex: class {}, setMathJaxScriptUrl() {}, preloadMathJax: async () => {}, renderLatexToSVG: async () => '', svgToVMobjects: () => [] }))
/** An object whose unknown members are no-op methods. */
const stubOf = (o: Record<string, unknown>) => new Proxy(o, { get: (t, k) => (k in t ? t[k as string] : () => undefined) })
vi.mock('../../src/rendering/manimAdapter', async () => {
  const { Group: G } = await import('three')
  const idle = () => ({ active: false, playing: false, step: null, phase: 'idle', time: 0, duration: 0 })
  return { ManimAdapter: class { constructor() { return stubOf({ bench: new G(), pick: () => null, prepare: async () => {}, playback: idle }) } } }
})
vi.mock('../../src/ui/spatialControls', async () => {
  const { Group: G } = await import('three')
  return { SpatialControls: class { constructor() { return stubOf({ group: new G(), pick: () => null, report: () => ({}) }) } } }
})

import { App } from '../../src/app'
import { UiController, type ControllerDeps } from '../../src/ui/controller'
import type { SpatialPick, UiCommand, UiView } from '../../src/ui/model'
import { VoiceClient } from '../../src/voice/client'
import { FakeRecorder, META_CAPABILITY, controlledFetch, fakeMedia, flush } from '../voice/fakes'

type Hand = 'left' | 'right'
const A = 4
const B = 5
const OPEN: UiCommand = { kind: 'inspector', which: 'assistant' }
const START: UiCommand = { kind: 'assistant', action: { kind: 'voiceToggle' } }
const STOP: UiCommand = { kind: 'assistant', action: { kind: 'voiceStop' } }
const CANCEL: UiCommand = { kind: 'assistant', action: { kind: 'voiceCancel' } }

let clock = 0

function gamepad() {
  return { buttons: Array.from({ length: 7 }, () => ({ pressed: false, touched: false, value: 0 })), hapticActuators: [{ pulse: () => new Promise<boolean>(() => {}) }] }
}

/** The real App on a fake XR host; with `shell`, the real UiController and VoiceClient behind a stand-in spatial shell. */
function appWorld(opts: { shell?: boolean; inspector?: 'math' | null } = {}) {
  const rays = [new Group(), new Group()]
  const grips = [new Group(), new Group()]
  const domElement = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }), setPointerCapture: () => undefined })
  const xrFrame = { getPose: () => ({ emulatedPosition: false }) }
  const renderer = { xr: { getController: (i: number) => rays[i]!, getControllerGrip: (i: number) => grips[i]!, getFrame: () => xrFrame, getReferenceSpace: () => ({}) }, domElement }
  const frames: ((ctx: never) => void)[] = []
  const visibility: ((visible: boolean) => void)[] = []
  const session: ((presenting: boolean) => void)[] = []
  const host = {
    renderer, scene: new Scene(), camera: new PerspectiveCamera(), stage: new Group(), presenting: true, sessionMode: 'vr',
    onFrame: (fn: (ctx: never) => void) => (frames.push(fn), () => {}),
    onVisibility: (fn: (v: boolean) => void) => (visibility.push(fn), () => {}),
    onSession: (fn: (p: boolean) => void) => (session.push(fn), () => {}),
    setPassthroughLook: () => {},
    passthroughSupported: async () => false,
  }
  const app = new App(host as never)
  const appCommands = vi.spyOn(app, 'command')
  const pads = { right: gamepad(), left: gamepad() }
  const slot = { right: 0, left: 1 } as const
  const source = (hand: Hand) => ({ handedness: hand, targetRayMode: 'tracked-pointer', gamepad: pads[hand], targetRaySpace: {}, gripSpace: {} })
  for (const hand of ['right', 'left'] as const) rays[slot[hand]]!.dispatchEvent({ type: 'connected', data: source(hand) } as never)
  const set = (hand: Hand, index: number, pressed: boolean) => {
    const b = pads[hand].buttons[index]!
    b.pressed = pressed
    b.value = pressed ? 1 : 0
  }
  /** The trigger on `hand` (three's WebXRController sends selectstart; the Input queues a press). */
  const trigger = (hand: Hand) => rays[slot[hand]]!.dispatchEvent({ type: 'selectstart', data: source(hand) } as never)

  const media = fakeMedia()
  const net = controlledFetch()
  const submitted: string[] = []
  const voice = new VoiceClient({ submit: (t) => submitted.push(t), fetch: net.fetchImpl, getUserMedia: media.getUserMedia, Recorder: FakeRecorder as unknown as typeof MediaRecorder, now: () => clock })
  voice.setCapability(META_CAPABILITY)
  const caps = { assistant: { configured: true, authenticated: false, liveValidated: false, model: 'test-model', mode: 'synthetic' }, speech: META_CAPABILITY }
  const assistant = { state: { kind: 'idle' }, busy: false, subscribe: () => () => {}, cancel: vi.fn(), ask: vi.fn(async () => {}), retry: vi.fn(async () => {}) }
  const evidence = { entries: [], subscribe: () => () => {}, check: vi.fn(async () => {}) }
  const sent: UiCommand[] = []
  /** What the stand-in shell's pick() returns (a ray press dispatches its command). */
  const shellHit: { pick: SpatialPick | null } = { pick: null }
  let ui: UiController | null = null
  if (opts.shell !== false) {
    const controller = new UiController({
      app, host, assistant, voice, evidence,
      workspace: { save: async () => 'saved', reopen: async () => 'reopened', exportJson: () => '', importJson: () => {} },
      capabilities: () => caps,
    } as unknown as ControllerDeps)
    ui = controller
    if (opts.inspector !== undefined) controller.dispatch({ kind: 'inspector', which: opts.inspector })
    const dispatch = (c: UiCommand) => {
      sent.push(c)
      controller.dispatch(c)
    }
    const shell = { mount() {}, render(_v: UiView) {}, step() {}, pick: () => shellHit.pick, setHover() {}, setVisible() {}, dispose() {} }
    app.attachSpatialShell(shell, dispatch)
    // main.ts: every published view goes to the spatial shell through App.renderSpatialShell.
    controller.subscribe((v) => app.renderSpatialShell(v))
    app.renderSpatialShell(controller.view)
  }
  let n = 0
  let last = 0
  /** One host frame at `ms` (the app's frame handler first, then the UI controller's, as registered). */
  const frame = (ms: number) => {
    clock = last = ms
    const ctx = { time: ms / 1000, dt: 1 / 90, frame: n++, presenting: host.presenting, xrFrame: null, head: new Vector3() }
    frames.forEach((f) => f(ctx as never))
  }
  /** Frames every 11 ms after the last one, up to `ms` (no gap, so the poses stay settled and ray presses count). */
  const run = (ms: number) => {
    for (let t = last + 11; t < ms; t += 11) frame(t)
    frame(ms)
  }
  /** A trigger press on `hand` at `ms` on the XR panel control `id` (what the stand-in shell's pick reports). */
  const pressControl = (hand: Hand, id: string, command: UiCommand, ms: number) => {
    run(ms - 11)
    shellHit.pick = { id, distance: 0.5, command }
    trigger(hand)
    run(ms)
    shellHit.pick = null
  }
  // Let both controllers' poses settle (POSE_SETTLE) so ray presses count.
  for (let ms = 0; ms <= 400; ms += 50) frame(ms)
  const voiceSent = () => sent.filter((c) => c.kind === 'assistant')
  const hidden = (v: boolean) => visibility.forEach((fn) => fn(!v))
  const endSession = () => {
    host.presenting = false
    session.forEach((fn) => fn(false))
  }
  return { app, appCommands, ui, voice, media, net, submitted, sent, voiceSent, set, trigger, frame, run, pressControl, hidden, endSession, shellHit, assistant, rays, slot, source }
}

/** Press A/X at `ms` and hold it through the 300 ms frame; the microphone is granted. */
async function holdA(w: ReturnType<typeof appWorld>, hand: Hand, ms: number) {
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

describe('App: a hold opens the assistant inspector when it is not open, then records', () => {
  for (const which of [null, 'math'] as const) {
    it(`inspector ${which === null ? 'closed' : 'showing the mathematics'}: the toolbar command, then the Talk command; the panel shows the recording and the transcript`, async () => {
      const w = appWorld({ inspector: which })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      expect(w.ui!.store.state.inspector).toBe(which)
      await holdA(w, 'right', 1000)
      expect(w.sent).toEqual([OPEN, START])
      expect(w.ui!.store.state.inspector).toBe('assistant')
      expect(w.ui!.view.assistant).toMatchObject({ open: true, voice: { kind: 'recording' } })
      expect(w.assistant.cancel).not.toHaveBeenCalled()
      w.set('right', A, false)
      w.frame(2800)
      expect(w.sent).toEqual([OPEN, START, STOP])
      await flush()
      w.net.reply('synthetic test words') // synthetic test transcript
      await flush()
      vi.advanceTimersByTime(2500)
      expect(w.submitted).toEqual(['synthetic test words'])
      expect(w.ui!.store.state.inspector).toBe('assistant')
      expect(w.appCommands).not.toHaveBeenCalled() // no play/pause
    })
  }

  it('inspector already showing the assistant: only the Talk command (the toolbar command would close it)', async () => {
    const w = appWorld()
    expect(w.ui!.store.state.inspector).toBe('assistant')
    await holdA(w, 'left', 1000)
    expect(w.sent).toEqual([START])
    expect(w.ui!.store.state.inspector).toBe('assistant')
    expect(w.voice.state.kind).toBe('recording')
  })

  it('a ray press on an inspector command in the hold\'s frame (published view out of date): the hold neither toggles the panel nor records', async () => {
    const w = appWorld()
    // Continuous frames (a gap longer than POSE_SETTLE would make the ray press count as untracked).
    for (let ms = 450; ms < 1000; ms += 50) w.frame(ms)
    w.set('right', A, true)
    for (let ms = 1000; ms < 1300; ms += 11) w.frame(ms)
    // The toolbar's Ask Meta Muse AI entry, pressed with the left trigger in the frame the right A/X becomes a hold.
    w.shellHit.pick = { id: 'shell:tb:assistant', distance: 0.5, command: OPEN }
    w.trigger('left')
    w.frame(1300)
    w.shellHit.pick = null
    await flush()
    w.frame(1311)
    expect(w.app.log.find((e) => e.event === 'uiPress')?.detail).toEqual({ id: 'shell:tb:assistant', command: 'inspector' })
    expect(w.sent).toEqual([OPEN]) // the press alone: it closed the panel
    expect(w.ui!.store.state.inspector).toBeNull()
    expect(w.voice.state.kind).toBe('idle')
    expect(w.app.log.find((e) => e.event === 'voiceHoldIgnored')?.detail).toMatchObject({ reason: 'voice-state-unknown' })
  })
})

describe('App: the session becoming hidden mid-hold cancels the recording', () => {
  it('one voiceCancel at once; the release after the system UI is neither a stop nor a tap; nothing is uploaded', async () => {
    const w = appWorld()
    await holdA(w, 'right', 1000)
    expect(w.voice.state.kind).toBe('recording')
    w.hidden(true)
    expect(w.voiceSent()).toEqual([START, CANCEL])
    expect(w.voice.state.kind).toBe('canceled')
    for (let ms = 1400; ms < 4100; ms += 11) w.frame(ms) // a 'visible-blurred' session still runs frames
    w.hidden(false)
    w.frame(4200)
    w.set('right', A, false)
    w.frame(4300)
    await flush()
    expect(w.sent).toEqual([START, CANCEL])
    expect(w.net.calls).toHaveLength(0)
    expect(w.submitted).toEqual([])
    expect(w.media.streams.every((s) => s.released)).toBe(true)
    expect(w.app.log.filter((e) => e.event === 'voiceHoldCancel').map((e) => e.detail)).toEqual([{ pointer: 'right', reason: 'session-hidden' }])
  })

  it('hidden, then the session ends: still a single voiceCancel', async () => {
    const w = appWorld()
    await holdA(w, 'left', 1000)
    w.hidden(true)
    w.endSession()
    w.frame(1500)
    w.rays[w.slot.left]!.dispatchEvent({ type: 'disconnected', data: w.source('left') } as never)
    w.frame(1511)
    expect(w.voiceSent()).toEqual([START, CANCEL])
  })

  it('the session ending mid-hold (no hidden state first) cancels once', async () => {
    const w = appWorld()
    await holdA(w, 'right', 1000)
    w.endSession()
    w.frame(1500)
    expect(w.voiceSent()).toEqual([START, CANCEL])
  })
})

/** Press A/X at `ms` and hold it through the 300 ms frame, with frames every 11 ms (ray presses stay valid). */
async function holdRun(w: ReturnType<typeof appWorld>, hand: Hand, ms: number) {
  w.run(ms - 11)
  w.set(hand, A, true)
  w.run(ms)
  w.run(ms + 300)
  await flush()
  w.run(ms + 311)
}

describe('App: a hold whose recording ended through the panel lets go of A/X (verify finding: stale hold hand)', () => {
  it('panel Cancel with the hold\'s trigger, then Talk: releasing A does not stop the Talk recording', async () => {
    const w = appWorld()
    await holdRun(w, 'right', 1000)
    expect(w.voice.state.kind).toBe('recording')
    w.pressControl('right', 'voiceCancel', CANCEL, 1500) // the panel's Cancel beside Stop
    await flush()
    w.run(1511)
    expect(w.voice.state.kind).toBe('canceled')
    w.pressControl('right', 'talk', START, 2000) // the XR Talk control
    await flush()
    w.run(2011)
    expect(w.voice.state.kind).toBe('recording')
    w.run(2990)
    w.set('right', A, false)
    w.run(3000)
    await flush()
    w.run(3011)
    expect(w.voice.state.kind).toBe('recording') // it ends on Stop, not on a release of the earlier hold
    expect(w.sent).toEqual([START, CANCEL, START])
    expect(w.appCommands).not.toHaveBeenCalled() // and the release was no play/pause
    expect(w.app.log.filter((e) => e.event === 'voiceHoldDropped').map((e) => e.detail)).toEqual([{ pointer: 'right', reason: 'capture-ended', voice: 'canceled' }])
    w.pressControl('left', 'talk', START, 3500) // Talk reads Stop now: the Talk recording stops when asked
    await flush()
    expect(w.voice.state.kind).toBe('transcribing')
  })

  it('panel Close (toolbar) with the other trigger: B/Y replays, and a left X hold records while right A is still held', async () => {
    const w = appWorld()
    await holdRun(w, 'right', 1000)
    w.pressControl('left', 'shell:tb:assistant', OPEN, 1500) // closes the open assistant panel, which cancels voice
    await flush()
    w.run(1511)
    expect(w.ui!.store.state.inspector).toBeNull()
    expect(w.voice.state.kind).toBe('canceled')
    w.run(1590)
    w.set('left', B, true)
    w.run(1600)
    w.set('left', B, false)
    w.run(1650)
    expect(w.sent).toEqual([START, OPEN, { kind: 'replay' }]) // B/Y is not swallowed
    await holdRun(w, 'left', 2000)
    expect(w.sent).toEqual([START, OPEN, { kind: 'replay' }, OPEN, START]) // opened again, then recording
    expect(w.voice.state.kind).toBe('recording')
    expect(w.app.log.some((e) => e.event === 'voiceHoldIgnored')).toBe(false)
    w.set('right', A, false)
    w.run(2600)
    expect(w.voice.state.kind).toBe('recording')
    w.set('left', A, false)
    w.run(2700)
    expect(w.voiceSent()).toEqual([START, START, STOP])
    expect(w.voice.state.kind).toBe('transcribing')
  })
})

describe('App: legacy XR controls (no spatial shell)', () => {
  it('a long A/X press is the old play/pause, once, on release; taps too; B/Y replays', () => {
    const w = appWorld({ shell: false })
    w.set('right', A, true)
    w.frame(1000)
    w.frame(1300) // a hold: declined without the shell
    w.frame(1400)
    expect(w.appCommands).not.toHaveBeenCalled()
    w.set('right', A, false)
    w.frame(1411)
    expect(w.appCommands.mock.calls).toEqual([['toggle']])
    w.frame(1500)
    w.set('left', A, true)
    w.frame(1600)
    w.set('left', A, false)
    w.frame(1700)
    w.set('left', B, true)
    w.frame(1800)
    expect(w.appCommands.mock.calls).toEqual([['toggle'], ['toggle'], ['replay']])
  })
})
