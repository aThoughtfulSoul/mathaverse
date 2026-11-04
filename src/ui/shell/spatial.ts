// Spatial shell (UI-REFINEMENT-SPEC sections 3, 4, 7, 8): the same regions as the desktop shell, as panels on the
// movable workbench (bench-local metres, +x right, +y up, +z toward the viewer). Every panel carries its own dark
// backing plate (legible over passthrough) and stays outside the scene box (x +-0.5, y -0.24..0.32,
// z -0.25..0.15):
//
//   question header   above-left of the stage         top-left (-0.50, 0.505, -0.04), tilted 0.12 rad down
//   context + status  below the stage (status on top)  top edge y -0.252, z 0.10, tilted 0.35 rad up, <= 1.1 m wide
//     hidden          while the assistant is open      fades out in 0.3 s (not pickable) when it opens, back in when
//                                                      it closes; it never moves (the orb takes its room)
//   toolbar           two stable rows at the bottom    centre (0, -0.495, 0.215), tilted 0.6 rad up
//     a little lower  while the assistant is open      0.11 m lower and 0.11 m nearer than its standard place (one
//                                                      place for every experiment); it moves only when the assistant
//                                                      opens or closes (a 0.4 s ease, instant under reduced motion)
//   popovers          in front of the lower stage      z 0.26, bottom edge >= y -0.236 (above the toolbar in both
//                                                      of its places; in front of the orb, which they cover while open)
//   inspector         reserved area right of stage     left edge (0.675, 0.405, -0.18), yawed -0.8 rad
//   assistant orb     centred under the stage's front  centre (0, -0.55, 0.04), 2.78 x XR_ORB (25 cm across idle,
//                     edge, in the context panel's     35 cm at the bloom's start), one fixed place, shown only with
//                     room                             the assistant inspector
//
// The inspector area is reserved: opening or closing it never moves the stage. A press is resolved by pick():
// the shell returns the UiCommand the coordinator dispatches (null for hover-only and disabled entries, with a
// hint). press(id) handles the shell's own page turns in the mathematics inspector.

import { Group, Vector3, type Material, type Object3D, type Ray } from 'three'
import type { FrameContext } from '../../runtime/host'
import { TextSlot } from '../../rendering/textSlot'
import type {
  ContextItem, DetailItem, DetailSection, EvidenceItem, MoreItem, SpatialPanelContent, SpatialPick, ToolbarItem, UiCommand,
  UiDispatch, UiView,
} from '../model'
import { fieldGroups } from '../model'
import type { DemoKind } from '../../demo/order'
import {
  CLOSE_INSPECTOR, CLOSE_POPOVER, TOGGLE_MATH, TOOLBAR_ROWS, contextCommand, detailActionCommand, inspectorFrame, isShortChoice,
  mathToggleLabel, moreCommand, moreSections, paginate, regionPick, toolbarCommand, toolbarDescription, toolbarWidestLabel,
  type HitRegion,
} from './logic'
import { CanvasPanel, HoverOverlay, MATH_FONT, PX, type Painter } from './panel'
import { assistantView } from '../assistant/view'
import { EXPERIMENT_ICONS, type IconName } from './icons'
import { XR_ORB, XrOrb } from '../orb/xr'
import { BLOOM_START_RADIUS } from '../orb/motion'
import type { OrbSource } from '../orb/source'

// ------------------------------------------------------------------ layout and type (bench-local metres)

export const SPATIAL_LAYOUT = {
  header: { left: -0.5, top: 0.505, z: -0.04, tilt: 0.12, maxWidth: 0.66 },
  context: { top: -0.252, z: 0.1, tilt: -0.35, maxWidth: 1.1, minWidth: 0.62 },
  toolbar: { centerY: -0.495, z: 0.215, tilt: -0.6, clearance: 0.018 },
  popover: { centerY: -0.095, z: 0.26, tilt: -0.14, bottom: -0.236, pickerX: -0.06, moreX: 0.2, xLimit: 0.62 },
  /** The inspector's top-left corner and yaw: right of the stage, turned toward the viewer. Seen by both eyes from
   * the default head pose (scripts/ui-capture.sh), either inspector, at its full height, keeps clear of the context
   * panel (the widest, braid and proof, included) and of the toolbar in both of its places and every place between,
   * in all seven demonstrations, and stays whole in a 90-degree eye (its far corner reaches about 0.96 of the
   * half-width). */
  inspector: { left: 0.675, top: 0.405, z: -0.18, yaw: -0.8, width: 0.47, maxHeight: 0.82 },
  /** The Ask Meta Muse AI glyph orb while the assistant inspector is open: ONE place (bench-local, centred, under the
   * scene box's front edge, 1.63 m from the default eye, 43.8 degrees below level), at `scale` x XR_ORB: 25 cm across
   * idle (8.8 degrees), 35 cm at the bloom's start (BLOOM_START_RADIUS), in the room the hidden context panel leaves.
   * Seen by both eyes from the default head pose, its settled looks (listening at its full voice ripple included)
   * clear the scene box, the toolbar, the inspector and the header; the bloom's brief overshoot reaches a little into
   * the scene box's empty lower margin, never onto stage content (labels, objects), the toolbar, the inspector or the
   * header; it lies behind the popovers' plane, so an open picker or More covers part of it (never the reverse). Its
   * whole extent (the soft glow at the bloom's start included) stays below the scene box. */
  orb: { x: 0, y: -0.55, z: 0.04, scale: 2.78 },
  /** "Hold A to talk" above the orb (bench-local, centred over it: `y` its vertical centre, set a little behind the
   * orb so the label clears the orb's top as the default eye sees it; `tilt` turns it toward that eye). Shown only
   * while the orb is idle, hold-to-talk is usable and no popover is open (an open picker or More would cover part of
   * it); it fades in over `fadeIn` and out over `fadeOut` (at once under reduced motion), so it never covers the
   * listening ripple or the bloom. Not pickable. */
  orbHint: { y: -0.36, z: 0, tilt: -0.7, fadeIn: 0.35, fadeOut: 0.15 },
  /** While the assistant inspector is open the toolbar sits at ONE place, `drop` below and `forward` nearer the viewer
   * than its standard place (for every experiment: the context panel is hidden then, so the step a tall context panel
   * gives it does not apply): clear of the orb's bloom, fully in view (its lowest edge about 41 degrees below the view
   * axis of a 90-degree eye) and pointable from the default head pose. It moves only when the inspector opens or
   * closes, eased over `seconds` (instant under reduced motion); its hits, highlight and tooltips follow. */
  lowered: { drop: 0.11, forward: 0.11, seconds: 0.4 },
  /** While the assistant inspector is open the context panel (the experiment's actions and its status line) is hidden:
   * it fades out over `seconds` when the inspector opens and back in when it closes, and it is not pickable from the
   * moment it starts fading out until it starts fading back in. It never moves. */
  contextFade: { seconds: 0.3 },
} as const

/** Font sizes (em, metres). Buttons and status are at least 17.5 mm (Quest 3S: 19.5 mm captions comfortable). */
export const SPATIAL_TYPE = {
  question: 0.032, subtitle: 0.02, button: 0.0185, status: 0.0175, title: 0.0175, card: 0.026, cardWord: 0.0175,
  primary: 0.02, secondary: 0.017, hint: 0.017, detail: 0.0158, small: 0.0138, inspectorTitle: 0.025, formula: 0.021,
} as const

const C = {
  text: '#e9edf5', strong: '#f4f6fb', sub: '#a9b6d6', dim: '#b0b8c8', faint: '#8a94a8',
  gold: '#ffc95c', goldInk: '#1d1505', teal: '#4fd1c5', rose: '#ff8fa3', amber: '#ffb86b', blue: '#9fcbff', violet: '#c9b8ff',
  line: 'rgba(160, 178, 214, 0.18)', lineStrong: 'rgba(160, 178, 214, 0.34)', card: 'rgba(255, 255, 255, 0.04)',
}

const TB_ICONS: Record<string, IconName> = { experiments: 'grid', assistant: 'chat', play: 'play', replay: 'replay', undo: 'undo', more: 'more' }
const MORE_ICONS: Record<string, IconName> = { save: 'save', reopen: 'reopen', exitSession: 'exit', enableVoice: 'mic', saveRepresentation: 'layers' }
const PHASE_COLOR = { ready: '#7e89a3', animating: C.teal, paused: C.amber, result: C.gold } as const
const EVIDENCE_STATUS: Record<EvidenceItem['status'], [string, string]> = {
  computed: ['Computed', C.blue], not_sent: ['Not checked', C.faint], checking: ['Checking…', C.amber], checked: ['Checked', C.teal],
  not_established: ['Not established', C.amber], error: ['Error', C.rose],
}
const PROV_COLOR: Record<string, string> = { 'computed exactly': C.blue, 'checked by supported rewrite rules': C.violet, 'Lean receipt': C.teal, presentation: C.faint }

const PAD = 0.016
const CHECK = 'M5.5 12.5l4.2 4.2L18.5 7.8'

/** Ease in and out (cubic), t in [0, 1]. */
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** Hold-to-talk is usable now: the assistant's own XR Talk is idle and enabled (it shows "or hold A or X to talk"). */
function holdToTalkReady(v: UiView): boolean {
  try {
    return assistantView(v.assistant).voice.holdHint !== null
  } catch {
    return false // the hint is optional: a failing view never breaks the shell
  }
}

