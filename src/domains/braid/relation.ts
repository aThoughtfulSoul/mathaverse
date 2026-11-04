// The canonical intersection-free deformation for the positive braid relation (FOUR-DEMOS-PARALLEL-HANDOFF
// section 8, "Concrete intersection-free construction"), implemented literally in normalized coordinates.
//
// Strands are named by the position they ENTER the motif at (0, 1, 2 = the handoff's a, b, c), at horizontal
// coordinates -1, 0, 1. Longitudinal parameter t in [0, 1]; end collars [0, eps] and [1 - eps, 1] keep the
// horizontal positions constant; four knot levels sit at equal intervals in [eps, 1 - eps]; between knot
// levels every strand uses the same monotone step (src/domains/braid/curves.ts `step`). Depths are
// d_i = rank_i * h with ranks (+1, 0, -1), times the envelope b(t). For progress lambda in [0, 1]:
//
//   C_i(t, lambda) = ((1 - lambda) x_i^L(t) + lambda x_i^R(t),  d_i b(t),  H t).
//
// In the knot region the three depths are distinct for every lambda; in the collars the horizontal
// positions are distinct and constant; points at different t have different third coordinates. So the
// centerlines never meet. With over = larger depth (nearer the viewer) the crossing order at lambda = 0 is
// 0 over 1, 0 over 2, 1 over 2 (sigma1 sigma2 sigma1) and at lambda = 1 it is 1 over 2, 0 over 2, 0 over 1
// (sigma2 sigma1 sigma2). The scene embeds this family at a word's span (plan.ts); the depth ranks go to the
// identities that occupy the three positions at the motif's entry.

import { envelope, step } from './curves'

/** Knot-level horizontal coordinates, rows = strands entering at positions 0, 1, 2 (handoff table). */
export const RELATION_L: readonly (readonly number[])[] = [
  [-1, 0, 1, 1],
  [0, -1, -1, 0],
  [1, 1, 0, -1],
]
export const RELATION_R: readonly (readonly number[])[] = [
  [-1, -1, 0, 1],
  [0, 1, 1, 0],
  [1, 0, -1, -1],
]
/** Depth rank of the strand entering at position i: d_i = RELATION_RANK[i] * h. */
export const RELATION_RANK: readonly number[] = [1, 0, -1]

export interface MotifParams {
  /** Collar fraction eps of the motif's length (0 < eps < 1/2). */
  epsilon: number
  /** Shoulder fraction of the step inside each knot interval (0 <= p < 1/2). */
  shoulder: number
  /** Depth step h (same unit as the horizontal coordinate, or metres when embedded). */
  h: number
  /** Longitudinal length H of the motif. */
  H: number
}

/** The m-th knot level t_m = eps + m (1 - 2 eps) / intervals. */
export function knotLevel(m: number, eps: number, intervals = 3): number {
  return eps + (m * (1 - 2 * eps)) / intervals
}

/**
 * Horizontal coordinate of row i of a knot table at t: constant on the collars, the shared step between
 * consecutive knot levels. Works for any number of knot levels (the cancellation motif uses three).
 */
export function tableX(table: readonly (readonly number[])[], i: number, t: number, eps: number, shoulder: number): number {
  const knots = table[i]!
  const intervals = knots.length - 1
  if (t <= eps) return knots[0]!
  if (t >= 1 - eps) return knots[intervals]!
  const w = ((t - eps) / (1 - 2 * eps)) * intervals
  const m = Math.min(intervals - 1, Math.floor(w))
  const a = knots[m]!
  return a + (knots[m + 1]! - a) * step(w - m, shoulder)
}

/** C_i(t, lambda) of the handoff, written into out = [horizontal, depth, longitudinal]. */
export function relationCenterline(i: number, t: number, lambda: number, prm: MotifParams, out: number[] = [0, 0, 0]): number[] {
  const xl = tableX(RELATION_L, i, t, prm.epsilon, prm.shoulder)
  const xr = tableX(RELATION_R, i, t, prm.epsilon, prm.shoulder)
  out[0] = (1 - lambda) * xl + lambda * xr
  out[1] = RELATION_RANK[i]! * prm.h * envelope(t, prm.epsilon)
  out[2] = prm.H * t
  return out
}
