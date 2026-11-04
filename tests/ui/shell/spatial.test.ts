// Spatial shell picking and placement (UI-REFINEMENT-SPEC sections 3, 4): a disabled toolbar entry is hover-only
// with its reason, the picker's active card only closes it, an open popover swallows presses elsewhere, a hidden
// shell has no hit targets, page turns are local, no panel enters the scene box (with the assistant open too: the
// toolbar a little lower, the context panel hidden and out of reach), the toolbar and the context panel stay put when
// the mathematics inspector opens or closes (only the assistant moves the toolbar and hides the context panel:
// tests/ui/shell/spatial-layout.test.ts), the context actions stay put when the panel grows, and the plates keep
// their own depth writes. Node has no canvas: a fake 2D context measures text by length; TextSlot (MathJax) is
// replaced by an inert stand-in.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Group, Ray, Vector3, type Material, type Mesh } from 'three'

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
import { FIXTURES } from '../../../src/ui/shell/fixtures'
import { createStubSpatialContent } from '../../../src/ui/shell/stubAssistant'
import type { UiCommand, UiView } from '../../../src/ui/model'

function fakeCanvas(): HTMLCanvasElement {
  let font = '10px sans-serif'
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (prop === 'measureText') return (t: string) => ({ width: t.length * Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) * 0.52 })
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} })
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

beforeAll(() => setCanvasFactory(fakeCanvas))

function setup(name: string): { shell: SpatialShell; bench: Group; view: UiView; sent: UiCommand[] } {
  const sent: UiCommand[] = []
  const shell = new SpatialShell({ dispatch: (c) => void sent.push(c), assistant: createStubSpatialContent() })
  const bench = new Group()
  bench.position.set(0, 1.02, -0.8)
  shell.mount(bench)
  shell.setVisible(true)
  const view = FIXTURES[name]!.view('xr')
  shell.render(view)
  bench.updateMatrixWorld(true)
  return { shell, bench, view, sent }
}

const panels = (shell: SpatialShell) => (shell as unknown as { pickable: CanvasPanel[] }).pickable

/** A ray straight at the centre of a panel's region, from 0.4 m in front of it (shown or not). */
function rayAtRegion(p: CanvasPanel, r: { x: number; y: number; w: number; h: number }): Ray {
  p.group.updateWorldMatrix(true, false)
  const target = new Vector3(r.x + r.w / 2, -(r.y + r.h / 2), 0).applyMatrix4(p.group.matrixWorld)
  const normal = new Vector3(0, 0, 1).transformDirection(p.group.matrixWorld)
  return new Ray(target.clone().addScaledVector(normal, 0.4), normal.clone().negate())
}

/** A ray straight at the centre of a region (or of a panel), from 0.4 m in front of it. */
function rayAt(shell: SpatialShell, id: string): Ray {
  for (const p of panels(shell)) {
    if (!p.shown) continue
    const r = id === p.name ? { x: 0, y: 0, w: p.width, h: p.height } : p.findHit(id)
    if (!r) continue
    p.group.updateWorldMatrix(true, false)
    const target = new Vector3(r.x + r.w / 2, -(r.y + r.h / 2), 0).applyMatrix4(p.group.matrixWorld)
    const normal = new Vector3(0, 0, 1).transformDirection(p.group.matrixWorld)
    return new Ray(target.clone().addScaledVector(normal, 0.4), normal.clone().negate())
  }
  throw new Error(`no region ${id}`)
}

