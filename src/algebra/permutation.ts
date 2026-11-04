// Exact permutations (FOUR-DEMOS-PARALLEL-HANDOFF section 4). A permutation is an array p with
// p[i] = destination of source i; every destination appears once. compose(p, q)[i] = p[q[i]] means
// "p after q": a chronological list "q, then p" resolves to compose(p, q).
//
// Pure module: imported by the browser and by the Node server. It must not import rendering code.

export type Perm = readonly number[]

export class PermutationError extends Error {
  override name = 'PermutationError'
}

/** Permutation degree bound for anything stored or shown (handoff: degree <= 4 for the diagonal lines; the
 * sculpture's regular action of a group of order n has degree n, bounded by DOMAIN_LIMITS.sculptureOrder in
 * src/domains/inputs.ts). */
export const MAX_DEGREE = 24

export function isPermutation(x: unknown, degree?: number): x is Perm {
  if (!Array.isArray(x) || x.length === 0 || x.length > MAX_DEGREE) return false
  if (degree !== undefined && x.length !== degree) return false
  const seen = new Set<number>()
  for (const v of x) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= x.length || seen.has(v)) return false
    seen.add(v)
  }
  return true
}

export function checkPermutation(x: unknown, where = 'permutation', degree?: number): Perm {
  if (!isPermutation(x, degree)) throw new PermutationError(`${where}: expected ${degree ?? 'n'} distinct destinations 0..${degree === undefined ? 'n' : degree}-1`)
  return x
}

export function identityPerm(n: number): Perm {
  return Array.from({ length: n }, (_, i) => i)
}

/** p after q: compose(p, q)[i] = p[q[i]]. */
export function compose(p: Perm, q: Perm): Perm {
  if (p.length !== q.length) throw new PermutationError('compose: different degrees')
  return q.map((d) => p[d]!)
}

/** Chronological application: [a, b, c] means a, then b, then c, resolving to c after b after a. */
export function composeChronological(steps: readonly Perm[], n: number): Perm {
  return steps.reduce<Perm>((acc, s) => compose(s, acc), identityPerm(n))
}

export function inverse(p: Perm): Perm {
  const out = new Array<number>(p.length)
  p.forEach((d, i) => (out[d] = i))
  return out
}

export function permEq(p: Perm, q: Perm): boolean {
  return p.length === q.length && p.every((v, i) => v === q[i])
}

export function isIdentityPerm(p: Perm): boolean {
  return p.every((v, i) => v === i)
}

/** Disjoint cycles (each starts at its smallest element; ordered by that element). Fixed points are
 * cycles of length 1 and are included. */
export function cycles(p: Perm): number[][] {
  const seen = new Array<boolean>(p.length).fill(false)
  const out: number[][] = []
  for (let i = 0; i < p.length; i++) {
    if (seen[i]) continue
    const c: number[] = []
    for (let j = i; !seen[j]; j = p[j]!) {
      seen[j] = true
      c.push(j)
    }
    out.push(c)
  }
  return out
}

/** Cycle type: the cycle lengths in non-increasing order ([4], [2, 2], [1, 1, 1, 1]). */
export function cycleType(p: Perm): number[] {
  return cycles(p).map((c) => c.length).sort((a, b) => b - a)
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** The order of p: the least common multiple of its cycle lengths. */
export function permOrder(p: Perm): number {
  return cycles(p).reduce((l, c) => (l * c.length) / gcd(l, c.length), 1)
}

/** Cycle notation with the given point names, omitting fixed points ("(0 1)(2 3)"; "()" for the identity). */
export function cycleText(p: Perm, name: (i: number) => string = String): string {
  const cs = cycles(p).filter((c) => c.length > 1)
  return cs.length ? cs.map((c) => `(${c.map(name).join(' ')})`).join('') : '()'
}

/** Stable text key: "1302" for degree <= 10, else comma separated. */
export function permKey(p: Perm): string {
  return p.length <= 10 ? p.join('') : p.join(',')
}

/** The transposition swapping a and b on n points. */
export function transposition(n: number, a: number, b: number): Perm {
  const p = [...identityPerm(n)]
  p[a] = b
  p[b] = a
  return p
}

/** All permutations of n points in lexicographic order (n <= 6). */
export function allPermutations(n: number): Perm[] {
  if (n > 6) throw new PermutationError('allPermutations: degree above 6')
  const out: Perm[] = []
  const rec = (prefix: number[], rest: number[]) => {
    if (!rest.length) return void out.push(prefix)
    rest.forEach((v, i) => rec([...prefix, v], [...rest.slice(0, i), ...rest.slice(i + 1)]))
  }
  rec([], identityPerm(n) as number[])
  return out
}
