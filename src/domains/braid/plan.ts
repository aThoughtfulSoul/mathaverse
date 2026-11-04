// Strand geometry of a whole word: a mutable Plan (unit lengths, generators, an optional local motif) and a
// StrandEvaluator that turns it into centerline points without allocating (it runs every animation frame).
//
// Longitudinal layout (top-anchored, u = metres below the first endpoint frame):
//   [lead collar] [unit 0] [unit 1] ... [unit n-1] [tail collar]   (total GEOMETRY.length)
// A unit holds one crossing (or nothing: a "straight" unit, gen 0, used while a cancelled pair closes or an
// inserted pair opens). Inside a unit of length P the two strands at positions i-1, i move between their
// positions with the shared step E (curves.ts `step`, shoulders of fraction p at both ends, the cubic
// smoothstep between); the third strand is straight. Generic crossing depth: the over strand at
// +crossDepth * bump(s), the under strand at -crossDepth * bump(s); bump is zero on the shoulders.
// Over = +z (nearer the viewer); positive sigma_i puts the strand currently at position i-1 over.
//
// Motifs replace a span's geometry inside a footprint [start(k) - c, end(k+m-1) + c], where the collars c are
// straight pieces adjacent to the span (the lead/tail, a neighbour's shoulder, plus straight units opened by
// setMotifPlan: a longitudinal reparametrization of straight pieces, which changes no crossing's shape).
// Inside the footprint t = (u - F0) / F, eps = c / F, and the knot levels are exactly the unit boundaries, so
// the motif's horizontal step is the generic one (position and tangent are continuous at the joins).
//   relation (m = 3): x = D * ((1 - lambda) x^L + lambda x^R) (relation.ts tables), depth
//       (1 - mu) * generic + mu * rank * h * b(t) with ranks by entry position.
//   cancel (m = 2): x = (1 - nu) * out-and-back + nu * entry position, depth
//       (1 - mu) * generic + mu * (1 - phi) * (+-eta) * b(t) (cancel.ts).

import type { Generator } from '../../algebra/braid'
import { GEOMETRY, MAX_UNITS } from './constants'
import { bump, envelope, step } from './curves'
import { CANCEL_PATH, cancelOver } from './cancel'
import { RELATION_L, RELATION_R, RELATION_RANK, tableX } from './relation'

export const MOTIF_NONE = 0
export const MOTIF_RELATION = 1
export const MOTIF_CANCEL = 2

export class Plan {
  /** Number of units in use. */
  count = 0
  lead: number = GEOMETRY.lead
  readonly len = new Float64Array(MAX_UNITS)
  /** Generator of each unit; 0 = straight unit. */
  readonly gen = new Int8Array(MAX_UNITS)
  radius: number = GEOMETRY.radius
  motif = MOTIF_NONE
  /** First unit of the motif's span. */
  motifAt = 0
  /** Relation progress (0 = sigma1 sigma2 sigma1 knots, 1 = sigma2 sigma1 sigma2). */
  lambda = 0
  /** Generic -> motif depth progress. */
  mu = 0
  /** Cancellation: horizontal straightening progress. */
  nu = 0
  /** Cancellation: depth flattening progress. */
  phi = 0
  /** Motif collar length (m): straight length on each side of the span used by the motif. */
  collar = 0

  copyFrom(o: Plan): this {
    this.count = o.count
    this.lead = o.lead
    this.len.set(o.len)
    this.gen.set(o.gen)
    this.radius = o.radius
    this.motif = o.motif
    this.motifAt = o.motifAt
    this.lambda = o.lambda
    this.mu = o.mu
    this.nu = o.nu
    this.phi = o.phi
    this.collar = o.collar
    return this
  }

  /** Total length of the units (the tail is the rest of GEOMETRY.length). */
  unitsLength(): number {
    let s = 0
    for (let j = 0; j < this.count; j++) s += this.len[j]!
    return s
  }

  /** Start of unit j (j = count gives the start of the tail). */
  unitStart(j: number): number {
    let s = this.lead
    for (let k = 0; k < j; k++) s += this.len[k]!
    return s
  }
}

