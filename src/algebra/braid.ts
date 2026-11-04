// Bounded three-strand braid words (FOUR-DEMOS-PARALLEL-HANDOFF section 8), shared by the planner, facts
// and the braid scene. A word is a chronological list of crossings: +i is sigma_i, -i its inverse
// (i = 1, 2). sigma_i acts on the strands at the neighbouring CURRENT positions i-1 and i (0-based, left to
// right); positive takes the currently left strand over the right, negative under. The inverse word reverses
// the list and flips every sign.
//
// Supported exact checks: adjacent inverse cancellation/insertion, the positive braid relation
// [1,2,1] <-> [2,1,2], identical words, and two invariants (endpoint permutation, exponent sum). Disagreeing
// invariants prove two braids different; agreement alone proves nothing ("not established").
//
// Pure module: imported by the browser and by the Node server. It must not import rendering code.

import { type Perm, composeChronological, identityPerm, transposition } from './permutation'

export class BraidError extends Error {
  override name = 'BraidError'
}

export type Generator = -2 | -1 | 1 | 2
export const GENERATORS: readonly Generator[] = [1, 2, -1, -2]
/** Handoff bound: braid word length <= 24 (B3 itself is infinite; only this UI is bounded). */
export const MAX_BRAID_LENGTH = 24
export const STRANDS = 3
/** Strand identities by starting position (presentation names; identity travels with the strand). */
export const STRAND_IDS = ['a', 'b', 'c'] as const

export function isGenerator(x: unknown): x is Generator {
  return x === 1 || x === 2 || x === -1 || x === -2
}

export function checkWord(x: unknown, where = 'word'): Generator[] {
  if (!Array.isArray(x) || x.length > MAX_BRAID_LENGTH) throw new BraidError(`${where}: expected at most ${MAX_BRAID_LENGTH} crossings`)
  x.forEach((g, i) => {
    if (!isGenerator(g)) throw new BraidError(`${where}[${i}]: a crossing is 1, 2, -1 or -2`)
  })
  return [...(x as Generator[])]
}

