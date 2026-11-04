// Spatial panels: one canvas-textured plane per region (its own dark backing, words, cards, icons), drawn only
// when its content changes. Words use the same Canvas2D system-ui text as TextSlot's plain layer (no font
// loading); formulas go through TextSlot's mathematical path on top of a panel. Hit regions are rectangles in
// panel metres, so picking is a ray-plane intersection plus a rectangle lookup (no Raycaster allocations).
// Hover is a separate rounded highlight mesh, so hovering never redraws a texture.

import {
  CanvasTexture, Color, Group, LinearMipmapLinearFilter, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Ray,
  SRGBColorSpace, ShaderMaterial, Vector3,
} from 'three'
import { ICONS, type IconName } from './icons'
import { hitAt, wrapText, type HitRegion } from './logic'

/** Canvas pixels per metre (about 1.5x a Quest 3S pixel at 0.8 m; mipmapped). */
export const PX = 2000
/** Application cap for each canvas side in pixels; begin() lowers the density above it. */
export const MAX_TEXTURE = 4096
export const FONT = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`
export const MATH_FONT = `'STIX Two Math', 'Cambria Math', 'Latin Modern Math', Georgia, 'Times New Roman', serif`
/** Panels draw before default content (assistant meshes, formulas) and after the passthrough backdrop (-10). */
export const PANEL_ORDER = -5

type Canvas = HTMLCanvasElement
let canvasFactory: () => Canvas = () => document.createElement('canvas')
/** Test seam: node has no canvas (tests pass a fake 2D context). */
export function setCanvasFactory(f: () => Canvas): void {
  canvasFactory = f
}

const paths = new Map<string, Path2D>()
function pathOf(d: string): Path2D | null {
  if (typeof Path2D === 'undefined') return null
  let p = paths.get(d)
  if (!p) {
    p = new Path2D(d)
    paths.set(d, p)
  }
  return p
}

const css = (c: number | string): string => (typeof c === 'string' ? c : `#${c.toString(16).padStart(6, '0')}`)

/** Drawing in metres from the panel's top-left corner, y down. */
export class Painter {
  constructor(readonly ctx: CanvasRenderingContext2D) {}

  font(size: number, weight = 400, family = FONT): string {
    return `${weight} ${Math.round(size * PX * 10) / 10}px ${family}`
  }

  measure(text: string, size: number, weight = 400, family = FONT): number {
    this.ctx.font = this.font(size, weight, family)
    return this.ctx.measureText(text).width / PX
  }

  wrap(text: string, maxWidth: number, size: number, weight = 400, family = FONT): string[] {
    this.ctx.font = this.font(size, weight, family)
    return wrapText(text, maxWidth, (s) => this.ctx.measureText(s).width / PX)
  }

  rrect(x: number, y: number, w: number, h: number, r: number, fill: string | null, stroke: string | null = null, lineWidth = 0.0012): void {
    const c = this.ctx
    const s = PX
    const rr = Math.min(r, w / 2, h / 2) * s
    c.beginPath()
    const X = x * s
    const Y = y * s
    const W = w * s
    const H = h * s
    c.moveTo(X + rr, Y)
    c.arcTo(X + W, Y, X + W, Y + H, rr)
    c.arcTo(X + W, Y + H, X, Y + H, rr)
    c.arcTo(X, Y + H, X, Y, rr)
    c.arcTo(X, Y, X + W, Y, rr)
    c.closePath()
    if (fill) {
      c.fillStyle = fill
      c.fill()
    }
    if (stroke) {
      c.strokeStyle = stroke
      c.lineWidth = lineWidth * s
      c.stroke()
    }
  }

  /** Text with its vertical middle at y. */
  text(t: string, x: number, y: number, size: number, color: number | string, opts: { weight?: number; align?: CanvasTextAlign; family?: string } = {}): number {
    const c = this.ctx
    c.font = this.font(size, opts.weight ?? 400, opts.family ?? FONT)
    c.fillStyle = css(color)
    c.textAlign = opts.align ?? 'left'
    c.textBaseline = 'middle'
    c.fillText(t, x * PX, y * PX)
    return c.measureText(t).width / PX
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string, width = 0.001): void {
    const c = this.ctx
    c.beginPath()
    c.moveTo(x1 * PX, y1 * PX)
    c.lineTo(x2 * PX, y2 * PX)
    c.strokeStyle = color
    c.lineWidth = width * PX
    c.lineCap = 'round'
    c.stroke()
  }

  circle(cx: number, cy: number, r: number, fill: string | null, stroke: string | null = null, width = 0.001): void {
    const c = this.ctx
    c.beginPath()
    c.arc(cx * PX, cy * PX, r * PX, 0, Math.PI * 2)
    if (fill) {
      c.fillStyle = fill
      c.fill()
    }
    if (stroke) {
      c.strokeStyle = stroke
      c.lineWidth = width * PX
      c.stroke()
    }
  }

