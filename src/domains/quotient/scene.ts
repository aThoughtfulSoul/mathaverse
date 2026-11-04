// Demonstration 3 scene: the 24 rotations as small marked cubes (FOUR-DEMOS-PARALLEL-HANDOFF sections 7, 9).
// Marking: the three opposite-face pairs have three colours (what pi tracks); the + face of each pair carries
// a dark pip (the direction pi ignores). An unmarked cube could not show its 24 symmetries; with these marks
// every rotation looks different, and once the pips are ignored exactly the four rotations of one class look
// alike. The scene shows a QuotientDesc (derive.ts); presses return actions from it; no products here.
//
// Cheap on Quest: all 30 cubes (24 + 6 in the composition panel) are ONE instanced mesh, all 90 pips another;
// geometries and materials are shared; instance buffers are written only while something changes.

import {
  BoxGeometry, CircleGeometry, Color, ConeGeometry, CylinderGeometry, DynamicDrawUsage, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  MeshLambertMaterial, PlaneGeometry, Quaternion, TorusGeometry, Vector3, type BufferGeometry, type Material, type Object3D, type Ray,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DomainScene, ScenePick, SceneTransition } from '../scene'
import { IDLE_PLAYBACK } from '../scene'
import type { PlaybackCommand, PlaybackState } from '../../rendering/adapter'
import type { FrameContext } from '../../runtime/host'
import { TextSlot } from '../../rendering/textSlot'
import type { ScenePresentation } from '../../ui/model'
import { palette } from '../../ui/palette'
import { groupOf } from '../../algebra/groups'
import { clamp01, displayQuaternion, displayVector, ease, faceToward, paint, rayPlate, raySphere, roundedFrame, roundedRect, sharedFacing, viewPose } from '../cube/common'
import { QLAYOUT, type QPanelCube, type QuotientDesc } from './derive'

/** Opposite-face pair colours (x, y, z): distinct in hue AND luminance (coral mid, mint light, blue dark). */
export const PAIR = [0xff7a66, 0x8ff0c8, 0x5a86ff] as const
const BODY = 0x1b2130
const PIP = 0x0f131b
const ACCENT = 0x7fe3ff
const N_CUBES = 30
const PANEL_ROLES = ['A', 'B', 'BA', 'qA', 'qB', 'qBA'] as const
/** Presentation pose of every mini-cube (and of the axis tripod): x front-left, y front-right, z up, so at
 * the identity all three + faces (and their pips) face the viewer. */
const POSE = viewPose(-2.25, 0.5)
const EM = { title: 0.0195, legend: 0.0172, block: 0.0165, cls: 0.021, panel: 0.0168, info: 0.0172, plate: 0.0172, badge: 0.017 }
const TIMING = {
  regroup: { fade: [0, 0.7], move: [0.55, 1.5], stagger: 0.07, layers: [1.7, 0.6] },
  ungroup: { move: [0, 1.4], stagger: 0.05, fade: [1.2, 0.7], layers: [0, 0.4] },
  expand: { move: [0, 0.75], fade: [0.2, 0.5] },
} as const

/** Lambert shading plus a share of the surface's own (vertex/instance) colour as emission, so faces in shadow
 * keep their hue (the pair colour is the information) without adding a light to the shared scene. A faded pip
 * gets the same treatment as its face, so it disappears into it under any lighting. */
function selfLit(m: MeshLambertMaterial): MeshLambertMaterial {
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vColor.rgb * 0.38;')
  }
  m.customProgramCacheKey = () => 'cube-quotient-selflit'
  return m
}

const tmpM = new Matrix4()
const tmpM2 = new Matrix4()
const tmpS = new Matrix4()
const tmpV = new Vector3()
const tmpQ = new Quaternion()
const tmpC = new Color()
const tmpC2 = new Color()

interface CubeState {
  element: string
  q: Quaternion
  pos: Vector3
  scale: number
  fade: number
  tint: number
  // tween
  p0: Vector3
  p1: Vector3
  s0: number
  s1: number
  f0: number
  f1: number
  moveStart: number
  moveDur: number
  fadeStart: number
  fadeDur: number
  lift: number
  visible: boolean
}

interface Layer {
  value: number
  v0: number
  v1: number
  start: number
  dur: number
  apply: (v: number) => void
}

