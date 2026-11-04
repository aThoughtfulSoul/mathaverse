// The desktop orb mounts into the assistant panel's header slot ([data-assistant="orb-slot"]) when it exists,
// mounts nothing (and never throws) when it does not, follows a re-rendered slot, runs requestAnimationFrame only
// while shown and in the document, sizes its canvas for devicePixelRatio, draws all 120 glyphs, and disposes.
// It moves between the header slot and the stage ([data-assistant="orb-stage"]) with the shared placement core: a
// flight (a transform from where it was drawn onto its target, then none) or, under reduced motion, a swap; it
// follows the stage's box from its own frames and the panel's renders while on it, gliding from where it was drawn
// when the box moved or resized (never a jump; scrolling carries it, a box the panel eases is followed as it is),
// flies home when the box has no room for it, marks the stage while flying home (data-leaving); and it draws one
// frame at once whenever its loop starts. A small FAKE DOM and canvas (no DOM library in node), with layout boxes
// set by hand.

import { describe, expect, it } from 'vitest'
import { DESKTOP_ORB_CSS_PX, DESKTOP_ORB_STAGE_PX, DesktopOrb, ORB_FLIGHT_MS, ORB_GLIDE_MS, ORB_SLOT_SELECTOR, ORB_STAGE_SELECTOR, type OrbWindow } from '../../../src/ui/orb/desktop'
import { ORB_LOOKS } from '../../../src/ui/orb/motion'
import { STAGE_LINGER_MS } from '../../../src/ui/orb/placement'
import type { OrbSource } from '../../../src/ui/orb/source'
import type { OrbPhase } from '../../../src/ui/orb/state'

type Rgb = [number, number, number]

class El {
  children: El[] = []
  parentNode: El | null = null
  attrs: Record<string, string> = {}
  hidden = false
  className = ''
  style: Record<string, string> = {}
  width = 300
  height = 150
  root = false
  calls: Record<string, number> = {}
  /** Layout box (viewport CSS px); null: no box. A canvas's box is centred on its parent's, at its CSS size. */
  rect: { left: number; top: number; width: number; height: number } | null = null
  /** The canvas bitmap: the tint of the last frame drawn (the first stop of its core gradient). */
  bitmap: Rgb | null = null
  /** A scrolling element's offset (the stage's scrolling ancestor); undefined: it does not scroll. */
  scrollTop?: number
  constructor(readonly tagName: string) {}
  setAttribute(k: string, v: string) {
    this.attrs[k] = v
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null
  }
  hasAttribute(k: string) {
    return k in this.attrs
  }
  removeAttribute(k: string) {
    delete this.attrs[k]
  }
  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    if (this.tagName === 'canvas') {
      const p: { left: number; top: number; width: number; height: number } | undefined = this.parentNode?.getBoundingClientRect()
      const s = parseFloat(this.style.width ?? '0')
      if (!p || !(p.width > 0)) return { left: 0, top: 0, width: 0, height: 0 }
      return { left: p.left + p.width / 2 - s / 2, top: p.top + p.height / 2 - s / 2, width: s, height: s }
    }
    return this.rect ?? { left: 0, top: 0, width: 0, height: 0 }
  }
  appendChild(c: El) {
    c.remove()
    c.parentNode = this
    this.children.push(c)
    return c
  }
  remove() {
    if (!this.parentNode) return
    this.parentNode.children = this.parentNode.children.filter((x) => x !== this)
    this.parentNode = null
  }
  get isConnected(): boolean {
    let n: El | null = this
    while (n) {
      if (n.root) return true
      n = n.parentNode
    }
    return false
  }
  querySelector(sel: string): El | null {
    const want = sel === ORB_SLOT_SELECTOR ? 'orb-slot' : sel === ORB_STAGE_SELECTOR ? 'orb-stage' : null
    if (!want) throw new Error(`unexpected selector ${sel}`)
    for (const c of this.children) {
      if (c.attrs['data-assistant'] === want) return c
      const d = c.querySelector(sel)
      if (d) return d
    }
    return null
  }
  getContext() {
    const calls = this.calls
    const el = this
    return new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'createRadialGradient') {
          return () => ({
            addColorStop(off: number, color: string) {
              const m = off === 0 ? /rgba\((\d+),(\d+),(\d+)/.exec(color) : null
              if (m) el.bitmap = [Number(m[1]), Number(m[2]), Number(m[3])]
            },
          })
        }
        return (..._a: unknown[]) => {
          calls[prop] = (calls[prop] ?? 0) + 1
        }
      },
      set() {
        return true
      },
    })
  }
}

const doc = { createElement: (tag: string) => new El(tag) } as unknown as Pick<Document, 'createElement'>