interface FormulaPlace {
  slot: TextSlot
  x: number
  y: number
  maxW: number
  lastW: number
  used: boolean
}

interface Block {
  height: number
  keepWithNext?: boolean
  draw(p: Painter, x: number, y: number, w: number, hits: HitRegion[], formulas: { tex: string; plain: string; x: number; y: number; maxW: number }[]): void
}

export interface SpatialShellOptions {
  dispatch: UiDispatch
  assistant: SpatialPanelContent
  /** The Ask Meta Muse AI glyph orb's state source (src/ui/orb/source.ts); no orb without it. */
  orb?: OrbSource | null
}

export class SpatialShell {
  readonly root = new Group()
  private readonly dispatch: UiDispatch
  private readonly assistant: SpatialPanelContent
  private readonly header = new CanvasPanel('shell:header')
  private readonly context = new CanvasPanel('shell:context')
  private readonly toolbar = new CanvasPanel('shell:toolbar')
  private readonly picker = new CanvasPanel('shell:picker')
  private readonly more = new CanvasPanel('shell:more')
  private readonly frame = new CanvasPanel('shell:inspector')
  private readonly tooltip = new CanvasPanel('shell:tooltip')
  /** "Hold A to talk" above the orb (SPATIAL_LAYOUT.orbHint); only with the orb. */
  private readonly orbHint = new CanvasPanel('shell:orb-hint')
  private readonly inspectorGroup = new Group()
  private readonly assistantGroup = new Group()
  private readonly overlay = new HoverOverlay()
  /** Front to back: popovers first (they are in front of everything else). */
  private readonly pickable: CanvasPanel[]
  private readonly formulas: FormulaPlace[] = []
  private view: UiView | null = null
  private visible = false
  private hoverId: string | null = null
  private mathPage = 0
  private mathPages = 1
  private mathKey = ''
  private mathDetailKey = ''
  private readonly hit = { x: 0, y: 0, distance: 0 }
  /** The assistant's glyph orb (shown with the assistant inspector) and its state source. */
  private readonly orb: XrOrb | null
  private readonly orbSource: OrbSource | null
  private readonly reducedMotion: { matches: boolean } | null
  /** Where the toolbar is between its normal place (0) and its place while the assistant inspector is open (1),
   * easing from `lowerFrom` to `lowerTo` (1 while the assistant inspector is open); `lowerT` is the ease's progress
   * (1: done). */
  private lowerAt = 0
  private lowerFrom = 0
  private lowerTo = 0
  private lowerT = 1
  /** The context panel's opacity (1: shown, 0: hidden while the assistant inspector is open), fading from
   * `fadeFrom` to `fadeTo`; `fadeT` is the fade's progress (1: done). */
  private fadeAt = 1
  private fadeFrom = 1
  private fadeTo = 1
  private fadeT = 1
  /** Whether hold-to-talk is usable now (the assistant's idle XR Talk; render() sets it) and the orb hint's opacity. */
  private holdReady = false
  private hintAt = 0
  private rendered = false
  /** The toolbar's group origin (its top-left corner, bench-local) in its normal place and while the assistant
   * inspector is open. */
  private readonly toolbarBase = new Vector3(0, SPATIAL_LAYOUT.toolbar.centerY, SPATIAL_LAYOUT.toolbar.z)
  private readonly toolbarOpen = new Vector3(0, SPATIAL_LAYOUT.toolbar.centerY - SPATIAL_LAYOUT.lowered.drop, SPATIAL_LAYOUT.toolbar.z)

  constructor(opts: SpatialShellOptions) {
    this.dispatch = opts.dispatch
    this.assistant = opts.assistant
    this.root.name = 'shell'
    this.inspectorGroup.name = 'shell:inspector-area'
    this.assistantGroup.name = 'shell:assistant-content'
    this.inspectorGroup.add(this.frame.group, this.assistantGroup)
    this.root.add(this.header.group, this.context.group, this.toolbar.group, this.picker.group, this.more.group, this.inspectorGroup)
    this.tooltip.mesh.renderOrder = -2
    this.pickable = [this.picker, this.more, this.frame, this.toolbar, this.context, this.header]
    const L = SPATIAL_LAYOUT
    this.header.group.position.set(L.header.left, L.header.top, L.header.z)
    this.header.group.rotation.x = L.header.tilt
    this.context.group.rotation.x = L.context.tilt
    this.toolbar.group.rotation.x = L.toolbar.tilt
    this.picker.group.rotation.x = L.popover.tilt
    this.more.group.rotation.x = L.popover.tilt
    this.inspectorGroup.position.set(L.inspector.left, L.inspector.top, L.inspector.z)
    this.inspectorGroup.rotation.y = L.inspector.yaw
    this.assistant.mount(this.assistantGroup)
    this.assistant.setVisible(false)
    this.orbSource = opts.orb ?? null
    let orb: XrOrb | null = null
    try {
      orb = this.orbSource ? new XrOrb() : null
    } catch {
      orb = null // the orb is optional: the shell never fails because of it
    }
    this.orb = orb
    if (orb) {
      orb.setPose(L.orb)
      orb.setVisible(false)
      this.root.add(orb.root)
      this.drawOrbHint()
      this.root.add(this.orbHint.group)
    }
    let mq: { matches: boolean } | null = null
    try {
      mq = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null
    } catch {
      mq = null
    }
    this.reducedMotion = mq
    this.root.visible = false
  }

  mount(parent: Object3D): void {
    parent.add(this.root)
  }

  setVisible(v: boolean): void {
    this.visible = v
    this.root.visible = v
    this.assistant.setVisible(v && this.view?.inspector === 'assistant')
    this.showOrb(v && this.view?.inspector === 'assistant')
    if (v) this.snapLayout() // shown (entering XR): the toolbar and context panel already as the open inspector has them
    if (!v) this.setHover(null)
  }

  render(view: UiView): void {
    this.view = view
    this.drawHeader(view)
    this.drawContext(view)
    this.drawToolbar(view)
    this.drawPicker(view)
    this.drawMore(view)
    this.drawInspector(view)
    this.layoutFor(view)
    this.assistant.render(view.assistant)
    this.holdReady = view.inspector === 'assistant' && !view.popover && holdToTalkReady(view)
    this.assistant.setVisible(this.visible && view.inspector === 'assistant')
    this.showOrb(this.visible && view.inspector === 'assistant')
    // Regions may have moved: re-place the highlight on the hovered entry (or drop it if it vanished).
    const h = this.hoverId
    this.hoverId = null
    this.setHover(h)
  }

  step(ctx: FrameContext): void {
    if (!this.visible) return
    if (this.lowerT < 1) this.stepLowered(ctx.dt)
    if (this.fadeT < 1) this.stepFade(ctx.dt)
    if (this.view?.inspector === 'assistant') this.assistant.step(ctx)
    if (this.orb?.visible) this.stepOrb(this.orb, ctx.dt)
    if (this.orb) this.stepOrbHint(this.orb, ctx.dt)
    for (let i = 0; i < this.formulas.length; i++) {
      const f = this.formulas[i]!
      if (!f.used) continue
      f.slot.frame(ctx.time)
      const w = f.slot.width
      if (w !== f.lastW) {
        f.lastW = w
        const s = w > f.maxW && w > 0 ? f.maxW / w : 1
        f.slot.anchor.scale.setScalar(s)
        f.slot.anchor.position.x = f.x + (w * s) / 2
      }
    }
  }

  pick(ray: Ray): SpatialPick | null {
    if (!this.visible || !this.view) return null
    let best: SpatialPick | null = null
    for (const panel of this.pickable) {
      if (!this.live(panel) || !panel.intersect(ray, this.hit)) continue
      if (best && this.hit.distance >= best.distance) continue
      const r = panel.hit(this.hit.x, this.hit.y)
      best = r ? regionPick(r, this.hit.distance) : { id: panel.name, distance: this.hit.distance, command: null }
    }
    if (this.view.inspector === 'assistant') {
      const a = this.assistant.pick(ray)
      // The assistant content sits just in front of the inspector frame.
      if (a && (!best || a.distance <= best.distance + 0.004)) best = a
    }
    // An open popover behaves like a menu: a press anywhere else closes it instead of reaching the scene.
    if (!best && this.view.popover) best = { id: 'shell:dismiss', distance: 1.5, command: CLOSE_POPOVER, hint: 'Close the menu' }
    return best
  }

  /** Activate a pick from this shell: the shell's own page turns, or its UiCommand through the shell's dispatch.
   * (Equivalent to `if (!shell.press(p.id) && p.command) dispatch(p.command)`.) */
  activate(pick: SpatialPick | null): void {
    if (!pick || this.press(pick.id)) return
    if (pick.command) this.dispatch(pick.command)
  }

  /** The shell's own presses that are not UiCommands (mathematics page turns). Returns true when handled. */
  press(id: string): boolean {
    if (id !== 'shell:math:prev' && id !== 'shell:math:next') return false
    const next = Math.max(0, Math.min(this.mathPages - 1, this.mathPage + (id === 'shell:math:next' ? 1 : -1)))
    if (next !== this.mathPage && this.view) {
      this.mathPage = next
      this.mathKey = ''
      this.drawInspector(this.view)
      const h = this.hoverId
      this.hoverId = null
      this.setHover(h)
    }
    return true
  }

