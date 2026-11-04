// The exact vector-walk core against the architect's independent golden fixtures (workspace-spec/evidence/
// steinitz/fixtures.json, copied byte for byte into tests/proof/fixtures/) and the edge cases of
// PROOF-EXPLORER-MATH section 4: zero and repeated vectors, empty sign classes, k = 0 / p / N, sign identity
// across a source permutation, malformed inputs, a valid no-improvement case and the missing assumption.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type QJson, fromJson, q, toJson, cmp, mul } from '../../src/model/rational'
import type { Vec } from '../../src/model/linear'
import {
  type Sign, type WalkInput, WalkError, ceilSqrt, checkWalk, deriveWalk, isqrt, norm2, parseWalkItem, representativeEndpoints, signedOrder, vadd, veq, vscale, vneg, HALF, witnessIndex, walkClaimPayload,
} from '../../src/algebra/walk'
import { CASES, CASE_IDS, caseOf, hasHeroVectors } from '../../src/lessons/steinitz/cases'

const here = new URL('./fixtures/', import.meta.url)
const raw = readFileSync(new URL('steinitz-fixtures.json', here))
const verification = JSON.parse(readFileSync(new URL('steinitz-verification.json', here), 'utf8')) as { fixturesSha256: string; zeroSumSignAssignmentsChecked: number }

interface Fixture {
  id: string
  dimension: 3
  vectors: { id: string; coords: QJson[] }[]
  order: string[]
  signs: Sign[]
  expected: {
    permutation: number[]; positiveIndices: number[]; negativeIndices: number[]; total: QJson[]; zeroSum: boolean; allVectorsInUnitBall: boolean
    B: QJson; D: QJson; R: QJson; sourcePeakSquared: QJson; signedPeakSquared: QJson; reorderedPeakSquared: QJson
    sourcePrefixes: QJson[][]; signedPrefixes: QJson[][]; reorderedPrefixes: QJson[][]
    lemmaApplicable: boolean; proposedBoundActuallyHolds: boolean
    witnesses: { k: number; j: number; branch: 'positive' | 'negative_reverse'; zeroSumIdentityHolds: boolean; withinProposedBound: boolean }[]
  }
}
const fixtures = (JSON.parse(raw.toString('utf8')) as { sourceCommit: string; fixtures: Fixture[] })

const vecOf = (v: QJson[]): Vec => v.map(fromJson)
const json = (v: Vec) => v.map(toJson)
const inputOf = (f: Fixture): WalkInput => ({ dimension: f.dimension, vectors: f.vectors.map((v) => ({ id: v.id, coords: vecOf(v.coords) })), order: f.order, signs: f.signs })
const caseFor: Record<string, (typeof CASE_IDS)[number]> = { 'balanced-3d': 'hero', 'all-positive-3d': 'all-positive', 'line-six': 'line-six', 'open-two': 'open-two' }

describe('golden fixtures (independent Python Fraction oracle)', () => {
  it('are the architect’s bytes, pinned to the source commit', () => {
    expect(createHash('sha256').update(raw).digest('hex')).toBe(verification.fixturesSha256)
    expect(fixtures.sourceCommit).toBe('4eaee87548250b2682affda7d05d947c05554bae')
    expect(fixtures.fixtures.map((f) => f.id)).toEqual(['balanced-3d', 'all-positive-3d', 'line-six', 'open-two'])
  })

  for (const f of fixtures.fixtures) {
    describe(f.id, () => {
      const facts = deriveWalk(inputOf(f))
      const x = f.expected
      it('matches the permutation, sign classes, total and applicability', () => {
        expect(facts.permutation).toEqual(x.permutation)
        expect(facts.positive).toEqual(x.positiveIndices)
        expect(facts.negative).toEqual(x.negativeIndices)
        expect(json(facts.total)).toEqual(x.total)
        expect(facts.zeroSum).toBe(x.zeroSum)
        expect(facts.lemmaApplicable).toBe(x.lemmaApplicable)
        expect(facts.boundHolds).toBe(x.proposedBoundActuallyHolds)
        expect(facts.allInUnitBall).toBe(x.allVectorsInUnitBall)
      })
      it('matches every prefix coordinate of all three walks', () => {
        expect(facts.U.map(json)).toEqual(x.sourcePrefixes)
        expect(facts.S.map(json)).toEqual(x.signedPrefixes)
        expect(facts.W.map(json)).toEqual(x.reorderedPrefixes)
      })
      it('matches the exact peaks and integer bounds', () => {
        expect(toJson(facts.sourcePeak2)).toEqual(x.sourcePeakSquared)
        expect(toJson(facts.signedPeak2)).toEqual(x.signedPeakSquared)
        expect(toJson(facts.reorderedPeak2)).toEqual(x.reorderedPeakSquared)
        expect(toJson(q(facts.B))).toEqual(x.B)
        expect(toJson(q(facts.D))).toEqual(x.D)
        expect(toJson(facts.R)).toEqual(x.R)
      })
      it('matches every witness j, branch, zero-sum identity and bound', () => {
        expect(facts.witnesses.map((w) => ({ k: w.k, j: w.j, branch: w.branch === 'positive' ? 'positive' : 'negative_reverse', zeroSumIdentityHolds: w.zeroSumFormHolds, withinProposedBound: w.withinBound }))).toEqual(x.witnesses)
        for (const w of facts.witnesses) expect(w.identityHolds).toBe(true)
      })
      it('is the prepared lesson case with the same content', () => {
        expect(caseOf(inputOf(f))).toBe(caseFor[f.id])
        expect(deriveWalk(CASES[caseFor[f.id]!].input).W.map(json)).toEqual(x.reorderedPrefixes)
      })
    })
  }
})

