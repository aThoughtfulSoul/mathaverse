// Kinetic group sculpture: presentation geometry (the ring of slots and the bead paths). Nothing here carries
// algebra: the source -> destination assignment of every path comes from a cycle list that the derivation
// computed from the group's multiplication (derive.ts). Templates are chosen by CYCLE LENGTH only:
//   length 1: the bead stays;
//   length 2: a paired exchange, the two beads arcing past each other on opposite sides of their chord; when an
//             operation has several 2-cycles, each pair gets its own depth level along the ring normal (one pair
//             in front, the next behind, ...), so four beads crossing the centre stay distinguishable;
//   length >= 3: coherent flow around the ring in one direction per cycle, with a gentle lift off the ring.
//
// Coordinates: the sculpture root's frame (bench-local metres, +x right, +y up, +z toward the viewer).

import { Curve, Vector3 } from 'three'

export const RING = {
  /** Centre of the ring (bench-local). */
  center: [-0.085, 0.085, -0.095] as const,
  radius: 0.15,
  /** The ring plane leans back from vertical by this angle, so it reads as an ellipse with real depth. */
  tilt: (30 * Math.PI) / 180,
  bead: 0.02,
  /** Depth of a paired exchange (along the ring normal), metres. */
  depth: 0.055,
  /** Sideways bulge of a paired exchange, as a fraction of its chord. */
  lateral: 0.3,
  /** Minimum sideways bulge, metres. */
  lateralMin: 0.045,
  /** Lift of a flowing bead off the ring (along the normal) at the middle of its move. */
  lift: 0.024,
} as const

export interface RingFrame {
  center: Vector3
  right: Vector3
  up: Vector3
  normal: Vector3
  radius: number
}

export function ringFrame(): RingFrame {
  const t = RING.tilt
  return {
    center: new Vector3(...RING.center),
    right: new Vector3(1, 0, 0),
    up: new Vector3(0, Math.cos(t), -Math.sin(t)),
    normal: new Vector3(0, Math.sin(t), Math.cos(t)),
    radius: RING.radius,
  }
}

/** Slot i of n sits at angle 2 pi i / n, clockwise from the top as seen from the front. */
export function slotAngle(i: number, n: number): number {
  return (2 * Math.PI * i) / n
}

/** A point of the ring at angle theta (clockwise from the top). */
export function ringPoint(f: RingFrame, theta: number, out: Vector3): Vector3 {
  const s = Math.sin(theta) * f.radius
  const c = Math.cos(theta) * f.radius
  return out.set(
    f.center.x + s * f.right.x + c * f.up.x,
    f.center.y + s * f.right.y + c * f.up.y,
    f.center.z + s * f.right.z + c * f.up.z,
  )
}

export function slotPosition(f: RingFrame, i: number, n: number, out: Vector3): Vector3 {
  return ringPoint(f, slotAngle(i, n), out)
}

/** The path template of one bead under one operation, keyed by its source slot. */
export type PathSpec =
  | { kind: 'stay'; from: number; to: number }
  /** depth: signed offset along the ring normal at mid-move (+ = toward the viewer); lateral: sideways bulge. */
  | { kind: 'swap'; from: number; to: number; depth: number; lateral: number; pair: number }
  /** delta: signed angle travelled (radians, + = clockwise); lift: signed offset along the normal at mid-move. */
  | { kind: 'flow'; from: number; to: number; delta: number; lift: number; cycle: number }

const wrapPi = (a: number): number => {
  let x = a % (2 * Math.PI)
  if (x > Math.PI) x -= 2 * Math.PI
  if (x <= -Math.PI) x += 2 * Math.PI
  return x
}

/** Spread k levels over [+1, -1]: one level is +1 (in front), two are +1 and -1, three +1, 0, -1 ... */
const level = (j: number, k: number): number => (k <= 1 ? 1 : 1 - (2 * j) / (k - 1))

/**
 * Path templates for an operation given its cycles on n slots (from the derivation, fixed points included):
 * result[s] is the path of the bead that starts in slot s. Every slot gets exactly one path, and the paths'
 * destinations are exactly the cycles' successors.
 */