  /** A 24-unit line icon whose top-left is (x, y), `size` metres square. */
  icon(name: IconName | string, x: number, y: number, size: number, color: string, strokeWidth = 1.8): void {
    const d = (ICONS as Record<string, string>)[name] ?? name
    const p = pathOf(d)
    if (!p) return
    const c = this.ctx
    c.save()
    c.translate(x * PX, y * PX)
    const k = (size * PX) / 24
    c.scale(k, k)
    c.strokeStyle = color
    c.lineWidth = name === 'more' ? 3 : strokeWidth
    c.lineCap = 'round'
    c.lineJoin = 'round'
    c.stroke(p)
    c.restore()
  }
}

/** One textured plane whose group origin is the panel's top-left corner (+x right, +y up, content at -y). */
export class CanvasPanel {
  readonly group = new Group()
  readonly mesh: Mesh
  private readonly canvas: Canvas
  private readonly ctx: CanvasRenderingContext2D
  private readonly texture: CanvasTexture
  private readonly painter: Painter
  width = 0
  height = 0
  hits: HitRegion[] = []
  /** Signature of what is drawn (the owner skips identical redraws). */
  key = ''
  shown = false
  redraws = 0
  /** The shown band of a taller drawing (a scrolling view): its top (metres into the drawing) and height; null shows
   * the whole drawing. Moving it slides the texture window only: nothing is redrawn. Hits, picks and the hover
   * highlight use drawing coordinates throughout (intersect() adds viewTop). */
  viewTop = 0
  viewH: number | null = null

  constructor(readonly name: string) {
    this.group.name = name
    this.canvas = canvasFactory()
    this.ctx = this.canvas.getContext('2d')!
    this.painter = new Painter(this.ctx)
    this.texture = new CanvasTexture(this.canvas)
    this.texture.colorSpace = SRGBColorSpace
    this.texture.minFilter = LinearMipmapLinearFilter
    this.texture.magFilter = LinearFilter
    this.texture.anisotropy = 4
    // Depth-writing (with an alpha test for the transparent corners): a panel occludes whatever is behind it even
    // when that is drawn later (scene meshes, other panels), so a popover in front of the stage really covers it.
    // ownDepth: the adapter's per-frame depth policy (which makes transparent materials stop writing depth) skips it.
    const mat = new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: true, alphaTest: 0.02, toneMapped: false })
    mat.userData.ownDepth = true
    this.mesh = new Mesh(new PlaneGeometry(1, 1), mat)
    this.mesh.name = `${name}:plate`
    this.mesh.renderOrder = PANEL_ORDER
    this.group.add(this.mesh)
    this.setShown(false)
  }

  /** A painter for measuring before drawing (no resize). */
  get measurer(): Painter {
    return this.painter
  }

  /** Resize to w x h metres, clear, and return the painter. A drawing taller (or wider) than MAX_TEXTURE pixels at
   * PX is drawn at a lower density (the painter still works in PX units, under a scale), so it fits a GPU texture. */
  begin(w: number, h: number): Painter {
    const k = Math.min(1, MAX_TEXTURE / (Math.max(w, h) * PX))
    const W = Math.max(4, Math.ceil(w * PX * k))
    const H = Math.max(4, Math.ceil(h * PX * k))
    // A resized canvas needs fresh GPU storage (see PlainText in textSlot.ts).
    if (W !== this.canvas.width || H !== this.canvas.height) {
      this.texture.dispose()
      this.canvas.width = W
      this.canvas.height = H
    }
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, W, H)
    this.ctx.setTransform(k, 0, 0, k, 0, 0)
    this.width = w
    this.height = h
    this.hits = []
    return this.painter
  }

  end(): void {
    this.texture.needsUpdate = true
    this.applyView()
    this.redraws++
  }

  /** Show the band [top, top + height] of the drawing (clamped to it); height null shows the whole drawing. */
  setView(top: number, height: number | null): void {
    this.viewH = height === null || height >= this.height ? null : height
    this.viewTop = this.viewH === null ? 0 : Math.max(0, Math.min(this.height - this.viewH, top))
    this.applyView()
  }

  /** The shown height (the view's, or the whole drawing's). */
  get shownHeight(): number {
    return this.viewH ?? this.height
  }

  private applyView(): void {
    const h = this.shownHeight
    this.mesh.scale.set(this.width, h, 1)
    this.mesh.position.set(this.width / 2, -h / 2, 0)
    const H = this.height || 1
    this.texture.repeat.set(1, h / H)
    this.texture.offset.set(0, 1 - (this.viewTop + h) / H) // flipY: v = 1 is the drawing's top
  }

  /** The standard backing plate: dark, slightly translucent, hairline border (legible over passthrough). */
  plate(p: Painter, opts: { radius?: number; fill?: string; border?: string; accent?: string | null } = {}): void {
    const r = opts.radius ?? 0.018
    p.rrect(0.001, 0.001, this.width - 0.002, this.height - 0.002, r, opts.fill ?? 'rgba(15, 20, 31, 0.95)', opts.border ?? 'rgba(160, 178, 214, 0.22)', 0.0012)
    if (opts.accent) {
      const c = p.ctx
      const g = c.createLinearGradient(0, 0, this.width * PX, 0)
      g.addColorStop(0, 'rgba(79, 209, 197, 0)')
      g.addColorStop(0.5, opts.accent)
      g.addColorStop(1, 'rgba(79, 209, 197, 0)')
      c.fillStyle = g
      c.fillRect(r * PX, 0.0012 * PX, (this.width - 2 * r) * PX, 0.0022 * PX)
    }
  }

  setShown(v: boolean): void {
    this.shown = v
    this.group.visible = v
  }

  hit(x: number, y: number): HitRegion | null {
    return hitAt(this.hits, x, y)
  }

  findHit(id: string): HitRegion | null {
    for (const h of this.hits) if (h.id === id) return h
    return null
  }

  /** Intersect a world ray with this panel's plane; panel metres (y down) and the world distance, or null. */
  intersect(ray: Ray, out: { x: number; y: number; distance: number }): boolean {
    if (!this.shown || this.width <= 0) return false
    this.group.updateWorldMatrix(true, false)
    INV.copy(this.group.matrixWorld).invert()
    LOCAL.copy(ray).applyMatrix4(INV)
    const dz = LOCAL.direction.z
    if (Math.abs(dz) < 1e-9) return false
    const t = -LOCAL.origin.z / dz
    if (t < 0) return false
    const x = LOCAL.origin.x + t * LOCAL.direction.x
    const y = -(LOCAL.origin.y + t * LOCAL.direction.y)
    if (x < 0 || x > this.width || y < 0 || y > this.shownHeight) return false
    P.set(x, -y, 0).applyMatrix4(this.group.matrixWorld)
    out.x = x
    out.y = y + this.viewTop // drawing coordinates (a scrolled view shows the drawing from viewTop)
    out.distance = P.distanceTo(ray.origin)
    return true
  }

  dispose(): void {
    this.texture.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as MeshBasicMaterial).dispose()
    this.group.removeFromParent()
  }
}

