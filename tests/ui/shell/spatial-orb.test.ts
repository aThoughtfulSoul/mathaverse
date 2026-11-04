// The spatial shell's assistant orb at its one place: centred below the stage, in the room the hidden context panel
// leaves (SPATIAL_LAYOUT.orb, bench-local, a child of the shell's root, not of the inspector area). Opening the
// assistant inspector (render, which runs after the frame's step, including the hold-to-talk open from the mathematics
// inspector) and the shell's own show take the current look and bloom at once, so the very next frame never draws the
// hidden-time look; the frame step passes the bloom identity; the orb never moves, whatever the phase, OrbSource.stage
// or the clock (no glide); the report gives its constant place, the root's world position and scale and its
// diameters; a failing source never throws into the shell. The front anchor (25 cm across idle), seen by both eyes
// from the default head pose of scripts/ui-capture.sh (tests/ui/shell/eyes.ts), with the context panel hidden and the
// toolbar at its place for the assistant, in all seven demonstrations: its settled looks (the largest: listening at its
// full voice ripple) keep its drawn outline off the scene box and off the drawn outline of the toolbar, the inspector,
// the header and the assistant's own controls; the bloom's start (its largest look) reaches a little into the scene
// box's empty lower margin but stays off every demonstration's stage content as measured in IWER (eyes.ts
// STAGE_CONTENT) and off those panels and controls; the popovers (the picker; More with a notice) overlap it, and it
// lies wholly behind their plane, so they cover it while open and it never covers them. Its whole extent stays below
// the scene box. Node has no canvas: fake 2D contexts; TextSlot (MathJax) is replaced by an inert stand-in; the
// assistant content is an inert stand-in of the real panel's size, except in the front anchor's clearance checks,
// which mount the real XR content (src/ui/assistant/spatial.ts) for its control plates.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Group, Mesh, Plane, ShaderMaterial, Vector3, type Object3D } from 'three'

vi.mock('../../../src/rendering/textSlot', () => ({
  TextSlot: class {
    anchor = new Group()
    width = 0
    set() {}
    frame() {}
    setWanted() {}
    dispose() {}
    report() {
      return {}
    }
  },
}))

import { setCanvasFactory } from '../../../src/ui/shell/panel'
import { SpatialShell, SPATIAL_LAYOUT } from '../../../src/ui/shell/spatial'
import { FIXTURES, fixtureFor } from '../../../src/ui/shell/fixtures'
import { PANEL } from '../../../src/ui/assistant/spatialLayout'
import { createAssistantSpatialContent } from '../../../src/ui/assistant/spatial'
import { ORB_MESH_NAME, ORB_ROOT_NAME, XR_ORB, XR_ORB_EXTENT, setOrbCanvasFactory } from '../../../src/ui/orb/xr'
import { BLOOM_START_RADIUS, ORB_LOOKS } from '../../../src/ui/orb/motion'
import type { OrbSource } from '../../../src/ui/orb/source'
import type { OrbPhase } from '../../../src/ui/orb/state'
import type { FrameContext } from '../../../src/runtime/host'
import type { SpatialPanelContent, UiView } from '../../../src/ui/model'
import type { VoiceState } from '../../../src/voice/client'
import { STATES, VOICE, docs, panelInput } from '../assistant/helpers'
import { CORNERS, EYES, HEAD, SCENE_BOX, STAGE_CONTENT, area, orbOutline, plateOutline, project, recordPlates, sceneBoxOutline, separation } from './eyes'

function fakeCanvas(): HTMLCanvasElement {
  let font = '10px sans-serif'
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (prop === 'measureText') return (t: string) => ({ width: t.length * Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) * 0.52 })
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} })
      if (prop === 'font') return font
      if (prop in target) return target[prop as string]
      return () => undefined
    },
    set(target, prop, value) {
      if (prop === 'font') font = String(value)
      else target[prop as string] = value
      return true
    },
  })
  return { width: 300, height: 150, getContext: () => ctx } as unknown as HTMLCanvasElement
}