export function pathSpecs(cycles: readonly (readonly number[])[], n: number): PathSpec[] {
  const out = new Array<PathSpec>(n)
  const pairs = cycles.filter((c) => c.length === 2)
  const flows = cycles.filter((c) => c.length >= 3)
  for (const c of cycles) {
    if (c.length === 1) {
      out[c[0]!] = { kind: 'stay', from: c[0]!, to: c[0]! }
      continue
    }
    if (c.length === 2) {
      const pair = pairs.indexOf(c)
      const depth = RING.depth * level(pair, pairs.length)
      const chord = 2 * RING.radius * Math.abs(Math.sin((slotAngle(c[1]!, n) - slotAngle(c[0]!, n)) / 2))
      const lateral = Math.max(RING.lateralMin, RING.lateral * chord)
      out[c[0]!] = { kind: 'swap', from: c[0]!, to: c[1]!, depth, lateral, pair }
      out[c[1]!] = { kind: 'swap', from: c[1]!, to: c[0]!, depth, lateral, pair }
      continue
    }
    // One direction for the whole cycle: the sign of the summed short-way steps (clockwise on a tie).
    let sum = 0
    for (let j = 0; j < c.length; j++) sum += wrapPi(slotAngle(c[(j + 1) % c.length]!, n) - slotAngle(c[j]!, n))
    const dir = sum < -1e-9 ? -1 : 1
    const ci = flows.indexOf(c)
    const lift = RING.lift * level(ci, flows.length)
    for (let j = 0; j < c.length; j++) {
      const from = c[j]!
      const to = c[(j + 1) % c.length]!
      const raw = slotAngle(to, n) - slotAngle(from, n)
      const delta = dir * ((((dir * raw) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI))
      out[from] = { kind: 'flow', from, to, delta, lift, cycle: ci }
    }
  }
  for (let s = 0; s < n; s++) if (!out[s]) throw new Error(`pathSpecs: slot ${s} is not in any cycle`)
  return out
}

const tmpA = new Vector3()
const tmpB = new Vector3()
const tmpM = new Vector3()
const tmpP = new Vector3()

/** Position along a path at t in [0, 1] (t = 0 at the source slot, t = 1 exactly at the destination). */
export function evalPath(f: RingFrame, spec: PathSpec, n: number, t: number, out: Vector3): Vector3 {
  if (spec.kind === 'stay') return slotPosition(f, spec.from, n, out)
  if (spec.kind === 'flow') {
    ringPoint(f, slotAngle(spec.from, n) + spec.delta * t, out)
    if (t >= 1) return slotPosition(f, spec.to, n, out)
    return out.addScaledVector(f.normal, spec.lift * Math.sin(Math.PI * t))
  }
  if (t >= 1) return slotPosition(f, spec.to, n, out)
  const a = slotPosition(f, spec.from, n, tmpA)
  const b = slotPosition(f, spec.to, n, tmpB)
  const m = tmpM.copy(a).add(b).multiplyScalar(0.5)
  // In-plane perpendicular of the chord a -> b; the partner (b -> a) gets the opposite side automatically.
  const p = tmpP.copy(b).sub(a).cross(f.normal).normalize().negate()
  const c = Math.cos(Math.PI * t)
  const s = Math.sin(Math.PI * t)
  return out
    .copy(m)
    .addScaledVector(a.sub(m), c)
    .addScaledVector(f.normal, spec.depth * s)
    .addScaledVector(p, spec.lateral * s)
}

/** A three.js curve over one path (for tube geometry and arrowheads); getPoint never allocates with a target. */
export class PathCurve extends Curve<Vector3> {
  constructor(readonly frame: RingFrame, readonly spec: PathSpec, readonly n: number) {
    super()
  }

  override getPoint(t: number, out = new Vector3()): Vector3 {
    return evalPath(this.frame, this.spec, this.n, t, out)
  }
}

/** Smooth start and stop for every move (presentation easing only). */
export function ease(t: number): number {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}
