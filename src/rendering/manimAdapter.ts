// manim-web backend for the visual adapter (RUNTIME-ADAPTER R3-R5).
//
// What is reused from manim-web 0.40.1: the mobjects (Dot3D, Arrow3D, Line3D, Surface3D, VMobject,
// Circle, Group, MathTex), their three.js objects and dirty-sync, the ApplyMatrix and
// UpdateFromAlphaFunc animations and the `smooth` rate function. What is NOT used: Scene, ThreeDScene,
// Timeline, any interaction module, the BezierRenderer, LinearTransformationScene. Those own loops,
// renderers, cameras or DOM input (docs/COMPATIBILITY-REPORT.md).
//
// Rules this file keeps (each one is a finding from the R6 investigation):
//  - Placement lives on host Groups only. Mobject THREE objects are re-written by their own sync, so
//    the host never sets their transforms, and never calls moveTo/getCenter/nextTo (they measure in
//    THREE world space and mix frames under a transformed parent).
//  - Every Line2 material is switched to world units (metres), so stroke width is correct per eye;
//    three's LineSegments2 otherwise takes `resolution` from the whole-canvas viewport in XR.
//  - Depth policy is applied by the host (depthTest on, depthWrite only when opaque) because only
//    ThreeDScene.add would apply it.
//  - Child z-layering is disabled on every group (0.01 per child along z is visible in stereo).
//  - Animations are created from model state at phase start and stepped with a host presentation
//    clock; replay rebuilds them (begin() re-snapshots, reset() restores stale geometry).
//
// Two layouts share these objects: linked views (input, output) for one bound map, and the branch
// comparison (a compact shared input between two route outputs, `output` left and `output2` right) with
// step playback ('compare_steps'). Floating labels are laid out by labelLayout.ts at the viewing pose.

import {
  Box3, Group, Mesh, MeshBasicMaterial, SphereGeometry, CylinderGeometry, Vector3, Color, Quaternion, Euler,
  type Object3D, type Material, type Ray,
} from 'three'
import {
  Dot3D, Arrow3D, Line3D, Surface3D, VMobject, Circle, Group as MGroup, ApplyMatrix, UpdateFromAlphaFunc, smooth,
  type Mobject,
} from 'manim-web'
import type { Capabilities, PickResult, PlaybackCommand, PlaybackState, TransitionSpec, VisualAdapter, VoiceLine } from './adapter'
import type { CubeDesc, EquationDesc, GlyphToken, LabelDesc, OutlineDesc, PlaneDesc, PointDesc, Primitive, Role, SegmentDesc, VectorDesc, ViewDescription, ViewRole, RouteDesc } from './viewDescription'
import { compareClock, compareDuration, stepPosition, DEFAULT_STEP_DURATION } from './comparePlayback'
import { layoutLabels, type LayoutItem, type Obstacle, type Placement } from './labelLayout'
import { PHRASE } from '../ui/phrases'
import { embed, createViewRoot, type ViewPlacement } from './placement'
import { texGeometry, initMathJax } from './tex'
import { TextSlot, type SlotContent } from './textSlot'
import { requestTokens, tokenState, whenTokensSettled, type TokenSpec } from './glyphTokens'
import { plainName } from './viewDescription'
import { palette, hex, identityColor } from '../ui/palette'
import type { FrameContext } from '../runtime/host'
import type { ScenePresentation } from '../ui/model'
import { profileStage, timed } from '../runtime/frameProfile'

type V3 = [number, number, number]
/** A label offset in bench space: (x, y), or (x, y, z) when a layout decision computed it at the viewing pose. */
type Offset = [number, number] | [number, number, number] | ((slot?: TextSlot) => [number, number] | [number, number, number])
interface LabelTarget {
  view: ViewRole
  at: V3 | (() => V3)
  offset?: Offset
}

const ROLE_COLOR: Record<Role, number> = {
  input: palette.input,
  output: palette.output,
  fiber: palette.fiber,
  plane: palette.plane,
  neutral: palette.neutral,
  selected: palette.selected,
}

/** Display sizes. Radii/shafts are in mathematical units (scaled by the view); widths in metres. */
const SIZE = {
  scale: 0.085,
  dot: 0.062,
  dotSelected: 0.09,
  pickRadius: 0.24,
  lineCube: 0.0016,
  lineAxis: 0.0016,
  lineGhost: 0.0015,
  lineFiber: 0.0032,
  linePlane: 0.0018,
  lineRing: 0.0016,
  ringRadius: 0.0125,
  arrowShaft: 0.022,
  arrowTip: 0.075,
  arrowTipLength: 0.24,
  planeOpacity: 0.16,
  /** Font em sizes in metres at the ~0.8 m reading distance. Captions and axis letters were raised after the
   * Quest 3S wearer found some small (R6 follow-up F3): captions 16 -> 19.5 mm (~1.4 deg), axis letters
   * 16 -> 22 mm, titles 16 -> 19.5 mm; readouts and the map equation were already read easily. */
  texMap: 0.024,
  texReadout: 0.022,
  texTitle: 0.0195,
  texCaption: 0.0195,
  texAxis: 0.022,
  texLabel: 0.024,
  /** Comparison: the sample outline, and dot radii (all three views show identity-coloured, labelled dots). */
  lineOutline: 0.0024,
  dotCompare: 0.07,
  dotCompareSelected: 0.095,
  /** Leader from a displaced label to its point (metres). */
  leaderRadius: 0.0007,
}

const ROLES = ['input', 'output', 'output2'] as const
/** Resting offsets (bench x, y) of a point's name and of an output-location label; the layout's first choice
 * in linked views, so an uncrowded scene looks exactly as before the layout existed. */
const POINT_LABEL_OFFSET: [number, number] = [-0.024, 0.018]
const GROUP_LABEL_OFFSET: [number, number] = [0.012, 0.046]
/** Primitive ID prefix per view ('pt:in:...', 'vec:out2', ...). */
const PFX: Record<ViewRole, string> = { input: 'in', output: 'out', output2: 'out2' }
type Mode = 'linked' | 'compare'

/** Label layout tuning, in screen units (radians at the viewing pose, roughly). */
const LAYOUT = { gap: 0.006, farGap: 0.03, margin: 0.0025, textPad: 0.004, headMove: 0.01, headTurn: 0.017, everyFrames: 3, fadePerSecond: 8, ipd: 0.064 } as const

export const TRANSITION_PHASES = [
  { name: 'introduce', from: 0, to: 0.5 },
  { name: 'move', from: 0.5, to: 2.3 },
  { name: 'annotate', from: 2.3, to: 3.0 },
] as const
const DEFAULT_DURATION = 3.0

interface ViewNodes {
  role: ViewRole
  root: Group
  /** rotation.x = -PI/2: children use mathematical (z-up) coordinates; this IS the embedding E_3. */
  math: Group
}

interface DotRec {
  mob: Dot3D
  proxy: Mesh
  at: V3
  /** Last colour given to the mobject (setColor marks it dirty, so unchanged colours are skipped). */
  color: number
  role: Role
  sourceId: string
  interaction: PointDesc['interaction']
}

interface ActiveTransition {
  spec: TransitionSpec
  desc: ViewDescription
  /** Presentation seconds (apply_map: its duration; compare_steps: input hold + one step per map). */
  duration: number
  time: number
  /** Presentation time at the last geometry evaluation (review C3: unchanged time => no work). */
  evaluatedTime: number
  playing: boolean
  phaseIndex: number
  anims: { begin(): void; interpolate(a: number): void; finish(): void }[]
}

const tmpV = new Vector3()
const axisTmp = Array.from({ length: 7 }, () => new Vector3())
const BENCH_UP = new Vector3(0, 1, 0)
const UP = new Vector3(0, 1, 0)
/** Output view yaw when the image plane is x = 0 (radians; the default output yaw is -0.22). */
const OUTPUT_YAW_FACING_X_PLANE = -0.95

function f3(v: number[]): V3 {
  return [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]
}

function lerp3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function eq3(a: V3, b: V3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

/**
 * Formal readouts that the UI shell moves into Show mathematics (setPresentation): the map equation and its
 * caption, the selected-sample and output readouts, a comparison's route matrices, step lines and step
 * indicator, and the in-scene evidence line. Under the shell they are shown in the mathematics inspector only
 * (not duplicated over the stage, where the lower ones would sit under the context bar). View titles (route
 * order "R then S"), the verdict, axis letters, sample and output-group labels, the fiber and plane labels and
 * the illustrative-path caption stay.
 */
const FORMAL_SLOT = /^(eq|caption):(map|sel|out|route:|step:)|^lbl:(evidence|step)$/

/** Caption slot paired with an equation slot. */
function captionSlot(eqId: string): string {
  return eqId.replace('eq:', 'caption:')
}

/** The presented (possibly mid-transition) position of a dot, in its view's mathematical coordinates. */
function livePos(mob: Dot3D): V3 {
  const p = (mob as unknown as { position: Vector3 }).position
  return [p.x, p.y, p.z]
}

function mixHex(a: number, b: number, t: number): string {
  return `#${new Color(a).lerp(new Color(b), t).getHexString()}`
}

/**
 * Host depth policy (ThreeDScene._applyDepthSettings equivalent): depth-tested; write only when opaque. A material
 * flagged `userData.ownDepth` (the UI shell's panel plates, which must occlude what is drawn after them) keeps its own.
 */
export function applyDepthPolicy(obj: Object3D): void {
  obj.traverse((o) => {
    const mats = (o as { material?: Material | Material[] }).material
    if (!mats) return
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      const ud = m.userData as { depthPrepass?: boolean; ownDepth?: boolean }
      if (ud.depthPrepass || ud.ownDepth) continue
      m.depthTest = true
      m.depthWrite = !m.transparent
    }
  })
}

/** Force every Line2 material under obj to world-unit width (metres) with alpha-to-coverage edges. */
export function worldUnitLines(obj: Object3D, widthM: number): number {
  let n = 0
  obj.traverse((o) => {
    const m = (o as { material?: Record<string, unknown> & Material }).material
    if (!m || !(m as { isLineMaterial?: boolean }).isLineMaterial) return
    const lm = m as unknown as { defines: Record<string, unknown>; worldUnits: boolean; linewidth: number; alphaToCoverage: boolean; needsUpdate: boolean }
    if (!('WORLD_UNITS' in lm.defines)) {
      lm.worldUnits = true
      lm.needsUpdate = true
    }
    if (!lm.alphaToCoverage) lm.alphaToCoverage = true
    if (lm.linewidth !== widthM) lm.linewidth = widthM
    n++
  })
  return n
}

/** A VMobject whose points are straight segments (each segment its own subpath). */
function segmentsVMobject(segments: [V3, V3][], color: number, widthM: number): VMobject {
  const vm = new VMobject()
  vm.fillOpacity = 0
  vm.setColor(hex(color))
  // Per-instance stroke context: linewidth = strokeWidth * 0.01 * (1 / 1), i.e. strokeWidth*0.01 metres.
  ;(vm as unknown as { _setSceneContext(w: number, h: number, fw: number): void })._setSceneContext(1, 1, 1)
  vm.setStrokeWidth(widthM * 100)
  setSegments(vm, segments)
  return vm
}

function setSegments(vm: VMobject, segments: [V3, V3][]): void {
  const pts: number[][] = []
  for (const [a, b] of segments) pts.push(a, lerp3(a, b, 1 / 3), lerp3(a, b, 2 / 3), b)
  vm.setPoints3D(pts)
  vm.setBaseSubpathLengths(segments.map(() => 4))
}

export interface AdapterLayout {
  bench: { position: Vector3; yaw: number }
  /** Linked views (output2 is unused there and hidden). */
  views: Record<ViewRole, ViewPlacement>
  /** Branch comparison: compact shared input in the middle, left route `output`, right route `output2`. */
  compare: Record<ViewRole, ViewPlacement>
}

/** Comparison panels: x of the route outputs, their turn toward the viewer, and the tilt that shows the
 * mathematical plane z = 0 facing the viewer (presentation only; the embedding E_3 is unchanged). */
const COMPARE = { x: 0.36, yaw: 0.36, tilt: 0.98, scaleIn: 0.056, scaleOut: 0.076 } as const