const INV = new Matrix4()
const LOCAL = new Ray()
const P = new Vector3()

/** The hover highlight: a rounded rectangle (fill + edge) laid over the hovered region of a panel. */
export class HoverOverlay {
  readonly mesh: Mesh
  private readonly mat: ShaderMaterial

  constructor() {
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        size: { value: [0.1, 0.05] },
        radius: { value: 0.01 },
        color: { value: new Color(0xffffff) },
        fill: { value: 0.1 },
        edge: { value: 0.45 },
      },
      vertexShader: `uniform vec2 size; varying vec2 vPos; void main(){ vPos = position.xy * size; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec2 size; uniform float radius; uniform vec3 color; uniform float fill; uniform float edge; varying vec2 vPos;
        void main(){
          vec2 q = abs(vPos) - (size * 0.5 - vec2(radius));
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
          float aa = max(fwidth(d), 1e-5);
          float inside = 1.0 - smoothstep(-aa, aa, d);
          float ring = 1.0 - smoothstep(0.0008 - aa, 0.0008 + aa, abs(d + 0.0011));
          float a = inside * fill + ring * edge;
          if (a < 0.003) discard;
          gl_FragColor = vec4(color, a);
          #include <colorspace_fragment>
        }`,
    })
    // Keeps its own depth settings too (see CanvasPanel).
    this.mat.userData.ownDepth = true
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.mat)
    this.mesh.name = 'shell:hover'
    this.mesh.renderOrder = PANEL_ORDER + 1
    this.mesh.visible = false
  }

  /** Place over region r of panel (enabled regions glow brighter than disabled ones). */
  show(panel: CanvasPanel, r: HitRegion, tint = 0xffffff): void {
    // A scrolled panel: the region sits viewTop higher; a region scrolled out of the view has no highlight.
    const top = panel.viewTop
    if (r.y + r.h <= top || r.y >= top + panel.shownHeight) {
      this.hide()
      return
    }
    if (this.mesh.parent !== panel.group) panel.group.add(this.mesh)
    this.mesh.position.set(r.x + r.w / 2, -(r.y - top + r.h / 2), 0.0009)
    this.mesh.scale.set(r.w, r.h, 1)
    const u = this.mat.uniforms
    ;(u.size!.value as number[])[0] = r.w
    ;(u.size!.value as number[])[1] = r.h
    u.radius!.value = Math.min(r.r, r.w / 2, r.h / 2)
    ;(u.color!.value as Color).setHex(tint)
    u.fill!.value = r.enabled ? 0.1 : 0.04
    u.edge!.value = r.enabled ? 0.5 : 0.18
    this.mesh.visible = true
  }

  hide(): void {
    this.mesh.visible = false
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.mat.dispose()
    this.mesh.removeFromParent()
  }
}
