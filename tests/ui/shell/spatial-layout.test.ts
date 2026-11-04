// The spatial shell's layout around the assistant (the front orb's room). While the assistant inspector is open the
// context panel (the experiment's actions and its status line) is hidden: it fades out over
// SPATIAL_LAYOUT.contextFade.seconds when the inspector opens and back in when it closes, never moves, and is not
// pickable (no hits, no highlight) from the start of its fade-out to the start of its fade-in; while fading it writes no
// depth. The toolbar moves a little lower and nearer (SPATIAL_LAYOUT.lowered), to ONE place for every experiment, only
// when the assistant opens or closes (an ease in and out over lowered.seconds; instant under reduced motion, for a
// hidden shell and for the first view), never per question or for the mathematics inspector; its hits follow it; the
// popovers keep their places, above the toolbar in both of its places. Seen by both eyes from the default head pose
// (tests/ui/shell/eyes.ts), the side panel (either inspector, all seven demonstrations) clears the context panel while
// it shows and the toolbar at every point between its places, and stays whole in view; the toolbar at its place for
// the assistant stays in view and pointable from the controllers. Node has no canvas: a fake 2D context measures text
// by length; TextSlot (MathJax) is replaced by an inert stand-in; the assistant content is an inert stand-in of the
// real panel's size.

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Group, Ray, Vector3, type Material } from 'three'

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

import { setCanvasFactory, type CanvasPanel } from '../../../src/ui/shell/panel'
import { SpatialShell, SPATIAL_LAYOUT } from '../../../src/ui/shell/spatial'
import { FIXTURES, fixtureFor } from '../../../src/ui/shell/fixtures'
import { PANEL } from '../../../src/ui/assistant/spatialLayout'
import { setOrbCanvasFactory } from '../../../src/ui/orb/xr'
import type { FrameContext } from '../../../src/runtime/host'
import type { SpatialPanelContent, UiCommand, UiView } from '../../../src/ui/model'
import { EYES, plateOutline, project, recordPlates, separation, shownPlate } from './eyes'

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

let plates: ReturnType<typeof recordPlates>
beforeAll(() => {
  setCanvasFactory(fakeCanvas)
  setOrbCanvasFactory(fakeCanvas)
  plates = recordPlates()
})
afterAll(() => plates.restore())
afterEach(() => {
  vi.unstubAllGlobals()
})

const DT = 1 / 72
const DROP = SPATIAL_LAYOUT.lowered.drop
const FORWARD = SPATIAL_LAYOUT.lowered.forward
const FADE = SPATIAL_LAYOUT.contextFade.seconds
const frame = (i = 0): FrameContext => ({ time: i * DT, dt: DT, frame: i, presenting: true, xrFrame: null, head: new Vector3(0, 1.6, 0) })

/** The real assistant panel's size (src/ui/assistant/spatialLayout.ts PANEL), drawing nothing. */
function panelSized(): SpatialPanelContent {
  return { width: PANEL.width, height: PANEL.height, mount() {}, render() {}, step() {}, pick: () => null, setHover() {}, setVisible() {}, dispose() {} }
}

const view = (name: string, inspector?: UiView['inspector']): UiView => {
  const v = FIXTURES[name]!.view('xr')
  return inspector === undefined ? v : { ...v, inspector }
}

/**
 * The braid demonstration's context as the app shows it on a first visit (measured in IWER on 2026-11-02: labelled
 * Rewrite and Example rows and a hint, 0.965 x 0.293 m, the tallest context panel of the seven; the fixture's is
 * shorter). Node's fake text measure lays it out wider and shorter, so a longer hint brings it to that height.
 */
