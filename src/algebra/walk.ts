// Exact finite vector walks with sign labels and the positive-forward / negative-reverse reordering
// (workspace-spec/PROOF-EXPLORER-MATH.md sections 2-5). This is the reusable domain: a bounded list of vector
// occurrences with persistent identities, a source order and one sign per occurrence. Everything else (the
// three walks, their squared norms, the integer bounds, the output order and the prefix witness of every
// reordered endpoint) is derived here from those inputs, with exact rationals only.
//
// Correspondence with the pinned source (Transference.lean, OpenAI `math` @ 4eaee875):
//   signedOrder p l   = l.filter p ++ (l.filter (!p)).reverse     -> `permutation` below
//   signedOrder_prefix                                          -> `witnesses` (both branches)
//   signed_parts: 2 P_j = U_j + S_j, 2 M_j = U_j - S_j          -> W_k = (U_j + S_j)/2, W_k = T + (S_j - U_j)/2
//   signedOrder_prefix_bound (needs T = 0)                       -> `lemmaApplicable`, `boundHolds`
// The paper's A_j, B_j are U_j, S_j here; the scalar bounds B, D below are different quantities.
//
// Pure module: imported by the browser and by the Node server. No floats except in display helpers marked so.

import { type Q, ZERO, add, sub, mul, neg, eq, cmp, q, isZero, format } from '../model/rational'
import type { Dim, Vec } from '../model/linear'

export type Sign = 1 | -1

/** One vector occurrence. Equal coordinates in two occurrences are still two occurrences. */
export interface WalkOccurrence {
  id: string
  coords: Vec
}

/** The canonical inputs of a vector walk (what a document stores; nothing derived). */
export interface WalkInput {
  dimension: Dim
  /** Occurrences in canonical stored order: identity, not position in the walk. */
  vectors: readonly WalkOccurrence[]
  /** Source order: every occurrence ID exactly once. */
  order: readonly string[]
  /** One sign per occurrence, parallel to `vectors` (so a sign stays with its occurrence when the order changes). */
  signs: readonly Sign[]
}

export class WalkError extends Error {
  override name = 'WalkError'
}

/** Engineering bounds (adjust deliberately; never truncate silently). */
export const WALK_LIMITS = {
  minVectors: 1,
  maxVectors: 12,
  /** Every coordinate lies in [-coordAbs, coordAbs]. */
  coordAbs: 4n,
  /** Every coordinate's denominator is at most this (keeps the generated Lean check small). */
  maxDenominator: 1000n,
} as const

/** Occurrence IDs: short, stable, safe inside selection items (`walk:vector:<id>`). */
export const OCCURRENCE_ID_RE = /^[a-z][a-z0-9_]{0,15}$/

/** The bound convention: B, D are the least natural numbers bounding every prefix norm; R = (B + D)/2. */
export const BOUND_CONVENTION = 'integer-ceiling-v1'

// ------------------------------------------------------------------ exact vector helpers

export const vzero = (d: number): Vec => Array.from({ length: d }, () => ZERO)
export const vadd = (a: Vec, b: Vec): Vec => a.map((x, i) => add(x, b[i]!))
export const vsub = (a: Vec, b: Vec): Vec => a.map((x, i) => sub(x, b[i]!))
export const vneg = (a: Vec): Vec => a.map(neg)
export const vscale = (s: Q, a: Vec): Vec => a.map((x) => mul(s, x))
export const veq = (a: Vec, b: Vec): boolean => a.length === b.length && a.every((x, i) => eq(x, b[i]!))
export const visZero = (a: Vec): boolean => a.every(isZero)
/** Exact squared Euclidean norm. */
export const norm2 = (a: Vec): Q => a.reduce((s, x) => add(s, mul(x, x)), ZERO)
export const HALF: Q = q(1, 2)
export const vtext = (a: Vec): string => `(${a.map(format).join(', ')})`

