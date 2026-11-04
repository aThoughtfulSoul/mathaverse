// WalkScene: the proof lesson's staged explanation (PROOF-EXPLORER-SPEC sections 3-4; src/domains/scene.ts).
//
// It draws a WalkDesc (derive.ts) as a Pose (pose.ts) of the current stage at the current construction time:
//  - main view (left): a luminous origin ("home"), the occurrence arrows head to tail with persistent name tags and
//    +/− badges, the faint source ghost, the bound spheres (source bound B, new bound R) and the actual peaks;
//  - secondary panel (right, SAME scale): the auxiliary signed walk of signed copies and signed bound D;
//  - Why: the witness prefixes U_j and S_j, the two half-sized resultants head to tail from the origin, ending at
//    W_k (plus T when T ≠ 0), and the available length (B + D)/2;
//  - a short text column (case, caption, hypotheses, formal lines under Show mathematics).
// The scene never edits state: a press returns `select_item` actions. Stage, playback and presentation are local.

import {
  AdditiveBlending, CanvasTexture, ConeGeometry, CylinderGeometry, DoubleSide, Group, InstancedMesh, LineBasicMaterial, Matrix4,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, Ray, RingGeometry, SphereGeometry, SRGBColorSpace,
  TorusGeometry, BufferGeometry, Float32BufferAttribute, LineSegments, Vector3, type Material, type Object3D,
} from 'three'
import type { FrameContext } from '../../runtime/host'
import type { PlaybackCommand, PlaybackState } from '../../rendering/adapter'
import { TextSlot, type SlotContent } from '../../rendering/textSlot'
import { palette } from '../../ui/palette'
import type { ScenePresentation } from '../../ui/model'
import type { WalkStage } from '../inputs'
import { IDLE_PLAYBACK, type DomainScene, type ScenePick, type SceneTransition } from '../scene'
import { benchVector, sub, WALK_LAYOUT, type TextLine, type WalkDesc, type WitnessDesc } from './derive'
import {
  WALK_COLORS, blendPose, composeStage, copyPose, emptyPose, makePose, mixColor, selectedWitness, stageTiming, walkGeometry,
  type ArrowPose, type BlendMode, type LinePose, type Pose, type V3, type WalkGeometry,
} from './pose'

export const STAGE_NAMES: Record<WalkStage, string> = { walk: 'Walk', signs: 'Signs', reorder: 'Reorder', why: 'Why', assumptions: 'Assumptions' }

/** Text sizes (metres). Essential labels (bounds, the selected endpoint, U_j, S_j, the half lengths) are the
 * largest; name tags and numbers are quieter but never below 15 mm. */
const EM = { tag: 0.0158, case: 0.0165, caption0: 0.024, caption: 0.0195, label: 0.0215, peak: 0.0185, small: 0.0172, detail: 0.0165, detailTex: 0.019, hyp: 0.0185, number: 0.0165, panel: 0.0175 } as const
const ARROW = { shaft: 0.0026, headL: 0.0145, headR: 0.0063 } as const
const WIDTH = { live: 1, ghost: 0.6, copy: 0.8, half: 1.55 } as const
const COLUMN = { x: WALK_LAYOUT.textX, w: 0.34 } as const
const BLEND = { stage: 0.35, morph: 1.6, fade: 0.45, select: 0.3 } as const
const vA = new Vector3()
const vB = new Vector3()
const UP = new Vector3(0, 1, 0)
const qTmp = new Quaternion()
const mTmp = new Matrix4()

type Change = 'first' | 'same' | 'selection' | 'signs' | 'data'

const plain = (text: string, em: number, color: number): SlotContent => ({ kind: 'plain', plain: text, em, color })

function radialTexture(inner: string, outer: string): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, inner)
  g.addColorStop(0.35, outer)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

/** A round sign badge: a coloured disc with a dark + or − bar. */
function badgeTexture(sign: 1 | -1): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')!
  ctx.fillStyle = sign === 1 ? '#ffc95c' : '#b9a2ff'
  ctx.beginPath()
  ctx.arc(32, 32, 29, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#0b0e15'
  ctx.stroke()
  ctx.fillStyle = '#0b0e15'
  ctx.fillRect(15, 28, 34, 8)
  if (sign === 1) ctx.fillRect(28, 15, 8, 34)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}

// ------------------------------------------------------------------ drawables

/** Scene labels draw over the geometry (plain-text layer; no depth test), so a nearer arrow never hides a label. */
function overlay(s: TextSlot): TextSlot {
  s.anchor.traverse((o) => {
    const m = (o as Mesh).material as Material | undefined
    if (m) m.depthTest = false
  })
  return s
}

class ArrowMesh {
  readonly group = new Group()
  readonly shaft: Mesh
  readonly head: Mesh
  readonly zero: Mesh
  readonly mat: MeshStandardMaterial
  /** Optional glow sleeve (the Why construction): additive, wider than the shaft. */
  readonly sleeve: Mesh | null
  readonly sleeveMat: MeshBasicMaterial | null
  /** Bench-local tail and head of what is drawn (for picking, labels and the report). */
  readonly tail = new Vector3()
  readonly tip = new Vector3()
  length = 0
  visible = false

  constructor(shaftGeo: BufferGeometry, headGeo: BufferGeometry, zeroGeo: BufferGeometry, readonly width: number, glowSleeve = false) {
    this.mat = new MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.48, metalness: 0.05, transparent: true })
    this.shaft = new Mesh(shaftGeo, this.mat)
    this.head = new Mesh(headGeo, this.mat)
    this.zero = new Mesh(zeroGeo, this.mat)
    this.zero.scale.setScalar(0.0068)
    this.group.add(this.shaft, this.head, this.zero)
    if (glowSleeve) {
      this.sleeveMat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: AdditiveBlending })
      this.sleeve = new Mesh(shaftGeo, this.sleeveMat)
      this.group.add(this.sleeve)
    } else {
      this.sleeveMat = null
      this.sleeve = null
    }
  }

  update(p: ArrowPose): void {
    const op = p.op
    this.visible = op > 0.01
    this.group.visible = this.visible
    if (!this.visible) return
    this.tail.set(p.tail[0], p.tail[1], p.tail[2])
    vA.set(p.vec[0], p.vec[1], p.vec[2])
    const len = vA.length()
    this.length = len
    this.tip.copy(this.tail).add(vA)
    const w = this.width
    if (len < 1e-6) {
      this.shaft.visible = false
      this.head.visible = false
      if (this.sleeve) this.sleeve.visible = false
      this.zero.visible = p.zero
      this.zero.position.copy(this.tail)
    } else {
      this.zero.visible = false
      vA.multiplyScalar(1 / len)
      qTmp.setFromUnitVectors(UP, vA)
      const hl = Math.min(ARROW.headL * w, len * 0.5)
      const hr = ARROW.headR * w * (hl / (ARROW.headL * w))
      const r = ARROW.shaft * w
      this.shaft.visible = true
      this.head.visible = true
      this.shaft.position.copy(this.tail)
      this.shaft.quaternion.copy(qTmp)
      this.shaft.scale.set(r, Math.max(1e-5, len - hl * 0.8), r)
      this.head.position.copy(this.tail).addScaledVector(vA, len - hl)
      this.head.quaternion.copy(qTmp)
      this.head.scale.set(hr, hl, hr)
      if (this.sleeve) {
        this.sleeve.visible = true
        this.sleeve.position.copy(this.tail)
        this.sleeve.quaternion.copy(qTmp)
        this.sleeve.scale.set(r * 3.2, len, r * 3.2)
      }
    }
    this.mat.color.setHex(p.color)
    this.mat.emissive.setHex(p.color)
    this.mat.emissiveIntensity = 0.3 + 0.6 * p.glow
    this.mat.opacity = op
    this.mat.depthWrite = op > 0.6
    if (this.sleeveMat) {
      this.sleeveMat.color.setHex(p.color)
      this.sleeveMat.opacity = 0.22 * op
    }
  }

  dispose(): void {
    this.mat.dispose()
    this.sleeveMat?.dispose()
    this.group.removeFromParent()
  }
}

/** A bound as a quiet wire ring: the sphere's silhouette facing the viewer (3D) or the circle in the walk's plane (2D). */
class BoundSphere {
  readonly group = new Group()
  readonly ring: Mesh
  readonly ringMat: MeshBasicMaterial
  readonly label: TextSlot
  private builtR = 0
  r = 0
  op = 0
  private flat = false

  constructor(readonly role: 'B' | 'R' | 'D', color: number) {
    this.ringMat = new MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: DoubleSide })
    this.ring = new Mesh(new RingGeometry(0.99, 1, 160), this.ringMat)
    this.ring.renderOrder = 2
    this.group.add(this.ring)
    this.label = overlay(new TextSlot(`walk:bound:${role}`))
  }

  setFrame(desc: WalkDesc): void {
    this.flat = desc.dimension === 2
    if (this.flat) {
      // The circle lies in the walk's plane: orient the ring mesh by the plane's frame.
      const view = { scale: 1, yaw: desc.view.yaw, pitch: desc.view.pitch }
      const ex = benchVector(view, [1, 0, 0])
      const ey = benchVector(view, [0, 1, 0])
      vA.set(ex[0], ex[1], ex[2])
      vB.set(ey[0], ey[1], ey[2])
      const ez = new Vector3().crossVectors(vA, vB)
      this.ring.quaternion.setFromRotationMatrix(mTmp.makeBasis(vA, vB, ez))
    }
  }

  place(origin: V3): void {
    this.group.position.set(origin[0], origin[1], origin[2])
  }

  update(r: number, op: number, emph: number, head: Vector3): void {
    this.r = r
    this.op = op
    this.group.visible = op > 0.01 && r > 1e-5
    if (!this.group.visible) {
      this.label.setWanted(false)
      return
    }
    if (Math.abs(r - this.builtR) > this.builtR * 0.15 || this.builtR === 0) {
      const width = this.role === 'B' ? 0.0018 : 0.0024
      this.ring.geometry.dispose()
      this.ring.geometry = new RingGeometry(Math.max(0.2, 1 - width / r), 1, 180)
      this.builtR = r
    }
    this.ring.scale.setScalar(r)
    if (!this.flat) this.ring.lookAt(head)
    this.ringMat.opacity = op * (0.5 + 0.5 * emph)
  }

  dispose(): void {
    this.ring.geometry.dispose()
    this.ringMat.dispose()
    this.label.dispose()
    this.group.removeFromParent()
  }
}

