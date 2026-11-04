// Prepared inputs of the proof lesson (PROOF-EXPLORER-MATH section 6): plain exact data for the reusable
// vector-walk domain (src/algebra/walk.ts). Nothing here is a derived result: paths, bounds, the output order
// and the witnesses are recomputed from these inputs wherever they are shown. A case is recognised by its
// mathematical content (vectors and signs in source order), so an edited sign is no longer "the hero".
//
// Pure module: imported by the browser and by the Node server.

import { type Q, q, eq, toJson } from '../../model/rational'
import type { Dim, Vec } from '../../model/linear'
import { type Sign, type WalkInput, signsInSourceOrder, vectorsInSourceOrder, vneg } from '../../algebra/walk'

export const LESSON_ID = 'steinitz-reordering'
export type LessonId = typeof LESSON_ID

export const CASE_IDS = ['hero', 'all-positive', 'line-six', 'open-two'] as const
export type CaseId = (typeof CASE_IDS)[number]

const r = (n: number, d = 1): Q => q(n, d)
/** a = (3/5, 4/5, 0), b = (0, 3/5, 4/5), c = (4/5, 0, 3/5): unit length, linearly independent. */
export const HERO_A: Vec = [r(3, 5), r(4, 5), r(0)]
export const HERO_B: Vec = [r(0), r(3, 5), r(4, 5)]
export const HERO_C: Vec = [r(4, 5), r(0), r(3, 5)]
const E: Vec = [r(1), r(0), r(0)]

/** Source order [a, a, b, b, c, c, -a, -a, -b, -b, -c, -c] as twelve distinct occurrences v0..v11. */
const HERO_VECTORS: Vec[] = [HERO_A, HERO_A, HERO_B, HERO_B, HERO_C, HERO_C, vneg(HERO_A), vneg(HERO_A), vneg(HERO_B), vneg(HERO_B), vneg(HERO_C), vneg(HERO_C)]
/** Display names of the hero occurrences (presentation; identity is the ID). */
export const HERO_NAMES = ['a', 'a', 'b', 'b', 'c', 'c', '−a', '−a', '−b', '−b', '−c', '−c']

function walk(dimension: Dim, vectors: Vec[], signs: Sign[]): WalkInput {
  const ids = vectors.map((_, i) => `v${i}`)
  return { dimension, vectors: vectors.map((coords, i) => ({ id: ids[i]!, coords })), order: ids, signs }
}

export interface PreparedCase {
  id: CaseId
  /** Short title in the lesson ("Hero walk", "Simpler example"). */
  title: string
  /** One line of honest copy shown with the case. */
  note: string
  input: WalkInput
}

export const CASES: Record<CaseId, PreparedCase> = {
  hero: {
    id: 'hero',
    title: 'Closed 3D walk',
    note: 'Twelve unit arrows that return home. Prepared signs: + and − alternate.',
    input: walk(3, HERO_VECTORS, [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1]),
  },
  'all-positive': {
    id: 'all-positive',
    title: 'Same arrows, every sign +',
    note: 'Valid bound · no improvement from these signs.',
    input: walk(3, HERO_VECTORS, Array.from({ length: 12 }, () => 1 as Sign)),
  },
  'line-six': {
    id: 'line-six',
    title: 'Simpler example',
    note: 'Six steps along one line: a collinear teaching case, not a spatial research example.',
    input: walk(3, [E, E, E, vneg(E), vneg(E), vneg(E)], [1, -1, 1, 1, -1, 1]),
  },
  'open-two': {
    id: 'open-two',
    title: 'Missing assumption',
    note: 'The return-to-start assumption is missing. This lemma does not apply.',
    input: walk(3, [E, E], [1, -1]),
  },
}

/** The prepared case with exactly this content (vectors and signs in source order), else null. */
export function caseOf(w: WalkInput): CaseId | null {
  const vs = vectorsInSourceOrder(w)
  const ss = signsInSourceOrder(w)
  for (const id of CASE_IDS) {
    const c = CASES[id].input
    if (c.dimension !== w.dimension || c.vectors.length !== vs.length) continue
    const cv = vectorsInSourceOrder(c)
    const cs = signsInSourceOrder(c)
    if (cv.every((v, i) => v.every((x, k) => eq(x, vs[i]![k]!))) && cs.every((s, i) => s === ss[i])) return id
  }
  return null
}

/** The hero's vectors without signs ("same arrows"): true for the hero and the all-positive variation. */
export function hasHeroVectors(w: WalkInput): boolean {
  const vs = vectorsInSourceOrder(w)
  return w.dimension === 3 && vs.length === 12 && vs.every((v, i) => v.every((x, k) => eq(x, HERO_VECTORS[i]![k]!)))
}

const SUB = '₀₁₂₃₄₅₆₇₈₉'

/** Display names of a walk's occurrences, as the scene labels them: when the stored vectors are the hero's (in the
 *  prepared order) they are a₁, a₂, …, −c₂; any other walk uses the occurrence IDs. Shared by the scene and the
 *  assistant's answers, so both name an arrow the same way. */
export function arrowNames(w: WalkInput): Map<string, string> {
  const hero = CASES.hero.input.vectors
  const isHero =
    w.dimension === 3 &&
    w.vectors.length === hero.length &&
    w.vectors.every((v, i) => v.coords.length === 3 && v.coords.every((x, k) => x.n === hero[i]!.coords[k]!.n && x.d === hero[i]!.coords[k]!.d))
  const out = new Map<string, string>()
  if (isHero) {
    const count = new Map<string, number>()
    for (const n of HERO_NAMES) count.set(n, (count.get(n) ?? 0) + 1)
    const seen = new Map<string, number>()
    w.vectors.forEach((v, i) => {
      const base = HERO_NAMES[i]!
      const k = (seen.get(base) ?? 0) + 1
      seen.set(base, k)
      out.set(v.id, count.get(base)! > 1 ? `${base}${String(k).split('').map((c) => SUB[Number(c)]).join('')}` : base)
    })
  } else for (const v of w.vectors) out.set(v.id, v.id)
  return out
}

/** The JSON form of a prepared case's inputs, as the actions carry it. */
export function caseJson(id: CaseId): { dimension: Dim; vectors: { id: string; coords: { n: string; d: string }[] }[]; order: string[]; signs: Sign[] } {
  const c = CASES[id].input
  return { dimension: c.dimension, vectors: c.vectors.map((v) => ({ id: v.id, coords: v.coords.map(toJson) })), order: [...c.order], signs: [...c.signs] }
}