function braidAsShown(): UiView {
  const v = view('braid')
  const run = { kind: 'none' } as const
  const off = { enabled: false, reason: 'Select a crossing first', run }
  const choice = (id: string, label: string, selected: boolean) => ({ id, label: { plain: label }, role: 'choice' as const, selected, enabled: true, run })
  return {
    ...v,
    presentation: {
      ...v.presentation,
      context: {
        title: 'Rewrite at a crossing',
        groups: [
          { id: 'rewrite', label: 'Rewrite', layout: 'actions', items: [
            { id: 'rewrite:braid_relation', label: { plain: 'Apply braid relation' }, role: 'primary', ...off },
            { id: 'rewrite:cancel_pair', label: { plain: 'Cancel inverse pair' }, role: 'secondary', ...off },
            { id: 'rewrite:insert_pair:1', label: { plain: 'Insert σ1 σ1⁻¹' }, role: 'secondary', ...off },
            { id: 'rewrite:insert_pair:2', label: { plain: 'Insert σ2 σ2⁻¹' }, role: 'secondary', ...off },
          ] },
          { id: 'example', label: 'Example', layout: 'choices', items: [
            choice('example:relation', 'Braid relation', true), choice('example:double', 'Double crossing', false), choice('example:cancel', 'Inverse pair', false),
          ] },
        ],
        hint: 'Select a crossing on the stage to see its rewrite: the braid relation where three strands cross, an inverse pair to cancel, or an inverse pair to insert at that crossing',
      },
      status: { phase: 'ready', text: 'Same endpoints; equivalence not established · σ1 σ2 σ1 vs σ2 σ1 σ2', tone: 'normal' },
    },
  }
}

/** All seven demonstrations (assistant closed; the tests choose the inspector), and the braid as the app shows it. */
const DEMOS: [string, UiView][] = [
  ['sculpture', view('sculpture-closed')],
  ['pq', view('pq', null)],
  ['order', view('order')],
  ['cube', view('cube')],
  ['quotient', view('quotient')],
  ['braid', view('braid')], // with proof, the widest context panel
  ['proof', fixtureFor('proof', view('pq', null))],
  ['braid as the app shows it', braidAsShown()], // the tallest context panel
]

/** A visible shell on a bench placed like the app's, showing `v`, with an orb (the app's XR shell has one). */
function setup(v: UiView) {
  const sent: UiCommand[] = []
  const shell = new SpatialShell({ dispatch: (c) => void sent.push(c), assistant: panelSized(), orb: { phase: () => 'idle', level: () => 0 } })
  const bench = new Group()
  bench.position.set(0, 1.02, -0.8)
  shell.mount(bench)
  shell.setVisible(true)
  shell.render(v)
  bench.updateMatrixWorld(true)
  const panel = (name: string) => (shell as unknown as { pickable: CanvasPanel[] }).pickable.find((p) => p.name === name)!
  return { shell, bench, sent, ctx: panel('shell:context'), tb: panel('shell:toolbar'), panel }
}

/** Step until the toolbar's ease is done (at most 2 s); returns its fraction after each frame. */
function settle(shell: SpatialShell, start = 0): number[] {
  const at: number[] = []
  for (let i = 0; i < 144 && shell.report().lowered.moving; i++) {
    shell.step(frame(start + i))
    at.push(shell.report().lowered.at)
  }
  return at
}

/** Step until the context panel's fade is done (at most 2 s); returns its opacity after each frame. */
function fade(shell: SpatialShell, start = 0): number[] {
  const at: number[] = []
  for (let i = 0; i < 144 && shell.report().context.moving; i++) {
    shell.step(frame(start + i))
    at.push(shell.report().context.opacity)
  }
  return at
}

/** The toolbar's standard place (top-left corner, bench-local) for its size, before any step for a tall context. */
function standard(tb: CanvasPanel): Vector3 {
  const L = SPATIAL_LAYOUT.toolbar
  return new Vector3(-tb.width / 2, L.centerY + (tb.height / 2) * Math.cos(L.tilt), L.z + (tb.height / 2) * Math.sin(L.tilt))
}

/** A ray straight at the centre of a region, from 0.4 m in front of it. */
function rayAt(panel: CanvasPanel, id: string): Ray {
  const r = panel.findHit(id)!
  panel.group.updateWorldMatrix(true, false)
  const target = new Vector3(r.x + r.w / 2, -(r.y + r.h / 2), 0).applyMatrix4(panel.group.matrixWorld)
  const normal = new Vector3(0, 0, 1).transformDirection(panel.group.matrixWorld)
  return new Ray(target.clone().addScaledVector(normal, 0.4), normal.clone().negate())
}

