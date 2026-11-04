// Bounded finite groups (FOUR-DEMOS-PARALLEL-HANDOFF sections 2, 4-7). A group is chosen by a typed
// definition stored in the document; its elements, multiplication, identity and inverses are computed
// exactly here and are the only authority. Element IDs are stable strings; labels and positions are
// presentation. multiply(a, b) = a·b. The left regular action L_g(x) = g·x gives L_a ∘ L_b = L_(a·b), so
// applying g, then h resolves to L_(h·g).
//
// Pure module: imported by the browser and by the Node server. It must not import rendering code.

import { type Perm } from './permutation'

export class GroupError extends Error {
  override name = 'GroupError'
}

/** Handoff bound: group order <= 24. */
export const MAX_GROUP_ORDER = 24

/** The typed group definitions this build supports (closed list). */
export type GroupDefinition =
  | { kind: 'cyclic'; order: number }
  | { kind: 'klein_four' }
  | { kind: 'cube_rotations' }

export const GROUP_KINDS = ['cyclic', 'klein_four', 'cube_rotations'] as const
export const CYCLIC_ORDERS = { min: 1, max: 12 } as const

/** A 3x3 integer matrix (rows), entries -1, 0, 1, for the cube rotations. */
export type IntMat3 = readonly (readonly number[])[]

export interface ElementLabel {
  /** TeX for scene text ("1", "(1,0)", "R_{z}"). */
  tex: string
  /** Plain text for status lines and facts ("1", "(1,0)", "Rz"). */
  plain: string
}

export interface FiniteGroup {
  readonly definition: GroupDefinition
  /** Stable element IDs in a fixed canonical order (identity first). */
  readonly elements: readonly string[]
  readonly identity: string
  readonly order: number
  has(id: string): boolean
  /** a·b (a after b, for the cube rotations: the matrix product A B). */
  multiply(a: string, b: string): string
  inverse(a: string): string
  /** Least k >= 1 with a^k = identity. */
  elementOrder(a: string): number
  label(a: string): ElementLabel
  /** Index of an element in `elements`. */
  indexOf(a: string): number
  /** The exact matrix of a cube rotation (cube_rotations only; null for abstract groups). */
  matrix(a: string): IntMat3 | null
}

// ------------------------------------------------------------------ generic construction from a table

function fromTable(definition: GroupDefinition, elements: string[], mul: (a: number, b: number) => number, label: (i: number) => ElementLabel, matrix: (i: number) => IntMat3 | null): FiniteGroup {
  const n = elements.length
  const index = new Map(elements.map((e, i) => [e, i]))
  const table: number[][] = elements.map((_, a) => elements.map((__, b) => mul(a, b)))
  const idIndex = elements.findIndex((_, e) => table[e]!.every((v, x) => v === x))
  if (idIndex !== 0) throw new GroupError('group table: the identity must be the first element')
  const inv = elements.map((_, a) => table[a]!.findIndex((v) => v === idIndex))
  const ord = elements.map((_, a) => {
    let k = 1
    for (let x = a; x !== idIndex; x = table[x]![a]!) k++
    return k
  })
  const at = (id: string, where: string): number => {
    const i = index.get(id)
    if (i === undefined) throw new GroupError(`${where}: ${JSON.stringify(id)} is not an element`)
    return i
  }
  return {
    definition,
    elements,
    identity: elements[0]!,
    order: n,
    has: (id) => index.has(id),
    multiply: (a, b) => elements[table[at(a, 'multiply')]![at(b, 'multiply')]!]!,
    inverse: (a) => elements[inv[at(a, 'inverse')]!]!,
    elementOrder: (a) => ord[at(a, 'elementOrder')]!,
    label: (a) => label(at(a, 'label')),
    indexOf: (a) => at(a, 'indexOf'),
    matrix: (a) => matrix(at(a, 'matrix')),
  }
}

// ------------------------------------------------------------------ C_n and V_4

function cyclic(n: number): FiniteGroup {
  if (!Number.isInteger(n) || n < CYCLIC_ORDERS.min || n > CYCLIC_ORDERS.max) throw new GroupError(`cyclic group: order ${CYCLIC_ORDERS.min}..${CYCLIC_ORDERS.max}`)
  const elements = Array.from({ length: n }, (_, k) => `c${k}`)
  return fromTable({ kind: 'cyclic', order: n }, elements, (a, b) => (a + b) % n, (i) => ({ tex: String(i), plain: String(i) }), () => null)
}