/** Unit pitch for a word of n crossings: GEOMETRY.pitchMax, compressed so that the tail keeps tailMin. */
export function pitchFor(n: number): number {
  if (n <= 0) return GEOMETRY.pitchMax
  return Math.min(GEOMETRY.pitchMax, (GEOMETRY.length - GEOMETRY.lead - GEOMETRY.tailMin) / n)
}

/** Tube radius for a pitch: compressed words get thinner tubes so neighbouring units keep clear. */
export function radiusFor(pitch: number): number {
  return Math.min(GEOMETRY.radius, GEOMETRY.radiusPerPitch * pitch)
}

/** The static (exact-word) plan: one unit per crossing at the word's pitch, no motif. */
export function setStaticPlan(plan: Plan, word: readonly number[]): Plan {
  const n = word.length
  const p = pitchFor(n)
  plan.count = n
  plan.lead = GEOMETRY.lead
  for (let j = 0; j < MAX_UNITS; j++) {
    plan.len[j] = j < n ? p : 0
    plan.gen[j] = j < n ? word[j]! : 0
  }
  plan.radius = radiusFor(p)
  plan.motif = MOTIF_NONE
  plan.motifAt = 0
  plan.lambda = plan.mu = plan.nu = plan.phi = 0
  plan.collar = 0
  return plan
}

export interface MotifLayout {
  /** Straight units opened before and after the span (m). */
  before: number
  after: number
  /** Length taken from the lead and from each non-span unit (m). */
  fromLead: number
  fromUnit: number
  /** Collar available on both sides once opened (m). */
  collar: number
}

/**
 * Where a motif over the span [k, k+m) of a word gets its straight collars: the lead/tail or the neighbouring
 * shoulder, plus opened straight units, paid for by the tail slack, then the lead, then the other units.
 */
export function motifLayout(n: number, k: number, m: number): MotifLayout {
  const P = pitchFor(n)
  const p = GEOMETRY.shoulder
  const L0 = GEOMETRY.lead
  const T0 = GEOMETRY.length - L0 - n * P
  const cT = GEOMETRY.collar
  const availB = k === 0 ? L0 : p * P
  const availA = k + m === n ? T0 : p * P
  let e1 = Math.max(0, cT - availB)
  let e2 = Math.max(0, cT - availA)
  const sT = Math.max(0, T0 - (k + m === n ? cT : GEOMETRY.tailMin))
  const sL = Math.max(0, L0 - (k === 0 ? cT : GEOMETRY.leadMin))
  const others = n - m
  const sU = others * P * 0.5
  const need = e1 + e2
  if (need > sT + sL + sU && need > 0) {
    const f = (sT + sL + sU) / need
    e1 *= f
    e2 *= f
  }
  let rest = e1 + e2
  const fromTail = Math.min(rest, sT)
  rest -= fromTail
  const fromLead = Math.min(rest, sL)
  rest -= fromLead
  const fromUnit = others > 0 ? rest / others : 0
  const P1 = P - fromUnit
  const collar = Math.min((k === 0 ? L0 - fromLead : p * P1) + e1, (k + m === n ? T0 - fromTail : p * P1) + e2)
  return { before: e1, after: e2, fromLead, fromUnit, collar }
}

/**
 * The word laid out with the span [k, k+m)'s collars opened to fraction tau (0 = the static layout, 1 = fully
 * open): straight units of length before * tau and after * tau inserted at both ends of the span, the other
 * units and the lead shortened accordingly (the tail takes the rest). The span keeps the static pitch. Units
 * become [prefix, straight, span (m units, starting at index k + 1), straight, suffix]; no motif is set.
 */
