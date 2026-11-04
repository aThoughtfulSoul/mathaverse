// Vector-walk scene description (PROOF-EXPLORER-SPEC sections 3-5, PROOF-EXPLORER-MATH sections 2-6).
//
// deriveWalkScene turns validated walk inputs into plain data for the proof-lesson scene: every walk, bound,
// witness and selection comes from ONE call of the exact core (src/algebra/walk.ts deriveWalk). Exact values stay
// exact text (rational `format`, `vtext`); floats appear only as display geometry and as approximation-marked
// lengths. One uniform scale (metres per mathematical unit) serves the source, signed and reordered views of a
// walk; it is chosen from the bounds and actual peaks so that everything fits the bench frame, and it never
// depends on the lesson stage or the selection (the camera and the scale never "sell" a reduction).
//
// Pure module: no three.js, no DOM, no time.

import { type Q, format, tex as qtex, toFloat } from '../../model/rational'
import type { Vec } from '../../model/linear'
import {
  type PrefixWitness, type WalkFacts, type WalkItem, WalkError, approxSqrt, deriveWalk, isqrt, parseWalkItem, representativeEndpoints, vtext,
} from '../../algebra/walk'
import { CASES, arrowNames, caseOf, type CaseId } from '../../lessons/steinitz/cases'
import { LESSON_SOURCE } from '../../lessons/steinitz/source'
import type { WalkOperation, WalkSceneInput, WalkStage } from '../inputs'

/** A display point or vector: floats, mathematical coordinates (2D walks padded with z = 0). */
export type P3 = readonly [number, number, number]

// ------------------------------------------------------------------ layout (presentation constants)

/**
 * Bench-local layout (metres; scene.ts frame: +x right, +y up, +z toward the viewer). The main view (source and
 * reordered walks, one shared origin) sits left of centre; the secondary panel (the auxiliary signed walk) and
 * the text column sit on the right. Both views use the SAME scale; the panel offset is presentation only.
 */
export const WALK_LAYOUT = {
  main: [-0.13, 0.03, -0.06] as P3,
  /** The largest main-view radius (bound ring), metres. */
  mainRadius: 0.265,
  /** The signed panel sits just right of the main view's largest ring (gap, smallest drawn radius, height). */
  panelGap: 0.045,
  panelMinRadius: 0.055,
  panelY: 0.0,
  /** The text column: left edge and top line (caption above the panel, formal lines below it). */
  textX: 0.17,
  textTop: 0.3,
  textBottom: -0.105,
} as const

/**
 * The fixed oblique view of a walk: embed3 (z up on screen), then a turn about the vertical (yaw) and a tilt about
 * the horizontal (pitch; positive lifts the far side). For 3D walks a 28° turn and 4° tilt keep the x direction
 * and the hero's (1,1,1) excursion close to the picture plane while the hero's loop stays free of self-overlap in
 * projection; 2D walks lie in the z = 0 plane, turned to face the seated viewer. Fixed per dimension: never
 * chosen per walk.
 */
export const WALK_TILT = {
  3: { yaw: (-28 * Math.PI) / 180, pitch: (4 * Math.PI) / 180 },
  2: { yaw: 0, pitch: Math.PI / 2 - 0.16 },
} as const

export interface WalkView {
  /** Metres per mathematical unit: one value for every view of this walk. */
  scale: number
  yaw: number
  pitch: number
  main: P3
  panel: P3
  /** What fixed the scale: always the main view (the panel follows at the same scale, beside it). */
  scaleFrom: 'main'
  /** Largest radii in units (bounds and peaks) that the layout had to fit. */
  mainExtent: number
  panelExtent: number
}

/** Bench-local direction of a mathematical vector (embed3, then the fixed turn and tilt, then the scale). */
export function benchVector(view: Pick<WalkView, 'scale' | 'yaw' | 'pitch'>, p: P3): [number, number, number] {
  // embed3(x, y, z) = (x, z, -y)
  const X = p[0]
  const Y = p[2]
  const Z = -p[1]
  const cy = Math.cos(view.yaw)
  const sy = Math.sin(view.yaw)
  const x1 = X * cy + Z * sy
  const z1 = -X * sy + Z * cy
  const cp = Math.cos(view.pitch)
  const sp = Math.sin(view.pitch)
  const y2 = Y * cp - z1 * sp
  const z2 = Y * sp + z1 * cp
  return [x1 * view.scale, y2 * view.scale, z2 * view.scale]
}

