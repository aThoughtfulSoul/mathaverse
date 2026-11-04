// Desktop presence of Ask Meta Muse AI: a canvas-2D math glyph orb, devicePixelRatio aware and drawn at the size
// it is shown. At rest it is small (40 x 40 CSS px) in the assistant panel's header slot
// ([data-assistant="orb-slot"]). While the assistant is working with the learner's words (placement.ts: the
// microphone request, the recording, the transcription, a transcript waiting to be sent, the pending request and
// the applied bloom, then STAGE_LINGER_MS) it flies to the stage in the panel's voice area
// ([data-assistant="orb-stage"]; both slots come from src/ui/assistant/dom.ts), grows to the stage's size (at most
// 150 px), and flies back afterwards. The panel content decides the stage's box (the room it gives it); the orb only
// marks it: data-open while it is on the stage or flying to it, data-leaving while it flies home from it (removed
// when it lands). A stage box of 40 px or less is refused (the orb stays in, or flies back to, the header and does
// not try again before the next panel render). While it sits on the stage, every frame and every panel render
// follow the stage's box (one rect read: a window resize relays the panel out with no panel render), and it never
// jumps: a box that moved or resized under it is glided to from where the orb was drawn (ORB_GLIDE_MS, eased in and
// out), scrolling carries it with the content, and a box the panel eases itself (data-easing) is followed as it is.
//
// The flight (ORB_FLIGHT_MS, eased out) is a FLIP driven by this orb's own frames: the canvas takes the larger of
// its two sizes, waits in the header slot (outside the panel's scrolling body, so nothing clips it) and is
// transformed from the square it was drawn in to its target's square as measured that frame (a panel that changes
// under it never makes it jump: a target that jumps is glided to from where the orb is drawn); it lands in its slot
// with no transform. Leaving the stage starts at once; entering
// is applied by update(), which the shell calls right after the panel render that comes with the state change (the
// panel is then laid out as it will be painted), or by the next frame. prefers-reduced-motion: no flight (an
// instant swap), slower, no voice ripple, no bloom overshoot.
//
// The desktop shell calls update() after every panel render: the orb (re)mounts when the header slot exists (and
// mounts nothing otherwise), and runs on requestAnimationFrame only while it is shown (assistant panel open, not
// ?clean=1) and in the document. It is decorative (aria-hidden): the panel's own text and source labels say what is
// happening. Each time the loop starts (first shown, shown again after the panel closed, mounted again after a
// detach) the look and the place snap to the current state and one frame is drawn at once, so the first frame
// painted is never an old bitmap. While hidden it draws nothing and carries no phase or place (data-orb,
// data-orb-place are removed).

import { ORB_GLYPHS, ORB_GLYPH_FONT, glyphLayout, type OrbGlyph } from './glyphs'
import { ORB_TILT, OrbMotion, type OrbLookState } from './motion'
import { OrbPlacement, type OrbPlace } from './placement'
import type { OrbSource } from './source'

export const ORB_SLOT_SELECTOR = '[data-assistant="orb-slot"]'
export const ORB_STAGE_SELECTOR = '[data-assistant="orb-stage"]'
export const DESKTOP_ORB_CSS_PX = 40
/** The orb's size on the stage (CSS px) when the stage box has room for it; a smaller box draws it smaller. */
export const DESKTOP_ORB_STAGE_PX = 150
/** The flight between the header and the stage (ms, eased out). */
export const ORB_FLIGHT_MS = 450
/** The glide of an orb on the stage to its box when the box moved or resized under it (ms, eased in and out). */
export const ORB_GLIDE_MS = 400
/**
 * The change of the stage box (centre or side, CSS px) the settled orb glides over: any, or, while the panel eases
 * the box itself (data-easing: a few px a frame), only a jump.
 */
const GLIDE_PX = 0.5
const EASING_GLIDE_PX = 12
/**
 * Glyph font size as a fraction of the canvas size: the mock-up's panel orb, slightly larger at 40 px, a little
 * smaller relative to the sphere at the stage's 150 px (linear in between).
 */