describe('hero facts named in the contract', () => {
  const h = deriveWalk(CASES.hero.input)
  it('bounds 5, 1, 3 differ from the actual peaks 14√3/5 and 7√3/5', () => {
    expect([h.B, h.D]).toEqual([5n, 1n])
    expect(h.R).toEqual(q(3))
    expect(h.sourcePeak2).toEqual(q(588, 25)) // (14√3/5)^2
    expect(h.reorderedPeak2).toEqual(q(147, 25)) // (7√3/5)^2
    expect(h.comparison).toBe('better')
  })
  it('k = 3: positive branch, j = 5, W_3 = a + b + c = (U_5 + S_5)/2', () => {
    const w = h.witnesses[3]!
    expect([w.branch, w.j]).toEqual(['positive', 5])
    const abc = vadd(vadd(CASES.hero.input.vectors[0]!.coords, CASES.hero.input.vectors[2]!.coords), CASES.hero.input.vectors[4]!.coords)
    expect(veq(h.W[3]!, abc)).toBe(true)
    expect(veq(h.W[3]!, vscale(HALF, vadd(h.U[5]!, h.S[5]!)))).toBe(true)
    expect(veq(w.halfSum, h.W[3]!)).toBe(true)
  })
  it('k = 9: negative branch, j = 6, W_9 = −(a + b + c) = (S_6 − U_6)/2', () => {
    const w = h.witnesses[9]!
    expect([w.branch, w.j]).toEqual(['negative', 6])
    expect(veq(h.W[9]!, vneg(h.W[3]!))).toBe(true)
    expect(veq(h.W[9]!, vscale(HALF, vadd(h.S[6]!, vneg(h.U[6]!))))).toBe(true)
    expect(w.counted).toEqual([1, 3, 5])
  })
  it('the prepared endpoints are the representative ones', () => {
    expect(representativeEndpoints(h)).toEqual({ positive: 3, negative: 9 })
  })
})