export function setMotifPlan(plan: Plan, word: readonly number[], k: number, m: number, tau: number, lay = motifLayout(word.length, k, m)): Plan {
  const n = word.length
  const P = pitchFor(n)
  plan.count = n + 2
  plan.lead = GEOMETRY.lead - lay.fromLead * tau
  let j = 0
  for (let w = 0; w < n; w++) {
    if (w === k) {
      plan.len[j] = lay.before * tau
      plan.gen[j++] = 0
    }
    plan.len[j] = w >= k && w < k + m ? P : P - lay.fromUnit * tau
    plan.gen[j++] = word[w]!
    if (w === k + m - 1) {
      plan.len[j] = lay.after * tau
      plan.gen[j++] = 0
    }
  }
  for (; j < MAX_UNITS; j++) {
    plan.len[j] = 0
    plan.gen[j] = 0
  }
  plan.radius = radiusFor(Math.min(P, P - lay.fromUnit * tau))
  plan.motif = MOTIF_NONE
  plan.motifAt = k + 1
  plan.lambda = plan.mu = plan.nu = plan.phi = 0
  plan.collar = lay.collar
  return plan
}

export function staticPlan(word: readonly number[]): Plan {
  return setStaticPlan(new Plan(), word)
}

/** Generators of a plan's units (straight units included as 0). */
export function planWord(plan: Plan): number[] {
  return Array.from(plan.gen.subarray(0, plan.count))
}

export interface MotifFootprint {
  start: number
  end: number
  collar: number
}

export class StrandEvaluator {
  /** Sample parameters u_m (uniform over the whole length). */
  readonly us: Float64Array
  readonly samples: number
  readonly length: number
  private readonly start = new Float64Array(MAX_UNITS + 1)
  /** where[j * 3 + s]: position of strand s before unit j (j = count: after the last unit). */
  private readonly where = new Int8Array((MAX_UNITS + 1) * 3)
  /** at[j * 3 + p]: strand at position p before unit j. */
  private readonly at = new Int8Array((MAX_UNITS + 1) * 3)
  private readonly fp: MotifFootprint = { start: 0, end: 0, collar: 0 }
  private readonly tmp = [0, 0, 0]
  private prepared: Plan | null = null

  constructor(samples: number = GEOMETRY.samples, length: number = GEOMETRY.length) {
    this.samples = samples
    this.length = length
    this.us = new Float64Array(samples)
    for (let m = 0; m < samples; m++) this.us[m] = (m / (samples - 1)) * length
  }

  /** Unit starts and strand positions for a plan (call after changing it, before point/evaluate). */
  prepare(plan: Plan): void {
    this.prepared = plan
    let u = plan.lead
    for (let p = 0; p < 3; p++) {
      this.at[p] = p
      this.where[p] = p
    }
    for (let j = 0; j < plan.count; j++) {
      this.start[j] = u
      u += plan.len[j]!
      const b = (j + 1) * 3
      const a = j * 3
      for (let p = 0; p < 3; p++) this.at[b + p] = this.at[a + p]!
      const g = plan.gen[j]!
      if (g !== 0) {
        const i = Math.abs(g)
        const l = this.at[a + i - 1]!
        this.at[b + i - 1] = this.at[a + i]!
        this.at[b + i] = l
      }
      for (let p = 0; p < 3; p++) this.where[b + this.at[b + p]!] = p
    }
    this.start[plan.count] = u
    if (plan.motif !== MOTIF_NONE) {
      const k = plan.motifAt
      const m = plan.motif === MOTIF_RELATION ? 3 : 2
      const c = plan.collar
      this.fp.collar = c
      this.fp.start = this.start[k]! - c
      this.fp.end = this.start[k + m]! + c
    }
  }

  /** Start of unit j in the prepared plan. */
  unitStart(j: number): number {
    return this.start[j]!
  }

  /** End of the last unit in the prepared plan. */
  unitsEnd(): number {
    return this.start[this.prepared?.count ?? 0]!
  }

  /** Position of strand s before unit j (j = count: at the second endpoint frame). */
  positionBefore(j: number, s: number): number {
    return this.where[j * 3 + s]!
  }

  /** Strand at position p before unit j. */
  strandAt(j: number, p: number): number {
    return this.at[j * 3 + p]!
  }

  footprint(): MotifFootprint | null {
    return this.prepared && this.prepared.motif !== MOTIF_NONE ? this.fp : null
  }

