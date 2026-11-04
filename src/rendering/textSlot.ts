// One piece of scene text with an explicit freshness state (review C1).
//
// Contract: a slot never shows typeset geometry for a key other than the one it was last given.
//  - fresh:   the typeset content for the current key is shown.
//  - pending: the current key is not typeset yet. Old geometry is removed at once; the slot shows the
//             current content as plain text (Canvas2D, not MathJax) plus three pulsing dots.
//  - error:   typesetting failed. Plain text plus a red "!" marker; the rest of the scene keeps working.
// Pending and error rendering use only canvas text and plain meshes, so they work even if MathJax
// never loads. Everything is scene geometry (stereo-safe); the owner places and billboards `anchor`.
// Content of kind 'plain' (the push-to-talk caption) is plain canvas text by design: it is fresh as soon as
// it is drawn, and drawing happens only when the text changes.

import {
  CanvasTexture, CircleGeometry, Group, LinearMipmapLinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, RingGeometry, Shape, ShapeGeometry,
  SRGBColorSpace, type BufferGeometry, type Material,
} from 'three'
import { texGeometry, peekTex, claimEntry, releaseEntry, type TexEntry, type TexPart } from './tex'
import { compose, tokenStats, type Composed, type TokenSpec } from './glyphTokens'

export type SlotContent =
  | { kind: 'tex'; parts: TexPart[]; em: number; color: number; plain: string }
  | { kind: 'tokens'; tokens: TokenSpec[]; em: number; color: number; plain: string }
  | { kind: 'plain'; em: number; color: number; plain: string }

export type SlotState = 'idle' | 'fresh' | 'pending' | 'error'

export const slotStats = { sets: 0, pendingShown: 0, errorsShown: 0 }

const PLATE = 0x121722
const ERROR_PLATE = 0x3a1620
const ERROR = 0xff5a6e

function contentKey(c: SlotContent): string {
  if (c.kind === 'plain') return JSON.stringify(['plain', c.plain, c.em, c.color])
  return c.kind === 'tex'
    ? JSON.stringify(['tex', c.parts.map((p) => [p.tex, p.color ?? null]), c.em, c.color])
    : JSON.stringify(['tok', c.tokens.map((t) => [t.tex, t.color, t.space ?? 'ord']), c.em])
}

function roundedPlate(): BufferGeometry {
  const s = new Shape()
  const w = 1
  const h = 1
  const r = 0.12
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return new ShapeGeometry(s, 6)
}

/** Plain text on a canvas texture: the MathJax-independent layer for pending and error states. */
class PlainText {
  readonly mesh: Mesh
  private readonly canvas = document.createElement('canvas')
  private readonly texture: CanvasTexture
  /** The text currently drawn on the canvas (what a viewer sees in pending/error states). */
  text = ''
  /** The colour the current text was drawn in (a colour-only change redraws too). */
  private drawnColor = -1
  width = 0
  height = 0

  constructor() {
    this.texture = new CanvasTexture(this.canvas)
    this.texture.colorSpace = SRGBColorSpace
    // Drawn at 56 px and shown far smaller (the assistant panel's lines): mipmaps and anisotropy, as the shell's
    // CanvasPanel uses, or the minified glyphs alias and shimmer with every head movement.
    this.texture.minFilter = LinearMipmapLinearFilter
    this.texture.anisotropy = 4
    this.mesh = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }))
    this.mesh.renderOrder = 6
    this.mesh.visible = false
  }

  set(text: string, color: number, em: number): void {
    if (text !== this.text || color !== this.drawnColor) {
      this.text = text
      this.drawnColor = color
      const px = 56
      const ctx = this.canvas.getContext('2d')!
      const font = `${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
      ctx.font = font
      const w = Math.max(8, Math.ceil(ctx.measureText(text).width) + 12)
      const h = Math.round(px * 1.35)
      // three.js allocates immutable GPU storage at the first upload: a resized canvas would be copied into the
      // old size and fail, leaving the previous text stretched to the new width. Free it so it is reallocated.
      if (w !== this.canvas.width || h !== this.canvas.height) this.texture.dispose()
      this.canvas.width = w
      this.canvas.height = h
      ctx.font = font
      ctx.textBaseline = 'middle'
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`
      ctx.fillText(text, 6, this.canvas.height / 2)
      this.texture.needsUpdate = true
    }
    this.height = em * 1.35
    this.width = this.height * (this.canvas.width / this.canvas.height)
    this.mesh.scale.set(this.width, this.height, 1)
  }

  /** Free GPU copies while the plain layer is not shown (three re-uploads on next use). */
  releaseGpu(): void {
    this.texture.dispose()
    this.mesh.geometry.dispose()
  }

  dispose(): void {
    this.texture.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as Material).dispose()
  }
}