/** Integer square root: the largest r with r^2 <= n (Newton's method on bigints). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new WalkError('square root of a negative number')
  if (n < 2n) return n
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2))
  for (;;) {
    const y = (x + n / x) >> 1n
    if (y >= x) break
    x = y
  }
  while (x * x > n) x--
  while ((x + 1n) * (x + 1n) <= n) x++
  return x
}

/** The least natural number b with b^2 >= a (a >= 0), by integer comparison, never Math.sqrt. */
export function ceilSqrt(a: Q): bigint {
  if (a.n < 0n) throw new WalkError('square root of a negative number')
  const b = isqrt(a.n / a.d)
  return b * b * a.d >= a.n ? b : b + 1n
}

/** Display only (marked approximate wherever shown). Never fed back into exact state. */
export const approxSqrt = (a: Q): number => Math.sqrt(Number(a.n) / Number(a.d))

// ------------------------------------------------------------------ validation

/** Structural and bound checks of walk inputs. Throws WalkError with the first problem. */
export function checkWalk(w: WalkInput): void {
  if (w.dimension !== 2 && w.dimension !== 3) throw new WalkError('dimension must be 2 or 3')
  const n = w.vectors.length
  if (n < WALK_LIMITS.minVectors || n > WALK_LIMITS.maxVectors) throw new WalkError(`a walk has ${WALK_LIMITS.minVectors} to ${WALK_LIMITS.maxVectors} vector occurrences (got ${n})`)
  const ids = new Set<string>()
  for (const [i, v] of w.vectors.entries()) {
    if (typeof v.id !== 'string' || !OCCURRENCE_ID_RE.test(v.id)) throw new WalkError(`vectors[${i}].id: lowercase letter, then letters, digits or _ (at most 16)`)
    if (ids.has(v.id)) throw new WalkError(`duplicate occurrence ID ${v.id}`)
    ids.add(v.id)
    if (v.coords.length !== w.dimension) throw new WalkError(`vector ${v.id}: expected ${w.dimension} coordinates`)
    for (const [k, c] of v.coords.entries()) {
      if (c.d > WALK_LIMITS.maxDenominator) throw new WalkError(`vector ${v.id}[${k}]: denominator above ${WALK_LIMITS.maxDenominator}`)
      if (cmp(c, q(-WALK_LIMITS.coordAbs)) < 0 || cmp(c, q(WALK_LIMITS.coordAbs)) > 0) throw new WalkError(`vector ${v.id}[${k}]: outside [-${WALK_LIMITS.coordAbs}, ${WALK_LIMITS.coordAbs}]`)
    }
  }
  if (w.order.length !== n) throw new WalkError(`the source order lists ${w.order.length} occurrences, expected ${n}`)
  const seen = new Set<string>()
  for (const id of w.order) {
    if (!ids.has(id)) throw new WalkError(`the source order names ${JSON.stringify(id)}, which is not an occurrence`)
    if (seen.has(id)) throw new WalkError(`the source order names ${id} twice`)
    seen.add(id)
  }
  if (w.signs.length !== n) throw new WalkError(`expected one sign per occurrence (${n}), got ${w.signs.length}`)
  for (const [i, s] of w.signs.entries()) if (s !== 1 && s !== -1) throw new WalkError(`signs[${i}]: 1 or -1`)
}

/** Signs listed in source order (each read from its occurrence). */
export function signsInSourceOrder(w: WalkInput): Sign[] {
  const at = new Map(w.vectors.map((v, i) => [v.id, i]))
  return w.order.map((id) => w.signs[at.get(id)!]!)
}

/** Vectors listed in source order. */
export function vectorsInSourceOrder(w: WalkInput): Vec[] {
  const byId = new Map(w.vectors.map((v) => [v.id, v.coords]))
  return w.order.map((id) => byId.get(id)!)
}

// ------------------------------------------------------------------ derivation