function fakeWin(dpr = 1, reduced = false) {
  let next = 1
  let now = 0
  const cbs = new Map<number, (t: number) => void>()
  const queries: string[] = []
  const win: OrbWindow & { tick(t: number): void; pending: number; queries: string[]; at(t: number): void } = {
    requestAnimationFrame: (cb) => {
      cbs.set(next, cb)
      return next++
    },
    cancelAnimationFrame: (id) => void cbs.delete(id),
    devicePixelRatio: dpr,
    matchMedia: (q) => {
      queries.push(q)
      return { matches: reduced }
    },
    performance: { now: () => now },
    /** Set the render clock (performance.now) without running a frame. */
    at(t) {
      now = t
    },
    tick(t) {
      now = t
      const run = [...cbs.values()]
      cbs.clear()
      for (const cb of run) cb(t)
    },
    get pending() {
      return cbs.size
    },
    queries,
  }
  return win
}

function source(phase: OrbPhase = 'idle', level = 0): OrbSource & { set(p: OrbPhase): void } {
  return { phase: () => phase, level: () => level, set: (p) => void (phase = p) }
}

/** A source that also says whether the orb belongs on the stage (as createOrbSource does). */
function stagedSource(phase: OrbPhase = 'idle', staged = false) {
  return {
    phase: () => phase,
    level: () => 0,
    stage: () => staged,
    set(p: OrbPhase, s: boolean) {
      phase = p
      staged = s
    },
  }
}

/** A source that also gives the bloom identity (as createOrbSource does). */
function keyedSource(phase: OrbPhase = 'idle', bloom: string | null = null) {
  const s = {
    phase: () => phase,
    level: () => 0,
    bloom: () => bloom,
    set(p: OrbPhase, b: string | null = bloom) {
      phase = p
      bloom = b
    },
  }
  return s
}

/** The assistant content root inside the shell's slot, with (or without) the header slot. */
function panel(withSlot: boolean) {
  const shellSlot = new El('div')
  shellSlot.root = true
  const content = shellSlot.appendChild(new El('div'))
  const header = content.appendChild(new El('div'))
  const slot = withSlot ? header.appendChild(new El('span')) : null
  slot?.setAttribute('data-assistant', 'orb-slot')
  return { shellSlot, content, header, slot }
}

/**
 * The panel card as the shell lays it out at 1600 x 1000: the header slot (40 x 40 at 1213, 46) before the title,
 * and the content's stage in the voice area (338 wide; its height the room it is given when open, 0 closed).
 */
function card(room = 153.5) {
  const cardEl = new El('section')
  cardEl.root = true
  const head = cardEl.appendChild(new El('header'))
  const slot = head.appendChild(new El('span'))
  slot.setAttribute('data-assistant', 'orb-slot')
  slot.rect = { left: 1213, top: 46, width: 40, height: 40 }
  const title = head.appendChild(new El('h2'))
  const body = cardEl.appendChild(new El('div'))
  body.scrollTop = 0
  const stage = body.appendChild(new El('div'))
  stage.setAttribute('data-assistant', 'orb-stage')
  let top = 207.4
  let h = room
  let w = 338
  Object.defineProperty(stage, 'rect', {
    get: () => ({ left: 1213, top: top - body.scrollTop!, width: w, height: stage.hasAttribute('data-open') ? h : 0 }),
    set: () => {},
  })
  return {
    card: cardEl as unknown as ParentNode, head, slot, title, stage, body,
    /** The learner scrolled the panel's body: the stage moves with the content. */
    scroll(y: number) {
      body.scrollTop = y
    },
    /** The panel changed under the stage (it moved, or its room changed). */
    layout(t: number, room2 = h) {
      top = t
      h = room2
    },
    /** The stage's box changed with no panel render (a window resize relaid the panel out). */
    resize(width: number, height: number) {
      w = width
      h = height
    },
    centre: () => ({ x: 1213 + 169, y: top - body.scrollTop! + h / 2 }),
  }
}

/** The canvas's drawn square: its layout box transformed by its translate/scale (centre and side). */
function drawn(c: El) {
  const b = c.getBoundingClientRect()
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(c.style.transform ?? '')
  const [dx, dy, k] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 1]
  return { x: b.left + b.width / 2 + dx, y: b.top + b.height / 2 + dy, s: b.width * k }
}