export function wordEq(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** The inverse braid: reversed order, every sign flipped. */
export function invertWord(w: readonly Generator[]): Generator[] {
  return [...w].reverse().map((g) => -g as Generator)
}

/** Text of a word in chronological order ("σ1 σ2 σ1⁻¹"; "identity" for the empty word). */
export function wordText(w: readonly number[]): string {
  return w.length ? w.map((g) => `σ${Math.abs(g)}${g < 0 ? '⁻¹' : ''}`).join(' ') : 'identity'
}

/** TeX of a word ("\sigma_{1}\sigma_{2}\sigma_{1}^{-1}"; "e" for the empty word). */
export function wordTex(w: readonly number[]): string {
  return w.length ? w.map((g) => `\\sigma_{${Math.abs(g)}}${g < 0 ? '^{-1}' : ''}`).join('\\,') : 'e'
}

// ------------------------------------------------------------------ invariants

/** Endpoint permutation, source position -> destination position, crossings applied chronologically. */
export function endpointPermutation(w: readonly number[]): Perm {
  return composeChronological(w.map((g) => transposition(STRANDS, Math.abs(g) - 1, Math.abs(g))), STRANDS)
}

/** Signed exponent sum E: an invariant of the braid. */
export function exponentSum(w: readonly number[]): number {
  return w.reduce((s, g) => s + Math.sign(g), 0)
}

/** Which strand (by starting position) is at each position before crossing k, for k = 0..length. */
export function positionsBefore(w: readonly number[]): number[][] {
  const out: number[][] = [[...identityPerm(STRANDS)]]
  let at = [...identityPerm(STRANDS)] // at[pos] = strand identity index
  for (const g of w) {
    const i = Math.abs(g) - 1
    at = [...at]
    ;[at[i], at[i + 1]] = [at[i + 1]!, at[i]!]
    out.push(at)
  }
  return out
}

// ------------------------------------------------------------------ supported rewrites

export type RewriteRule = 'cancel_pair' | 'insert_pair' | 'braid_relation'
export const REWRITE_RULES: readonly RewriteRule[] = ['cancel_pair', 'insert_pair', 'braid_relation']

/** One supported local rewrite. `at` is the index of the span's first crossing (insert: the insertion
 * index 0..length). `generator` is the first crossing of the inserted pair; null for the other rules. */
export interface RewriteStep {
  rule: RewriteRule
  at: number
  generator: Generator | null
}

/** Apply one rewrite to a word after checking the span against the current word. Throws BraidError with the
 * reason when it does not match (nothing is ever rewritten approximately). */
export function applyRewrite(w: readonly Generator[], s: RewriteStep): Generator[] {
  const n = w.length
  if (!Number.isInteger(s.at) || s.at < 0) throw new BraidError(`rewrite: position ${s.at} is not a crossing index`)
  switch (s.rule) {
    case 'cancel_pair': {
      if (s.generator !== null) throw new BraidError('cancel_pair: takes no generator')
      if (s.at + 1 >= n) throw new BraidError(`cancel_pair: no adjacent pair at ${s.at}`)
      if (w[s.at]! !== -w[s.at + 1]!) throw new BraidError(`cancel_pair: crossings ${s.at} and ${s.at + 1} (${wordText([w[s.at]!, w[s.at + 1]!])}) are not inverse to each other`)
      return [...w.slice(0, s.at), ...w.slice(s.at + 2)]
    }
    case 'insert_pair': {
      if (!isGenerator(s.generator)) throw new BraidError('insert_pair: needs a generator (1, 2, -1 or -2)')
      if (s.at > n) throw new BraidError(`insert_pair: position ${s.at} is beyond the word`)
      if (n + 2 > MAX_BRAID_LENGTH) throw new BraidError(`insert_pair: the word would exceed ${MAX_BRAID_LENGTH} crossings`)
      return [...w.slice(0, s.at), s.generator, -s.generator as Generator, ...w.slice(s.at)]
    }
    case 'braid_relation': {
      if (s.generator !== null) throw new BraidError('braid_relation: takes no generator')
      if (s.at + 3 > n) throw new BraidError(`braid_relation: no three crossings at ${s.at}`)
      const span = w.slice(s.at, s.at + 3)
      const other = wordEq(span, [1, 2, 1]) ? [2, 1, 2] : wordEq(span, [2, 1, 2]) ? [1, 2, 1] : null
      if (!other) throw new BraidError(`braid_relation: crossings ${s.at}..${s.at + 2} are ${wordText(span)}, not σ1 σ2 σ1 or σ2 σ1 σ2`)
      return [...w.slice(0, s.at), ...(other as Generator[]), ...w.slice(s.at + 3)]
    }
    default:
      throw new BraidError(`rewrite: unknown rule ${JSON.stringify((s as { rule: unknown }).rule)}`)
  }
}

/** Replay a rewrite sequence from an origin word, checking every span against the word it applies to. */
export function replayRewrites(origin: readonly Generator[], steps: readonly RewriteStep[]): Generator[] {
  return steps.reduce<Generator[]>((w, s, i) => {
    try {
      return applyRewrite(w, s)
    } catch (e) {
      throw new BraidError(`rewrite ${i + 1}: ${(e as Error).message}`)
    }
  }, [...origin])
}

// ------------------------------------------------------------------ comparison status

export type BraidVerdict =
  /** The two words are the same list of crossings (exact). */
  | { kind: 'identical' }
  /** An invariant differs, which proves the braids different. */
  | { kind: 'different'; invariant: 'endpoint_permutation' | 'exponent_sum' }
  /** The supported checks do not decide equality ("not established", never "different"). */
  | { kind: 'not_established' }

export function compareWords(a: readonly number[], b: readonly number[]): BraidVerdict {
  if (wordEq(a, b)) return { kind: 'identical' }
  const pa = endpointPermutation(a)
  const pb = endpointPermutation(b)
  if (!pa.every((v, i) => v === pb[i])) return { kind: 'different', invariant: 'endpoint_permutation' }
  if (exponentSum(a) !== exponentSum(b)) return { kind: 'different', invariant: 'exponent_sum' }
  return { kind: 'not_established' }
}

/**
 * What the exact checks establish about the experiment's words:
 * - `rewrites`: the origin word equals the current word by these checked rewrites (null when there are none);
 * - `vsCompare`: the current word against the comparison word (null without one);
 * - `originVsCompare`: when the current word is identical to the comparison word after rewrites, the origin
 *   word equals it "checked by supported rewrite rules".
 */
export interface BraidStatus {
  rewrites: { origin: Generator[]; steps: RewriteStep[] } | null
  vsCompare: BraidVerdict | null
  originEqualsCompareByRewrites: boolean
}

export function braidStatus(origin: readonly Generator[], word: readonly Generator[], steps: readonly RewriteStep[], compare: readonly Generator[] | null): BraidStatus {
  const vsCompare = compare ? compareWords(word, compare) : null
  return {
    rewrites: steps.length ? { origin: [...origin], steps: [...steps] } : null,
    vsCompare,
    originEqualsCompareByRewrites: steps.length > 0 && vsCompare?.kind === 'identical',
  }
}