  /** Centre of strand s at longitudinal parameter u (braid-local x, y, z) into out[o..o+2]. */
  point(s: number, u: number, out: { [i: number]: number }, o = 0, hint = -1): number {
    const plan = this.prepared!
    const D = GEOMETRY.spacing
    const n = plan.count
    // Unit containing u (hint: a starting guess for monotone sweeps).
    let j = hint >= 0 ? hint : 0
    if (u < plan.lead) j = -1
    else {
      if (j < 0) j = 0
      while (j < n && u >= this.start[j + 1]!) j++
      while (j > 0 && u < this.start[j]!) j--
    }
    let x: number
    let z = 0
    if (j < 0 || j >= n) {
      x = (this.where[(j < 0 ? 0 : n) * 3 + s]! - 1) * D
    } else {
      const L = plan.len[j]!
      const sl = L > 0 ? (u - this.start[j]!) / L : 1
      const a = this.where[j * 3 + s]!
      const b = this.where[(j + 1) * 3 + s]!
      x = (a - 1 + (b - a) * step(sl, GEOMETRY.shoulder)) * D
      const g = plan.gen[j]!
      if (g !== 0) {
        const i = Math.abs(g)
        const left = this.at[j * 3 + i - 1]!
        const right = this.at[j * 3 + i]!
        const over = g > 0 ? left : right
        const under = g > 0 ? right : left
        if (s === over) z = GEOMETRY.crossDepth * bump(sl, GEOMETRY.shoulder)
        else if (s === under) z = -GEOMETRY.crossDepth * bump(sl, GEOMETRY.shoulder)
      }
    }
    if (plan.motif !== MOTIF_NONE && u > this.fp.start && u < this.fp.end) {
      const F = this.fp.end - this.fp.start
      const t = (u - this.fp.start) / F
      const eps = this.fp.collar / F
      const b = envelope(t, eps)
      const k = plan.motifAt
      const e = this.where[k * 3 + s]!
      if (plan.motif === MOTIF_RELATION) {
        const xl = tableX(RELATION_L, e, t, eps, GEOMETRY.shoulder)
        const xr = tableX(RELATION_R, e, t, eps, GEOMETRY.shoulder)
        x = ((1 - plan.lambda) * xl + plan.lambda * xr) * D
        z = (1 - plan.mu) * z + plan.mu * RELATION_RANK[e]! * GEOMETRY.motifDepth * b
      } else {
        const g = plan.gen[k]!
        const i = Math.abs(g)
        const jj = e === i - 1 ? 0 : e === i ? 1 : -1
        if (jj >= 0) {
          const rel = (1 - plan.nu) * tableX(CANCEL_PATH, jj, t, eps, GEOMETRY.shoulder) + plan.nu * jj
          x = (i - 2 + rel) * D
          const sign = jj === cancelOver(g) ? 1 : -1
          z = (1 - plan.mu) * z + plan.mu * (1 - plan.phi) * sign * GEOMETRY.cancelDepth * b
        } else z = (1 - plan.mu) * z
      }
    }
    out[o] = x
    out[o + 1] = -u
    out[o + 2] = z
    return j
  }

  /** Every sample of every strand: out[(s * samples + m) * 3 + k], braid-local coordinates. */
  evaluate(plan: Plan, out: Float32Array): void {
    this.prepare(plan)
    const M = this.samples
    for (let s = 0; s < 3; s++) {
      let hint = 0
      for (let m = 0; m < M; m++) hint = this.point(s, this.us[m]!, out, (s * M + m) * 3, hint)
    }
  }

  /** Convenience for checks: one point as a fresh array (not for per-frame use). */
  at3(s: number, u: number): [number, number, number] {
    const o = this.tmp
    this.point(s, u, o)
    return [o[0]!, o[1]!, o[2]!]
  }
}

/** Static check helper: the word a plan represents (straight units dropped). */
export function wordOfPlan(plan: Plan): Generator[] {
  return planWord(plan).filter((g) => g !== 0) as Generator[]
}
