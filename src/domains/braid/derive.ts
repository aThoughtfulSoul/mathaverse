// deriveBraid: the braid scene's plain description, derived deterministically from the exact scene input
// (no three.js objects, no time). Every mathematical value comes from src/algebra/braid.ts: crossing
// interpretation (positionsBefore), endpoint permutation, exponent sum, the rewrite record and the
// supported-check status. Geometry is not described here; the scene derives it from the words.

import {
  type BraidStatus, type BraidVerdict, type Generator, type RewriteRule, type RewriteStep, BraidError, MAX_BRAID_LENGTH, STRAND_IDS,
  applyRewrite, braidStatus, endpointPermutation, exponentSum, positionsBefore, wordEq, wordTex, wordText,
} from '../../algebra/braid'
import type { BraidSceneInput, Item } from '../inputs'
import type { StrandId } from './constants'

export interface BraidCrossingDesc {
  /** 0-based index into the word (chronological). */
  index: number
  generator: Generator
  /** The neighbouring current positions it acts on (0-based, left to right). */
  positions: [number, number]
  /** Strand identities at those positions before the crossing. */
  left: StrandId
  right: StrandId
  /** Positive: the left strand passes over (nearer the viewer); negative: under. */
  over: StrandId
  under: StrandId
  tex: string
  text: string
}

export interface BraidWordDesc {
  role: 'word' | 'compare'
  word: Generator[]
  tex: string
  text: string
  crossings: BraidCrossingDesc[]
  /** positionsBefore(word)[k][p]: strand (by starting position) at position p before crossing k, k = 0..n. */
  positions: number[][]
  /** endpointPermutation(word): start position -> end position. */
  endpoint: number[]
  /** Identity arriving at each end position, left to right. */
  arrival: StrandId[]
  exponentSum: number
  /** "a b c -> c b a, E = 3" as TeX and plain text. */
  invariantsTex: string
  invariantsText: string
}

export interface BraidOptionDesc {
  /** Stable pick ID ("rewrite:cancel_pair:2"). */
  id: string
  rule: RewriteRule
  at: number
  generator: Generator | null
  /** Plate label (TeX) and the hover hint (plain). */
  tex: string
  hint: string
}

export interface BraidDesc {
  layout: 'braid'
  experimentId: string
  revision: number
  mathRevision: number
  main: BraidWordDesc
  /** The comparison braid when one is set and the recipe shows it. */
  compare: BraidWordDesc | null
  origin: Generator[]
  rewrites: RewriteStep[]
  status: BraidStatus
  verdict: BraidVerdict | null
  /** In-scene status line (plain). */
  statusText: string
  /** One plain line for the controls panel (status()). */
  summary: string
  item: Item
  /** The selected crossing of the main word (validated against it), or null. */
  selectedCrossing: number | null
  selectedStrand: StrandId | null
  /** Supported rewrites whose span matches at the selected crossing (checked with applyRewrite). */
  options: BraidOptionDesc[]
  /** Append is allowed (the word has fewer than MAX_BRAID_LENGTH crossings). */
  canAppend: boolean
  show: { compare: boolean; invariants: boolean }
  /** The viewing convention stated once in the scene. */
  convention: string
}

export const CONVENTION = 'Time runs downward. σ1 crosses places 1 and 2, σ2 places 2 and 3: the left strand passes in front (inverse: behind).'

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
const count = (n: number): string => NUMBER_WORDS[n] ?? String(n)
const plural = (n: number, w: string): string => `${count(n)} ${w}${n === 1 ? '' : 's'}`
const arrivalText = (a: readonly string[]): string => a.join(' ')

export function describeWord(word: readonly Generator[], role: 'word' | 'compare'): BraidWordDesc {
  const positions = positionsBefore(word)
  const crossings = word.map((g, k): BraidCrossingDesc => {
    const i = Math.abs(g)
    const left = STRAND_IDS[positions[k]![i - 1]!]!
    const right = STRAND_IDS[positions[k]![i]!]!
    return {
      index: k,
      generator: g,
      positions: [i - 1, i],
      left,
      right,
      over: g > 0 ? left : right,
      under: g > 0 ? right : left,
      tex: wordTex([g]),
      text: wordText([g]),
    }
  })
  const endpoint = [...endpointPermutation(word)]
  const arrival = positions[word.length]!.map((s) => STRAND_IDS[s]!)
  const E = exponentSum(word)
  return {
    role,
    word: [...word],
    tex: wordTex(word),
    text: wordText(word),
    crossings,
    positions,
    endpoint,
    arrival,
    exponentSum: E,
    invariantsTex: `a\\,b\\,c\\;\\mapsto\\;${arrival.join('\\,')}\\qquad E=${E}`,
    invariantsText: `ends ${arrivalText(arrival)}, E = ${E}`,
  }
}