  setHover(id: string | null): void {
    if (id === this.hoverId) return
    this.hoverId = id
    this.overlay.hide()
    this.tooltip.setShown(false)
    if (id && id.startsWith('shell:')) {
      this.assistant.setHover(null)
      for (const panel of this.pickable) {
        if (!this.live(panel)) continue
        const r = panel.findHit(id)
        if (!r) continue
        const teal = id === 'shell:tb:assistant' || (id === 'shell:close' && this.view?.inspector === 'assistant')
        this.overlay.show(panel, r, teal ? 0xbff5ef : 0xffffff)
        if (r.hint) this.showTooltip(panel, r)
        break
      }
    } else this.assistant.setHover(id)
  }

  dispose(): void {
    for (const p of [this.header, this.context, this.toolbar, this.picker, this.more, this.frame, this.tooltip, this.orbHint]) p.dispose()
    for (const f of this.formulas) f.slot.dispose()
    this.formulas.length = 0
    this.overlay.dispose()
    this.assistant.dispose()
    this.orb?.dispose()
    this.root.removeFromParent()
  }

  /**
   * Verification data: what each panel shows and where (bench-local), for tests and captures. `lowered`: the
   * toolbar's place (at 0: normal, 1: its place while the assistant inspector is open; to: where it is going;
   * moving). `context`: the context panel's fade (opacity 1: shown, 0: hidden; to; moving; pickable: false from the
   * moment it starts fading out until it starts fading back in). A panel's `shown` is false while it is hidden.
   */
  report() {
    const panels = [this.header, this.context, this.toolbar, this.picker, this.more, this.frame].map((p) => ({
      name: p.name, shown: p.shown, width: +p.width.toFixed(4), height: +p.height.toFixed(4), redraws: p.redraws, hits: p.hits.map((h) => ({ id: h.id, enabled: h.enabled })),
    }))
    const orb = this.orb ? this.orbReport(this.orb) : null
    return {
      visible: this.visible, panels, mathPage: this.mathPage, mathPages: this.mathPages, formulas: this.formulas.filter((f) => f.used).map((f) => f.slot.report()), orb,
      lowered: { at: +this.lowerAt.toFixed(4), to: this.lowerTo, moving: this.lowerT < 1 },
      context: { opacity: +this.fadeAt.toFixed(4), to: this.fadeTo, moving: this.fadeT < 1, pickable: this.fadeTo === 1 },
    }
  }

  /** A panel the controller can reach: shown, and (the context panel) not fading out or hidden for the assistant. */
  private live(panel: CanvasPanel): boolean {
    return panel.shown && (panel !== this.context || this.fadeTo === 1)
  }

  // ------------------------------------------------------------------ assistant orb (decorative and optional)

  /**
   * Show or hide the orb. Shown again (render() opening the assistant inspector runs after this frame's step), it
   * takes the current phase and bloom at once, so the very next frame draws them (never the look it had when it
   * was hidden). Its place never changes (SPATIAL_LAYOUT.orb).
   */
  private showOrb(show: boolean): void {
    const orb = this.orb
    const src = this.orbSource
    if (!orb) return
    if (!show) this.placeOrbHint(0) // hidden with the orb at once; shown again, it fades in once the orb is idle
    if (!show || orb.visible || !src) {
      orb.setVisible(show)
      return
    }
    try {
      orb.setVisible(true, src.phase(), src.bloom?.())
    } catch {
      orb.setVisible(true) // the orb is optional: a failing source never breaks the shell (it snaps on its next step)
    }
  }

  private stepOrb(orb: XrOrb, dt: number): void {
    const src = this.orbSource
    if (!src) return
    try {
      orb.step(dt, src.phase(), src.level(), !!this.reducedMotion?.matches, src.bloom?.())
    } catch {
      // The orb is optional: it never throws into the shell's frame.
    }
  }

  /** "Hold [A] to talk": the A in a ring like the controller's button. Drawn once (it never changes). */
  private drawOrbHint(): void {
    const L = SPATIAL_LAYOUT.orbHint
    const S = 0.023 // a little larger than a button label: it reads as a caption over the orb
    const m = this.orbHint.measurer
    const pad = 0.02
    const gap = 0.009
    const ring = S * 0.82
    const w1 = m.measure('Hold', S, 600)
    const w2 = m.measure('to talk', S, 600)
    const w = pad + w1 + gap + 2 * ring + gap + w2 + pad
    const h = 2 * ring + 0.02
    const p = this.orbHint.begin(w, h)
    this.orbHint.plate(p, { radius: h / 2 - 0.001, fill: 'rgba(8, 11, 18, 0.86)', border: 'rgba(160, 178, 214, 0.3)' })
    const cy = h / 2
    p.text('Hold', pad, cy, S, C.text, { weight: 600 })
    const cx = pad + w1 + gap + ring
    p.circle(cx, cy, ring, 'rgba(79, 209, 197, 0.14)', C.teal, 0.0016)
    p.text('A', cx, cy, S * 0.92, C.strong, { weight: 700, align: 'center' })
    p.text('to talk', cx + ring + gap, cy, S, C.text, { weight: 600 })
    this.orbHint.end()
    this.orbHint.group.position.set(SPATIAL_LAYOUT.orb.x - w / 2, L.y + h / 2, L.z)
    this.orbHint.group.rotation.x = L.tilt
    this.placeOrbHint(0)
  }