/** Bench-local position of a mathematical point in the main view or the signed panel. */
export function benchPoint(view: WalkView, which: 'main' | 'panel', p: P3): [number, number, number] {
  const o = which === 'main' ? view.main : view.panel
  const v = benchVector(view, p)
  return [o[0] + v[0], o[1] + v[1], o[2] + v[2]]
}

// ------------------------------------------------------------------ description types

export interface WalkPointDesc {
  /** Prefix length (0..N). */
  index: number
  p: P3
  /** Exact coordinates, e.g. "(7/5, 7/5, 7/5)". */
  text: string
  /** Exact squared norm, e.g. "147/25". */
  norm2: string
  /** Length for display: exact when the squared norm is a rational square ("2"), else "≈ 2.425". */
  length: string
  approx: number
}

export interface WalkOccurrenceDesc {
  id: string
  /** Display name: hero names with an ordinal ("a₁", "−c₂"), otherwise the occurrence ID. */
  name: string
  /** Position in the source order (0-based) and in the output order. */
  source: number
  output: number
  sign: 1 | -1
  /** Display floats (mathematical coordinates) and the exact vector. */
  vec: P3
  text: string
  /** A zero vector: drawn as an identity marker, never with a normalized direction. */
  zero: boolean
}

export interface WitnessDesc {
  k: number
  j: number
  branch: 'positive' | 'negative'
  /** The two half-sized resultants, drawn head to tail from the origin: positive [U_j/2, S_j/2], negative [S_j/2, -U_j/2]. */
  halves: readonly [P3, P3]
  halvesText: readonly [string, string]
  /** Short names of the halves ("½U₅", "½S₅" / "½S₆", "−½U₆"). */
  halvesName: readonly [string, string]
  /** Their sum; equal to W_k exactly when the residual is zero. */
  halfSum: P3
  /** The residual T (zero vector in the positive branch and whenever the walk returns home). */
  residual: P3
  residualZero: boolean
  residualText: string
  /** Source positions counted in P_j (positive) or M_j (negative), and their occurrence IDs. */
  counted: readonly number[]
  countedIds: readonly string[]
  /** W_k = T + halfSum holds exactly (always); W_k = halfSum exactly (the zero-sum form). */
  identityHolds: boolean
  zeroSumFormHolds: boolean
  withinBound: boolean
  /** Exact |W_k|^2, |U_j|^2, |S_j|^2. */
  wNorm2: string
  uNorm2: string
  sNorm2: string
  /** The matching identity in plain words and in TeX. */
  identity: string
}

export interface BoundDesc {
  /** Exact value as text ("5", "3/2") and as a short decimal label ("5", "1.5", exact for halves). */
  text: string
  decimal: string
  value: number
}

export interface PeakDesc {
  /** Prefix index attaining the peak (first one). */
  at: number
  norm2: string
  /** "≈ 4.850" or "= 1" (exact square). */
  length: string
  approx: number
}

/** One line of text: plain always, TeX when the line is mathematics (shown with Show mathematics). */
export interface TextLine {
  plain: string
  tex?: string
}

export interface StageCopy {
  /** Settled caption (1-3 short lines). */
  lines: readonly string[]
  /** Caption while the construction is running (the bound is asserted only once the settled state shows). */
  moving: readonly string[]
  /** Formal annotations (Show mathematics). */
  details: readonly TextLine[]
}

export type WalkSelection =
  | { kind: 'none' }
  | { kind: 'invalid'; item: string; error: string }
  | { kind: 'source' | 'signed' | 'reordered'; index: number; item: string }
  | { kind: 'vector'; id: string; item: string }