export class QuotientScene implements DomainScene<QuotientDesc> {
  readonly layout = 'quotient' as const
  private readonly root = new Group()
  private readonly geometries: BufferGeometry[] = []
  private readonly materials: Material[] = []
  private readonly slots: TextSlot[] = []
  private readonly freeSlots: TextSlot[] = []
  private desc: QuotientDesc | null = null
  private readonly quats = new Map<string, Quaternion>()
  private cubesMesh!: InstancedMesh
  private pipsMesh!: InstancedMesh
  private readonly pipLocal = [new Matrix4(), new Matrix4(), new Matrix4()]
  private readonly cubes: CubeState[] = []
  private readonly layers: Layer[] = []
  private anim: { time: number; total: number; playing: boolean; kind: 'regroup' | 'ungroup' | 'expand' | 'replay' | 'pulse' } | null = null
  private dirty = true
  private hover: string | null = null
  private pulse = { role: -1, time: 0 }
  private badgeUntil = -1
  private clock = 0
  private readonly trays: { key: string; kernel: boolean; expanded: boolean; mesh: Mesh; mat: MeshBasicMaterial; frame: Mesh; frameMat: MeshBasicMaterial }[] = []
  private readonly plates: { id: string; group: Group; mat: MeshBasicMaterial; label: TextSlot }[] = []
  private ring!: Mesh
  private ringMat!: MeshBasicMaterial
  private trayOpacity = 0
  private blockOpacity = 1
  private readonly pivot = new Group()
  private readonly qRoot = new Quaternion()
  /** Replay time scale from play_steps' stepDuration (1 = the built-in timing). */
  private replayScale = 1
  private readonly triShafts: { mesh: Mesh; dir: Vector3 }[] = []
  private readonly triTips: Mesh[] = []
  private selIndex = -1
  private readonly opIndex = [-1, -1]
  /** Under the UI shell (inSceneControls false) the plates, the scene title and the formal lines (orders of the
   * selection, the 16-representative check, the compose prompt) are the shell's; the constellation, classes,
   * legend, labels and the A / B / BA composition panel stay. Hidden plates have no hit targets. */
  private presentation: ScenePresentation = { inSceneControls: true, detailsOpen: false }