export function defaultLayout(): AdapterLayout {
  const yawQ = (a: number) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), a)
  const tilt = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), COMPARE.tilt)
  return {
    bench: { position: new Vector3(0, 1.02, -0.8), yaw: 0 },
    views: {
      input: { position: new Vector3(-0.3, 0, 0), quaternion: yawQ(0.22), scale: SIZE.scale },
      output: { position: new Vector3(0.3, 0, 0), quaternion: yawQ(-0.22), scale: SIZE.scale },
      output2: { position: new Vector3(0.3, 0, 0), quaternion: yawQ(-0.22), scale: SIZE.scale },
    },
    compare: {
      input: { position: new Vector3(0, 0, 0.04), quaternion: tilt.clone(), scale: COMPARE.scaleIn },
      output: { position: new Vector3(-COMPARE.x, 0, 0), quaternion: yawQ(COMPARE.yaw).multiply(tilt), scale: COMPARE.scaleOut },
      output2: { position: new Vector3(COMPARE.x, 0, 0), quaternion: yawQ(-COMPARE.yaw).multiply(tilt), scale: COMPARE.scaleOut },
    },
  }
}

export class ManimAdapter implements VisualAdapter {
  readonly root = new Group()
  /** The workbench: moving it is a presentation action and never touches the model. */
  readonly bench = new Group()
  private readonly labels = new Group()
  /** Parent of the formal readouts (FORMAL_SLOT), inside `labels`: hidden under the shell until details open. */
  private readonly formal = new Group()
  private presentation: ScenePresentation = { inSceneControls: true, detailsOpen: false }
  /** The application's own lines (voice caption, assistant outcome): shown above every demonstration. */
  private readonly appLines = new Group()
  /** Set while another demonstration's scene is on the workbench (FOUR-DEMOS): the linear views are hidden. */
  private linearHidden = false
  private views!: Record<ViewRole, ViewNodes>
  private readonly dots: Record<ViewRole, Map<string, DotRec>> = { input: new Map(), output: new Map(), output2: new Map() }
  private dotGroups!: Record<ViewRole, MGroup>
  private arrows: Partial<Record<ViewRole, { mob: Arrow3D; to: V3; role: Role; color: number }>> = {}
  private cubes: Partial<Record<ViewRole, { mob: VMobject; corners: V3[]; edges: [number, number][] }>> = {}
  /** Sample outlines by primitive ID (comparison), following their vertices' live dots during playback. */
  private readonly outlines = new Map<string, { mob: VMobject; view: ViewRole; ids: string[]; points: V3[] }>()
  /** Which layout the views are in (linked views, or the three-panel comparison). */
  private mode: Mode = 'linked'
  /** Seconds per step of the last comparison playback (Replay reuses it). */
  private lastStepDuration = DEFAULT_STEP_DURATION
  private ghost: VMobject | null = null
  private fiber: { mob: Line3D; from: V3; to: V3 } | null = null
  private plane: { mob: Surface3D; border: VMobject; axis: number; opacity: number } | null = null
  private axes: VMobject[] = []
  private rings: { mob: Circle; anchor: Group; view: ViewRole; sourceId: string }[] = []
  private readonly slots = new Map<string, TextSlot>()
  /** Set when mobject state changed this frame; the host render policy is re-asserted only then. */
  private renderDirty = true
  private readonly proxyMat = new MeshBasicMaterial({ visible: false })
  private readonly proxyGeo = new SphereGeometry(1, 8, 6)
  private current: ViewDescription | null = null
  /**
   * Output-view yaw (presentation only, M2): turned toward the image plane when the plane would otherwise
   * be seen edge-on (normal along x: it contains the depth direction). Derived from the description, so
   * it applies to any bound map, and eased over ~0.5 s with no per-frame work once settled.
   */
  private outputYaw = { now: NaN, target: NaN, base: NaN }
  private transition: ActiveTransition | null = null
  private readonly mobRoots = new Set<Mobject>()
  private mounted = false
  readonly stats = { applies: 0, syncs: 0, arrowRebuilds: 0, transitionsStarted: 0, canceled: 0, evaluations: 0, dotMoves: 0, policyPasses: 0, billboards: 0, kindMismatches: 0, layoutRuns: 0, layoutChanges: 0 }

  constructor(private readonly layout: AdapterLayout = defaultLayout()) {}

  mount(parent: Object3D): void {
    if (this.mounted) throw new Error('adapter already mounted')
    this.mounted = true
    void initMathJax()
    this.root.name = 'manim-adapter'
    this.bench.name = 'bench'
    this.bench.position.copy(this.layout.bench.position)
    this.bench.rotation.y = this.layout.bench.yaw
    this.labels.name = 'labels'
    this.formal.name = 'formal-readouts'
    this.labels.add(this.formal)
    this.root.add(this.bench)
    this.bench.add(this.labels)
    this.appLines.name = 'app-lines'
    this.bench.add(this.appLines)
    const mk = (role: ViewRole): ViewNodes => {
      const root = createViewRoot(`view:${role}`, this.layout.views[role])
      const math = new Group()
      math.name = `math:${role}`
      math.rotation.x = -Math.PI / 2
      root.add(math)
      this.bench.add(root)
      return { role, root, math }
    }
    this.views = { input: mk('input'), output: mk('output'), output2: mk('output2') }
    this.views.output2.root.visible = false
    const yaw = new Euler().setFromQuaternion(this.views.output.root.quaternion, 'YXZ').y
    this.outputYaw = { now: yaw, target: yaw, base: yaw }
    this.dotGroups = { input: this.newGroup(), output: this.newGroup(), output2: this.newGroup() }
    for (const role of ROLES) this.views[role].math.add(this.dotGroups[role].getThreeObject())
    this.buildAxes()
    for (const n of ['x', 'y', 'z']) this.slots.get(`axis:output2:${n}`)?.setWanted(false)
    parent.add(this.root)
  }

  capabilities(): Capabilities {
    return {
      dependency: { name: 'manim-web', version: '0.40.1', patched: ['svgToVMobjects nested <svg> viewport + scale(sx,sy) (patches/manim-web-0.40.1-nested-svg.mjs)'] },
      primitives: ['point (Dot3D)', 'vector (Arrow3D)', 'segment (Line3D)', 'wireframe cube (VMobject segments)', 'plane patch (Surface3D + VMobject border)', 'axes (VMobject segments)', 'equation/label (MathTex)', 'selection ring (Circle)', 'sample outline (VMobject segments)', 'label leader (three Mesh)'],
      transitions: [
        'apply_map: introduce / move (1-a)v + aAv / annotate',
        'compare_steps: input, then each route\'s maps in order; a quarter-turn rotation (from its exact matrix) moves on a true angular path, any other map straight; exact endpoints at every step',
        'pause', 'replay', 'finish-to-target',
      ],
      equations: { kind: 'vector-geometry', engine: 'MathJax 4 via manim-web MathTex', limitations: ['\\color, \\textcolor, \\boldsymbol and TeX errors yield zero glyphs (detected, reported)', 'typesetting is ~10 ms main-thread per equation on desktop; Quest unmeasured'] },
      depth: 'depth-tested; opaque meshes write depth; transparent fills/plates do not; world-unit strokes',
      limitations: [
        'Arrow3D.setEnd rebuilds geometry each call (used per frame during transitions)',
        'Line3D.setStart/setEnd allocate a new GPU buffer per call',
        'manim-web interaction modules are DOM/single-camera bound; picking is host-side',
      ],
    }
  }

