// The proof-lesson scene description and its staged timeline (src/domains/walk/derive.ts, pose.ts): the exact
// facts come from the shared core, one uniform scale serves every view and fits the bench, identities and the
// witness correspondence are preserved, bound copy is honest, and the representation rules of PROOF-EXPLORER-SPEC
// section 4 hold at every sampled time (identity arrows never flip; signed copies negate in place; transport only
// translates; the Why construction ends exactly at W_k, with T when T ≠ 0).

import { describe, expect, it } from 'vitest'
import { deriveWalk, type Sign, type WalkInput } from '../../src/algebra/walk'
import { CASES, CASE_IDS } from '../../src/lessons/steinitz/cases'
import type { WalkOperation, WalkSceneInput, WalkStage, SceneRecipe } from '../../src/domains/inputs'
import { WALK_STAGES } from '../../src/domains/inputs'
import { WALK_LAYOUT, benchPoint, benchVector, deriveWalkScene, exactSqrt, lengthText, type WalkDesc } from '../../src/domains/walk/derive'
import { blendPose, composeStage, makePose, stageTiming, selectedWitness, walkGeometry, type Pose } from '../../src/domains/walk/pose'
import { q } from '../../src/model/rational'

const RECIPE: SceneRecipe<WalkOperation> = {
  id: 'r', name: 'Reordering lesson',
  operations: [{ kind: 'walk_reordering', walk: 'walk' }, { kind: 'walk_bounds', walk: 'walk' }, { kind: 'prefix_correspondence', walk: 'walk' }],
}
const input = (walk: WalkInput, item: string | null = null, recipe: SceneRecipe<WalkOperation> | null = RECIPE): WalkSceneInput => ({
  experimentId: 'exp-walk', revision: 1, mathRevision: 1, walk, lesson: 'steinitz-reordering', item, recipe,
})
const scene = (walk: WalkInput, item: string | null = null, recipe: SceneRecipe<WalkOperation> | null = RECIPE) => deriveWalkScene(input(walk, item, recipe))
const flip = (w: WalkInput, id: string): WalkInput => ({ ...w, signs: w.signs.map((s, i) => (w.vectors[i]!.id === id ? (-s as Sign) : s)) })
const hero = CASES.hero.input
const close = (a: readonly number[], b: readonly number[], eps = 1e-9) => a.every((x, i) => Math.abs(x - b[i]!) <= eps)
const add3 = (a: readonly number[], b: readonly number[]) => a.map((x, i) => x + b[i]!)
const sub3 = (a: readonly number[], b: readonly number[]) => a.map((x, i) => x - b[i]!)
const dot3 = (a: readonly number[], b: readonly number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0)
const norm3 = (a: readonly number[]) => Math.sqrt(dot3(a, a))

/** Every displayed string of a description (labels, captions, details, hypotheses). */
function strings(d: WalkDesc): string[] {
  const out: string[] = [...Object.values(d.labels).filter((x): x is string => typeof x === 'string'), d.caseTitle, d.caseNote ?? '']
  for (const c of [...Object.values(d.copy), ...d.why]) out.push(...c.lines, ...c.moving, ...c.details.map((l) => l.plain))
  out.push(...d.hypotheses.map((h) => h.text))
  return out
}