  // Text
  private readonly title = this.slot('q:title')
  private readonly legend = this.slot('q:legend')
  private readonly blockLabels = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => this.slot(`q:block${i}`))
  private readonly classLabels = [0, 1, 2, 3, 4, 5].map((i) => this.slot(`q:class${i}`))
  private readonly shelfHeader = this.slot('q:shelfHead')
  private readonly shelfLabels = [0, 1, 2, 3].map((i) => this.slot(`q:shelf${i}`))
  private readonly detailLine = this.slot('q:detail')
  private readonly quotientLine = this.slot('q:quotient')
  private readonly checkLine = this.slot('q:check')
  private readonly infoLine = this.slot('q:info')
  private readonly panelLabels = PANEL_ROLES.map((r) => this.slot(`q:panel${r}`))
  private readonly glyphs = [0, 1, 2, 3].map((i) => this.slot(`q:glyph${i}`))
  private readonly badge = this.slot('q:badge')
  private readonly opBadges = [this.slot('q:opA', true), this.slot('q:opB', true)]
  private readonly axisTags = [0, 1, 2].map((i) => this.slot(`q:axis${i}`))

  constructor() {
    this.root.name = 'scene:quotient'
    this.build()
  }

  private slot(id: string, plate = false): TextSlot {
    const s = new TextSlot(id, { plate })
    this.slots.push(s)
    return s
  }

  private keep<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g)
    return g
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m)
    return m
  }

  // ---------------------------------------------------------------------------------------------- build

  private build(): void {
    const g = groupOf({ kind: 'cube_rotations' })
    for (const e of g.elements) this.quats.set(e, POSE.clone().multiply(displayQuaternion(g.matrix(e)!)))

    // One merged, vertex-coloured "sticker cube" (dark body, a coloured sticker per face by its pair).
    const parts: BufferGeometry[] = [paint(new BoxGeometry(1, 1, 1), BODY)]
    for (let axis = 0; axis < 3; axis++) for (const sgn of [1, -1]) {
      const e = [0, 0, 0]
      e[axis] = sgn
      const n = displayVector(e, 1)
      const p = new PlaneGeometry(0.84, 0.84)
      p.applyQuaternion(tmpQ.setFromUnitVectors(new Vector3(0, 0, 1), n))
      p.translate(n.x * 0.502, n.y * 0.502, n.z * 0.502)
      parts.push(paint(p, PAIR[axis]!))
    }
    const cubeGeo = this.keep(mergeGeometries(parts)!)
    parts.forEach((p) => p.dispose())
    this.cubesMesh = new InstancedMesh(cubeGeo, this.mat(selfLit(new MeshLambertMaterial({ vertexColors: true }))), N_CUBES)
    this.cubesMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.cubesMesh.frustumCulled = false
    const pipGeo = this.keep(new CircleGeometry(0.17, 20))
    this.pipsMesh = new InstancedMesh(pipGeo, this.mat(selfLit(new MeshLambertMaterial({ color: 0xffffff }))), N_CUBES * 3)
    this.pipsMesh.instanceMatrix.setUsage(DynamicDrawUsage)
    this.pipsMesh.frustumCulled = false
    for (let j = 0; j < 3; j++) {
      const e = [0, 0, 0]
      e[j] = 1
      const n = displayVector(e, 1)
      this.pipLocal[j]!.compose(n.clone().multiplyScalar(0.5045), new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n), new Vector3(1, 1, 1))
    }
    for (let c = 0; c < N_CUBES; c++) {
      this.cubesMesh.setColorAt(c, tmpC.setHex(0xffffff))
      for (let j = 0; j < 3; j++) this.pipsMesh.setColorAt(c * 3 + j, tmpC.setHex(PIP))
      this.cubes.push({
        element: c < 24 ? g.elements[c]! : g.identity,
        q: this.quats.get(c < 24 ? g.elements[c]! : g.identity)!.clone(),
        pos: new Vector3(),
        scale: c < 24 ? 1 : 0,
        fade: 0,
        tint: 1,
        p0: new Vector3(),
        p1: new Vector3(),
        s0: 0,
        s1: 0,
        f0: 0,
        f1: 0,
        moveStart: 0,
        moveDur: 0,
        fadeStart: 0,
        fadeDur: 0,
        lift: 0,
        visible: c < 24,
      })
    }
    this.root.add(this.cubesMesh, this.pipsMesh)

    // Cluster trays (grouped view), K and the expanded class get a frame.
    const trayGeo = this.keep(roundedRect(0.132, 0.128, 0.014))
    const frameGeo = this.keep(roundedFrame(0.138, 0.134, 0.016, 0.0026))
    for (let i = 0; i < 6; i++) {
      const mat = this.mat(new MeshBasicMaterial({ color: 0x1a2131, transparent: true, opacity: 0, depthWrite: false }))
      const mesh = new Mesh(trayGeo, mat)
      mesh.renderOrder = 1
      const frameMat = this.mat(new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false }))
      const frame = new Mesh(frameGeo, frameMat)
      frame.renderOrder = 2
      this.root.add(mesh, frame)
      this.trays.push({ key: '', kernel: false, expanded: false, mesh, mat, frame, frameMat })
    }

    // Selection ring (billboard).
    this.ringMat = this.mat(new MeshBasicMaterial({ color: palette.selected, transparent: true, opacity: 0.95 }))
    this.ring = new Mesh(this.keep(new TorusGeometry(0.036, 0.0018, 6, 40)), this.ringMat)
    this.ring.visible = false
    this.root.add(this.ring)

    // Axis tripod in the mini-cubes' pose, so x, y, z on a cube face can be read.
    const tri = new Group()
    tri.position.set(-0.455, 0.232, 0)
    const triMat = this.mat(new MeshBasicMaterial({ color: palette.axis }))
    const shaft = this.keep(new CylinderGeometry(0.0012, 0.0012, 0.03, 6))
    const tip = this.keep(new ConeGeometry(0.0034, 0.009, 8))
    for (let a = 0; a < 3; a++) {
      const e = [0, 0, 0]
      e[a] = 1
      const d = displayVector(e, 1).applyQuaternion(POSE)
      const s = new Mesh(shaft, triMat)
      s.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d)
      s.position.copy(d).multiplyScalar(0.015)
      const t = new Mesh(tip, triMat)
      t.quaternion.copy(s.quaternion)
      t.position.copy(d).multiplyScalar(0.032)
      tri.add(s, t)
      this.triShafts.push({ mesh: s, dir: d.clone() })
      this.triTips.push(t)
      const tag = this.axisTags[a]!
      tag.anchor.position.copy(d).multiplyScalar(0.046).add(tri.position)
      tag.set({ kind: 'tex', parts: [{ tex: 'xyz'[a]! }], em: 0.018, color: PAIR[a]!, plain: 'xyz'[a]! })
    }
    this.root.add(tri)

    // Plates.
    const plateGeo = this.keep(roundedRect(0.168, 0.042, 0.012))
    for (let i = 0; i < 5; i++) {
      const group = new Group()
      const mat = this.mat(new MeshBasicMaterial({ color: palette.control, transparent: true, opacity: 0.94 }))
      const plate = new Mesh(plateGeo, mat)
      plate.renderOrder = 4
      const label = new TextSlot(`q:plate${i}`)
      label.anchor.position.set(0, 0, 0.004)
      this.slots.push(label)
      group.add(plate, label.anchor)
      this.root.add(group)
      this.plates.push({ id: '', group, mat, label })
    }

    for (const s of this.slots) if (!s.id.startsWith('q:plate')) {
      this.root.add(s.anchor)
      this.freeSlots.push(s)
    }
    this.title.anchor.position.set(0, 0.305, 0)
    this.legend.anchor.position.set(0, 0.272, 0)
    this.infoLine.anchor.position.set(-0.17, -0.148, 0.02)
    this.checkLine.anchor.position.set(0.335, -0.147, 0.02)
    this.shelfHeader.anchor.position.set(0.33, 0.247, 0.02)
    const [x0, x1, x2] = QLAYOUT.panelX
    const mid = (a: number, b: number) => (a + b) / 2
    this.glyphs[0]!.anchor.position.set(mid(x0, x1), QLAYOUT.detailY, 0.02)
    this.glyphs[1]!.anchor.position.set(mid(x1, x2), QLAYOUT.detailY, 0.02)
    this.glyphs[2]!.anchor.position.set(mid(x0, x1), QLAYOUT.quotientY, 0.02)
    this.glyphs[3]!.anchor.position.set(mid(x1, x2), QLAYOUT.quotientY, 0.02)
    this.detailLine.anchor.position.set(0.335, QLAYOUT.detailY + 0.045, 0.02)
    this.quotientLine.anchor.position.set(0.335, QLAYOUT.quotientY + 0.045, 0.02)
    this.badge.anchor.position.set(0.335, -0.174, 0.03)
    const dim = palette.textDim
    this.glyphs.forEach((s, i) => s.set({ kind: 'plain', plain: i % 2 === 0 ? 'then' : '=', em: EM.panel, color: dim }))
    this.badge.set({ kind: 'plain', plain: 'new representative, same class: result unchanged', em: EM.badge * 0.88, color: ACCENT })
    this.badge.setWanted(false)
    this.opBadges[0]!.set({ kind: 'plain', plain: 'A', em: EM.badge, color: palette.text })
    this.opBadges[1]!.set({ kind: 'plain', plain: 'B', em: EM.badge, color: palette.text })

    // Layers that fade with grouping.
    this.layers.push(
      { value: 0, v0: 0, v1: 0, start: 0, dur: 1, apply: (v) => this.setTrayOpacity(v) },
      { value: 1, v0: 1, v1: 1, start: 0, dur: 1, apply: (v) => this.setBlockOpacity(v) },
    )
  }

  // ---------------------------------------------------------------------------------------------- contract

  mount(parent: Object3D): void {
    parent.add(this.root)
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible
  }

  /** Presentation options from the shell (src/ui/model.ts ScenePresentation): never changes the mathematics. */
  setPresentation(p: ScenePresentation): void {
    if (p.inSceneControls === this.presentation.inSceneControls && p.detailsOpen === this.presentation.detailsOpen) return
    this.presentation = { ...p }
    this.applyPresentation()
  }

  private applyPresentation(): void {
    const own = this.presentation.inSceneControls
    // Under the shell the formal lines are in the mathematics inspector (never duplicated over the stage).
    const formal = own
    for (const pl of this.plates) pl.group.visible = own
    this.title.setWanted(own)
    this.infoLine.setWanted(formal)
    this.checkLine.setWanted(formal)
    // Without a composition the detail line is only the compose prompt, which the context bar now gives.
    const comp = this.desc?.composition ?? null
    this.detailLine.setWanted(own || comp !== null)
  }

  apply(desc: QuotientDesc, transition: SceneTransition): void {
    if (this.anim) this.finish()
    const prev = this.desc
    this.desc = desc
    this.updateStatic(desc, prev)
    const same = prev !== null && prev.experimentId === desc.experimentId
    const kind = !same || transition === 'snap' ? null : prev!.grouped !== desc.grouped ? (desc.grouped ? 'regroup' : 'ungroup') : prev!.expandedClass !== desc.expandedClass ? 'expand' : null
    this.setTargets(desc, kind)
    if (kind) this.anim = { time: 0, total: this.totalOf(kind), playing: true, kind }
    else this.finish()
  }

  step(ctx: FrameContext): void {
    this.clock = ctx.time
    const a = this.anim
    if (a) {
      if (a.playing) a.time += ctx.dt
      if (a.time >= a.total) this.finish()
      else this.evaluate(a.kind === 'replay' ? a.time / this.replayScale : a.time)
    }
    if (this.pulse.role >= 0) {
      this.pulse.time += ctx.dt
      if (this.pulse.time >= 0.45) this.pulse.role = -1
      this.dirty = true
    }
    if (this.badgeUntil >= 0 && ctx.time > this.badgeUntil) {
      this.badgeUntil = -1
      this.badge.setOpacity(0.75)
    }
    if (this.dirty) this.writeInstances()
    this.place(ctx)
    for (const s of this.slots) s.frame(ctx.time)
  }

  /** play_steps: seconds per step of the replay (its two steps: ignore directions, regroup). */
  setStepDuration(seconds: number): void {
    this.replayScale = Math.max(0.3, Math.min(5, seconds)) / 1.15
  }

  setPlayback(cmd: PlaybackCommand): PlaybackState {
    const d = this.desc
    if (cmd === 'replay' || ((cmd === 'toggle' || cmd === 'play') && !this.anim)) {
      if (this.anim) this.finish()
      if (d && d.grouped) {
        // Start from all 24 with marks (the ungrouped look), then regroup to the current state.
        for (const c of this.cubes.slice(0, 24)) {
          const qc = d.cubes.find((x) => x.element === c.element)!
          c.pos.set(...qc.home)
          c.scale = 1
          c.fade = 0
          c.tint = 1
        }
        this.layers[0]!.value = 0
        this.layers[1]!.value = 1
        this.setTargets(d, 'regroup', true)
        this.anim = { time: 0, total: this.totalOf('regroup') * this.replayScale, playing: true, kind: 'replay' }
      }
    } else if (cmd === 'toggle') {
      if (this.anim) this.anim.playing = !this.anim.playing
    } else if (cmd === 'pause') {
      if (this.anim) this.anim.playing = false
    } else if (cmd === 'play') {
      if (this.anim) this.anim.playing = true
    } else if (cmd === 'finish') {
      if (this.anim) this.finish()
    } else if (typeof cmd === 'object' && this.anim) {
      this.anim.time = Math.max(0, Math.min(this.anim.total - 1e-6, cmd.seek))
      this.evaluate(this.anim.kind === 'replay' ? this.anim.time / this.replayScale : this.anim.time)
    }
    return this.playback()
  }

  playback(): PlaybackState {
    const a = this.anim
    if (!a) return { ...IDLE_PLAYBACK }
    const regroup = a.kind === 'regroup' || a.kind === 'replay'
    const index = regroup ? (a.time / (a.kind === 'replay' ? this.replayScale : 1) < TIMING.regroup.move[0] ? 1 : 2) : 1
    const label = regroup ? (index === 1 ? 'ignore the directions' : 'regroup into six classes') : a.kind === 'ungroup' ? 'show all 24' : 'expand the class'
    return { active: true, playing: a.playing, time: a.time, duration: a.total, phase: a.kind, step: { index, count: regroup ? 2 : 1, label } }
  }

  pick(ray: Ray): ScenePick | null {
    const d = this.desc
    if (!d || !this.root.visible) return null
    this.root.updateWorldMatrix(true, true)
    let best: ScenePick | null = null
    const offer = (id: string, distance: number | null, actions: unknown[], hint: string) => {
      if (distance !== null && (!best || distance < best.distance)) best = { id, distance, actions, hint }
    }
    if (this.presentation.inSceneControls) for (const p of this.plates) {
      const plate = d.plates.find((x) => x.id === p.id)
      if (plate) offer(p.id, rayPlate(ray, p.group, 0.084, 0.021), plate.actions, plate.hint)
    }
    for (let i = 0; i < N_CUBES; i++) {
      const c = this.cubes[i]!
      if (!c.visible || c.scale < 0.2) continue
      tmpV.copy(c.pos)
      this.root.localToWorld(tmpV)
      const r = QLAYOUT.size * 0.62 * c.scale
      if (i < 24) {
        const qc = d.cubes[i]!
        offer(`cube:${qc.element}`, raySphere(ray, tmpV, r), qc.actions, qc.hint)
      } else {
        const pc = this.panelCube(d, PANEL_ROLES[i - 24]!)
        if (pc) offer(`panel:${pc.role}`, raySphere(ray, tmpV, r), pc.actions, pc.hint)
      }
    }
    if (!best && d.grouped) {
      for (const t of this.trays) {
        const cls = d.classes.find((c) => c.key === t.key)
        if (cls) offer(`class:${cls.key}`, rayPlate(ray, t.mesh, 0.066, 0.064), cls.actions, cls.hint)
      }
    }
    return best
  }

  setHover(id: string | null): void {
    if (id === this.hover) return
    this.hover = id
    this.applyHover()
    this.dirty = true
  }

  status(): string {
    return this.desc?.status ?? 'Quotient: no description yet'
  }

  report(): Record<string, unknown> {
    const d = this.desc
    return {
      layout: 'quotient',
      observation: d?.observation ?? null,
      expandedClass: d?.expandedClass ?? null,
      operands: d?.operands ?? null,
      composition: d?.composition ?? null,
      committed: !this.anim,
      playback: this.playback(),
      cubes: this.cubes.map((c, i) => ({ i, element: c.element, pos: [c.pos.x, c.pos.y, c.pos.z].map((v) => +v.toFixed(4)), scale: +c.scale.toFixed(3), marks: +(1 - c.fade).toFixed(3), visible: c.visible })),
      trays: +this.trayOpacity.toFixed(3),
      blocks: +this.blockOpacity.toFixed(3),
      slots: this.slots.map((s) => s.report()),
      presentation: { ...this.presentation, plates: this.plates.filter((p) => p.group.visible).length },
    }
  }

  dispose(): void {
    this.anim = null
    for (const s of this.slots) s.dispose()
    this.root.removeFromParent()
    this.cubesMesh.dispose()
    this.pipsMesh.dispose()
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
  }

  // ---------------------------------------------------------------------------------------------- internals

  private panelCube(d: QuotientDesc, role: QPanelCube['role']): QPanelCube | null {
    return d.panel.find((p) => p.role === role) ?? null
  }

  private totalOf(kind: 'regroup' | 'ungroup' | 'expand'): number {
    if (kind === 'regroup') return TIMING.regroup.layers[0] + TIMING.regroup.layers[1]
    if (kind === 'ungroup') return TIMING.ungroup.fade[0] + TIMING.ungroup.fade[1]
    return TIMING.expand.move[1] + 0.05
  }

  /** Targets from the description, with tween timing for the given kind (null = jump on finish). */
  private setTargets(d: QuotientDesc, kind: 'regroup' | 'ungroup' | 'expand' | null, fromCurrent = true): void {
    const order = new Map(d.classes.map((c, i) => [c.key, i]))
    for (let i = 0; i < 24; i++) {
      const c = this.cubes[i]!
      const qc = d.cubes[i]!
      if (fromCurrent) {
        c.p0.copy(c.pos)
        c.s0 = c.scale
        c.f0 = c.fade
      }
      c.p1.set(qc.pos[0], qc.pos[1], qc.pos[2])
      c.s1 = qc.scale
      c.f1 = qc.marks ? 0 : 1
      c.tint = qc.dim ? 0.2 : 1 // linear: about half brightness after sRGB encoding
      c.visible = true
      const k = order.get(qc.classKey)!
      if (kind === 'regroup') {
        c.fadeStart = TIMING.regroup.fade[0]
        c.fadeDur = TIMING.regroup.fade[1]
        c.moveStart = TIMING.regroup.move[0] + k * TIMING.regroup.stagger
        c.moveDur = TIMING.regroup.move[1]
        c.lift = 0.05 + 0.012 * (k % 3)
      } else if (kind === 'ungroup') {
        c.moveStart = TIMING.ungroup.move[0] + k * TIMING.ungroup.stagger
        c.moveDur = TIMING.ungroup.move[1]
        c.fadeStart = TIMING.ungroup.fade[0]
        c.fadeDur = TIMING.ungroup.fade[1]
        c.lift = 0.05 + 0.012 * (k % 3)
      } else {
        c.moveStart = TIMING.expand.move[0]
        c.moveDur = TIMING.expand.move[1]
        c.fadeStart = TIMING.expand.fade[0]
        c.fadeDur = TIMING.expand.fade[1]
        c.lift = c.p0.distanceTo(c.p1) > 1e-4 ? 0.035 : 0
      }
    }
    // Panel cubes jump (they are a readout of the operands, not moving objects).
    for (let r = 0; r < 6; r++) {
      const c = this.cubes[24 + r]!
      const pc = this.panelCube(d, PANEL_ROLES[r]!)
      c.visible = pc !== null
      if (pc) {
        if (c.element !== pc.element) {
          c.element = pc.element
          c.q.copy(this.quats.get(pc.element)!)
        }
        c.pos.set(pc.pos[0], pc.pos[1], pc.pos[2])
        c.scale = 1
        c.fade = pc.marks ? 0 : 1
        c.tint = 1
      } else c.scale = 0
      c.p0.copy(c.pos)
      c.p1.copy(c.pos)
      c.s0 = c.s1 = c.scale
      c.f0 = c.f1 = c.fade
      c.moveDur = 0
      c.fadeDur = 0
    }
    const trays = this.layers[0]!
    const blocks = this.layers[1]!
    trays.v0 = trays.value
    blocks.v0 = blocks.value
    trays.v1 = d.grouped ? 1 : 0
    blocks.v1 = d.grouped ? 0 : 1
    if (kind === 'regroup') {
      blocks.start = 0
      blocks.dur = 0.5
      trays.start = TIMING.regroup.layers[0]
      trays.dur = TIMING.regroup.layers[1]
    } else if (kind === 'ungroup') {
      trays.start = TIMING.ungroup.layers[0]
      trays.dur = TIMING.ungroup.layers[1]
      blocks.start = TIMING.ungroup.fade[0]
      blocks.dur = TIMING.ungroup.fade[1]
    } else {
      trays.start = blocks.start = 0
      trays.dur = blocks.dur = 0.001
    }
    this.dirty = true
  }

  private evaluate(t: number): void {
    for (let i = 0; i < 24; i++) {
      const c = this.cubes[i]!
      const u = c.moveDur > 0 ? clamp01((t - c.moveStart) / c.moveDur) : 1
      const e = ease(u)
      c.pos.lerpVectors(c.p0, c.p1, e)
      c.pos.z += c.lift * Math.sin(Math.PI * e)
      c.scale = c.s0 + (c.s1 - c.s0) * e
      const v = c.fadeDur > 0 ? ease(clamp01((t - c.fadeStart) / c.fadeDur)) : 1
      c.fade = c.f0 + (c.f1 - c.f0) * v
    }
    for (const l of this.layers) {
      const v = ease(clamp01((t - l.start) / l.dur))
      l.value = l.v0 + (l.v1 - l.v0) * v
      l.apply(l.value)
    }
    this.dirty = true
  }

  private finish(): void {
    this.anim = null
    for (let i = 0; i < 24; i++) {
      const c = this.cubes[i]!
      c.pos.copy(c.p1)
      c.scale = c.s1
      c.fade = c.f1
    }
    for (const l of this.layers) {
      l.value = l.v1
      l.apply(l.value)
    }
    this.dirty = true
  }

  private setTrayOpacity(v: number): void {
    this.trayOpacity = v
    // The axis tripod: oriented arrows while directions count, unoriented lines once they are ignored.
    for (const t of this.triTips) t.visible = v < 0.5
    for (const sh of this.triShafts) {
      sh.mesh.scale.y = 1 + v
      sh.mesh.position.copy(sh.dir).multiplyScalar(0.015 * (1 - v))
    }
    for (const t of this.trays) {
      t.mat.opacity = 0.9 * v
      t.frameMat.opacity = (t.kernel ? 0.9 : t.expanded ? 0.75 : 0) * v
      t.frameMat.color.setHex(t.kernel ? ACCENT : palette.selected)
      t.mesh.visible = t.frame.visible = v > 0.001
    }
    for (const s of this.classLabels) s.setOpacity(v)
  }

  private setBlockOpacity(v: number): void {
    this.blockOpacity = v
    for (const s of this.blockLabels) s.setOpacity(v)
  }

  /** Texts and static placement from the committed description (not per frame). */
  private updateStatic(d: QuotientDesc, prev: QuotientDesc | null): void {
    const tex = (s: TextSlot, t: string, plain: string, em: number, color: number) => s.set({ kind: 'tex', parts: [{ tex: t }], em, color, plain })
    tex(this.title, d.title.tex, d.title.plain, EM.title, palette.text)
    const colorOf = (c: string) => (c === 'x' ? PAIR[0] : c === 'y' ? PAIR[1] : c === 'z' ? PAIR[2] : c === 'dim' ? 0x7d8698 : palette.textDim)
    this.legend.set({ kind: 'tex', parts: d.legend.parts.map((p) => ({ tex: p.tex, color: colorOf(p.color) })), em: EM.legend, color: palette.textDim, plain: d.legend.plain })
    this.blockLabels.forEach((s, i) => {
      const b = d.blocks[i]
      if (!b) return s.set(null)
      s.anchor.position.set(...b.at)
      s.set({ kind: 'plain', plain: b.text, em: b.id.startsWith('col:') ? EM.block * 0.9 : EM.block, color: b.id.startsWith('col:') ? 0x8892a6 : palette.textDim })
    })
    d.classes.forEach((c, i) => {
      const t = this.trays[i]!
      t.key = c.key
      t.kernel = c.isKernel
      t.expanded = c.expanded
      t.mesh.position.set(c.center[0], c.center[1], -0.026)
      t.frame.position.set(c.center[0], c.center[1], -0.025)
      const s = this.classLabels[i]!
      s.anchor.position.set(...c.labelAt)
      if (c.isKernel) tex(s, 'K\\textsf{: fixes every axis line}', 'K: fixes every axis line', EM.cls * 0.82, ACCENT)
      else tex(s, c.name.tex, c.name.plain, EM.cls, c.expanded ? palette.selected : palette.text)
    })
    this.setTrayOpacity(this.layers[0]!.value)
    // Inspection row.
    if (d.expandedHeader) tex(this.shelfHeader, d.expandedHeader.tex, d.expandedHeader.plain, EM.panel, d.expandedClass === '012' ? ACCENT : palette.text)
    else this.shelfHeader.set(null)
    for (let i = 0; i < 4; i++) {
      const l = d.expandedLabels[i]
      const s = this.shelfLabels[i]!
      if (l) {
        s.anchor.position.set(...l.at)
        tex(s, l.label.tex, l.label.plain, EM.panel, palette.text)
      } else s.set(null)
    }
    // Composition panel.
    const comp = d.composition
    if (comp) {
      tex(this.detailLine, comp.detail.tex, comp.detail.plain, EM.panel, palette.text)
      tex(this.quotientLine, comp.quotient.tex, comp.quotient.plain, EM.panel, palette.text)
      if (comp.check) tex(this.checkLine, comp.check.tex, comp.check.plain, EM.panel * 0.95, comp.allChoices?.length === 1 ? ACCENT : 0xff5a6e)
      else this.checkLine.set(null)
    } else {
      this.detailLine.set(d.operands[1] !== null ? { kind: 'plain', plain: 'choose A as well', em: EM.panel, color: palette.textDim } : { kind: 'plain', plain: 'Compose: select a rotation, then Choose as A / B', em: EM.panel, color: palette.textDim })
      this.quotientLine.set(null)
      this.checkLine.set(null)
    }
    PANEL_ROLES.forEach((r, i) => {
      const p = this.panelCube(d, r)
      const s = this.panelLabels[i]!
      if (p) {
        s.anchor.position.set(...p.labelAt)
        tex(s, p.label.tex, p.label.plain, EM.panel, r.startsWith('q') ? palette.textDim : palette.text)
      } else s.set(null)
    })
    const full = !!comp && comp.b !== null
    for (const gl of this.glyphs) gl.setWanted(full)
    if (d.info) tex(this.infoLine, d.info.tex, d.info.plain, EM.info, palette.text)
    else this.infoLine.set(null)
    // Plates.
    d.plates.forEach((p, i) => {
      const pl = this.plates[i]!
      pl.id = p.id
      pl.group.position.set(...p.pos)
      // Constant colour, opacity for the disabled state: a plain slot does not redraw on a colour-only change.
      pl.label.set({ kind: 'plain', plain: p.label, em: EM.plate, color: palette.text })
      pl.label.setOpacity(p.enabled ? 1 : 0.42)
    })
    this.selIndex = d.selectedElement ? d.cubes.findIndex((c) => c.element === d.selectedElement) : -1
    for (let k = 0; k < 2; k++) {
      const el = d.operands[k]
      this.opIndex[k] = el === null ? -1 : d.cubes.findIndex((c) => c.element === el)
      this.opBadges[k]!.setWanted(el !== null)
    }
    this.applyHover()
    this.applyPresentation()
    // A representative changed inside its class: the class result is unchanged. Say so, and pulse the cube.
    const pc = prev?.composition
    if (comp && pc && comp.b !== null && pc.b !== null && prev!.experimentId === d.experimentId) {
      const changedA = pc.a !== comp.a && pc.aClass === comp.aClass
      const changedB = pc.b !== comp.b && pc.bClass === comp.bClass
      if ((changedA || changedB) && pc.quotientProduct === comp.quotientProduct) {
        this.pulse = { role: changedA ? 0 : 1, time: 0 }
        this.badge.setWanted(true)
        this.badge.setOpacity(1)
        this.badgeUntil = this.clock + 2.5
      } else if (comp.quotientProduct !== pc.quotientProduct) this.badge.setWanted(false)
    } else if (!comp || comp.b === null) this.badge.setWanted(false)
  }

  private applyHover(): void {
    const d = this.desc
    for (const p of this.plates) {
      const plate = d?.plates.find((x) => x.id === p.id)
      p.mat.color.setHex(plate && !plate.enabled ? 0x1a202c : this.hover === p.id ? palette.controlHover : palette.control)
    }
  }

  private writeInstances(): void {
    this.dirty = false
    const d = this.desc
    for (let i = 0; i < N_CUBES; i++) {
      const c = this.cubes[i]!
      let s = c.visible ? c.scale * QLAYOUT.size : 0
      if (d && i < 24 && this.hover === `cube:${c.element}`) s *= 1.12
      if (i >= 24 && this.pulse.role === i - 24) s *= 0.55 + 0.45 * ease(this.pulse.time / 0.45)
      tmpV.set(s, s, s)
      tmpM.compose(c.pos, c.q, tmpV)
      this.cubesMesh.setMatrixAt(i, tmpM)
      this.cubesMesh.setColorAt(i, tmpC.setScalar(c.tint))
      for (let j = 0; j < 3; j++) {
        const k = 1 - 0.55 * c.fade
        tmpS.makeScale(k, k, k)
        tmpM2.multiplyMatrices(tmpM, this.pipLocal[j]!).multiply(tmpS)
        this.pipsMesh.setMatrixAt(i * 3 + j, tmpM2)
        tmpC.setHex(PIP).lerp(tmpC2.setHex(PAIR[j]!), c.fade).multiplyScalar(c.tint)
        this.pipsMesh.setColorAt(i * 3 + j, tmpC)
      }
    }
    this.cubesMesh.instanceMatrix.needsUpdate = true
    this.pipsMesh.instanceMatrix.needsUpdate = true
    if (this.cubesMesh.instanceColor) this.cubesMesh.instanceColor.needsUpdate = true
    if (this.pipsMesh.instanceColor) this.pipsMesh.instanceColor.needsUpdate = true
  }

  /** Per frame: ring and badges follow their cubes; billboard free text (no allocation). */
  private place(ctx: FrameContext): void {
    const head = ctx.head
    const sel = this.selIndex >= 0 ? this.cubes[this.selIndex]! : null
    if (sel) {
      this.ring.position.copy(sel.pos)
      this.ring.scale.setScalar(sel.scale)
      this.ring.lookAt(head)
    }
    this.ring.visible = sel !== null
    for (let k = 0; k < 2; k++) {
      const b = this.opBadges[k]!
      const i = this.opIndex[k]!
      if (i < 0) continue
      const c = this.cubes[i]!
      b.anchor.position.set(c.pos.x - 0.026 * c.scale, c.pos.y + 0.03 * c.scale, c.pos.z + 0.02)
    }
    sharedFacing(this.root, head, this.pivot, this.qRoot)
    for (const s of this.freeSlots) if (s.anchor.visible) s.anchor.quaternion.copy(this.qRoot)
    for (const p of this.plates) faceToward(p.group, this.root, head, this.pivot)
  }
}
