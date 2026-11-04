// The mathematics inspector's scrolling view (SPATIAL_LAYOUT.mathScroll): a page that fits is shown whole and never
// scrolls; a page taller than the view (one block taller than a page, such as a Lean claim with its receipt) keeps the
// frame at its reserved height, shows its content through the view with a scrollbar and a hint, and scrolls with the
// thumbstick only while the ray is on the inspector (by the square of the deflection, clamped to the content); a new
// page, a new detail or the other inspector starts at the top. At the panel level, a view slides the texture window
// only: picks and the hover highlight follow it in drawing coordinates, and a region scrolled out of view has no
// highlight. Node has no canvas: a fake 2D context measures text by length; TextSlot is an inert stand-in.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Group, Ray, Vector3 } from 'three'

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

import { CanvasPanel, HoverOverlay, setCanvasFactory } from '../../../src/ui/shell/panel'
import { SpatialShell, SPATIAL_LAYOUT } from '../../../src/ui/shell/spatial'
import { FIXTURES } from '../../../src/ui/shell/fixtures'
import { createStubSpatialContent } from '../../../src/ui/shell/stubAssistant'
import type { DetailSection, UiView } from '../../../src/ui/model'

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

const VIEW = SPATIAL_LAYOUT.inspector.maxHeight - 0.066 - 0.016 - 0.054 // the title, the pad and the footer
const LONG = Array.from({ length: 120 }, (_, i) => `step ${i}: the receipt line that wraps across the panel`).join(' ')

/** pq's view with its mathematics replaced by `sections` (the inspector open on mathematics). */
function mathView(sections: DetailSection[]): UiView {
  const v = FIXTURES.pq!.view('xr')
  return { ...v, inspector: 'math', presentation: { ...v.presentation, detail: { ...v.presentation.detail, sections } } }
}
const TALL: DetailSection[] = [{ title: 'Lean claim', provenance: 'Lean receipt', items: [{ kind: 'text', text: LONG }] }]

function setup(view: UiView) {
  const shell = new SpatialShell({ dispatch: () => undefined, assistant: createStubSpatialContent() })
  const bench = new Group()
  bench.position.set(0, 1.02, -0.8)
  shell.mount(bench)
  shell.setVisible(true)
  shell.render(view)
  bench.updateMatrixWorld(true)
  return { shell, bench }
}

const frame = (shell: SpatialShell) => (shell as unknown as { frame: CanvasPanel }).frame
const content = (shell: SpatialShell) => (shell as unknown as { mathContent: CanvasPanel }).mathContent

/** A ray straight at panel-local point (x, y) (y down), from 0.4 m in front. */
function rayAtLocal(p: CanvasPanel, x: number, y: number): Ray {
  p.group.updateWorldMatrix(true, false)
  const target = new Vector3(x, -y, 0).applyMatrix4(p.group.matrixWorld)
  const normal = new Vector3(0, 0, 1).transformDirection(p.group.matrixWorld)
  return new Ray(target.clone().addScaledVector(normal, 0.4), normal.clone().negate())
}