describe('the context panel fades while the assistant is open', () => {
  it('opening the assistant fades it out over the fade time (eased) and hides it; closing fades it back; it never moves', () => {
    const { shell, ctx } = setup(view('sculpture-closed'))
    const place = ctx.group.position.clone()
    const tilt = ctx.group.rotation.x
    const mat = ctx.mesh.material as Material
    expect(shell.report().context).toEqual({ opacity: 1, to: 1, moving: false, pickable: true })
    expect(mat.depthWrite).toBe(true)
    shell.render(view('sculpture')) // the assistant opens
    expect(shell.report().context).toEqual({ opacity: 1, to: 0, moving: true, pickable: false })
    const out = fade(shell)
    expect(FADE).toBeGreaterThanOrEqual(0.25)
    expect(FADE).toBeLessThanOrEqual(0.35)
    expect(out.length).toBe(Math.ceil(FADE / DT - 1e-9))
    out.forEach((a, i) => i && expect(a).toBeLessThanOrEqual(out[i - 1]!)) // never back
    expect(out[0]!).toBeGreaterThan(0.95) // eases out
    expect(out[Math.floor(out.length / 2)]!).toBeGreaterThan(0.3)
    expect(out[Math.floor(out.length / 2)]!).toBeLessThan(0.7)
    expect(out[out.length - 1]).toBe(0)
    expect(shell.report().context).toEqual({ opacity: 0, to: 0, moving: false, pickable: false })
    expect(ctx.group.visible).toBe(false) // not drawn at all
    expect(shell.report().panels.find((p) => p.name === 'shell:context')!.shown).toBe(false)
    expect(ctx.group.position.distanceTo(place)).toBe(0)
    expect(ctx.group.rotation.x).toBe(tilt)
    shell.render(view('sculpture-closed')) // closed again
    expect(shell.report().context).toMatchObject({ to: 1, moving: true, pickable: true })
    expect(ctx.group.visible).toBe(true)
    const back = fade(shell, 100)
    expect(back.length).toBe(out.length)
    expect(back[back.length - 1]).toBe(1)
    expect(mat.opacity).toBe(1)
    expect(mat.depthWrite).toBe(true)
    expect(ctx.group.position.distanceTo(place)).toBe(0)
  })

  it('while fading it writes no depth (it never cuts the orb out), and a reversal mid-fade starts from where it is', () => {
    const { shell, ctx } = setup(view('sculpture-closed'))
    const mat = ctx.mesh.material as Material
    shell.render(view('sculpture'))
    for (let i = 0; i < 10; i++) shell.step(frame(i))
    const mid = shell.report().context.opacity
    expect(mid).toBeGreaterThan(0.1)
    expect(mid).toBeLessThan(0.9)
    expect(mat.opacity).toBeCloseTo(mid, 4)
    expect(mat.depthWrite).toBe(false)
    shell.render(view('sculpture-closed'))
    expect(shell.report().context.opacity).toBe(mid)
    shell.step(frame(10))
    expect(shell.report().context.opacity).toBeGreaterThanOrEqual(mid)
    expect(shell.report().context.opacity - mid).toBeLessThan(0.1) // a small first step back
    fade(shell, 11)
    expect(shell.report().context.opacity).toBe(1)
    expect(mat.depthWrite).toBe(true)
  })

  it('is not pickable from the start of its fade-out: no hit, no highlight; pickable again from the start of its fade-in', () => {
    const { shell, ctx } = setup(view('sculpture-closed'))
    const apply = rayAt(ctx, 'shell:ctx:apply')
    const toggle = rayAt(ctx, 'shell:math')
    expect(shell.pick(apply)?.command).toEqual({ kind: 'context', id: 'apply' })
    shell.setHover('shell:ctx:apply')
    let overlay: { visible: boolean; parent: unknown } | undefined
    ctx.group.traverse((o) => void (o.name === 'shell:hover' && (overlay = o)))
    expect(overlay?.visible).toBe(true)
    shell.render(view('sculpture')) // fading out: not pickable at once
    expect(shell.report().context.opacity).toBe(1)
    expect(overlay!.visible).toBe(false) // the highlight on it is dropped
    for (const ray of [apply, toggle]) {
      const p = shell.pick(ray)
      expect(p?.id ?? '').not.toMatch(/^shell:(ctx:|math$|context$)/)
    }
    shell.setHover('shell:ctx:apply')
    expect(overlay!.visible).toBe(false)
    fade(shell)
    for (const ray of [apply, toggle]) expect(shell.pick(ray)?.id ?? '').not.toMatch(/^shell:(ctx:|math$|context$)/)
    shell.render(view('sculpture-closed')) // fading back in: pickable again
    expect(shell.pick(apply)?.command).toEqual({ kind: 'context', id: 'apply' })
    expect(shell.pick(toggle)?.command).toEqual({ kind: 'inspector', which: 'math' })
  })

  it('never per question: while the assistant stays open, new answers, statuses, experiments and popovers keep it hidden', () => {
    const { shell, ctx } = setup(view('sculpture'))
    expect(shell.report().context).toEqual({ opacity: 0, to: 0, moving: false, pickable: false }) // the first view: at once
    const open = (v: UiView): UiView => ({ ...v, inspector: 'assistant' })
    const s = view('sculpture')
    let i = 0
    for (const v of [
      { ...s, presentation: { ...s.presentation, status: { ...s.presentation.status, text: 'Applied +1 · 1 move' } } },
      open(view('braid')), view('picker'), open(view('more-xr')), open(view('cube')), open(braidAsShown()),
    ]) {
      shell.render(v)
      expect(shell.report().context).toEqual({ opacity: 0, to: 0, moving: false, pickable: false })
      expect(ctx.group.visible).toBe(false)
      for (let k = 0; k < 10; k++) shell.step(frame(i++))
    }
  })

  it('the mathematics inspector never hides it; switching between the inspectors fades it', () => {
    const { shell } = setup(view('sculpture-closed'))
    shell.render(view('sculpture-math'))
    expect(shell.report().context).toEqual({ opacity: 1, to: 1, moving: false, pickable: true })
    shell.render(view('sculpture'))
    expect(shell.report().context).toMatchObject({ to: 0, moving: true })
    fade(shell)
    shell.render(view('sculpture-math'))
    expect(shell.report().context).toMatchObject({ opacity: 0, to: 1, moving: true, pickable: true })
    fade(shell)
    expect(shell.report().context).toEqual({ opacity: 1, to: 1, moving: false, pickable: true })
  })

  it('a hidden shell takes it at once (entering XR); under reduced motion it still fades (it does not move)', () => {
    const { shell, ctx } = setup(view('sculpture-closed'))
    shell.setVisible(false)
    shell.render(view('sculpture'))
    expect(shell.report().context).toEqual({ opacity: 0, to: 0, moving: false, pickable: false })
    shell.setVisible(true)
    expect(ctx.group.visible).toBe(false)
    shell.render(view('sculpture-closed'))
    shell.step(frame())
    expect(shell.report().context.moving).toBe(true) // visible: faded
    shell.setVisible(false)
    shell.setVisible(true) // shown again mid-fade: as the open inspector has it
    expect(shell.report().context).toEqual({ opacity: 1, to: 1, moving: false, pickable: true })
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const reduced = setup(view('sculpture-closed'))
    reduced.shell.render(view('sculpture'))
    expect(reduced.shell.report().context).toMatchObject({ opacity: 1, to: 0, moving: true })
    expect(fade(reduced.shell).length).toBe(Math.ceil(FADE / DT - 1e-9))
  })
})