describe('desktop orb mounting', () => {
  it('mounts nothing and never throws without the slot, then mounts once the slot appears', () => {
    const win = fakeWin()
    const orb = new DesktopOrb(source(), doc, win)
    const p = panel(false)
    expect(() => orb.update(p.shellSlot as unknown as ParentNode, true)).not.toThrow()
    expect((orb.canvas as unknown as El).parentNode).toBeNull()
    expect(orb.active).toBe(false)
    expect(orb.canvas.hidden).toBe(true)
    expect(() => orb.update(null, true)).not.toThrow()
    // The next panel render has the slot.
    const slot = p.header.appendChild(new El('span'))
    slot.setAttribute('data-assistant', 'orb-slot')
    orb.update(p.shellSlot as unknown as ParentNode, true)
    expect((orb.canvas as unknown as El).parentNode).toBe(slot)
    expect(orb.canvas.hidden).toBe(false)
    expect(orb.active).toBe(true)
    orb.dispose()
  })

  it('is decorative and 40 CSS px, with devicePixelRatio-aware canvas pixels', () => {
    for (const [dpr, px] of [[1, 40], [2, 80], [1.5, 60]] as const) {
      const orb = new DesktopOrb(source(), doc, fakeWin(dpr))
      expect(orb.canvas.getAttribute('aria-hidden')).toBe('true')
      expect((orb.canvas as unknown as El).style.width).toBe(`${DESKTOP_ORB_CSS_PX}px`)
      expect((orb.canvas as unknown as El).style.height).toBe(`${DESKTOP_ORB_CSS_PX}px`)
      expect([orb.canvas.width, orb.canvas.height]).toEqual([px, px])
    }
  })

  it('draws every glyph each frame while shown, and reports the phase it shows', () => {
    const win = fakeWin(2)
    const src = source('idle')
    const orb = new DesktopOrb(src, doc, win)
    const p = panel(true)
    orb.update(p.shellSlot as unknown as ParentNode, true)
    win.tick(16)
    win.tick(32)
    const c = orb.canvas as unknown as El
    expect(orb.frames).toBe(3) // the first is drawn at once when the loop starts
    expect(c.calls.fillText).toBe(360)
    expect(c.getAttribute('data-orb')).toBe('idle')
    src.set('thinking')
    win.tick(48)
    expect(c.getAttribute('data-orb')).toBe('thinking')
    expect(win.queries).toContain('(prefers-reduced-motion: reduce)')
    orb.dispose()
  })

  it('stops animating when the panel closes (or in the clean stage) and resumes when it opens', () => {
    const win = fakeWin()
    const orb = new DesktopOrb(source(), doc, win)
    const p = panel(true)
    orb.update(p.shellSlot as unknown as ParentNode, true)
    win.tick(16)
    orb.update(p.shellSlot as unknown as ParentNode, false)
    expect(orb.canvas.hidden).toBe(true)
    expect(orb.active).toBe(false)
    expect(win.pending).toBe(0)
    win.tick(32)
    expect(orb.frames).toBe(2)
    orb.update(p.shellSlot as unknown as ParentNode, true)
    expect(orb.frames).toBe(3)
    win.tick(48)
    expect(orb.frames).toBe(4)
    orb.dispose()
  })

  it('follows a re-rendered header slot, and pauses while detached', () => {
    const win = fakeWin()
    const orb = new DesktopOrb(source(), doc, win)
    const p = panel(true)
    orb.update(p.shellSlot as unknown as ParentNode, true)
    win.tick(16)
    // The panel rebuilt its header: the old slot (with the canvas) left the document.
    p.header.remove()
    win.tick(32)
    expect(orb.active).toBe(false)
    expect(orb.frames).toBe(2)
    const header = p.content.appendChild(new El('div'))
    const slot = header.appendChild(new El('span'))
    slot.setAttribute('data-assistant', 'orb-slot')
    orb.update(p.shellSlot as unknown as ParentNode, true)
    expect((orb.canvas as unknown as El).parentNode).toBe(slot)
    win.tick(48)
    expect(orb.frames).toBe(4)
    orb.dispose()
  })

  it('never throws when the container misbehaves', () => {
    const orb = new DesktopOrb(source(), doc, fakeWin())
    const bad = { querySelector: () => { throw new Error('boom') } } as unknown as ParentNode
    expect(() => orb.update(bad, true)).not.toThrow()
    expect(orb.active).toBe(false)
  })

  it('review finding: shown again after hiding mid-thinking, it snaps to the current phase (no stale wave or tint)', () => {
    const win = fakeWin()
    const src = source('thinking')
    const orb = new DesktopOrb(src, doc, win)
    const p = panel(true)
    orb.update(p.shellSlot as unknown as ParentNode, true)
    for (let t = 16; t <= 2000; t += 16) win.tick(t)
    expect(orb.look.wave).toBeGreaterThan(0.9)
    orb.update(p.shellSlot as unknown as ParentNode, false) // the panel closed; the request ended while it was hidden
    src.set('idle')
    orb.update(p.shellSlot as unknown as ParentNode, true)
    // Snapped before the first frame is drawn, and the first frame draws the idle look.
    expect(orb.look.phase).toBe('idle')
    expect(orb.look.wave).toBe(0)
    expect((orb.canvas as unknown as El).getAttribute('data-orb')).toBe('idle')
    win.tick(5000)
    expect(orb.look.wave).toBe(0)
    expect(orb.look.tint.map((x) => Math.round(x))).toEqual([...ORB_LOOKS.idle.tint])
    expect(orb.look.radius).toBe(ORB_LOOKS.idle.radius)
    orb.dispose()
  })

  it('snaps on the first show and after a detach too, and never while the loop runs', () => {
    const win = fakeWin()
    const src = source('thinking')
    const orb = new DesktopOrb(src, doc, win)
    const p = panel(true)
    orb.update(p.shellSlot as unknown as ParentNode, true)
    expect(orb.look.wave).toBe(ORB_LOOKS.thinking.wave) // first show: the current phase's look at once
    win.tick(16)
    src.set('idle')
    orb.update(p.shellSlot as unknown as ParentNode, true) // a panel render while running: it eases, no snap
    win.tick(32)
    expect(orb.look.wave).toBeGreaterThan(0.5)
    expect(orb.look.wave).toBeLessThan(1)
    // Detached by a header rebuild, then mounted again: snap.
    p.header.remove()
    win.tick(48)
    const header = p.content.appendChild(new El('div'))
    header.appendChild(new El('span')).setAttribute('data-assistant', 'orb-slot')
    orb.update(p.shellSlot as unknown as ParentNode, true)
    expect(orb.look.wave).toBe(0)
    orb.dispose()
  })

  it('shown again during a bloom: the applied look without the overshoot; a new bloom while shown overshoots once', () => {
    const win = fakeWin()
    const src = keyedSource('thinking', null)
    const orb = new DesktopOrb(src, doc, win)
    const p = panel(true)
    orb.update(p.shellSlot as unknown as ParentNode, true)
    win.tick(16)
    orb.update(p.shellSlot as unknown as ParentNode, false)
    src.set('applied', 'r1') // the result arrived while the panel was closed
    orb.update(p.shellSlot as unknown as ParentNode, true)
    win.tick(1000)
    win.tick(1016)
    expect(orb.look.radius).toBeLessThanOrEqual(ORB_LOOKS.applied.radius + 1e-9)
    // The same bloom, entered again while shown (the identity is unchanged): still no overshoot.
    src.set('listening')
    win.tick(1032)
    src.set('applied')
    win.tick(1048)
    expect(orb.look.radius).toBeLessThanOrEqual(ORB_LOOKS.applied.radius + 1e-9)
    // A new result while shown: one overshoot.
    src.set('thinking')
    win.tick(1064)
    src.set('applied', 'r2')
    win.tick(1080)
    expect(orb.look.radius).toBeGreaterThan(ORB_LOOKS.applied.radius + 0.1)
    orb.dispose()
  })

  it('dispose removes the canvas and stops the loop for good', () => {
    const win = fakeWin()
    const orb = new DesktopOrb(source(), doc, win)
    const p = panel(true)
    orb.update(p.shellSlot as unknown as ParentNode, true)
    orb.dispose()
    expect(p.slot!.children).toHaveLength(0)
    expect(win.pending).toBe(0)
    orb.update(p.shellSlot as unknown as ParentNode, true)
    expect(orb.active).toBe(false)
    expect(p.slot!.children).toHaveLength(0)
  })
})

