// The local deformation that cancels an adjacent inverse pair (FOUR-DEMOS-PARALLEL-HANDOFF section 8),
// in normalized coordinates. The pair's two strands enter at relative horizontal positions 0 (left) and 1
// (right); the third strand stays at its own position, at least one position away, and is not involved.
//
// For [s, s^-1] (s positive or negative) the SAME physical strand is over at both crossings: the left
// entry strand when the first crossing is positive, the right entry strand when it is negative (the
// opposite ranking). The motif therefore uses one constant depth ranking (+eta over, -eta under, times the
// envelope b(t)), so the two strands are depth-separated throughout the knot region whatever their
// horizontal positions. Three stages, endpoints fixed throughout:
//   1. (embedding, plan.ts) the generic crossing depths morph into the constant ranking (mu: 0 -> 1);
//   2. the out-and-back horizontal paths interpolate to the constant entry positions (nu: 0 -> 1);
//   3. the depth flattens with horizontal positions fixed and distinct (phi: 0 -> 1).
// The result is three straight strands; the empty span then closes (a longitudinal reparametrization).
// This is kept separate from the positive double crossing [s, s], whose over strand changes between the two
// events; it has no such deformation (its exponent sum is 2, the identity's is 0).

import { envelope } from './curves'
import { tableX } from './relation'

/** Knot paths of the pair (rows: left entry strand, right entry strand), relative positions. */
export const CANCEL_PATH: readonly (readonly number[])[] = [
  [0, 1, 0],
  [1, 0, 1],
]

export interface CancelParams {
  epsilon: number
  shoulder: number
  /** Constant depth offset of the motif. */
  eta: number
  H: number
}

/** Which member of the pair (0 = left entry strand, 1 = right) is over at both crossings. */
export function cancelOver(firstSign: number): 0 | 1 {
  return firstSign > 0 ? 0 : 1
}

/**
 * Centerline of pair member j at t for straightening progress nu and flattening progress phi, with the
 * constant ranking fully applied: out = [relative horizontal, depth, longitudinal].
 */
export function cancelCenterline(j: 0 | 1, t: number, nu: number, phi: number, firstSign: number, prm: CancelParams, out: number[] = [0, 0, 0]): number[] {
  out[0] = (1 - nu) * tableX(CANCEL_PATH, j, t, prm.epsilon, prm.shoulder) + nu * j
  out[1] = (j === cancelOver(firstSign) ? 1 : -1) * prm.eta * (1 - phi) * envelope(t, prm.epsilon)
  out[2] = prm.H * t
  return out
}
