// One braid on screen: three tubes between two fixed endpoint frames, identity end caps (colour + shape +
// letter), per-crossing generator labels, the word in chronological order (TeX) and its invariants below.
// Geometry comes from a posed Plan (plan.ts); this module only draws it. Braid-local frame: origin at the
// centre of the first endpoint frame, strands run downward (y = -u), +z toward the viewer (= over).

import {
  BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OctahedronGeometry, SphereGeometry, type BufferGeometry, type Vector3,
} from 'three'
import type { SlotContent } from '../../rendering/textSlot'
import { TextSlot } from '../../rendering/textSlot'
import { palette } from '../../ui/palette'
import type { PoseInfo } from './animator'
import { GEOMETRY, STRAND_NAMES, slotX, strandColor } from './constants'
import type { BraidWordDesc } from './derive'
import { MOTIF_NONE, MOTIF_RELATION, type Plan, StrandEvaluator, pitchFor } from './plan'
import { Tube, braidBounds, gapMaterial } from './tubes'
import { plain, roundedRect, tex } from './widgets'

/** Per-crossing labels are drawn while units are at least this long (m); i.e. words up to 11 crossings. */
const LABEL_MIN_PITCH = 0.024
const MAX_LABELS = 12
const LABEL_EM = 0.0145
const WORD_EM = 0.021
const INV_EM = 0.0148
const LETTER_EM = 0.0155
/** Lane (selection/hover highlight and crossing pick area) in braid-local x. */
export const LANE_X0 = -GEOMETRY.spacing - 0.058
export const LANE_X1 = GEOMETRY.spacing + 0.028
const LABEL_X = -GEOMETRY.spacing - 0.033

const GEN_TEX: Record<string, SlotContent> = {}
for (const g of [1, 2, -1, -2]) GEN_TEX[g] = tex(`\\sigma_{${Math.abs(g)}}${g < 0 ? '^{-1}' : ''}`, LABEL_EM, palette.textDim, `σ${Math.abs(g)}${g < 0 ? '⁻¹' : ''}`)

export class BraidView {
  readonly group = new Group()
  readonly evaluator = new StrandEvaluator()
  readonly centers: Float32Array
  private readonly tubes: Tube[] = []
  private readonly materials: MeshStandardMaterial[] = []
  private readonly capGeos: BufferGeometry[]
  private readonly topCaps: Mesh[] = []
  private readonly tipCaps: Mesh[] = []
  private readonly gapMat = gapMaterial(palette.sky, 0.0026)
  private readonly frameGeo: BoxGeometry
  private readonly frameMat: MeshStandardMaterial
  readonly caption: TextSlot
  readonly topLetters: TextSlot[] = []
  readonly bottomLetters: TextSlot[] = []
  readonly word: TextSlot
  readonly invariants: TextSlot
  readonly labels: TextSlot[] = []
  private readonly labelGen = new Int8Array(MAX_LABELS)
  private readonly lane: Mesh
  private readonly hoverLane: Mesh
  /** The exact crossings the offered rewrite affects (gold, behind the selection lane). */
  private readonly spanLane: Mesh
  private laneKey = -1
  private hoverKey = -1
  private spanKey = -1
  /** The highlighted span [at, at + length), or null (reports). */
  span: { at: number; length: number } | null = null
  desc: BraidWordDesc | null = null
  /** Width the word and invariants may use (wider when this braid is shown alone). */
  textWidth = 0.27
  /** Every text slot (fixed list, iterated per frame). */
  private allSlots: TextSlot[] = []
  /** Last drawn tip (reveal) and the rings drawn, for reports. */
  drawnRings = 0
  reveal: number = GEOMETRY.length