export interface WalkDesc {
  layout: 'walk'
  experimentId: string
  revision: number
  mathRevision: number
  lesson: 'steinitz-reordering' | null
  /** The prepared case with exactly this content (vectors and signs), else null: captions stay honest. */
  caseId: CaseId | null
  caseTitle: string
  caseNote: string | null
  dimension: 2 | 3
  n: number
  /** Occurrences in source order. */
  occurrences: readonly WalkOccurrenceDesc[]
  sourceIds: readonly string[]
  reorderedIds: readonly string[]
  /** Output order as source positions: positives in source order, then negatives in reverse. */
  permutation: readonly number[]
  positive: readonly number[]
  negative: readonly number[]
  /** Prefix points: source U_j, auxiliary signed S_j, reordered W_k (index 0..N). */
  source: readonly WalkPointDesc[]
  signed: readonly WalkPointDesc[]
  reordered: readonly WalkPointDesc[]
  total: { p: P3; text: string; zero: boolean }
  bounds: { B: BoundDesc; D: BoundDesc; R: BoundDesc; comparison: 'better' | 'same' | 'worse' }
  peaks: { source: PeakDesc; signed: PeakDesc; reordered: PeakDesc }
  lemmaApplicable: boolean
  boundHolds: boolean
  firstFailure: number | null
  allInUnitBall: boolean
  witnesses: readonly WitnessDesc[]
  /** Representative endpoints of each branch (hero: k = 3 and k = 9). */
  representative: { positive: number | null; negative: number | null }
  selection: WalkSelection
  /** What the bound recipe shows (no recipe: everything). */
  show: { reordering: boolean; bounds: boolean; correspondence: boolean }
  recipe: { id: string; name: string; kinds: WalkOperation['kind'][] } | null
  view: WalkView
  /** Copy for labels and captions (derived from the exact facts; never "maximum distance" for a bound). */
  labels: {
    origin: string
    B: string
    D: string
    R: string
    sourcePeak: string
    signedPeak: string
    reorderedPeak: string
    panel: string
    total: string
    /** "2 exceeds 1.5" when a reordered prefix leaves the proposed bound, else null. */
    failure: string | null
    prompt: string
  }
  copy: Record<WalkStage, StageCopy>
  /** The hypotheses list of the Assumptions step (plain lines, each with its truth). */
  hypotheses: readonly { text: string; holds: boolean | null }[]
  /** Per reordered endpoint k: the Why copy (lines and details) for that selection. */
  why: readonly StageCopy[]
  /** The source lemma (trusted lesson metadata), or null for a plain vector walk. */
  sourceLemma: string | null
}

// ------------------------------------------------------------------ helpers

const SUB = '₀₁₂₃₄₅₆₇₈₉'
/** Unicode subscript digits ("12" -> "₁₂"). */
export const sub = (n: number): string => String(n).split('').map((c) => SUB[Number(c)] ?? c).join('')
const MINUS = '−'

const float3 = (v: Vec): P3 => [toFloat(v[0]!), toFloat(v[1]!), v.length > 2 ? toFloat(v[2]!) : 0]

/** Exact square root of a non-negative rational when it is a rational square, else null. */
export function exactSqrt(a: Q): Q | null {
  if (a.n < 0n) return null
  const rn = isqrt(a.n)
  const rd = isqrt(a.d)
  return rn * rn === a.n && rd * rd === a.d ? { n: rn, d: rd } : null
}

/** A length for display: exact when possible, else a three-decimal approximation marked with ≈. */
export function lengthText(norm2: Q): string {
  const r = exactSqrt(norm2)
  if (r) return `= ${decimalOrFraction(r)}`
  return `≈ ${approxSqrt(norm2).toFixed(3)}`
}

/** Exact decimal for integers and halves/quarters/fifths... when finite and short; else the fraction. */
function decimalOrFraction(a: Q): string {
  if (a.d === 1n) return a.n.toString()
  let d = a.d
  while (d % 2n === 0n) d /= 2n
  while (d % 5n === 0n) d /= 5n
  if (d !== 1n) return format(a)
  const s = (Number(a.n) / Number(a.d)).toString()
  return s.length <= 7 ? s : format(a)
}

const signWord = (s: 1 | -1) => (s === 1 ? '+' : MINUS)

/** Display names: the hero's (stored order identical to the prepared hero vectors) with ordinals; else IDs. */
const occurrenceNames = (input: WalkSceneInput): Map<string, string> => arrowNames(input.walk)

function point(index: number, v: Vec, n2: Q): WalkPointDesc {
  return { index, p: float3(v), text: vtext(v), norm2: format(n2), length: lengthText(n2), approx: approxSqrt(n2) }
}

function bound(value: Q): BoundDesc {
  return { text: format(value), decimal: decimalOrFraction(value), value: toFloat(value) }
}