const FONT_RATIO = 0.095
const STAGE_FONT_RATIO = 0.08

/** The window features the orb uses (a test seam). */
export interface OrbWindow {
  requestAnimationFrame(cb: (t: number) => void): number
  cancelAnimationFrame(id: number): void
  devicePixelRatio?: number
  matchMedia?(query: string): { matches: boolean }
  /** The clock of panel renders (frames use their own timestamps, on the same time origin). */
  performance?: { now(): number }
}

/** A square on screen: its centre (viewport CSS px) and side. */
interface Square {
  x: number
  y: number
  s: number
}

/**
 * A flight to `to`: from the square the canvas was drawn in, started at t0, lasting ms with its easing, with the canvas
 * laid out at px; `last` is the target as measured the frame before.
 */
interface Flight {
  to: OrbPlace
  from: Square
  t0: number
  ms: number
  ease: (k: number) => number
  px: number
  last: Square | null
}

const easeOut = (k: number) => 1 - (1 - k) ** 3
/** Ease in and out (a glide starts and ends gently: its steepest step is 1.5 times the average). */
const easeInOut = (k: number) => k * k * (3 - 2 * k)

/** The scroll offsets of an element's scrolling ancestors (a scroll carries the stage with its content). */
function scrollOffset(el: Element): { x: number; y: number } {
  let x = 0
  let y = 0
  for (let n = el.parentNode as (ParentNode & { scrollTop?: number; scrollLeft?: number }) | null; n; n = n.parentNode as typeof n) {
    if (typeof n.scrollTop === 'number') y += n.scrollTop
    if (typeof n.scrollLeft === 'number') x += n.scrollLeft
  }
  return { x, y }
}

/** Per-frame scratch of the 2D renderer (allocated once). */
export interface Orb2dScratch {
  sx: Float32Array
  sy: Float32Array
  z: Float32Array
  persp: Float32Array
  wave: Float32Array
  order: number[]
  cmp: (a: number, b: number) => number
  colors: string[]
  colorKey: number
}

export function orb2dScratch(n: number): Orb2dScratch {
  const z = new Float32Array(n)
  return {
    sx: new Float32Array(n), sy: new Float32Array(n), z, persp: new Float32Array(n), wave: new Float32Array(n),
    order: Array.from({ length: n }, (_, i) => i),
    cmp: (a, b) => z[a]! - z[b]!,
    colors: new Array<string>(256).fill(''),
    colorKey: -1,
  }
}

/**
 * Draw one frame of the orb (the mock-up's projection): the core glow, then the glyphs back to front, brighter
 * and larger toward the viewer. Returns the number of glyphs drawn.
 */