describe('edge cases', () => {
  const e1: Vec = [q(1), q(0)]
  const zero: Vec = [q(0), q(0)]
  const mk = (vs: Vec[], signs: Sign[], dimension: 2 | 3 = 2): WalkInput => ({ dimension, vectors: vs.map((coords, i) => ({ id: `v${i}`, coords })), order: vs.map((_, i) => `v${i}`), signs })

  it('a one-vector zero sequence: every k is 0 or 1 with zero norms', () => {
    for (const s of [1, -1] as Sign[]) {
      const f = deriveWalk(mk([zero], [s]))
      expect(f.zeroSum).toBe(true)
      expect([f.B, f.D]).toEqual([0n, 0n])
      expect(f.R).toEqual(q(0))
      expect(f.witnesses.map((w) => [w.k, w.j, w.branch])).toEqual(s === 1 ? [[0, 0, 'positive'], [1, 1, 'positive']] : [[0, 0, 'positive'], [1, 0, 'negative']])
      expect(f.boundHolds).toBe(true)
    }
  })
  it('all signs positive (no negative class) and all negative (no positive class)', () => {
    const vs = [e1, e1, vneg(e1), vneg(e1)]
    const pos = deriveWalk(mk(vs, [1, 1, 1, 1]))
    expect(pos.permutation).toEqual([0, 1, 2, 3])
    expect(pos.witnesses.every((w) => w.branch === 'positive')).toBe(true)
    expect(representativeEndpoints(pos)).toEqual({ positive: 2, negative: null })
    const negs = deriveWalk(mk(vs, [-1, -1, -1, -1]))
    expect(negs.permutation).toEqual([3, 2, 1, 0])
    expect(negs.witnesses[0]!.branch).toBe('positive') // k = 0 = p
    expect(negs.witnesses.slice(1).every((w) => w.branch === 'negative')).toBe(true)
    expect(negs.witnesses.map((w) => w.j)).toEqual([0, 3, 2, 1, 0])
    expect(representativeEndpoints(negs)).toEqual({ positive: null, negative: 2 })
    for (const f of [pos, negs]) expect(f.boundHolds).toBe(true)
  })
  it('k = 0, k = p and k = N', () => {
    const f = deriveWalk(CASES['line-six'].input)
    const p = f.positive.length
    expect(f.witnesses[0]).toMatchObject({ j: 0, branch: 'positive' })
    expect(f.witnesses[p]).toMatchObject({ j: f.positive[p - 1]! + 1, branch: 'positive' })
    expect(f.witnesses[f.n]).toMatchObject({ j: 0, branch: 'negative' })
    expect(() => witnessIndex(f.n + 1, f.positive, f.negative)).toThrow(WalkError)
    expect(() => witnessIndex(-1, f.positive, f.negative)).toThrow(WalkError)
  })
  it('repeated and zero vectors stay separate occurrences', () => {
    const f = deriveWalk(mk([e1, zero, e1, zero, vneg(e1), vneg(e1)], [1, -1, -1, 1, 1, -1]))
    expect(f.n).toBe(6)
    expect(new Set(f.reorderedIds).size).toBe(6)
    expect([...f.permutation].sort()).toEqual([0, 1, 2, 3, 4, 5])
    expect(f.boundHolds).toBe(true)
  })
  it('a sign stays with its occurrence when the source order changes', () => {
    const base = CASES.hero.input
    const reversed: WalkInput = { ...base, order: [...base.order].reverse() }
    const a = deriveWalk(base)
    const b = deriveWalk(reversed)
    // Same occurrence, same sign, wherever it now sits.
    for (const [i, id] of b.ids.entries()) expect(b.signs[i]).toBe(a.signs[a.ids.indexOf(id)])
    expect(b.reorderedIds).toEqual(signedOrder(b.signs).permutation.map((i) => b.ids[i]))
    expect(b.boundHolds).toBe(true)
  })
  it('a valid no-improvement case and a worse bound are reported, not hidden', () => {
    const all = deriveWalk(CASES['all-positive'].input)
    expect([all.B, all.D, all.R]).toEqual([5n, 5n, q(5)])
    expect(all.comparison).toBe('same')
    expect(all.boundHolds).toBe(true)
    // Signs whose auxiliary walk wanders further than the source walk: the lemma still holds, its bound is weaker.
    const vs = [e1, vneg(e1), e1, vneg(e1)]
    const worse = deriveWalk(mk(vs, [1, -1, 1, -1]))
    expect(worse.D > worse.B).toBe(true)
    expect(worse.comparison).toBe('worse')
    expect(worse.boundHolds).toBe(true)
  })
  it('the missing assumption: the bound fails at k = 2 and deleting T would be wrong', () => {
    const f = deriveWalk(CASES['open-two'].input)
    expect(f.lemmaApplicable).toBe(false)
    expect(f.boundHolds).toBe(false)
    expect(f.firstFailure).toBe(2)
    expect(f.R).toEqual(q(3, 2))
    expect(f.wNorm2[2]).toEqual(q(4))
    expect(cmp(f.wNorm2[2]!, mul(f.R, f.R))).toBe(1) // 4 > 9/4
    const w = f.witnesses[2]!
    expect([w.j, w.branch, w.identityHolds, w.zeroSumFormHolds]).toEqual([0, 'negative', true, false])
    expect(veq(w.residual, f.total)).toBe(true)
  })
})

describe('exhaustive signs on small zero-sum families (the oracle checked 4,802)', () => {
  it('every assignment: identities hold and the bound holds whenever T = 0', () => {
    const fams: WalkInput[] = [CASES['line-six'].input, CASES.hero.input]
    let n = 0
    for (const base of fams) {
      const N = base.vectors.length
      for (let mask = 0; mask < 1 << N; mask++) {
        const signs = Array.from({ length: N }, (_, i) => ((mask >> i) & 1 ? -1 : 1) as Sign)
        const f = deriveWalk({ ...base, signs })
        expect(f.boundHolds).toBe(true)
        expect(f.witnesses.every((w) => w.zeroSumFormHolds)).toBe(true)
        n++
      }
    }
    expect(n).toBe(64 + 4096)
  })
})