/** Rewrites offered at crossing k of w: only spans that match there (each checked with applyRewrite). */
export function rewriteOptions(w: readonly Generator[], k: number): BraidOptionDesc[] {
  const n = w.length
  if (k < 0 || k >= n) return []
  const out: BraidOptionDesc[] = []
  const add = (rule: RewriteRule, at: number, generator: Generator | null, tex: string, hint: string) => {
    try {
      applyRewrite(w, { rule, at, generator })
    } catch (e) {
      if (e instanceof BraidError) return
      throw e
    }
    out.push({ id: `rewrite:${rule}:${at}${generator === null ? '' : `:${generator}`}`, rule, at, generator, tex, hint })
  }
  const pairTex = (g: Generator) => wordTex([g, -g as Generator])
  if (k + 1 < n && w[k] === -w[k + 1]!) add('cancel_pair', k, null, `${pairTex(w[k]!)}\\;\\to\\;e`, `Cancel ${wordText([w[k]!, w[k + 1]!])} (crossings ${k + 1}-${k + 2})`)
  if (k >= 1 && w[k - 1] === -w[k]!) add('cancel_pair', k - 1, null, `${pairTex(w[k - 1]!)}\\;\\to\\;e`, `Cancel ${wordText([w[k - 1]!, w[k]!])} (crossings ${k}-${k + 1})`)
  if (k + 3 <= n) {
    const span = w.slice(k, k + 3)
    const other = wordEq(span, [1, 2, 1]) ? [2, 1, 2] : wordEq(span, [2, 1, 2]) ? [1, 2, 1] : null
    if (other) add('braid_relation', k, null, `${wordTex(span)}\\;\\to\\;${wordTex(other)}`, `Braid relation: ${wordText(span)} becomes ${wordText(other)} (crossings ${k + 1}-${k + 3})`)
  }
  if (n + 2 <= MAX_BRAID_LENGTH) {
    for (const g of [1, 2] as Generator[]) add('insert_pair', k, g, `e\\;\\to\\;${pairTex(g)}`, `Insert ${wordText([g, -g as Generator])} before crossing ${k + 1}`)
  }
  return out
}

function verdictPhrase(v: BraidVerdict): string {
  if (v.kind === 'identical') return 'identical to the comparison'
  if (v.kind === 'different') return v.invariant === 'exponent_sum' ? 'different from the comparison (exponent sums differ)' : 'different from the comparison (endpoint permutations differ)'
  return 'equality with the comparison not established by the supported checks'
}

/** The in-scene status line and the one-line summary, from braidStatus. */
export function statusLines(origin: readonly Generator[], word: readonly Generator[], rewrites: readonly RewriteStep[], compare: readonly Generator[] | null): { status: BraidStatus; statusText: string; summary: string } {
  const status = braidStatus(origin, word, rewrites, compare)
  const n = rewrites.length
  const wText = wordText(word)
  const v = status.vsCompare
  let statusText: string
  if (v && compare) {
    const cText = wordText(compare)
    if (v.kind === 'identical') {
      statusText = status.originEqualsCompareByRewrites
        ? `Identical to the comparison now; ${wordText(origin)} equals it by ${plural(n, 'supported rewrite')} (checked by supported rewrite rules).`
        : 'Identical words: the same braid.'
    } else if (v.kind === 'different') {
      statusText = v.invariant === 'exponent_sum'
        ? `Different braids: exponent sums ${exponentSum(word)} and ${exponentSum(compare)} differ (the endpoint permutations agree, which alone decides nothing).`
        : `Different braids: the endpoint permutations differ (${arrivalText(describeWord(word, 'word').arrival)} vs ${arrivalText(describeWord(compare, 'compare').arrival)}).`
    } else {
      statusText = `${wText} vs ${cText}: not established by the supported checks (endpoints and E agree; no rewrite links them yet).`
    }
  } else if (n) {
    statusText = `${wText} equals ${wordText(origin)} by ${plural(n, 'supported rewrite')} (checked by supported rewrite rules).`
  } else {
    statusText = word.length ? `${wText}: endpoints and exponent sum computed exactly.` : 'Identity braid: append crossings to build a word.'
  }
  let summary = n ? `${wordText(origin)} → ${wText} by ${plural(n, 'supported rewrite')}` : wText
  if (v && compare) summary += n ? `; ${verdictPhrase(v)}` : ` vs ${wordText(compare)}: ${verdictPhrase(v)}`
  else if (!n) summary += `: E = ${exponentSum(word)}`
  return { status, statusText, summary }
}

function parseItem(item: Item, n: number): { crossing: number | null; strand: StrandId | null } {
  if (typeof item !== 'string') return { crossing: null, strand: null }
  const c = /^crossing:(\d+)$/.exec(item)
  if (c) {
    const k = Number(c[1])
    return { crossing: k < n ? k : null, strand: null }
  }
  const s = /^strand:([abc])$/.exec(item)
  return { crossing: null, strand: s ? (s[1] as StrandId) : null }
}

export function deriveBraid(input: BraidSceneInput): BraidDesc {
  const word = [...input.word]
  const ops = input.recipe?.operations ?? null
  const show = {
    compare: ops ? ops.some((o) => o.kind === 'braid_diagram') : true,
    invariants: ops ? ops.some((o) => o.kind === 'braid_invariants') : true,
  }
  const compareWord = input.compare && show.compare ? [...input.compare] : null
  const { status, statusText, summary } = statusLines(input.origin, word, input.rewrites, compareWord)
  const sel = parseItem(input.item, word.length)
  return {
    layout: 'braid',
    experimentId: input.experimentId,
    revision: input.revision,
    mathRevision: input.mathRevision,
    main: describeWord(word, 'word'),
    compare: compareWord ? describeWord(compareWord, 'compare') : null,
    origin: [...input.origin],
    rewrites: input.rewrites.map((r) => ({ ...r })),
    status,
    verdict: status.vsCompare,
    statusText,
    summary,
    item: input.item,
    selectedCrossing: sel.crossing,
    selectedStrand: sel.strand,
    options: sel.crossing === null ? [] : rewriteOptions(word, sel.crossing),
    canAppend: word.length < MAX_BRAID_LENGTH,
    show,
    convention: CONVENTION,
  }
}