  constructor(readonly role: 'word' | 'compare') {
    const M = this.evaluator.samples
    this.centers = new Float32Array(3 * M * 3)
    this.group.name = `braid:${role}`
    const bounds = braidBounds(GEOMETRY.length)
    this.capGeos = [new SphereGeometry(0.0088, 18, 12), new BoxGeometry(0.0148, 0.0148, 0.0148), new OctahedronGeometry(0.0118)]
    for (let s = 0; s < 3; s++) {
      const color = strandColor(s)
      const mat = new MeshStandardMaterial({ color, roughness: 0.38, metalness: 0, emissive: color, emissiveIntensity: 0.14 })
      this.materials.push(mat)
      const tube = new Tube(M, GEOMETRY.radial, mat, bounds)
      tube.mesh.name = `strand:${role}:${STRAND_NAMES[s]}`
      this.tubes.push(tube)
      const top = new Mesh(this.capGeos[s]!, mat)
      const tip = new Mesh(this.capGeos[s]!, mat)
      top.name = `cap:${role}:${STRAND_NAMES[s]}:start`
      tip.name = `cap:${role}:${STRAND_NAMES[s]}:end`
      if (s === 2) {
        top.rotation.y = tip.rotation.y = Math.PI / 4
      }
      this.topCaps.push(top)
      this.tipCaps.push(tip)
      this.group.add(tube.mesh, tube.outline(this.gapMat), top, tip)
    }
    // Endpoint frames: two quiet rails behind the caps.
    this.frameGeo = new BoxGeometry(2 * GEOMETRY.spacing + 0.05, 0.0055, 0.008)
    this.frameMat = new MeshStandardMaterial({ color: 0x4a556c, roughness: 0.75, metalness: 0 })
    for (const y of [0, -GEOMETRY.length]) {
      const f = new Mesh(this.frameGeo, this.frameMat)
      f.position.set(0, y, -0.013)
      f.name = `frame:${role}:${y === 0 ? 'start' : 'end'}`
      this.group.add(f)
    }
    this.lane = new Mesh(roundedRect(1, 1, 0.1), new MeshBasicMaterial({ color: 0x33456b, transparent: true, opacity: 0.55, depthWrite: false }))
    this.lane.renderOrder = 1
    this.lane.visible = false
    this.hoverLane = new Mesh(roundedRect(1, 1, 0.1), new MeshBasicMaterial({ color: 0x3c4a66, transparent: true, opacity: 0.3, depthWrite: false }))
    this.hoverLane.renderOrder = 1
    this.hoverLane.visible = false
    this.spanLane = new Mesh(roundedRect(1, 1, 0.1), new MeshBasicMaterial({ color: 0x9a7a26, transparent: true, opacity: 0.36, depthWrite: false }))
    this.spanLane.renderOrder = 0
    this.spanLane.visible = false
    this.group.add(this.spanLane, this.lane, this.hoverLane)

    this.caption = new TextSlot(`braid:${role}:caption`)
    this.caption.anchor.position.set(0, 0.046, 0)
    this.caption.set(plain(role === 'word' ? 'word' : 'comparison', 0.0115, palette.textDim))
    for (let p = 0; p < 3; p++) {
      const t = new TextSlot(`braid:${role}:start:${p}`)
      t.anchor.position.set(slotX(p), 0.023, 0)
      t.set(plain(STRAND_NAMES[p]!, LETTER_EM, strandColor(p)))
      this.topLetters.push(t)
      const b = new TextSlot(`braid:${role}:end:${p}`)
      b.anchor.position.set(slotX(p), -GEOMETRY.length - 0.023, 0)
      this.bottomLetters.push(b)
    }
    this.word = new TextSlot(`braid:${role}:word`)
    this.word.anchor.position.set(0, -GEOMETRY.length - 0.053, 0)
    this.invariants = new TextSlot(`braid:${role}:inv`)
    this.invariants.anchor.position.set(0, -GEOMETRY.length - 0.081, 0)
    for (let k = 0; k < MAX_LABELS; k++) {
      const l = new TextSlot(`braid:${role}:x${k}`)
      l.setWanted(false)
      this.labels.push(l)
    }
    this.allSlots = [this.caption, ...this.topLetters, ...this.bottomLetters, this.word, this.invariants, ...this.labels]
    for (const s of this.allSlots) this.group.add(s.anchor)
  }