describe('description: exact facts from the shared core', () => {
  it('matches deriveWalk for every prepared case (order, prefixes, bounds, witnesses)', () => {
    for (const id of CASE_IDS) {
      const f = deriveWalk(CASES[id].input)
      const d = scene(CASES[id].input)
      expect(d.caseId).toBe(id)
      expect(d.permutation).toEqual(f.permutation)
      expect(d.reorderedIds).toEqual(f.reorderedIds)
      expect(d.occurrences.map((o) => o.output)).toEqual(f.ids.map((_, i) => f.permutation.indexOf(i)))
      expect(d.bounds.B.text).toBe(f.B.toString())
      expect(d.bounds.D.text).toBe(f.D.toString())
      expect(d.witnesses.map((w) => [w.k, w.j, w.branch])).toEqual(f.witnesses.map((w) => [w.k, w.j, w.branch]))
      expect(d.lemmaApplicable).toBe(f.lemmaApplicable)
      expect(d.boundHolds).toBe(f.boundHolds)
    }
  })

  it('hero copy: source bound 5, signed bound 1, new bound 3; peaks ≈ 4.850 and ≈ 2.425 labelled separately', () => {
    const d = scene(hero)
    expect([d.labels.B, d.labels.D, d.labels.R]).toEqual(['source bound 5', 'signed bound 1', 'new bound 3'])
    expect(d.labels.sourcePeak).toBe('peak ≈ 4.850')
    expect(d.labels.reorderedPeak).toBe('peak ≈ 2.425')
    expect(d.peaks.source.norm2).toBe('588/25')
    expect(d.peaks.reordered.norm2).toBe('147/25')
    expect(d.labels.signedPeak).toBe('peak = 1')
    expect(d.labels.failure).toBeNull()
  })

  it('never calls a bound a maximum distance, and never says the walk shrank', () => {
    for (const id of CASE_IDS) {
      for (const s of strings(scene(CASES[id].input, 'walk:reordered:2'))) {
        expect(s.toLowerCase()).not.toMatch(/maximum distance|max distance|shrinks|shrank/)
      }
    }
  })

  it('the missing assumption: proposed bound 1.5, residual T shown, "2 exceeds 1.5"', () => {
    const d = scene(CASES['open-two'].input, 'walk:reordered:2')
    expect(d.labels.R).toBe('proposed bound 1.5')
    expect(d.labels.failure).toBe('2 exceeds 1.5')
    expect(d.copy.assumptions.lines.join(' ')).toContain('Here, 2 exceeds 1.5.')
    expect(d.total).toMatchObject({ text: '(2, 0, 0)', zero: false })
    const w = d.witnesses[2]!
    expect([w.j, w.branch, w.residualZero, w.zeroSumFormHolds, w.withinBound]).toEqual([0, 'negative', false, false, false])
    expect(w.identity).toBe('W₂ = T + (S₀ − U₀)/2')
    expect(d.hypotheses[0]!.holds).toBe(false)
  })

  it('valid without improvement: the all-positive signs say so', () => {
    const d = scene(CASES['all-positive'].input)
    expect(d.bounds.comparison).toBe('same')
    expect(d.copy.reorder.lines.join(' ')).toContain('no improvement')
    expect(d.permutation).toEqual(d.occurrences.map((_, i) => i))
  })

  it('an edited case is no longer captioned as a prepared one', () => {
    const d = scene(flip(hero, 'v1'))
    expect(d.caseId).toBeNull()
    expect(d.caseTitle).toBe('Vector walk · 12 arrows')
    expect(d.copy.signs.lines.join(' ')).not.toContain('prepared')
  })

  it('exact lengths are exact when the squared norm is a rational square, approximate otherwise', () => {
    expect(exactSqrt(q(9, 4))).toEqual({ n: 3n, d: 2n })
    expect(exactSqrt(q(147, 25))).toBeNull()
    expect(lengthText(q(4))).toBe('= 2')
    expect(lengthText(q(588, 25))).toBe('≈ 4.850')
  })

  it('the Why copy states the matching identity and exact squared comparison', () => {
    const d = scene(hero, 'walk:reordered:3')
    expect(d.why[3]!.details.map((l) => l.plain)).toEqual([
      'W₃ = (U₅ + S₅)/2',
      '(7/5, 7/5, 7/5) = ½[(2, 14/5, 11/5) + (4/5, 0, 3/5)]',
      '|W₃| ≤ ½(|U₅| + |S₅|) ≤ (5 + 1)/2 = 3',
      '|W₃|² = 147/25 ≤ 9 = R²',
      'source lemma: signedOrder_prefix_bound',
    ])
    expect(d.why[9]!.details[0]!.plain).toBe('W₉ = (S₆ − U₆)/2')
    expect(d.witnesses[9]!.halvesName).toEqual(['½S₆', '−½U₆'])
    expect(d.witnesses[9]!.halvesText[0]).toBe('(0, 0, 0)')
  })
})