function peak(at: number, n2: Q): PeakDesc {
  return { at, norm2: format(n2), length: lengthText(n2), approx: approxSqrt(n2) }
}

/** TeX of an exact vector: "(\tfrac{7}{5}, \tfrac{7}{5}, \tfrac{7}{5})". */
const vtex = (v: Vec): string => `(${v.map(qtex).join(',\\ ')})`

function selectionOf(input: WalkSceneInput): WalkSelection {
  const item = input.item
  if (item === null) return { kind: 'none' }
  let parsed: WalkItem | null
  try {
    parsed = parseWalkItem(item, input.walk)
  } catch (e) {
    return { kind: 'invalid', item, error: e instanceof WalkError ? e.message : String(e) }
  }
  if (!parsed) return { kind: 'none' }
  return parsed.kind === 'vector' ? { kind: 'vector', id: parsed.id, item } : { kind: parsed.kind, index: parsed.index, item }
}

/** The uniform scale: the largest of B, R and the actual peaks fits the main radius, D and the signed peak the panel. */
export function chooseView(f: Pick<WalkFacts, 'B' | 'D' | 'R' | 'sourcePeak2' | 'signedPeak2' | 'reorderedPeak2' | 'dimension'>): WalkView {
  // The main view fixes the scale: B and the source peak never depend on the signs, and R or the reordered peak
  // exceed B only when D > B (or the walk does not return home). A sign edit therefore keeps the scale unless the
  // signed walk outgrows the source walk. The signed panel grows beside the main view at the same scale; when the
  // signed walk is as large as the source walk (all signs +) it reaches past the nominal right edge (x ≈ 0.71).
  const mainExtent = Math.max(Number(f.B), toFloat(f.R), approxSqrt(f.sourcePeak2), approxSqrt(f.reorderedPeak2))
  const panelExtent = Math.max(Number(f.D), approxSqrt(f.signedPeak2))
  const L = WALK_LAYOUT
  const scale = mainExtent > 0 ? L.mainRadius / mainExtent : L.mainRadius
  const tilt = WALK_TILT[f.dimension]
  // Presentation offset only: the panel sits beside the main view's largest ring, at the same scale.
  const panelR = Math.max(panelExtent * scale, L.panelMinRadius)
  const panel: P3 = [L.main[0] + Math.max(mainExtent * scale, L.panelMinRadius) + L.panelGap + panelR, L.panelY, L.main[2]]
  return { scale, yaw: tilt.yaw, pitch: tilt.pitch, main: L.main, panel, scaleFrom: 'main', mainExtent, panelExtent }
}

// ------------------------------------------------------------------ derivation