export class TextSlot {
  readonly anchor = new Group()
  state: SlotState = 'idle'
  wantedKey: string | null = null
  shownKey: string | null = null
  lastError: string | null = null
  private content: SlotContent | null = null
  private readonly body = new Group()
  private readonly plain = new PlainText()
  private readonly plate: Mesh | null
  private plateColor = PLATE
  private readonly dots: Mesh[] = []
  private readonly errorMark = new Group()
  private entry: TexEntry | null = null
  private composed: Composed | null = null
  private arrived: { key: string; entry: TexEntry } | null = null
  private failure: { key: string; message: string } | null = null
  private tokenVersion = -1
  private opacity = 1
  private wanted = true
  private disposed = false
  /** Size of what is currently shown (metres), for plates and owner layout. */
  width = 0
  height = 0

  constructor(readonly id: string, opts: { plate?: boolean } = {}) {
    this.anchor.name = `slot:${id}`
    this.anchor.add(this.body, this.plain.mesh)
    if (opts.plate) {
      this.plate = new Mesh(roundedPlate(), new MeshBasicMaterial({ color: PLATE, transparent: true, opacity: 0.84, depthWrite: false }))
      this.plate.renderOrder = 5
      this.plate.position.z = -0.002
      this.plate.visible = false
      this.anchor.add(this.plate)
    } else this.plate = null
    const dotGeo = new CircleGeometry(1, 12)
    for (let i = 0; i < 3; i++) {
      const d = new Mesh(dotGeo, new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }))
      d.renderOrder = 7
      d.visible = false
      this.dots.push(d)
      this.anchor.add(d)
    }
    const ring = new Mesh(new RingGeometry(0.78, 1, 24), new MeshBasicMaterial({ color: ERROR, transparent: true, depthWrite: false }))
    const bar = new Mesh(new PlaneGeometry(0.16, 0.8), new MeshBasicMaterial({ color: ERROR, transparent: true, depthWrite: false }))
    bar.position.y = 0.14
    const dot = new Mesh(new CircleGeometry(0.1, 10), new MeshBasicMaterial({ color: ERROR, transparent: true, depthWrite: false }))
    dot.position.y = -0.48
    for (const m of [ring, bar, dot]) m.renderOrder = 7
    this.errorMark.add(ring, bar, dot)
    this.errorMark.visible = false
    this.anchor.add(this.errorMark)
  }

  /** Set the content this slot must represent now. Synchronous freshness decision. */
  set(content: SlotContent | null): void {
    if (this.disposed) return
    const key = content ? contentKey(content) : null
    if (key === this.wantedKey) return
    slotStats.sets++
    this.wantedKey = key
    this.content = content
    this.lastError = null
    this.failure = null
    if (this.arrived) {
      releaseEntry(this.arrived.entry)
      this.arrived = null
    }
    if (!content || !key) {
      this.clearShown()
      this.state = 'idle'
      this.refresh()
      return
    }
    if (content.kind === 'tokens') {
      this.tryCompose()
      return
    }
    if (content.kind === 'plain') {
      this.clearShown()
      this.state = 'fresh'
      this.shownKey = key
      this.showPlain()
      return
    }
    const cached = peekTex(content.parts, content.em, content.color, this.id)
    if (cached) {
      claimEntry(cached)
      this.showEntry(cached, key)
      return
    }
    this.showPending()
    texGeometry(content.parts, content.em, content.color, this.id).then(
      (entry) => {
        if (this.disposed || this.wantedKey !== key) return
        claimEntry(entry)
        if (this.arrived) releaseEntry(this.arrived.entry)
        this.arrived = { key, entry }
      },
      (err: unknown) => {
        if (this.disposed || this.wantedKey !== key || String(err) === 'Error: superseded') return
        this.failure = { key, message: String(err) }
      },
    )
  }

  /** Per frame: swap in finished builds for the current key; animate the pending marker only. */
  frame(time: number): void {
    if (this.disposed) return
    if (this.arrived) {
      const a = this.arrived
      this.arrived = null
      if (a.key === this.wantedKey) this.showEntry(a.entry, a.key)
      else releaseEntry(a.entry)
    }
    if (this.failure) {
      const f = this.failure
      this.failure = null
      if (f.key === this.wantedKey) this.showError(f.message)
    }
    if (this.state === 'pending' && this.content?.kind === 'tokens' && tokenStats.version !== this.tokenVersion) this.tryCompose()
    if (this.state === 'pending' && this.anchor.visible) {
      for (let i = 0; i < 3; i++) (this.dots[i]!.material as MeshBasicMaterial).opacity = this.opacity * (0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * 6 - i * 1.2)))
    }
  }

  setOpacity(o: number): void {
    if (o === this.opacity) return
    this.opacity = o
    this.applyOpacity()
    this.refresh()
  }

  setWanted(w: boolean): void {
    if (w === this.wanted) return
    this.wanted = w
    this.refresh()
  }

  get isWanted(): boolean {
    return this.wanted
  }

  setPlateColor(c: number): void {
    this.plateColor = c
    if (this.plate && this.state !== 'error') (this.plate.material as MeshBasicMaterial).color.setHex(c)
  }

  /** What is on screen, for freshness checks. `layer` says which renderer produced it. */
  report() {
    return {
      id: this.id,
      state: this.state,
      visible: this.anchor.visible,
      wantedKey: this.wantedKey,
      shownKey: this.shownKey,
      layer: this.state === 'fresh' ? (this.entry ? 'tex' : this.composed ? 'tokens' : 'plain') : this.state === 'pending' || this.state === 'error' ? 'plain' : null,
      plain: this.content?.plain ?? null,
      /** What is actually rendered: the canvas text when the plain layer is visible, and whether any typeset
       * geometry is attached (must be none outside 'fresh'). */
      drawnPlain: this.plain.mesh.visible ? this.plain.text : null,
      typesetAttached: this.body.children.length,
      error: this.lastError,
    }
  }

  dispose(): void {
    this.disposed = true
    this.clearShown()
    if (this.arrived) releaseEntry(this.arrived.entry)
    this.arrived = null
    this.plain.dispose()
    this.anchor.removeFromParent()
    this.anchor.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh && o !== this.plain.mesh) {
        m.geometry.dispose()
        ;(m.material as Material).dispose()
      }
    })
  }

  // ------------------------------------------------------------------ internals

  private tryCompose(): void {
    const c = this.content
    if (!c || c.kind !== 'tokens') return
    this.tokenVersion = tokenStats.version
    // The previous composition lends its meshes/buffers to the new one (R6 follow-up F1); whatever it
    // does not hand over is disposed by clearShown() below, exactly as before.
    const r = compose(c.tokens, c.em, this.composed)
    if (r === 'missing') {
      // Always re-show: the content may have changed while already pending (review C1-a). Redrawing the
      // canvas is skipped inside PlainText.set when the text is unchanged.
      this.showPending()
      return
    }
    if ('error' in r) {
      this.showError(r.error)
      return
    }
    this.clearShown()
    if (this.state === 'pending' || this.state === 'error') this.releaseFallbackGpu()
    this.composed = r
    this.body.add(r.group)
    this.shownKey = this.wantedKey
    this.state = 'fresh'
    this.width = r.width
    this.height = r.height
    this.applyOpacity()
    this.refresh()
  }

  private showEntry(entry: TexEntry, key: string): void {
    this.clearShown()
    if (this.state === 'pending' || this.state === 'error') this.releaseFallbackGpu()
    this.entry = entry
    this.body.add(entry.holder)
    this.shownKey = key
    this.state = 'fresh'
    this.width = entry.width
    this.height = entry.height
    this.applyOpacity()
    this.refresh()
  }

  private showPending(): void {
    this.clearShown()
    if (this.state !== 'pending') slotStats.pendingShown++
    this.state = 'pending'
    this.showPlain()
  }

  private showError(message: string): void {
    this.clearShown()
    this.state = 'error'
    this.lastError = message
    slotStats.errorsShown++
    this.showPlain()
  }

  private showPlain(): void {
    const c = this.content!
    this.plain.set(c.plain, c.color, c.em)
    this.width = this.plain.width
    this.height = this.plain.height
    const em = c.em
    this.dots.forEach((d, i) => {
      d.scale.setScalar(em * 0.09)
      d.position.set(this.plain.width / 2 + em * (0.35 + 0.32 * i), -em * 0.2, 0.001)
    })
    this.errorMark.scale.setScalar(em * 0.5)
    this.errorMark.position.set(-this.plain.width / 2 - em * 0.6, 0, 0.001)
    this.applyOpacity()
    this.refresh()
  }

  /** Leaving pending/error: the fallback layer and markers give their GPU memory back. */
  private releaseFallbackGpu(): void {
    this.plain.releaseGpu()
    this.dots[0]!.geometry.dispose()
    for (const m of this.errorMark.children) (m as Mesh).geometry.dispose()
  }

  private clearShown(): void {
    if (this.entry) {
      releaseEntry(this.entry)
      this.entry = null
    }
    if (this.composed) {
      this.composed.dispose()
      this.composed = null
    }
    this.shownKey = null
  }

  private applyOpacity(): void {
    const o = this.opacity
    this.body.traverse((n) => {
      const m = (n as Mesh).material as MeshBasicMaterial | undefined
      if (m) {
        m.transparent = true
        m.opacity = o
      }
    })
    ;(this.plain.mesh.material as MeshBasicMaterial).opacity = o * (this.state === 'pending' ? 0.8 : 1)
    for (const m of this.errorMark.children) ((m as Mesh).material as MeshBasicMaterial).opacity = o
    if (this.plate) (this.plate.material as MeshBasicMaterial).opacity = 0.84 * o
  }

  private refresh(): void {
    const plainState = this.state === 'pending' || this.state === 'error' || (this.state === 'fresh' && this.content?.kind === 'plain')
    this.plain.mesh.visible = plainState
    for (const d of this.dots) d.visible = this.state === 'pending'
    this.errorMark.visible = this.state === 'error'
    if (this.plate) {
      const pad = 0.012
      const extra = this.state === 'pending' ? (this.content?.em ?? 0) * 1.3 : this.state === 'error' ? (this.content?.em ?? 0) * 1.3 : 0
      this.plate.visible = this.state !== 'idle'
      this.plate.scale.set(this.width + pad * 2 + extra, this.height + pad * 2, 1)
      this.plate.position.x = this.state === 'pending' ? extra / 2 : this.state === 'error' ? -extra / 2 : 0
      ;(this.plate.material as MeshBasicMaterial).color.setHex(this.state === 'error' ? ERROR_PLATE : this.plateColor)
    }
    this.anchor.visible = this.wanted && this.opacity > 0.001 && this.state !== 'idle'
  }
}