describe("the toolbar's small move while the assistant is open", () => {
  it('opening the assistant eases it a little lower and nearer over the ease time (in and out); closing eases it back', () => {
    const { shell, tb } = setup(view('sculpture-closed'))
    const base = tb.group.position.clone()
    const rot = tb.group.rotation.x
    expect(base.distanceTo(standard(tb))).toBeLessThan(1e-9) // a short context panel: its standard place
    expect(shell.report().lowered).toEqual({ at: 0, to: 0, moving: false })
    shell.render(view('sculpture')) // the assistant opens
    expect(shell.report().lowered).toEqual({ at: 0, to: 1, moving: true })
    expect(tb.group.position.distanceTo(base)).toBeLessThan(1e-9) // the ease starts from where it is
    const at = settle(shell)
    expect(at.length).toBe(Math.ceil(SPATIAL_LAYOUT.lowered.seconds / DT - 1e-9))
    expect(SPATIAL_LAYOUT.lowered.seconds).toBeGreaterThanOrEqual(0.35)
    expect(SPATIAL_LAYOUT.lowered.seconds).toBeLessThanOrEqual(0.45)
    at.forEach((a, i) => i && expect(a).toBeGreaterThanOrEqual(at[i - 1]!)) // never back
    expect(at[0]!).toBeLessThan(DT / SPATIAL_LAYOUT.lowered.seconds) // eases in
    expect(at[Math.floor(at.length / 2)]!).toBeGreaterThan(0.35) // halfway in time, about halfway there
    expect(at[Math.floor(at.length / 2)]!).toBeLessThan(0.65)
    expect(at[at.length - 1]).toBe(1)
    const d = tb.group.position.clone().sub(base)
    expect(d.x).toBeCloseTo(0, 9)
    expect(d.y).toBeCloseTo(-DROP, 9)
    expect(d.z).toBeCloseTo(FORWARD, 9)
    expect(tb.group.rotation.x).toBe(rot) // the tilt is unchanged
    shell.render(view('sculpture-closed')) // closed again
    const back = settle(shell, 100)
    expect(back.length).toBe(at.length)
    expect(tb.group.position.distanceTo(base)).toBeLessThan(1e-9)
  })

  it('a little: under 12 cm lower and 12 cm nearer (the context panel no longer moves at all), and no jump on a reversal', () => {
    expect(DROP).toBeGreaterThan(0.05)
    expect(DROP).toBeLessThanOrEqual(0.12)
    expect(FORWARD).toBeGreaterThanOrEqual(0)
    expect(FORWARD).toBeLessThanOrEqual(0.12)
    const { shell, tb } = setup(view('sculpture-closed'))
    const y0 = tb.group.position.y
    shell.render(view('sculpture'))
    for (let i = 0; i < 12; i++) shell.step(frame(i))
    const mid = tb.group.position.y
    expect(mid).toBeLessThan(y0 - 0.1 * DROP)
    expect(mid).toBeGreaterThan(y0 - 0.9 * DROP)
    shell.render(view('sculpture-closed'))
    expect(tb.group.position.y).toBe(mid)
    shell.step(frame(12))
    expect(Math.abs(tb.group.position.y - mid)).toBeLessThan(0.01) // a small first step back up
    expect(tb.group.position.y).toBeGreaterThanOrEqual(mid)
    settle(shell, 13)
    expect(tb.group.position.y).toBeCloseTo(y0, 9)
  })

  it('ONE place for every experiment while it is open (the tall braid panel too), never moved per question', () => {
    const { shell, tb } = setup(view('sculpture'))
    expect(shell.report().lowered).toEqual({ at: 1, to: 1, moving: false }) // the first view: at once
    const place = tb.group.position.clone()
    expect(place.distanceTo(standard(tb).add(new Vector3(0, -DROP, FORWARD)))).toBeLessThan(1e-9)
    const open = (v: UiView): UiView => ({ ...v, inspector: 'assistant' })
    const s = view('sculpture')
    const views: UiView[] = [
      { ...s, presentation: { ...s.presentation, status: { ...s.presentation.status, text: 'Applied +1 · 1 move' } } },
      open(view('sculpture-math')), open(view('braid')), view('picker'), open(view('more-xr')), open(view('cube')),
      ...DEMOS.map(([, v]) => open(v)),
    ]
    let i = 0
    for (const v of views) {
      shell.render(v)
      expect(shell.report().lowered).toEqual({ at: 1, to: 1, moving: false })
      for (let k = 0; k < 10; k++) shell.step(frame(i++))
      expect(tb.group.position.distanceTo(place)).toBeLessThan(1e-9)
    }
    // The tall braid panel steps the closed toolbar down; opening the assistant still moves it down (a little).
    const tall = setup(braidAsShown())
    const closed = tall.tb.group.position.clone()
    expect(closed.y).toBeLessThan(standard(tall.tb).y - 0.05)
    tall.shell.render(open(braidAsShown()))
    settle(tall.shell)
    expect(tall.tb.group.position.distanceTo(place)).toBeLessThan(1e-9)
    expect(tall.tb.group.position.y).toBeLessThan(closed.y)
  })

  it('the mathematics inspector never moves it; switching between the inspectors eases it', () => {
    const { shell } = setup(view('sculpture-closed'))
    shell.render(view('sculpture-math'))
    expect(shell.report().lowered).toEqual({ at: 0, to: 0, moving: false })
    shell.render(view('sculpture'))
    expect(shell.report().lowered).toMatchObject({ to: 1, moving: true })
    settle(shell)
    shell.render(view('sculpture-math'))
    expect(shell.report().lowered).toMatchObject({ at: 1, to: 0, moving: true })
    settle(shell)
    expect(shell.report().lowered).toEqual({ at: 0, to: 0, moving: false })
  })

  it('reduced motion moves it at once, both ways', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const { shell, tb } = setup(view('sculpture-closed'))
    const p0 = tb.group.position.clone()
    shell.render(view('sculpture'))
    expect(shell.report().lowered).toEqual({ at: 1, to: 1, moving: false })
    expect(tb.group.position.y).toBeCloseTo(p0.y - DROP, 9)
    expect(tb.group.position.z).toBeCloseTo(p0.z + FORWARD, 9)
    shell.render(view('sculpture-closed'))
    expect(tb.group.position.distanceTo(p0)).toBeLessThan(1e-9)
  })

  it('a hidden shell takes the place at once, and is there when shown again (entering XR)', () => {
    const { shell, tb } = setup(view('sculpture-closed'))
    const p0 = tb.group.position.clone()
    shell.setVisible(false)
    shell.render(view('sculpture'))
    expect(shell.report().lowered).toEqual({ at: 1, to: 1, moving: false })
    shell.setVisible(true)
    expect(tb.group.position.y).toBeCloseTo(p0.y - DROP, 9)
    shell.render(view('sculpture-closed'))
    shell.step(frame())
    expect(shell.report().lowered.moving).toBe(true) // visible: eased
    shell.setVisible(false)
    shell.setVisible(true) // shown again mid-ease: where the open inspector puts it
    expect(shell.report().lowered).toEqual({ at: 0, to: 0, moving: false })
    expect(tb.group.position.distanceTo(p0)).toBeLessThan(1e-9)
  })

  it('its hits follow it: a ray at a moved button picks it; one at its old place no longer does', () => {
    const { shell, tb } = setup(view('sculpture-closed'))
    const old = rayAt(tb, 'shell:tb:experiments')
    expect(shell.pick(old)?.id).toBe('shell:tb:experiments')
    shell.render(view('sculpture'))
    settle(shell)
    expect(shell.pick(rayAt(tb, 'shell:tb:experiments'))?.command).toEqual({ kind: 'popover', which: 'experiments' })
    expect(shell.pick(old)?.id).not.toBe('shell:tb:experiments')
    // The hover highlight and the tooltip ride on the panel.
    shell.setHover('shell:tb:experiments')
    let overlay: { parent: unknown } | undefined
    tb.group.traverse((o) => void (o.name === 'shell:hover' && (overlay = o)))
    expect(overlay?.parent).toBe(tb.group)
  })

  it('the popovers keep their places, above the toolbar (never over it) in both of its places, for both eyes', () => {
    const withNotice = (v: UiView): UiView => ({ ...v, more: { ...v.more, notice: { text: 'Microphone not available; typed and controller use still work', tone: 'error' } } })
    for (const [name, v, which] of [['picker', view('picker'), 'shell:picker'], ['more', withNotice(view('more-xr')), 'shell:more']] as const) {
      const places: number[][] = []
      for (const inspector of [null, 'assistant'] as const) {
        const { shell, bench, panel } = setup({ ...v, inspector })
        expect(shell.report().lowered.at).toBe(inspector ? 1 : 0)
        const pop = panel(which)
        places.push(pop.group.position.toArray())
        const p = shownPlate(bench, which)!
        const t = shownPlate(bench, 'shell:toolbar')!
        for (const [side, cam] of EYES) {
          const gap = separation(project(p, plateOutline(plates.drawn, p), cam), project(t, plateOutline(plates.drawn, t), cam))
          expect(gap, `${name}, ${inspector ?? 'closed'}, ${side}`).toBeGreaterThan(0)
        }
        // Its bottom edge above the toolbar's top edge (bench y).
        const bottom = bench.worldToLocal(p.localToWorld(new Vector3(0, -0.5, 0))).y
        const top = bench.worldToLocal(t.localToWorld(new Vector3(0, 0.5, 0))).y
        expect(bottom).toBeGreaterThan(top)
        expect(bottom).toBeGreaterThanOrEqual(SPATIAL_LAYOUT.popover.bottom - 1e-9)
        shell.dispose()
      }
      expect(places[1]).toEqual(places[0])
    }
  })
})