  /**
   * Prebuild every readout glyph token a drag can need, and typeset the equations and captions of this
   * description, outside the frame path. Slots work without it (they show plain-text pending states).
   */
  async prepare(desc: ViewDescription): Promise<{ ok: true } | { ok: false; failures: string[] }> {
    await initMathJax().catch(() => undefined)
    const tokens = desc.tokenSet
    requestTokens(tokens)
    const eqs = desc.primitives.filter((p): p is EquationDesc => p.kind === 'equation')
    const results = await Promise.allSettled([
      whenTokensSettled(tokens),
      ...eqs.map((e) => this.equationContent(e)).flatMap((c, i) => (c.kind === 'tex' ? [texGeometry(c.parts, c.em, c.color, eqs[i]!.id)] : [])),
      ...eqs.filter((e) => e.captionTex && !e.captionTokens).map((e) => texGeometry([{ tex: e.captionTex }], SIZE.texCaption, palette.textDim, captionSlot(e.id))),
    ])
    const failures = results.flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []))
    const badTokens = tokens.filter((t) => tokenState(t) === 'failed')
    if (badTokens.length) failures.push(`glyph tokens failed: ${badTokens.join(' ')}`)
    return failures.length ? { ok: false, failures } : { ok: true }
  }

  apply(desc: ViewDescription, transition?: TransitionSpec): void {
    this.stats.applies++
    const t = this.transition
    if (t && (desc.mathRevision !== t.desc.mathRevision || desc.previewSample !== t.desc.previewSample || !desc.comparison !== !t.desc.comparison)) this.finishTransition()
    else if (t && desc !== t.desc) {
      // Same mathematics, new selection/naming (review C1-b): the transition keeps playing, but its moving
      // "P<name>" labels and emphasis colours must come from the current description. Re-evaluate once at
      // the same presentation time (positions unchanged; also while paused).
      t.desc = desc
      t.evaluatedTime = NaN
    }
    this.current = desc
    this.setMode(desc.comparison ? 'compare' : 'linked')
    this.setTitles(desc)
    const plane = desc.primitives.find((p): p is PlaneDesc => p.kind === 'plane')
    if (this.mode === 'linked') this.outputYaw.target = plane?.normalAxis === 0 ? OUTPUT_YAW_FACING_X_PLANE : this.outputYaw.base
    this.layoutDirty = true
    const seen = new Set<string>()
    // One profile sample per primitive kind per apply (summed), so each ring holds 900 applies rather
    // than 900 primitives (54 points per apply would otherwise wrap it after 16 applies).
    const byKind = new Map<string, number>()
    for (const p of desc.primitives) {
      seen.add(p.id)
      const t0 = performance.now()
      this.applyPrimitive(p, desc)
      byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + performance.now() - t0)
    }
    for (const [kind, ms] of byKind) profileStage(`apply.${kind}`, ms)
    timed('apply.removeMissing', () => this.removeMissing(seen, desc))
    timed('apply.slots', () => this.applySlots(desc))
    this.renderDirty = true
    if (transition) this.startTransition(desc, this.matchingSpec(desc, transition))
  }

  /**
   * The transition kind must match the description: a comparison plays its steps, linked views play one map.
   * A mismatched request (an integration error) is converted with the requested timing and counted.
   */
  private matchingSpec(desc: ViewDescription, spec: TransitionSpec): TransitionSpec {
    if (desc.comparison && spec.kind === 'apply_map') {
      this.stats.kindMismatches++
      return { kind: 'compare_steps', stepDuration: this.lastStepDuration }
    }
    if (!desc.comparison && spec.kind === 'compare_steps') {
      this.stats.kindMismatches++
      return { kind: 'apply_map', duration: DEFAULT_DURATION }
    }
    return spec
  }

  /** Switch between the linked-view and comparison layouts (presentation placement only). */
  private setMode(mode: Mode): void {
    if (mode === this.mode) return
    this.mode = mode
    const place = mode === 'compare' ? this.layout.compare : this.layout.views
    for (const role of ROLES) {
      const v = this.views[role]
      v.root.position.copy(place[role].position)
      v.root.quaternion.copy(place[role].quaternion)
      v.root.scale.setScalar(place[role].scale)
    }
    this.views.output2.root.visible = mode === 'compare'
    for (const n of ['x', 'y', 'z']) this.slots.get(`axis:output2:${n}`)?.setWanted(mode === 'compare')
    // Linked views ease the output yaw toward the image plane; that starts again from the layout's own yaw.
    if (mode === 'linked') this.outputYaw.now = this.outputYaw.base
    this.layoutDirty = true
    this.placements.clear()
    this.renderDirty = true
  }

  step(ctx: FrameContext): void {
    const t = this.transition
    const t0 = performance.now()
    if (t) {
      if (t.playing) t.time = Math.min(t.duration, t.time + ctx.dt)
      // Review C3: geometry is interpolated only when presentation time changed. Paused => no
      // re-interpolation, no Arrow3D rebuilds, no dot moves; head tracking, billboards, picking and
      // rendering below still run every frame.
      if (t.time !== t.evaluatedTime) this.evaluateTransition(t)
      if (t.time >= t.duration && t.playing) this.completeTransition()
    }
    const t1 = performance.now()
    profileStage('adapter.transition', t1 - t0)
    const y = this.outputYaw
    if (this.mode === 'linked' && y.now !== y.target) {
      y.now = Math.abs(y.target - y.now) < 1e-4 ? y.target : y.now + (y.target - y.now) * Math.min(1, ctx.dt * 6)
      this.views.output.root.quaternion.setFromAxisAngle(UP, y.now)
      this.renderDirty = true
    }
    const t2 = performance.now()
    for (const s of this.slots.values()) s.frame(ctx.time)
    const t3 = performance.now()
    this.billboard(ctx.head, ctx.dt)
    const t4 = performance.now()
    // Sync dirty mobjects into three (cheap when clean); re-assert host render policy only after changes.
    for (const m of this.mobRoots) m.getThreeObject()
    this.stats.syncs++
    const t5 = performance.now()
    if (this.renderDirty) {
      this.enforceLines()
      this.renderDirty = false
      this.stats.policyPasses++
    }
    const t6 = performance.now()
    this.updateProxies()
    this.root.updateMatrixWorld()
    const t7 = performance.now()
    profileStage('adapter.slots', t3 - t2)
    profileStage('adapter.billboard', t4 - t3)
    profileStage('adapter.sync', t5 - t4)
    profileStage('adapter.policy', t6 - t5)
    profileStage('adapter.matrices', t7 - t6)
  }

  setPlayback(cmd: PlaybackCommand): PlaybackState {
    const t = this.transition
    if (cmd === 'replay') {
      if (this.current && !this.current.previewSample) this.startTransition(this.current, this.replaySpec())
    } else if (typeof cmd === 'object') {
      if (this.current && !this.current.previewSample) {
        this.startTransition(this.current, this.replaySpec())
        const n = this.transition!
        n.time = Math.max(0, Math.min(cmd.seek, n.duration))
        n.playing = false
        this.evaluateTransition(n)
      }
    } else if (t) {
      if (cmd === 'pause') t.playing = false
      else if (cmd === 'play') t.playing = true
      else if (cmd === 'toggle') t.playing = !t.playing
      else if (cmd === 'finish') this.finishTransition()
    }
    return this.playback()
  }

  /**
   * Replay with the kind that matches the current description: a comparison steps through both routes with
   * the last step duration; linked views play the map with the active transition's duration (else 3 s).
   */
  private replaySpec(): TransitionSpec {
    const t = this.transition
    if (this.current?.comparison) return { kind: 'compare_steps', stepDuration: this.lastStepDuration }
    return { kind: 'apply_map', duration: t?.spec.kind === 'apply_map' ? t.spec.duration : DEFAULT_DURATION }
  }

  playback(): PlaybackState {
    const t = this.transition
    if (!t) return { active: false, playing: false, time: 0, duration: DEFAULT_DURATION, phase: 'idle', step: null }
    if (t.spec.kind === 'compare_steps') {
      const c = t.desc.comparison!
      const count = Math.max(c.left.steps, c.right.steps)
      const k = compareClock(count, t.spec.stepDuration, t.time)
      const phase = t.time >= t.duration ? 'done' : k.index === 0 ? 'input' : k.holding ? `step ${k.index} result` : `step ${k.index}`
      return { active: true, playing: t.playing, time: t.time, duration: t.duration, phase, step: { index: k.index, count, label: stepLabel(c, k.index) } }
    }
    const ph = TRANSITION_PHASES.find((p) => t.time >= p.from && t.time < p.to)?.name ?? 'done'
    return { active: true, playing: t.playing, time: t.time, duration: t.duration, phase: ph, step: null }
  }

  /**
   * Host-side picking (manim-web's interaction modules are DOM/single-camera bound). Among pick proxies
   * the ray passes through, choose the one whose centre is closest to the ray (relative to its radius),
   * not the first one along the ray: with grazing rays over a plane of points the first hit is usually a
   * neighbour in front. Tolerances are display tolerances, never mathematical equality.
   */
  pick(ray: Ray): PickResult | null {
    let best: (PickResult & { score: number }) | null = null
    const c = new Vector3()
    for (const role of ROLES) {
      if (!this.views[role].root.visible) continue
      for (const [, rec] of this.dots[role]) {
        if (!rec.interaction || !rec.proxy.visible) continue
        rec.proxy.getWorldPosition(c)
        const r = rec.proxy.getWorldScale(tmpV).x
        const along = c.clone().sub(ray.origin).dot(ray.direction)
        if (along <= 0 || along > 4) continue
        const score = Math.sqrt(ray.distanceSqToPoint(c)) / r
        if (score > 1) continue
        if (!best || score < best.score - 1e-6 || (Math.abs(score - best.score) <= 1e-6 && along < best.distance)) {
          best = { id: `pt:${PFX[role]}:${rec.sourceId}`, sourceId: rec.sourceId, view: role, role: rec.interaction, distance: along, score }
        }
      }
    }
    if (!best) return null
    const { score: _score, ...hit } = best
    return hit
  }

  /** The view root for pointer-to-math conversions (inverse placement). */
  viewMathGroup(role: ViewRole): Group {
    return this.views[role].math
  }

  /** Test/dev: how many three objects and line materials the adapter currently owns. */
  census() {
    let objects = 0
    let lineMaterials = 0
    let screenSpaceLines = 0
    let zStagger = 0
    this.root.traverse((o) => {
      objects++
      const m = (o as { material?: { isLineMaterial?: boolean; defines?: Record<string, unknown> } }).material
      if (m?.isLineMaterial) {
        lineMaterials++
        if (!('WORLD_UNITS' in (m.defines ?? {}))) screenSpaceLines++
      }
    })
    for (const role of ROLES) {
      for (const rec of this.dots[role].values()) if (Math.abs(rec.mob.getThreeObject().position.z - rec.at[2]) > 1e-9) zStagger++
    }
    return { objects, lineMaterials, screenSpaceLines, zStagger, slots: this.slots.size, dots: this.dots.input.size + this.dots.output.size + this.dots.output2.size }
  }

  dispose(): void {
    this.transition = null
    for (const m of this.mobRoots) m.dispose()
    this.mobRoots.clear()
    for (const sl of this.slots.values()) sl.dispose()
    this.slots.clear()
    for (const role of ROLES) this.dots[role].clear()
    this.outlines.clear()
    for (const l of this.leaders.values()) l.removeFromParent()
    this.leaders.clear()
    this.leaderGeo.dispose()
    this.leaderMat.dispose()
    this.proxyGeo.dispose()
    this.proxyMat.dispose()
    this.root.removeFromParent()
    this.mounted = false
  }

  // ---------------------------------------------------------------- primitives

  private newGroup(): MGroup {
    const g = new MGroup()
    g.disableChildZLayering()
    return g
  }

  private track<T extends Mobject>(m: T): T {
    this.mobRoots.add(m)
    return m
  }

  private untrack(m: Mobject): void {
    this.mobRoots.delete(m)
    m.getThreeObject().removeFromParent()
    m.dispose()
  }

  private applyPrimitive(p: Primitive, desc: ViewDescription): void {
    switch (p.kind) {
      case 'point':
        return this.applyPoint(p, desc)
      case 'vector':
        return this.applyVector(p)
      case 'segment':
        return this.applySegment(p)
      case 'plane':
        return this.applyPlane(p)
      case 'cube':
        return this.applyCube(p)
      case 'label':
        return this.applyLabel(p)
      case 'outline':
        return this.applyOutline(p)
      case 'equation':
        return
    }
  }

  /** Output views are owned by an active transition (the input view never animates). */
  private animating(view: ViewRole): boolean {
    return this.transition !== null && view !== 'input'
  }

  private applyPoint(p: PointDesc, desc: ViewDescription): void {
    const map = this.dots[p.view]
    let rec = map.get(p.sourceId)
    const at = f3(p.at)
    if (!rec) {
      const mob = new Dot3D({ point: at, radius: SIZE.dot, color: hex(ROLE_COLOR[p.role]), resolution: 14 })
      this.dotGroups[p.view].add(mob)
      const proxy = new Mesh(this.proxyGeo, this.proxyMat)
      proxy.scale.setScalar(SIZE.pickRadius)
      proxy.name = `pick:${p.id}`
      this.views[p.view].math.add(proxy)
      rec = { mob, proxy, at, color: ROLE_COLOR[p.role], role: p.role, sourceId: p.sourceId, interaction: p.interaction }
      map.set(p.sourceId, rec)
      this.track(this.dotGroups[p.view])
    }
    rec.interaction = p.interaction
    const preview = desc.previewSample === p.sourceId && p.view === 'input'
    const color = this.pointColor(p, preview)
    const radius = this.pointRadius(p)
    // Layout priority of this point's name: the selected sample first, then its exact group, then the rest.
    if (p.label) this.labelMeta.set(`lbl:${p.view}:${p.sourceId}`, { priority: p.emphasis === 'focus' ? 90 : p.emphasis === 'group' ? 60 : 20, mustShow: p.emphasis === 'focus', view: p.view, sourceId: p.sourceId, kind: 'point' })
    if (this.animating(p.view)) {
      rec.at = at
      rec.role = p.role
      // The name rides on the moving dot (comparison) and is laid out again when the playback ends.
      if (p.label && this.mode === 'compare') this.ensureLabel(`lbl:${p.view}:${p.sourceId}`, p.label, p.view, p.sourceId, this.labelColor(p))
      return
    }
    if (!eq3(rec.at, at)) rec.mob.moveToPoint(at)
    if (rec.color !== color) {
      rec.mob.setColor(hex(color))
      rec.color = color
    }
    if (rec.mob.getRadius() !== radius) rec.mob.setRadius(radius)
    if (rec.mob.opacity !== 1) rec.mob.opacity = 1
    rec.at = at
    rec.role = p.role
    // Point labels and rings live in bench space as billboards.
    if (p.label) this.ensureLabel(`lbl:${p.view}:${p.sourceId}`, p.label, p.view, p.sourceId, this.labelColor(p))
    // Linked emphasis: rings on the selected sample and its exact-output group in the input view, and
    // one ring on their shared output (coincident outputs keep every identity; the ring marks the place).
    this.ensureRing(p.view, p.sourceId, p.view === 'input' ? p.emphasis === 'focus' || p.emphasis === 'group' : p.emphasis === 'focus')
  }

  private pointRadius(p: PointDesc): number {
    if (this.mode === 'compare') return p.emphasis === 'focus' ? SIZE.dotCompareSelected : SIZE.dotCompare
    return p.emphasis === 'focus' && p.view === 'input' ? SIZE.dotSelected : p.emphasis === 'focus' || p.emphasis === 'group' ? SIZE.dot * 1.15 : SIZE.dot
  }

  /** Name colour: the sample's identity colour in a comparison, the selection white otherwise. */
  private labelColor(p: PointDesc): number {
    return p.ident !== undefined ? identityColor(p.ident) : palette.selected
  }

  private pointColor(p: PointDesc, preview: boolean): number {
    if (preview) return palette.preview
    // Comparison: one identity colour per labelled sample in every view (selection is shown by size, ring, arrow).
    if (p.ident !== undefined) return identityColor(p.ident)
    if (this.mode === 'compare') return p.emphasis === 'focus' ? palette.selected : palette.neutral
    if (p.view === 'input' && p.emphasis === 'focus') return palette.selected
    const base = p.view === 'input' ? palette.input : palette.output
    return p.emphasis === 'dim' ? new Color(base).lerp(new Color(palette.sky), 0.55).getHex() : base
  }

  private vectorColor(p: VectorDesc): number {
    return p.ident !== undefined ? identityColor(p.ident) : ROLE_COLOR[p.role]
  }

  private applyVector(p: VectorDesc): void {
    const to = f3(p.to)
    const color = this.vectorColor(p)
    let a = this.arrows[p.view]
    if (!a) {
      const mob = this.track(new Arrow3D({ start: f3(p.from), end: to, color: hex(color), shaftRadius: SIZE.arrowShaft, tipRadius: SIZE.arrowTip, tipLength: SIZE.arrowTipLength, radialSegments: 12 }))
      this.views[p.view].math.add(mob.getThreeObject())
      a = { mob, to, role: p.role, color }
      this.arrows[p.view] = a
      return
    }
    a.mob.getThreeObject().visible = true
    a.role = p.role
    if (this.animating(p.view)) return
    if (!eq3(a.to, to)) {
      a.mob.setEnd(to)
      this.stats.arrowRebuilds++
      a.to = to
    }
    if (a.color !== color) {
      a.mob.setColor(hex(color))
      a.color = color
    }
  }

  /** A closed outline through samples (comparison); while a transition owns the view it follows the live dots. */
  private applyOutline(p: OutlineDesc): void {
    const pts = p.points.map(f3)
    const segs = (q: V3[]) => q.map((c, i) => [c, q[(i + 1) % q.length]!] as [V3, V3])
    let o = this.outlines.get(p.id)
    if (!o || o.view !== p.view) {
      if (o) this.untrack(o.mob)
      const mob = this.track(segmentsVMobject(segs(pts), palette.outline, SIZE.lineOutline))
      this.views[p.view].math.add(mob.getThreeObject())
      o = { mob, view: p.view, ids: [...p.vertexIds], points: pts }
      this.outlines.set(p.id, o)
      return
    }
    o.mob.getThreeObject().visible = true
    o.ids = [...p.vertexIds]
    if (this.animating(p.view)) return
    if (o.points.length !== pts.length || !pts.every((c, i) => eq3(c, o!.points[i]!))) {
      setSegments(o.mob, segs(pts))
      o.points = pts
    }
  }

  private applySegment(p: SegmentDesc): void {
    const from = f3(p.from)
    const to = f3(p.to)
    if (!this.fiber) {
      const mob = this.track(new Line3D({ start: from, end: to, color: hex(ROLE_COLOR[p.role]), lineWidth: SIZE.lineFiber }))
      this.views[p.view].math.add(mob.getThreeObject())
      this.fiber = { mob, from, to }
    } else if (!eq3(this.fiber.from, from) || !eq3(this.fiber.to, to)) {
      this.fiber.mob.setStart(from)
      this.fiber.mob.setEnd(to)
      this.fiber.from = from
      this.fiber.to = to
    }
    this.fiber.mob.getThreeObject().visible = true
    this.ensureFiberCaption(this.current?.fiberAxis ?? null)
  }

  private applyPlane(p: PlaneDesc): void {
    const h = p.halfExtent
    const axis = p.normalAxis
    const at = (u: number, v: number): V3 => (axis === 2 ? [u, v, 0] : axis === 1 ? [u, 0, v] : [0, u, v])
    if (!this.plane || this.plane.axis !== axis) {
      if (this.plane) {
        this.untrack(this.plane.mob)
        this.untrack(this.plane.border)
      }
      const mob = this.track(new Surface3D({ func: at, uRange: [-h, h], vRange: [-h, h], uResolution: 1, vResolution: 1, color: hex(palette.plane), opacity: SIZE.planeOpacity }))
      // A translucent Surface3D carries a depth-only pre-pass mesh (self-occlusion for curved surfaces). On
      // this flat patch it only hid text: labels are transparent and drawn after it, so any label behind
      // the plane was depth-rejected while the dots behind it stayed visible (worst under Q, whose x = 0
      // plane stands upright through the output labels). The plane stays colour-only.
      mob.getThreeObject().traverse((o) => {
        const m = (o as { material?: { userData?: Record<string, unknown> } }).material
        if (m?.userData?.depthPrepass) o.visible = false
      })
      const corners = [at(-h, -h), at(h, -h), at(h, h), at(-h, h)]
      const border = this.track(segmentsVMobject(corners.map((c, i) => [c, corners[(i + 1) % 4]!] as [V3, V3]), palette.plane, SIZE.linePlane))
      this.views[p.view].math.add(mob.getThreeObject(), border.getThreeObject())
      this.plane = { mob, border, axis, opacity: SIZE.planeOpacity }
    }
    const an = ['x', 'y', 'z'][axis]
    const sym = this.current?.mapSymbol ?? ''
    this.texLabel('lbl:plane', `\\textsf{image of }${sym}:\\ ${an} = 0`, `image of ${sym}: ${an} = 0`, SIZE.texCaption, palette.plane, { view: p.view, at: at(h, -h), offset: [0.0, -0.022] })
    if (!this.animating(p.view)) this.setPlaneOpacity(SIZE.planeOpacity)
  }

  private setPlaneOpacity(o: number): void {
    if (!this.plane) return
    this.plane.opacity = o
    this.plane.mob.opacity = o
    const vis = o > 0.001
    this.plane.mob.getThreeObject().visible = vis
    this.plane.border.opacity = Math.min(1, o / SIZE.planeOpacity)
    this.plane.border.getThreeObject().visible = vis
  }

  private applyCube(p: CubeDesc): void {
    const corners = p.corners.map(f3)
    if (p.id === 'cube:ghost') {
      if (!this.ghost) {
        // Dimmer than the live wireframe by colour, not opacity (semi-transparent Line2 needs stencil tricks).
        this.ghost = this.track(segmentsVMobject(p.edges.map(([i, j]) => [corners[i]!, corners[j]!]), new Color(palette.neutral).lerp(new Color(palette.sky), 0.62).getHex(), SIZE.lineGhost))
        this.views[p.view].math.add(this.ghost.getThreeObject())
      }
      this.ghost.getThreeObject().visible = true
      return
    }
    let c = this.cubes[p.view]
    if (!c) {
      const mob = this.track(segmentsVMobject(p.edges.map(([i, j]) => [corners[i]!, corners[j]!]), palette.neutral, SIZE.lineCube))
      this.views[p.view].math.add(mob.getThreeObject())
      c = { mob, corners, edges: p.edges }
      this.cubes[p.view] = c
      return
    }
    c.mob.getThreeObject().visible = true
    if (this.animating(p.view)) return
    if (c.corners.length !== corners.length || !corners.every((k, i) => eq3(k, c!.corners[i]!))) {
      setSegments(c.mob, p.edges.map(([i, j]) => [corners[i]!, corners[j]!]))
      c.corners = corners
    }
  }

  private buildAxes(): void {
    for (const role of ROLES) {
      const L = 1.45
      const segs: [V3, V3][] = [[[-L, 0, 0], [L, 0, 0]], [[0, -L, 0], [0, L, 0]], [[0, 0, -L], [0, 0, L]]]
      const vm = this.track(segmentsVMobject(segs, palette.axis, SIZE.lineAxis))
      this.views[role].math.add(vm.getThreeObject())
      this.axes.push(vm)
      for (const [i, name] of ['x', 'y', 'z'].entries()) {
        // Beyond the image-plane patch (half extent 1.6) on every axis: under Q the plane x = 0 stands
        // upright and its top border at z = 1.6 ran through a z name at 1.59 (audit).
        const T = 1.85
        const tip: V3 = [i === 0 ? T : 0, i === 1 ? T : 0, i === 2 ? T : 0]
        this.tokenLabel(`axis:${role}:${name}`, [{ tex: name, color: palette.axisLabel }], name, SIZE.texAxis, { view: role, at: tip, offset: this.axisLabelOffset(role, tip, name === 'y' ? [0.02, 0.008] : [0, 0]) })
      }
    }
  }

  /**
   * Axis names sit at fixed tips, but the selected fiber runs through the selected point and is longer than
   * the axes, so it can cross a name: z under P with w₃ selected, x under Q at the origin (device review),
   * and, on screen though not in 3D, a fiber slightly in front of or behind the axis (audit). Seen from this
   * frame's head, the name steps perpendicular to the fiber, away from it, until it clears the line by half
   * its width plus a margin: right of a steep line and below a level one when the name is on the line (the
   * fiber caption sits above it). The side taken is kept while the name stays displaced, so a small head
   * movement does not flip it across the line. A fiber along y (depth) is not exercised by the demo.
   */
  private axisLabelOffset(role: ViewRole, tip: V3, base: [number, number]): Offset {
    const key = tip.join()
    return (slot) => {
      const f = this.fiber
      if (role !== 'input' || !f || !f.mob.getThreeObject().visible || !this.headSeen) {
        this.axisSide.delete(key)
        return base
      }
      // Bench space: the name's resting place (as placeInView puts it), the fiber's ends (as its own group
      // draws them) and the head.
      const v = this.views.input
      v.root.updateMatrixWorld()
      const n = this.bench.worldToLocal(embed(tip, axisTmp[0]).applyMatrix4(v.root.matrixWorld))
      n.x += base[0]
      n.y += base[1]
      n.z += 0.004
      const a = this.bench.worldToLocal(v.math.localToWorld(axisTmp[1].set(...f.from)))
      const b = this.bench.worldToLocal(v.math.localToWorld(axisTmp[2].set(...f.to)))
      const h = this.bench.worldToLocal(axisTmp[3].copy(this.headAt))
      // Screen axes at the name, seen from the head; the fiber's ends projected (perspective) onto that plane.
      const d = axisTmp[4].subVectors(n, h)
      const nd = d.length()
      d.divideScalar(nd || 1)
      const r = axisTmp[5].crossVectors(d, BENCH_UP)
      if (r.lengthSq() < 1e-8) return base
      r.normalize()
      const u = axisTmp[6].crossVectors(r, d)
      const onScreen = (p: Vector3): [number, number] => {
        const pd = (p.x - h.x) * d.x + (p.y - h.y) * d.y + (p.z - h.z) * d.z
        const s = pd > 1e-6 ? nd / pd : 1
        const qx = h.x + (p.x - h.x) * s - n.x
        const qy = h.y + (p.y - h.y) * s - n.y
        const qz = h.z + (p.z - h.z) * s - n.z
        return [qx * r.x + qy * r.y + qz * r.z, qx * u.x + qy * u.y + qz * u.z]
      }
      const [ax, ay] = onScreen(a)
      const [bx, by] = onScreen(b)
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0
      const ex = -(ax + t * dx)
      const ey = -(ay + t * dy)
      const clear = (slot?.width || 0.012) / 2 + 0.012
      if (Math.hypot(ex, ey) >= clear) {
        this.axisSide.delete(key)
        return base
      }
      // Unit normal to the fiber on screen. Keep the side already taken unless the line has passed the
      // name by more than 2 mm; otherwise take the name's own side, or the default on the line itself.
      const len = Math.sqrt(len2) || 1
      const nx = -dy / len
      const ny = dx / len
      const side = ex * nx + ey * ny
      let sign = this.axisSide.get(key) ?? 0
      if (sign === 0 || side * sign < -0.002) sign = Math.abs(side) > 1e-6 ? Math.sign(side) : (Math.abs(dy) >= Math.abs(dx) ? nx : -ny) >= 0 ? 1 : -1
      this.axisSide.set(key, sign)
      const step = clear - side * sign
      // Offsets live in bench (x, y): move along the screen normal's bench (x, y) part, scaled so that the
      // on-screen move is the full step (the view is turned, so that part is shorter than 1).
      const wx = (nx * r.x + ny * u.x) * sign
      const wy = (nx * r.y + ny * u.y) * sign
      const k = step / (wx * wx + wy * wy || 1)
      return [base[0] + wx * k, base[1] + wy * k]
    }
  }

  /** Which side of the fiber each displaced axis name took (+1/-1 along the fiber's screen normal). */
  private readonly axisSide = new Map<string, number>()
  /** This frame's head (world), set by billboard() before labels are placed. */
  private readonly headAt = new Vector3()
  private headSeen = false

  /**
   * View titles: the bound map ("output Q(R^3)"), or in a comparison each route's order in words ("R then S")
   * over its output. Set on every apply (unchanged text costs nothing).
   */
  private setTitles(desc: ViewDescription): void {
    const c = desc.comparison
    if (!c) {
      const symbol = desc.mapSymbol
      this.texLabel('title:input', '\\textsf{input}\\ \\mathbb{R}^3', 'input ℝ³', SIZE.texTitle, palette.textDim)
      this.texLabel('title:output', `\\textsf{output}\\ ${symbol}(\\mathbb{R}^3)`, `output ${symbol}(ℝ³)`, SIZE.texTitle, palette.textDim)
      this.slots.get('title:output2')?.setWanted(false)
      return
    }
    this.texLabel('title:input', '\\textsf{input (both routes)}\\ \\mathbb{R}^3', 'input (both routes) ℝ³', SIZE.texTitle, palette.textDim)
    for (const r of [c.left, c.right]) {
      const words = r.stages.length ? r.stages.map((st) => st.label).join('\\ \\textsf{then}\\ ') : '\\textsf{identity}'
      this.texLabel(`title:${r.view}`, words, r.order, SIZE.texTitle * 1.15, palette.text).setWanted(true)
    }
  }

  private removeMissing(seen: Set<string>, desc: ViewDescription): void {
    if (this.fiber && !seen.has('fiber')) this.fiber.mob.getThreeObject().visible = false
    if (this.plane && !seen.has('plane:image')) this.setPlaneOpacity(0)
    // Objects of the other layout (cubes in a comparison, outlines and the second route in linked views).
    for (const role of ROLES) {
      const c = this.cubes[role]
      if (c && !seen.has(`cube:${PFX[role]}`)) c.mob.getThreeObject().visible = false
      const a = this.arrows[role]
      if (a && !seen.has(`vec:${PFX[role]}`)) a.mob.getThreeObject().visible = false
    }
    if (this.ghost && !seen.has('cube:ghost')) this.ghost.getThreeObject().visible = false
    for (const [id, o] of this.outlines) if (!seen.has(id)) o.mob.getThreeObject().visible = false
    for (const role of ROLES) {
      for (const [id, rec] of this.dots[role]) {
        if (!seen.has(`pt:${PFX[role]}:${id}`)) {
          this.dotGroups[role].remove(rec.mob)
          rec.mob.dispose()
          rec.proxy.removeFromParent()
          this.dots[role].delete(id)
        }
      }
    }
    // Labels/rings that no longer apply.
    const labelled = new Set(desc.primitives.flatMap((p) => (p.kind === 'point' && p.label ? [`lbl:${p.view}:${p.sourceId}`] : [])))
    for (const [id, slot] of this.slots) if (id.startsWith('lbl:input:') || id.startsWith('lbl:output:') || id.startsWith('lbl:output2:')) slot.setWanted(labelled.has(id))
    for (const id of [...this.labelMeta.keys()]) if (!labelled.has(id) && !seen.has(id)) this.labelMeta.delete(id)
    const sel = new Set(desc.primitives.flatMap((p) => (p.kind === 'point' && (p.view === 'input' ? p.emphasis === 'focus' || p.emphasis === 'group' : p.emphasis === 'focus') ? [`${p.view}:${p.sourceId}`] : [])))
    for (const r of this.rings) r.anchor.visible = sel.has(`${r.view}:${r.sourceId}`)
    for (const [id, slot] of this.slots) if (id.startsWith('lbl:grp:') && !seen.has(id)) slot.setWanted(false)
    this.slots.get('lbl:plane')?.setWanted(this.plane !== null && seen.has('plane:image'))
    this.slots.get('lbl:fiber')?.setWanted(seen.has('fiber'))
  }

  // ---------------------------------------------------------------- labels, rings, equations
  // Every piece of scene text is a TextSlot (review C1): it never shows geometry for content other
  // than what it was last given, and shows plain-text pending/error states without MathJax.

  private slot(id: string, plate = false): TextSlot {
    let s = this.slots.get(id)
    if (!s) {
      s = new TextSlot(id, { plate })
      ;(id === 'lbl:voice' || id === 'lbl:assistant' ? this.appLines : FORMAL_SLOT.test(id) ? this.formal : this.labels).add(s.anchor)
      this.slots.set(id, s)
    }
    return s
  }

  /** Readouts with tokens are composed from prebuilt glyphs (synchronous); others are typeset. */
  private equationContent(e: EquationDesc): SlotContent {
    const em = e.id === 'eq:map' || e.id === 'eq:verdict' ? SIZE.texMap : SIZE.texReadout
    if (e.tokens) {
      const tokens = e.tokens.map((t) => ({ tex: t.tex, color: tokenColor(t), space: t.space }))
      return { kind: 'tokens', tokens, em, color: palette.text, plain: e.plain }
    }
    return { kind: 'tex', parts: e.parts.map((p) => ({ tex: p.tex, color: p.role ? ROLE_COLOR[p.role] : undefined })), em, color: palette.text, plain: e.plain }
  }

  private texLabel(id: string, tex: string, plain: string, em: number, color: number, target?: LabelTarget): TextSlot {
    const s = this.slot(id)
    s.set({ kind: 'tex', parts: [{ tex }], em, color, plain })
    if (target) this.labelTargets.set(id, { view: target.view, at: target.at, offset: target.offset ?? [0, 0] })
    return s
  }

  private tokenLabel(id: string, tokens: TokenSpec[], plain: string, em: number, target?: LabelTarget): TextSlot {
    const s = this.slot(id)
    s.set({ kind: 'tokens', tokens, em, color: tokens[0]?.color ?? palette.text, plain })
    if (target) this.labelTargets.set(id, { view: target.view, at: target.at, offset: target.offset ?? [0, 0] })
    return s
  }

  private placeInView(anchor: Group, view: ViewRole, at: V3, offset: Offset = [0, 0], slot?: TextSlot): void {
    const o = typeof offset === 'function' ? offset(slot) : offset
    // math point -> bench space via the view's embedding and placement (display floats only)
    this.benchPoint(view, at, tmpV)
    anchor.position.set(tmpV.x + o[0], tmpV.y + o[1], tmpV.z + (o[2] ?? 0) + 0.004)
  }

  /** A view's mathematical point in bench space (display floats only). */
  private benchPoint(view: ViewRole, at: V3, out: Vector3): Vector3 {
    const v = this.views[view]
    v.root.updateMatrixWorld()
    out.copy(embed(at)).applyMatrix4(v.root.matrixWorld)
    return this.bench.worldToLocal(out)
  }

  private labelTargets = new Map<string, { view: ViewRole; at: V3 | (() => V3); offset: Offset }>()

  /** A point's name. Its offset is the label layout's decision (the resting offset until one is made). */
  private ensureLabel(id: string, text: string, view: ViewRole, sourceId: string, color: number = palette.selected): void {
    this.tokenLabel(id, [{ tex: text, color }], plainName(text), SIZE.texLabel, { view, at: () => this.livePoint(view, sourceId), offset: this.laidOut(id, POINT_LABEL_OFFSET) })
  }

  /** An output-location label ("Pu = Pv", "Qa = Qb"): glyph tokens composed synchronously, riding on the live dot. */
  private applyLabel(p: LabelDesc): void {
    const dim = mixHex(palette.output, palette.textDim, 0.45)
    const tokens: TokenSpec[] = p.tokens.map((t) => ({ tex: t.tex, color: p.emphasis === 'focus' ? (t.role ? ROLE_COLOR[t.role] : palette.text) : Number.parseInt(dim.slice(1), 16), space: t.space }))
    // The selected output relationship always stays readable; other location labels (multi-name ones too)
    // give way to it, then to each other.
    this.labelMeta.set(p.id, { priority: p.emphasis === 'focus' ? 100 : 30 + Math.min(9, p.tokens.length), mustShow: p.emphasis === 'focus', view: p.view, sourceId: p.anchorSourceId, kind: 'group' })
    const s = this.tokenLabel(p.id, tokens, p.plain, SIZE.texLabel * (p.emphasis === 'focus' ? 0.9 : 0.8), { view: p.view, at: () => this.livePoint(p.view, p.anchorSourceId), offset: this.laidOut(p.id, GROUP_LABEL_OFFSET) })
    s.setWanted(true)
    if (this.transition && p.view === 'output') this.applyLabelOpacity(p.id)
  }

  /** Output-location labels fade out while outputs move and back in at the annotate phase. */
  private groupLabelOpacity = 1

  private setGroupLabelOpacity(o: number): void {
    this.groupLabelOpacity = o
    for (const id of this.slots.keys()) if (id.startsWith('lbl:grp:')) this.applyLabelOpacity(id)
  }

  /** A floating label's opacity: the transition's fade (location labels) times the layout's fade. */
  private applyLabelOpacity(id: string): void {
    const s = this.slots.get(id)
    if (!s) return
    const base = id.startsWith('lbl:grp:') ? this.groupLabelOpacity : 1
    s.setOpacity(base * (this.labelAlpha.get(id)?.now ?? 1))
  }

  // ---------------------------------------------------------------- label layout (presentation only)

  /** Per floating label: priority and anchor, refreshed by every apply. */
  private readonly labelMeta = new Map<string, { priority: number; mustShow: boolean; view: ViewRole; sourceId: string; kind: 'point' | 'group' }>()
  /** The current layout decision per label, the bench-space offset it gives at the decision's pose, and where
   * its point was (bench space): hysteresis holds a place only while the point itself stays put. */
  private readonly placements = new Map<string, Placement & { offset: [number, number, number]; anchor: Vector3 }>()
  private readonly labelAlpha = new Map<string, { now: number; target: number }>()
  private layoutDirty = true
  private layoutFrame = 0
  private readonly layoutPose = { at: new Vector3(NaN, NaN, NaN), dir: new Vector3() }
  private layoutSizes = ''
  private readonly leaders = new Map<string, Mesh>()
  private readonly leaderGeo = new CylinderGeometry(1, 1, 1, 6, 1, true)
  private readonly leaderMat = new MeshBasicMaterial({ color: palette.leader, transparent: true, opacity: 0.85, depthWrite: false })

  /**
   * The offset function of a laid-out label: the layout's decision, or the resting offset before one exists.
   * While a comparison plays, a point's name instead stays on the side away from its view's origin, so names
   * ride outside the turning square (the layout runs again when the playback ends).
   */
  private laidOut(id: string, resting: [number, number]): Offset {
    return (slot) => (this.transition?.spec.kind === 'compare_steps' && slot ? this.outwardOffset(id, slot) : null) ?? this.placements.get(id)?.offset ?? resting
  }

  private outwardOffset(id: string, slot: TextSlot): [number, number] | null {
    const m = this.labelMeta.get(id)
    if (!m || m.kind !== 'point') return null
    const a = this.benchPoint(m.view, this.livePoint(m.view, m.sourceId), axisTmp[5])
    const o = this.benchPoint(m.view, [0, 0, 0], axisTmp[6])
    const dx = a.x - o.x
    const dy = a.y - o.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-3) return null
    const ux = dx / len
    const uy = dy / len
    const clear = SIZE.ringRadius + 0.006
    return [ux * (clear + slot.width / 2), uy * (clear + slot.height / 2)]
  }

  /**
   * One shared layout decision for both eyes, from the head position this frame (bench space). Runs when the
   * description changed, a label's size changed, or the head moved or turned beyond a small threshold, at most
   * every few frames and never while a transition owns the outputs (labels then keep their sides).
   */
  private runLayout(head: Vector3): void {
    this.layoutFrame++
    if (!this.layoutDebug.enabled) {
      // Dev comparison only: every label at its resting offset, none faded (the scene without the layout).
      this.placements.clear()
      for (const id of this.labelMeta.keys()) this.labelAlpha.set(id, { now: 1, target: 1 })
      this.layoutDirty = true
      return
    }
    if (this.transition) return
    const h = this.bench.worldToLocal(axisTmp[0].copy(head))
    const d = axisTmp[1].set(0, 0, 0).sub(h).normalize()
    const sizes = [...this.labelMeta.keys()].map((id) => { const sl = this.slots.get(id); return sl ? `${sl.width.toFixed(4)}x${sl.height.toFixed(4)}` : '' }).join()
    const moved = !(h.distanceTo(this.layoutPose.at) < LAYOUT.headMove) || d.angleTo(this.layoutPose.dir) > LAYOUT.headTurn
    const due = this.layoutDirty || sizes !== this.layoutSizes || (moved && this.layoutFrame % LAYOUT.everyFrames === 0)
    if (!due) return
    this.layoutDirty = false
    this.layoutSizes = sizes
    this.layoutPose.at.copy(h)
    this.layoutPose.dir.copy(d)
    this.stats.layoutRuns++
    // Shared screen frame at the viewing pose: right r, up u, forward d (tangent-plane units).
    const r = axisTmp[2].crossVectors(d, BENCH_UP).normalize()
    const u = axisTmp[3].crossVectors(r, d)
    const project = (p: Vector3): [number, number, number] => {
      const sx = p.x - h.x
      const sy = p.y - h.y
      const sz = p.z - h.z
      const z = Math.max(0.05, sx * d.x + sy * d.y + sz * d.z)
      return [(sx * r.x + sy * r.y + sz * r.z) / z, (sx * u.x + sy * u.y + sz * u.z) / z, z]
    }
    // A head-facing label of width w at p spans w * D / z^2 on the tangent plane (D = distance, z = depth along
    // the frame's forward axis): off-axis labels read wider there than w / z.
    const spread = (p: Vector3, z: number) => p.distanceTo(h) / (z * z)
    const par = (z: number) => LAYOUT.ipd / 2 / z
    const p = new Vector3()
    const items: LayoutItem[] = []
    const depth = new Map<string, number>()
    const anchors = new Map<string, Vector3>()
    for (const [id, m] of this.labelMeta) {
      const sl = this.slots.get(id)
      const target = this.labelTargets.get(id)
      if (!sl || !target || !sl.isWanted || sl.state === 'idle' || !this.views[m.view].root.visible) continue
      const at = typeof target.at === 'function' ? target.at() : target.at
      this.benchPoint(m.view, at, p)
      anchors.set(id, p.clone())
      const [x, y, z] = project(p)
      depth.set(id, z)
      const scale = this.layout[this.mode === 'compare' ? 'compare' : 'views'][m.view].scale
      const rest = m.kind === 'group' ? GROUP_LABEL_OFFSET : POINT_LABEL_OFFSET
      // The resting offset as this pose sees it (it is applied in bench space, exactly as before the layout).
      const [lx, ly] = project(axisTmp[5].set(p.x + rest[0], p.y + rest[1], p.z + 0.004))
      // Prefer the side away from the view's origin (comparison corners read outward); else the resting side.
      const [ox, oy] = project(this.benchPoint(m.view, [0, 0, 0], axisTmp[4]))
      const out: [number, number] = this.mode === 'compare' && Math.hypot(x - ox, y - oy) > 1e-4 ? [x - ox, y - oy] : rest
      // The point's footprint: its dot, or its selection ring when it has one.
      const ringed = this.rings.some((x) => x.view === m.view && x.sourceId === m.sourceId && x.anchor.visible)
      const footprint = Math.max((this.mode === 'compare' ? SIZE.dotCompareSelected : SIZE.dotSelected) * scale, ringed ? SIZE.ringRadius : 0)
      const k = spread(p, z)
      items.push({
        id, x, y, hw: (sl.width / 2) * k, hh: (sl.height / 2) * k, r: footprint / z, par: par(z),
        priority: m.priority, mustShow: m.mustShow, prefer: out, legacy: this.mode === 'linked' ? [lx - x, ly - y] : undefined, owner: `${m.view}:${m.sourceId}`,
      })
    }
    // Obstacles: fixed text (readouts, titles, captions, axis names) and the selected relationship's dots.
    const obstacles: Obstacle[] = []
    for (const [id, sl] of this.slots) {
      if (this.labelMeta.has(id) || id.startsWith('lbl:mov:') || !sl.anchor.visible || !sl.width) continue
      if (!this.formal.visible && sl.anchor.parent === this.formal) continue
      const [x, y, z] = project(sl.anchor.position)
      const pad = LAYOUT.textPad
      const k = spread(sl.anchor.position, z)
      obstacles.push({ x0: x - (sl.width / 2) * k - pad, x1: x + (sl.width / 2) * k + pad, y0: y - (sl.height / 2) * k - pad, y1: y + (sl.height / 2) * k + pad, par: par(z) })
    }
    for (const role of ROLES) {
      if (!this.views[role].root.visible) continue
      const scale = this.layout[this.mode === 'compare' ? 'compare' : 'views'][role].scale
      for (const rec of this.dots[role].values()) {
        const ring = this.rings.find((x) => x.view === role && x.sourceId === rec.sourceId)
        if (!ring?.anchor.visible) continue
        const [x, y, z] = project(this.benchPoint(role, livePos(rec.mob), p))
        const rad = Math.max(rec.mob.getRadius() * scale, SIZE.ringRadius) / z
        obstacles.push({ x0: x - rad, x1: x + rad, y0: y - rad, y1: y + rad, owner: `${role}:${rec.sourceId}`, par: par(z) })
      }
    }
    // A point that moved in the scene (an edit, a reversed route, another selection's group) is placed afresh;
    // head movement does not move points in bench space, so it keeps the previous places.
    const prev = new Map([...this.placements].filter(([id, pl]) => (anchors.get(id)?.distanceTo(pl.anchor) ?? Infinity) < 0.004).map(([id, pl]) => [id, pl as Placement]))
    const next = layoutLabels(items, obstacles, prev, LAYOUT)
    for (const [id, pl] of next) {
      const old = this.placements.get(id)
      if (!old || old.key !== pl.key || old.shown !== pl.shown) this.stats.layoutChanges++
      const z = depth.get(id)!
      const offset: [number, number, number] = pl.key === 'legacy'
        ? [...(this.labelMeta.get(id)!.kind === 'group' ? GROUP_LABEL_OFFSET : POINT_LABEL_OFFSET), 0]
        : [(r.x * pl.dx + u.x * pl.dy) * z, (r.y * pl.dx + u.y * pl.dy) * z, (r.z * pl.dx + u.z * pl.dy) * z]
      this.placements.set(id, { ...pl, offset, anchor: anchors.get(id)! })
      const a = this.labelAlpha.get(id)
      const target = pl.shown ? 1 : 0
      // A label seen for the first time starts in its decided state (no flash in, no fade from nothing).
      if (!a) this.labelAlpha.set(id, { now: target, target })
      else a.target = target
    }
    for (const id of [...this.placements.keys()]) if (!next.has(id)) this.placements.delete(id)
  }

  /** Ease layout fades (before labels are placed, so a label fading in is placed on its first visible frame). */
  private stepLabelFades(dt: number): void {
    for (const [id, a] of this.labelAlpha) {
      if (!this.labelMeta.has(id)) {
        this.labelAlpha.delete(id)
        continue
      }
      if (a.now !== a.target) {
        const stepA = Math.min(1, dt * LAYOUT.fadePerSecond)
        a.now = Math.abs(a.target - a.now) <= stepA ? a.target : a.now + Math.sign(a.target - a.now) * stepA
      }
      this.applyLabelOpacity(id)
    }
  }

  /** Leaders for labels placed in the far ring (bench space, both eyes alike); none while a transition plays. */
  private placeLeaders(): void {
    for (const mesh of this.leaders.values()) mesh.visible = false
    if (this.transition) return
    for (const [id, pl] of this.placements) {
      if (!pl.leader || !pl.shown) continue
      const s = this.slots.get(id)
      const m = this.labelMeta.get(id)
      if (!s?.anchor.visible || !m) continue
      let mesh = this.leaders.get(id)
      if (!mesh) {
        mesh = new Mesh(this.leaderGeo, this.leaderMat)
        mesh.name = `leader:${id}`
        mesh.renderOrder = 4
        this.labels.add(mesh)
        this.leaders.set(id, mesh)
      }
      // From the dot's edge toward the label, stopping at the label's near edge.
      const a = this.benchPoint(m.view, this.livePoint(m.view, m.sourceId), axisTmp[5])
      const b = axisTmp[6].copy(s.anchor.position)
      const dir = b.clone().sub(a)
      const len = dir.length()
      if (len < 1e-4) continue
      dir.divideScalar(len)
      const hx = Math.abs(dir.x) > 1e-6 ? s.width / 2 / Math.abs(dir.x) : Infinity
      const hy = Math.abs(dir.y) > 1e-6 ? s.height / 2 / Math.abs(dir.y) : Infinity
      const start = 0.008
      const end = Math.max(start, len - Math.min(hx, hy) - 0.003)
      if (end - start < 0.004) continue
      mesh.position.copy(a).addScaledVector(dir, (start + end) / 2)
      mesh.quaternion.setFromUnitVectors(UP, dir)
      mesh.scale.set(SIZE.leaderRadius, end - start, SIZE.leaderRadius)
      ;(mesh.material as MeshBasicMaterial).opacity = 0.85 * (this.labelAlpha.get(id)?.now ?? 1)
      mesh.visible = true
    }
  }

  /** Dev: switch the label layout off to compare with labels at their resting offsets (verification only). */
  readonly layoutDebug = { enabled: true }

  /** Layout state for verification: each floating label's decision and fade. */
  labelLayoutReport() {
    return [...this.placements].map(([id, pl]) => ({ id, key: pl.key, shown: pl.shown, leader: pl.leader, alpha: +(this.labelAlpha.get(id)?.now ?? 1).toFixed(3), priority: this.labelMeta.get(id)?.priority ?? null, mustShow: this.labelMeta.get(id)?.mustShow ?? false }))
  }

  private livePoint(view: ViewRole, sourceId: string): V3 {
    const rec = this.dots[view].get(sourceId)
    return rec ? livePos(rec.mob) : [0, 0, 0]
  }

  private ensureFiberCaption(axis: number | null): void {
    if (axis === null || !this.fiber) return
    const n = ['x', 'y', 'z'][axis]!
    const to = this.fiber.to
    this.texLabel('lbl:fiber', `${n}\\textsf{-fiber, the part with }|${n}| \\le 4`, `${n}-fiber, the part with |${n}| ≤ 4`, SIZE.texCaption, palette.fiber, {
      view: 'input',
      at: () => to,
      offset: (slot) => [-((slot?.width || 0.12) / 2 + 0.014), 0.026],
    })
  }

  private ensureRing(view: ViewRole, sourceId: string, on: boolean): void {
    let r = this.rings.find((x) => x.view === view && x.sourceId === sourceId)
    if (!r && on) {
      const mob = this.track(new Circle({ radius: SIZE.ringRadius, color: hex(palette.selected), strokeWidth: SIZE.lineRing * 100, fillOpacity: 0 }))
      ;(mob as unknown as { _setSceneContext(w: number, h: number, fw: number): void })._setSceneContext(1, 1, 1)
      const anchor = new Group()
      anchor.name = `ring:${view}:${sourceId}`
      anchor.add(mob.getThreeObject())
      this.labels.add(anchor)
      r = { mob, anchor, view, sourceId }
      this.rings.push(r)
    }
    if (r) r.anchor.visible = on
  }

  private applySlots(desc: ViewDescription): void {
    const eqs = desc.primitives.filter((p): p is EquationDesc => p.kind === 'equation')
    const want = new Set(eqs.map((e) => e.id))
    for (const e of eqs) {
      const s = this.slot(e.id, true)
      s.set(this.equationContent(e))
      s.setWanted(true)
      // Uncommitted preview values get a distinct (cyan-tinted) plate, not the committed one (review V3).
      s.setPlateColor(e.preview ? 0x123844 : 0x121722)
      const c = this.slot(captionSlot(e.id))
      const capColor = e.preview ? palette.preview : palette.textDim
      if (e.captionTokens) c.set({ kind: 'tokens', tokens: e.captionTokens.map((t) => ({ tex: t.tex, color: capColor, space: t.space })), em: SIZE.texCaption, color: capColor, plain: e.captionPlain })
      else if (e.captionTex) c.set({ kind: 'tex', parts: [{ tex: e.captionTex }], em: SIZE.texCaption, color: capColor, plain: e.captionPlain })
      // A comparison step's caption describes its motion: shown only while that step plays.
      c.setWanted(!!e.captionTex && !e.id.startsWith('eq:step:'))
    }
    for (const [id, s] of this.slots) {
      if (!id.startsWith('eq:') || want.has(id)) continue
      s.setWanted(false)
      this.slots.get(captionSlot(id))?.setWanted(false)
    }
    // At rest every step line of a comparison is shown (playback hides the steps not reached yet).
    if (!this.transition || this.transition.spec.kind !== 'compare_steps') for (const id of want) if (id.startsWith('eq:step:')) this.slots.get(id)?.setOpacity(1)
    this.layoutFixedSlots(desc)
  }

  private layoutFixedSlots(desc: ViewDescription): void {
    const place = (id: string, x: number, y: number, z: number, yaw = 0) => {
      const s = this.slots.get(id)
      if (!s) return
      s.anchor.position.set(x, y, z)
      s.anchor.rotation.set(0, yaw, 0)
    }
    const c = desc.comparison
    if (c) {
      // Three panels: the verdict over the shared input; each route's order, words and product above its
      // output, and its step lines (the selected sample after each map) below. Text sits in front of the
      // tilted views' lower edges, which come toward the viewer.
      place('eq:verdict', 0, 0.318, 0.03)
      place('caption:verdict', 0, 0.262, 0.03)
      place('title:input', 0, 0.148, 0.05)
      place('eq:sel', 0, -0.13, 0.09)
      place('caption:sel', 0, -0.168, 0.09)
      place('lbl:step', 0, -0.205, 0.09)
      for (const [r, x, yaw] of [[c.left, -COMPARE.x, COMPARE.yaw], [c.right, COMPARE.x, -COMPARE.yaw]] as [RouteDesc, number, number][]) {
        const V = r.view
        // Under the shell (route matrices and their captions hidden), the route order sits nearer its view and
        // clear of the question overlay at the top of the page.
        place(`title:${V}`, x, this.formal.visible ? 0.335 : 0.235, 0, yaw)
        place(`caption:route:${V}`, x, 0.286, 0, yaw)
        place(`eq:route:${V}`, x, 0.205, 0, yaw)
        const ids = r.steps ? r.stages.map((_, i) => `eq:step:${V}:${i + 1}`) : [`eq:step:${V}:0`]
        const dy = ids.length > 3 ? 0.03 : 0.037
        ids.forEach((id, i) => place(id, x, -0.17 - dy * i, 0.09, yaw))
        for (const id of ids) place(captionSlot(id), x, -0.17 - dy * ids.length - 0.012, 0.09, yaw)
      }
      return
    }
    place('eq:map', 0, 0.318, 0.03)
    place('caption:map', 0, 0.245, 0.03)
    place('title:input', -0.3, -0.158, 0.07, 0.22)
    place('title:output', 0.3, -0.158, 0.07, -0.22)
    place('eq:sel', -0.34, -0.212, 0.075, 0.22)
    place('caption:sel', -0.34, -0.252, 0.08, 0.22)
    place('eq:out', 0.34, -0.212, 0.075, -0.22)
    place('caption:out', 0.34, -0.252, 0.08, -0.22)
  }

  /**
   * Evidence status in the scene (ACCEPTANCE A5): "Lean checked: u ≠ v and Pu = Pv" under the map caption.
   * The text comes from the evidence client (structured state), never from model prose.
   */
  setEvidenceLine(line: { tex: string; plain: string; kind: 'checked' | 'pending' | 'other' } | null): void {
    if (!line) {
      this.slots.get('lbl:evidence')?.setWanted(false)
      return
    }
    const color = line.kind === 'checked' ? palette.plane : line.kind === 'pending' ? palette.preview : palette.textDim
    const s = this.texLabel('lbl:evidence', line.tex, line.plain, SIZE.texCaption, color)
    s.anchor.position.set(0, 0.205, 0.03)
    s.setWanted(true)
  }

  /**
   * The push-to-talk caption above the assistant line: plain canvas text (never typeset), redrawn only when
   * the text or state changes. Recording and errors are tinted; a transcript reads like scene text.
   */
  setVoiceLine(line: VoiceLine | null): void {
    if (!line) {
      this.slots.get('lbl:voice')?.setWanted(false)
      return
    }
    const color = line.state === 'recording' ? palette.voiceRecording : line.state === 'error' ? palette.voiceError : line.state === 'pending' ? palette.preview : palette.text
    const s = this.slot('lbl:voice')
    s.set({ kind: 'plain', plain: line.text.slice(0, 160), em: SIZE.texCaption, color })
    s.anchor.position.set(0, 0.448, 0.02)
    s.setWanted(true)
  }

  /** Assistant outcome in the scene: provenance first ("Synthetic response - not live Muse"), then the
   * application-generated action summary. Plain words only (escaped), never executable content. */
  setAssistantLine(line: { text: string; synthetic: boolean } | null): void {
    if (!line) {
      this.slots.get('lbl:assistant')?.setWanted(false)
      return
    }
    const s = this.texLabel('lbl:assistant', `\\textsf{${texEscapeText(line.text)}}`, line.text, SIZE.texCaption, line.synthetic ? palette.preview : palette.text)
    s.anchor.position.set(0, 0.405, 0.02)
    s.setWanted(true)
  }

  /**
   * Show or hide the linear-map views (input/output panels, their text, leaders and rings) while a group or
   * braid demonstration is on the workbench. The voice and assistant lines stay. Hidden views are not picked.
   */
  setLinearVisible(visible: boolean): void {
    if (visible === !this.linearHidden) return
    this.linearHidden = !visible
    this.labels.visible = visible
    for (const role of ROLES) this.views[role].root.visible = visible && (role !== 'output2' || this.mode === 'compare')
    this.renderDirty = true
  }

  /**
   * Presentation options from the UI shell (src/ui/model.ts ScenePresentation). Under the shell the formal
   * readouts (FORMAL_SLOT) move to the mathematics inspector; with the scene's own controls they show as
   * before. Nothing else changes (geometry, motion, picking, the exact description and edit-during-playback
   * behaviour are untouched).
   */
  setPresentation(p: ScenePresentation): void {
    if (p.inSceneControls === this.presentation.inSceneControls && p.detailsOpen === this.presentation.detailsOpen) return
    this.presentation = { ...p }
    this.formal.visible = p.inSceneControls
    if (this.current) this.layoutFixedSlots(this.current)
    this.layoutDirty = true
    this.renderDirty = true
  }

  /** Whether the formal readouts are shown (verification). */
  get formalReadoutsVisible(): boolean {
    return this.formal.visible
  }

  get linearVisible(): boolean {
    return !this.linearHidden
  }

  /** Every slot's freshness state (verification). */
  slotReport() {
    return [...this.slots.values()].map((s) => s.report())
  }

  private billboard(head: Vector3, dt = 0): void {
    this.headAt.copy(head)
    this.headSeen = true
    this.runLayout(head)
    this.stepLabelFades(dt)
    for (const [id, target] of this.labelTargets) {
      const s = this.slots.get(id)
      if (!s || !s.anchor.visible) continue
      const at = typeof target.at === 'function' ? target.at() : target.at
      this.placeInView(s.anchor, target.view, at, target.offset, s)
    }
    for (const r of this.rings) {
      if (!r.anchor.visible) continue
      const rec = this.dots[r.view].get(r.sourceId)
      if (rec) this.placeInView(r.anchor, r.view, livePos(rec.mob))
    }
    // Face the head pose of this frame: one orientation shared by both eyes (never per-eye billboards).
    for (const [id] of this.labelTargets) {
      const s = this.slots.get(id)
      if (s?.anchor.visible) s.anchor.lookAt(head)
    }
    for (const r of this.rings) if (r.anchor.visible) r.anchor.lookAt(head)
    this.placeLeaders()
    this.stats.billboards++
  }

  // ---------------------------------------------------------------- transitions

  private startTransition(desc: ViewDescription, spec: TransitionSpec): void {
    this.transition = null
    this.stats.transitionsStarted++
    if (spec.kind === 'compare_steps') {
      this.lastStepDuration = spec.stepDuration
      const c = desc.comparison!
      const t: ActiveTransition = { spec, desc, duration: compareDuration(Math.max(c.left.steps, c.right.steps), spec.stepDuration), time: 0, evaluatedTime: NaN, playing: true, phaseIndex: -1, anims: [] }
      this.transition = t
      this.resetCompareToInput(desc)
      this.evaluateTransition(t)
      return
    }
    const t: ActiveTransition = { spec, desc, duration: spec.duration, time: 0, evaluatedTime: NaN, playing: true, phaseIndex: -1, anims: [] }
    this.transition = t
    this.resetOutputToSource(desc)
    this.evaluateTransition(t)
  }

  // ---------------------------------------------------------------- comparison playback

  /** Step 0: both route views show the input (dots, outlines and the selected arrow at the input's places). */
  private resetCompareToInput(desc: ViewDescription): void {
    const inputAt = new Map(desc.primitives.filter((p): p is PointDesc => p.kind === 'point' && p.view === 'input').map((p) => [p.sourceId, f3(p.at)]))
    for (const role of ['output', 'output2'] as const) {
      for (const [id, rec] of this.dots[role]) {
        const at = inputAt.get(id)
        if (at) rec.mob.moveToPoint(at)
      }
    }
    this.setStepText(desc, 0, true)
  }

  /** Where a sample is presented in a route view at this clock (exact stage positions at every boundary). */
  private comparePos(r: RouteDesc, input: Map<string, V3>, id: string, index: number, alpha: number): V3 {
    const n = r.stages.length
    if (index === 0 || n === 0) return input.get(id) ?? [0, 0, 0]
    if (index > n) return f3(r.stages[n - 1]!.at[id] ?? [0, 0, 0])
    const st = r.stages[index - 1]!
    const from = index === 1 ? input.get(id) ?? [0, 0, 0] : f3(r.stages[index - 2]!.at[id] ?? [0, 0, 0])
    return stepPosition(st.motion, from, st.at[id] ?? from, alpha)
  }

  private evaluateCompare(t: ActiveTransition & { spec: { kind: 'compare_steps' } }): void {
    const desc = t.desc
    const c = desc.comparison!
    const k = compareClock(Math.max(c.left.steps, c.right.steps), t.spec.stepDuration, t.time)
    const eased = smooth(k.alpha)
    const input = new Map(desc.primitives.filter((p): p is PointDesc => p.kind === 'point' && p.view === 'input').map((p) => [p.sourceId, f3(p.at)]))
    for (const r of [c.left, c.right]) {
      const V = r.view
      for (const [id, rec] of this.dots[V]) {
        const pos = this.comparePos(r, input, id, k.index, eased)
        if (!eq3(livePos(rec.mob), pos)) {
          rec.mob.moveToPoint(pos)
          this.stats.dotMoves++
        }
      }
      for (const o of this.outlines.values()) {
        if (o.view !== V) continue
        setSegments(o.mob, o.ids.map((id, i) => [this.comparePos(r, input, id, k.index, eased), this.comparePos(r, input, o.ids[(i + 1) % o.ids.length]!, k.index, eased)] as [V3, V3]))
      }
      const vec = desc.primitives.find((p): p is VectorDesc => p.kind === 'vector' && p.view === V)
      const a = this.arrows[V]
      if (vec && a) {
        const end = this.comparePos(r, input, vec.sourceId, k.index, eased)
        if (!eq3(a.to, end)) {
          a.mob.setEnd(end)
          a.to = end
          this.stats.arrowRebuilds++
        }
      }
    }
    this.setStepText(desc, k.index, k.holding)
  }

  /**
   * Step text during playback: the indicator names the step; a route's step line appears once that step's
   * exact result is on show, and its motion caption while the step plays. Changes only when the step does.
   */
  private setStepText(desc: ViewDescription, index: number, holding: boolean): void {
    const c = desc.comparison!
    const key = `${desc.revision}|${index}|${holding}`
    if (key === this.stepTextKey) return
    this.stepTextKey = key
    const n = Math.max(c.left.steps, c.right.steps)
    const W = (tex: string): TokenSpec => ({ tex, color: palette.text, space: 'word' })
    const N = (tex: string, color: number = palette.text): TokenSpec => ({ tex, color })
    const tokens: TokenSpec[] = index === 0 ? [W(PHRASE.inputStep)] : [
      W(PHRASE.step), N(String(index)), W(PHRASE.of), N(String(n)), { tex: ':', color: palette.text, space: 'punct' },
      ...[[PHRASE.left, c.left] as const, [PHRASE.right, c.right] as const].flatMap(([word, r], i) => {
        const st = r.stages[index - 1]
        return st ? [...(i ? [{ tex: ',', color: palette.text, space: 'punct' as const }] : []), W(word), N(st.label, palette.output)] : []
      }),
    ]
    const plain = stepLabel(c, index)
    const s = this.tokenLabel('lbl:step', tokens, plain, SIZE.texCaption * 1.1)
    s.setWanted(true)
    s.anchor.position.set(0, -0.205, 0.09)
    for (const r of [c.left, c.right]) {
      const V = r.view
      if (!r.steps) {
        this.slots.get(`eq:step:${V}:0`)?.setOpacity(1)
        continue
      }
      r.stages.forEach((_, i) => {
        const step = i + 1
        this.slots.get(`eq:step:${V}:${step}`)?.setOpacity(step < index || (step === index && holding) ? 1 : 0)
        this.slots.get(`caption:step:${V}:${step}`)?.setWanted(step === index)
      })
    }
  }

  private stepTextKey = ''

  /** Back to the rest state of the comparison text: every step line, no motion captions, no indicator. */
  private restStepText(): void {
    this.stepTextKey = ''
    this.slots.get('lbl:step')?.setWanted(false)
    for (const [id, s] of this.slots) {
      if (id.startsWith('eq:step:')) s.setOpacity(1)
      else if (id.startsWith('caption:step:')) s.setWanted(false)
    }
  }

  /** Output view starts where the input is: points at v, cube at the input corners, vector at u. */
  private resetOutputToSource(desc: ViewDescription): void {
    const inputDescs = new Map(desc.primitives.filter((p): p is PointDesc => p.kind === 'point' && p.view === 'input').map((p) => [p.sourceId, p]))
    for (const [id, rec] of this.dots.output) {
      const src = inputDescs.get(id)
      if (src) {
        rec.mob.moveToPoint(f3(src.at))
        rec.mob.setColor(hex(this.pointColor(src, false)))
        rec.color = NaN
      }
      rec.mob.setRadius(SIZE.dot)
      rec.mob.opacity = 0
    }
    const cubeIn = desc.primitives.find((p): p is CubeDesc => p.kind === 'cube' && p.view === 'input')
    const co = this.cubes.output
    if (cubeIn && co) setSegments(co.mob, cubeIn.edges.map(([i, j]) => [f3(cubeIn.corners[i]!), f3(cubeIn.corners[j]!)]))
    const vin = desc.primitives.find((p): p is VectorDesc => p.kind === 'vector' && p.view === 'input')
    const ao = this.arrows.output
    if (vin && ao) {
      ao.mob.setEnd(f3(vin.to))
      ao.mob.setColor(hex(palette.input))
      this.stats.arrowRebuilds++
    }
    this.setPlaneOpacity(0)
    for (const id of ['eq:out', 'caption:out', 'lbl:plane']) this.slots.get(id)?.setOpacity(0)
    this.setGroupLabelOpacity(0)
    this.setMovingLabels(desc, 0)
  }

  private makePhase(index: number, desc: ViewDescription): ActiveTransition['anims'] {
    const name = TRANSITION_PHASES[index]!.name
    const outPts = desc.primitives.filter((p): p is PointDesc => p.kind === 'point' && p.view === 'output')
    const inPts = new Map(desc.primitives.filter((p): p is PointDesc => p.kind === 'point' && p.view === 'input').map((p) => [p.sourceId, f3(p.at)]))
    const dotsOut = this.dotGroups.output
    if (name === 'introduce') {
      // Introduce + highlight: outputs appear at their sources, and the selected exact group is named
      // on its moving outputs (Pu, Pv, ...) so identity survives the move (review V1).
      return [new UpdateFromAlphaFunc(dotsOut, (_m, a) => {
        for (const rec of this.dots.output.values()) rec.mob.opacity = a
        this.setMovingLabels(this.transition?.desc ?? desc, a)
      })]
    }
    if (name === 'move') {
      const anims: ActiveTransition['anims'] = []
      const paths = outPts
        .map((p) => ({ id: p.sourceId, rec: this.dots.output.get(p.sourceId)!, from: inPts.get(p.sourceId)!, to: f3(p.at) }))
        .filter((x) => x.rec && x.from)
      // Emphasis colours follow the transition's CURRENT description (selection may change mid-play).
      let colourDesc: ViewDescription | null = null
      const colours = new Map<string, { c0: Color; c1: Color }>()
      const colourOf = (id: string) => {
        const d = this.transition?.desc ?? desc
        if (d !== colourDesc) {
          colourDesc = d
          colours.clear()
          const ins = new Map(d.primitives.filter((p): p is PointDesc => p.kind === 'point' && p.view === 'input').map((p) => [p.sourceId, p]))
          for (const p of d.primitives) if (p.kind === 'point' && p.view === 'output') colours.set(p.sourceId, { c0: new Color(this.pointColor(ins.get(p.sourceId)!, false)), c1: new Color(this.pointColor(p, false)) })
        }
        return colours.get(id)!
      }
      const scratch = new Color()
      // Default path (MATHEMATICAL-CONTRACT M7): (1 - a) v + a A v. Illustrative, not a trajectory.
      anims.push(new UpdateFromAlphaFunc(dotsOut, (_m, a) => {
        this.stats.dotMoves += paths.length
        for (const x of paths) {
          const c = colourOf(x.id)
          x.rec.mob.moveToPoint(lerp3(x.from, x.to, a))
          x.rec.mob.setColor(`#${scratch.copy(c.c0).lerp(c.c1, a).getHexString()}`)
          x.rec.color = NaN
        }
      }))
      const co = this.cubes.output
      const A = desc.matrix
      if (co && A) anims.push(new ApplyMatrix(co.mob, { matrix: A, duration: 1, rateFunc: (x: number) => x }))
      const vin = desc.primitives.find((p): p is VectorDesc => p.kind === 'vector' && p.view === 'input')
      const vout = desc.primitives.find((p): p is VectorDesc => p.kind === 'vector' && p.view === 'output')
      const ao = this.arrows.output
      if (ao && vin && vout) {
        const from = f3(vin.to)
        const to = f3(vout.to)
        let last: V3 | null = null
        anims.push(new UpdateFromAlphaFunc(ao.mob, (m, a) => {
          // Arrow3D.setEnd disposes and rebuilds its meshes even for an identical endpoint: skip those.
          const end = lerp3(from, to, a)
          if (!last || !eq3(last, end)) {
            last = end
            ;(m as Arrow3D).setEnd(end)
            this.stats.arrowRebuilds++
          }
          ;(m as Arrow3D).setColor(mixHex(palette.input, palette.output, a))
        }))
      }
      return anims
    }
    // annotate
    const plane = this.plane
    return [
      new UpdateFromAlphaFunc(plane ? plane.mob : dotsOut, (_m, a) => {
        this.setPlaneOpacity(SIZE.planeOpacity * a)
        this.setMovingLabels(this.transition?.desc ?? desc, 1 - a)
        for (const id of ['eq:out', 'caption:out', 'lbl:plane']) this.slots.get(id)?.setOpacity(a)
        this.setGroupLabelOpacity(a)
      }),
    ]
  }

  /** "<map><name>" labels (Pu, Qa) riding on the moving outputs of the selected group, during transitions only. */
  private setMovingLabels(desc: ViewDescription, opacity: number): void {
    const named = desc.primitives.filter((p): p is PointDesc => p.kind === 'point' && p.view === 'input' && !!p.label && (p.emphasis === 'focus' || p.emphasis === 'group'))
    const live = new Set<string>()
    named.forEach((p, i) => {
      const id = `lbl:mov:${p.sourceId}`
      live.add(id)
      const sym = desc.mapSymbol
      const s = this.tokenLabel(id, [{ tex: sym, color: palette.output }, { tex: p.label!, color: palette.output }], `${sym}${plainName(p.label!)}`, SIZE.texLabel * 0.8, {
        view: 'output',
        at: () => this.livePoint('output', p.sourceId),
        offset: [-0.03 + 0.03 * i, 0.03],
      })
      s.setWanted(true)
      s.setOpacity(opacity)
    })
    for (const [id, s] of this.slots) if (id.startsWith('lbl:mov:') && !live.has(id)) s.setWanted(false)
  }

  private evaluateTransition(t: ActiveTransition): void {
    if (t.spec.kind === 'compare_steps') {
      this.evaluateCompare(t as ActiveTransition & { spec: { kind: 'compare_steps' } })
      t.evaluatedTime = t.time
      this.stats.evaluations++
      this.renderDirty = true
      return
    }
    const scale = t.spec.duration / DEFAULT_DURATION
    // Begin/finish phases in order up to the current time; interpolate the active one.
    for (let i = 0; i < TRANSITION_PHASES.length; i++) {
      const ph = TRANSITION_PHASES[i]!
      const from = ph.from * scale
      const to = ph.to * scale
      if (t.time < from) break
      if (i > t.phaseIndex) {
        if (t.phaseIndex >= 0) for (const a of t.anims) finishAnim(a)
        t.phaseIndex = i
        t.anims = this.makePhase(i, t.desc)
        for (const a of t.anims) a.begin()
      }
      if (i === t.phaseIndex) {
        const raw = Math.min(1, Math.max(0, (t.time - from) / (to - from)))
        const a = smooth(raw)
        for (const an of t.anims) an.interpolate(a)
      }
    }
    this.setCaptionPath(t)
    t.evaluatedTime = t.time
    this.stats.evaluations++
    this.renderDirty = true
  }

  private setCaptionPath(t: ActiveTransition | null): void {
    const sym = (t?.desc ?? this.current)?.mapSymbol ?? ''
    const s = this.texLabel('caption:path', `\\textsf{illustrative path: each sample }x\\textsf{ moves along }(1-\\alpha)\\,x + \\alpha\\,${sym}x`, `illustrative path: each sample x moves along (1−α)x + α${sym}x`, SIZE.texCaption, palette.textDim)
    s.anchor.position.set(0.3, 0.165, 0.06)
    s.anchor.rotation.set(0, -0.22, 0)
    const on = !!t && TRANSITION_PHASES[1]!.name === (this.playback().phase)
    s.setOpacity(on ? 1 : 0)
  }

  private completeTransition(): void {
    const t = this.transition
    if (!t) return
    for (const a of t.anims) finishAnim(a)
    this.transition = null
    this.setCaptionPath(null)
    for (const [id, s] of this.slots) if (id.startsWith('lbl:mov:')) s.setWanted(false)
    if (t.spec.kind === 'compare_steps') this.restStepText()
    this.layoutDirty = true
    if (this.current) this.snapToTarget(this.current)
  }

  /** Cancel presentation and show the committed target (R5: before any semantic edit). */
  finishTransition(): void {
    if (!this.transition) return
    this.stats.canceled++
    this.completeTransition()
  }

  private snapToTarget(desc: ViewDescription): void {
    // Re-apply everything from the authoritative description; the transition no longer owns output.
    // Invalidate cached targets so every output object is re-placed from the description (review F2).
    for (const role of ['output', 'output2'] as const) {
      for (const rec of this.dots[role].values()) rec.at = [NaN, NaN, NaN]
      const a = this.arrows[role]
      if (a) {
        a.to = [NaN, NaN, NaN]
        // The transition coloured it; the description's colour is set again by apply().
        a.color = NaN
      }
      const c = this.cubes[role]
      if (c) c.corners = []
    }
    for (const o of this.outlines.values()) o.points = []
    this.apply(desc)
    for (const id of ['eq:out', 'caption:out', 'lbl:plane']) this.slots.get(id)?.setOpacity(1)
    this.setGroupLabelOpacity(1)
  }

  // ---------------------------------------------------------------- per-frame policy

  private enforceLines(): void {
    if (this.fiber) worldUnitLines(this.fiber.mob.getThreeObject(), SIZE.lineFiber)
    for (const o of this.outlines.values()) worldUnitLines(o.mob.getThreeObject(), SIZE.lineOutline)
    for (const c of Object.values(this.cubes)) if (c) worldUnitLines(c.mob.getThreeObject(), SIZE.lineCube)
    if (this.ghost) worldUnitLines(this.ghost.getThreeObject(), SIZE.lineGhost)
    for (const a of this.axes) worldUnitLines(a.getThreeObject(), SIZE.lineAxis)
    if (this.plane) worldUnitLines(this.plane.border.getThreeObject(), SIZE.linePlane)
    for (const r of this.rings) worldUnitLines(r.mob.getThreeObject(), SIZE.lineRing)
    applyDepthPolicy(this.root)
  }

  private updateProxies(): void {
    for (const role of ROLES) {
      for (const rec of this.dots[role].values()) {
        const p = rec.mob.getThreeObject().position
        rec.proxy.position.copy(p)
        rec.proxy.visible = !(role !== 'input' && this.transition?.playing)
      }
    }
  }
}

