// The two exact actions of the cube-rotation group G used by demonstrations 2 and 3
// (FOUR-DEMOS-PARALLEL-HANDOFF sections 6, 7), shared by the planner, facts and both scenes.
//
// phi: G -> S4 on the four unoriented body-diagonal lines, phi(M)[i] = j when M d_i = +-d_j.
//      A bijection with phi(A B) = compose(phi(A), phi(B)).
// pi:  G -> S3 on the three unoriented coordinate-axis lines, pi(M)[j] = i when column j of M has its
//      nonzero entry in row i (sign ignored). Onto, kernel K = {I, diag(1,-1,-1), diag(-1,1,-1), diag(-1,-1,1)}.
//
// Pure module: imported by the browser and by the Node server. It must not import rendering code.

import { type Perm, permKey, permEq } from './permutation'
import { type FiniteGroup, type IntMat3, groupOf, matVec3 } from './groups'

/** The four body-diagonal lines, stable indices 0..3 (handoff fixture). */
export const DIAGONALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [1, -1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
]

export function cubeGroup(): FiniteGroup {
  return groupOf({ kind: 'cube_rotations' })
}

/** phi(M): the permutation M induces on the unoriented diagonal lines. */
export function diagonalPermutation(m: IntMat3): Perm {
  return DIAGONALS.map((d) => {
    const v = matVec3(m, d)
    const j = DIAGONALS.findIndex((e) => e.every((c, k) => c === v[k]) || e.every((c, k) => -c === v[k]))
    if (j < 0) throw new Error('diagonalPermutation: not a cube rotation')
    return j
  })
}

/** pi(M): the permutation M induces on the unoriented coordinate-axis lines (x, y, z = 0, 1, 2). */
export function axisPermutation(m: IntMat3): Perm {
  return [0, 1, 2].map((j) => [0, 1, 2].find((i) => m[i]![j] !== 0)!)
}

let phiTable: Map<string, Perm> | null = null
let phiInverse: Map<string, string> | null = null

function tables(): { phi: Map<string, Perm>; inv: Map<string, string> } {
  if (!phiTable || !phiInverse) {
    const g = cubeGroup()
    phiTable = new Map(g.elements.map((e) => [e, diagonalPermutation(g.matrix(e)!)]))
    phiInverse = new Map([...phiTable].map(([e, p]) => [permKey(p), e]))
  }
  return { phi: phiTable, inv: phiInverse }
}

/** phi of a group element ID. */
export function phiOf(elementId: string): Perm {
  const p = tables().phi.get(elementId)
  if (!p) throw new Error(`phiOf: ${JSON.stringify(elementId)} is not a cube rotation`)
  return p
}

/** The unique rotation inducing permutation p on the diagonal lines (phi is a bijection), or null. */
export function rotationForDiagonalPermutation(p: Perm): string | null {
  return p.length === 4 ? tables().inv.get(permKey(p)) ?? null : null
}

/** pi of a group element ID. */
export function piOf(elementId: string): Perm {
  return axisPermutation(cubeGroup().matrix(elementId)!)
}

/** The kernel K of pi: the identity and the three coordinate-axis half turns. */
export const KERNEL = ['r(x,y,z)', 'r(x,-y,-z)', 'r(-x,y,-z)', 'r(-x,-y,z)'] as const

/** Class key of an element under pi: the key of pi(M) ("102" for Rz90). Two rotations are equivalent exactly
 * when their keys agree; the six keys are the cosets of K. */
export function classKey(elementId: string): string {
  return permKey(piOf(elementId))
}

/** The six classes in a fixed order (by key), each with its four elements in group order. */
export function axisClasses(): { key: string; perm: Perm; elements: string[] }[] {
  const g = cubeGroup()
  const by = new Map<string, string[]>()
  for (const e of g.elements) {
    const k = classKey(e)
    by.set(k, [...(by.get(k) ?? []), e])
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, elements]) => ({ key, perm: piOf(elements[0]!), elements }))
}

/** Quotient product [A]·[B] = [A B] by class keys (representative-independent; checked in tests). */
export function classProduct(keyA: string, keyB: string): string {
  const cls = axisClasses()
  const a = cls.find((c) => c.key === keyA)
  const b = cls.find((c) => c.key === keyB)
  if (!a || !b) throw new Error('classProduct: unknown class key')
  return classKey(cubeGroup().multiply(a.elements[0]!, b.elements[0]!))
}

export function isClassKey(key: string): boolean {
  return axisClasses().some((c) => c.key === key)
}

export { permEq }