describe('identity and selection', () => {
  it('hero occurrences keep persistent names with ordinals; other walks use their IDs', () => {
    const d = scene(hero)
    expect(d.occurrences.map((o) => o.name)).toEqual(['a₁', 'a₂', 'b₁', 'b₂', 'c₁', 'c₂', '−a₁', '−a₂', '−b₁', '−b₂', '−c₁', '−c₂'])
    expect(scene(CASES['line-six'].input).occurrences.map((o) => o.name)).toEqual(['v0', 'v1', 'v2', 'v3', 'v4', 'v5'])
  })

  it('names and signs stay with their occurrence when the source order changes', () => {
    const reversed: WalkInput = { ...hero, order: [...hero.order].reverse() }
    const a = scene(hero)
    const b = scene(reversed)
    for (const o of b.occurrences) {
      const same = a.occurrences.find((x) => x.id === o.id)!
      expect([o.name, o.sign, o.text]).toEqual([same.name, same.sign, same.text])
    }
  })

  it('selection items are parsed by the core; invalid items are reported, never clamped', () => {
    expect(scene(hero, 'walk:reordered:3').selection).toEqual({ kind: 'reordered', index: 3, item: 'walk:reordered:3' })
    expect(scene(hero, 'walk:vector:v4').selection).toEqual({ kind: 'vector', id: 'v4', item: 'walk:vector:v4' })
    expect(scene(hero, null).selection).toEqual({ kind: 'none' })
    expect(scene(hero, 'walk:reordered:13').selection.kind).toBe('invalid')
    expect(scene(CASES['open-two'].input, 'walk:source:3').selection.kind).toBe('invalid')
  })

  it('the recipe decides which annotations exist (no recipe: all of them)', () => {
    expect(scene(hero, null, null).show).toEqual({ reordering: true, bounds: true, correspondence: true })
    const plain = scene(hero, 'walk:reordered:3', { id: 'p', name: 'Walk only', operations: [{ kind: 'walk_reordering', walk: 'walk' }] })
    expect(plain.show).toEqual({ reordering: true, bounds: false, correspondence: false })
    expect(selectedWitness(plain)).toBeNull()
  })
})

describe('one uniform scale that fits the bench', () => {
  const inBench = ([x, y, z]: readonly number[]) => x >= -0.5 && x <= 0.52 && y >= -0.245 && y <= 0.325 && z >= -0.25 && z <= 0.15

  it('every prepared case: all prefixes of all three walks and the bound rings fit', () => {
    for (const id of CASE_IDS) {
      const d = scene(CASES[id].input)
      const g = walkGeometry(d)
      for (const p of [...g.src, ...g.rev]) expect(inBench(p), `${id} ${p}`).toBe(true)
      // The signed panel follows at the same scale: within the bench unless the signed walk is as large as the
      // source walk (all signs +, a documented overflow to the right).
      const right = id === 'all-positive' ? 0.75 : 0.5
      for (const p of g.sig) expect(p[0] <= right && inBench([Math.min(p[0], 0.5), p[1], p[2]]), `${id} ${p}`).toBe(true)
      const R = Math.max(d.bounds.B.value, d.bounds.R.value) * d.view.scale
      expect(R).toBeLessThanOrEqual(WALK_LAYOUT.mainRadius + 1e-12)
      expect(g.origin[1] - R).toBeGreaterThanOrEqual(-0.245)
      expect(g.origin[1] + R).toBeLessThanOrEqual(0.325)
      const panelR = Math.max(d.bounds.D.value, d.peaks.signed.approx) * d.view.scale
      expect(g.panelOrigin[0] - panelR).toBeGreaterThan(g.origin[0] + R)
      expect(g.panelOrigin[0] + panelR).toBeLessThanOrEqual(right)
    }
  })

  it('the scale is uniform: bench lengths are |v| × scale in every view', () => {
    const d = scene(hero)
    const g = walkGeometry(d)
    for (const [i, o] of d.occurrences.entries()) {
      const len = norm3(o.vec)
      expect(norm3(g.vecs[i]!)).toBeCloseTo(len * d.view.scale, 12)
      expect(norm3(sub3(g.src[i + 1]!, g.src[i]!))).toBeCloseTo(len * d.view.scale, 12)
      expect(norm3(sub3(g.sig[i + 1]!, g.sig[i]!))).toBeCloseTo(len * d.view.scale, 12)
      expect(norm3(sub3(g.rev[o.output + 1]!, g.rev[o.output]!))).toBeCloseTo(len * d.view.scale, 12)
    }
    // Distances from home are |U_j| × scale (a bound ring radius means the same thing everywhere).
    for (const p of d.source) expect(norm3(sub3(benchPoint(d.view, 'main', p.p), g.origin))).toBeCloseTo(p.approx * d.view.scale, 12)
  })

  it('does not depend on the selection, and a sign edit that keeps R and the new peak within B keeps it', () => {
    const base = scene(hero).view.scale
    for (const item of ['walk:reordered:3', 'walk:reordered:9', 'walk:source:6', 'walk:vector:v2', null]) expect(scene(hero, item).view.scale).toBe(base)
    let kept = 0
    for (const id of hero.order) {
      const d = scene(flip(hero, id))
      if (d.bounds.R.value <= d.bounds.B.value && d.peaks.reordered.approx <= d.bounds.B.value) {
        expect(d.view.scale).toBe(base)
        kept++
      }
    }
    expect(kept).toBe(12)
    expect(scene(CASES['all-positive'].input).view.scale).toBe(base)
  })
})