beforeAll(() => {
  setCanvasFactory(fakeCanvas)
  setOrbCanvasFactory(fakeCanvas)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const DT = 1 / 72
const FRONT = SPATIAL_LAYOUT.orb

/** A frame of the host clock at `ms`. */
const frameAt = (ms: number): FrameContext => ({ time: ms / 1000, dt: DT, frame: 1, presenting: true, xrFrame: null, head: new Vector3(0, 1.6, 0) })

/** The real assistant panel's size (src/ui/assistant/spatialLayout.ts PANEL), drawing nothing. */
function panelSized(): SpatialPanelContent {
  return { width: PANEL.width, height: PANEL.height, mount() {}, render() {}, step() {}, pick: () => null, setHover() {}, setVisible() {}, dispose() {} }
}

/** A source whose phase, stage and bloom the test sets; it counts the reads. */
function source(phase: OrbPhase = 'idle', stage = false, bloom: string | null = null) {
  const s = { phase, stage, bloom, throws: false, reads: 0 }
  const src: OrbSource = {
    phase: () => {
      if (s.throws) throw new Error('source failed')
      s.reads++
      return s.phase
    },
    level: () => 0.3,
    bloom: () => s.bloom,
    stage: () => s.stage,
  }
  return { s, src }
}

function find(root: Object3D, name: string): Object3D {
  let out: Object3D | undefined
  root.traverse((o) => {
    if (o.name === name) out = o
  })
  return out!
}

/** A shell on a bench placed like the app's (src/rendering bench: (0, 1.02, -0.8)), visible, showing `view`. */
function mounted(view: UiView, src: OrbSource, assistant: SpatialPanelContent = panelSized()) {
  const shell = new SpatialShell({ dispatch: () => undefined, assistant, orb: src })
  const bench = new Group()
  bench.position.set(0, 1.02, -0.8)
  shell.mount(bench)
  shell.setVisible(true)
  shell.render(view)
  bench.updateMatrixWorld(true)
  const root = find(bench, ORB_ROOT_NAME)
  const u = ((find(bench, ORB_MESH_NAME) as Mesh).material as ShaderMaterial).uniforms
  return { shell, bench, root, u }
}

const view = (name: string, inspector?: UiView['inspector']): UiView => {
  const v = FIXTURES[name]!.view('xr')
  return inspector === undefined ? v : { ...v, inspector }
}

const atFront = (root: Object3D) => {
  expect(root.position.toArray()).toEqual([FRONT.x, FRONT.y, FRONT.z])
  expect(root.scale.toArray()).toEqual([FRONT.scale, FRONT.scale, FRONT.scale])
}

describe('the orb shown by the shell takes its look at once, at its one place', () => {
  for (const [from, phase, look] of [
    ['sculpture-closed', 'thinking', ORB_LOOKS.thinking],
    ['sculpture-math', 'listening', ORB_LOOKS.listening], // hold-to-talk opens the assistant from the mathematics inspector
  ] as const) {
    it(`review finding: opened from ${from} (render after the frame's step) while ${phase}: the next frame draws its look in front`, () => {
      const { s, src } = source('idle', false)
      const { shell, root, u } = mounted(view(from), src)
      for (let t = 0; t < 30; t++) shell.step(frameAt(1000 + t * 14))
      expect(root.visible).toBe(false)
      s.phase = phase
      s.stage = true
      shell.render(view('sculpture')) // no step between this and the drawn frame
      expect(root.visible).toBe(true)
      expect(u.uRadius!.value).toBe(look.radius)
      expect(u.uWave!.value).toBe(look.wave)
      expect(u.uBright!.value).toBe(look.bright)
      atFront(root)
      expect(root.parent).toBe(shell.root) // bench-local: not under the inspector area
      expect(shell.report().orb).toMatchObject({ visible: true, phase, place: 'front', scale: FRONT.scale })
      shell.step(frameAt(1000 + 31 * 14))
      atFront(root)
      shell.dispose()
    })
  }

  it("the shell's own show (leaving and re-entering XR) takes the current look at once, at the same place", () => {
    const { s, src } = source('thinking', true)
    const { shell, root, u } = mounted(view('sculpture'), src)
    atFront(root)
    shell.setVisible(false)
    s.phase = 'idle'
    s.stage = false
    shell.setVisible(true)
    atFront(root)
    expect(u.uWave!.value).toBe(0)
    expect(shell.report().orb).toMatchObject({ place: 'front', phase: 'idle' })
    shell.dispose()
  })

  it('shown during a bloom: the applied look without the overshoot, and the steps after it start none', () => {
    const { src } = source('applied', true, 'r1')
    const { shell, u } = mounted(view('sculpture'), src)
    expect(u.uRadius!.value).toBe(ORB_LOOKS.applied.radius)
    for (let t = 0; t < 5; t++) shell.step(frameAt(2000 + t * 14))
    expect(u.uRadius!.value).toBeCloseTo(ORB_LOOKS.applied.radius, 9)
    shell.dispose()
  })
})

describe('the frame step', () => {
  it('passes the bloom identity: a bloom overshoots once, not again when the phase only flickers back to applied', () => {
    const { s, src } = source('thinking', true)
    const { shell, u } = mounted(view('sculpture'), src)
    let t = 1000
    const step = (n = 1) => {
      for (let i = 0; i < n; i++) shell.step(frameAt((t += 14)))
    }
    step(10)
    s.phase = 'applied'
    s.bloom = 'r1'
    step()
    expect(u.uRadius!.value).toBeGreaterThan(BLOOM_START_RADIUS - 0.05) // the overshoot started
    step(30)
    const settled = u.uRadius!.value as number
    s.phase = 'idle'
    step()
    s.phase = 'applied' // the same bloom: no second overshoot
    step()
    expect(u.uRadius!.value).toBeLessThan(settled + 0.01)
    s.bloom = 'r2' // a new bloom overshoots again
    step()
    expect(u.uRadius!.value).toBeGreaterThan(BLOOM_START_RADIUS - 0.05)
    shell.dispose()
  })

  for (const reduced of [false, true]) {
    it(`never moves (no glide${reduced ? ', reduced motion' : ''}): every phase, OrbSource.stage on or off, any clock; the report follows`, () => {
      if (reduced) vi.stubGlobal('matchMedia', () => ({ matches: true }))
      const { s, src } = source('idle', false)
      const { shell, bench, root } = mounted(view('sculpture'), src)
      let t = 5000
      for (const [phase, stage] of [['listening', true], ['transcribing', true], ['thinking', true], ['applied', true], ['error', false], ['idle', false]] as const) {
        s.phase = phase
        s.stage = stage
        s.bloom = phase === 'applied' ? 'r1' : s.bloom
        for (let i = 0; i < 90; i++) {
          shell.step(frameAt((t += DT * 1000)))
          atFront(root)
        }
        expect(shell.report().orb).toMatchObject({ visible: true, phase, place: 'front', scale: FRONT.scale, across: { idle: +(2 * XR_ORB.radius * FRONT.scale).toFixed(4), bloomStart: +(2 * XR_ORB.radius * BLOOM_START_RADIUS * FRONT.scale).toFixed(4) } })
      }
      // The report: the root's world position and scale (the bench's transform applied).
      bench.updateMatrixWorld(true)
      const w = root.getWorldPosition(new Vector3())
      expect(shell.report().orb!.position).toEqual(w.toArray().map((c) => +c.toFixed(4)))
      expect(Object.keys(shell.report().orb!)).not.toContain('moving')
      shell.dispose()
    })
  }

  it('a failing source never throws into the shell (the orb is optional)', () => {
    const { s, src } = source('thinking', true)
    const { shell, root } = mounted(view('sculpture-closed'), src)
    s.throws = true
    expect(() => shell.render(view('sculpture'))).not.toThrow()
    expect(() => shell.step(frameAt(1000))).not.toThrow()
    expect(shell.report().orb!.visible).toBe(true)
    s.throws = false
    shell.step(frameAt(1014))
    expect(shell.report().orb).toMatchObject({ phase: 'thinking', place: 'front' })
    atFront(root)
    shell.dispose()
  })
})

describe('the front anchor', () => {
  // From the default head pose (eyes.ts) the orb sits below the view axis, where its projection is no disc about the
  // projected centre, so each eye's image plane compares drawn outlines (eyes.ts orbOutline: a look's glyph sphere
  // with its glyph quads). The looks are concentric spheres, so the largest settled one (listening at its full voice
  // ripple, 1.2 x its radius) bounds them all; the bloom's start bounds everything. A shell plate's outline: the
  // rounded rect CanvasPanel.plate draws. An assistant control's: its whole quad. The scene box's: its projected hull;
  // the stage content's: the IWER hulls (STAGE_CONTENT). Gaps are in units of the orb outline's equal-area radius; 0
  // would touch. The soft core glow, wider still (XR_ORB_EXTENT), adds light with no cover; the last check bounds it in
  // space.
  const SETTLED_LOOKS = { idle: ORB_LOOKS.idle.radius, listening: ORB_LOOKS.listening.radius * 1.2, transcribing: ORB_LOOKS.transcribing.radius, thinking: ORB_LOOKS.thinking.radius, error: ORB_LOOKS.error.radius, applied: ORB_LOOKS.applied.radius }
  const SETTLED = Math.max(...Object.values(SETTLED_LOOKS))
  const BLOOM_SPHERE = XR_ORB.radius * BLOOM_START_RADIUS
  const GLYPH_QUAD = XR_ORB.glyph * 1.1
  let plates: ReturnType<typeof recordPlates>
  beforeAll(() => {
    plates = recordPlates()
  })
  afterAll(() => plates.restore())

  it("the largest settled look is listening at its full ripple; the bloom's start is larger, and the dark backing (which covers) lies inside it", () => {
    expect(SETTLED).toBe(SETTLED_LOOKS.listening)
    for (const look of Object.values(ORB_LOOKS)) expect(look.radius).toBeLessThan(BLOOM_START_RADIUS)
    expect(SETTLED).toBeLessThan(BLOOM_START_RADIUS)
    expect(XR_ORB.backing).toBeLessThan(BLOOM_SPHERE) // a view-aligned disc through the centre
  })

  // The size: about 25 cm across idle (the target), in the room the hidden context panel leaves, with the toolbar a
  // little lower (tests/ui/shell/spatial-layout.test.ts). Twice the previous front orb (12.6 cm).
  it('is centred, under the scene box: 24.5-25.5 cm across idle, 34-36 cm at the bloom start, glow under 45 cm; the report says so', () => {
    expect(FRONT.x).toBe(0)
    expect(FRONT.z).toBeGreaterThan(-0.05) // nearer the viewer than the scene box's middle
    expect(FRONT.y + BLOOM_SPHERE * FRONT.scale).toBeLessThan(SCENE_BOX.y[0]) // below it, even at the bloom's start
    const across = (r: number) => 2 * r * FRONT.scale
    expect(across(XR_ORB.radius)).toBeGreaterThanOrEqual(0.245)
    expect(across(XR_ORB.radius)).toBeLessThanOrEqual(0.255)
    expect(across(BLOOM_SPHERE)).toBeGreaterThanOrEqual(0.34)
    expect(across(BLOOM_SPHERE)).toBeLessThanOrEqual(0.36)
    expect(across(XR_ORB_EXTENT)).toBeLessThan(0.45)
    const { src } = source('idle', false)
    const { shell } = mounted(view('sculpture'), src)
    expect(shell.report().orb!.across).toEqual({ idle: +across(XR_ORB.radius).toFixed(4), bloomStart: +across(BLOOM_SPHERE).toFixed(4) })
    shell.dispose()
  })

  // All seven demonstrations with the assistant (braid and proof have the widest context panels, hidden here), the
  // popovers (More with a notice: the plate then reaches popover.bottom), and the plain assistant view.
  /** More's XR entries with the notice its microphone entry gives when refused (src/ui/controller.ts). */
  const withNotice = (v: UiView): UiView => ({ ...v, more: { ...v.more, notice: { text: 'Microphone not available; typed and controller use still work', tone: 'error' } } })
  const VIEWS: [string, UiView][] = [
    ['sculpture', view('sculpture')],
    ['braid', view('braid', 'assistant')],
    ['cube', view('cube', 'assistant')],
    ['pq', view('pq', 'assistant')],
    ['order', view('order', 'assistant')],
    ['quotient', view('quotient', 'assistant')],
    ['proof', fixtureFor('proof', view('pq', 'assistant'))],
    ['picker', view('picker')],
    ['more-xr', view('more-xr', 'assistant')],
    ['more-xr with a notice', withNotice(view('more-xr', 'assistant'))],
  ]
  // The controls the assistant can show while a bloom plays out: the suggestions and Talk after the applied answer,
  // and Stop + Cancel or Cancel + Send now when the learner speaks again at once (the radius then eases down from the
  // bloom's). The assistant content shows the app's own input for the view's experiment (helpers.ts: a synthetic
  // applied answer, Meta transcription), so its suggestions are the real ones.
  const VOICES: [string, VoiceState, string[]][] = [
    ['Talk', VOICE.submitted, ['assistant:talk', 'assistant:suggestion:0', 'assistant:suggestion:1']],
    ['Stop + Cancel', VOICE.recording, ['assistant:talk', 'assistant:voiceCancel']],
    ['Cancel + Send now', VOICE.transcriptXr, ['assistant:talk', 'assistant:transcriptSend']],
  ]
  for (const [name, v] of VIEWS) {
    it(`${name}: settled looks clear the scene box and every panel; the bloom's start no stage content, panel or control (popovers lie in front), in view`, () => {
      const { src } = source('applied', true, 'r1')
      const { shell, bench, root } = mounted(v, src, createAssistantSpatialContent(() => undefined))
      atFront(root)
      expect(shell.report().lowered).toMatchObject({ at: 1, to: 1, moving: false }) // the toolbar at its place for the assistant
      expect(shell.report().context).toEqual({ opacity: 0, to: 0, moving: false, pickable: false }) // the context panel hidden
      const content = STAGE_CONTENT[v.experiment.kind]!
      expect(content, v.experiment.kind).toBeDefined()
      const R = (BLOOM_SPHERE + GLYPH_QUAD) * FRONT.scale
      for (const [row, voice, controls] of VOICES) {
        shell.render({ ...v, assistant: panelInput(docs()[v.assistant.demo], { surface: 'xr', assistant: STATES.applied(), voice }) })
        bench.updateMatrixWorld(true)
        const centre = root.getWorldPosition(new Vector3())
        const looks = EYES.map(([, cam]) => {
          const settled = orbOutline(cam, root, SETTLED)
          const bloom = orbOutline(cam, root, BLOOM_START_RADIUS)
          return { settled, bloom, us: Math.sqrt(area(settled) / Math.PI), ub: Math.sqrt(area(bloom) / Math.PI) }
        })
        EYES.forEach(([side, cam], i) => {
          const o = looks[i]!
          const box = sceneBoxOutline(bench, cam)
          expect(separation(o.settled, box) / o.us, `${row}, ${side}: settled, the scene box`).toBeGreaterThan(0)
          // The bloom's start reaches a little into the box's lower margin, never onto the stage content.
          expect(separation(o.bloom, box) / o.ub, `${row}, ${side}: bloom, the scene box`).toBeGreaterThan(-0.1)
          expect(separation(o.bloom, content[i ? 'R' : 'L']) / o.ub, `${row}, ${side}: bloom, the ${v.experiment.kind} content`).toBeGreaterThan(0)
          // In view: the whole outline inside the eye's image.
          for (const [x, y] of o.bloom) expect(Math.max(Math.abs(x), Math.abs(y)), `${row}, ${side}`).toBeLessThan(1)
        })
        const shownPlates: string[] = []
        const shown: string[] = []
        const covering: string[] = []
        bench.traverse((o) => {
          const plate = /^shell:.*:plate$/.test(o.name) && !o.name.startsWith('shell:tooltip')
          // The assistant's control plates (Talk, Stop, Cancel, Send now, the suggestions): not its backing.
          const control = o.name.startsWith('assistant:') && o.name !== 'assistant:backing'
          if (!plate && !control) return
          for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return
          ;(plate ? shownPlates : shown).push(o.name)
          const local = plate ? plateOutline(plates.drawn, o) : CORNERS.map(([x, y]) => new Vector3(x, y, 0))
          const popover = o.name === 'shell:picker:plate' || o.name === 'shell:more:plate'
          EYES.forEach(([side, cam], i) => {
            const P = project(o, local, cam)
            const gap = separation(looks[i]!.bloom, P) / looks[i]!.ub
            if (!popover) {
              expect(gap, `${row}, ${side}: bloom, ${o.name}`).toBeGreaterThan(0)
              return
            }
            if (gap > 0) return
            // An open popover overlaps the orb: the orb (its bloom-start sphere with its glyph quads) lies wholly
            // behind the popover's plane, so the popover covers it there and it never draws over the popover.
            covering.push(o.name)
            const normal = new Vector3(0, 0, 1).transformDirection(o.matrixWorld)
            const plane = new Plane().setFromNormalAndCoplanarPoint(normal, o.getWorldPosition(new Vector3()))
            expect(plane.distanceToPoint(cam.position), `${row}, ${side}: the eye in front of ${o.name}`).toBeGreaterThan(0)
            expect(plane.distanceToPoint(centre) + R, `${row}, ${side}: the orb behind ${o.name}`).toBeLessThan(0)
          })
        })
        expect(shownPlates).toContain('shell:inspector:plate')
        expect(shownPlates).toContain('shell:toolbar:plate')
        expect(shownPlates).not.toContain('shell:context:plate')
        expect(shownPlates).toContain('shell:header:plate')
        if (name === 'picker') expect(shownPlates).toContain('shell:picker:plate')
        if (name.startsWith('more-xr')) expect(shownPlates).toContain('shell:more:plate')
        // The picker and More (in their normal places) cover part of the orb while open: reported, and allowed.
        if (name === 'picker' || name.startsWith('more-xr')) expect(covering.length, row).toBeGreaterThan(0)
        if (v.more.notice) {
          const edge = bench.worldToLocal(find(bench, 'shell:more:plate').localToWorld(new Vector3(0, -0.5, 0)))
          expect(edge.y).toBeCloseTo(SPATIAL_LAYOUT.popover.bottom, 2)
        }
        for (const id of controls) expect(shown, row).toContain(id)
        // Near the middle of the view: within 40 degrees of the head's view axis.
        const forward = new Vector3(0, 0, -1).applyQuaternion(HEAD.quaternion)
        expect((forward.angleTo(centre.clone().sub(HEAD.position)) * 180) / Math.PI).toBeLessThan(40)
      }
      shell.dispose()
    })
  }

  it('its whole extent (the soft glow at the bloom start included) is below the scene box', () => {
    const { src } = source('listening', true)
    const { bench, root, shell } = mounted(view('sculpture'), src)
    const c = bench.worldToLocal(root.getWorldPosition(new Vector3()))
    const ext = XR_ORB_EXTENT * FRONT.scale
    expect(Math.abs(c.x)).toBeLessThan(1e-9) // centred
    expect(c.y + ext).toBeLessThan(SCENE_BOX.y[0])
    expect(c.z).toBeGreaterThan(-0.05)
    shell.dispose()
  })
})

describe('the hold-to-talk hint above the orb', () => {
  // "Hold A to talk" (SPATIAL_LAYOUT.orbHint): shown only while the orb is idle and the assistant's own XR Talk is idle
  // and enabled (its "or hold A or X to talk"); it fades in, fades out as soon as the orb leaves idle (so it never
  // covers the listening ripple or the bloom) and hides at once with the orb. Shown, from the default head pose, both
  // eyes see it clear of the idle orb, of every demonstration's stage content and of every panel and control, in view.
  let plates: ReturnType<typeof recordPlates>
  beforeAll(() => {
    plates = recordPlates()
  })
  afterAll(() => plates.restore())

  const withVoice = (v: UiView, voice: VoiceState = { kind: 'idle' }): UiView => ({ ...v, assistant: panelInput(docs()[v.assistant.demo], { surface: 'xr', voice }) })
  const run = (shell: SpatialShell, frames: number) => {
    for (let i = 0; i < frames; i++) shell.step(frameAt(i * 1000 * DT))
  }
  const hint = (shell: SpatialShell) => shell.report().orb!.hint
  const FADE_IN = Math.ceil(SPATIAL_LAYOUT.orbHint.fadeIn / DT) + 1
  const FADE_OUT = Math.ceil(SPATIAL_LAYOUT.orbHint.fadeOut / DT) + 1

  it('fades in over the idle orb, out as soon as the orb starts listening, and hides at once with the orb', () => {
    const { s, src } = source('idle')
    const { shell } = mounted(withVoice(view('sculpture', 'assistant')), src)
    expect(hint(shell)).toEqual({ shown: false, opacity: 0 })
    run(shell, 3)
    expect(hint(shell).opacity).toBeGreaterThan(0)
    expect(hint(shell).opacity).toBeLessThan(1)
    run(shell, FADE_IN)
    expect(hint(shell)).toEqual({ shown: true, opacity: 1 })
    s.phase = 'listening'
    run(shell, FADE_OUT)
    expect(hint(shell)).toEqual({ shown: false, opacity: 0 })
    for (const phase of ['transcribing', 'thinking', 'applied', 'error'] as const) {
      s.phase = phase
      run(shell, FADE_IN)
      expect(hint(shell), phase).toEqual({ shown: false, opacity: 0 })
    }
    s.phase = 'idle'
    run(shell, FADE_IN)
    expect(hint(shell).shown).toBe(true)
    // An open popover (the picker, More) would cover part of it: it fades out, and back in when the popover closes.
    const idle = withVoice(view('sculpture', 'assistant'))
    for (const popover of ['experiments', 'more'] as const) {
      shell.render({ ...idle, popover })
      run(shell, FADE_OUT)
      expect(hint(shell), popover).toEqual({ shown: false, opacity: 0 })
      shell.render(idle)
      run(shell, FADE_IN)
      expect(hint(shell), popover).toEqual({ shown: true, opacity: 1 })
    }
    shell.render(withVoice(view('sculpture', 'math')))
    expect(hint(shell)).toEqual({ shown: false, opacity: 0 })
    shell.dispose()
  })

  it('stays hidden while hold-to-talk is not usable, and snaps under reduced motion', () => {
    const { src } = source('idle')
    const { shell } = mounted(withVoice(view('sculpture', 'assistant'), VOICE.unavailable), src)
    run(shell, FADE_IN)
    expect(hint(shell)).toEqual({ shown: false, opacity: 0 })
    shell.dispose()
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const reduced = mounted(withVoice(view('sculpture', 'assistant')), source('idle').src).shell
    run(reduced, 1)
    expect(hint(reduced)).toEqual({ shown: true, opacity: 1 })
    reduced.dispose()
  })

  const VIEWS: [string, UiView][] = [
    ['sculpture', view('sculpture', 'assistant')],
    ['braid', view('braid', 'assistant')],
    ['cube', view('cube', 'assistant')],
    ['pq', view('pq', 'assistant')],
    ['order', view('order', 'assistant')],
    ['quotient', view('quotient', 'assistant')],
    ['proof', fixtureFor('proof', view('pq', 'assistant'))],
  ]
  for (const [name, v0] of VIEWS) {
    it(`${name}: shown, it clears the idle orb, the stage content and every panel and control, in view`, () => {
      const v = withVoice(v0)
      const { shell, bench, root } = mounted(v, source('idle').src, createAssistantSpatialContent(() => undefined))
      run(shell, FADE_IN)
      bench.updateMatrixWorld(true)
      const label = find(bench, 'shell:orb-hint:plate')
      expect(hint(shell).shown).toBe(true)
      const content = STAGE_CONTENT[v.experiment.kind]!
      const others: Object3D[] = []
      bench.traverse((o) => {
        if (o === label) return
        const plate = /^shell:.*:plate$/.test(o.name) && !o.name.startsWith('shell:tooltip')
        const control = o.name.startsWith('assistant:') && o.name !== 'assistant:backing'
        if (!plate && !control) return
        for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return
        others.push(o)
      })
      expect(others.map((o) => o.name)).toContain('shell:toolbar:plate')
      expect(others.map((o) => o.name)).toContain('assistant:talk')
      EYES.forEach(([side, cam], i) => {
        const L = project(label, plateOutline(plates.drawn, label), cam)
        expect(separation(L, orbOutline(cam, root, ORB_LOOKS.idle.radius)), `${side}: the idle orb`).toBeGreaterThan(0)
        expect(separation(L, content[i ? 'R' : 'L']), `${side}: the ${v.experiment.kind} content`).toBeGreaterThan(0)
        for (const o of others) {
          const local = /^shell:/.test(o.name) ? plateOutline(plates.drawn, o) : CORNERS.map(([x, y]) => new Vector3(x, y, 0))
          expect(separation(L, project(o, local, cam)), `${side}: ${o.name}`).toBeGreaterThan(0)
        }
        for (const [x, y] of L) expect(Math.max(Math.abs(x), Math.abs(y)), side).toBeLessThan(1)
      })
      shell.dispose()
    })
  }
})