export function drawOrb2d(c: CanvasRenderingContext2D, m: OrbMotion, pts: readonly OrbGlyph[], W: number, H: number, fontPx: number, s: Orb2dScratch): number {
  const cx = W / 2
  const cy = H / 2
  const R = Math.min(W, H) * 0.33 * m.radius
  c.clearRect(0, 0, W, H)
  const tr = Math.round(m.tint[0])
  const tg = Math.round(m.tint[1])
  const tb = Math.round(m.tint[2])
  const coreA = Math.min(1, m.core + m.level * 0.45)
  c.globalAlpha = 1
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25)
  g.addColorStop(0, `rgba(${tr},${tg},${tb},${coreA})`)
  g.addColorStop(0.55, `rgba(${tr},${tg},${tb},${coreA * 0.25})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  c.fillStyle = g
  c.beginPath()
  c.arc(cx, cy, R * 1.25, 0, Math.PI * 2)
  c.fill()

  const t = m.time
  const ct = Math.cos(ORB_TILT)
  const st = Math.sin(ORB_TILT)
  const twistT = Math.sin(t * 2)
  const n = Math.min(pts.length, s.z.length)
  for (let i = 0; i < n; i++) {
    const p = pts[i]!
    const ripple = 1 + m.level * 0.2 * m.ripple * (0.5 + 0.5 * Math.sin(p.phase + t * 9))
    const a = m.angle + m.swirl * p.lat * 2.4 * twistT
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    const x = p.x * ca + p.z * sa
    const z = -p.x * sa + p.z * ca
    const y2 = p.y * ct - z * st
    const z2 = p.y * st + z * ct
    const persp = 2.8 / (2.8 - z2 * 0.9)
    s.sx[i] = cx + x * R * ripple * persp
    s.sy[i] = cy + y2 * R * ripple * persp
    s.z[i] = z2
    s.persp[i] = persp
    s.wave[i] = m.wave * (0.5 + 0.5 * Math.sin(p.lat * 6 - t * 6))
  }
  s.order.sort(s.cmp)

  const key = (tr << 16) | (tg << 8) | tb
  if (key !== s.colorKey) {
    s.colorKey = key
    s.colors.fill('')
  }
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  let font = -1
  let drawn = 0
  for (let k = 0; k < s.order.length; k++) {
    const i = s.order[k]!
    if (i >= n) continue
    const depth = (s.z[i]! + 1) / 2
    const w = s.wave[i]!
    const alpha = Math.min(1, (0.18 + 0.82 * depth) * (m.bright + w * 0.35))
    if (alpha <= 0.01) continue
    const size = Math.round(fontPx * s.persp[i]! * (0.75 + 0.35 * depth) * 4) / 4
    if (size !== font) {
      font = size
      c.font = `${size}px ${ORB_GLYPH_FONT}`
    }
    const lift = Math.max(0, Math.min(255, Math.round(70 * depth + 80 * w)))
    let col = s.colors[lift]!
    if (!col) col = s.colors[lift] = `rgb(${Math.min(255, tr + lift)},${Math.min(255, tg + lift)},${Math.min(255, tb + lift)})`
    c.fillStyle = col
    c.globalAlpha = alpha
    c.fillText(ORB_GLYPHS[pts[i]!.glyph]!, s.sx[i]!, s.sy[i]!)
    drawn++
  }
  c.globalAlpha = 1
  return drawn
}

export class DesktopOrb {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D | null
  private readonly motion = new OrbMotion()
  private readonly placement = new OrbPlacement()
  private readonly pts = glyphLayout()
  private readonly scratch = orb2dScratch(this.pts.length)
  private readonly reduced: { matches: boolean } | null
  private raf: number | null = null
  private last = -1
  private running = false
  private disposed = false
  /** The header slot and the stage found by the last update(). */
  private slot: Element | null = null
  private stage: HTMLElement | null = null
  /** Where the canvas is, or is flying to. */
  private shown: OrbPlace = 'rest'
  /** The canvas's CSS size (px); its pixels follow it times devicePixelRatio. */
  private cssPx = DESKTOP_ORB_CSS_PX
  private flight: Flight | null = null
  /** The square the flight drew the canvas in last (where a reversed flight starts). */
  private vis: Square | null = null
  /** Where the canvas sat on the stage at the last look, and its scrolling ancestors' offsets then (null: not there). */
  private seen: { sq: Square; x: number; y: number } | null = null
  /** A stage entry seen by a frame, waiting for the panel render that normally comes with it (or one frame). */
  private entryWaits = false
  /** The stage could not be opened (not laid out); not tried again before the next panel render. */
  private stageRefused = false
  /** The last frame's timestamp (the clock when the window has no performance.now). */
  private clock = 0
  /** Frames drawn (verification). */
  frames = 0

  constructor(private readonly source: OrbSource, doc: Pick<Document, 'createElement'>, private readonly win: OrbWindow) {
    this.canvas = doc.createElement('canvas')
    this.canvas.className = 'mwa-orb'
    this.canvas.setAttribute('aria-hidden', 'true')
    const st = this.canvas.style as CSSStyleDeclaration | undefined
    if (st) {
      st.width = `${DESKTOP_ORB_CSS_PX}px`
      st.height = `${DESKTOP_ORB_CSS_PX}px`
      st.display = 'block'
      st.flex = 'none'
      st.pointerEvents = 'none'
      // Positioned, so a flying orb can be lifted above the panel's sticky input controls (setFlying).
      st.position = 'relative'
    }
    this.canvas.hidden = true
    let ctx: CanvasRenderingContext2D | null = null
    try {
      ctx = this.canvas.getContext('2d')
    } catch {
      ctx = null
    }
    this.ctx = ctx
    let mq: { matches: boolean } | null = null
    try {
      mq = win.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
    } catch {
      mq = null
    }
    this.reduced = mq
    this.resize()
  }

  /**
   * After each panel render: mount into the header slot inside `container` if it is there (nothing is mounted
   * otherwise; the next render retries), find the stage, and animate only while `shown`. A stage entry is applied
   * here, with the panel laid out as it will be painted. Never throws.
   */
  update(container: ParentNode | null, shown: boolean): void {
    if (this.disposed) return
    try {
      const slot = container?.querySelector(ORB_SLOT_SELECTOR) ?? null
      const stage = (container?.querySelector(ORB_STAGE_SELECTOR) as HTMLElement | null) ?? null
      if (stage !== this.stage) this.closeStage()
      this.slot = slot
      this.stage = stage
      this.stageRefused = false
      const parent = this.canvas.parentNode
      if (slot && parent !== slot && (!stage || parent !== stage)) slot.appendChild(this.canvas)
      const on = shown && !!slot
      this.canvas.hidden = !on
      if (!on) return this.hide()
      if (this.raf === null) return this.start()
      const now = this.now()
      // The header was rebuilt or the content mounted again: put the canvas back where it belongs (no flight).
      const home = this.flight || this.shown === 'rest' ? slot : stage
      if (this.canvas.parentNode !== home) this.settle(this.shown)
      else if (this.shown === 'stage' && !this.flight) this.refit(now)
      this.follow(now, true)
    } catch {
      this.stop()
    }
  }

  /** True while the animation loop is scheduled. */
  get active(): boolean {
    return this.raf !== null
  }

  /** The look the next frame draws from (verification). */
  get look(): OrbLookState {
    return this.motion
  }

  /** Where the orb is shown, or is flying to: 'rest' (header) or 'stage' (verification; data-orb-place). */
  get place(): OrbPlace {
    return this.shown
  }

  dispose(): void {
    if (this.disposed) return
    this.stop()
    this.closeStage()
    this.disposed = true
    try {
      this.canvas.remove()
    } catch {
      /* already detached */
    }
  }

  private start(): void {
    this.running = true
    if (this.raf !== null) return
    this.last = -1
    this.snap(this.now())
    // This runs inside the host's frame (the shell renders from it): draw now, so the frame painted next shows the
    // current look; the first animation frame then steps with dt = 0 (last = -1).
    try {
      this.draw(0)
    } catch {
      return this.stop()
    }
    this.raf = this.win.requestAnimationFrame(this.frame)
  }

  /** The loop (re)starts: take the current phase's look (OrbMotion.snap) and place (OrbPlacement.snap) at once. */
  private snap(now: number): void {
    try {
      const phase = this.source.phase()
      this.motion.snap(phase, this.source.bloom?.())
      if (this.canvas.getAttribute('data-orb') !== phase) this.canvas.setAttribute('data-orb', phase)
    } catch {
      // The first draw reads the source again (and stops this orb if it still fails).
    }
    this.flight = null
    this.vis = this.seen = null
    this.entryWaits = false
    this.settle(this.placement.snap(this.wantsStage(), now))
  }

  /** Hidden (panel closed, clean stage, no slot): no loop, no flight, the stage closed, no phase or place. */
  private hide(): void {
    this.stop()
    this.flight = null
    this.vis = this.seen = null
    this.entryWaits = false
    this.setFlying(null)
    this.closeStage()
    this.canvas.removeAttribute('data-orb')
    this.canvas.removeAttribute('data-orb-place')
  }

  private stop(): void {
    this.running = false
    if (this.raf !== null) this.win.cancelAnimationFrame(this.raf)
    this.raf = null
  }

  private readonly frame = (t: number): void => {
    this.raf = null
    if (this.disposed || !this.running) return
    // Detached (the panel replaced its header or content): stop until the next panel render mounts it again.
    if (this.canvas.isConnected === false) {
      this.running = false
      return
    }
    this.raf = this.win.requestAnimationFrame(this.frame)
    const dt = this.last < 0 ? 0 : (t - this.last) / 1000
    this.last = t
    this.clock = t
    try {
      this.follow(t, false)
      if (this.shown === 'stage' && !this.flight) this.refit(t)
      this.draw(dt)
    } catch {
      // A drawing failure must never break the panel: stop this orb.
      this.stop()
    }
  }

  private draw(dt: number): void {
    const phase = this.source.phase()
    if (this.canvas.getAttribute('data-orb') !== phase) this.canvas.setAttribute('data-orb', phase)
    this.motion.step(dt, phase, this.source.level(), !!this.reduced?.matches, this.source.bloom?.())
    this.resize()
    const k = Math.min(1, Math.max(0, (this.cssPx - DESKTOP_ORB_CSS_PX) / (DESKTOP_ORB_STAGE_PX - DESKTOP_ORB_CSS_PX)))
    const ratio = FONT_RATIO + (STAGE_FONT_RATIO - FONT_RATIO) * k
    if (this.ctx) drawOrb2d(this.ctx, this.motion, this.pts, this.canvas.width, this.canvas.height, this.canvas.width * ratio, this.scratch)
    this.frames++
  }

  // ------------------------------------------------------------------ placement and flight

  private wantsStage(): boolean {
    try {
      return !!this.source.stage?.()
    } catch {
      return false
    }
  }

  private now(): number {
    try {
      const t = this.win.performance?.now()
      if (typeof t === 'number' && Number.isFinite(t)) return t
    } catch {
      /* the frame clock */
    }
    return this.clock
  }

  /**
   * One placement step at `now`: leaving the stage starts at once; entering waits for the panel render that comes
   * with the state change (`render`: called from update()), or for one more frame. Then the flight advances.
   */
  private follow(now: number, render: boolean): void {
    const want = this.placement.update(this.wantsStage(), now)
    if (want === this.shown) this.entryWaits = false
    else if (want === 'rest') this.move('rest', now)
    else if (this.stage && !this.stageRefused) {
      if (render || this.entryWaits) this.move('stage', now)
      else this.entryWaits = true
    }
    if (this.flight) this.fly(now)
  }

  /** Start the flight to `to` from where the canvas is drawn now (reduced motion, or nothing measurable: settle). */
  private move(to: OrbPlace, now: number): void {
    this.entryWaits = false
    const from = this.vis ?? this.drawnOnStage() ?? this.squareOf(this.canvas)
    let px = Math.max(this.cssPx, DESKTOP_ORB_CSS_PX)
    if (to === 'stage') {
      const size = this.openStage()
      if (size === null) return
      px = Math.max(px, size)
    }
    this.shown = to
    this.canvas.setAttribute('data-orb-place', to)
    const slot = this.slot
    if (!from || !slot || this.reduced?.matches) return this.settle(to)
    // Leaving: the stage is closed, and marked as left until the orb lands in the header.
    if (to === 'rest') this.closeStage(true)
    // Fly inside the header slot, laid out at the larger size and scaled (never stretched: sharp all the way).
    this.flight = { to, from, t0: now, ms: ORB_FLIGHT_MS, ease: easeOut, px, last: null }
    this.seen = null
    this.setSize(px)
    if (this.canvas.parentNode !== slot) slot.appendChild(this.canvas)
    this.fly(now)
  }

  /** On the stage, its box moved or resized: glide (a short flight to the stage) from where the orb was drawn. */
  private glide(from: Square, size: number, now: number, slot: Element): void {
    const px = Math.max(from.s, size)
    this.flight = { to: 'stage', from, t0: now, ms: ORB_GLIDE_MS, ease: easeInOut, px, last: null }
    this.seen = null
    this.setSize(px)
    if (this.canvas.parentNode !== slot) slot.appendChild(this.canvas)
    this.fly(now)
  }

  /** Advance the flight: transform the canvas onto the square between its start and its target now; land at the end. */
  private fly(now: number): void {
    const f = this.flight
    if (!f) return
    const to = this.target(f.to)
    // The target jumped under it (the panel changed): it goes on from where it is drawn, gliding there.
    const l = f.last
    if (to && l && this.vis && Math.max(Math.abs(to.x - l.x), Math.abs(to.y - l.y), Math.abs(to.s - l.s)) > EASING_GLIDE_PX) {
      Object.assign(f, { from: this.vis, t0: now, ms: ORB_GLIDE_MS, ease: easeInOut, px: Math.max(f.px, to.s) })
      this.setSize(f.px)
    }
    f.last = to
    const k = Math.min(1, Math.max(0, (now - f.t0) / f.ms))
    const home = this.slot ? this.squareOf(this.slot, f.px) : null
    // The stage lost its room under a flight (or glide) to it: fly home from where the orb is drawn.
    if (!to && f.to === 'stage' && home && this.vis) {
      this.stageRefused = true
      this.move('rest', now)
      return
    }
    if (k >= 1 || !to || !home) {
      this.settle(f.to)
      return
    }
    const e = f.ease(k)
    const v: Square = { x: f.from.x + (to.x - f.from.x) * e, y: f.from.y + (to.y - f.from.y) * e, s: f.from.s + (to.s - f.from.s) * e }
    this.vis = v
    this.setFlying(`translate(${(v.x - home.x).toFixed(2)}px, ${(v.y - home.y).toFixed(2)}px) scale(${(v.s / f.px).toFixed(4)})`)
  }

  /** Put the canvas in its slot for `place` at once, at its size there, with no transform. */
  private settle(place: OrbPlace): void {
    this.flight = null
    this.vis = null
    const size = place === 'stage' ? this.openStage() : null
    if (size === null) this.closeStage()
    const parent = size === null ? this.slot : this.stage
    this.shown = size === null ? 'rest' : 'stage'
    this.setSize(size ?? DESKTOP_ORB_CSS_PX)
    this.setFlying(null)
    if (parent && this.canvas.parentNode !== parent) parent.appendChild(this.canvas)
    if (this.canvas.getAttribute('data-orb-place') !== this.shown) this.canvas.setAttribute('data-orb-place', this.shown)
    this.see(size === null || !this.stage ? null : this.squareOf(this.stage, size))
  }

  /**
   * On the stage (each frame, and after a panel render): follow the stage's box. A box that moved or resized since
   * the last look is glided to from where the orb was drawn (at once under reduced motion); one the panel is easing
   * itself only on a jump. When it has no room for the orb any more (the panel took the room back, or a resize hid
   * it) the orb flies home from where it was drawn and waits for the next panel render.
   */
  private refit(now: number): void {
    const el = this.stage
    const size = el ? this.stagePx(el) : null
    if (!el || size === null) {
      this.stageRefused = true
      this.move('rest', now)
      return
    }
    const was = this.drawnOnStage()
    const to = this.squareOf(el, size)
    const d = was && to ? Math.max(Math.abs(to.x - was.x), Math.abs(to.y - was.y), Math.abs(to.s - was.s)) : 0
    const slot = this.slot
    if (was && slot && !this.reduced?.matches && d > (el.getAttribute('data-easing') === 'on' ? EASING_GLIDE_PX : GLIDE_PX)) {
      this.glide(was, size, now, slot)
      return
    }
    if (size !== this.cssPx) this.setSize(size)
    this.see(to)
  }

  /** Record where the canvas sits on the stage now (null: it is not there). */
  private see(sq: Square | null): void {
    this.seen = sq && this.stage ? { sq, ...scrollOffset(this.stage) } : null
  }

  /** Where the canvas sat on the stage at the last look, carried by any scrolling since (null: not on the stage). */
  private drawnOnStage(): Square | null {
    const s = this.seen
    if (!s || !this.stage) return null
    const o = scrollOffset(this.stage)
    return { x: s.sq.x - (o.x - s.x), y: s.sq.y - (o.y - s.y), s: s.sq.s }
  }

  /** Open the stage and return the orb's size on it, or null (no stage, or no room on it: stay at rest). */
  private openStage(): number | null {
    const el = this.stage
    if (!el || this.stageRefused) return null
    if (!el.hasAttribute('data-open')) el.setAttribute('data-open', '')
    const size = this.stagePx(el)
    if (size === null) {
      el.removeAttribute('data-open')
      this.stageRefused = true
    } else if (el.hasAttribute('data-leaving')) el.removeAttribute('data-leaving')
    return size
  }

  /** The orb is not on the stage; `leaving`: it is flying home from it (data-leaving until it lands). */
  private closeStage(leaving = false): void {
    const el = this.stage
    if (!el) return
    if (el.hasAttribute('data-open')) el.removeAttribute('data-open')
    if (leaving) {
      if (!el.hasAttribute('data-leaving')) el.setAttribute('data-leaving', '')
    } else if (el.hasAttribute('data-leaving')) el.removeAttribute('data-leaving')
  }

  /** The orb's size on an open stage: the stage box's smaller side, at most DESKTOP_ORB_STAGE_PX (null: too small). */
  private stagePx(el: HTMLElement): number | null {
    const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
    if (!r) return DESKTOP_ORB_STAGE_PX
    const size = Math.floor(Math.min(r.width, r.height, DESKTOP_ORB_STAGE_PX))
    return size > DESKTOP_ORB_CSS_PX ? size : null
  }

  /** Where a flight to `place` ends now: the centre of the header slot or of the stage, at the size there. */
  private target(place: OrbPlace): Square | null {
    if (place === 'rest') return this.slot ? this.squareOf(this.slot, DESKTOP_ORB_CSS_PX) : null
    const el = this.stage
    const size = el ? this.stagePx(el) : null
    return el && size !== null ? this.squareOf(el, size) : null
  }

  /** The square centred on `el` (side `s`, or the element's width); null when it has no layout box. */
  private squareOf(el: Element, s?: number): Square | null {
    const r = typeof (el as HTMLElement).getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null
    if (!r || !(r.width > 0 && r.height > 0)) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, s: s ?? r.width }
  }

  /** The flight's transform (null: none); while flying the canvas is lifted above the panel's sticky controls. */
  private setFlying(transform: string | null): void {
    const st = this.canvas.style as CSSStyleDeclaration | undefined
    if (!st) return
    const t = transform ?? ''
    if (st.transform !== t) st.transform = t
    const z = transform ? '2' : ''
    if (st.zIndex !== z) st.zIndex = z
  }

  private setSize(px: number): void {
    this.cssPx = px
    const st = this.canvas.style as CSSStyleDeclaration | undefined
    if (st && st.width !== `${px}px`) {
      st.width = `${px}px`
      st.height = `${px}px`
    }
    this.resize()
  }

  /** Canvas pixels follow its CSS size times devicePixelRatio (1..4): drawn at the size it is shown. */
  private resize(): void {
    const dpr = Math.max(1, Math.min(4, Number(this.win.devicePixelRatio) || 1))
    const px = Math.round(this.cssPx * dpr)
    if (this.canvas.width !== px) this.canvas.width = px
    if (this.canvas.height !== px) this.canvas.height = px
  }
}