/** Derive the scene description of a vector walk. Throws WalkError for invalid walk data (the planner rejects it). */
export function deriveWalkScene(input: WalkSceneInput): WalkDesc {
  const f = deriveWalk(input.walk)
  const names = occurrenceNames(input)
  const n = f.n
  const outputOf = new Map(f.permutation.map((src, t) => [src, t]))
  const occurrences: WalkOccurrenceDesc[] = f.ids.map((id, i) => ({
    id,
    name: names.get(id)!,
    source: i,
    output: outputOf.get(i)!,
    sign: f.signs[i]!,
    vec: float3(f.vectors[i]!),
    text: vtext(f.vectors[i]!),
    zero: f.vectors[i]!.every((x) => x.n === 0n),
  }))
  const nameAt = (i: number) => occurrences[i]!.name
  const caseId = caseOf(input.walk)
  const prepared = caseId ? CASES[caseId] : null
  const B = bound({ n: f.B, d: 1n })
  const D = bound({ n: f.D, d: 1n })
  const R = bound(f.R)
  const sourcePeak = peak(f.sourcePeakAt, f.sourcePeak2)
  const signedPeak = peak(f.signedPeakAt, f.signedPeak2)
  const reorderedPeak = peak(f.reorderedPeakAt, f.reorderedPeak2)
  const ops = input.recipe?.operations ?? null
  const show = {
    reordering: ops ? ops.some((o) => o.kind === 'walk_reordering') : true,
    bounds: ops ? ops.some((o) => o.kind === 'walk_bounds') : true,
    correspondence: ops ? ops.some((o) => o.kind === 'prefix_correspondence') : true,
  }
  const RLabel = f.lemmaApplicable ? `new bound ${R.decimal}` : `proposed bound ${R.decimal}`
  const failure = f.firstFailure === null ? null : `${stripEq(lengthText(f.wNorm2[f.firstFailure]!))} exceeds ${R.decimal}`
  const totalText = vtext(f.total)

  const witnesses: WitnessDesc[] = f.witnesses.map((w) => witnessDesc(f, w, occurrences))
  const why = witnesses.map((w) => whyCopy(f, w, B, D, R, input.lesson !== null))

  const labels = {
    origin: 'home',
    B: `source bound ${B.decimal}`,
    D: `signed bound ${D.decimal}`,
    R: RLabel,
    sourcePeak: `peak ${sourcePeak.length}`,
    signedPeak: `peak ${signedPeak.length}`,
    reorderedPeak: `peak ${reorderedPeak.length}`,
    panel: 'auxiliary signed walk',
    total: f.zeroSum ? `total = ${totalText} · returns home` : `T = ${totalText} · total ≠ 0`,
    failure,
    prompt: 'Select an endpoint',
  }

  const preparedSigns = caseId === 'hero' ? '(prepared signs)' : '(these signs)'
  const cmpLine =
    f.comparison === 'better' ? `Source bound ${B.decimal}, same scale.` : f.comparison === 'same' ? 'Valid bound · no improvement' : `Valid, but weaker than ${B.decimal}`
  const settledReorder = !f.lemmaApplicable
    ? ['Same arrows, new order', `Proposed bound ${R.decimal} is not`, 'guaranteed: no return home']
    : ['Same arrows, new order:', '+ in order, then − reversed.', `Every endpoint within ${R.decimal}.`, cmpLine]
  const copy: Record<WalkStage, StageCopy> = {
    walk: {
      lines: f.zeroSum
        ? [`Source walk: ${n} arrow${n === 1 ? '' : 's'}`, 'It returns home at the end,', `yet gets ${stripEq(sourcePeak.length)} away.`]
        : [`Source walk: ${n} arrow${n === 1 ? '' : 's'}`, 'It does not return home:', `it ends at ${totalText}.`],
      moving: ['Tracing the source walk…'],
      details: [
        { plain: `peak |U${sub(f.sourcePeakAt)}|² = ${sourcePeak.norm2}, |U${sub(f.sourcePeakAt)}| ${sourcePeak.length}` },
        { plain: `source bound B = ${B.text}: least whole number with B² ≥ every |U_j|²` },
        { plain: `total U${sub(n)} = ${totalText}` },
      ],
    },
    signs: {
      lines: ['Signs label the same arrows.', 'Signed copies: − copies flip.', `Signed bound ${D.decimal} ${preparedSigns}`],
      moving: ['Labelling the arrows…', 'then building the signed walk'],
      details: [
        { plain: `signs in source order: ${f.signs.map(signWord).join(' ')}` },
        { plain: `peak |S${sub(f.signedPeakAt)}|² = ${signedPeak.norm2}, |S${sub(f.signedPeakAt)}| ${signedPeak.length}` },
        { plain: `signed bound D = ${D.text}` },
      ],
    },
    reorder: {
      lines: settledReorder,
      moving: ['Showing the rearrangement…', 'Arrows translate: no flips.'],
      details: [
        { plain: `new order: ${f.permutation.map(nameAt).join(' ')}` },
        { plain: `peak |W${sub(f.reorderedPeakAt)}|² = ${reorderedPeak.norm2}, |W${sub(f.reorderedPeakAt)}| ${reorderedPeak.length}` },
        { plain: `R = (B + D)/2 = (${B.text} + ${D.text})/2 = ${R.text}` },
      ],
    },
    why: { lines: ['Select an endpoint', 'Pick a dot Wₖ of the new walk', `(k = 0 to ${n})`], moving: ['Select an endpoint'], details: [] },
    assumptions: f.zeroSum
      ? {
          lines: ['The hypotheses hold,', 'so every reordered prefix', `is within new bound ${R.decimal}.`],
          moving: ['Checking the hypotheses…'],
          details: [{ plain: `total = ${totalText}` }, { plain: `R = (B + D)/2 = ${R.text}` }],
        }
      : {
          lines: ['Return-to-start is missing:', 'this lemma does not apply.', failure ? `Here, ${failure}.` : 'The bound holds by chance.'],
          moving: ['Dropping return-to-start…'],
          details: [
            { plain: `T = ${totalText} ≠ 0` },
            ...(f.firstFailure !== null ? [{ plain: `|W${sub(f.firstFailure)}|² = ${format(f.wNorm2[f.firstFailure]!)} > ${format({ n: f.R.n * f.R.n, d: f.R.d * f.R.d })} = R²` }] : []),
            { plain: `W_k = T + (S_j − U_j)/2: dropping T would be wrong` },
          ],
        },
  }

  const hypotheses = [
    { text: f.zeroSum ? `Returns home: total = ${totalText}` : `Returns home? No: T = ${totalText}`, holds: f.zeroSum },
    { text: `Source prefixes within ${B.decimal}`, holds: true },
    { text: `Signed prefixes within ${D.decimal}`, holds: true },
    {
      text: f.allInUnitBall ? 'Steps ≤ 1: full theorem only' : 'Step lengths: not assumed here',
      holds: null,
    },
  ]

  return {
    layout: 'walk',
    experimentId: input.experimentId,
    revision: input.revision,
    mathRevision: input.mathRevision,
    lesson: input.lesson,
    caseId,
    caseTitle: prepared ? prepared.title : `Vector walk · ${n} arrow${n === 1 ? '' : 's'}`,
    caseNote: prepared ? prepared.note : null,
    dimension: f.dimension,
    n,
    occurrences,
    sourceIds: [...f.ids],
    reorderedIds: [...f.reorderedIds],
    permutation: [...f.permutation],
    positive: [...f.positive],
    negative: [...f.negative],
    source: f.U.map((v, j) => point(j, v, f.uNorm2[j]!)),
    signed: f.S.map((v, j) => point(j, v, f.sNorm2[j]!)),
    reordered: f.W.map((v, k) => point(k, v, f.wNorm2[k]!)),
    total: { p: float3(f.total), text: totalText, zero: f.zeroSum },
    bounds: { B, D, R, comparison: f.comparison },
    peaks: { source: sourcePeak, signed: signedPeak, reordered: reorderedPeak },
    lemmaApplicable: f.lemmaApplicable,
    boundHolds: f.boundHolds,
    firstFailure: f.firstFailure,
    allInUnitBall: f.allInUnitBall,
    witnesses,
    representative: representativeEndpoints(f),
    selection: selectionOf(input),
    show,
    recipe: input.recipe ? { id: input.recipe.id, name: input.recipe.name, kinds: input.recipe.operations.map((o) => o.kind) } : null,
    view: chooseView(f),
    labels,
    copy,
    hypotheses,
    why,
    sourceLemma: input.lesson === 'steinitz-reordering' ? LESSON_SOURCE.declaration.name : null,
  }
}