/** V_4 = (Z/2)^2, componentwise addition mod 2 (bitwise XOR of the index), labels (a,b). */
const V4_IDS = ['v00', 'v10', 'v01', 'v11']
function kleinFour(): FiniteGroup {
  const bits = [[0, 0], [1, 0], [0, 1], [1, 1]] as const
  return fromTable(
    { kind: 'klein_four' },
    V4_IDS,
    (a, b) => bits.findIndex(([x, y]) => x === (bits[a]![0] ^ bits[b]![0]) && y === (bits[a]![1] ^ bits[b]![1])),
    (i) => ({ tex: `(${bits[i]![0]},${bits[i]![1]})`, plain: `(${bits[i]![0]},${bits[i]![1]})` }),
    () => null,
  )
}

// ------------------------------------------------------------------ the 24 cube rotations

const AXIS = ['x', 'y', 'z'] as const

function det3(m: IntMat3): number {
  return m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) - m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) + m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!)
}

export function matMul3(a: IntMat3, b: IntMat3): IntMat3 {
  return a.map((row) => [0, 1, 2].map((j) => row[0]! * b[0]![j]! + row[1]! * b[1]![j]! + row[2]! * b[2]![j]!))
}

export function matVec3(m: IntMat3, v: readonly number[]): number[] {
  return m.map((row) => row[0]! * v[0]! + row[1]! * v[1]! + row[2]! * v[2]!)
}

export function transpose3(m: IntMat3): IntMat3 {
  return [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j]![i]!))
}

/** ID of a signed permutation matrix from its columns: column j is +-e_i, written "x", "-y", ...: "r(y,-x,z)". */
export function rotationId(m: IntMat3): string {
  const col = (j: number) => {
    const i = [0, 1, 2].find((r) => m[r]![j] !== 0)!
    return `${m[i]![j]! < 0 ? '-' : ''}${AXIS[i]}`
  }
  return `r(${col(0)},${col(1)},${col(2)})`
}

/** All 3x3 signed permutation matrices with determinant +1, identity first, then in a fixed order. */
export function enumerateCubeRotations(): IntMat3[] {
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
  const out: IntMat3[] = []
  for (const p of perms) for (let s = 0; s < 8; s++) {
    const signs = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1]
    // Column j has its nonzero entry in row p[j] with sign signs[j].
    const m = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (p[j] === i ? signs[j]! : 0)))
    if (det3(m) === 1) out.push(m)
  }
  return out
}

/** What a cube rotation is, from its exact matrix: kind, axis and angle (presentation names). */
export interface RotationInfo {
  kind: 'identity' | 'face' | 'vertex' | 'edge'
  /** Unit axis (mathematical coordinates, floats); null for the identity. */
  axis: [number, number, number] | null
  /** Rotation angle about `axis` in radians, right-hand rule, in (0, pi]; 0 for the identity. */
  angle: number
  label: ElementLabel
}

const BODY_DIAGONALS = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] as const