  /** Every text slot of this view. */
  slots(): TextSlot[] {
    return this.allSlots
  }

  setDesc(d: BraidWordDesc, showInvariants: boolean): void {
    this.desc = d
    this.word.set(tex(d.tex, WORD_EM, palette.text, d.text))
    this.invariants.set(tex(d.invariantsTex, INV_EM, palette.textDim, d.invariantsText))
    this.invariants.setWanted(showInvariants)
    for (let p = 0; p < 3; p++) {
      const s = STRAND_NAMES.indexOf(d.arrival[p]!)
      this.bottomLetters[p]!.set(plain(d.arrival[p]!, LETTER_EM, strandColor(s)))
    }
  }

  /** Draw a posed plan, strands revealed from u = 0 to info.reveal. */
  render(plan: Plan, info: PoseInfo): void {
    const ev = this.evaluator
    const M = ev.samples
    const C = this.centers
    ev.evaluate(plan, C)
    const L = GEOMETRY.length
    const reveal = Math.max(0, Math.min(L, info.reveal))
    this.reveal = reveal
    let count = M
    if (reveal < L - 1e-9) {
      const du = L / (M - 1)
      const w = reveal / du
      const m = Math.min(M - 1, Math.ceil(w))
      const f = m > 0 ? w - (m - 1) : 1
      if (m > 0) {
        for (let s = 0; s < 3; s++) {
          const a = (s * M + m - 1) * 3
          const b = (s * M + m) * 3
          for (let k = 0; k < 3; k++) C[b + k] = C[a + k]! + (C[b + k]! - C[a + k]!) * f
        }
      }
      count = m + 1
    }
    this.drawnRings = count
    const showTips = reveal > 1e-4
    for (let s = 0; s < 3; s++) {
      this.tubes[s]!.update(C, s * M * 3, count, plan.radius)
      const o = s * M * 3
      this.topCaps[s]!.position.set(C[o]!, C[o + 1]!, C[o + 2]!)
      const t = o + (count - 1) * 3
      this.tipCaps[s]!.position.set(C[t]!, C[t + 1]!, C[t + 2]!)
      this.tipCaps[s]!.visible = showTips
    }
    const complete = reveal >= L - 1e-9
    for (const b of this.bottomLetters) b.setWanted(complete)
    // Generator labels on the plan's crossing units, by ordinal (straight or collapsed units have none).
    const labelled = pitchFor(this.desc?.word.length ?? plan.count) >= LABEL_MIN_PITCH
    let q = 0
    for (let j = 0; j < plan.count && q < MAX_LABELS; j++) {
      const g = plan.gen[j]!
      if (g === 0) continue
      const l = this.labels[q++]!
      const len = plan.len[j]!
      const mid = ev.unitStart(j) + len / 2
      // Inside a motif that is mid-way (neither word's crossings), the span's labels step aside.
      const inMotif = plan.motif !== MOTIF_NONE && j >= plan.motifAt && j < plan.motifAt + (plan.motif === MOTIF_RELATION ? 3 : 2)
      const ambiguous = inMotif && (plan.motif === MOTIF_RELATION ? plan.lambda > 0.04 && plan.lambda < 0.96 : plan.nu > 0.04)
      const on = labelled && !ambiguous && len > 0.6 * LABEL_MIN_PITCH && mid <= reveal
      l.setWanted(on)
      if (!on) continue
      if (this.labelGen[q - 1] !== g) {
        this.labelGen[q - 1] = g
        l.set(GEN_TEX[g]!)
      }
      l.anchor.position.set(LABEL_X, -mid, 0)
    }
    for (; q < MAX_LABELS; q++) this.labels[q]!.setWanted(false)
  }