describe('the staged timeline (pure poses)', () => {
  const S = 0.5
  const samples = (desc: WalkDesc, stage: WalkStage, n = 40) => {
    const dur = stageTiming(desc, stage, S, stage === 'why' ? selectedWitness(desc) : null).duration
    return Array.from({ length: n + 1 }, (_, i) => (dur * i) / n).concat([dur + 1])
  }
  /** The identity arrows are always t·v_i with t in [0, 1]: never flipped, turned or stretched. */
  const expectNeverFlipped = (d: WalkDesc, p: Pose) => {
    const g = walkGeometry(d)
    for (let i = 0; i < d.n; i++) {
      const v = g.vecs[i]!
      const a = p.live[i]!.vec
      const vv = dot3(v, v)
      if (vv === 0) {
        expect(norm3(a)).toBe(0)
        continue
      }
      const t = dot3(a, v) / vv
      expect(t).toBeGreaterThanOrEqual(-1e-12)
      expect(t).toBeLessThanOrEqual(1 + 1e-12)
      expect(norm3(sub3(a, v.map((x) => x * t)))).toBeLessThan(1e-12)
    }
  }

  it('identity arrows never flip, in any stage, at any sampled time, for every case', () => {
    for (const id of CASE_IDS) {
      const d = scene(CASES[id].input, id === 'open-two' ? 'walk:reordered:2' : 'walk:reordered:3')
      const g = walkGeometry(d)
      const p = makePose(d.n)
      for (const stage of WALK_STAGES) for (const t of samples(d, stage)) expectNeverFlipped(d, composeStage(p, d, g, stage, t, S))
    }
  })

  it('settled positions: the source walk at U tails, the reordered walk at W tails, copies signed at S tails', () => {
    for (const id of CASE_IDS) {
      const d = scene(CASES[id].input)
      const g = walkGeometry(d)
      const p = makePose(d.n)
      composeStage(p, d, g, 'walk', 1e9, S)
      for (let i = 0; i < d.n; i++) expect(close(p.live[i]!.tail, g.src[i]!)).toBe(true)
      composeStage(p, d, g, 'signs', 1e9, S)
      for (let i = 0; i < d.n; i++) {
        expect(close(p.copy[i]!.tail, g.sig[i]!)).toBe(true)
        expect(close(p.copy[i]!.vec, g.vecs[i]!.map((x) => x * d.occurrences[i]!.sign))).toBe(true)
        expect(close(add3(p.copy[i]!.tail, p.copy[i]!.vec), g.sig[i + 1]!)).toBe(true)
      }
      composeStage(p, d, g, 'reorder', 1e9, S)
      for (let i = 0; i < d.n; i++) {
        const o = d.occurrences[i]!
        expect(close(p.live[i]!.tail, g.rev[o.output]!)).toBe(true)
        expect(close(add3(p.live[i]!.tail, p.live[i]!.vec), g.rev[o.output + 1]!)).toBe(true)
        expect(close(p.ghost[i]!.tail, g.src[i]!)).toBe(true)
      }
      expect(p.moving).toBe(false)
    }
  })

  it('a negative copy is negated in place: its vector runs from v through zero to −v at a fixed tail', () => {
    const d = scene(hero)
    const g = walkGeometry(d)
    const p = makePose(d.n)
    const i = d.occurrences.findIndex((o) => o.sign === -1)
    let sawZero = false
    let sawPositive = false
    for (const t of samples(d, 'signs', 400)) {
      composeStage(p, d, g, 'signs', t, S)
      const c = p.copy[i]!
      if (c.op <= 0) continue
      expect(close(c.tail, g.sig[i]!)).toBe(true)
      const lambda = dot3(c.vec, g.vecs[i]!) / dot3(g.vecs[i]!, g.vecs[i]!)
      expect(norm3(sub3(c.vec, g.vecs[i]!.map((x) => x * lambda)))).toBeLessThan(1e-12)
      if (lambda > 0.9) sawPositive = true
      if (Math.abs(lambda) < 0.08) sawZero = true
    }
    expect(sawPositive && sawZero).toBe(true)
  })

  it('reordering only translates, and asserts the new bound only once settled', () => {
    const d = scene(hero)
    const g = walkGeometry(d)
    const p = makePose(d.n)
    const tm = stageTiming(d, 'reorder', S, null)
    for (const t of samples(d, 'reorder', 120)) {
      composeStage(p, d, g, 'reorder', t, S)
      for (let i = 0; i < d.n; i++) expect(close(p.live[i]!.vec, g.vecs[i]!)).toBe(true)
      if (t < tm.settle) {
        expect(p.moving).toBe(true)
        expect(p.R.op).toBe(0)
      }
    }
    expect(p.R.op).toBe(1)
  })

  it('Why: the halves run head to tail from home and end exactly at W_k (k = 3, 9; and with T for the open walk)', () => {
    for (const [c, k] of [['hero', 3], ['hero', 9], ['line-six', 2], ['line-six', 5], ['all-positive', 6], ['open-two', 2]] as const) {
      const d = scene(CASES[c].input, `walk:reordered:${k}`)
      const g = walkGeometry(d)
      const p = makePose(d.n)
      composeStage(p, d, g, 'why', 1e9, S)
      const w = d.witnesses[k]!
      expect(close(p.half[0].tail, g.origin)).toBe(true)
      expect(close(p.half[1].tail, add3(g.origin, p.half[0].vec))).toBe(true)
      expect(close(p.half[0].vec, benchVector(d.view, w.halves[0]))).toBe(true)
      expect(close(p.half[1].vec, benchVector(d.view, w.halves[1]))).toBe(true)
      let end = add3(p.half[1].tail, p.half[1].vec)
      if (!w.residualZero) {
        expect(p.resid.op).toBeGreaterThan(0)
        expect(close(p.resid.tail, end)).toBe(true)
        end = add3(end, p.resid.vec)
      } else expect(p.resid.op).toBe(0)
      expect(close(end, g.rev[k]!), `${c} k=${k}`).toBe(true)
      expect(close(p.ring.W.p, g.rev[k]!)).toBe(true)
      expect(close(p.ring.U.p, g.src[w.j]!)).toBe(true)
      expect(close(p.ring.S.p, g.sig[w.j]!)).toBe(true)
      // The prefix of the new order is the bright part of the reordered walk.
      d.occurrences.forEach((o, i) => expect(p.live[i]!.op).toBeCloseTo(o.output < k ? 1 : 0.26, 12))
    }
  })

  it('Why without a reordered endpoint shows the endpoint numbers, not a construction', () => {
    for (const item of [null, 'walk:source:4', 'walk:vector:v1']) {
      const d = scene(hero, item)
      const p = composeStage(makePose(d.n), d, walkGeometry(d), 'why', 1e9, S)
      expect(p.dots.numbers).toBe(1)
      expect(p.half[0].op + p.half[1].op).toBe(0)
    }
  })

  it('Assumptions: the closed walk marks total zero; the open walk shows T and the failing endpoint', () => {
    const closed = scene(hero)
    const pc = composeStage(makePose(12), closed, walkGeometry(closed), 'assumptions', 1e9, S)
    expect(pc.ring.zero.op).toBe(1)
    expect(pc.total.op).toBe(0)
    const open = scene(CASES['open-two'].input)
    const g = walkGeometry(open)
    const po = composeStage(makePose(2), open, g, 'assumptions', 1e9, S)
    expect(close(add3(po.total.tail, po.total.vec), add3(g.origin, g.total))).toBe(true)
    expect(close(po.ring.fail.p, g.rev[2]!)).toBe(true)
    expect(po.ring.zero.op).toBe(0)
  })

  it('a sign edit morph: identity arrows keep their vectors; the edited copy passes through zero; no stale dots', () => {
    const a = scene(hero)
    const b = scene(flip(hero, 'v1'))
    const ga = walkGeometry(a)
    const gb = walkGeometry(b)
    const from = composeStage(makePose(12), a, ga, 'signs', 1e9, S)
    const to = composeStage(makePose(12), b, gb, 'signs', 1e9, S)
    const out = makePose(12)
    let minLen = Infinity
    for (let k = 0; k <= 200; k++) {
      blendPose(out, from, to, k / 200, 'morph')
      expectNeverFlipped(b, out)
      minLen = Math.min(minLen, norm3(out.copy[1]!.vec))
      if (k > 30 && k < 170) expect(out.dots.signed).toBe(0)
    }
    expect(minLen).toBeLessThan(1e-9)
    expect(close(out.copy[1]!.vec, gb.vecs[1]!)).toBe(true)
    for (let i = 0; i < 12; i++) expect(close(out.copy[i]!.tail, gb.sig[i]!)).toBe(true)
    expect(out.dots.signed).toBe(1)
  })
})