export function rotationInfo(m: IntMat3): RotationInfo {
  const t = m[0]![0]! + m[1]![1]! + m[2]![2]!
  if (t === 3) return { kind: 'identity', axis: null, angle: 0, label: { tex: 'I', plain: 'I' } }
  if (t === -1) {
    // Half turn: the axis spans the columns of (M + I).
    const s = [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[i]![j]! + (i === j ? 1 : 0)))
    const j = [0, 1, 2].find((c) => s.some((row) => row[c] !== 0))!
    let a = s.map((row) => row[j]!)
    // Canonical direction: first nonzero coordinate positive.
    if (a.find((v) => v !== 0)! < 0) a = a.map((v) => -v)
    const len = Math.hypot(...a)
    const nz = a.map((v, i) => [v, i] as const).filter(([v]) => v !== 0)
    const axis = a.map((v) => v / len) as [number, number, number]
    if (nz.length === 1) {
      const name = AXIS[nz[0]![1]]
      return { kind: 'face', axis, angle: Math.PI, label: { tex: `R_{${name}}^{2}`, plain: `R${name}^2` } }
    }
    const [[, i], [v2, k]] = nz as unknown as [[number, number], [number, number]]
    const bar = v2 < 0
    return { kind: 'edge', axis, angle: Math.PI, label: { tex: `E_{${AXIS[i]}${bar ? `\\bar{${AXIS[k]}}` : AXIS[k]}}`, plain: `E${AXIS[i]}${bar ? '-' : ''}${AXIS[k]}` } }
  }
  // 90 degrees (t = 1) or 120 degrees (t = 0): the axis is the skew part, positive angle about it.
  const w = [m[2]![1]! - m[1]![2]!, m[0]![2]! - m[2]![0]!, m[1]![0]! - m[0]![1]!]
  const len = Math.hypot(...w)
  const axis = w.map((v) => v / len) as [number, number, number]
  if (t === 1) {
    const i = w.findIndex((v) => v !== 0)
    const name = AXIS[i]
    return w[i]! > 0
      ? { kind: 'face', axis, angle: Math.PI / 2, label: { tex: `R_{${name}}`, plain: `R${name}` } }
      : { kind: 'face', axis, angle: Math.PI / 2, label: { tex: `R_{${name}}^{3}`, plain: `R${name}^3` } }
  }
  // 120 degrees about +-d_i: about +d_i it is V_i, about -d_i it is V_i^2 (240 degrees about +d_i).
  const sgn = w.map(Math.sign)
  const i = BODY_DIAGONALS.findIndex((d) => d.every((v, k) => v === sgn[k]) || d.every((v, k) => -v === sgn[k]))
  const positive = BODY_DIAGONALS[i]!.every((v, k) => v === sgn[k])
  return { kind: 'vertex', axis, angle: (2 * Math.PI) / 3, label: positive ? { tex: `V_{${i}}`, plain: `V${i}` } : { tex: `V_{${i}}^{2}`, plain: `V${i}^2` } }
}

function cubeRotations(): FiniteGroup {
  const mats = enumerateCubeRotations()
  const ids = mats.map(rotationId)
  const byId = new Map(ids.map((id, i) => [id, i]))
  const labels = mats.map((m) => rotationInfo(m).label)
  return fromTable({ kind: 'cube_rotations' }, ids, (a, b) => byId.get(rotationId(matMul3(mats[a]!, mats[b]!)))!, (i) => labels[i]!, (i) => mats[i]!)
}

// ------------------------------------------------------------------ registry

const cache = new Map<string, FiniteGroup>()

export function definitionKey(d: GroupDefinition): string {
  return d.kind === 'cyclic' ? `cyclic:${d.order}` : d.kind
}

/** The exact group of a definition (cached; groups are immutable). Throws GroupError for an unsupported one. */
export function groupOf(d: GroupDefinition): FiniteGroup {
  const key = definitionKey(d)
  let g = cache.get(key)
  if (!g) {
    g = d.kind === 'cyclic' ? cyclic(d.order) : d.kind === 'klein_four' ? kleinFour() : d.kind === 'cube_rotations' ? cubeRotations() : (() => { throw new GroupError(`unknown group kind ${JSON.stringify((d as { kind: unknown }).kind)}`) })()
    if (g.order > MAX_GROUP_ORDER) throw new GroupError(`group order above ${MAX_GROUP_ORDER}`)
    cache.set(key, g)
  }
  return g
}

/** Group names for text ("C_{4}", "V_{4}", "G"). */
export function groupName(d: GroupDefinition): ElementLabel {
  if (d.kind === 'cyclic') return { tex: `C_{${d.order}}`, plain: `C${d.order}` }
  if (d.kind === 'klein_four') return { tex: 'V_{4}', plain: 'V4' }
  return { tex: 'G', plain: 'G (cube rotations)' }
}

/** Product of a chronological list of elements: [a, b] (a, then b) resolves to b·a. */
export function chronologicalProduct(g: FiniteGroup, steps: readonly string[]): string {
  return steps.reduce((acc, s) => g.multiply(s, acc), g.identity)
}

/** The left regular action of `a` as a permutation of element indices: index of x -> index of a·x. */
export function regularPermutation(g: FiniteGroup, a: string): Perm {
  return g.elements.map((x) => g.indexOf(g.multiply(a, x)))
}
