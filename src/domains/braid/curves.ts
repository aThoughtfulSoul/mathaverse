// Scalar easing shapes shared by every strand construction (generic crossings, the canonical relation
// motif and the inverse-cancellation motif). Using the same horizontal step everywhere is what lets the
// motifs join the generic geometry with continuous position and tangent.

/** The cubic smoothstep S(s) = 3s^2 - 2s^3 on [0, 1], clamped outside. S'(0) = S'(1) = 0. */
export function smoothstep(s: number): number {
  if (s <= 0) return 0
  if (s >= 1) return 1
  return s * s * (3 - 2 * s)
}

/**
 * The horizontal step between two knot levels: constant on shoulders of fraction `p` at both ends, the
 * cubic smoothstep in between. Monotone, C1, E(0) = 0, E(1) = 1, symmetric (E(1 - s) = 1 - E(s)).
 */
export function step(s: number, p: number): number {
  return smoothstep((s - p) / (1 - 2 * p))
}

/** Generic crossing depth profile: sin^2 over the moving part of a unit, 0 on the shoulders; peak 1 at s = 1/2. */
export function bump(s: number, p: number): number {
  const v = (s - p) / (1 - 2 * p)
  if (v <= 0 || v >= 1) return 0
  const q = Math.sin(Math.PI * v)
  return q * q
}

/**
 * C1 piecewise-quadratic ramp on [0, 1] (2s^2, then 1 - 2(1 - s)^2): zero slope at both ends and the
 * smallest possible peak second derivative (4, against 6 for the cubic smoothstep), so a depth ramp over a
 * collar of length c bends with radius at least c^2 / (4 h).
 */
export function ramp(s: number): number {
  if (s <= 0) return 0
  if (s >= 1) return 1
  return s < 0.5 ? 2 * s * s : 1 - 2 * (1 - s) * (1 - s)
}

/**
 * Depth envelope b(t) of a motif on t in [0, 1]: 0 at both ends, rising to 1 over the first collar [0, eps]
 * (ramp), 1 on the knot region [eps, 1 - eps], falling to 0 over the last collar.
 */
export function envelope(t: number, eps: number): number {
  if (t <= 0 || t >= 1) return 0
  if (t < eps) return ramp(t / eps)
  if (t > 1 - eps) return ramp((1 - t) / eps)
  return 1
}

/** Smooth 0 -> 1 progress used for presentation phases (same cubic). */
export const ease = smoothstep

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