describe('desktop orb placement: header slot and stage', () => {
  const near = (a: { x: number; y: number; s: number }, b: { x: number; y: number; s: number }) => {
    expect(a.x).toBeCloseTo(b.x, 1)
    expect(a.y).toBeCloseTo(b.y, 1)
    expect(a.s).toBeCloseTo(b.s, 1)
  }
  const header = { x: 1233, y: 66, s: DESKTOP_ORB_CSS_PX }

  it('flies to the stage while the assistant works (growing to 150 px there) and back after the linger', () => {
    const win = fakeWin(2)
    const src = stagedSource('idle', false)
    const orb = new DesktopOrb(src, doc, win)
    const p = card()
    const c = orb.canvas as unknown as El
    win.at(1000)
    orb.update(p.card, true)
    expect([c.parentNode, orb.place, c.getAttribute('data-orb-place')]).toEqual([p.slot, 'rest', 'rest'])
    expect(p.stage.hasAttribute('data-open')).toBe(false)
    win.tick(1016)
    // A recording starts; the panel render that comes with it calls update().
    src.set('listening', true)
    win.at(1020)
    orb.update(p.card, true)
    expect([orb.place, c.getAttribute('data-orb-place')]).toEqual(['stage', 'stage'])
    expect(p.stage.hasAttribute('data-open')).toBe(true) // the stage opens at once
    expect(c.parentNode).toBe(p.slot) // it flies from the header slot (outside the scrolling body)
    expect(c.style.width).toBe(`${DESKTOP_ORB_STAGE_PX}px`) // laid out at the final size, scaled down
    expect(c.style.zIndex).toBe('2')
    near(drawn(c), header) // the first painted square is where it was
    let t = 1020
    let prev = drawn(c)
    for (t = 1036; t < 1020 + ORB_FLIGHT_MS; t += 16) {
      win.tick(t)
      const d = drawn(c)
      expect(d.y).toBeGreaterThan(prev.y) // on its way down, growing (eased out: the last steps are tiny)
      expect(d.s).toBeGreaterThanOrEqual(prev.s)
      prev = d
    }
    win.tick(t)
    // Landed: in the stage, no transform, drawn at the size it is shown (devicePixelRatio 2).
    expect(c.parentNode).toBe(p.stage)
    expect([c.style.transform, c.style.zIndex]).toEqual(['', ''])
    near(drawn(c), { ...p.centre(), s: DESKTOP_ORB_STAGE_PX })
    expect([c.width, c.height]).toEqual([300, 300])
    // The exchange ends: it stays for the linger, then flies back and the stage closes.
    src.set('idle', false)
    const off = t
    for (t += 16; t < off + STAGE_LINGER_MS - 16; t += 16) win.tick(t)
    expect([orb.place, c.parentNode]).toEqual(['stage', p.stage])
    for (; orb.place === 'stage' && t < off + STAGE_LINGER_MS + 100; t += 16) win.tick(t)
    expect(orb.place).toBe('rest')
    expect(p.stage.hasAttribute('data-open')).toBe(false)
    expect(c.parentNode).toBe(p.slot)
    expect(c.style.transform).not.toBe('')
    expect(c.style.width).toBe(`${DESKTOP_ORB_STAGE_PX}px`) // keeps its pixels while it shrinks back
    const back = t
    for (; t <= back + ORB_FLIGHT_MS + 16; t += 16) win.tick(t)
    expect([c.parentNode, c.style.transform, c.style.width, c.getAttribute('data-orb-place')]).toEqual([p.slot, '', '40px', 'rest'])
    expect([c.width, c.height]).toEqual([80, 80])
    orb.dispose()
  })

  it('a stage entry seen by a frame first waits for the panel render (laid out as it will be painted), or one more frame', () => {
    const win = fakeWin()
    const src = stagedSource('idle', false)
    const orb = new DesktopOrb(src, doc, win)
    const p = card()
    orb.update(p.card, true)
    win.tick(16)
    src.set('listening', true)
    win.tick(32) // the orb's frame runs before the host's render in this frame
    expect(orb.place).toBe('rest')
    expect(p.stage.hasAttribute('data-open')).toBe(false)
    win.at(33)
    orb.update(p.card, true) // the host's render
    expect(orb.place).toBe('stage')
    orb.dispose()
    // No render follows: the next frame applies it.
    const orb2 = new DesktopOrb(src, doc, win)
    const q = card()
    src.set('idle', false)
    orb2.update(q.card, true)
    src.set('listening', true)
    win.tick(48)
    expect(orb2.place).toBe('rest')
    win.tick(64)
    expect(orb2.place).toBe('stage')
    orb2.dispose()
  })

  it('the flight follows a target that moves under it, and lands where the target is (a jump: glided to from where it is drawn)', () => {
    const win = fakeWin()
    const src = stagedSource('thinking', false)
    const orb = new DesktopOrb(src, doc, win)
    const p = card()
    const c = orb.canvas as unknown as El
    orb.update(p.card, true)
    src.set('thinking', true)
    win.at(100)
    orb.update(p.card, true)
    win.tick(200)
    const before = drawn(c)
    p.layout(320) // the panel re-rendered: the stage is 112 px lower now
    win.at(201)
    orb.update(p.card, true)
    const after = drawn(c)
    expect(after.y).toBeCloseTo(before.y, 1) // no jump in this frame (and none back to the old path)
    let prev = after
    let t = 216
    for (; t <= 201 + ORB_GLIDE_MS + 16; t += 16) {
      win.tick(t)
      const d = drawn(c)
      expect(d.y).toBeGreaterThanOrEqual(prev.y - 1e-6) // on to the new place
      expect(d.y - prev.y).toBeLessThan(20)
      prev = d
    }
    expect(c.parentNode).toBe(p.stage)
    near(drawn(c), { ...p.centre(), s: DESKTOP_ORB_STAGE_PX })
    orb.dispose()
  })

  it('prefers-reduced-motion: no flight, an instant swap both ways', () => {
    const win = fakeWin(1, true)
    const src = stagedSource('idle', false)
    const orb = new DesktopOrb(src, doc, win)
    const p = card()
    const c = orb.canvas as unknown as El
    const transforms = new Set<string>()
    orb.update(p.card, true)
    src.set('listening', true)
    win.at(10)
    orb.update(p.card, true)
    transforms.add(c.style.transform ?? '')
    expect([c.parentNode, orb.place, c.style.width]).toEqual([p.stage, 'stage', '150px'])
    src.set('idle', false)
    for (let t = 16; t <= 16 + STAGE_LINGER_MS + 32; t += 16) {
      win.tick(t)
      transforms.add(c.style.transform ?? '')
    }
    expect([c.parentNode, orb.place, c.style.width]).toEqual([p.slot, 'rest', '40px'])
    expect([...transforms]).toEqual([''])
    orb.dispose()
  })

  it('the header slot is never styled or moved by the orb (the title does not shift when the orb leaves)', () => {
    const win = fakeWin()
    const src = stagedSource('idle', false)
    const orb = new DesktopOrb(src, doc, win)
    const p = card()
    orb.update(p.card, true)
    src.set('listening', true)
    orb.update(p.card, true)
    for (let t = 16; t < 2000; t += 16) {
      if (t === 800) src.set('idle', false)
      win.tick(t)
      expect(p.slot.style).toEqual({})
      expect(p.head.children.slice(0, 2)).toEqual([p.slot, p.title])
    }
    expect(p.slot.children).toEqual([orb.canvas])
    orb.dispose()
  })

  it('shown again: the place snaps (on the stage at once while it is wanted; back at rest with no linger once it is not)', () => {
    const win = fakeWin()
    const src = stagedSource('thinking', true)
    const orb = new DesktopOrb(src, doc, win)
    const p = card()
    const c = orb.canvas as unknown as El
    win.at(5)
    orb.update(p.card, true) // first shown mid-request
    expect([c.parentNode, orb.place, c.style.transform ?? '']).toEqual([p.stage, 'stage', ''])
    win.tick(16)
    orb.update(p.card, false) // the panel closes: no loop, the stage closed, no phase or place
    expect(p.stage.hasAttribute('data-open')).toBe(false)
    expect([c.getAttribute('data-orb'), c.getAttribute('data-orb-place')]).toEqual([null, null])
    src.set('idle', false) // the request ended while it was closed
    win.at(300)
    orb.update(p.card, true)
    expect([c.parentNode, orb.place, c.style.width, c.style.transform ?? '']).toEqual([p.slot, 'rest', '40px', ''])
    expect([c.getAttribute('data-orb'), c.getAttribute('data-orb-place')]).toEqual(['idle', 'rest'])
    orb.dispose()
  })

  it('a smaller stage draws a smaller orb; a stage with no box keeps it at rest (and is closed again)', () => {
    const win = fakeWin()
    const src = stagedSource('listening', true)
    const small = card(84)
    const orb = new DesktopOrb(src, doc, win)
    orb.update(small.card, true)
    expect([orb.place, orb.canvas.style.width]).toEqual(['stage', '84px'])
    orb.dispose()
    const none = card(0)
    const orb2 = new DesktopOrb(src, doc, win)
    orb2.update(none.card, true)
    expect(orb2.place).toBe('rest')
    expect(none.stage.hasAttribute('data-open')).toBe(false)
    win.tick(16)
    win.tick(32)
    expect(none.stage.hasAttribute('data-open')).toBe(false) // not retried every frame
    orb2.dispose()
  })

  it('reopened after the phase changed: the first painted frame is already the current look (drawn at once)', () => {
    const win = fakeWin()
    const src = keyedSource('thinking', null)
    const orb = new DesktopOrb(src, doc, win)
    const p = panel(true)
    const c = orb.canvas as unknown as El
    orb.update(p.shellSlot as unknown as ParentNode, true)
    src.set('applied', 'r1')
    for (let t = 16; t <= 400; t += 16) win.tick(t)
    expect(c.bitmap![0]).toBeGreaterThan(200) // the gold bloom is on the canvas
    orb.update(p.shellSlot as unknown as ParentNode, false)
    src.set('idle')
    const frames = orb.frames
    // Reopened from inside the host's frame: this update() is all that runs before the browser paints.
    orb.update(p.shellSlot as unknown as ParentNode, true)
    expect(orb.frames).toBe(frames + 1)
    expect(c.bitmap).toEqual([...ORB_LOOKS.idle.tint])
    // The first animation frame steps from that look with dt = 0.
    const radius = orb.look.radius
    win.tick(5000)
    expect(orb.look.radius).toBe(radius)
    expect(c.bitmap).toEqual([...ORB_LOOKS.idle.tint])
    orb.dispose()
  })

  it('while hidden it draws nothing and keeps no stale phase', () => {
    const win = fakeWin()
    const src = source('applied')
    const orb = new DesktopOrb(src, doc, win)
    const p = panel(true)
    const c = orb.canvas as unknown as El
    orb.update(p.shellSlot as unknown as ParentNode, true)
    win.tick(16)
    expect(c.getAttribute('data-orb')).toBe('applied')
    orb.update(p.shellSlot as unknown as ParentNode, false)
    src.set('idle')
    const frames = orb.frames
    for (let t = 32; t < 500; t += 16) win.tick(t)
    expect(orb.frames).toBe(frames)
    expect(c.getAttribute('data-orb')).toBeNull()
    orb.update(p.shellSlot as unknown as ParentNode, true)
    expect(c.getAttribute('data-orb')).toBe('idle')
    orb.dispose()
  })

  it('review 5: on the stage, every frame follows the stage box (a resize relays the panel out with no panel render)', () => {
    const win = fakeWin()
    const src = stagedSource('thinking', true)
    const orb = new DesktopOrb(src, doc, win)
    const p = card(158)
    const c = orb.canvas as unknown as El
    win.at(5)
    orb.update(p.card, true)
    for (let t = 16; t <= 200; t += 16) win.tick(t)
    expect([orb.place, c.parentNode, c.style.width, c.width]).toEqual(['stage', p.stage, '150px', 150])
    p.resize(84, 84) // wide -> stacked: the box shrank; no update() follows
    win.tick(216)
    expect(orb.place).toBe('stage') // it glides to the smaller box (R4), still the stage's
    let t = 216
    for (t += 16; t <= 216 + ORB_GLIDE_MS + 16; t += 16) win.tick(t)
    expect([orb.place, c.parentNode, c.style.width, c.width, c.style.transform]).toEqual(['stage', p.stage, '84px', 84, ''])
    p.resize(338, 158)
    for (let k = 0; k < 30; k++) win.tick((t += 16))
    expect([c.parentNode, c.style.width]).toEqual([p.stage, '150px'])
    orb.dispose()
  })

  /** An orb settled on the stage at `t` (ms), and the square it is drawn in each frame from then on. */
  function settled(o: { reduced?: boolean; room?: number } = {}) {
    const win = fakeWin(1, !!o.reduced)
    const src = stagedSource('thinking', true)
    const orb = new DesktopOrb(src, doc, win)
    const p = card(o.room ?? 153.5)
    const c = orb.canvas as unknown as El
    win.at(5)
    orb.update(p.card, true) // shown mid-request: on the stage at once
    let t = 5
    const frames: { x: number; y: number; s: number }[] = []
    const step = (n = 1) => {
      for (let k = 0; k < n; k++) {
        win.tick((t += 16))
        frames.push(drawn(c))
      }
    }
    /** The panel renders with the stage's box changed: the shell calls update() before the frame is painted. */
    const render = (top: number, room?: number) => {
      p.layout(top, room)
      win.at(t + 1)
      orb.update(p.card, true)
      frames.push(drawn(c))
    }
    step(2)
    return { win, src, orb, p, c, frames, step, render, now: () => t }
  }
  const maxStep = (f: { x: number; y: number; s: number }[]) => Math.max(...f.slice(1).map((q, i) => Math.max(Math.abs(q.x - f[i]!.x), Math.abs(q.y - f[i]!.y), Math.abs(q.s - f[i]!.s))))

  it('R4: the stage box moves under the settled orb (a long answer replaced by "Thinking..."): it glides there, never jumps', () => {
    const s = settled()
    const at = drawn(s.c)
    expect([s.c.parentNode, s.orb.place]).toEqual([s.p.stage, 'stage'])
    s.render(207.4 - 286, 153.5 + 286) // the exchange shrank by 286 px: the stage grew upward by as much
    expect(drawn(s.c).y).toBeCloseTo(at.y, 1) // painted where it was drawn in this frame
    expect(s.c.parentNode).toBe(s.p.slot) // gliding (a short flight)
    s.step(Math.ceil(ORB_GLIDE_MS / 16) + 1)
    expect([s.c.parentNode, s.c.style.transform, s.c.style.width, s.orb.place]).toEqual([s.p.stage, '', '150px', 'stage'])
    expect(drawn(s.c).y).toBeCloseTo(s.p.centre().y, 1)
    expect(maxStep(s.frames)).toBeLessThan(0.2 * 143) // eased out over ORB_GLIDE_MS: the largest step is a fraction of the way
    s.orb.dispose()
  })

  it('R2 + R4: the box shrinks to 120 px and moves down (the question sent from the idle panel): the orb stays on the stage and glides', () => {
    const s = settled()
    s.render(207.4 + 33.5, 120)
    expect(s.orb.place).toBe('stage')
    expect(s.p.stage.hasAttribute('data-open')).toBe(true)
    s.step(Math.ceil(ORB_GLIDE_MS / 16) + 1)
    expect([s.c.parentNode, s.c.style.width, s.orb.place]).toEqual([s.p.stage, '120px', 'stage'])
    expect(maxStep(s.frames)).toBeLessThan(10)
    s.orb.dispose()
  })

  it('R4: a box that jumps again while the orb glides (or flies) to it is glided to from where the orb is drawn', () => {
    const s = settled({ room: 156 })
    s.render(207.4 - 120, 156) // a first change: it glides
    s.step(Math.floor(ORB_GLIDE_MS / 16) - 2) // nearly there
    s.render(207.4 - 120, 65) // the box shrinks to 65 px under it (a transcript in the pinned rows)
    s.step(Math.ceil(ORB_GLIDE_MS / 16) + 1)
    expect([s.c.parentNode, s.c.style.width]).toEqual([s.p.stage, '65px'])
    expect(maxStep(s.frames)).toBeLessThan(10)
    s.orb.dispose()
  })

  it('R4: under reduced motion it follows the box at once (no glide)', () => {
    const s = settled({ reduced: true })
    s.render(207.4 - 286, 153.5 + 286)
    expect([s.c.parentNode, s.c.style.transform ?? '']).toEqual([s.p.stage, ''])
    expect(drawn(s.c).y).toBeCloseTo(s.p.centre().y, 1)
    s.orb.dispose()
  })

  it('R4: a box the panel eases itself (data-easing) is followed as it is; scrolling carries the orb with the content', () => {
    const s = settled()
    s.p.stage.setAttribute('data-easing', 'on')
    for (let k = 1; k <= 20; k++) {
      s.p.layout(207.4 + 4 * k) // a few px a frame
      s.step()
      expect([s.c.parentNode, s.c.style.transform ?? '']).toEqual([s.p.stage, ''])
    }
    s.p.stage.setAttribute('data-easing', 'off')
    s.p.scroll(60) // the body scrolled: the stage moved up with its content
    s.step()
    s.render(207.4 + 80)
    expect([s.c.parentNode, s.c.style.transform ?? '']).toEqual([s.p.stage, ''])
    // A jump while the panel eases is still glided.
    s.p.stage.setAttribute('data-easing', 'on')
    s.render(207.4 - 200, 353.5)
    expect(s.c.parentNode).toBe(s.p.slot)
    s.orb.dispose()
  })

  it('R4: a box that closes at once under the settled orb sends it home from where it was drawn (no jump at the start)', () => {
    const s = settled()
    const at = drawn(s.c)
    s.render(207.4 + 400, 0) // the stage closed at once, elsewhere (an answer that made the body scroll)
    expect(s.orb.place).toBe('rest')
    expect([s.p.stage.hasAttribute('data-open'), s.p.stage.hasAttribute('data-leaving')]).toEqual([false, true])
    expect(drawn(s.c).y).toBeCloseTo(at.y, 1)
    expect(drawn(s.c).s).toBeCloseTo(at.s, 1)
    s.step(Math.ceil(ORB_FLIGHT_MS / 16) + 1)
    expect([s.c.parentNode, s.c.style.transform, s.c.style.width]).toEqual([s.p.slot, '', '40px'])
    expect(maxStep(s.frames)).toBeLessThan(60)
    s.orb.dispose()
  })

  it('a stage that loses its room sends the orb home with a flight, and it does not come back before the next panel render', () => {
    const win = fakeWin()
    const src = stagedSource('thinking', true)
    const orb = new DesktopOrb(src, doc, win)
    const p = card(158)
    const c = orb.canvas as unknown as El
    win.at(5)
    orb.update(p.card, true)
    win.tick(16)
    p.resize(338, 30) // the panel took the room back (40 px or less: too small)
    win.tick(32)
    expect(orb.place).toBe('rest')
    expect(c.parentNode).toBe(p.slot)
    expect(c.style.transform).not.toBe('') // a flight, not a jump
    expect([p.stage.hasAttribute('data-open'), p.stage.hasAttribute('data-leaving')]).toEqual([false, true])
    let t = 32
    for (t += 16; t <= 32 + ORB_FLIGHT_MS + 32; t += 16) win.tick(t)
    expect([orb.place, c.parentNode, c.style.transform, c.style.width]).toEqual(['rest', p.slot, '', '40px'])
    expect(p.stage.hasAttribute('data-leaving')).toBe(false)
    // Still wanted on the stage, and the room is back, but no panel render yet: it stays home.
    p.resize(338, 158)
    for (let k = 0; k < 5; k++) win.tick((t += 16))
    expect(orb.place).toBe('rest')
    win.at(t + 1)
    orb.update(p.card, true) // the next panel render: it tries again
    expect(orb.place).toBe('stage')
    orb.dispose()
  })

  it('the stage is marked while the orb flies home (data-leaving) until it lands; a flight turned back clears it', () => {
    const win = fakeWin()
    const src = stagedSource('idle', false)
    const orb = new DesktopOrb(src, doc, win)
    const p = card()
    win.at(5)
    orb.update(p.card, true)
    src.set('listening', true)
    win.at(10)
    orb.update(p.card, true)
    let t = 10
    for (t += 16; t <= 10 + ORB_FLIGHT_MS + 32; t += 16) win.tick(t)
    expect([p.stage.hasAttribute('data-open'), p.stage.hasAttribute('data-leaving')]).toEqual([true, false])
    src.set('idle', false)
    const off = t
    for (; orb.place === 'stage' && t < off + STAGE_LINGER_MS + 100; t += 16) win.tick(t)
    expect([p.stage.hasAttribute('data-open'), p.stage.hasAttribute('data-leaving')]).toEqual([false, true])
    const leftAt = t
    for (; t < leftAt + ORB_FLIGHT_MS / 2; t += 16) {
      win.tick(t)
      expect(p.stage.hasAttribute('data-leaving')).toBe(true) // the whole way home
    }
    src.set('listening', true) // pressed again on its way home: it turns back
    win.at(t)
    orb.update(p.card, true)
    expect([orb.place, p.stage.hasAttribute('data-open'), p.stage.hasAttribute('data-leaving')]).toEqual(['stage', true, false])
    src.set('idle', false)
    const off2 = t
    for (; t < off2 + STAGE_LINGER_MS + ORB_FLIGHT_MS + 200; t += 16) win.tick(t)
    expect([orb.place, (orb.canvas as unknown as El).style.transform, p.stage.hasAttribute('data-open'), p.stage.hasAttribute('data-leaving')]).toEqual(['rest', '', false, false])
    // Under reduced motion there is no flight home, so the stage is never marked as left.
    const win2 = fakeWin(1, true)
    const src2 = stagedSource('listening', true)
    const orb2 = new DesktopOrb(src2, doc, win2)
    const q = card()
    orb2.update(q.card, true)
    src2.set('idle', false)
    for (let k = 16; k <= STAGE_LINGER_MS + 64; k += 16) {
      win2.tick(k)
      expect(q.stage.hasAttribute('data-leaving')).toBe(false)
    }
    expect(orb2.place).toBe('rest')
    orb.dispose()
    orb2.dispose()
  })

  it('never throws when the stage misbehaves', () => {
    const win = fakeWin()
    const src = stagedSource('listening', true)
    const p = card()
    p.stage.getBoundingClientRect = () => {
      throw new Error('boom')
    }
    const orb = new DesktopOrb(src, doc, win)
    expect(() => orb.update(p.card, true)).not.toThrow()
    expect(() => win.tick(16)).not.toThrow()
    orb.dispose()
  })
})