describe('the mathematics inspector scrolls a page taller than its view', () => {
  it('a page that fits is shown whole and never scrolls', () => {
    const { shell } = setup(FIXTURES.pq!.view('xr'))
    expect(shell.report().mathScroll).toMatchObject({ scroll: 0, max: 0, view: null, thumb: false })
    const f = frame(shell)
    expect(shell.scrollMath(rayAtLocal(f, f.width / 2, 0.2), 1, 0.1)).toBe(false)
    expect(content(shell).shownHeight).toBeCloseTo(content(shell).height, 9)
    shell.dispose()
  })

  it('a tall page keeps the frame at its reserved height and shows its content through the view, with a scrollbar', () => {
    const { shell } = setup(mathView(TALL))
    const s = shell.report().mathScroll
    expect(s.max).toBeGreaterThan(0.3)
    expect(s.view).toBeCloseTo(VIEW, 4)
    expect(s.content).toBeCloseTo(VIEW + s.max, 4)
    expect(s.thumb).toBe(true)
    expect(frame(shell).height).toBeLessThanOrEqual(SPATIAL_LAYOUT.inspector.maxHeight + 1e-9)
    expect(content(shell).shownHeight).toBeCloseTo(VIEW, 9)
    shell.dispose()
  })

  it('the thumbstick scrolls while the ray is on the inspector (the square of its deflection), clamped to the content', () => {
    const { shell } = setup(mathView(TALL))
    const f = frame(shell)
    const on = rayAtLocal(f, f.width / 2, 0.3)
    const max = shell.report().mathScroll.max
    expect(shell.scrollMath(on, 1, 0.1)).toBe(true)
    expect(shell.report().mathScroll.scroll).toBeCloseTo(SPATIAL_LAYOUT.mathScroll.speed * 0.1, 3)
    shell.scrollMath(on, 0.5, 0.1)
    expect(shell.report().mathScroll.scroll).toBeCloseTo(SPATIAL_LAYOUT.mathScroll.speed * (0.1 + 0.025), 3)
    for (let i = 0; i < 200; i++) shell.scrollMath(on, 1, 0.1)
    expect(shell.report().mathScroll.scroll).toBeCloseTo(max, 4)
    expect(content(shell).viewTop).toBeCloseTo(max, 4)
    shell.scrollMath(on, -1, 0.1)
    expect(shell.report().mathScroll.scroll).toBeCloseTo(max - SPATIAL_LAYOUT.mathScroll.speed * 0.1, 3)
    for (let i = 0; i < 200; i++) shell.scrollMath(on, -1, 0.1)
    expect(shell.report().mathScroll.scroll).toBe(0)
    // a long frame gap moves no more than a tenth of a second would
    shell.scrollMath(on, 1, 5)
    expect(shell.report().mathScroll.scroll).toBeCloseTo(SPATIAL_LAYOUT.mathScroll.speed * 0.1, 3)
    // pointing away: the stick is not the inspector's
    const away = new Ray(new Vector3(0, 1.6, 0), new Vector3(0, 0, 1))
    const before = shell.report().mathScroll.scroll
    expect(shell.scrollMath(away, 1, 0.1)).toBe(false)
    expect(shell.report().mathScroll.scroll).toBe(before)
    shell.dispose()
  })

  it('new detail, the other inspector and a hidden shell start again at the top; no scroll while hidden', () => {
    const { shell } = setup(mathView(TALL))
    const f = frame(shell)
    const on = rayAtLocal(f, f.width / 2, 0.3)
    shell.scrollMath(on, 1, 0.1)
    expect(shell.report().mathScroll.scroll).toBeGreaterThan(0)
    shell.render({ ...mathView(TALL), inspector: 'assistant' })
    expect(shell.report().mathScroll.thumb).toBe(false)
    expect(content(shell).shown).toBe(false)
    shell.render(mathView(TALL))
    expect(shell.report().mathScroll.scroll).toBe(0)
    shell.scrollMath(on, 1, 0.1)
    shell.render(mathView([{ ...TALL[0]!, title: 'Another claim' }]))
    expect(shell.report().mathScroll.scroll).toBe(0)
    shell.setVisible(false)
    expect(shell.scrollMath(on, 1, 0.1)).toBe(false)
    shell.dispose()
  })
})

describe('a canvas panel view (the texture window)', () => {
  function tall() {
    const p = new CanvasPanel('test:tall')
    p.begin(0.4, 2.0)
    p.hits.push({ id: 'low', x: 0.1, y: 1.5, w: 0.2, h: 0.05, r: 0.01, enabled: true, command: null })
    p.end()
    p.setShown(true)
    return p
  }

  it('shows the band, clamped to the drawing, with the texture window to match', () => {
    const p = tall()
    p.setView(1.2, 0.6)
    expect(p.shownHeight).toBe(0.6)
    expect(p.viewTop).toBeCloseTo(1.2, 9)
    expect(p.mesh.scale.y).toBeCloseTo(0.6, 9)
    p.setView(5, 0.6)
    expect(p.viewTop).toBeCloseTo(1.4, 9)
    p.setView(0.3, null)
    expect([p.viewTop, p.shownHeight]).toEqual([0, 2.0])
  })

  it('picks and the hover highlight follow the view, in drawing coordinates', () => {
    const p = tall()
    const out = { x: 0, y: 0, distance: 0 }
    // unscrolled: the region at drawing y 1.5 is beyond a 0.6 m view
    p.setView(0, 0.6)
    expect(p.intersect(rayAtLocal(p, 0.2, 1.525), out)).toBe(false)
    const hl = new HoverOverlay()
    hl.show(p, p.findHit('low')!)
    expect(hl.mesh.visible).toBe(false)
    // scrolled to 1.2: the region shows at y 0.3 of the view, picks and highlights there
    p.setView(1.2, 0.6)
    expect(p.intersect(rayAtLocal(p, 0.2, 0.325), out)).toBe(true)
    expect(out.y).toBeCloseTo(1.525, 6)
    expect(p.hit(out.x, out.y)?.id).toBe('low')
    hl.show(p, p.findHit('low')!)
    expect(hl.mesh.visible).toBe(true)
    expect(hl.mesh.position.y).toBeCloseTo(-0.325, 6)
  })
})
