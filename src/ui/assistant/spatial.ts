// Spatial (WebXR / passthrough) content of the Ask Meta Muse AI inspector. Mounted by the shell inside its
// spatial inspector frame (which draws the title and close control); bench-local metres with the top-left of
// this area at the origin of the parent group, x right, y up (content extends to negative y), facing +z.
//
// Scene geometry only (stereo-safe): a dark backing plate that stays legible over passthrough, plain-text
// TextSlots for every word, and flat button plates picked by the same ray path as the rest of the bench.
// There is no text field and no keyboard in XR: the learner uses suggestions and the Talk control (record,
// stop, cancel; the existing auto-submit countdown with a clear Cancel). Picks return the UiCommand a press
// dispatches, or null with a hint when the control is disabled; the backing returns a pick with no command so
// a press on the panel never reaches the mathematical objects behind it.

import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Shape, ShapeGeometry, type Object3D, type Ray } from 'three'
import { TextSlot } from '../../rendering/textSlot'
import type { FrameContext } from '../../runtime/host'
import type { AssistantPanelInput, SpatialPanelContent, SpatialPick, UiDispatch } from '../model'
import { type ButtonSpec, type ButtonStyle, type LineSpec, type Measure, type SpatialLayout, PANEL, layoutSpatial } from './spatialLayout'
import { type AssistantView, assistantView } from './view'

const BACKING = 0x0d121c
const PLATE: Record<ButtonStyle, { base: number; hover: number }> = {
  suggestion: { base: 0x182630, hover: 0x21414a },
  action: { base: 0x232b3a, hover: 0x34405a },
  primary: { base: 0x1d4f4a, hover: 0x27665f },
  record: { base: 0x1d4f4a, hover: 0x27665f },
  stop: { base: 0x5b2433, hover: 0x74303f },
}
const DISABLED = 0x171c26

// The plain-text layer's canvas metrics (src/rendering/textSlot.ts PlainText): 56 px font, canvas height
// round(56 * 1.35), 6 px padding each side; shown at height em * 1.35.
const FONT_PX = 56
const CANVAS_H = Math.round(FONT_PX * 1.35)
const FONT = `${FONT_PX}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`

function makeMeasure(): Measure {
  let ctx: CanvasRenderingContext2D | null = null
  try {
    ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null
    if (ctx) ctx.font = FONT
  } catch {
    ctx = null
  }
  const cache = new Map<string, number>()
  return (text, em) => {
    let px = cache.get(text)
    if (px === undefined) {
      px = Math.ceil(ctx ? ctx.measureText(text).width : text.length * FONT_PX * 0.52)
      if (cache.size > 2000) cache.clear()
      cache.set(text, px)
    }
    return ((px + 12) * em * 1.35) / CANVAS_H
  }
}

function roundedRect(w: number, h: number, r: number): ShapeGeometry {
  const s = new Shape()
  s.moveTo(r, 0)
  s.lineTo(w - r, 0)
  s.quadraticCurveTo(w, 0, w, -r)
  s.lineTo(w, -h + r)
  s.quadraticCurveTo(w, -h, w - r, -h)
  s.lineTo(r, -h)
  s.quadraticCurveTo(0, -h, 0, -h + r)
  s.lineTo(0, -r)
  s.quadraticCurveTo(0, 0, r, 0)
  return new ShapeGeometry(s, 6)
}

interface Plate {
  mesh: Mesh
  spec: ButtonSpec | null
}

class AssistantSpatialContent implements SpatialPanelContent {
  readonly width = PANEL.width
  readonly height = PANEL.height
  readonly group = new Group()
  private readonly backing: Mesh
  private readonly slots: TextSlot[] = []
  private readonly plates: Plate[] = []
  private readonly plateGeo = new PlaneGeometry(1, 1)
  private readonly raycaster = new Raycaster()
  private readonly measure = makeMeasure()
  private view: AssistantView | null = null
  private layoutKey = ''
  private hover: string | null = null
  private visible = true
  private disposed = false
  /** Last layout (verification: what is shown, and whether the explanation was shortened). */
  layout: SpatialLayout | null = null

  constructor(private readonly dispatch: UiDispatch) {
    this.group.name = 'assistant-content'
    // Depth: every part here is depth-tested, so a shell popover in front (its plate writes depth and draws
    // first, at renderOrder -5) covers this content. The backing and the button plates write depth themselves and
    // keep it (userData.ownDepth: the adapter's per-frame depth policy leaves them alone), so content behind the
    // panel that draws later is covered too. The shell places this group 1.5 mm in front of its frame plate; the
    // backing sits 1 mm in front of that plate, the button plates 1 mm in front of the backing, the words above both.
    const backing = new MeshBasicMaterial({ color: BACKING, transparent: true, opacity: 0.97, depthWrite: true })
    backing.userData.ownDepth = true
    this.backing = new Mesh(roundedRect(PANEL.width, PANEL.height, 0.014), backing)
    this.backing.name = 'assistant:backing'
    this.backing.position.z = -0.0005
    this.backing.renderOrder = 4
    this.group.add(this.backing)
  }

  mount(parent: Object3D): void {
    parent.add(this.group)
  }

  render(input: AssistantPanelInput): void {
    if (this.disposed) return
    this.view = assistantView({ ...input, surface: 'xr' })
    this.relayout(performance.now())
  }

