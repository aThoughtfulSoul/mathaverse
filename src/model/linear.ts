// Dimension-generic exact linear maps (MATHEMATICAL-CONTRACT M1, M3, M6). Column-vector convention:
// T(v) = Av, matrices stored as arrays of rows, (Av)_i = sum_j A_ij v_j. Indices start at zero.

import { type Q, ZERO, ONE, NEG_ONE, add, mul, eq, isZero, q, checkAuthored, format, CapacityError } from './rational'

export type Dim = 2 | 3
export type Vec = readonly Q[]
export type Mat = readonly (readonly Q[])[]

export class DimensionError extends Error {
  override name = 'DimensionError'
}

export function dimOf(a: Mat): Dim {
  const d = a.length
  if ((d !== 2 && d !== 3) || a.some((row) => row.length !== d)) {
    throw new DimensionError('a map must be a square 2 x 2 or 3 x 3 matrix')
  }
  return d
}

export function vec(...xs: (number | Q)[]): Vec {
  return xs.map((x) => (typeof x === 'number' ? q(x) : x))
}

export function mat(rows: (number | Q)[][]): Mat {
  const m = rows.map((r) => r.map((x) => (typeof x === 'number' ? q(x) : x)))
  dimOf(m)
  return m
}

export function apply(a: Mat, v: Vec): Vec {
  const d = dimOf(a)
  if (v.length !== d) throw new DimensionError(`vector of length ${v.length} for a ${d} x ${d} map`)
  return a.map((row) => row.reduce((s, aij, j) => add(s, mul(aij, v[j]!)), ZERO))
}

/** Matrix product A B (apply B first, then A). */
export function matMul(a: Mat, b: Mat): Mat {
  const d = dimOf(a)
  if (dimOf(b) !== d) throw new DimensionError('composition of maps with different dimensions')
  return a.map((row) => b[0]!.map((_, j) => row.reduce((s, aik, k) => add(s, mul(aik, b[k]![j]!)), ZERO)))
}

export function identity(d: Dim): Mat {
  return Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? ONE : ZERO)))
}

/** M3: an on-screen sequence A -> B -> C resolves to C B A. Empty sequence is identity. At most six maps. */
export function compose(d: Dim, sequence: readonly Mat[]): Mat {
  if (sequence.length > 6) throw new CapacityError('a branch holds at most six maps')
  return sequence.reduce((acc, m) => matMul(m, acc), identity(d))
}

export function vecEq(u: Vec, v: Vec): boolean {
  return u.length === v.length && u.every((x, i) => eq(x, v[i]!))
}

/** Exact entrywise equality. */
export function matEq(a: Mat, b: Mat): boolean {
  return a.length === b.length && a.every((row, i) => vecEq(row, b[i]!))
}

/** Column j of A, i.e. A e_j: the output basis handle for e_j (M4). */
export function column(a: Mat, j: number): Vec {
  return a.map((row) => row[j]!)
}

export function withColumn(a: Mat, j: number, col: Vec): Mat {
  const d = dimOf(a)
  if (col.length !== d) throw new DimensionError('column length mismatch')
  return a.map((row, i) => row.map((x, k) => (k === j ? col[i]! : x)))
}

/** M8: a witness basis index where A e_j != B e_j, or null when the maps are equal. */
export function differenceWitness(a: Mat, b: Mat): number | null {
  const d = dimOf(a)
  if (dimOf(b) !== d) throw new DimensionError('maps of different dimension')
  for (let j = 0; j < d; j++) if (!vecEq(column(a, j), column(b, j))) return j
  return null
}

export function checkAuthoredMatrix(a: Mat): void {
  a.forEach((row, i) => row.forEach((x, j) => checkAuthored(x, `entry (${i}, ${j})`)))
}

export function checkAuthoredVector(v: Vec, what = 'sample'): void {
  v.forEach((x, i) => checkAuthored(x, `${what} coordinate ${i}`))
}

// ---- presets (M3). Names are metadata; the matrix is the authority. ----

export const presets = {
  scaling: (factors: readonly Q[]): Mat =>
    factors.map((_, i) => factors.map((f, j) => (i === j ? f : ZERO))),
  /** I + k E_ij: output coordinate i gains k times input coordinate j. */
  shear: (d: Dim, i: number, j: number, k: Q): Mat => {
    if (i === j) throw new DimensionError('shear needs i != j')
    return identity(d).map((row, r) => row.map((x, c) => (r === i && c === j ? k : x)))
  },
  /** Negate coordinate `axis` (reflection across the hyperplane normal to e_axis). */
  reflection: (d: Dim, axis: number): Mat => identity(d).map((row, r) => row.map((x, c) => (r === c && r === axis ? NEG_ONE : x))),
  /** keep[i] true retains coordinate i. Nonempty proper subset required. */
  projection: (keep: readonly boolean[]): Mat => {
    const kept = keep.filter(Boolean).length
    if (kept === 0 || kept === keep.length) throw new DimensionError('a coordinate projection keeps a nonempty proper subset')
    return keep.map((_, i) => keep.map((k, j) => (i === j && k ? ONE : ZERO)))
  },
  /** Multiples of 90 degrees. 2D: counterclockwise. 3D: right-hand rule about axis 0/1/2. */
  rotation: (d: Dim, quarterTurns: number, axis: 0 | 1 | 2 = 2): Mat => {
    const t = ((quarterTurns % 4) + 4) % 4
    const c = [ONE, ZERO, NEG_ONE, ZERO][t]!
    const s = [ZERO, ONE, ZERO, NEG_ONE][t]!
    const ns = s.n === 0n ? ZERO : q(-s.n, s.d)
    if (d === 2) return [[c, ns], [s, c]]
    if (axis === 0) return [[ONE, ZERO, ZERO], [ZERO, c, ns], [ZERO, s, c]]
    if (axis === 1) return [[c, ZERO, s], [ZERO, ONE, ZERO], [ns, ZERO, c]]
    return [[c, ns, ZERO], [s, c, ZERO], [ZERO, ZERO, ONE]]
  },
}