const stripEq = (s: string) => s.replace(/^= /, '')

function witnessDesc(f: WalkFacts, w: PrefixWitness, occ: readonly WalkOccurrenceDesc[]): WitnessDesc {
  const j = sub(w.j)
  const k = sub(w.k)
  const halvesName: [string, string] = w.branch === 'positive' ? [`½U${j}`, `½S${j}`] : [`½S${j}`, `${MINUS}½U${j}`]
  const residualZero = w.residual.every((x) => x.n === 0n)
  const identity =
    w.branch === 'positive'
      ? `W${k} = (U${j} + S${j})/2`
      : residualZero && f.zeroSum
        ? `W${k} = (S${j} − U${j})/2`
        : `W${k} = T + (S${j} − U${j})/2`
  return {
    k: w.k,
    j: w.j,
    branch: w.branch,
    halves: [float3(w.halves[0]), float3(w.halves[1])],
    halvesText: [vtext(w.halves[0]), vtext(w.halves[1])],
    halvesName,
    halfSum: float3(w.halfSum),
    residual: float3(w.residual),
    residualZero,
    residualText: vtext(w.residual),
    counted: [...w.counted],
    countedIds: w.counted.map((i) => occ[i]!.id),
    identityHolds: w.identityHolds,
    zeroSumFormHolds: w.zeroSumFormHolds,
    withinBound: w.withinBound,
    wNorm2: format(w.wNorm2),
    uNorm2: format(f.uNorm2[w.j]!),
    sNorm2: format(f.sNorm2[w.j]!),
    identity,
  }
}