  /** Lane rectangle of unit k in the current (static) plan: centre y and height (braid-local). The returned
   * object is a reused scratch value (read it before the next call). */
  laneOf(k: number): { y: number; h: number } | null {
    if (this.evaluator.footprint() || !this.desc || k < 0 || k >= this.desc.word.length) return null
    const start = this.evaluator.unitStart(k)
    const end = this.evaluator.unitStart(k + 1)
    this.laneScratch.y = -(start + end) / 2
    this.laneScratch.h = Math.max(0.01, (end - start) * 0.96)
    return this.laneScratch
  }

  private readonly laneScratch = { y: 0, h: 0 }

  /** Show a lane at unit k (geometry rebuilt only when the key, crossing and word length, changes). */
  private placeLane(mesh: Mesh, k: number | null, current: number): number {
    const r = k === null ? null : this.laneOf(k)
    mesh.visible = r !== null
    if (!r || k === null) return current
    const key = k * 64 + (this.desc?.word.length ?? 0)
    if (key === current) return key
    const w = LANE_X1 - LANE_X0
    mesh.geometry.dispose()
    mesh.geometry = roundedRect(w, r.h, Math.min(0.012, r.h * 0.3))
    mesh.position.set((LANE_X0 + LANE_X1) / 2, r.y, -0.034)
    return key
  }

  setSelection(k: number | null): void {
    this.laneKey = this.placeLane(this.lane, k, this.laneKey)
  }

  setHoverLane(k: number | null): void {
    this.hoverKey = this.placeLane(this.hoverLane, k, this.hoverKey)
  }

  /** Highlight crossings [at, at + length) of the current static plan (null or length 0: none). */
  setSpan(at: number | null, length: number): void {
    const first = at === null || length <= 0 ? null : this.laneOf(at)
    const top = first ? first.y + first.h / 2 : 0
    const last = first && at !== null ? this.laneOf(at + length - 1) : null
    if (!first || !last || at === null) {
      this.spanLane.visible = false
      this.span = null
      return
    }
    const bottom = last.y - last.h / 2
    this.spanLane.visible = true
    this.span = { at, length }
    const key = (at * 8 + length) * 64 + (this.desc?.word.length ?? 0)
    if (key === this.spanKey) return
    this.spanKey = key
    const pad = 0.006
    const w = LANE_X1 - LANE_X0 + 2 * pad
    const h = top - bottom + 2 * pad
    this.spanLane.geometry.dispose()
    this.spanLane.geometry = roundedRect(w, h, Math.min(0.014, h * 0.2))
    this.spanLane.position.set((LANE_X0 + LANE_X1) / 2, (top + bottom) / 2, -0.036)
  }

  /** Emphasise one strand (selection "strand:x"): brighter, the others slightly dimmer. */
  setStrandEmphasis(s: number | null): void {
    for (let i = 0; i < 3; i++) this.materials[i]!.emissiveIntensity = s === null ? 0.14 : i === s ? 0.45 : 0.05
  }

  step(time: number, head: Vector3): void {
    for (const s of this.allSlots) {
      s.frame(time)
      if (s.anchor.visible) s.anchor.lookAt(head)
    }
    const W = this.textWidth
    this.word.anchor.scale.setScalar(this.word.width > W ? W / this.word.width : 1)
    this.invariants.anchor.scale.setScalar(this.invariants.width > W ? W / this.invariants.width : 1)
  }

  dispose(): void {
    for (const t of this.tubes) t.dispose()
    for (const m of this.materials) m.dispose()
    this.gapMat.dispose()
    for (const g of this.capGeos) g.dispose()
    this.frameGeo.dispose()
    this.frameMat.dispose()
    for (const m of [this.lane, this.hoverLane, this.spanLane]) {
      m.geometry.dispose()
      ;(m.material as MeshBasicMaterial).dispose()
    }
    for (const s of this.slots()) s.dispose()
    this.group.removeFromParent()
  }
}