export type WitnessBranch = 'positive' | 'negative'

/** The source-prefix witness of one reordered endpoint W_k (PROOF-EXPLORER-MATH section 4). */
export interface PrefixWitness {
  k: number
  /** Source prefix length j (0..N), chosen deterministically: never "the same k". */
  j: number
  branch: WitnessBranch
  /** Positive: W_k = (U_j + S_j)/2. Negative: W_k = T + (S_j - U_j)/2. Exact for every input. */
  identityHolds: boolean
  /** The form without the residual T (only true for every k when T = 0). */
  zeroSumFormHolds: boolean
  /** The two half-sized resultants drawn head to tail: positive [U_j/2, S_j/2]; negative [S_j/2, -U_j/2]. */
  halves: readonly [Vec, Vec]
  /** Their exact sum (equal to W_k exactly when the residual is zero). */
  halfSum: Vec
  /** The residual T added in the negative branch (the zero vector in the positive branch). */
  residual: Vec
  /** For the positive branch, the positive-labelled source occurrences counted in P_j (source positions);
   * for the negative branch, the negative-labelled ones in M_j, whose arrows are NOT yet used by W_k. */
  counted: readonly number[]
  wNorm2: Q
  /** |W_k|^2 <= R^2 (exact). */
  withinBound: boolean
}

export type BoundComparison = 'better' | 'same' | 'worse'

export interface WalkFacts {
  dimension: Dim
  n: number
  /** Occurrence IDs in source order. */
  ids: readonly string[]
  /** v_i in source order, and the signed copies eps_i v_i (auxiliary walk only). */
  vectors: readonly Vec[]
  signedVectors: readonly Vec[]
  signs: readonly Sign[]
  /** Prefix sums for j = 0..N: source U, auxiliary signed S, positive-filtered P, negative-filtered M. */
  U: readonly Vec[]
  S: readonly Vec[]
  P: readonly Vec[]
  M: readonly Vec[]
  /** Reordered prefixes W_k, k = 0..N. */
  W: readonly Vec[]
  total: Vec
  zeroSum: boolean
  /** Source positions with positive / negative sign, increasing (A and C). */
  positive: readonly number[]
  negative: readonly number[]
  /** Output order pi = A ++ reverse(C), as source positions; reorderedIds names the same occurrences. */
  permutation: readonly number[]
  reorderedIds: readonly string[]
  uNorm2: readonly Q[]
  sNorm2: readonly Q[]
  wNorm2: readonly Q[]
  /** Exact squared peaks and the first prefix attaining each. */
  sourcePeak2: Q
  signedPeak2: Q
  reorderedPeak2: Q
  sourcePeakAt: number
  signedPeakAt: number
  reorderedPeakAt: number
  /** Least natural numbers bounding every source / signed prefix norm, and the lemma's bound R = (B + D)/2. */
  B: bigint
  D: bigint
  R: Q
  witnesses: readonly PrefixWitness[]
  /** The lemma's hypothesis T = 0 (B, D >= 0 hold by construction). */
  lemmaApplicable: boolean
  /** Every reordered prefix satisfies |W_k|^2 <= R^2 (true whenever the lemma applies; may hold by chance otherwise). */
  boundHolds: boolean
  /** The first k with |W_k|^2 > R^2, or null. */
  firstFailure: number | null
  /** Every |v_i| <= 1 (a condition of the surrounding theorem, not of this lemma). */
  allInUnitBall: boolean
  /** The new bound R against the source bound B (bounds, not measured distances). */
  comparison: BoundComparison
}

function prefixes(d: number, vs: readonly Vec[]): Vec[] {
  const out: Vec[] = [vzero(d)]
  for (const v of vs) out.push(vadd(out[out.length - 1]!, v))
  return out
}

function peak(norms: readonly Q[]): { value: Q; at: number } {
  let at = 0
  for (let i = 1; i < norms.length; i++) if (cmp(norms[i]!, norms[at]!) > 0) at = i
  return { value: norms[at]!, at }
}