/** The Why copy for endpoint k: caption lines and the formal lines (equation, exact values, norm chain). */
function whyCopy(f: WalkFacts, w: WitnessDesc, B: BoundDesc, D: BoundDesc, R: BoundDesc, lesson: boolean): StageCopy {
  const k = sub(w.k)
  const j = sub(w.j)
  const kt = `{${w.k}}`
  const jt = `{${w.j}}`
  const Wk = f.W[w.k]!
  const Uj = f.U[w.j]!
  const Sj = f.S[w.j]!
  const R2 = { n: f.R.n * f.R.n, d: f.R.d * f.R.d }
  const halfB = format({ n: f.B, d: 2n })
  const halfD = format({ n: f.D, d: 2n })
  const part = w.branch === 'positive' ? '+ part' : '− part'
  const withT = !(w.residualZero && f.zeroSum) && w.branch === 'negative'
  const lines: string[] = [
    `Why W${k}: witness j = ${w.j}, ${part}`,
    w.branch === 'positive' ? `W${k} = ½U${j} + ½S${j}` : withT ? `W${k} = T + ½S${j} − ½U${j}` : `W${k} = ½S${j} − ½U${j}`,
  ]
  if (withT) lines.push(`T ≠ 0: the halves miss W${k}`)
  else lines.push(`|W${k}| ≤ ${halfB} + ${halfD} = ${R.decimal}`)
  const details: TextLine[] = []
  if (w.branch === 'positive') {
    details.push({ plain: `W${k} = (U${j} + S${j})/2`, tex: `W_${kt} = \\tfrac{1}{2}\\,(U_${jt} + S_${jt})` })
    details.push({ plain: `${vtext(Wk)} = ½[${vtext(Uj)} + ${vtext(Sj)}]`, tex: `${vtex(Wk)} = \\tfrac{1}{2}\\,[${vtex(Uj)} + ${vtex(Sj)}]` })
  } else if (!withT) {
    details.push({ plain: `W${k} = (S${j} − U${j})/2`, tex: `W_${kt} = \\tfrac{1}{2}\\,(S_${jt} - U_${jt})` })
    details.push({ plain: `${vtext(Wk)} = ½[${vtext(Sj)} − ${vtext(Uj)}]`, tex: `${vtex(Wk)} = \\tfrac{1}{2}\\,[${vtex(Sj)} - ${vtex(Uj)}]` })
  } else {
    details.push({ plain: `W${k} = T + (S${j} − U${j})/2`, tex: `W_${kt} = T + \\tfrac{1}{2}\\,(S_${jt} - U_${jt})` })
    details.push({ plain: `${vtext(Wk)} = ${vtext(f.total)} + ½[${vtext(Sj)} − ${vtext(Uj)}]`, tex: `${vtex(Wk)} = ${vtex(f.total)} + \\tfrac{1}{2}\\,[${vtex(Sj)} - ${vtex(Uj)}]` })
  }
  if (!withT) {
    const inner = w.branch === 'positive' ? `\\lVert U_${jt}\\rVert + \\lVert S_${jt}\\rVert` : `\\lVert S_${jt}\\rVert + \\lVert U_${jt}\\rVert`
    details.push({
      plain: `|W${k}| ≤ ½(|U${j}| + |S${j}|) ≤ (${B.text} + ${D.text})/2 = ${R.text}`,
      tex: `\\lVert W_${kt}\\rVert \\le \\tfrac{1}{2}(${inner}) \\le \\tfrac{${B.text} + ${D.text}}{2} = ${qtex(f.R)}`,
    })
  } else {
    details.push({ plain: 'T ≠ 0: the triangle inequality still holds, but T cannot be dropped, so (B + D)/2 is not guaranteed here' })
  }
  const cmpWord = w.withinBound ? '≤' : '>'
  details.push({ plain: `|W${k}|² = ${w.wNorm2} ${cmpWord} ${format(R2)} = R²`, tex: `\\lVert W_${kt}\\rVert^{2} = ${qtex(f.wNorm2[w.k]!)} ${w.withinBound ? '\\le' : '>'} ${qtex(R2)} = R^{2}` })
  if (lesson) details.push({ plain: `source lemma: ${LESSON_SOURCE.declaration.name.split('.').pop()}` })
  return { lines, moving: [`Why W${k}: building the two halves`], details }
}
