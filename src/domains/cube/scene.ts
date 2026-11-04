// Demonstration 2 scene: an outlined cube holding four coloured body diagonals, linked to four matching
// objects on a rail (FOUR-DEMOS-PARALLEL-HANDOFF sections 6, 9). The scene shows a CubeDesc (derive.ts); a
// press returns actions from that description; nothing here computes group products.
//
// Motion: a new history step g rotates the cube rigidly about g's axis (E3 of rotationInfo's axis) through
// g's angle, starting from the committed orientation k, so the end is exactly g·k (set from the exact matrix,
// not from the integrated angle). The objects slide in sync from slot s to phi(g)[s]. Intermediate
// orientations carry no group label: the state and phi readouts are hidden while anything moves.

import {
  BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, OctahedronGeometry,
  Quaternion, SphereGeometry, TetrahedronGeometry, TorusGeometry, Vector3, type BufferGeometry, type Material, type Object3D, type Ray,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { DomainScene, ScenePick, SceneTransition } from '../scene'
import { IDLE_PLAYBACK } from '../scene'
import type { PlaybackCommand, PlaybackState } from '../../rendering/adapter'
import type { FrameContext } from '../../runtime/host'
import { TextSlot, type SlotContent } from '../../rendering/textSlot'
import { palette } from '../../ui/palette'
import { groupOf } from '../../algebra/groups'
import { DIAGONALS } from '../../algebra/cube'
import type { CubeDesc, CubeStepDesc } from './derive'
import type { ScenePresentation } from '../../ui/model'
import { clamp01, displayQuaternion, displayVector, ease, faceToward, raySegment, raySphere, rayPlate, roundedRect, sharedFacing, viewPose } from './common'

/** Bench-local layout (metres). The cube's swept sphere (radius H * sqrt 3) stays inside the scene box. */
const L = {
  cube: new Vector3(-0.19, 0.05, -0.045),
  H: 0.088,
  // Chosen numerically for both the desktop camera and a seated XR head: every diagonal keeps >= 50 % of its
  // length on screen, no two diagonals project closer than ~25 degrees, the projected x, y, z axes stay
  // >= 60 degrees apart and the top face is visible. It is the textbook view: x toward the viewer, y right, z up.
  yaw: -1.28,
  pitch: 0.52,
  railY: 0.055,
  railZ: 0.01,
  padX: [0.085, 0.18, 0.275, 0.37],
  cardsY: -0.205,
  cardsZ: 0.06,
  cardX: [-0.25, -0.125, 0, 0.125, 0.25],
  card: { w: 0.104, h: 0.06 },
  wordY: 0.302,
  stateY: 0.258,
  capCubeY: -0.152,
  capRailY: -0.042,
  ringY: -0.118,
} as const

const EM = { word: 0.0215, state: 0.024, caption: 0.0175, label: 0.02, tag: 0.016, card: 0.024, cardCaption: 0.0148 }
const ACCENT = 0x7fe3ff
const IDENTITY = [palette.identity[0], palette.identity[1], palette.identity[2], palette.identity[3]] as const
const SHAPE_NAMES = ['sphere', 'cube', 'tetrahedron', 'octahedron'] as const

const tmpV = new Vector3()
const tmpV2 = new Vector3()
const tmpQ = new Quaternion()

interface Segment {
  step: CubeStepDesc
  start: number
  dur: number
  q0: Quaternion
  q1: Quaternion
  axis: Vector3
  angle: number
  from: number[]
  to: number[]
}

interface Timeline {
  kind: 'step' | 'undo' | 'replay'
  segments: Segment[]
  total: number
  time: number
  playing: boolean
  shown: number
}

function shapeGeometry(i: number, s: number): BufferGeometry {
  switch (i) {
    case 0:
      return new SphereGeometry(s * 0.95, 20, 14)
    case 1:
      return new BoxGeometry(s * 1.55, s * 1.55, s * 1.55)
    case 2:
      return new TetrahedronGeometry(s * 1.35)
    default:
      return new OctahedronGeometry(s * 1.3)
  }
}

function stepDuration(step: CubeStepDesc): number {
  return 0.95 + 0.55 * (step.angle / Math.PI)
}

export class CubeScene implements DomainScene<CubeDesc> {
  readonly layout = 'cube' as const
  private readonly root = new Group()
  private readonly stage = new Group()
  private readonly body = new Group()
  private readonly geometries: BufferGeometry[] = []
  private readonly materials: Material[] = []
  private readonly slots: TextSlot[] = []
  private desc: CubeDesc | null = null
  private timeline: Timeline | null = null
  private hover: string | null = null

  // Objects
  private readonly idMats: MeshLambertMaterial[] = []
  private readonly diagonals: Mesh[] = []
  private readonly tokens: Mesh[] = []
  private readonly halos: Mesh[] = []
  private readonly tokenSlot = [0, 1, 2, 3]
  private readonly tokenPos = [new Vector3(), new Vector3(), new Vector3(), new Vector3()]
  private readonly diagEnds = [0, 1, 2, 3].map(() => [new Vector3(), new Vector3()] as [Vector3, Vector3])
  private readonly diagLabelLocal = [0, 1, 2, 3].map((i) => displayVector(DIAGONALS[i]!, 1).normalize())
  private axisLine!: Mesh
  private axisArc!: Group
  private axisMat!: MeshBasicMaterial
  private ring!: Mesh
  private ringMat!: MeshBasicMaterial
  private railMat!: MeshBasicMaterial
  private readonly padMats: MeshBasicMaterial[] = []
  private readonly cards: { id: string; group: Group; plate: Mesh; mat: MeshBasicMaterial; label: TextSlot; caption: TextSlot }[] = []

  // Text
  private readonly word = this.slot('cube:word')
  private readonly state = this.slot('cube:state')
  private readonly phiText = this.slot('cube:phi')
  private readonly op = this.slot('cube:op')
  private readonly capCube = this.slot('cube:capCube')
  private readonly capRail = this.slot('cube:capRail')
  private readonly diagLabels = [0, 1, 2, 3].map((i) => this.slot(`cube:diag${i}`))
  private readonly tokenLabels = [0, 1, 2, 3].map((i) => this.slot(`cube:token${i}`))
  private readonly slotTags = [0, 1, 2, 3].map((j) => this.slot(`cube:slotTag${j}`))
  private readonly padTags = [0, 1, 2, 3].map((j) => this.slot(`cube:padTag${j}`))
  private readonly axisTags = [0, 1, 2].map((j) => this.slot(`cube:axis${j}`))
  private readonly slotTagPos = [0, 1, 2, 3].map(() => new Vector3())
  private readonly axisTagPos = [0, 1, 2].map(() => new Vector3())
  private readonly stepOps = new Map<number, SlotContent>()
  private readonly freeSlots: TextSlot[] = []
  private readonly pivot = new Group()
  private readonly qRoot = new Quaternion()
  private readonly qStage = new Quaternion()
  /** Seconds per step for replays (play_steps); null = by angle. */
  private replayStep: number | null = null
  /** Under the UI shell (inSceneControls false) the rotation cards and the formal readouts (word, k, phi, driver
   * captions) are the shell's (context bar, mathematics inspector); the cube, diagonals, objects, identity
   * numbers and line tags stay. */
  private presentation: ScenePresentation = { inSceneControls: true, detailsOpen: false }
  private moving = false

  constructor() {
    this.root.name = 'scene:cube'
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
    const { H } = L
    this.stage.position.copy(L.cube)
    viewPose(L.yaw, L.pitch, this.stage.quaternion)
    this.root.add(this.stage)
    this.stage.add(this.body)

    // Outlined cube: twelve thin edge cylinders in one mesh, a faint glassy fill.
    const edgeParts: BufferGeometry[] = []
    const corners: Vector3[] = []
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) corners.push(new Vector3(x * H, y * H, z * H))
    for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
      const d = tmpV.subVectors(corners[b]!, corners[a]!)
      if (Math.abs(d.length() - 2 * H) > 1e-9) continue
      const c = new CylinderGeometry(0.0017, 0.0017, 2 * H, 6, 1, true)
      c.applyQuaternion(tmpQ.setFromUnitVectors(new Vector3(0, 1, 0), d.clone().normalize()))
      c.translate((corners[a]!.x + corners[b]!.x) / 2, (corners[a]!.y + corners[b]!.y) / 2, (corners[a]!.z + corners[b]!.z) / 2)
      edgeParts.push(c)
    }
    const edges = new Mesh(this.keep(mergeGeometries(edgeParts)!), this.mat(new MeshBasicMaterial({ color: 0x9aa6bd })))
    edgeParts.forEach((g) => g.dispose())
    const fill = new Mesh(this.keep(new BoxGeometry(2 * H, 2 * H, 2 * H)), this.mat(new MeshBasicMaterial({ color: 0x9fb4dc, transparent: true, opacity: 0.055, depthWrite: false, side: DoubleSide })))
    fill.renderOrder = 2
    const hub = new Mesh(this.keep(new SphereGeometry(0.0065, 12, 8)), this.mat(new MeshLambertMaterial({ color: 0xc9d1e0 })))
    this.body.add(edges, fill, hub)

    // Four diagonals: identity colour, end caps in the identity shape (the secondary cue).
    const diagGeo = this.keep(new CylinderGeometry(0.0034, 0.0034, 2 * H * Math.sqrt(3), 10, 1, true))
    const capGeos = [0, 1, 2, 3].map((i) => this.keep(shapeGeometry(i, 0.0082)))
    const tokenGeos = [0, 1, 2, 3].map((i) => this.keep(shapeGeometry(i, 0.0165)))
    for (let i = 0; i < 4; i++) {
      const m = this.mat(new MeshLambertMaterial({ color: IDENTITY[i], emissive: IDENTITY[i], emissiveIntensity: 0.22 }))
      this.idMats.push(m)
      const dir = displayVector(DIAGONALS[i]!, 1).normalize()
      const d = new Mesh(diagGeo, m)
      d.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir)
      d.name = `diag:${i}`
      this.diagonals.push(d)
      this.body.add(d)
      for (const sgn of [1, -1]) {
        const cap = new Mesh(capGeos[i]!, m)
        cap.position.copy(dir).multiplyScalar(sgn * H * Math.sqrt(3))
        this.body.add(cap)
      }
      const t = new Mesh(tokenGeos[i]!, m)
      t.name = `token:${i}`
      this.tokens.push(t)
      this.root.add(t)
    }

    // Selection halos (billboarded rings) around tokens.
    const haloGeo = this.keep(new TorusGeometry(0.029, 0.0019, 6, 40))
    for (let i = 0; i < 4; i++) {
      const h = new Mesh(haloGeo, this.mat(new MeshBasicMaterial({ color: palette.selected, transparent: true, opacity: 0.95 })))
      h.visible = false
      this.halos.push(h)
      this.root.add(h)
    }

    // Rail with four slot pads.
    this.railMat = this.mat(new MeshBasicMaterial({ color: 0x4a5468 }))
    const rail = new Mesh(this.keep(new CylinderGeometry(0.0022, 0.0022, L.padX[3] - L.padX[0] + 0.07, 8, 1)), this.railMat)
    rail.rotation.z = Math.PI / 2
    rail.position.set((L.padX[0] + L.padX[3]) / 2, L.railY - 0.03, L.railZ - 0.01)
    this.root.add(rail)
    const padGeo = this.keep(new TorusGeometry(0.0125, 0.0016, 6, 32))
    for (let j = 0; j < 4; j++) {
      const pm = this.mat(new MeshBasicMaterial({ color: 0x5a6479 }))
      this.padMats.push(pm)
      const pad = new Mesh(padGeo, pm)
      pad.rotation.x = Math.PI / 2
      pad.position.set(L.padX[j]!, L.railY - 0.03, L.railZ - 0.01)
      this.root.add(pad)
      const stem = new Mesh(this.keep(new CylinderGeometry(0.0012, 0.0012, 0.012, 6)), this.railMat)
      stem.position.set(L.padX[j]!, L.railY - 0.022, L.railZ - 0.01)
      this.root.add(stem)
    }

    // Pedestal ring under the cube (glows when the cube drives).
    this.ringMat = this.mat(new MeshBasicMaterial({ color: 0x4a5468, transparent: true, opacity: 0.9 }))
    this.ring = new Mesh(this.keep(new TorusGeometry(0.1, 0.0018, 6, 72)), this.ringMat)
    this.ring.rotation.x = Math.PI / 2
    this.ring.position.set(L.cube.x, L.ringY, L.cube.z)
    this.root.add(this.ring)

    // Rotation axis indicator (space-fixed, in the stage frame): a line and an arc arrow, shown during motion.
    this.axisMat = this.mat(new MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0, depthWrite: false }))
    this.axisLine = new Mesh(this.keep(new CylinderGeometry(0.0011, 0.0011, 2 * H * 2.15, 6, 1, true)), this.axisMat)
    this.axisLine.visible = false
    this.axisArc = new Group()
    const arc = new Mesh(this.keep(new TorusGeometry(0.026, 0.0016, 5, 40, Math.PI * 1.4)), this.axisMat)
    const head = new Mesh(this.keep(new ConeGeometry(0.0055, 0.013, 10)), this.axisMat)
    head.position.set(0.026 * Math.cos(Math.PI * 1.4), 0.026 * Math.sin(Math.PI * 1.4), 0)
    head.rotation.z = Math.PI * 1.4
    this.axisArc.add(arc, head)
    this.axisArc.visible = false
    this.stage.add(this.axisLine, this.axisArc)

    // Small x, y, z tripod (space-fixed axes in the stage frame) so "about x" reads on the cube.
    const tri = new Group()
    tri.position.set(H * 0.2, -H * 1.45, H * 1.75)
    const triMat = this.mat(new MeshBasicMaterial({ color: palette.axis }))
    const shaft = this.keep(new CylinderGeometry(0.0013, 0.0013, 0.044, 6))
    const tip = this.keep(new ConeGeometry(0.0038, 0.01, 8))
    for (let a = 0; a < 3; a++) {
      const e = [0, 0, 0]
      e[a] = 1
      const d = displayVector(e, 1)
      const s = new Mesh(shaft, triMat)
      s.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d)
      s.position.copy(d).multiplyScalar(0.022)
      const t = new Mesh(tip, triMat)
      t.quaternion.copy(s.quaternion)
      t.position.copy(d).multiplyScalar(0.046)
      tri.add(s, t)
      this.axisTagPos[a]!.copy(d).multiplyScalar(0.062).add(tri.position)
    }
    this.stage.add(tri)

    // Space-fixed line-slot tags above the four top corners (each line has exactly one top corner).
    for (let j = 0; j < 4; j++) {
      const v = displayVector(DIAGONALS[j]!, H)
      if (v.y < 0) v.multiplyScalar(-1)
      const out = tmpV2.set(v.x, 0, v.z).normalize().multiplyScalar(0.034)
      this.slotTagPos[j]!.copy(v).add(out).add(tmpV.set(0, 0.018, 0))
    }

    // Rotation cards.
    const plateGeo = this.keep(roundedRect(L.card.w, L.card.h, 0.012))
    const edgeGeo = this.keep(roundedRect(L.card.w + 0.004, L.card.h + 0.004, 0.014))
    for (let c = 0; c < 5; c++) {
      const group = new Group()
      group.position.set(L.cardX[c]!, L.cardsY, L.cardsZ)
      const mat = this.mat(new MeshBasicMaterial({ color: palette.control, transparent: true, opacity: 0.94 }))
      const plate = new Mesh(plateGeo, mat)
      plate.renderOrder = 4
      const rim = new Mesh(edgeGeo, this.mat(new MeshBasicMaterial({ color: 0x3a465e, transparent: true, opacity: 0.9 })))
      rim.position.z = -0.0015
      rim.renderOrder = 3
      const label = new TextSlot(`cube:card${c}`)
      label.anchor.position.set(0, 0.009, 0.004)
      const caption = new TextSlot(`cube:cardCap${c}`)
      caption.anchor.position.set(0, -0.0175, 0.004)
      this.slots.push(label, caption)
      group.add(rim, plate, label.anchor, caption.anchor)
      this.root.add(group)
      this.cards.push({ id: '', group, plate, mat, label, caption })
    }

    // Free text anchors (billboarded one by one; card texts turn with their card).
    this.freeSlots.push(this.word, this.state, this.phiText, this.op, this.capCube, this.capRail, ...this.tokenLabels, ...this.padTags, ...this.diagLabels, ...this.slotTags, ...this.axisTags)
    for (const s of [this.word, this.state, this.phiText, this.op, this.capCube, this.capRail, ...this.tokenLabels, ...this.padTags]) this.root.add(s.anchor)
    for (const s of [...this.diagLabels, ...this.slotTags, ...this.axisTags]) this.stage.add(s.anchor)
    this.word.anchor.position.set(0, L.wordY, 0)
    this.state.anchor.position.set(L.cube.x, L.stateY, 0)
    this.op.anchor.position.set(0, L.stateY, 0)
    this.phiText.anchor.position.set((L.padX[0] + L.padX[3]) / 2, L.stateY, 0)
    this.capCube.anchor.position.set(L.cube.x, L.capCubeY, L.cube.z + 0.04)
    this.capRail.anchor.position.set((L.padX[0] + L.padX[3]) / 2, L.capRailY, L.railZ)
    for (let j = 0; j < 4; j++) {
      this.padTags[j]!.anchor.position.set(L.padX[j]!, L.railY - 0.052, L.railZ)
      this.padTags[j]!.set({ kind: 'plain', plain: `line ${j}`, em: EM.tag, color: 0x8892a6 })
      this.slotTags[j]!.anchor.position.copy(this.slotTagPos[j]!)
      this.slotTags[j]!.set({ kind: 'plain', plain: `line ${j}`, em: EM.tag * 0.92, color: 0x8892a6 })
      this.tokenLabels[j]!.set({ kind: 'plain', plain: String(j), em: EM.label, color: palette.text })
      this.diagLabels[j]!.set({ kind: 'plain', plain: String(j), em: EM.label * 1.1, color: IDENTITY[j]! })
    }
    ;['x', 'y', 'z'].forEach((n, a) => {
      this.axisTags[a]!.anchor.position.copy(this.axisTagPos[a]!)
      this.axisTags[a]!.set({ kind: 'tex', parts: [{ tex: n }], em: EM.label, color: palette.axisLabel, plain: n })
    })
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
    for (const c of this.cards) c.group.visible = p.inSceneControls
    this.applyTextVisibility()
  }

  /** Formal readouts: shown with the scene's own controls; under the shell they are in the mathematics inspector. */
  private applyTextVisibility(): void {
    const formal = this.presentation.inSceneControls
    this.state.setWanted(!this.moving && formal)
    this.phiText.setWanted(!this.moving && formal)
    this.op.setWanted(this.moving && formal)
    this.word.setWanted(formal)
    this.capCube.setWanted(formal)
    this.capRail.setWanted(formal)
  }

  apply(desc: CubeDesc, transition: SceneTransition): void {
    if (this.timeline) this.finish()
    const prev = this.desc
    this.desc = desc
    this.stepOps.clear()
    this.updateStatic(desc)
    const same = prev !== null && prev.experimentId === desc.experimentId
    const prefix = (a: CubeDesc, b: CubeDesc, n: number) => a.history.slice(0, n).every((h, i) => h.element === b.history[i]!.element && h.via === b.history[i]!.via)
    if (transition === 'animate' && same && desc.history.length === prev!.history.length + 1 && prefix(desc, prev!, prev!.history.length)) {
      this.startTimeline('step', [desc.history[desc.history.length - 1]!], false)
    } else if (transition === 'animate' && same && desc.history.length + 1 === prev!.history.length && prefix(prev!, desc, desc.history.length)) {
      this.startTimeline('undo', [prev!.history[prev!.history.length - 1]!], true)
    } else this.snap()
  }

  step(ctx: FrameContext): void {
    const tl = this.timeline
    if (tl) {
      if (tl.playing) tl.time += ctx.dt
      if (tl.time >= tl.total) this.finish()
      else this.evaluate(tl)
    }
    this.place(ctx)
    for (const s of this.slots) s.frame(ctx.time)
  }

  setStepDuration(seconds: number): void {
    this.replayStep = Math.max(0.3, Math.min(5, seconds))
  }

  setPlayback(cmd: PlaybackCommand): PlaybackState {
    const d = this.desc
    if (cmd === 'replay') {
      if (this.timeline) this.finish()
      if (d && d.history.length) this.startTimeline('replay', d.history, false)
    } else if (cmd === 'toggle') {
      if (this.timeline) this.timeline.playing = !this.timeline.playing
      else if (d && d.history.length) this.startTimeline('replay', d.history, false)
    } else if (cmd === 'play') {
      if (this.timeline) this.timeline.playing = true
      else if (d && d.history.length) this.startTimeline('replay', d.history, false)
    } else if (cmd === 'pause') {
      if (this.timeline) this.timeline.playing = false
    } else if (cmd === 'finish') {
      if (this.timeline) this.finish()
    } else if (typeof cmd === 'object' && this.timeline) {
      this.timeline.time = Math.max(0, Math.min(this.timeline.total - 1e-6, cmd.seek))
      this.evaluate(this.timeline)
    }
    return this.playback()
  }

  playback(): PlaybackState {
    const tl = this.timeline
    if (!tl) return { ...IDLE_PLAYBACK }
    const k = this.segmentAt(tl)
    const seg = tl.segments[k]!
    return {
      active: true,
      playing: tl.playing,
      time: tl.time,
      duration: tl.total,
      phase: tl.kind,
      step: { index: tl.kind === 'replay' ? k + 1 : seg.step.index + 1, count: tl.kind === 'replay' ? tl.segments.length : this.desc?.history.length ?? 0, label: seg.step.label.plain },
    }
  }

  pick(ray: Ray): ScenePick | null {
    const d = this.desc
    if (!d || !this.root.visible) return null
    this.root.updateWorldMatrix(true, true)
    let best: ScenePick | null = null
    const offer = (id: string, distance: number | null, actions: unknown[], hint: string) => {
      if (distance !== null && (!best || distance < best.distance)) best = { id, distance, actions, hint }
    }
    // Hidden cards (the shell provides the rotations) have no hit targets.
    if (this.presentation.inSceneControls) for (const c of this.cards) {
      const card = d.cards.find((x) => x.id === c.id)
      if (card) offer(c.id, rayPlate(ray, c.group, L.card.w / 2, L.card.h / 2), card.actions, card.hint)
    }
    for (let i = 0; i < 4; i++) {
      const o = d.objects[i]!
      this.tokens[i]!.getWorldPosition(tmpV)
      offer(`token:${i}`, raySphere(ray, tmpV, 0.026), o.actions, o.hint)
      const [a, b] = this.diagEnds[i]!
      this.body.localToWorld(tmpV.copy(this.diagLabelLocal[i]!).multiplyScalar(L.H * Math.sqrt(3) * 1.06))
      this.body.localToWorld(tmpV2.copy(this.diagLabelLocal[i]!).multiplyScalar(-L.H * Math.sqrt(3) * 1.06))
      a.copy(tmpV)
      b.copy(tmpV2)
      // Thin diagonals: a generous radius, but they all meet at the centre, so the centre hub is excluded.
      const t = raySegment(ray, a, b, 0.009)
      if (t !== null) {
        const p = tmpV.copy(ray.direction).multiplyScalar(t).add(ray.origin)
        this.stage.getWorldPosition(tmpV2)
        if (p.distanceTo(tmpV2) > 0.022) offer(`diag:${i}`, t, o.actions, o.hint)
      }
    }
    return best
  }

  setHover(id: string | null): void {
    if (id === this.hover) return
    this.hover = id
    this.applyHighlight()
  }

  status(): string {
    return this.desc?.status ?? 'Cube: no description yet'
  }

  report(): Record<string, unknown> {
    const d = this.desc
    this.root.updateWorldMatrix(true, true)
    const q = this.body.quaternion
    return {
      layout: 'cube',
      element: d?.element ?? null,
      label: d?.label.plain ?? null,
      phi: d?.phi ?? null,
      occupant: d?.occupant ?? null,
      agree: d?.agree ?? null,
      driver: d?.driver ?? null,
      selectedLine: d?.selectedLine ?? null,
      committed: !this.timeline,
      playback: this.playback(),
      orientation: [q.x, q.y, q.z, q.w].map((v) => +v.toFixed(5)),
      tokenSlots: [...this.tokenSlot],
      tokens: this.tokens.map((t) => [t.position.x, t.position.y, t.position.z].map((v) => +v.toFixed(4))),
      shapes: SHAPE_NAMES,
      readoutsVisible: { state: this.state.isWanted, phi: this.phiText.isWanted, op: this.op.isWanted, word: this.word.isWanted },
      presentation: { ...this.presentation },
      highlighted: this.halos.map((h, i) => (h.visible ? i : -1)).filter((i) => i >= 0),
      slots: this.slots.map((s) => s.report()),
    }
  }

  dispose(): void {
    this.timeline = null
    for (const s of this.slots) s.dispose()
    this.root.removeFromParent()
    for (const g of this.geometries) g.dispose()
    for (const m of this.materials) m.dispose()
  }

  // ---------------------------------------------------------------------------------------------- internals

  /** Texts, cards and selection from the committed description (not per frame). */
  private updateStatic(d: CubeDesc): void {
    const tex = (s: TextSlot, tex: string, plain: string, em: number, color: number) => s.set({ kind: 'tex', parts: [{ tex }], em, color, plain })
    if (d.word) tex(this.word, d.word.tex, d.word.plain, EM.word, palette.text)
    else this.word.set({ kind: 'plain', plain: 'Home: rotate the cube, or pick two objects to swap', em: EM.word * 0.9, color: palette.textDim })
    tex(this.state, d.state.tex, d.state.plain, EM.state, palette.text)
    tex(this.phiText, d.phiText.tex, d.phiText.plain, EM.state, palette.text)
    this.setCaptions(d.history[d.history.length - 1] ?? null)
    d.cards.forEach((c, i) => {
      const card = this.cards[i]!
      card.id = c.id
      // Constant colours, opacity for the disabled state (a plain slot does not redraw on a colour-only change).
      card.label.set({ kind: 'tex', parts: [{ tex: c.label.tex }], em: EM.card, color: palette.text, plain: c.label.plain })
      if (c.caption.tex) card.caption.set({ kind: 'tex', parts: [{ tex: c.caption.tex }], em: EM.cardCaption * 1.05, color: palette.textDim, plain: c.caption.plain })
      else card.caption.set({ kind: 'plain', plain: c.caption.plain, em: EM.cardCaption, color: palette.textDim })
      card.label.setOpacity(c.enabled ? 1 : 0.45)
      card.caption.setOpacity(c.enabled ? 1 : 0.6)
    })
    this.applyHighlight()
  }

  /** Captions and driver glow for one step (the last committed one, or the step a replay is showing). */
  private setCaptions(step: CubeStepDesc | null): void {
    const tex = (sl: TextSlot, t: string, plain: string, color: number) => sl.set({ kind: 'tex', parts: [{ tex: t }], em: EM.caption, color, plain })
    const cyc = (c: string) => c.replace(/ /g, '\\;')
    if (!step) {
      this.capCube.set({ kind: 'plain', plain: 'the cube', em: EM.caption, color: palette.textDim })
      this.capRail.set({ kind: 'plain', plain: 'four objects, one per diagonal', em: EM.caption, color: palette.textDim })
    } else if (step.via === 'element') {
      tex(this.capCube, `\\textsf{driving: }${step.label.tex}\\textsf{ turns the cube}`, `driving: ${step.label.plain} turns the cube`, ACCENT)
      tex(this.capRail, step.phiCycles === '()' ? '\\textsf{the objects follow: they stay}' : `\\textsf{the objects follow: }${cyc(step.phiCycles)}`, `the objects follow: ${step.phiCycles}`, palette.textDim)
    } else {
      tex(this.capCube, `\\textsf{the cube follows: }${step.label.tex}`, `the cube follows: ${step.label.plain}`, palette.textDim)
      const what = step.swapped ? `\\textsf{swap ${step.swapped[0]} and ${step.swapped[1]}}` : cyc(step.phiCycles)
      const whatPlain = step.swapped ? `swap ${step.swapped[0]} and ${step.swapped[1]}` : step.phiCycles
      tex(this.capRail, `\\textsf{driving: }${what}\\textsf{, the unique rotation }${step.label.tex}`, `driving: ${whatPlain}, the unique rotation ${step.label.plain}`, ACCENT)
    }
    const driver = step ? (step.via === 'element' ? 'cube' : 'objects') : null
    this.ringMat.color.setHex(driver === 'cube' ? ACCENT : 0x4a5468)
    this.railMat.color.setHex(driver === 'objects' ? ACCENT : 0x4a5468)
    for (const pm of this.padMats) pm.color.setHex(driver === 'objects' ? 0x6fc7dd : 0x5a6479)
  }

  private applyHighlight(): void {
    const d = this.desc
    for (let i = 0; i < 4; i++) {
      const sel = d?.selectedLine === i
      const hov = this.hover === `token:${i}` || this.hover === `diag:${i}`
      // With a first diagonal selected, the hovered second one is the swap partner: both identities ringed.
      const partner = hov && !sel && d?.selectedLine !== null && d?.selectedLine !== undefined
      this.idMats[i]!.emissiveIntensity = sel ? 0.6 : partner ? 0.52 : hov ? 0.42 : 0.22
      this.diagonals[i]!.scale.set(sel ? 1.9 : partner ? 1.6 : hov ? 1.4 : 1, 1, sel ? 1.9 : partner ? 1.6 : hov ? 1.4 : 1)
      this.tokens[i]!.scale.setScalar(sel ? 1.15 : hov ? 1.1 : 1)
      this.halos[i]!.visible = sel || partner
      ;(this.halos[i]!.material as MeshBasicMaterial).opacity = sel ? 0.95 : 0.6
      this.diagLabels[i]!.setWanted(sel || hov)
    }
    for (const c of this.cards) {
      const card = d?.cards.find((x) => x.id === c.id)
      c.mat.color.setHex(card && !card.enabled ? 0x1a202c : this.hover === c.id ? palette.controlHover : palette.control)
    }
  }

  private snap(): void {
    const d = this.desc
    if (!d) return
    displayQuaternion(d.matrix, this.body.quaternion)
    for (let i = 0; i < 4; i++) this.tokenSlot[i] = d.phi[i]!
    for (let i = 0; i < 4; i++) this.tokenPos[i]!.set(L.padX[d.phi[i]!]!, L.railY, L.railZ)
    this.setMoving(false, null)
  }

  private startTimeline(kind: Timeline['kind'], steps: readonly CubeStepDesc[], reverse: boolean): void {
    const g = groupOf({ kind: 'cube_rotations' })
    const segments: Segment[] = []
    let t = kind === 'replay' ? 0.45 : 0
    for (const s of steps) {
      const dur = kind === 'replay' && this.replayStep !== null ? this.replayStep : stepDuration(s)
      const axis = s.axis ? displayVector(s.axis, 1) : new Vector3(0, 1, 0)
      segments.push({
        step: s,
        start: t,
        dur,
        q0: displayQuaternion(g.matrix(reverse ? s.after : s.before)!),
        q1: displayQuaternion(g.matrix(reverse ? s.before : s.after)!),
        axis,
        angle: reverse ? -s.angle : s.angle,
        from: reverse ? s.slotsAfter : s.slotsBefore,
        to: reverse ? s.slotsBefore : s.slotsAfter,
      })
      t += dur + (kind === 'replay' ? 0.4 : 0)
    }
    const total = kind === 'replay' ? t : t
    this.timeline = { kind, segments, total, time: 0, playing: true, shown: -1 }
    this.evaluate(this.timeline)
  }

  private segmentAt(tl: Timeline): number {
    for (let k = 0; k < tl.segments.length; k++) if (tl.time < tl.segments[k]!.start + tl.segments[k]!.dur) return k
    return tl.segments.length - 1
  }

  private evaluate(tl: Timeline): void {
    const k = this.segmentAt(tl)
    const seg = tl.segments[k]!
    const u = clamp01((tl.time - seg.start) / seg.dur)
    const e = ease(u)
    if (u <= 0) this.body.quaternion.copy(seg.q0)
    else if (u >= 1) this.body.quaternion.copy(seg.q1)
    else this.body.quaternion.setFromAxisAngle(seg.axis, seg.angle * e).multiply(seg.q0)
    for (let i = 0; i < 4; i++) {
      const a = seg.from[i]!
      const b = seg.to[i]!
      const xa = L.padX[a]!
      const xb = L.padX[b]!
      const lift = a === b ? 0 : Math.sign(b - a) * (0.022 + 0.011 * Math.abs(b - a))
      const arc = Math.sin(Math.PI * e)
      this.tokenPos[i]!.set(xa + (xb - xa) * e, L.railY + lift * arc, L.railZ + Math.sign(b - a) * 0.025 * arc)
      this.tokenSlot[i] = e < 0.5 ? a : b
    }
    if (tl.shown !== k) {
      tl.shown = k
      const undo = tl.kind === 'undo'
      const opKey = undo ? -1 - seg.step.index : seg.step.index
      let c = this.stepOps.get(opKey)
      if (!c) {
        c = undo
          ? { kind: 'tex', parts: [{ tex: `\\textsf{undoing }${seg.step.label.tex}\\textsf{: turning back the same way}` }], em: EM.state * 0.86, color: ACCENT, plain: `undoing ${seg.step.label.plain}: turning back the same way` }
          : { kind: 'tex', parts: [{ tex: seg.step.op.tex }], em: EM.state * 0.86, color: ACCENT, plain: seg.step.op.plain }
        this.stepOps.set(opKey, c)
      }
      this.op.set(c)
      if (tl.kind === 'replay') this.setCaptions(seg.step)
      this.axisLine.quaternion.setFromUnitVectors(tmpV.set(0, 1, 0), seg.axis)
      this.axisArc.quaternion.setFromUnitVectors(tmpV.set(0, 0, 1), seg.axis)
      if (seg.angle < 0) this.axisArc.quaternion.multiply(tmpQ.setFromAxisAngle(tmpV.set(1, 0, 0), Math.PI))
      this.axisArc.position.copy(seg.axis).multiplyScalar(L.H * 2.0)
      this.setMoving(true, seg)
    }
    // Axis indicator fades in and out with each segment.
    const vis = u <= 0 ? 0.35 : u >= 1 ? 0.35 : Math.min(1, Math.sin(Math.PI * Math.min(1, u * 1.15)) + 0.35)
    this.axisMat.opacity = 0.85 * vis
  }

  private setMoving(moving: boolean, seg: Segment | null): void {
    this.moving = moving
    this.applyTextVisibility()
    this.axisLine.visible = moving && seg !== null && seg.step.axis !== null
    this.axisArc.visible = this.axisLine.visible
    if (!moving) this.axisMat.opacity = 0
  }

  private finish(): void {
    const replayed = this.timeline?.kind === 'replay'
    this.timeline = null
    this.snap()
    if (replayed && this.desc) this.setCaptions(this.desc.history[this.desc.history.length - 1] ?? null)
  }

  /** Per frame: place tokens, halos and billboard every free label toward the head (no allocation). */
  private place(ctx: FrameContext): void {
    const head = ctx.head
    for (let i = 0; i < 4; i++) {
      const t = this.tokens[i]!
      t.position.copy(this.tokenPos[i]!)
      t.rotation.y = 0.45 + i * 0.3
      t.rotation.x = 0.35
      const h = this.halos[i]!
      if (h.visible) {
        h.position.copy(t.position)
        h.lookAt(head)
      }
      const lab = this.tokenLabels[i]!
      lab.anchor.position.set(t.position.x, t.position.y + 0.043, t.position.z)
      // Diagonal label (selected/hovered only) beyond its lower end, which has no line tag near it.
      const lab2 = this.diagLabels[i]!
      if (lab2.isWanted) {
        const p = lab2.anchor.position.copy(this.diagLabelLocal[i]!).applyQuaternion(this.body.quaternion)
        tmpV.copy(p).applyQuaternion(this.stage.quaternion)
        p.multiplyScalar((tmpV.y > 0 ? -1 : 1) * (L.H * Math.sqrt(3) + 0.026))
      }
    }
    sharedFacing(this.root, head, this.pivot, this.qRoot)
    this.qStage.copy(this.stage.quaternion).invert().multiply(this.qRoot)
    for (const s of this.freeSlots) if (s.anchor.visible) s.anchor.quaternion.copy(s.anchor.parent === this.stage ? this.qStage : this.qRoot)
    for (const c of this.cards) faceToward(c.group, this.root, head, this.pivot)
  }
}