  /** Time-dependent text: the recording seconds and the auto-submit countdown (whole seconds). */
  private timeKey(now: number): string {
    const v = this.view
    if (!v) return ''
    if (v.voice.phase === 'recording' && v.voice.recordingStartedAt !== null) return `r${Math.floor((now - v.voice.recordingStartedAt) / 1000)}`
    const t = v.voice.transcript
    if (t?.autoSubmitAt != null) return `c${Math.ceil((t.autoSubmitAt - now) / 1000)}`
    return ''
  }

  private relayout(now: number): void {
    const v = this.view
    if (!v) return
    const key = JSON.stringify([v.phase, v.source, v.speech, v.suggestions.map((s) => [s.text, s.note]), v.exchange && { ...v.exchange, actions: v.exchange.actions.map((a) => a.id) }, { ...v.voice, talk: v.voice.talk.label + v.voice.talk.enabled }, this.timeKey(now)])
    if (key === this.layoutKey) return
    this.layoutKey = key
    const l = layoutSpatial(v, now, this.measure)
    this.layout = l
    this.applyLines(l.lines)
    this.applyButtons(l.buttons)
  }

  private applyLines(lines: LineSpec[]): void {
    while (this.slots.length < lines.length) {
      const s = new TextSlot(`assistant:line${this.slots.length}`)
      this.group.add(s.anchor)
      this.slots.push(s)
    }
    this.slots.forEach((s, i) => {
      const l = lines[i]
      if (!l) {
        s.set(null)
        return
      }
      s.set({ kind: 'plain', plain: l.text, em: l.em, color: l.color })
      // The plain layer is centred on its anchor and sized synchronously: left-align at x.
      s.anchor.position.set(l.x + s.width / 2, -l.y, l.onPlate ? 0.0025 : 0.001)
    })
  }

  private applyButtons(buttons: ButtonSpec[]): void {
    while (this.plates.length < buttons.length) {
      const mesh = new Mesh(this.plateGeo, new MeshBasicMaterial({ color: PLATE.action.base }))
      mesh.material.userData.ownDepth = true
      mesh.renderOrder = 5
      this.group.add(mesh)
      this.plates.push({ mesh, spec: null })
    }
    this.plates.forEach((p, i) => {
      const b = buttons[i] ?? null
      p.spec = b
      p.mesh.visible = !!b
      if (!b) return
      p.mesh.name = `assistant:${b.id}`
      p.mesh.scale.set(b.w, b.h, 1)
      p.mesh.position.set(b.x + b.w / 2, -(b.y + b.h / 2), 0.0005)
    })
    this.paint()
  }

  private paint(): void {
    for (const p of this.plates) {
      if (!p.spec) continue
      const c = PLATE[p.spec.style]
      ;(p.mesh.material as MeshBasicMaterial).color.setHex(!p.spec.enabled ? DISABLED : this.hover === `assistant:${p.spec.id}` ? c.hover : c.base)
    }
  }

  step(ctx: FrameContext): void {
    if (this.disposed) return
    if (this.timeKey(performance.now()) && this.view) this.relayout(performance.now())
    for (const s of this.slots) s.frame(ctx.time)
  }

  pick(ray: Ray): SpatialPick | null {
    if (!this.visible || this.disposed || !this.group.visible) return null
    this.group.updateMatrixWorld()
    this.raycaster.ray.copy(ray)
    const targets: Object3D[] = this.plates.filter((p) => p.spec && p.mesh.visible).map((p) => p.mesh)
    targets.push(this.backing)
    const hit = this.raycaster.intersectObjects(targets, false)[0]
    if (!hit) return null
    const plate = this.plates.find((p) => p.mesh === hit.object)
    if (!plate?.spec) return { id: 'assistant:panel', distance: hit.distance, command: null }
    const b = plate.spec
    const id = `assistant:${b.id}`
    if (!b.enabled || !b.command) return { id, distance: hit.distance, command: null, hint: b.hint ?? 'Not available right now' }
    return b.hint ? { id, distance: hit.distance, command: b.command, hint: b.hint } : { id, distance: hit.distance, command: b.command }
  }

  setHover(id: string | null): void {
    if (id === this.hover) return
    this.hover = id
    this.paint()
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.group.visible = visible
  }

  /** What the panel shows (verification). */
  report() {
    return {
      visible: this.group.visible,
      lines: this.layout?.lines.map((l) => l.text) ?? [],
      buttons: this.layout?.buttons.map((b) => ({ id: b.id, enabled: b.enabled, command: b.command })) ?? [],
      clamped: this.layout?.clamped ?? false,
      slots: this.slots.filter((s) => s.wantedKey !== null).map((s) => s.report()),
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const s of this.slots) s.dispose()
    for (const p of this.plates) (p.mesh.material as MeshBasicMaterial).dispose()
    this.plateGeo.dispose()
    this.backing.geometry.dispose()
    ;(this.backing.material as MeshBasicMaterial).dispose()
    this.group.removeFromParent()
    void this.dispatch
  }
}

export function createAssistantSpatialContent(dispatch: UiDispatch): SpatialPanelContent {
  return new AssistantSpatialContent(dispatch)
}

export type { AssistantSpatialContent }