/**
 * Greedy label layout in the bench x-y plane (the seated viewer looks along -z): each label takes the first of its
 * candidate positions that overlaps no placed label and crosses no drawn arrow, keeping its previous choice when
 * that is still as good (no flicker). Leaders join displaced labels to their referents.
 */
class LabelLayout {
  private readonly boxes: number[] = []
  private readonly segs: number[] = []
  private readonly prev = new Map<string, number>()
  /** Cost of the last choice (0: free). */
  lastCost = 0

  reset(): void {
    this.boxes.length = 0
    this.segs.length = 0
  }

  segment(a: Vector3, b: Vector3): void {
    this.segs.push(a.x, a.y, b.x, b.y)
  }

  add(x0: number, y0: number, x1: number, y1: number): void {
    this.boxes.push(x0, y0, x1, y1)
  }

  cost(x0: number, y0: number, x1: number, y1: number): number {
    let c = 0
    const m = 0.002
    for (let i = 0; i < this.boxes.length; i += 4) {
      if (x0 - m < this.boxes[i + 2]! && x1 + m > this.boxes[i]! && y0 - m < this.boxes[i + 3]! && y1 + m > this.boxes[i + 1]!) c += 3
    }
    for (let i = 0; i < this.segs.length; i += 4) if (segBox(this.segs[i]!, this.segs[i + 1]!, this.segs[i + 2]!, this.segs[i + 3]!, x0, y0, x1, y1)) c += 1
    return c
  }

  /** Choose among candidate centres for a w × h box; returns the index. */
  choose(key: string, cx: readonly number[], cy: readonly number[], w: number, h: number): number {
    let best = 0
    let bestCost = Infinity
    for (let i = 0; i < cx.length; i++) {
      const c = this.cost(cx[i]! - w / 2, cy[i]! - h / 2, cx[i]! + w / 2, cy[i]! + h / 2)
      if (c < bestCost) {
        bestCost = c
        best = i
      }
      if (c === 0) break
    }
    const p = this.prev.get(key)
    if (p !== undefined && p < cx.length && p !== best) {
      const c = this.cost(cx[p]! - w / 2, cy[p]! - h / 2, cx[p]! + w / 2, cy[p]! + h / 2)
      if (c <= bestCost) best = p
    }
    this.prev.set(key, best)
    this.lastCost = bestCost
    this.add(cx[best]! - w / 2, cy[best]! - h / 2, cx[best]! + w / 2, cy[best]! + h / 2)
    return best
  }

}

/** Does segment (ax, ay)-(bx, by) cross the box (slightly shrunk)? Liang-Barsky clipping. */
function segBox(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
  const s = 0.0015
  x0 += s
  y0 += s
  x1 -= s
  y1 -= s
  let t0 = 0
  let t1 = 1
  const dx = bx - ax
  const dy = by - ay
  const p = [-dx, dx, -dy, dy]
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! < 0) return false
    } else {
      const r = q[i]! / p[i]!
      if (p[i]! < 0) t0 = Math.max(t0, r)
      else t1 = Math.min(t1, r)
      if (t0 > t1) return false
    }
  }
  return true
}

/** Thin leader lines (one draw call), rebuilt each frame from the label layout. */
class Leaders {
  readonly lines: LineSegments
  private readonly pos = new Float32Array(32 * 6)
  private readonly col = new Float32Array(32 * 6)
  private count = 0
  constructor() {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(this.pos, 3))
    g.setAttribute('color', new Float32BufferAttribute(this.col, 3))
    this.lines = new LineSegments(g, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false }))
    this.lines.frustumCulled = false
    this.lines.renderOrder = 3
  }
  begin(): void {
    this.count = 0
  }
  add(a: Vector3, b: Vector3, color: number, op: number): void {
    if (this.count >= 32) return
    const i = this.count * 6
    this.pos.set([a.x, a.y, a.z, b.x, b.y, b.z], i)
    const r = (((color >> 16) & 255) / 255) * op
    const gg = (((color >> 8) & 255) / 255) * op
    const bb = ((color & 255) / 255) * op
    this.col.set([r, gg, bb, r, gg, bb], i)
    this.count++
  }
  end(): void {
    const g = this.lines.geometry
    g.setDrawRange(0, this.count * 2)
    ;(g.attributes.position as Float32BufferAttribute).needsUpdate = true
    ;(g.attributes.color as Float32BufferAttribute).needsUpdate = true
    g.boundingBox = null
    g.boundingSphere = null
    this.lines.visible = this.count > 0
  }
  dispose(): void {
    this.lines.geometry.dispose()
    ;(this.lines.material as Material).dispose()
    this.lines.removeFromParent()
  }
}

/** A dashed straight guide (instanced short cylinders). */
class Dashes {
  readonly mesh: InstancedMesh
  readonly mat: MeshBasicMaterial
  constructor(geo: BufferGeometry, color: number, private readonly radius = 0.0009) {
    this.mat = new MeshBasicMaterial({ color, transparent: true, depthWrite: false })
    this.mesh = new InstancedMesh(geo, this.mat, 48)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
  }

  update(l: LinePose): void {
    this.mesh.visible = l.op > 0.01
    if (!this.mesh.visible) return
    vA.set(l.a[0], l.a[1], l.a[2])
    vB.set(l.b[0] - l.a[0], l.b[1] - l.a[1], l.b[2] - l.a[2])
    const len = vB.length()
    if (len < 1e-5) {
      this.mesh.count = 0
      return
    }
    vB.multiplyScalar(1 / len)
    qTmp.setFromUnitVectors(UP, vB)
    const period = 0.011
    const count = Math.min(48, Math.max(1, Math.floor(len / period)))
    const dash = Math.min(0.006, len / count * 0.55)
    const s = new Vector3(this.radius, dash, this.radius)
    for (let i = 0; i < count; i++) {
      const p = new Vector3().copy(vA).addScaledVector(vB, (i + 0.5) * (len / count) - dash / 2)
      mTmp.compose(p, qTmp, s)
      this.mesh.setMatrixAt(i, mTmp)
    }
    this.mesh.count = count
    this.mesh.instanceMatrix.needsUpdate = true
    this.mat.opacity = l.op
  }

  dispose(): void {
    this.mat.dispose()
    this.mesh.dispose()
    this.mesh.removeFromParent()
  }
}

interface Built {
  n: number
  live: ArrowMesh[]
  ghost: ArrowMesh[]
  copy: ArrowMesh[]
  badges: Mesh[]
  badgeMats: MeshBasicMaterial[]
  tags: TextSlot[]
  copyTags: TextSlot[]
  dots: { source: Mesh[]; reordered: Mesh[]; signed: Mesh[] }
  /** Coincident reordered endpoints share one number label ("0 · 6 · 12"). */
  numbers: { ks: number[]; slot: TextSlot }[]
  /** Tag side (+1 / -1), smoothed so a moving tag does not jump sides. */
  tagSide: number[]
}

// ------------------------------------------------------------------ scene

export class WalkScene implements DomainScene<WalkDesc> {
  readonly layout = 'walk' as const
  readonly root = new Group()
  /** Applies and how they were shown (verification). */
  readonly stats = { applies: 0, animated: 0, snapped: 0, morphs: 0, faded: 0, stageChanges: 0 }
  lastChange: Change | 'none' = 'none'

  private desc: WalkDesc | null = null
  private geo: WalkGeometry | null = null
  private stage: WalkStage = 'walk'
  private stepSeconds = 0.5
  private clock = { t: 0, duration: 0, playing: false }
  private transition: { from: Pose; t: number; dur: number; mode: BlendMode } | null = null
  private target: Pose = makePose(0)
  private shown: Pose = makePose(0)
  private built: Built | null = null
  private presentation: ScenePresentation = { inSceneControls: true, detailsOpen: false }
  private hover: string | null = null
  private head = new Vector3(0, 1.2, 0.36)
  private now = 0
  private scaleNote: string | null = null

