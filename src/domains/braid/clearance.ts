// Sampling checks on rendered strand geometry: the minimum distance between centerlines of different
// strands, and the horizontal crossing events with which strand is over. These support the implementation
// (tests, scene reports); sampling is not a topology proof, and the exact word checks never depend on it.

import { GEOMETRY } from './constants'
import { type Plan, StrandEvaluator } from './plan'

export interface Clearance {
  /** Smallest sampled distance between centerline points of two different strands (m). */
  minDistance: number
  /** The strands (by identity) and longitudinal parameters where it occurs. */
  strands: [number, number]
  u: [number, number]
  /** Tube radius used and the resulting gap between tube surfaces: minDistance - 2 * radius. */
  radius: number
  surfaceGap: number
}

/**
 * Minimum distance over all sample pairs of different strands whose longitudinal parameters differ by at
 * most `window` metres (any farther pair is at least that far apart, so the result is the true sampled
 * minimum whenever it is below `window`).
 */
export function centerlineClearance(points: Float32Array, us: Float64Array, radius: number, window = 0.05): Clearance {
  const M = us.length
  const du = us[1]! - us[0]!
  const W = Math.ceil(window / du)
  let best = Infinity
  let bs: [number, number] = [0, 1]
  let bu: [number, number] = [0, 0]
  for (let s1 = 0; s1 < 3; s1++) {
    for (let s2 = s1 + 1; s2 < 3; s2++) {
      for (let m1 = 0; m1 < M; m1++) {
        const o1 = (s1 * M + m1) * 3
        const x1 = points[o1]!
        const y1 = points[o1 + 1]!
        const z1 = points[o1 + 2]!
        const lo = Math.max(0, m1 - W)
        const hi = Math.min(M - 1, m1 + W)
        for (let m2 = lo; m2 <= hi; m2++) {
          const o2 = (s2 * M + m2) * 3
          const dx = points[o2]! - x1
          const dy = points[o2 + 1]! - y1
          const dz = points[o2 + 2]! - z1
          const d = dx * dx + dy * dy + dz * dz
          if (d < best) {
            best = d
            bs = [s1, s2]
            bu = [us[m1]!, us[m2]!]
          }
        }
      }
    }
  }
  const minDistance = Math.sqrt(best)
  return { minDistance, strands: bs, u: bu, radius, surfaceGap: minDistance - 2 * radius }
}

/** Clearance of a plan (evaluated with a fresh evaluator; not for per-frame use). */
export function planClearance(plan: Plan, evaluator = new StrandEvaluator()): Clearance {
  const pts = new Float32Array(3 * evaluator.samples * 3)
  evaluator.evaluate(plan, pts)
  return centerlineClearance(pts, evaluator.us, plan.radius)
}

export interface CrossingEvent {
  /** Longitudinal parameter of the horizontal coincidence. */
  u: number
  /** Strand identities: over = nearer the viewer (+z). */
  over: number
  under: number
  /** Depth separation at the event (m). */
  depthGap: number
}

/**
 * Horizontal crossing events of a plan in longitudinal order: where x_i - x_j changes sign between two
 * fine samples, with the depth order there. `step` is the sampling step (m).
 */
export function crossingEvents(plan: Plan, step = 0.0002, evaluator = new StrandEvaluator()): CrossingEvent[] {
  evaluator.prepare(plan)
  const out: CrossingEvent[] = []
  const p0 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const p1 = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const L = GEOMETRY.length
  const read = (u: number, p: number[]) => {
    for (let s = 0; s < 3; s++) evaluator.point(s, u, p, s * 3)
  }
  read(0, p0)
  for (let u = step; u <= L + 1e-12; u += step) {
    read(u, p1)
    for (let s1 = 0; s1 < 3; s1++) {
      for (let s2 = s1 + 1; s2 < 3; s2++) {
        const d0 = p0[s1 * 3]! - p0[s2 * 3]!
        const d1 = p1[s1 * 3]! - p1[s2 * 3]!
        if ((d0 < 0 && d1 >= 0) || (d0 > 0 && d1 <= 0)) {
          const f = d0 / (d0 - d1)
          const z1 = p0[s1 * 3 + 2]! + f * (p1[s1 * 3 + 2]! - p0[s1 * 3 + 2]!)
          const z2 = p0[s2 * 3 + 2]! + f * (p1[s2 * 3 + 2]! - p0[s2 * 3 + 2]!)
          out.push({ u: u - step + f * step, over: z1 > z2 ? s1 : s2, under: z1 > z2 ? s2 : s1, depthGap: Math.abs(z1 - z2) })
        }
      }
    }
    for (let i = 0; i < 9; i++) p0[i] = p1[i]!
  }
  return out
}