  /** Fades the hint toward shown (the orb idle and hold-to-talk usable) or hidden; at once under reduced motion. */
  private stepOrbHint(orb: XrOrb, dt: number): void {
    const want = orb.visible && this.holdReady && orb.phase === 'idle' ? 1 : 0
    if (this.hintAt === want) return
    if (this.reducedMotion?.matches) {
      this.placeOrbHint(want)
      return
    }
    const L = SPATIAL_LAYOUT.orbHint
    const d = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0))
    const a = want > this.hintAt ? Math.min(1, this.hintAt + d / L.fadeIn) : Math.max(0, this.hintAt - d / L.fadeOut)
    this.placeOrbHint(a)
  }

  /** The hint at opacity `a` (not drawn at 0; while fading it writes no depth, like the context panel's fade). */
  private placeOrbHint(a: number): void {
    this.hintAt = a
    const mat = this.orbHint.mesh.material as Material
    mat.opacity = a
    mat.depthWrite = a >= 1
    this.orbHint.setShown(a > 0)
  }

  private orbReport(orb: XrOrb) {
    const p = orb.root.getWorldPosition(new Vector3())
    const s = orb.root.getWorldScale(new Vector3())
    // The glyph sphere's diameter (world metres) in the idle look and at the bloom's start.
    const across = { idle: +(2 * XR_ORB.radius * s.x).toFixed(4), bloomStart: +(2 * XR_ORB.radius * BLOOM_START_RADIUS * s.x).toFixed(4) }
    const hint = { shown: this.orbHint.shown, opacity: +this.hintAt.toFixed(4) }
    return { visible: orb.visible, phase: orb.phase, place: 'front' as const, position: p.toArray().map((c) => +c.toFixed(4)), scale: +s.x.toFixed(4), across, hint }
  }

  // ------------------------------------------------------------------ the orb's room: context hidden, toolbar lower

  /** The open inspector decides the bottom of the view: while it is the assistant the context panel is hidden (a
   * fade) and the toolbar sits at its lower place (an ease). The first view and a hidden shell take both at once;
   * otherwise they ease (the toolbar at once under reduced motion; the fade, which does not move, stays). */
  private layoutFor(v: UiView): void {
    const open = v.inspector === 'assistant'
    const to = open ? 1 : 0
    if (to !== this.lowerTo) {
      this.lowerFrom = this.lowerAt
      this.lowerTo = to
      this.lowerT = 0
    }
    const fade = open ? 0 : 1
    if (fade !== this.fadeTo) {
      this.fadeFrom = this.fadeAt
      this.fadeTo = fade
      this.fadeT = 0
    }
    if (!this.rendered || !this.visible) {
      this.rendered = true
      this.snapLayout()
      return
    }
    if (this.reducedMotion?.matches) this.snapLowered()
    else this.placeLowered()
    this.applyFade()
  }

  private snapLayout(): void {
    this.snapLowered()
    this.fadeAt = this.fadeFrom = this.fadeTo
    this.fadeT = 1
    this.applyFade()
  }

  private snapLowered(): void {
    this.lowerAt = this.lowerFrom = this.lowerTo
    this.lowerT = 1
    this.placeLowered()
  }

  private stepLowered(dt: number): void {
    if (this.reducedMotion?.matches) {
      this.snapLowered()
      return
    }
    const d = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0))
    this.lowerT = Math.min(1, this.lowerT + d / SPATIAL_LAYOUT.lowered.seconds)
    this.lowerAt = this.lowerFrom + (this.lowerTo - this.lowerFrom) * easeInOut(this.lowerT)
    this.placeLowered()
  }

  private stepFade(dt: number): void {
    const d = Math.min(0.1, Math.max(0, Number.isFinite(dt) ? dt : 0))
    this.fadeT = Math.min(1, this.fadeT + d / SPATIAL_LAYOUT.contextFade.seconds)
    this.fadeAt = this.fadeFrom + (this.fadeTo - this.fadeFrom) * easeInOut(this.fadeT)
    this.applyFade()
  }

  /** The toolbar between its normal place and its place while the assistant is open, `lowerAt` of the way (its
   * hits, highlight and tooltips follow). */
  private placeLowered(): void {
    this.toolbar.group.position.lerpVectors(this.toolbarBase, this.toolbarOpen, this.lowerAt)
  }

  /** The context panel at `fadeAt` opacity: not drawn at all once hidden (shown again, and pickable, from the start
   * of its fade-in). While fading it writes no depth, so it never cuts the orb (drawn after it) out by depth; shown
   * fully it writes depth again like every plate. */
  private applyFade(): void {
    const a = this.fadeAt
    const mat = this.context.mesh.material as Material
    mat.opacity = a
    mat.depthWrite = a >= 1
    this.context.setShown(a > 0 || this.fadeTo === 1)
  }

  // ------------------------------------------------------------------ regions

  private drawHeader(v: UiView): void {
    const key = JSON.stringify([v.experiment.question, v.experiment.subtitle.plain])
    this.header.setShown(true)
    if (key === this.header.key) return
    this.header.key = key
    const T = SPATIAL_TYPE
    const m = this.header.measurer
    const inner = SPATIAL_LAYOUT.header.maxWidth - 2 * PAD
    const lines = m.wrap(v.experiment.question, inner, T.question, 600)
    const lh = T.question * 1.2
    const qw = Math.max(...lines.map((l) => m.measure(l, T.question, 600)))
    const sw = v.experiment.subtitle.plain ? m.measure(v.experiment.subtitle.plain, T.subtitle) : 0
    const w = Math.max(qw, sw) + 2 * PAD + 0.006
    const h = PAD + lines.length * lh + (sw ? 0.008 + T.subtitle * 1.3 : 0) + PAD
    const p = this.header.begin(w, h)
    this.header.plate(p, { fill: 'rgba(13, 17, 27, 0.86)', border: 'rgba(160, 178, 214, 0.14)' })
    lines.forEach((l, i) => p.text(l, PAD + 0.003, PAD + lh * (i + 0.5), T.question, C.strong, { weight: 600 }))
    if (sw) p.text(v.experiment.subtitle.plain, PAD + 0.003, PAD + lines.length * lh + 0.008 + T.subtitle * 0.65, T.subtitle, C.sub)
    this.header.end()
  }

  private drawToolbar(v: UiView): void {
    const key = JSON.stringify([v.toolbar, v.popover, this.contextBottom])
    this.toolbar.setShown(true)
    if (key === this.toolbar.key) return
    this.toolbar.key = key
    const T = SPATIAL_TYPE
    const m = this.toolbar.measurer
    const BH = 0.048
    const ICON = 0.021
    const GAP = 0.006
    const SEP = 0.014
    type Btn = { item: ToolbarItem; w: number }
    const rows: Btn[][] = TOOLBAR_ROWS.map((ids) =>
      ids.flatMap((id) => {
        const item = v.toolbar.find((t) => t.id === id)
        if (!item) return []
        const label = m.measure(toolbarWidestLabel(item), T.button, 500)
        const w = 0.017 + ICON + 0.009 + label + (id === 'experiments' ? 0.02 : 0) + 0.017
        return [{ item, w }]
      }),
    )
    const rowW = rows.map((r) => r.reduce((a, b) => a + b.w, 0) + GAP * Math.max(0, r.length - 1) + (r.some((b) => b.item.id === 'more') ? SEP : 0))
    const w = Math.max(...rowW) + 2 * 0.011
    const h = 0.011 * 2 + rows.length * BH + (rows.length - 1) * 0.008
    const p = this.toolbar.begin(w, h)
    this.toolbar.plate(p, { radius: 0.022 })
    rows.forEach((row, ri) => {
      let x = (w - rowW[ri]!) / 2
      const y = 0.011 + ri * (BH + 0.008)
      if (ri > 0) p.line(0.02, y - 0.004, w - 0.02, y - 0.004, C.line, 0.0008)
      for (const b of row) {
        const it = b.item
        if (it.id === 'more') {
          p.line(x + SEP / 2 - GAP / 2, y + 0.012, x + SEP / 2 - GAP / 2, y + BH - 0.012, C.lineStrong, 0.0009)
          x += SEP
        }
        const assistant = it.id === 'assistant'
        if (it.active && assistant) p.rrect(x, y, b.w, BH, 0.014, 'rgba(79, 209, 197, 0.16)', 'rgba(79, 209, 197, 0.7)', 0.0013)
        else if (it.active) p.rrect(x, y, b.w, BH, 0.014, 'rgba(255, 255, 255, 0.09)', C.lineStrong, 0.001)
        const fg = !it.enabled ? C.faint : assistant && it.active ? '#e4fbf8' : C.text
        const ic = !it.enabled ? C.faint : assistant ? C.teal : C.sub
        const icon: IconName = it.id === 'play' && it.label === 'Pause' ? 'pause' : TB_ICONS[it.id]!
        p.ctx.globalAlpha = it.enabled ? 1 : 0.7
        p.icon(icon, x + 0.017, y + (BH - ICON) / 2, ICON, ic)
        p.text(it.label, x + 0.017 + ICON + 0.009, y + BH / 2, T.button, fg, { weight: 500 })
        if (it.id === 'experiments') p.icon('chevronDown', x + b.w - 0.017 - 0.016, y + (BH - 0.016) / 2, 0.016, C.faint, 2)
        p.ctx.globalAlpha = 1
        this.toolbar.hits.push({
          id: `shell:tb:${it.id}`, x, y, w: b.w, h: BH, r: 0.014, enabled: it.enabled, command: toolbarCommand(v, it),
          hint: !it.enabled ? it.reason ?? 'Not available right now' : toolbarDescription(it) ?? undefined,
        })
        x += b.w + GAP
      }
    })
    this.toolbar.end()
    const L = SPATIAL_LAYOUT.toolbar
    // Group origin = top-left corner. The toolbar stays at its fixed place; only if an unusually tall context
    // panel would reach it does it step down (and forward along its tilt) to keep clear. While the assistant is
    // open the context panel is hidden and the toolbar has ONE place, lowered.drop below and lowered.forward
    // nearer than its standard place, whatever the context panel's height.
    const stdTop = L.centerY + (h / 2) * Math.cos(L.tilt)
    const stdZ = L.z + (h / 2) * Math.sin(L.tilt)
    const topY = Math.min(stdTop, this.contextBottom - L.clearance)
    const drop = stdTop - topY
    this.toolbarBase.set(-w / 2, topY, stdZ + drop * 0.5)
    this.toolbarOpen.set(-w / 2, stdTop - SPATIAL_LAYOUT.lowered.drop, stdZ + SPATIAL_LAYOUT.lowered.forward)
    this.placeLowered()
  }

  /** Bench y of the context panel's lowest point (the toolbar keeps clear of it). */
  private contextBottom: number = SPATIAL_LAYOUT.context.top
  /** The context panel's left edge, latched per experiment (bench x). */
  private contextLeft: { kind: string; x: number } | null = null

  /**
   * Context actions with the status line in the panel's top row (title left; phase dot, status and Show/Hide
   * mathematics right), then the action rows and the next-step hint. One row of actions fits up to 1.1 m; if not,
   * compact sizes are tried before a second row. Its top edge stays just below the scene box; it never moves, and
   * while the assistant inspector is open it is hidden (applyFade; still drawn here, ready to fade back in).
   * Centred when an experiment opens; after that its left edge stays put (within +-0.55 m), so appended items and a
   * longer status extend it to the right and a still controller ray stays on the same action.
   */
  private drawContext(v: UiView): void {
    const ctx = v.presentation.context
    const st = v.presentation.status
    const key = JSON.stringify([ctx, st, v.inspector === 'math'])
    if (key === this.context.key) return
    this.context.key = key
    const T = SPATIAL_TYPE
    const L = SPATIAL_LAYOUT.context
    const m = this.context.measurer
    const maxInner = L.maxWidth - 2 * PAD

    type Cell = { item: ContextItem; w: number; h: number; group: number; label?: string; x: number; row: number }
    const flow = (compact: boolean) => {
      const S = compact
        ? { IH: 0.048, SH: 0.04, card: 0.022, word: 0.016, primary: 0.0178, secondary: 0.016 }
        : { IH: 0.056, SH: 0.046, card: 0.025, word: 0.0172, primary: 0.0195, secondary: 0.0168 }
      const cells: Cell[] = []
      ctx.groups.forEach((g, gi) => {
        g.items.forEach((it, ii) => {
          const short = it.role === 'choice' && isShortChoice(it.label.plain)
          let w: number
          let h = S.IH
          if (it.role === 'choice') w = Math.max(S.IH, m.measure(it.label.plain, short ? S.card : S.word, short ? 400 : 500, short ? MATH_FONT : undefined) + 0.032)
          else if (it.role === 'primary') w = 0.026 + m.measure(it.label.plain, S.primary, 650) + 0.014 + 0.02 + 0.022
          else {
            h = S.SH
            w = 0.03 + m.measure(it.label.plain, S.secondary, 500) + (it.role === 'toggle' ? 0.022 : 0)
          }
          cells.push({ item: it, w, h, group: gi, label: ii === 0 ? g.label : undefined, x: 0, row: 0 })
        })
      })
      const groupW = (gi: number) => cells.filter((c) => c.group === gi).reduce((a, c, i) => a + c.w + (i ? 0.01 : 0), 0)
      let x = 0
      let row = 0
      const widths: number[] = [0]
      let last = -1
      for (const c of cells) {
        const starts = c.group !== last
        const gap = x === 0 ? 0 : starts ? 0.022 : 0.01
        const need = starts ? Math.min(groupW(c.group), maxInner) : c.w
        if (x > 0 && x + gap + need > maxInner) {
          widths[++row] = 0
          x = 0
        } else x += gap
        c.x = x
        c.row = row
        x += c.w
        widths[row] = x
        last = c.group
      }
      return { S, cells, rows: cells.length ? row + 1 : 0, itemsW: Math.max(0, ...widths) }
    }
    let lay = flow(false)
    if (lay.rows > 1) {
      const compact = flow(true)
      if (compact.rows < lay.rows) lay = compact
    }
    const { S, cells, rows } = lay
    const LABEL_H = 0.022
    const rowHasLabel = Array.from({ length: rows }, (_, r) => cells.some((c) => c.row === r && c.label))

    // Top row: title, then status (wrapped if long) and the Show/Hide mathematics toggle at the right.
    const toggleLabel = mathToggleLabel(v)
    const toggleW = 0.012 + m.measure(toggleLabel, T.status, 500) + 0.006 + 0.016 + 0.006
    const titleW = ctx.title ? m.measure(ctx.title, T.title, 500) : 0
    const statusW = 0.024 + m.measure(st.text, T.status)
    const hintW = ctx.hint ? 0.026 + m.measure(ctx.hint, T.hint, 500) : 0
    const topNeed = (titleW ? titleW + 0.03 : 0) + statusW + 0.026 + toggleW
    const inner = Math.min(maxInner, Math.max(L.minWidth - 2 * PAD, lay.itemsW, hintW, topNeed))
    // A long title takes its own line; the status keeps at least 0.24 m beside the toggle.
    const split = !!titleW && inner - titleW - 0.03 - 0.026 - toggleW - 0.024 < 0.24
    const statusAvail = inner - (titleW && !split ? titleW + 0.03 : 0) - 0.026 - toggleW - 0.024
    const statusLines = m.wrap(st.text, statusAvail, T.status)
    const sl = T.status * 1.35
    const statusBlockH = Math.max(0.034, statusLines.length * sl + 0.01)
    const titleLineH = 0.03
    const topH = split ? titleLineH + statusBlockH : statusBlockH
    const hintLines = ctx.hint ? m.wrap(ctx.hint, inner - 0.026, T.hint, 500) : []

    let y = PAD * 0.75
    const topY = y
    y += topH
    const hasBody = rows > 0 || hintLines.length > 0
    const dividerY = hasBody ? y + 0.004 : -1
    if (hasBody) y += 0.012
    const rowY: number[] = []
    for (let r = 0; r < rows; r++) {
      if (rowHasLabel[r]) y += LABEL_H
      rowY.push(y)
      y += S.IH + (r < rows - 1 ? 0.01 : 0)
    }
    if (rows && hintLines.length) y += 0.01
    const hintY = y
    if (hintLines.length) y += hintLines.length * T.hint * 1.4
    y += PAD * 0.75
    const w = inner + 2 * PAD
    const h = y

    const p = this.context.begin(w, h)
    this.context.plate(p, { radius: 0.02 })
    // Title (or nothing) at the left of the top row.
    if (ctx.title) p.text(ctx.title, PAD + 0.002, topY + (split ? titleLineH : statusBlockH) / 2, T.title, C.dim, { weight: 500 })
    const sTop = split ? topY + titleLineH : topY
    const sMid = sTop + statusBlockH / 2
    const toggleX = w - PAD - toggleW
    const blockW = 0.024 + Math.max(...statusLines.map((l) => m.measure(l, T.status)))
    const sx = split || !titleW ? PAD : Math.max(PAD + titleW + 0.03, toggleX - 0.026 - blockW)
    const color = PHASE_COLOR[st.phase]
    p.circle(sx + 0.008, sMid, 0.0098, color === PHASE_COLOR.ready ? 'rgba(126, 137, 163, 0.2)' : `${color}33`)
    p.circle(sx + 0.008, sMid, 0.0058, st.tone === 'error' ? C.rose : color)
    const textColor = st.tone === 'error' ? C.rose : st.tone === 'warning' ? C.amber : C.dim
    statusLines.forEach((l, i) => p.text(l, sx + 0.024, sMid + (i - (statusLines.length - 1) / 2) * sl, T.status, textColor))
    p.line(toggleX - 0.013, sMid - 0.012, toggleX - 0.013, sMid + 0.012, C.lineStrong, 0.0009)
    const open = v.inspector === 'math'
    p.text(toggleLabel, toggleX + 0.012, sMid, T.status, open ? C.text : C.dim, { weight: 500 })
    p.icon('chevronRight', toggleX + toggleW - 0.006 - 0.016, sMid - 0.008, 0.016, open ? C.text : C.dim, 2)
    this.context.hits.push({ id: 'shell:math', x: toggleX, y: sMid - 0.02, w: toggleW, h: 0.04, r: 0.01, enabled: true, command: TOGGLE_MATH })
    if (dividerY > 0) p.line(PAD, dividerY, w - PAD, dividerY, C.line, 0.0008)

    for (const c of cells) {
      const it = c.item
      const cx = PAD + c.x
      const top = rowY[c.row]! + (S.IH - c.h) / 2
      if (c.label) p.text(c.label.toUpperCase(), cx + 0.002, rowY[c.row]! - LABEL_H / 2, 0.0126, C.faint, { weight: 600 })
      p.ctx.globalAlpha = it.enabled ? 1 : 0.5
      if (it.role === 'choice') {
        const sel = !!it.selected
        p.rrect(cx, top, c.w, c.h, 0.013, sel ? 'rgba(255, 201, 92, 0.08)' : C.card, sel ? C.gold : C.lineStrong, sel ? 0.0024 : 0.0011)
        const short = isShortChoice(it.label.plain)
        p.text(it.label.plain, cx + c.w / 2, top + c.h / 2 + (short ? 0.001 : 0), short ? S.card : S.word, C.text, { align: 'center', weight: short ? 400 : 500, family: short ? MATH_FONT : undefined })
        if (sel) {
          p.ctx.globalAlpha = 1
          p.circle(cx + c.w - 0.002, top + 0.002, 0.0105, C.gold, '#131927', 0.0026)
          p.icon(CHECK, cx + c.w - 0.002 - 0.0075, top + 0.002 - 0.0075, 0.015, C.goldInk, 3)
        }
      } else if (it.role === 'primary') {
        const g = p.ctx.createLinearGradient(0, top * PX, 0, (top + c.h) * PX)
        g.addColorStop(0, it.enabled ? '#ffd77a' : 'rgba(255, 201, 92, 0.16)')
        g.addColorStop(1, it.enabled ? '#f4b843' : 'rgba(255, 201, 92, 0.16)')
        p.rrect(cx, top, c.w, c.h, 0.013, null)
        p.ctx.fillStyle = g
        p.ctx.fill()
        const ink = it.enabled ? C.goldInk : 'rgba(255, 228, 175, 0.75)'
        p.text(it.label.plain, cx + 0.026, top + c.h / 2, S.primary, ink, { weight: 650 })
        p.icon('arrowRight', cx + c.w - 0.022 - 0.02, top + (c.h - 0.02) / 2, 0.02, ink, 2.2)
      } else {
        const on = it.role === 'toggle' && !!it.selected
        p.rrect(cx, top, c.w, c.h, 0.012, on ? 'rgba(255, 201, 92, 0.07)' : 'rgba(255, 255, 255, 0.015)', on ? 'rgba(255, 201, 92, 0.6)' : C.lineStrong, 0.0011)
        let tx = cx + 0.015
        if (it.role === 'toggle') {
          if (on) p.icon('check', tx - 0.002, top + (c.h - 0.018) / 2, 0.018, C.gold, 2.4)
          tx += 0.022
        }
        p.text(it.label.plain, tx, top + c.h / 2, S.secondary, on ? C.text : C.dim, { weight: 500 })
      }
      p.ctx.globalAlpha = 1
      this.context.hits.push({
        id: `shell:ctx:${it.id}`, x: cx, y: top, w: c.w, h: c.h, r: 0.013, enabled: it.enabled, command: contextCommand(it),
        hint: !it.enabled ? it.reason ?? 'Not available right now' : it.hint,
      })
    }
    hintLines.forEach((l, i) => {
      const ly = hintY + T.hint * 1.4 * (i + 0.5)
      if (i === 0) p.icon('info', PAD, ly - 0.009, 0.018, C.gold)
      p.text(l, PAD + 0.026, ly, T.hint, C.text, { weight: 500 })
    })
    this.context.end()
    const half = L.maxWidth / 2
    const latched = this.contextLeft?.kind === v.experiment.kind ? this.contextLeft.x : -w / 2
    const left = Math.max(-half, Math.min(latched, half - w))
    this.contextLeft = { kind: v.experiment.kind, x: left }
    this.context.group.position.set(left, L.top, L.z)
    this.contextBottom = L.top - h * Math.cos(L.tilt)
  }

  private drawPicker(v: UiView): void {
    const open = v.popover === 'experiments'
    this.picker.setShown(open)
    if (!open) return
    const key = JSON.stringify(v.experiments)
    if (key === this.picker.key) return
    this.picker.key = key
    const m = this.picker.measurer
    const COLS = 3
    const CW = 0.214
    const GAP = 0.01
    const ICON = 0.034
    const textW = CW - 0.014 - ICON - 0.012 - 0.012
    const QS = 0.0165
    const TS = 0.0136
    const laid = v.experiments.map((e) => ({ e, q: m.wrap(e.title, textW, QS, 600), t: m.wrap(e.topic, textW, TS) }))
    const CH = Math.max(...laid.map((l) => 0.014 + l.q.length * QS * 1.25 + 0.006 + l.t.length * TS * 1.3 + 0.014), 0.08)
    // Fields in order, packed into rows of COLS cards (a field that does not fit starts the next row), each under
    // its own heading, so short fields share a row.
    const FS = 0.0118
    const FH = 0.024
    const rows: { field: string; items: typeof laid; col: number }[][] = [[]]
    let used = 0
    for (const g of fieldGroups(laid.map((l) => ({ ...l, field: l.e.field })))) {
      if (used > 0 && used + g.items.length > COLS) {
        rows.push([])
        used = 0
      }
      rows[rows.length - 1]!.push({ field: g.field, items: g.items, col: used })
      used += g.items.length
    }
    const titleH = 0.034
    const w = 2 * PAD + COLS * CW + (COLS - 1) * GAP
    const h = PAD + titleH + rows.length * (FH + CH) + (rows.length - 1) * GAP + PAD
    const p = this.picker.begin(w, h)
    this.picker.plate(p, { radius: 0.02, fill: 'rgb(14, 19, 30)' })
    p.text('EXPERIMENTS', PAD + 0.003, PAD + 0.011, 0.0132, C.faint, { weight: 600 })
    const cards: { l: (typeof laid)[number]; x: number; y: number }[] = []
    rows.forEach((row, r) => {
      const top = PAD + titleH + r * (FH + CH + GAP)
      for (const g of row) {
        const gx = PAD + g.col * (CW + GAP)
        p.text(g.field.toUpperCase(), gx + 0.004, top + FH * 0.42, FS, C.sub, { weight: 600 })
        g.items.forEach((l, i) => cards.push({ l, x: gx + i * (CW + GAP), y: top + FH }))
      }
    })
    cards.forEach(({ l, x, y }) => {
      const sel = l.e.selected
      p.rrect(x, y, CW, CH, 0.014, sel ? 'rgba(255, 201, 92, 0.07)' : C.card, sel ? C.gold : C.line, sel ? 0.0024 : 0.0011)
      p.rrect(x + 0.012, y + 0.014, ICON, ICON, 0.009, sel ? 'rgba(255, 201, 92, 0.12)' : 'rgba(255, 255, 255, 0.05)')
      p.icon(EXPERIMENT_ICONS[l.e.kind as DemoKind], x + 0.012 + 0.006, y + 0.014 + 0.006, ICON - 0.012, sel ? C.gold : C.sub, 1.7)
      const tx = x + 0.012 + ICON + 0.012
      let ty = y + 0.014 + QS * 0.62
      for (const q of l.q) {
        p.text(q, tx, ty, QS, C.strong, { weight: 600 })
        ty += QS * 1.25
      }
      ty += 0.006 - QS * 0.62 + TS * 0.65
      for (const t of l.t) {
        p.text(t, tx, ty, TS, C.dim)
        ty += TS * 1.3
      }
      if (sel) {
        p.circle(x + CW - 0.003, y + 0.003, 0.0105, C.gold, '#131927', 0.0026)
        p.icon(CHECK, x + CW - 0.003 - 0.0075, y + 0.003 - 0.0075, 0.015, C.goldInk, 3)
      }
      const cmd: UiCommand = sel ? CLOSE_POPOVER : { kind: 'experiment', demo: l.e.kind }
      this.picker.hits.push({ id: `shell:pick:${l.e.kind}`, x, y, w: CW, h: CH, r: 0.014, enabled: true, command: cmd, hint: sel ? 'Current experiment' : undefined })
    })
    this.picker.end()
    this.placePopover(this.picker, SPATIAL_LAYOUT.popover.pickerX)
  }

  private drawMore(v: UiView): void {
    const open = v.popover === 'more'
    this.more.setShown(open)
    if (!open) return
    const sections = moreSections(v.more, 'xr')
    const key = JSON.stringify([sections, v.more.notice])
    if (key === this.more.key) return
    this.more.key = key
    const m = this.more.measurer
    const COLW = 0.29
    const GAP = 0.016
    const LS = 0.0168
    const HS = 0.0132
    const textW = COLW - 0.012 - 0.022 - 0.012 - 0.01
    type Row = { item: MoreItem; helper: string[]; h: number }
    const secs = sections.map((s) => {
      const rows: Row[] = s.items.map((it) => {
        const helperText = !it.enabled && it.reason ? it.reason : it.helper ?? ''
        const helper = helperText ? m.wrap(helperText, textW, HS) : []
        return { item: it, helper, h: 0.012 + LS * 1.25 + (helper.length ? 0.004 + helper.length * HS * 1.32 : 0) + 0.012 }
      })
      return { title: s.title, rows, h: 0.028 + rows.reduce((a, r) => a + r.h, 0) }
    })
    // Two balanced columns (each section stays whole).
    const cols: (typeof secs)[] = [[], []]
    const colH = [0, 0]
    for (const s of secs) {
      const c = colH[0]! <= colH[1]! ? 0 : 1
      cols[c]!.push(s)
      colH[c] = colH[c]! + s.h + (cols[c]!.length > 1 ? 0.012 : 0)
    }
    const ncols = cols[1]!.length ? 2 : 1
    const w = 2 * PAD + ncols * COLW + (ncols - 1) * GAP
    const noticeLines = v.more.notice ? m.wrap(v.more.notice.text, w - 2 * PAD - 0.02, HS) : []
    const noticeH = noticeLines.length ? 0.012 + noticeLines.length * HS * 1.35 + 0.012 : 0
    const h = PAD + Math.max(colH[0]!, colH[1]!) + (noticeH ? 0.012 + noticeH : 0) + PAD
    const p = this.more.begin(w, h)
    this.more.plate(p, { radius: 0.02, fill: 'rgb(14, 19, 30)' })
    cols.forEach((col, ci) => {
      const x = PAD + ci * (COLW + GAP)
      let y = PAD
      col.forEach((s, si) => {
        if (si > 0) {
          p.line(x + 0.006, y + 0.004, x + COLW - 0.006, y + 0.004, C.line, 0.0008)
          y += 0.012
        }
        p.text(s.title.toUpperCase(), x + 0.008, y + 0.012, 0.0128, C.faint, { weight: 600 })
        y += 0.028
        for (const r of s.rows) {
          const it = r.item
          const icon: IconName = it.id.startsWith('reset:') ? 'reset' : MORE_ICONS[it.id] ?? 'chevronRight'
          const fg = it.enabled ? C.text : C.faint
          p.icon(icon, x + 0.012, y + 0.012 + (LS * 1.25 - 0.022) / 2, 0.022, it.enabled ? C.sub : C.faint)
          p.text(it.label, x + 0.012 + 0.022 + 0.012, y + 0.012 + LS * 0.62, LS, fg, { weight: 500 })
          r.helper.forEach((l, i) => p.text(l, x + 0.046, y + 0.012 + LS * 1.25 + 0.004 + HS * 1.32 * (i + 0.5), HS, it.enabled ? C.dim : C.faint))
          this.more.hits.push({ id: `shell:more:${it.id}`, x, y, w: COLW, h: r.h, r: 0.011, enabled: it.enabled, command: moreCommand(it), hint: !it.enabled ? it.reason ?? 'Not available right now' : undefined })
          y += r.h
        }
        y += 0
      })
    })
    if (noticeH) {
      const ny = h - PAD - noticeH
      const err = v.more.notice!.tone === 'error'
      p.rrect(PAD, ny, w - 2 * PAD, noticeH, 0.01, err ? 'rgba(255, 143, 163, 0.08)' : 'rgba(255, 255, 255, 0.04)', err ? 'rgba(255, 143, 163, 0.4)' : C.line, 0.001)
      noticeLines.forEach((l, i) => p.text(l, PAD + 0.01, ny + 0.012 + HS * 1.35 * (i + 0.5), HS, err ? C.rose : C.dim))
    }
    this.more.end()
    this.placePopover(this.more, SPATIAL_LAYOUT.popover.moreX)
  }

  /** In front of the lower stage, its bottom edge above the toolbar's line of sight; clamped sideways. */
  private placePopover(panel: CanvasPanel, cx: number): void {
    const L = SPATIAL_LAYOUT.popover
    const half = panel.height / 2
    const cy = Math.max(L.centerY, L.bottom + half * Math.cos(L.tilt))
    const x = Math.max(-L.xLimit + panel.width / 2, Math.min(L.xLimit - panel.width / 2, cx))
    panel.group.position.set(x - panel.width / 2, cy + half * Math.cos(L.tilt), L.z + half * Math.sin(L.tilt))
  }

  // ------------------------------------------------------------------ inspector (assistant or mathematics)

  private drawInspector(v: UiView): void {
    const which = v.inspector
    this.frame.setShown(which !== null)
    if (!which) {
      this.releaseFormulas(0)
      return
    }
    const T = SPATIAL_TYPE
    const L = SPATIAL_LAYOUT.inspector
    const W = Math.max(L.width, this.assistant.width + 2 * PAD)
    const TITLE_H = 0.066
    const f = inspectorFrame(which)
    if (which === 'assistant') {
      const key = JSON.stringify(['assistant', W, this.assistant.height])
      this.releaseFormulas(0)
      this.mathKey = ''
      this.mathDetailKey = ''
      if (key === this.frame.key) return
      this.frame.key = key
      const h = TITLE_H + this.assistant.height + PAD
      const p = this.frame.begin(W, h)
      this.frame.plate(p, { radius: 0.022, border: 'rgba(79, 209, 197, 0.3)', accent: 'rgba(79, 209, 197, 0.8)' })
      this.drawFrameTitle(p, W, TITLE_H, f.title, f.close, 'chat', C.teal)
      this.frame.end()
      this.assistantGroup.position.set((W - this.assistant.width) / 2, -TITLE_H, 0.0015)
      return
    }
    // Mathematics: sections laid out as blocks and paged to the reserved height (never cut, never shrunk).
    const detailKey = JSON.stringify(v.presentation.detail)
    if (detailKey !== this.mathDetailKey) {
      this.mathDetailKey = detailKey
      this.mathPage = 0
    }
    const key = `${detailKey}\u0000${this.mathPage}`
    if (key === this.mathKey && this.frame.key === 'math') return
    this.mathKey = key
    this.frame.key = 'math'
    const CW = W - 2 * PAD
    const blocks = this.mathBlocks(v.presentation.detail.sections, CW)
    const PAGER_H = 0.054
    const maxContent = L.maxHeight - TITLE_H - PAD - PAGER_H
    const pages = paginate(blocks, maxContent)
    this.mathPages = pages.length
    this.mathPage = Math.min(this.mathPage, pages.length - 1)
    const page = pages[this.mathPage]!
    const contentH = page.reduce((a, i) => a + blocks[i]!.height, 0)
    const pager = pages.length > 1
    const h = TITLE_H + Math.max(contentH, 0.05) + (pager ? PAGER_H : 0) + PAD
    const p = this.frame.begin(W, h)
    this.frame.plate(p, { radius: 0.022 })
    this.drawFrameTitle(p, W, TITLE_H, f.title, f.close, null, C.gold)
    const placed: { tex: string; plain: string; x: number; y: number; maxW: number }[] = []
    let y = TITLE_H
    for (const i of page) {
      blocks[i]!.draw(p, PAD, y, CW, this.frame.hits, placed)
      y += blocks[i]!.height
    }
    if (!page.length) p.text('No mathematical detail for this view.', PAD, TITLE_H + 0.02, T.detail, C.dim)
    if (pager) {
      const py = h - PAD - PAGER_H + 0.008
      p.line(PAD, py - 0.004, W - PAD, py - 0.004, C.line, 0.0008)
      const bw = 0.12
      const prevOn = this.mathPage > 0
      const nextOn = this.mathPage < pages.length - 1
      p.ctx.globalAlpha = prevOn ? 1 : 0.4
      p.rrect(PAD, py + 0.004, bw, 0.04, 0.011, null, C.lineStrong, 0.0011)
      p.icon('chevronLeft', PAD + 0.008, py + 0.024 - 0.009, 0.018, C.text, 2)
      p.text('Previous', PAD + 0.03, py + 0.024, T.secondary, C.text, { weight: 500 })
      p.ctx.globalAlpha = nextOn ? 1 : 0.4
      p.rrect(W - PAD - bw, py + 0.004, bw, 0.04, 0.011, null, C.lineStrong, 0.0011)
      p.text('Next', W - PAD - bw + 0.018, py + 0.024, T.secondary, C.text, { weight: 500 })
      p.icon('chevronRight', W - PAD - 0.026, py + 0.024 - 0.009, 0.018, C.text, 2)
      p.ctx.globalAlpha = 1
      p.text(`Page ${this.mathPage + 1} of ${pages.length}`, W / 2, py + 0.024, T.small, C.dim, { align: 'center' })
      this.frame.hits.push({ id: 'shell:math:prev', x: PAD, y: py + 0.004, w: bw, h: 0.04, r: 0.011, enabled: prevOn, command: null, hint: prevOn ? 'Previous page' : 'First page' })
      this.frame.hits.push({ id: 'shell:math:next', x: W - PAD - bw, y: py + 0.004, w: bw, h: 0.04, r: 0.011, enabled: nextOn, command: null, hint: nextOn ? 'Next page' : 'Last page' })
    }
    this.frame.end()
    this.placeFormulas(placed)
  }

  private drawFrameTitle(p: Painter, W: number, TITLE_H: number, title: string, close: string, icon: IconName | null, accent: string): void {
    const T = SPATIAL_TYPE
    let tx = PAD + 0.006
    if (icon) {
      p.icon(icon, tx, TITLE_H / 2 - 0.012, 0.024, accent)
      tx += 0.034
    }
    // The full name, never shrunk: the frame is sized for it.
    p.text(title, tx, TITLE_H / 2 + 0.002, T.inspectorTitle, C.strong, { weight: 600 })
    const cs = 0.046
    const cx = W - PAD - cs + 0.006
    const cy = (TITLE_H - cs) / 2 + 0.002
    p.icon('close', cx + (cs - 0.022) / 2, cy + (cs - 0.022) / 2, 0.022, C.dim, 2)
    this.frame.hits.push({ id: 'shell:close', x: cx, y: cy, w: cs, h: cs, r: 0.012, enabled: true, command: CLOSE_INSPECTOR, hint: close })
    p.line(PAD, TITLE_H - 0.002, W - PAD, TITLE_H - 0.002, C.line, 0.0008)
  }

  private mathBlocks(sections: DetailSection[], CW: number): Block[] {
    const T = SPATIAL_TYPE
    const m = this.frame.measurer
    const S = T.detail
    const LH = S * 1.42
    const blocks: Block[] = []
    sections.forEach((sec, si) => {
      const provW = sec.provenance ? m.measure(sec.provenance, 0.0122, 500) + 0.016 : 0
      const titleLines = m.wrap(sec.title, CW - (provW ? provW + 0.01 : 0), 0.0172, 600)
      const head = 0.012 + titleLines.length * 0.0172 * 1.3 + 0.008
      blocks.push({
        height: head + (si ? 0.006 : 0),
        keepWithNext: true,
        draw: (p, x, y) => {
          if (si) {
            p.line(x, y + 0.004, x + CW, y + 0.004, C.line, 0.0008)
            y += 0.006
          }
          titleLines.forEach((l, i) => p.text(l, x, y + 0.012 + 0.0172 * 1.3 * (i + 0.5), 0.0172, C.strong, { weight: 600 }))
          if (sec.provenance) {
            const col = PROV_COLOR[sec.provenance] ?? C.dim
            p.rrect(x + CW - provW, y + 0.01, provW, 0.022, 0.011, null, `${col}88`, 0.001)
            p.text(sec.provenance, x + CW - provW / 2, y + 0.021, 0.0122, col, { align: 'center', weight: 500 })
          }
        },
      })
      for (const it of sec.items) blocks.push(this.detailBlock(it, CW, S, LH))
    })
    return blocks
  }

  private detailBlock(it: DetailItem, CW: number, S: number, LH: number): Block {
    const m = this.frame.measurer
    const T = SPATIAL_TYPE
    switch (it.kind) {
      case 'text': {
        const lines = m.wrap(it.text, CW, S)
        return { height: lines.length * LH + 0.008, draw: (p, x, y) => lines.forEach((l, i) => p.text(l, x, y + 0.004 + LH * (i + 0.5), S, C.dim)) }
      }
      case 'formula': {
        if (it.formula.tex) {
          const tex = it.formula.tex
          const plain = it.formula.plain
          return { height: T.formula * 1.9, draw: (_p, x, y, w, _h, formulas) => void formulas.push({ tex, plain, x, y: y + T.formula * 0.95, maxW: w }) }
        }
        const lines = m.wrap(it.formula.plain, CW, 0.019, 400, MATH_FONT)
        return { height: lines.length * 0.019 * 1.4 + 0.01, draw: (p, x, y) => lines.forEach((l, i) => p.text(l, x, y + 0.005 + 0.019 * 1.4 * (i + 0.5), 0.019, C.text, { family: MATH_FONT })) }
      }
      case 'matrix': {
        const FS = 0.018
        const RH = FS * 1.45
        const cells = it.rows.map((r) => r.map((c) => c.replace(/^-/, '−')))
        const ncol = Math.max(1, ...cells.map((r) => r.length))
        const colW = Array.from({ length: ncol }, (_, j) => Math.max(0.012, ...cells.map((r) => (r[j] ? m.measure(r[j]!, FS, 400, MATH_FONT) : 0))))
        const label = it.label ? `${it.label.plain} =` : ''
        const lw = label ? m.measure(label, FS, 400, MATH_FONT) + 0.012 : 0
        const gridW = colW.reduce((a, b) => a + b, 0) + (ncol - 1) * 0.02 + 0.03
        const hgt = cells.length * RH + 0.016
        return {
          height: hgt + 0.01,
          draw: (p, x, y) => {
            const top = y + 0.005
            if (label) p.text(label, x, top + hgt / 2, FS, C.text, { family: MATH_FONT })
            const gx = x + lw
            const br = 0.007
            for (const [bx, dir] of [[gx, 1], [gx + gridW, -1]] as const) {
              p.line(bx, top, bx, top + hgt, C.dim, 0.0013)
              p.line(bx, top, bx + dir * br, top, C.dim, 0.0013)
              p.line(bx, top + hgt, bx + dir * br, top + hgt, C.dim, 0.0013)
            }
            cells.forEach((r, i) => {
              let cx = gx + 0.015
              r.forEach((c, j) => {
                p.text(c, cx + colW[j]!, top + 0.008 + RH * (i + 0.5), FS, C.text, { align: 'right', family: MATH_FONT })
                cx += colW[j]! + 0.02
              })
            })
          },
        }
      }
      case 'pairs': {
        const keyW = Math.min(CW * 0.42, Math.max(0.03, ...it.rows.map((r) => m.measure(r.key.plain, S))))
        const rows = it.rows.map((r) => ({ k: m.wrap(r.key.plain, keyW, S), v: m.wrap(r.value.plain, CW - keyW - 0.016, S) }))
        const rh = rows.map((r) => Math.max(r.k.length, r.v.length) * LH + 0.004)
        return {
          height: rh.reduce((a, b) => a + b, 0) + 0.008,
          draw: (p, x, y) => {
            let yy = y + 0.004
            rows.forEach((r, i) => {
              r.k.forEach((l, j) => p.text(l, x, yy + LH * (j + 0.5), S, C.dim))
              r.v.forEach((l, j) => p.text(l, x + keyW + 0.016, yy + LH * (j + 0.5), S, C.text))
              yy += rh[i]!
            })
          },
        }
      }
      case 'list': {
        const items = it.items.map((x) => m.wrap(x.plain, CW - 0.018, S))
        return {
          height: items.reduce((a, l) => a + l.length * LH + 0.003, 0) + 0.008,
          draw: (p, x, y) => {
            let yy = y + 0.004
            for (const lines of items) {
              p.circle(x + 0.005, yy + LH / 2, 0.0022, C.faint)
              lines.forEach((l, j) => p.text(l, x + 0.018, yy + LH * (j + 0.5), S, C.text))
              yy += lines.length * LH + 0.003
            }
          },
        }
      }
      case 'evidence': {
        const SS = 0.0142
        const cards = it.items.map((e) => {
          const [statusText, statusColor] = EVIDENCE_STATUS[e.status]
          const chipW = m.measure(statusText, 0.0122, 600) + 0.016
          const label = m.wrap(e.label, CW - 0.024 - chipW - 0.01, S)
          const stmt = e.statement ? m.wrap(e.statement, CW - 0.024, SS) : []
          const meta = [e.provenance, e.message].filter(Boolean).join(' · ')
          const metaLines = m.wrap(`${meta}${!e.current ? `${meta ? ' · ' : ''}historical: the data changed since this check` : ''}`, CW - 0.024, 0.0128)
          const h = 0.012 + label.length * LH + (stmt.length ? 0.006 + stmt.length * SS * 1.4 : 0) + (metaLines[0] ? 0.004 + metaLines.length * 0.0128 * 1.4 : 0) + 0.012
          return { e, statusText, statusColor, chipW, label, stmt, metaLines: metaLines[0] ? metaLines : [], h }
        })
        return {
          height: cards.reduce((a, c) => a + c.h + 0.008, 0) + 0.004,
          draw: (p, x, y) => {
            let yy = y + 0.004
            for (const c of cards) {
              p.ctx.globalAlpha = c.e.current ? 1 : 0.7
              p.rrect(x, yy, CW, c.h, 0.012, 'rgba(255, 255, 255, 0.03)', C.line, 0.001)
              p.rrect(x + CW - 0.012 - c.chipW, yy + 0.01, c.chipW, 0.022, 0.011, `${c.statusColor}22`)
              p.text(c.statusText, x + CW - 0.012 - c.chipW / 2, yy + 0.021, 0.0122, c.statusColor, { align: 'center', weight: 600 })
              let ty = yy + 0.012
              c.label.forEach((l, j) => p.text(l, x + 0.012, ty + LH * (j + 0.5), S, C.text))
              ty += c.label.length * LH
              if (c.stmt.length) {
                ty += 0.006
                c.stmt.forEach((l, j) => p.text(l, x + 0.012, ty + SS * 1.4 * (j + 0.5), SS, C.text))
                ty += c.stmt.length * SS * 1.4
              }
              if (c.metaLines.length) {
                ty += 0.004
                c.metaLines.forEach((l, j) => p.text(l, x + 0.012, ty + 0.0128 * 1.4 * (j + 0.5), 0.0128, c.e.current ? C.faint : C.amber))
              }
              p.ctx.globalAlpha = 1
              yy += c.h + 0.008
            }
          },
        }
      }
      case 'action': {
        const lw = m.measure(it.label.plain, T.secondary, 500) + 0.032
        return {
          height: 0.056,
          draw: (p, x, y, _w, hits) => {
            p.ctx.globalAlpha = it.enabled ? 1 : 0.45
            p.rrect(x, y + 0.006, lw, 0.044, 0.012, 'rgba(255, 255, 255, 0.02)', C.lineStrong, 0.0011)
            p.text(it.label.plain, x + 0.016, y + 0.028, T.secondary, C.text, { weight: 500 })
            p.ctx.globalAlpha = 1
            hits.push({ id: `shell:detail:${it.id}`, x, y: y + 0.006, w: lw, h: 0.044, r: 0.012, enabled: it.enabled, command: detailActionCommand(it), hint: !it.enabled ? it.reason ?? 'Not available right now' : undefined })
          },
        }
      }
    }
  }

  /** Formulas through the mathematical text path (TextSlot tex), left-aligned on their rows, scaled down only
   * if wider than the panel. Slots are pooled; unused ones are emptied and hidden. */
  private placeFormulas(placed: { tex: string; plain: string; x: number; y: number; maxW: number }[]): void {
    placed.forEach((f, i) => {
      let place = this.formulas[i]
      if (!place) {
        const slot = new TextSlot(`shell:formula:${i}`)
        this.inspectorGroup.add(slot.anchor)
        place = { slot, x: 0, y: 0, maxW: 0, lastW: -1, used: false }
        this.formulas.push(place)
      }
      place.used = true
      place.x = f.x
      place.y = f.y
      place.maxW = f.maxW
      place.lastW = -1
      place.slot.setWanted(true)
      place.slot.set({ kind: 'tex', parts: [{ tex: f.tex }], em: SPATIAL_TYPE.formula, color: 0xe9edf5, plain: f.plain })
      place.slot.anchor.position.set(f.x, -f.y, 0.002)
    })
    this.releaseFormulas(placed.length)
  }

  private releaseFormulas(from: number): void {
    for (let i = from; i < this.formulas.length; i++) {
      const f = this.formulas[i]!
      if (!f.used) continue
      f.used = false
      f.slot.set(null)
      f.slot.setWanted(false)
    }
  }

  private showTooltip(panel: CanvasPanel, r: HitRegion): void {
    const text = r.hint!
    const m = this.tooltip.measurer
    const S = 0.0145
    const lines = m.wrap(text, 0.34, S)
    const w = Math.max(...lines.map((l) => m.measure(l, S))) + 0.024
    const h = lines.length * S * 1.35 + 0.018
    const p = this.tooltip.begin(w, h)
    p.rrect(0.001, 0.001, w - 0.002, h - 0.002, 0.009, 'rgba(8, 11, 18, 0.97)', 'rgba(160, 178, 214, 0.3)', 0.001)
    lines.forEach((l, i) => p.text(l, 0.012, 0.009 + S * 1.35 * (i + 0.5), S, r.enabled ? C.text : C.amber))
    this.tooltip.end()
    if (this.tooltip.group.parent !== panel.group) panel.group.add(this.tooltip.group)
    // Above the entry (inside the panel's own frame, a few millimetres in front of it).
    const x = Math.max(-0.02, Math.min(panel.width - w + 0.02, r.x + r.w / 2 - w / 2))
    // Toolbar: above the whole panel, so a tip never covers the other row's buttons.
    const top = panel === this.toolbar ? 0 : -r.y
    this.tooltip.group.position.set(x, top + h + 0.008, 0.004)
    this.tooltip.setShown(true)
  }
}