describe('spatial shell picking', () => {
  it('a disabled toolbar entry is hover-only and gives its reason', () => {
    const { shell } = setup('sculpture-closed')
    const p = shell.pick(rayAt(shell, 'shell:tb:play'))
    expect(p?.id).toBe('shell:tb:play')
    expect(p?.command).toBeNull()
    expect(p?.hint).toBe('Nothing to play yet')
    shell.activate(p)
  })

  it('enabled entries return their command; activate dispatches it once', () => {
    const { shell, sent } = setup('sculpture-closed')
    const p = shell.pick(rayAt(shell, 'shell:tb:experiments'))
    expect(p?.command).toEqual({ kind: 'popover', which: 'experiments' })
    expect(shell.pick(rayAt(shell, 'shell:ctx:apply'))?.command).toEqual({ kind: 'context', id: 'apply' })
    expect(shell.pick(rayAt(shell, 'shell:math'))?.command).toEqual({ kind: 'inspector', which: 'math' })
    shell.activate(p)
    expect(sent).toEqual([{ kind: 'popover', which: 'experiments' }])
  })

  it('the active experiment card only closes the picker; another card chooses that experiment', () => {
    const { shell } = setup('picker')
    expect(shell.pick(rayAt(shell, 'shell:pick:sculpture'))?.command).toEqual({ kind: 'popover', which: null })
    expect(shell.pick(rayAt(shell, 'shell:pick:braid'))?.command).toEqual({ kind: 'experiment', demo: 'braid' })
  })

  it('with a popover open, a press that misses the shell closes it instead of reaching the scene', () => {
    const { shell } = setup('picker')
    const away = new Ray(new Vector3(0, 1.02, 0.5), new Vector3(0, 1, 0))
    expect(shell.pick(away)).toMatchObject({ id: 'shell:dismiss', command: { kind: 'popover', which: null } })
    const { shell: closed } = setup('sculpture-closed')
    expect(closed.pick(away)).toBeNull()
  })

  it('a hidden shell has no hit targets', () => {
    const { shell } = setup('sculpture-closed')
    const ray = rayAt(shell, 'shell:tb:experiments')
    shell.setVisible(false)
    expect(shell.pick(ray)).toBeNull()
    shell.setVisible(true)
    expect(shell.pick(ray)).not.toBeNull()
  })

  it('XR More shows no export/import entries', () => {
    const { shell } = setup('more-xr')
    const ids = panels(shell).flatMap((p) => (p.shown ? p.hits.map((h) => h.id) : []))
    expect(ids).toContain('shell:more:save')
    expect(ids).toContain('shell:more:exitSession')
    expect(ids.some((i) => /export|import|enterVR|saveRepresentation/.test(i))).toBe(false)
  })

  it('mathematics page turns are local presses (never a UiCommand)', () => {
    const { shell, sent } = setup('pq')
    expect(shell.report().mathPages).toBeGreaterThan(1)
    const next = shell.pick(rayAt(shell, 'shell:math:next'))
    expect(next?.command).toBeNull()
    shell.activate(next)
    expect(shell.report().mathPage).toBe(1)
    shell.activate(shell.pick(rayAt(shell, 'shell:math:prev')))
    expect(shell.report().mathPage).toBe(0)
    expect(sent).toEqual([])
    expect(shell.press('shell:tb:undo')).toBe(false)
  })
})

describe('spatial shell placement', () => {
  const box = { x: [-0.5, 0.5], y: [-0.24, 0.32], z: [-0.25, 0.15] }
  const inside = (v: Vector3) => v.x > box.x[0]! && v.x < box.x[1]! && v.y > box.y[0]! && v.y < box.y[1]! && v.z > box.z[0]! && v.z < box.z[1]!

  it('no shell panel enters the scene box, in any fixture', () => {
    for (const name of Object.keys(FIXTURES)) {
      const { shell, bench } = setup(name)
      const inv = bench.matrixWorld.clone().invert()
      for (const p of panels(shell)) {
        if (!p.shown) continue
        p.group.updateWorldMatrix(true, false)
        for (const [x, y] of [[0, 0], [p.width, 0], [0, -p.height], [p.width, -p.height], [p.width / 2, -p.height / 2]] as const) {
          const v = new Vector3(x, y, 0).applyMatrix4(p.group.matrixWorld).applyMatrix4(inv)
          expect(inside(v), `${name}: ${p.name} corner (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`).toBe(false)
        }
      }
    }
  })

  it('the toolbar and context panel stay put when the mathematics inspector opens or closes', () => {
    const { shell } = setup('sculpture-closed')
    const tb = panels(shell).find((p) => p.name === 'shell:toolbar')!
    const ctx = panels(shell).find((p) => p.name === 'shell:context')!
    const before = [tb.group.position.clone(), ctx.group.position.clone()]
    const closed = FIXTURES['sculpture-closed']!.view('xr')
    for (const v of [{ ...closed, inspector: 'math' as const }, closed]) {
      shell.render(v)
      for (let i = 0; i < 60; i++) shell.step({ time: i / 72, dt: 1 / 72, frame: i, presenting: true, xrFrame: null, head: new Vector3(0, 1.6, 0) })
      expect(tb.group.position.distanceTo(before[0]!)).toBeLessThan(1e-9)
      expect(ctx.group.position.distanceTo(before[1]!)).toBeLessThan(1e-9)
    }
    expect(SPATIAL_LAYOUT.inspector.left).toBeGreaterThan(0.5)
  })

  it('with the assistant open (the toolbar lower, the context panel hidden) no panel enters the scene box, in every demonstration', () => {
    for (const name of ['sculpture', 'braid', 'cube', 'pq', 'order', 'quotient']) {
      const { shell, bench } = setup(name)
      const ctx = panels(shell).find((p) => p.name === 'shell:context')!
      const apply = ctx.hits.find((h) => h.enabled)!
      shell.render({ ...FIXTURES[name]!.view('xr'), inspector: 'assistant' })
      for (let i = 0; i < 60; i++) shell.step({ time: i / 72, dt: 1 / 72, frame: i, presenting: true, xrFrame: null, head: new Vector3(0, 1.6, 0) })
      expect(shell.report().lowered).toMatchObject({ at: 1, moving: false })
      expect(shell.report().context).toEqual({ opacity: 0, to: 0, moving: false, pickable: false })
      expect(ctx.shown).toBe(false)
      expect(shell.pick(rayAtRegion(ctx, apply))?.id ?? '').not.toMatch(/^shell:ctx:/) // out of reach
      bench.updateMatrixWorld(true)
      const inv = bench.matrixWorld.clone().invert()
      for (const p of panels(shell)) {
        if (!p.shown) continue
        p.group.updateWorldMatrix(true, false)
        for (const [x, y] of [[0, 0], [p.width, 0], [0, -p.height], [p.width, -p.height], [p.width / 2, -p.height / 2]] as const) {
          const v = new Vector3(x, y, 0).applyMatrix4(p.group.matrixWorld).applyMatrix4(inv)
          expect(inside(v), `${name}: ${p.name} corner (${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`).toBe(false)
        }
      }
    }
  })
})