/** I + k E_ij with i != j and k != 0, or null. */
function shearOf(a: Mat): { i: number; j: number; k: Q } | null {
  let found: { i: number; j: number; k: Q } | null = null
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a.length; j++) {
      const x = a[i]![j]!
      if (i === j) {
        if (!eq(x, ONE)) return null
      } else if (!isZero(x)) {
        if (found) return null
        found = { i, j, k: x }
      }
    }
  }
  return found
}

function isDiagonal(a: Mat): boolean {
  return a.every((row, i) => row.every((x, j) => i === j || isZero(x)))
}

/** M6: coordinate projector = diagonal with entries in {0, 1}, at least one of each. */
export function coordinateProjectorDiscarded(a: Mat): number[] | null {
  if (!isDiagonal(a)) return null
  const diag = a.map((row, i) => row[i]!)
  if (!diag.every((x) => eq(x, ZERO) || eq(x, ONE))) return null
  const discarded = diag.flatMap((x, i) => (isZero(x) ? [i] : []))
  if (discarded.length === 0 || discarded.length === diag.length) return null
  return discarded
}

/** The `coordinate_projector_nullity_one` capability predicate; returns the discarded index j. */
export function projectorNullityOne(a: Mat): number | null {
  const discarded = coordinateProjectorDiscarded(a)
  return discarded && discarded.length === 1 ? discarded[0]! : null
}

/** Recompute a descriptive name from the matrix itself (M3). */
export function describeMap(a: Mat): string {
  const d = dimOf(a)
  if (matEq(a, identity(d))) return 'Identity'
  const proj = coordinateProjectorDiscarded(a)
  const axes = d === 2 ? ['x', 'y'] : ['x', 'y', 'z']
  if (proj) return `Coordinate projection discarding ${proj.map((i) => axes[i]).join(', ')}`
  for (let axis = 0; axis < d; axis++) if (matEq(a, presets.reflection(d, axis))) return `Reflection negating ${axes[axis]}`
  for (let t = 1; t < 4; t++) {
    if (d === 2 && matEq(a, presets.rotation(2, t))) return `Rotation by ${t * 90}°`
    if (d === 3) for (const ax of [0, 1, 2] as const) if (matEq(a, presets.rotation(3, t, ax))) return `Rotation by ${t * 90}° about ${axes[ax]}`
  }
  if (isDiagonal(a)) return 'Scaling'
  const shear = shearOf(a)
  if (shear) return `Shear: output ${axes[shear.i]} gains ${format(shear.k)} × input ${axes[shear.j]}`
  return 'Custom linear map'
}

// ---- samples and exact grouping (M4, M6). ----

export interface Sample {
  readonly id: string
  readonly label: string
  readonly coords: Vec
}

export function vecKey(v: Vec): string {
  return v.map(format).join(',')
}

/** M6 operation 1: partition sample IDs by equality of the exact outputs Av. No proximity threshold. */
export function exactOutputGroups(a: Mat, samples: readonly Sample[]): { output: Vec; ids: string[] }[] {
  const groups = new Map<string, { output: Vec; ids: string[] }>()
  for (const s of samples) {
    const out = apply(a, s.coords)
    const key = vecKey(out)
    const g = groups.get(key)
    if (g) g.ids.push(s.id)
    else groups.set(key, { output: out, ids: [s.id] })
  }
  return [...groups.values()]
}

/**
 * M6 operation 2: the bounded portion of the fiber u + span{e_j} inside the authored box [-4, 4]^d.
 * Returns null when the line view is unavailable (the predicate is computed from the matrix).
 */
export function selectedFiberSegment(a: Mat, u: Vec): { direction: number; from: Vec; to: Vec } | null {
  const j = projectorNullityOne(a)
  if (j === null) return null
  const from = u.map((x, i) => (i === j ? q(-4) : x))
  const to = u.map((x, i) => (i === j ? q(4) : x))
  return { direction: j, from, to }
}

/** W1 default preset: the Cartesian product {-1, 0, 1}^d, IDs from the ordered coordinate tuple. */
export function gridSamples(d: Dim): Sample[] {
  const vals = [-1, 0, 1]
  const tuples: number[][] = d === 2 ? vals.flatMap((x) => vals.map((y) => [x, y])) : vals.flatMap((x) => vals.flatMap((y) => vals.map((z) => [x, y, z])))
  return tuples.map((t) => ({ id: `s(${t.join(',')})`, label: `(${t.join(', ')})`, coords: vec(...t) }))
}