describe('the side panel and the toolbar, seen from the default head pose', () => {
  // Either inspector, switched from the other, so the toolbar eases through every place between its two while the
  // side panel is shown (math -> assistant, assistant -> math), and the context panel fades out or in meanwhile.
  for (const [name, base] of DEMOS) {
    it(`${name}: the side panel clears the context panel (while it shows) and the toolbar at every point, whole in view`, () => {
      for (const [from, to] of [['math', 'assistant'], ['assistant', 'math']] as const) {
        const { shell, bench } = setup({ ...base, inspector: from })
        shell.render({ ...base, inspector: to })
        const seen = new Set<number>()
        for (let i = 0; i < 40; i++) {
          bench.updateMatrixWorld(true)
          seen.add(shell.report().lowered.at)
          const f = shownPlate(bench, 'shell:inspector')!
          for (const [side, cam] of EYES) {
            const F = project(f, plateOutline(plates.drawn, f), cam)
            for (const [x, y] of F) expect(Math.max(Math.abs(x), Math.abs(y)), `${to}, ${side}: in view`).toBeLessThan(0.99)
            for (const n of ['shell:context', 'shell:toolbar']) {
              const o = shownPlate(bench, n)
              if (!o) continue // the context panel, hidden
              const gap = separation(F, project(o, plateOutline(plates.drawn, o), cam))
              expect(gap, `${to} at ${shell.report().lowered.at}, ${side}: ${n}`).toBeGreaterThan(0.02)
            }
          }
          if (!shell.report().lowered.moving && !shell.report().context.moving) break
          shell.step(frame(i))
        }
        expect(seen.has(0) && seen.has(1)).toBe(true)
        expect(shownPlate(bench, 'shell:context') === null).toBe(to === 'assistant')
        shell.dispose()
      }
    })

    it(`${name}: the toolbar at its place for the assistant stays in view for both eyes and is pointable from either controller`, () => {
      const { shell, bench, tb, ctx } = setup({ ...base, inspector: 'assistant' })
      expect(shell.report().lowered.at).toBe(1)
      if (name === 'braid as the app shows it') expect(ctx.height).toBeGreaterThanOrEqual(0.29)
      const t = shownPlate(bench, 'shell:toolbar')!
      for (const [side, cam] of EYES) {
        for (const [x, y] of project(t, plateOutline(plates.drawn, t), cam)) {
          expect(Math.abs(x), `${side}: ${t.name}`).toBeLessThan(0.97)
          expect(Math.abs(y), `${side}: ${t.name}`).toBeLessThan(0.95) // inside the eye's image (45 degrees: 1)
        }
      }
      // Rays from where the hands rest (about 40 cm below the eyes, 20 cm to the side, 25 cm forward) reach every
      // toolbar entry first.
      for (const hand of [new Vector3(0.2, 1.2, 0.17), new Vector3(-0.2, 1.2, 0.17)]) {
        for (const h of tb.hits) {
          tb.group.updateWorldMatrix(true, false)
          const target = new Vector3(h.x + h.w / 2, -(h.y + h.h / 2), 0).applyMatrix4(tb.group.matrixWorld)
          const p = shell.pick(new Ray(hand, target.clone().sub(hand).normalize()))
          expect(p?.id, `${h.id} from ${hand.x > 0 ? 'right' : 'left'}`).toBe(h.id)
        }
      }
      shell.dispose()
    })
  }
})