describe('spatial shell context panel and depth', () => {
  /** World position of a region's centre. */
  const centre = (shell: SpatialShell, id: string): Vector3 => {
    const p = panels(shell).find((x) => x.shown && x.findHit(id))!
    const r = p.findHit(id)!
    p.group.updateWorldMatrix(true, false)
    return new Vector3(r.x + r.w / 2, -(r.y + r.h / 2), 0).applyMatrix4(p.group.matrixWorld)
  }

  it('an appended action or a longer status extends the context panel to the right; the actions stay put', () => {
    const { shell, view } = setup('sculpture-closed')
    const ctx = panels(shell).find((p) => p.name === 'shell:context')!
    expect(ctx.group.position.x).toBeCloseTo(-ctx.width / 2, 9)
    const w0 = ctx.width
    const before = centre(shell, 'shell:ctx:op:c1')
    const extra = { id: 'extra', label: { plain: 'Inverse' }, role: 'secondary' as const, enabled: true, run: { kind: 'none' as const } }
    const groups = view.presentation.context.groups.map((g) => (g.id === 'apply' ? { ...g, items: [...g.items, extra] } : g))
    shell.render({
      ...view,
      key: 'grown',
      presentation: { ...view.presentation, context: { ...view.presentation.context, groups }, status: { ...view.presentation.status, text: 'Applied +1 · 1 move · accumulated 1 so far' } },
    })
    expect(ctx.width).toBeGreaterThan(w0)
    expect(centre(shell, 'shell:ctx:op:c1').distanceTo(before)).toBeLessThan(1e-9)
    expect(ctx.group.position.x + ctx.width).toBeLessThanOrEqual(SPATIAL_LAYOUT.context.maxWidth / 2 + 1e-9)
    // Back to the first item set: the panel keeps its left edge; a new experiment is centred again.
    shell.render(view)
    expect(centre(shell, 'shell:ctx:op:c1').distanceTo(before)).toBeLessThan(1e-9)
    shell.render(FIXTURES.braid!.view('xr'))
    expect(ctx.group.position.x).toBeCloseTo(-ctx.width / 2, 9)
  })

  it('every shell material keeps its own depth settings, and the plates write depth', () => {
    const { shell } = setup('sculpture-closed')
    shell.setHover('shell:tb:play') // disabled: faint highlight and a reason tooltip
    const seen: string[] = []
    shell.root.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined
      if (!m) return
      seen.push(o.name)
      expect(m.userData.ownDepth, o.name).toBe(true)
      if (o.name.endsWith(':plate')) expect(m.depthWrite, o.name).toBe(true)
    })
    expect(seen).toEqual(expect.arrayContaining(['shell:toolbar:plate', 'shell:context:plate', 'shell:tooltip:plate', 'shell:hover']))
  })
})