/** The output order: positive-labelled source positions in source order, then negative ones in reverse. */
export function signedOrder(signs: readonly Sign[]): { positive: number[]; negative: number[]; permutation: number[] } {
  const positive = signs.flatMap((s, i) => (s === 1 ? [i] : []))
  const negative = signs.flatMap((s, i) => (s === -1 ? [i] : []))
  return { positive, negative, permutation: [...positive, ...[...negative].reverse()] }
}

/**
 * The witness j of reordered endpoint k (section 4). Positive part (k <= p): j = 0 for k = 0, else A[k-1] + 1.
 * Negative part (p < k <= N): r = k - p, q = m - r; j = 0 for q = 0, else C[q-1] + 1. Empty sign classes are
 * handled by the bounds of k (no out-of-range access).
 */
export function witnessIndex(k: number, positive: readonly number[], negative: readonly number[]): { j: number; branch: WitnessBranch } {
  const p = positive.length
  const n = p + negative.length
  if (!Number.isInteger(k) || k < 0 || k > n) throw new WalkError(`reordered prefix ${k} is outside 0..${n}`)
  if (k <= p) return { j: k === 0 ? 0 : positive[k - 1]! + 1, branch: 'positive' }
  const rest = negative.length - (k - p)
  return { j: rest === 0 ? 0 : negative[rest - 1]! + 1, branch: 'negative' }
}

/** Derive every fact of a validated walk. Throws WalkError for invalid inputs. */
export function deriveWalk(w: WalkInput): WalkFacts {
  checkWalk(w)
  const d = w.dimension
  const vectors = vectorsInSourceOrder(w)
  const signs = signsInSourceOrder(w)
  const n = vectors.length
  const signedVectors = vectors.map((v, i) => (signs[i] === 1 ? v : vneg(v)))
  const U = prefixes(d, vectors)
  const S = prefixes(d, signedVectors)
  const P = prefixes(d, vectors.map((v, i) => (signs[i] === 1 ? v : vzero(d))))
  const M = prefixes(d, vectors.map((v, i) => (signs[i] === -1 ? v : vzero(d))))
  const { positive, negative, permutation } = signedOrder(signs)
  const W = prefixes(d, permutation.map((i) => vectors[i]!))
  const total = U[n]!
  const zeroSum = visZero(total)
  const uNorm2 = U.map(norm2)
  const sNorm2 = S.map(norm2)
  const wNorm2 = W.map(norm2)
  const sp = peak(uNorm2)
  const gp = peak(sNorm2)
  const wp = peak(wNorm2)
  const B = ceilSqrt(sp.value)
  const D = ceilSqrt(gp.value)
  const R = q(B + D, 2n)
  const R2 = mul(R, R)
  const witnesses: PrefixWitness[] = W.map((wk, k) => {
    const { j, branch } = witnessIndex(k, positive, negative)
    const halfU = vscale(HALF, U[j]!)
    const halfS = vscale(HALF, S[j]!)
    const halves: [Vec, Vec] = branch === 'positive' ? [halfU, halfS] : [halfS, vneg(halfU)]
    const halfSum = vadd(halves[0], halves[1])
    const residual = branch === 'positive' ? vzero(d) : total
    const counted = (branch === 'positive' ? positive : negative).filter((i) => i < j)
    return {
      k, j, branch,
      identityHolds: veq(wk, vadd(residual, halfSum)),
      zeroSumFormHolds: veq(wk, halfSum),
      halves, halfSum, residual, counted,
      wNorm2: wNorm2[k]!,
      withinBound: cmp(wNorm2[k]!, R2) <= 0,
    }
  })
  // The exact identities are theorems (signed_parts + the zero-sum split); a failure here is a defect in this code.
  for (const x of witnesses) if (!x.identityHolds) throw new WalkError(`internal: the prefix identity failed at k = ${x.k}`)
  if (witnesses.some((x) => x.branch === 'positive' && !veq(W[x.k]!, P[x.j]!))) throw new WalkError('internal: a positive witness is not a positive-filtered prefix')
  const failure = witnesses.find((x) => !x.withinBound)
  const one = q(1)
  const cmpRB = cmp(R, q(B))
  return {
    dimension: d, n,
    ids: [...w.order], vectors, signedVectors, signs,
    U, S, P, M, W, total, zeroSum,
    positive, negative, permutation, reorderedIds: permutation.map((i) => w.order[i]!),
    uNorm2, sNorm2, wNorm2,
    sourcePeak2: sp.value, signedPeak2: gp.value, reorderedPeak2: wp.value,
    sourcePeakAt: sp.at, signedPeakAt: gp.at, reorderedPeakAt: wp.at,
    B, D, R,
    witnesses,
    lemmaApplicable: zeroSum,
    boundHolds: !failure,
    firstFailure: failure ? failure.k : null,
    allInUnitBall: vectors.every((v) => cmp(norm2(v), one) <= 0),
    comparison: cmpRB < 0 ? 'better' : cmpRB === 0 ? 'same' : 'worse',
  }
}