  // Shared resources.
  private readonly geos = {
    shaft: new CylinderGeometry(1, 1, 1, 10, 1, false).translate(0, 0.5, 0),
    head: new ConeGeometry(1, 1, 16).translate(0, 0.5, 0),
    zero: new TorusGeometry(1, 0.2, 8, 28),
    dot: new SphereGeometry(1, 14, 10),
    ring: new RingGeometry(0.72, 1, 40),
    plane: new PlaneGeometry(1, 1),
    dash: new CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0),
  }
  private readonly tex = { halo: radialTexture('rgba(255,255,255,0.95)', 'rgba(255,240,210,0.35)'), plus: badgeTexture(1), minus: badgeTexture(-1) }
  private readonly mats = {
    dotSource: new MeshBasicMaterial({ color: 0xd8e8ff, transparent: true }),
    dotReordered: new MeshBasicMaterial({ color: 0xfff1d0, transparent: true }),
    dotSigned: new MeshBasicMaterial({ color: 0xc3f5ec, transparent: true }),
    origin: new MeshBasicMaterial({ color: WALK_COLORS.origin, transparent: true }),
    originHalo: new MeshBasicMaterial({ map: null, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffe3a8 }),
    tracer: new MeshBasicMaterial({ color: 0xffffff, transparent: true }),
    tracerHalo: new MeshBasicMaterial({ map: null, transparent: true, depthWrite: false, blending: AdditiveBlending, color: 0xffffff }),
    home: new MeshBasicMaterial({ color: 0xfff1cf, transparent: true, depthWrite: false, side: DoubleSide }),
  }
  private readonly origin: Mesh
  private readonly originHalo: Mesh
  private readonly panelOrigin: Mesh
  private readonly tracer: Mesh
  private readonly tracerHalo: Mesh
  private readonly panelTracer: Mesh
  private readonly homeRing: Mesh
  private readonly rings: Record<'U' | 'S' | 'W' | 'zero' | 'fail' | 'hover' | 'peakSource' | 'peakReordered' | 'peakSigned', Mesh>
  private readonly spheres: { B: BoundSphere; R: BoundSphere; D: BoundSphere }
  private readonly guides: { U: Dashes; S: Dashes; peakSource: Dashes; peakReordered: Dashes }
  private readonly halves: [ArrowMesh, ArrowMesh]
  private readonly resid: ArrowMesh
  private readonly totalArrow: ArrowMesh
  private readonly allTexts: TextSlot[] = []
  private readonly texts: {
    case: TextSlot
    caption: [TextSlot, TextSlot, TextSlot, TextSlot]
    hyp: [TextSlot, TextSlot, TextSlot, TextSlot]
    details: TextSlot[]
    origin: TextSlot
    panel: TextSlot
    peakSource: TextSlot
    peakReordered: TextSlot
    peakSigned: TextSlot
    ringU: TextSlot
    ringS: TextSlot
    ringW: TextSlot
    half0: TextSlot
    half1: TextSlot
    resid: TextSlot
    total: TextSlot
    fail: TextSlot
  }
  /** Last content key per slot (so per-frame updates do no work at rest). */
  private readonly keys = new Map<TextSlot, string>()
  private readonly layout2d = new LabelLayout()
  private readonly columnTexts = new Set<TextSlot>()
  private readonly leaders = new Leaders()

  constructor() {
    this.root.name = 'walk-scene'
    this.mats.originHalo.map = this.tex.halo
    this.mats.tracerHalo.map = this.tex.halo
    this.origin = new Mesh(this.geos.dot, this.mats.origin)
    this.origin.scale.setScalar(0.0062)
    this.originHalo = new Mesh(this.geos.plane, this.mats.originHalo)
    this.originHalo.scale.setScalar(0.05)
    this.panelOrigin = new Mesh(this.geos.dot, this.mats.origin)
    this.panelOrigin.scale.setScalar(0.0045)
    this.tracer = new Mesh(this.geos.dot, this.mats.tracer)
    this.tracer.scale.setScalar(0.0058)
    this.tracerHalo = new Mesh(this.geos.plane, this.mats.tracerHalo)
    this.tracerHalo.scale.setScalar(0.04)
    this.panelTracer = new Mesh(this.geos.dot, this.mats.tracer)
    this.panelTracer.scale.setScalar(0.0045)
    this.homeRing = new Mesh(this.geos.ring, this.mats.home)
    const ringMat = (c: number) => new MeshBasicMaterial({ color: c, transparent: true, depthWrite: false, side: DoubleSide })
    this.rings = {
      U: new Mesh(this.geos.ring, ringMat(WALK_COLORS.source)),
      S: new Mesh(this.geos.ring, ringMat(WALK_COLORS.signed)),
      W: new Mesh(this.geos.ring, ringMat(WALK_COLORS.selected)),
      zero: new Mesh(this.geos.ring, ringMat(0x9ff5c8)),
      fail: new Mesh(this.geos.ring, ringMat(WALK_COLORS.residual)),
      hover: new Mesh(this.geos.ring, ringMat(0xffffff)),
      peakSource: new Mesh(this.geos.ring, ringMat(0xd8e1f0)),
      peakReordered: new Mesh(this.geos.ring, ringMat(0xd8e1f0)),
      peakSigned: new Mesh(this.geos.ring, ringMat(0xc3f5ec)),
    }
    for (const r of Object.values(this.rings)) r.renderOrder = 3
    this.spheres = { B: new BoundSphere('B', WALK_COLORS.boundB), R: new BoundSphere('R', WALK_COLORS.boundR), D: new BoundSphere('D', WALK_COLORS.boundD) }
    this.guides = {
      U: new Dashes(this.geos.dash, WALK_COLORS.source),
      S: new Dashes(this.geos.dash, WALK_COLORS.signed),
      peakSource: new Dashes(this.geos.dash, 0xc9d1e0, 0.0007),
      peakReordered: new Dashes(this.geos.dash, 0xc9d1e0, 0.0007),
    }
    this.halves = [this.arrowMesh(WIDTH.half, true), this.arrowMesh(WIDTH.half, true)]
    this.resid = this.arrowMesh(WIDTH.half, true)
    this.totalArrow = this.arrowMesh(WIDTH.half, true)
    this.root.add(this.leaders.lines)
    this.root.add(this.origin, this.originHalo, this.panelOrigin, this.tracer, this.tracerHalo, this.panelTracer, this.homeRing, ...Object.values(this.rings))
    for (const s of Object.values(this.spheres)) {
      this.root.add(s.group, s.label.anchor)
      this.allTexts.push(s.label)
    }
    for (const g of Object.values(this.guides)) this.root.add(g.mesh)
    this.root.add(this.halves[0].group, this.halves[1].group, this.resid.group, this.totalArrow.group)
    const t = (id: string) => this.text(id)
    this.texts = {
      case: t('case'),
      caption: [t('caption0'), t('caption1'), t('caption2'), t('caption3')],
      hyp: [t('hyp0'), t('hyp1'), t('hyp2'), t('hyp3')],
      details: Array.from({ length: 6 }, (_, i) => t(`detail${i}`)),
      origin: t('origin'),
      panel: t('panel'),
      peakSource: t('peakSource'),
      peakReordered: t('peakReordered'),
      peakSigned: t('peakSigned'),
      ringU: t('ringU'),
      ringS: t('ringS'),
      ringW: t('ringW'),
      half0: t('half0'),
      half1: t('half1'),
      resid: t('resid'),
      total: t('total'),
      fail: t('fail'),
    }
    for (const c of [this.texts.case, ...this.texts.caption, ...this.texts.hyp, ...this.texts.details]) this.columnTexts.add(c)
  }

  // ---------------------------------------------------------------- DomainScene

  mount(parent: Object3D): void {
    parent.add(this.root)
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible
  }

  setPresentation(p: ScenePresentation): void {
    if (p.inSceneControls === this.presentation.inSceneControls && p.detailsOpen === this.presentation.detailsOpen) return
    this.presentation = { ...p }
  }

  setStepDuration(seconds: number): void {
    this.stepSeconds = Math.min(5, Math.max(0.3, seconds))
    if (this.desc) this.clock.duration = this.timing().duration
  }

  apply(desc: WalkDesc, transition: SceneTransition): void {
    this.stats.applies++
    // Edit during playback: finish the running construction at its exact settled end first.
    if (this.desc && (this.clock.t < this.clock.duration || this.transition)) this.finishNow()
    const prev = this.desc
    const change = classify(prev, desc)
    this.lastChange = change
    const animate = transition === 'animate'
    if (change === 'same') {
      this.desc = desc
      return
    }
    const from = prev && this.shown.live.length === desc.n ? copyPose(makePose(desc.n), this.shown) : null
    const scaleChanged = !!prev && change !== 'first' && prev.view.scale !== desc.view.scale
    if (scaleChanged) this.scaleNote = `scale changed to fit the bounds (${desc.view.scale.toFixed(4)} m per unit)`
    else if (change === 'data') this.scaleNote = null
    this.desc = desc
    this.geo = walkGeometry(desc)
    if (!this.built || this.built.n !== desc.n) this.build(desc)
    for (const s of Object.values(this.spheres)) s.setFrame(desc)
    this.spheres.B.place(this.geo.origin)
    this.spheres.R.place(this.geo.origin)
    this.buildNumbers(desc)
    if (this.target.live.length !== desc.n) {
      this.target = makePose(desc.n)
      this.shown = makePose(desc.n)
    }
    const dur = this.timing().duration
    this.transition = null
    if (change === 'first') {
      this.clock = { t: animate ? 0 : dur, duration: dur, playing: animate }
      if (animate) this.stats.animated++
      else this.stats.snapped++
    } else if (change === 'signs' && from && animate && !scaleChanged) {
      this.clock = { t: dur, duration: dur, playing: false }
      this.transition = { from, t: 0, dur: BLEND.morph, mode: 'morph' }
      this.stats.morphs++
      this.stats.animated++
    } else if (change === 'selection' && from) {
      if (animate && this.stage === 'why') {
        this.clock = { t: 0, duration: dur, playing: true }
        this.transition = { from, t: 0, dur: BLEND.stage, mode: 'blend' }
        this.stats.animated++
      } else {
        this.clock = { t: dur, duration: dur, playing: false }
        if (animate) this.transition = { from, t: 0, dur: BLEND.select, mode: 'blend' }
        this.stats.snapped++
      }
    } else {
      // Another walk, case, order or scale: show its settled state; animated applies fade it in cleanly.
      this.clock = { t: dur, duration: dur, playing: false }
      if (animate) {
        this.transition = { from: emptyPose(desc.n), t: 0, dur: BLEND.fade, mode: 'blend' }
        this.stats.faded++
      } else this.stats.snapped++
    }
    this.compose()
  }

  setStage(stage: WalkStage, transition: SceneTransition): void {
    this.stats.stageChanges++
    const from = this.desc ? copyPose(makePose(this.desc.n), this.shown) : null
    this.stage = stage
    if (!this.desc) return
    const dur = this.timing().duration
    if (transition === 'animate') {
      this.clock = { t: 0, duration: dur, playing: true }
      this.transition = from ? { from, t: 0, dur: BLEND.stage, mode: 'blend' } : null
    } else {
      this.clock = { t: dur, duration: dur, playing: false }
      this.transition = null
    }
    this.compose()
  }

  /** The stage shown now (presentation state). */
  currentStage(): WalkStage {
    return this.stage
  }

  step(ctx: FrameContext): void {
    this.now = ctx.time
    this.head.copy(ctx.head)
    const d = this.desc
    if (!d || !this.built) return
    if (this.clock.playing) {
      this.clock.t = Math.min(this.clock.duration, this.clock.t + ctx.dt)
      if (this.clock.t >= this.clock.duration) this.clock.playing = false
    }
    if (this.transition) this.transition.t += ctx.dt
    this.compose()
    this.draw(ctx)
  }

  setPlayback(cmd: PlaybackCommand): PlaybackState {
    if (!this.desc) return { ...IDLE_PLAYBACK }
    const c = this.clock
    const replay = (paused: boolean) => {
      const from = copyPose(makePose(this.desc!.n), this.shown)
      this.clock = { t: 0, duration: this.timing().duration, playing: !paused }
      this.transition = { from, t: 0, dur: BLEND.stage, mode: 'blend' }
    }
    if (cmd === 'replay') replay(false)
    else if (cmd === 'play') {
      if (c.t < c.duration) c.playing = true
      else replay(false)
    } else if (cmd === 'pause') c.playing = false
    else if (cmd === 'toggle') {
      if (c.t < c.duration) c.playing = !c.playing
      else replay(false)
    } else if (cmd === 'finish') this.finishNow()
    else if (typeof cmd === 'object' && 'seek' in cmd) {
      c.t = Math.min(c.duration, Math.max(0, cmd.seek))
      c.playing = false
      this.transition = null
    }
    this.compose()
    return this.playback()
  }

  playback(): PlaybackState {
    const c = this.clock
    if (!this.desc) return { ...IDLE_PLAYBACK }
    const active = c.t < c.duration || !!this.transition
    if (!active) return { ...IDLE_PLAYBACK }
    const step = this.shown.step
    return {
      active: true,
      playing: c.playing || (!!this.transition && c.t >= c.duration),
      time: c.t,
      duration: c.duration,
      phase: this.stage,
      step: step ? { index: step.index, count: step.count, label: `${STAGE_NAMES[this.stage]} · ${step.label}` } : null,
    }
  }

  pick(ray: Ray): ScenePick | null {
    const d = this.desc
    const b = this.built
    const g = this.geo
    if (!d || !b || !g || !this.root.visible) return null
    mTmp.copy(this.root.matrixWorld).invert()
    const r = ray.clone().applyMatrix4(mTmp)
    const p = this.shown
    const st = this.stage
    // Points first (endpoints are the selectable prefixes), then arrows.
    let best: { id: string; dist: number } | null = null
    const tryPoint = (id: string, q: V3, rad: number) => {
      vA.set(q[0], q[1], q[2])
      const along = vB.copy(vA).sub(r.origin).dot(r.direction)
      if (along < 0) return
      if (r.distanceSqToPoint(vA) > rad * rad) return
      if (!best || along < best.dist - 0.004) best = { id, dist: along }
    }
    const why = st === 'why'
    if (p.dots.reordered > 0.3) for (let k = 0; k <= d.n; k++) tryPoint(`rev:${k}`, g.rev[k]!, 0.012)
    if (!why && p.dots.source > 0.3) for (let j = 0; j <= d.n; j++) tryPoint(`src:${j}`, g.src[j]!, 0.012)
    if (!why && p.dots.signed > 0.3) for (let j = 0; j <= d.n; j++) tryPoint(`sig:${j}`, g.sig[j]!, 0.01)
    if (best) {
      const bb = best as { id: string; dist: number }
      return this.pickFor(this.cycleCoincident(bb.id), bb.dist)
    }
    if (why) return null
    let bestArrow: { id: string; dist: number } | null = null
    const tryArrow = (id: string, a: ArrowMesh) => {
      if (!a.visible || a.length < 1e-6) return
      const dist = r.distanceSqToSegment(a.tail, a.tip, vA, vB)
      if (dist > 0.0075 * 0.0075) return
      const along = vA.sub(r.origin).length()
      if (!bestArrow || along < bestArrow.dist) bestArrow = { id, dist: along }
    }
    for (let i = 0; i < d.n; i++) if (p.live[i]!.op > 0.3) tryArrow(`vec:${d.occurrences[i]!.id}`, b.live[i]!)
    for (let i = 0; i < d.n; i++) if (p.copy[i]!.op > 0.3) tryArrow(`vec:${d.occurrences[i]!.id}`, b.copy[i]!)
    if (bestArrow) {
      const ba = bestArrow as { id: string; dist: number }
      return this.pickFor(ba.id, ba.dist)
    }
    return null
  }

  setHover(id: string | null): void {
    this.hover = id
  }

  status(): string {
    const d = this.desc
    if (!d) return 'Proof walk: nothing to show'
    const name = STAGE_NAMES[this.stage]
    const why = this.stage === 'why' ? selectedWitness(d) : null
    if (this.shown.moving && this.playback().active) {
      const cap = this.captionLines(true)[0] ?? ''
      const step = this.shown.step
      return `${name} · ${cap}${step ? ` · ${step.label}` : ''}`
    }
    const L = d.labels
    switch (this.stage) {
      case 'walk':
        return d.total.zero
          ? `Walk · ${d.n} arrows return home; ${L.B}, actual peak ${d.peaks.source.length}`
          : `Walk · ${d.n} arrows end at ${d.total.text}, not home; ${L.B}`
      case 'signs':
        return `Signs · the auxiliary signed walk stays within ${L.D} (actual peak ${d.peaks.signed.length})`
      case 'reorder':
        if (!d.show.reordering) return 'Reorder · this rule shows no reordering'
        return d.lemmaApplicable
          ? `Reorder · every reordered endpoint is within ${L.R}; actual peak ${d.peaks.reordered.length} (${L.B})`
          : `Reorder · ${L.R} is not guaranteed: the walk does not return home${L.failure ? `; ${L.failure}` : ''}`
      case 'why':
        if (!why) return `Why · select an endpoint (W${sub(0)} to W${sub(d.n)})`
        return `Why · ${why.identity}; |W${sub(why.k)}|² = ${why.wNorm2} ${why.withinBound ? '≤' : '>'} R², ${L.R}`
      case 'assumptions':
        return d.total.zero
          ? `Assumptions · returns home, ${L.B} and ${L.D} hold, so ${L.R} holds`
          : `Assumptions · total ≠ 0: the lemma does not apply${L.failure ? `; ${L.failure}` : ''}`
    }
  }

  report(): Record<string, unknown> {
    const d = this.desc
    const b = this.built
    const g = this.geo
    const p = this.shown
    const r4 = (x: number) => +x.toFixed(4)
    const r3 = (v: readonly number[] | Vector3) => (v instanceof Vector3 ? [r4(v.x), r4(v.y), r4(v.z)] : v.map(r4))
    if (!d || !b || !g) return { layout: this.layout, stage: this.stage, desc: null }
    const why = this.stage === 'why' ? selectedWitness(d) : null
    let construction: Record<string, unknown> | null = null
    if (why) {
      const h0 = benchVector(d.view, why.halves[0])
      const h1 = benchVector(d.view, why.halves[1])
      const T = benchVector(d.view, why.residual)
      const end = [0, 1, 2].map((k) => g.origin[k]! + h0[k]! + h1[k]! + T[k]!)
      const W = g.rev[why.k]!
      construction = {
        k: why.k, j: why.j, branch: why.branch, identity: why.identity,
        halves: why.halvesText, halvesName: why.halvesName, residual: why.residualText, residualZero: why.residualZero,
        counted: why.countedIds, wNorm2: why.wNorm2, withinBound: why.withinBound,
        endsAt: r3(end), W: r3(W), mismatchMetres: Math.hypot(end[0]! - W[0]!, end[1]! - W[1]!, end[2]! - W[2]!),
        drawnEnd: this.resid.visible && this.resid.length > 1e-6 ? r3(this.resid.tip) : this.halves[1].visible ? r3(this.halves[1].tip) : null,
      }
    }
    const visibleLabels = this.allTexts.filter((t) => t.anchor.visible).map((t) => ({ id: t.id, text: t.report().plain }))
    let meshes = 0
    this.root.traverse((o) => {
      if ((o as Mesh).isMesh) meshes++
    })
    return {
      layout: this.layout,
      experimentId: d.experimentId,
      caseId: d.caseId,
      caseTitle: d.caseTitle,
      lesson: d.lesson,
      stage: this.stage,
      n: d.n,
      dimension: d.dimension,
      scale: d.view.scale,
      scaleFrom: d.view.scaleFrom,
      scaleNote: this.scaleNote,
      view: { yaw: d.view.yaw, pitch: d.view.pitch, main: d.view.main, panel: d.view.panel },
      playback: this.playback(),
      clock: { ...this.clock },
      transition: this.transition ? { mode: this.transition.mode, t: this.transition.t, dur: this.transition.dur } : null,
      moving: p.moving,
      lastChange: this.lastChange,
      stats: { ...this.stats },
      selection: d.selection,
      construction,
      exact: {
        B: d.bounds.B.text, D: d.bounds.D.text, R: d.bounds.R.text, comparison: d.bounds.comparison,
        total: d.total.text, zeroSum: d.total.zero, lemmaApplicable: d.lemmaApplicable, boundHolds: d.boundHolds, firstFailure: d.firstFailure,
        sourcePeak: { at: d.peaks.source.at, norm2: d.peaks.source.norm2, length: d.peaks.source.length },
        signedPeak: { at: d.peaks.signed.at, norm2: d.peaks.signed.norm2, length: d.peaks.signed.length },
        reorderedPeak: { at: d.peaks.reordered.at, norm2: d.peaks.reordered.norm2, length: d.peaks.reordered.length },
        permutation: d.permutation, reorderedIds: d.reorderedIds,
      },
      bench: { origin: r3(g.origin), panelOrigin: r3(g.panelOrigin), source: g.src.map(r3), reordered: g.rev.map(r3), signed: g.sig.map(r3) },
      arrows: d.occurrences.map((o, i) => ({
        id: o.id, name: o.name, sign: o.sign, output: o.output, op: r4(p.live[i]!.op),
        tail: r3(b.live[i]!.tail), head: r3(b.live[i]!.tip), length: r4(b.live[i]!.length), visible: b.live[i]!.visible,
      })),
      copies: d.occurrences.map((o, i) => ({ id: o.id, op: r4(p.copy[i]!.op), tail: r3(b.copy[i]!.tail), head: r3(b.copy[i]!.tip), visible: b.copy[i]!.visible })),
      spheres: (['B', 'R', 'D'] as const).map((k) => ({
        role: k, label: this.spheres[k].label.report().plain, units: d.bounds[k].text, radiusMetres: r4(this.spheres[k].r), op: r4(this.spheres[k].op), visible: this.spheres[k].group.visible,
      })),
      labels: visibleLabels,
      presentation: { ...this.presentation },
      status: this.status(),
      meshes,
      texts: this.allTexts.length,
    }
  }

  dispose(): void {
    this.disposeBuilt()
    for (const t of this.allTexts) t.dispose()
    this.allTexts.length = 0
    for (const s of Object.values(this.spheres)) s.dispose()
    for (const g of Object.values(this.guides)) g.dispose()
    for (const a of [...this.halves, this.resid, this.totalArrow]) a.dispose()
    this.leaders.dispose()
    for (const r of Object.values(this.rings)) (r.material as Material).dispose()
    for (const g of Object.values(this.geos)) g.dispose()
    for (const m of Object.values(this.mats)) m.dispose()
    for (const t of Object.values(this.tex)) t.dispose()
    this.root.removeFromParent()
  }

  // ---------------------------------------------------------------- composition

  private timing() {
    const d = this.desc!
    return stageTiming(d, this.stage, this.stepSeconds, this.stage === 'why' ? selectedWitness(d) : null)
  }

  private finishNow(): void {
    this.clock.t = this.clock.duration
    this.clock.playing = false
    this.transition = null
    this.compose()
  }

  private compose(): void {
    const d = this.desc
    const g = this.geo
    if (!d || !g) return
    composeStage(this.target, d, g, this.stage, this.clock.t, this.stepSeconds)
    const tr = this.transition
    if (tr && tr.from.live.length === d.n) {
      const w = Math.min(1, tr.t / tr.dur)
      blendPose(this.shown, tr.from, this.target, w, tr.mode)
      if (w >= 1) this.transition = null
    } else {
      this.transition = null
      copyPose(this.shown, this.target)
    }
  }

  // ---------------------------------------------------------------- drawing

  private draw(ctx: FrameContext): void {
    const d = this.desc!
    const b = this.built!
    const g = this.geo!
    const p = this.shown
    const head = ctx.head
    // Arrows.
    for (let i = 0; i < d.n; i++) {
      b.live[i]!.update(p.live[i]!)
      b.ghost[i]!.update(p.ghost[i]!)
      b.copy[i]!.update(p.copy[i]!)
      if (this.hover === `vec:${d.occurrences[i]!.id}`) {
        b.live[i]!.mat.emissiveIntensity = Math.max(b.live[i]!.mat.emissiveIntensity, 0.95)
        b.copy[i]!.mat.emissiveIntensity = Math.max(b.copy[i]!.mat.emissiveIntensity, 0.95)
      }
    }
    this.halves[0].update(p.half[0])
    this.halves[1].update(p.half[1])
    this.resid.update(p.resid)
    this.totalArrow.update(p.total)
    for (const a of [...b.live, ...b.ghost, ...b.copy, ...this.halves, this.resid, this.totalArrow]) if (a.zero.visible) a.zero.lookAt(head)

    // Origin, tracer, home pulse.
    this.place(this.origin, g.origin, p.origin)
    this.mats.origin.opacity = Math.max(p.origin, p.panelOrigin)
    this.place(this.originHalo, g.origin, p.origin)
    this.mats.originHalo.opacity = 0.55 * p.origin
    this.originHalo.lookAt(head)
    this.place(this.panelOrigin, p.panelAt, p.panelOrigin)
    this.spheres.D.place(p.panelAt)
    this.place(this.tracer, p.tracer.p, p.tracer.op)
    this.place(this.tracerHalo, p.tracer.p, p.tracer.op)
    this.mats.tracerHalo.opacity = 0.7 * p.tracer.op
    this.tracerHalo.lookAt(head)
    this.place(this.panelTracer, p.panelTracer.p, p.panelTracer.op)
    this.homeRing.visible = p.home > 0.01
    if (this.homeRing.visible) {
      this.homeRing.position.set(g.origin[0], g.origin[1], g.origin[2])
      this.homeRing.scale.setScalar(0.008 + 0.04 * (1 - p.home))
      this.mats.home.opacity = 0.8 * p.home
      this.homeRing.lookAt(head)
    }

    // Dots (role opacity; the hovered one larger).
    const dotSet = (meshes: Mesh[], pts: V3[], op: number, mat: MeshBasicMaterial, prefix: string, size: number) => {
      mat.opacity = op
      for (let k = 0; k < meshes.length; k++) {
        const m = meshes[k]!
        m.visible = op > 0.01
        if (!m.visible) continue
        m.position.set(pts[k]![0], pts[k]![1], pts[k]![2])
        m.scale.setScalar(this.hover === `${prefix}:${k}` ? size * 1.6 : size)
      }
    }
    dotSet(b.dots.source, g.src, p.dots.source, this.mats.dotSource, 'src', 0.0045)
    dotSet(b.dots.reordered, g.rev, p.dots.reordered, this.mats.dotReordered, 'rev', p.dots.numbers > 0.5 ? 0.006 : 0.0045)
    dotSet(b.dots.signed, g.sig, p.dots.signed, this.mats.dotSigned, 'sig', 0.0036)

    // Rings.
    const ring = (m: Mesh, q: V3, op: number, size: number) => {
      m.visible = op > 0.01
      if (!m.visible) return
      m.position.set(q[0], q[1], q[2])
      m.scale.setScalar(size)
      ;(m.material as MeshBasicMaterial).opacity = op
      m.lookAt(head)
    }
    const pulse = 1 + 0.08 * Math.sin(this.now * 3.2)
    ring(this.rings.U, p.ring.U.p, p.ring.U.op, 0.0125)
    ring(this.rings.S, p.ring.S.p, p.ring.S.op, 0.0105)
    ring(this.rings.W, p.ring.W.p, p.ring.W.op, 0.0135 * pulse)
    ring(this.rings.zero, p.ring.zero.p, p.ring.zero.op, 0.018)
    ring(this.rings.fail, p.ring.fail.p, p.ring.fail.op, 0.016 * pulse)
    ring(this.rings.peakSource, g.src[d.peaks.source.at]!, p.peak.source * 0.8, 0.0085)
    ring(this.rings.peakReordered, g.rev[d.peaks.reordered.at]!, p.peak.reordered * 0.8, 0.0085)
    ring(this.rings.peakSigned, g.sig[d.peaks.signed.at]!, p.peak.signed * 0.8, 0.007)
    const hv = this.hoverPoint()
    ring(this.rings.hover, hv ?? [0, 0, 0], hv ? 0.9 : 0, 0.011)

    // Bound rings and guides.
    this.spheres.B.update(p.B.r, p.B.op, p.B.emph, head)
    this.spheres.R.update(p.R.r, p.R.op, p.R.emph, head)
    this.spheres.D.update(p.D.r, p.D.op, p.D.emph, head)
    this.guides.U.update(p.guide.U)
    this.guides.S.update(p.guide.S)
    this.guides.peakSource.update(p.guide.peakSource)
    this.guides.peakReordered.update(p.guide.peakReordered)

    // Badges on the identity arrows.
    for (let i = 0; i < d.n; i++) {
      const a = b.live[i]!
      const ap = p.live[i]!
      const badge = b.badges[i]!
      badge.visible = a.visible && ap.badgeOp > 0.01 && ap.sign !== 0
      if (!badge.visible) continue
      badge.material = ap.sign === 1 ? b.badgeMats[2 * i]! : b.badgeMats[2 * i + 1]!
      ;(badge.material as MeshBasicMaterial).opacity = ap.badgeOp * ap.op
      vA.copy(a.tail).lerp(a.tip, 0.5)
      if (a.length < 1e-6) vA.x += 0.01
      badge.position.copy(vA)
      badge.scale.setScalar(0.0125 * (0.6 + 0.4 * Math.min(1, ap.badgeOp * 1.4)))
      badge.lookAt(head)
      badge.translateZ(0.005)
    }

    // Labels: obstacles are the drawn arrows; essential labels are placed first.
    const lay = this.layout2d
    lay.reset()
    this.leaders.begin()
    for (const a of [...b.live, ...b.copy, ...this.halves, this.resid, this.totalArrow]) if (a.visible && a.length > 1e-6 && a.mat.opacity > 0.25) lay.segment(a.tail, a.tip)
    this.drawTexts(p)
    this.placeTags(p)
    this.leaders.end()

    // Text freshness and billboards.
    for (const t of this.allTexts) {
      t.frame(ctx.time)
      // The text column faces the bench front (a steady panel); labels on the walk face the viewer.
      if (t.anchor.visible && !this.columnTexts.has(t)) t.anchor.lookAt(head)
    }
    for (const t of b.tags) {
      t.frame(ctx.time)
      if (t.anchor.visible) t.anchor.lookAt(head)
    }
    for (const t of b.copyTags) {
      t.frame(ctx.time)
      if (t.anchor.visible) t.anchor.lookAt(head)
    }
    for (const x of b.numbers) {
      x.slot.frame(ctx.time)
      if (x.slot.anchor.visible) x.slot.anchor.lookAt(head)
    }
  }

  private drawTexts(p: Pose): void {
    const d = this.desc!
    const g = this.geo!
    const T = this.texts
    const L = d.labels
    const why = this.stage === 'why' ? selectedWitness(d) : null
    const sel = d.selection
    const own = this.presentation.inSceneControls

    // Column: the case line and caption only while the scene owns its text (no shell); hypotheses and formal lines.
    const top = WALK_LAYOUT.textTop
    this.setPlain(T.case, d.caseTitle, EM.case, palette.textDim)
    this.column(T.case, top, own ? 1 : 0)
    const lines = this.captionLines(p.moving && this.playback().active)
    for (let i = 0; i < T.caption.length; i++) {
      const s = T.caption[i]!
      const text = lines[i] ?? ''
      this.setPlain(s, text, i === 0 ? EM.caption0 : EM.caption, i === 0 ? palette.text : 0xd5dbe7)
      this.column(s, top - 0.038 - i * 0.031, own && text ? p.text.caption : 0)
    }
    const panelR = Math.max(d.bounds.D.value, d.peaks.signed.approx) * d.view.scale
    const panelBottom = p.panelAt[1] - Math.max(panelR, 0.02) - 0.05
    let y = Math.min(WALK_LAYOUT.textBottom, panelBottom)
    const hyps = d.hypotheses
    for (let i = 0; i < 4; i++) {
      const h = hyps[i]
      const s = T.hyp[i]!
      const mark = !h ? '' : h.holds === true ? '✓ ' : h.holds === false ? '✗ ' : '· '
      this.setPlain(s, h ? mark + h.text : '', EM.hyp, h?.holds === false ? 0xff9fb4 : h?.holds === true ? 0xbff2d8 : palette.textDim)
      const op = h ? p.text.hyp[i]! : 0
      this.column(s, y, op)
      if (this.stage === 'assumptions') y -= 0.027
    }
    const details: readonly TextLine[] = this.presentation.detailsOpen ? (why ? d.why[why.k]!.details : this.stage === 'why' ? [] : d.copy[this.stage].details) : []
    for (let i = 0; i < T.details.length; i++) {
      const s = T.details[i]!
      const line = details[i]
      if (line?.tex) this.setTex(s, line.tex, EM.detailTex, 0xe2e8f2, line.plain)
      else this.setPlain(s, line?.plain ?? '', EM.detail, 0xc9d1e0)
      const h = line?.tex ? 0.032 : 0.024
      this.column(s, y - (line?.tex ? 0.004 : 0), line ? 1 : 0)
      if (line) y -= h
    }

    // The origin marker is an obstacle too.
    this.layout2d.add(g.origin[0] - 0.009, g.origin[1] - 0.009, g.origin[0] + 0.009, g.origin[1] + 0.009)
    // Bound labels on their rings (alternative angles when an arrow or label is in the way).
    const sB = this.spheres.B
    const sR = this.spheres.R
    const sD = this.spheres.D
    this.setPlain(sB.label, L.B, EM.label, 0xc3cbda)
    this.ringLabel('B', sB.label, g.origin, sB.r, 135, sB.group.visible ? p.B.op : 0)
    const Rtext = p.text.boundMark > 0.5 && why && why.withinBound && d.lemmaApplicable ? `${L.R} = (${d.bounds.B.text} + ${d.bounds.D.text})/2` : L.R
    this.setPlain(sR.label, Rtext, EM.label, 0xf4f7ff)
    this.ringLabel('R', sR.label, g.origin, sR.r, -55, sR.group.visible ? p.R.op : 0)
    this.setPlain(sD.label, `${L.D} · same scale`, EM.small, 0x8fe8db)
    this.ringLabel('D', sD.label, p.panelAt, Math.max(sD.r, 0.012), -90, sD.group.visible ? p.D.op : 0)

    // Panel title above the signed walk.
    this.setPlain(T.panel, L.panel, EM.panel, 0x8fe8db)
    this.panelTitle(T.panel, p.panelAt, Math.max(panelR, 0.02), p.panel)

    // Selection and Why labels (essential: larger, with leaders).
    const jU = why ? why.j : sel.kind === 'source' ? sel.index : 0
    const jS = why ? why.j : sel.kind === 'signed' ? sel.index : 0
    const kW = why ? why.k : sel.kind === 'reordered' ? sel.index : 0
    this.pointCallout('W', T.ringW, `W${sub(kW)}`, p.ring.W.p, g.origin, p.ring.W.op * p.text.ringLabels, 0xffffff, EM.label, 0.016)
    this.pointCallout('U', T.ringU, `U${sub(jU)}`, p.ring.U.p, g.origin, p.ring.U.op * p.text.ringLabels, 0xcfe3ff, EM.label, 0.015)
    this.pointCallout('S', T.ringS, `S${sub(jS)}`, p.ring.S.p, p.panelAt, p.ring.S.op * p.text.ringLabels, 0xa8f0e4, EM.label, 0.013)
    if (why) {
      const bounds = why.branch === 'positive' ? [d.bounds.B, d.bounds.D] : [d.bounds.D, d.bounds.B]
      const halfText = (k: 0 | 1) => {
        const zero = why.halves[k].every((x) => x === 0)
        const bnd = bounds[k]!
        const half = bnd.value / 2
        const halfS = Number.isInteger(half) ? String(half) : `${bnd.text}/2`
        return zero ? `${why.halvesName[k]} = 0` : `${why.halvesName[k]}  ≤ ${halfS}`
      }
      const z0 = why.halves[0].every((x) => x === 0)
      const z1 = why.halves[1].every((x) => x === 0)
      if (z0 && z1) {
        // Both halves are zero (j = 0): one label at home instead of two on top of each other.
        this.arrowCallout('h0', T.half0, `${why.halvesName[0]} = ${why.halvesName[1]} = 0`, this.halves[0], Math.max(p.text.halves[0], p.text.halves[1]), p.half[0].color, 1)
        T.half1.setWanted(false)
      } else {
        this.arrowCallout('h0', T.half0, halfText(0), this.halves[0], p.text.halves[0], p.half[0].color, 1)
        this.arrowCallout('h1', T.half1, halfText(1), this.halves[1], p.text.halves[1], p.half[1].color, -1)
      }
      this.arrowCallout('T', T.resid, 'T (total ≠ 0)', this.resid, p.text.resid, WALK_COLORS.residual, 1)
    } else for (const s of [T.half0, T.half1, T.resid]) s.setWanted(false)
    // Assumptions: total and failure.
    if (d.total.zero) {
      this.setPlain(T.total, L.total, EM.small, 0xbff2d8)
      this.calloutAt('total', T.total, g.origin, [0.35, -1], 0.024, p.text.total, 0xbff2d8)
    } else this.arrowCallout('total', T.total, L.total, this.totalArrow, p.text.total, WALK_COLORS.residual, -1)
    this.pointCallout('fail', T.fail, L.failure ?? '', p.ring.fail.p, g.origin, L.failure ? p.text.fail : 0, 0xffb3c2, EM.label, 0.018)
    // Peaks (actual distances, approximation-marked), then home.
    this.pointCallout('pkS', T.peakSource, L.sourcePeak, g.src[d.peaks.source.at]!, g.origin, p.peak.source, 0xd8e1f0, EM.peak, 0.012)
    this.pointCallout('pkR', T.peakReordered, L.reorderedPeak, g.rev[d.peaks.reordered.at]!, g.origin, p.peak.reordered, 0xd8e1f0, EM.peak, 0.012)
    this.pointCallout('pkD', T.peakSigned, L.signedPeak, g.sig[d.peaks.signed.at]!, p.panelAt, p.peak.signed * 0.9, 0xc3f5ec, EM.small, 0.01)
    this.setPlain(T.origin, L.origin, EM.small, 0xf3e6c8)
    // "home" steps aside while the Why construction labels the origin itself.
    const homeOp = p.text.total < 0.5 && Math.max(p.text.halves[0], p.text.halves[1]) < 0.5 ? p.origin : 0
    this.calloutAt('home', T.origin, g.origin, [0.4, -1], 0.012, homeOp, null)

    // Endpoint numbers (Why without a selection).
    const b = this.built!
    for (const nl of b.numbers) {
      const q = g.rev[nl.ks[0]!]!
      const rad = this.radial(q, g.origin)
      this.calloutAt(`n${nl.ks[0]}`, nl.slot, q, rad, 0.009, p.dots.numbers, null)
    }

  }

  /** Name tags of the identity arrows and the signed copies: beside the arrow, away from its walk's centre. */
  private placeTags(p: Pose): void {
    const d = this.desc!
    const b = this.built!
    let cx = 0
    let cy = 0
    let cn = 0
    for (const a of b.live) {
      if (!a.visible) continue
      cx += (a.tail.x + a.tip.x) / 2
      cy += (a.tail.y + a.tip.y) / 2
      cn++
    }
    if (cn) {
      cx /= cn
      cy /= cn
    }
    for (let i = 0; i < d.n; i++) {
      const o = d.occurrences[i]!
      const a = b.live[i]!
      const ap = p.live[i]!
      const tag = b.tags[i]!
      const hl = ap.glow > 0.5 || ap.tagOp > 0.95
      this.setPlain(tag, o.name, EM.tag, mixColor(ap.color, 0xffffff, hl ? 0.55 : 0.3))
      // While the endpoint numbers are offered, the name tags step back.
      const quiet = 1 - 0.65 * p.dots.numbers
      this.tag(`t${i}`, tag, a, a.visible ? quiet * ap.tagOp * Math.min(1, ap.op + 0.15) : 0, cx, cy)
      const cp = p.copy[i]!
      const ct = b.copyTags[i]!
      this.setPlain(ct, o.name, EM.tag, mixColor(cp.color, 0xffffff, 0.45))
      this.tag(`c${i}`, ct, b.copy[i]!, b.copy[i]!.visible ? cp.tagOp * cp.op : 0, p.panelAt[0], p.panelAt[1])
    }
  }

  private captionLines(moving: boolean): readonly string[] {
    const d = this.desc!
    if (this.transition?.mode === 'morph') return ['Showing the sign change…', 'Copies flip; the walk re-forms.', 'Source walk and its bound stay.']
    const why = this.stage === 'why' ? selectedWitness(d) : null
    const copy = why ? d.why[why.k]! : d.copy[this.stage]
    if (this.stage === 'why' && !why && d.selection.kind !== 'none' && d.selection.kind !== 'reordered') return ['Select an endpoint', 'Why explains a reordered endpoint:', 'pick a dot Wₖ of the new walk.']
    if (!d.show.reordering && (this.stage === 'reorder' || this.stage === 'why')) return ['No reordering in this rule.', 'Bind a rule with the reordering view.']
    return moving ? copy.moving : copy.lines
  }

  private hoverPoint(): V3 | null {
    const h = this.hover
    const g = this.geo
    if (!h || !g) return null
    const m = /^(src|rev|sig):(\d+)$/.exec(h)
    if (!m) return null
    const k = Number(m[2])
    return (m[1] === 'src' ? g.src : m[1] === 'rev' ? g.rev : g.sig)[k] ?? null
  }

  // ---------------------------------------------------------------- text placement

  private setPlain(s: TextSlot, text: string, em: number, color: number): void {
    const key = `p|${text}|${em}|${color}`
    if (this.keys.get(s) === key) return
    this.keys.set(s, key)
    s.set(text ? plain(text, em, color) : null)
  }

  private setTex(s: TextSlot, tex: string, em: number, color: number, plainText: string): void {
    const key = `t|${tex}|${em}|${color}`
    if (this.keys.get(s) === key) return
    this.keys.set(s, key)
    s.set({ kind: 'tex', parts: [{ tex }], em, color, plain: plainText })
  }

  private show(s: TextSlot, op: number): boolean {
    const on = op > 0.01 && s.wantedKey !== null
    s.setWanted(on)
    if (on) s.setOpacity(Math.min(1, op))
    return on
  }

  /** Left-aligned line in the text column (scaled down to the column width). */
  private column(s: TextSlot, y: number, op: number): void {
    if (!this.show(s, op)) return
    const k = s.width > COLUMN.w ? COLUMN.w / s.width : 1
    s.anchor.scale.setScalar(k)
    s.anchor.position.set(COLUMN.x + (s.width * k) / 2, y, -0.03)
    this.layout2d.add(COLUMN.x, y - (s.height * k) / 2, COLUMN.x + s.width * k, y + (s.height * k) / 2)
  }

  /** The panel title above the signed walk, or below it when the caption column is in the way. */
  private panelTitle(s: TextSlot, c: V3, r: number, op: number): void {
    if (!this.show(s, op)) return
    const h = s.height
    const i = this.layout2d.choose('panel', [c[0], c[0]], [c[1] + r + 0.018 + h / 2, c[1] - r - 0.05 - h / 2], s.width, h)
    s.anchor.scale.setScalar(1)
    s.anchor.position.set(c[0], i === 0 ? c[1] + r + 0.018 + h / 2 : c[1] - r - 0.05 - h / 2, c[2] + 0.006)
  }

  /** A bound label just outside its ring: the preferred angle, else the nearest free one. */
  private ringLabel(key: string, s: TextSlot, c: V3, r: number, deg: number, op: number): void {
    if (!this.show(s, op)) return
    const w = s.width
    const h = s.height
    const cx: number[] = []
    const cy: number[] = []
    for (const off of [0, -18, 18, -36, 36, -54, 54, -80, 80, 180]) {
      const a = ((deg + off) * Math.PI) / 180
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      cx.push(c[0] + (r + 0.007) * ca + ca * w * 0.5)
      cy.push(c[1] + (r + 0.007) * sa + sa * h * 0.5)
    }
    const i = this.layout2d.choose(key, cx, cy, w, h)
    s.anchor.scale.setScalar(1)
    s.anchor.position.set(cx[i]!, cy[i]!, c[2] + 0.012)
  }

  /** A label for a point: around the point, starting from the direction away from `centre`, with a leader. */
  private pointCallout(key: string, s: TextSlot, text: string, q: V3, centre: V3, op: number, color: number, em: number, gap: number): void {
    this.setPlain(s, text, em, color)
    this.calloutAt(key, s, q, this.radial(q, centre), gap, op, color)
  }

  /** Place a label near q (bench), trying directions around `pref`, at two distances; leader when displaced. */
  private calloutAt(key: string, s: TextSlot, q: V3 | Vector3, pref: readonly number[], gap: number, op: number, leader: number | null): void {
    if (!this.show(s, op)) return
    const qx = q instanceof Vector3 ? q.x : q[0]
    const qy = q instanceof Vector3 ? q.y : q[1]
    const qz = q instanceof Vector3 ? q.z : q[2]
    const w = s.width
    const h = s.height
    const base = Math.atan2(pref[1]!, pref[0]!)
    const cx: number[] = []
    const cy: number[] = []
    const dirs: number[] = []
    for (const dist of [gap, gap + 0.026]) {
      for (const off of [0, 35, -35, 70, -70, 110, -110, 150, -150, 180]) {
        const a = base + (off * Math.PI) / 180
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        cx.push(qx + ca * (dist + w / 2))
        cy.push(qy + sa * (dist + h / 2))
        dirs.push(a)
      }
    }
    const i = this.layout2d.choose(key, cx, cy, w, h)
    s.anchor.scale.setScalar(1)
    s.anchor.position.set(cx[i]!, cy[i]!, qz + 0.008)
    if (leader !== null && i >= 10) {
      // From just outside the point to the nearest edge of the label.
      const ex = Math.max(cx[i]! - w / 2, Math.min(qx, cx[i]! + w / 2))
      const ey = Math.max(cy[i]! - h / 2, Math.min(qy, cy[i]! + h / 2))
      const dx = ex - qx
      const dy = ey - qy
      const l = Math.hypot(dx, dy)
      if (l > 0.012) this.leaders.add(vA.set(qx + (dx / l) * 0.009, qy + (dy / l) * 0.009, qz + 0.006), vB.set(ex, ey, qz + 0.008), leader, 0.75 * Math.min(1, op))
    }
  }

  /** A label beside an arrow's midpoint, preferring one side (+1: left of its direction). */
  private arrowCallout(key: string, s: TextSlot, text: string, a: ArrowMesh, op: number, color: number, side: 1 | -1): void {
    this.setPlain(s, text, EM.label, mixColor(color, 0xffffff, 0.4))
    if (!a.visible) {
      s.setWanted(false)
      return
    }
    vA.copy(a.tail).lerp(a.tip, 0.5)
    const dx = a.tip.x - a.tail.x
    const dy = a.tip.y - a.tail.y
    const l = Math.hypot(dx, dy)
    const pref = l > 1e-5 ? [(-dy / l) * side, (dx / l) * side] : [-0.7, side === 1 ? 0.7 : -0.7]
    this.calloutAt(key, s, vA.clone(), pref, 0.012, op, mixColor(color, 0xffffff, 0.2))
  }

  /** A name tag beside an arrow: away side first, then the other side, then further out (quieter if crowded). */
  private tag(key: string, s: TextSlot, a: ArrowMesh, op: number, cx: number, cy: number): void {
    if (!this.show(s, op)) return
    const w = s.width
    const h = s.height
    vA.copy(a.tail).lerp(a.tip, 0.5)
    const dx = a.tip.x - a.tail.x
    const dy = a.tip.y - a.tail.y
    const l = Math.hypot(dx, dy)
    let px = l > 1e-5 ? dy / l : 0.7
    let py = l > 1e-5 ? -dx / l : 0.7
    if ((vA.x - cx) * px + (vA.y - cy) * py < -0.004) {
      px = -px
      py = -py
    }
    const xs: number[] = []
    const ys: number[] = []
    for (const [sgn, dist] of [[1, 0.007], [-1, 0.007], [1, 0.019], [-1, 0.019]] as const) {
      xs.push(vA.x + sgn * px * (dist + Math.abs(px) * w / 2 + Math.abs(py) * w * 0.12))
      ys.push(vA.y + sgn * py * (dist + Math.abs(py) * h / 2 + Math.abs(px) * h * 0.1))
    }
    const i = this.layout2d.choose(key, xs, ys, w, h)
    // A tag that found no free place stays readable but quieter.
    s.setOpacity(Math.min(1, op) * (this.layout2d.lastCost > 0 ? 0.55 : 1))
    s.anchor.scale.setScalar(1)
    s.anchor.position.set(xs[i]!, ys[i]!, vA.z + 0.006)
  }

  private radial(q: V3, centre: V3): [number, number] {
    const dx = q[0] - centre[0]
    const dy = q[1] - centre[1]
    const l = Math.hypot(dx, dy)
    return l > 0.004 ? [dx / l, dy / l] : [-0.6, 0.8]
  }

  // ---------------------------------------------------------------- picks

  /** Coincident prefixes of one walk share a point: a press cycles through them (W₀, W₆, W₁₂ at home). */
  private cycleCoincident(id: string): string {
    const d = this.desc!
    const m = /^(src|rev|sig):(\d+)$/.exec(id)
    if (!m) return id
    const role = m[1] as 'src' | 'rev' | 'sig'
    const k = Number(m[2])
    const pts = role === 'src' ? d.source : role === 'rev' ? d.reordered : d.signed
    const group = pts.filter((q) => q.text === pts[k]!.text).map((q) => q.index)
    const kind = role === 'src' ? 'source' : role === 'rev' ? 'reordered' : 'signed'
    const sel = d.selection
    if (sel.kind === kind && group.includes(sel.index)) {
      const next = group[(group.indexOf(sel.index) + 1) % group.length]!
      return `${role}:${next}`
    }
    return `${role}:${group[0]!}`
  }

  private pickFor(id: string, distance: number): ScenePick {
    const d = this.desc!
    const exp = d.experimentId
    const m = /^(src|rev|sig):(\d+)$/.exec(id)
    if (m) {
      const role = m[1] as 'src' | 'rev' | 'sig'
      const k = Number(m[2])
      const kind = role === 'src' ? 'source' : role === 'rev' ? 'reordered' : 'signed'
      const letter = role === 'src' ? 'U' : role === 'rev' ? 'W' : 'S'
      const pts = role === 'src' ? d.source : role === 'rev' ? d.reordered : d.signed
      const others = pts.filter((q) => q.text === pts[k]!.text && q.index !== k).map((q) => `${letter}${sub(q.index)}`)
      const also = others.length ? ` · also ${others.join(', ')} here (press again)` : ''
      const what = role === 'src' ? `source point ${letter}${sub(k)} (after ${k} arrow${k === 1 ? '' : 's'})` : role === 'rev' ? `reordered endpoint ${letter}${sub(k)} (first ${k} of the new order)` : `signed point ${letter}${sub(k)} (after ${k} signed cop${k === 1 ? 'y' : 'ies'})`
      const item = `walk:${kind}:${k}`
      const sel = d.selection
      if (sel.kind === kind && sel.index === k && !others.length) return { id, distance, actions: [], hint: `${letter}${sub(k)} is selected` }
      return { id, distance, actions: [{ kind: 'select_item', experimentId: exp, item }], hint: `Select ${what}${also}` }
    }
    const vid = id.slice(4)
    const o = d.occurrences.find((x) => x.id === vid)!
    if (d.selection.kind === 'vector' && d.selection.id === vid) return { id, distance, actions: [], hint: `Arrow ${o.name} is selected` }
    return { id, distance, actions: [{ kind: 'select_item', experimentId: exp, item: `walk:vector:${vid}` }], hint: `Select arrow ${o.name} (sign ${o.sign === 1 ? '+' : '−'})` }
  }

  // ---------------------------------------------------------------- building

  private arrowMesh(width: number, glow = false): ArrowMesh {
    return new ArrowMesh(this.geos.shaft, this.geos.head, this.geos.zero, width, glow)
  }

  private text(id: string): TextSlot {
    const s = overlay(new TextSlot(`walk:${id}`))
    this.root.add(s.anchor)
    this.allTexts.push(s)
    s.setWanted(false)
    return s
  }

  private build(desc: WalkDesc): void {
    this.disposeBuilt()
    const n = desc.n
    const mk = (w: number) =>
      Array.from({ length: n }, () => {
        const a = this.arrowMesh(w)
        this.root.add(a.group)
        return a
      })
    const ghost = mk(WIDTH.ghost)
    const live = mk(WIDTH.live)
    const copy = mk(WIDTH.copy)
    const badgeMats: MeshBasicMaterial[] = []
    const badges = Array.from({ length: n }, () => {
      const plus = new MeshBasicMaterial({ map: this.tex.plus, transparent: true, depthWrite: false })
      const minus = new MeshBasicMaterial({ map: this.tex.minus, transparent: true, depthWrite: false })
      badgeMats.push(plus, minus)
      const m = new Mesh(this.geos.plane, plus)
      m.renderOrder = 4
      this.root.add(m)
      return m
    })
    const slot = (id: string) => {
      const s = overlay(new TextSlot(id))
      s.setWanted(false)
      this.root.add(s.anchor)
      return s
    }
    const tags = Array.from({ length: n }, (_, i) => slot(`walk:tag:${i}`))
    const copyTags = Array.from({ length: n }, (_, i) => slot(`walk:copytag:${i}`))
    const dots = (mat: MeshBasicMaterial) =>
      Array.from({ length: n + 1 }, () => {
        const m = new Mesh(this.geos.dot, mat)
        this.root.add(m)
        return m
      })
    this.built = {
      n, live, ghost, copy, badges, badgeMats, tags, copyTags,
      dots: { source: dots(this.mats.dotSource), reordered: dots(this.mats.dotReordered), signed: dots(this.mats.dotSigned) },
      numbers: [],
      tagSide: Array.from({ length: n }, () => 1),
    }
  }

  private buildNumbers(desc: WalkDesc): void {
    const b = this.built!
    for (const x of b.numbers) x.slot.dispose()
    b.numbers = []
    const seen = new Map<string, number[]>()
    for (const q of desc.reordered) {
      const list = seen.get(q.text)
      if (list) list.push(q.index)
      else seen.set(q.text, [q.index])
    }
    for (const ks of seen.values()) {
      const s = overlay(new TextSlot(`walk:number:${ks[0]}`))
      s.set(plain(ks.join(' · '), EM.number, 0xfff1d0))
      this.keys.set(s, 'number')
      s.setWanted(false)
      this.root.add(s.anchor)
      b.numbers.push({ ks, slot: s })
    }
  }

  private disposeBuilt(): void {
    const b = this.built
    if (!b) return
    for (const a of [...b.live, ...b.ghost, ...b.copy]) a.dispose()
    for (const m of b.badges) m.removeFromParent()
    for (const m of b.badgeMats) m.dispose()
    for (const t of [...b.tags, ...b.copyTags, ...b.numbers.map((x) => x.slot)]) t.dispose()
    for (const m of [...b.dots.source, ...b.dots.reordered, ...b.dots.signed]) m.removeFromParent()
    for (const t of [...b.tags, ...b.copyTags]) this.keys.delete(t)
    this.built = null
  }

  private place(m: Mesh, q: readonly number[], op: number): void {
    m.visible = op > 0.01
    if (m.visible) m.position.set(q[0]!, q[1]!, q[2]!)
  }
}

/** How a new description differs from the previous one (exact content, not floats). */
export function classify(prev: WalkDesc | null, next: WalkDesc): Change {
  if (!prev) return 'first'
  if (prev.experimentId !== next.experimentId || prev.n !== next.n || prev.dimension !== next.dimension) return 'data'
  const sameVectors = prev.occurrences.every((o, i) => o.id === next.occurrences[i]!.id && o.text === next.occurrences[i]!.text)
  if (!sameVectors) return 'data'
  const sameSigns = prev.occurrences.every((o, i) => o.sign === next.occurrences[i]!.sign)
  const sameShow = prev.show.reordering === next.show.reordering && prev.show.bounds === next.show.bounds && prev.show.correspondence === next.show.correspondence
  if (!sameShow) return 'data'
  if (!sameSigns) return 'signs'
  const prevItem = prev.selection.kind === 'none' ? null : prev.selection.item
  const nextItem = next.selection.kind === 'none' ? null : next.selection.item
  return prevItem === nextItem ? 'same' : 'selection'
}

export type { WitnessDesc }