describe('arithmetic and validation', () => {
  it('ceilSqrt is exact at and around perfect squares', () => {
    expect(isqrt(0n)).toBe(0n)
    expect(isqrt(10n ** 40n)).toBe(10n ** 20n)
    expect(isqrt(10n ** 40n - 1n)).toBe(10n ** 20n - 1n)
    expect(ceilSqrt(q(588, 25))).toBe(5n)
    expect(ceilSqrt(q(25))).toBe(5n)
    expect(ceilSqrt(q(2501, 100))).toBe(6n)
    expect(ceilSqrt(q(1, 4))).toBe(1n)
    expect(ceilSqrt(q(0))).toBe(0n)
  })
  const hero = CASES.hero.input
  it.each([
    ['dimension', { ...hero, dimension: 4 as 3 }],
    ['too many vectors', { ...hero, vectors: [...hero.vectors, { id: 'v12', coords: hero.vectors[0]!.coords }], order: [...hero.order, 'v12'], signs: [...hero.signs, 1 as Sign] }],
    ['no vectors', { ...hero, vectors: [], order: [], signs: [] }],
    ['duplicate ID', { ...hero, vectors: hero.vectors.map((v, i) => (i === 1 ? { ...v, id: 'v0' } : v)) }],
    ['malformed permutation (repeat)', { ...hero, order: hero.order.map((id, i) => (i === 1 ? 'v0' : id)) }],
    ['malformed permutation (unknown)', { ...hero, order: hero.order.map((id, i) => (i === 1 ? 'v99' : id)) }],
    ['malformed permutation (short)', { ...hero, order: hero.order.slice(1) }],
    ['malformed signs (value)', { ...hero, signs: hero.signs.map((s, i) => (i === 0 ? (0 as Sign) : s)) }],
    ['malformed signs (length)', { ...hero, signs: hero.signs.slice(1) }],
    ['coordinate count', { ...hero, vectors: hero.vectors.map((v, i) => (i === 0 ? { ...v, coords: v.coords.slice(1) } : v)) }],
    ['coordinate bound', { ...hero, vectors: hero.vectors.map((v, i) => (i === 0 ? { ...v, coords: [q(5), q(0), q(0)] } : v)) }],
    ['denominator bound', { ...hero, vectors: hero.vectors.map((v, i) => (i === 0 ? { ...v, coords: [q(1, 1001), q(0), q(0)] } : v)) }],
  ])('rejects %s', (_, w) => {
    expect(() => checkWalk(w as WalkInput)).toThrow(WalkError)
  })
  it('selection items are prefix lengths or occurrence IDs, never clamped', () => {
    expect(parseWalkItem('walk:reordered:3', hero)).toEqual({ kind: 'reordered', index: 3 })
    expect(parseWalkItem('walk:source:0', hero)).toEqual({ kind: 'source', index: 0 })
    expect(parseWalkItem('walk:signed:12', hero)).toEqual({ kind: 'signed', index: 12 })
    expect(parseWalkItem('walk:vector:v4', hero)).toEqual({ kind: 'vector', id: 'v4' })
    expect(parseWalkItem(null, hero)).toBeNull()
    for (const bad of ['walk:reordered:13', 'walk:source:-1', 'walk:signed:03', 'walk:vector:v12', 'walk:other:1', 'reordered:3']) expect(() => parseWalkItem(bad, hero)).toThrow(WalkError)
  })
  it('the claim payload ignores IDs and stored order of identical content', () => {
    const renamed: WalkInput = { ...hero, vectors: hero.vectors.map((v) => ({ ...v, id: `x${v.id}` })), order: hero.order.map((id) => `x${id}`) }
    expect(walkClaimPayload(renamed)).toEqual(walkClaimPayload(hero))
    const flipped: WalkInput = { ...hero, signs: hero.signs.map((s, i) => (i === 0 ? (-s as Sign) : s)) }
    expect(walkClaimPayload(flipped)).not.toEqual(walkClaimPayload(hero))
  })
  it('case recognition is by content', () => {
    expect(hasHeroVectors(CASES['all-positive'].input)).toBe(true)
    expect(hasHeroVectors(CASES['line-six'].input)).toBe(false)
    const edited: WalkInput = { ...hero, signs: hero.signs.map((s, i) => (i === 0 ? (-s as Sign) : s)) }
    expect(caseOf(edited)).toBeNull()
    expect(norm2(hero.vectors[0]!.coords)).toEqual(q(1))
  })
})