// ------------------------------------------------------------------ prepared endpoints and selection items

/**
 * A representative endpoint of each branch: positive k = ceil(p/2), negative k = p + ceil(m/2) (null when that
 * sign class is empty). For the hero (p = m = 6) these are the prepared k = 3 and k = 9.
 */
export function representativeEndpoints(f: Pick<WalkFacts, 'positive' | 'negative'>): { positive: number | null; negative: number | null } {
  const p = f.positive.length
  const m = f.negative.length
  return { positive: p ? Math.ceil(p / 2) : null, negative: m ? p + Math.ceil(m / 2) : null }
}

/** Selection items of a vector-walk experiment. Integers are prefix lengths (including 0), never vector indices. */
export type WalkItem =
  | { kind: 'source' | 'signed' | 'reordered'; index: number }
  | { kind: 'vector'; id: string }

const ITEM_RE = /^walk:(source|signed|reordered):(0|[1-9][0-9]?)$|^walk:vector:([a-z][a-z0-9_]{0,15})$/

/** Parse a selection item against a walk (null for none). Throws WalkError for anything invalid: never clamps. */
export function parseWalkItem(item: string | null, w: Pick<WalkInput, 'vectors'>): WalkItem | null {
  if (item === null) return null
  const m = ITEM_RE.exec(item)
  if (!m) throw new WalkError(`"${item}" is not walk:source:<j>, walk:signed:<j>, walk:reordered:<k> or walk:vector:<id>`)
  if (m[3] !== undefined) {
    if (!w.vectors.some((v) => v.id === m[3])) throw new WalkError(`"${item}": there is no occurrence ${m[3]}`)
    return { kind: 'vector', id: m[3] }
  }
  const index = Number(m[2])
  const n = w.vectors.length
  if (index > n) throw new WalkError(`"${item}": prefix lengths run from 0 to ${n}`)
  return { kind: m[1] as 'source' | 'signed' | 'reordered', index }
}

export function walkItemText(i: WalkItem): string {
  if (i.kind === 'vector') return `walk:vector:${i.id}`
  return `walk:${i.kind}:${i.index}`
}

// ------------------------------------------------------------------ exact claim payload

/** The mathematical content an all-prefix claim depends on: data in source order and the bound convention.
 * Occurrence IDs, selection and presentation are excluded. */
export function walkClaimPayload(w: WalkInput): { dimension: Dim; vectors: Vec[]; signs: Sign[]; convention: string } {
  return { dimension: w.dimension, vectors: vectorsInSourceOrder(w), signs: signsInSourceOrder(w), convention: BOUND_CONVENTION }
}