/** Display colour of a readout token: identity colour, then role colour, then text. */
function tokenColor(t: GlyphToken): number {
  return t.ident !== undefined ? identityColor(t.ident) : t.role ? ROLE_COLOR[t.role] : palette.text
}

/** The playback step label ("Input", "Step 1 of 2: left R, right S"); a route with fewer maps shows "done". */
function stepLabel(c: { left: RouteDesc; right: RouteDesc }, index: number): string {
  if (index === 0) return 'Input'
  const n = Math.max(c.left.steps, c.right.steps)
  const side = (r: RouteDesc) => r.stages[index - 1]?.label ?? 'done'
  return `Step ${index} of ${n}: left ${side(c.left)}, right ${side(c.right)}`
}

/** Escape plain words for \\textsf{...} (TeX specials become literal characters). */
export function texEscapeText(t: string): string {
  return t.slice(0, 140).replace(/[\\{}$&#^_%~]/g, (c) => (c === '\\' ? '\\textbackslash{}' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\textasciicircum{}' : `\\${c}`))
}

function finishAnim(a: { interpolate(x: number): void; finish(): void }): void {
  // UpdateFromAlphaFunc.finish() keeps the last alpha; interpolate(1) first gives the exact end.
  a.interpolate(1)
  a.finish()
}

export function boundsOf(obj: Object3D): Box3 {
  return new Box3().setFromObject(obj)
}
