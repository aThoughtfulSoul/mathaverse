// Worker C: exact braid word semantics (src/algebra/braid.ts) and the scene description (deriveBraid).
// Crossing signs and current-position interpretation, inverse words, supported rewrites (valid and invalid
// spans), invariants, the [1,1] counterexample, and "not established" when invariants agree without a witness.
import { describe, expect, it } from 'vitest'
import {
  type Generator, type RewriteStep, BraidError, applyRewrite, compareWords, endpointPermutation, exponentSum, invertWord, positionsBefore, replayRewrites,
} from '../../src/algebra/braid'
import { deriveBraid, describeWord, rewriteOptions, statusLines } from '../../src/domains/braid/derive'
import type { BraidSceneInput } from '../../src/domains/inputs'

const input = (word: Generator[], extra: Partial<BraidSceneInput> = {}): BraidSceneInput => ({
  experimentId: 'exp-braid',
  revision: 1,
  mathRevision: 1,
  word,
  origin: word,
  rewrites: [],
  compare: null,
  item: null,
  recipe: null,
  ...extra,
})
const overUnder = (w: Generator[]) => describeWord(w, 'word').crossings.map((c) => `${c.over}>${c.under}`)

describe('crossing signs act on current positions', () => {
  it('positive: the strand currently on the left passes over; negative: under', () => {
    expect(overUnder([1])).toEqual(['a>b'])
    expect(overUnder([-1])).toEqual(['b>a'])
    expect(overUnder([2])).toEqual(['b>c'])
    expect(overUnder([-2])).toEqual(['c>b'])
  })

  it('the index names positions, not identities: sigma1 after sigma2 crosses a with c', () => {
    expect(positionsBefore([2, 1])).toEqual([[0, 1, 2], [0, 2, 1], [2, 0, 1]])
    const d = describeWord([2, 1], 'word')
    expect(d.crossings[1]!.left).toBe('a')
    expect(d.crossings[1]!.right).toBe('c')
    expect(overUnder([2, 1])).toEqual(['b>c', 'a>c'])
  })

  it('the hero words: sigma1 sigma2 sigma1 and sigma2 sigma1 sigma2', () => {
    expect(overUnder([1, 2, 1])).toEqual(['a>b', 'a>c', 'b>c'])
    expect(overUnder([2, 1, 2])).toEqual(['b>c', 'a>c', 'a>b'])
  })

  it('an inverse pair keeps one strand over; a double crossing changes the over strand', () => {
    expect(overUnder([1, -1])).toEqual(['a>b', 'a>b'])
    expect(overUnder([-1, 1])).toEqual(['b>a', 'b>a'])
    expect(overUnder([1, 1])).toEqual(['a>b', 'b>a'])
  })
})

describe('inverse words', () => {
  it('reverse the word and flip every sign', () => {
    expect(invertWord([1, 2, -1])).toEqual([1, -2, -1])
    expect(invertWord([])).toEqual([])
  })

  it('a word followed by its inverse reduces to the identity by checked cancellations', () => {
    const w: Generator[] = [1, 2, -1]
    const both = [...w, ...invertWord(w)]
    const steps: RewriteStep[] = [2, 1, 0].map((at) => ({ rule: 'cancel_pair', at, generator: null }))
    expect(replayRewrites(both, steps)).toEqual([])
    expect(endpointPermutation(both)).toEqual([0, 1, 2])
    expect(exponentSum(both)).toBe(0)
  })
})

describe('supported rewrites', () => {
  it('apply at matching spans with prefix and suffix unchanged', () => {
    expect(applyRewrite([1, 2, 1], { rule: 'braid_relation', at: 0, generator: null })).toEqual([2, 1, 2])
    expect(applyRewrite([2, -1, 1, 2, 1, -2, 2], { rule: 'braid_relation', at: 2, generator: null })).toEqual([2, -1, 2, 1, 2, -2, 2])
    expect(applyRewrite([2, 1, -1, 2], { rule: 'cancel_pair', at: 1, generator: null })).toEqual([2, 2])
    expect(applyRewrite([2], { rule: 'insert_pair', at: 1, generator: -1 })).toEqual([2, -1, 1])
  })

  it('refuse spans that do not match (nothing is rewritten approximately)', () => {
    expect(() => applyRewrite([1, 2, 1], { rule: 'braid_relation', at: 1, generator: null })).toThrow(BraidError)
    expect(() => applyRewrite([1, 2, -1], { rule: 'braid_relation', at: 0, generator: null })).toThrow(BraidError)
    expect(() => applyRewrite([1, 1], { rule: 'cancel_pair', at: 0, generator: null })).toThrow(BraidError)
    expect(() => applyRewrite([1, -2], { rule: 'cancel_pair', at: 0, generator: null })).toThrow(BraidError)
    expect(() => applyRewrite([1], { rule: 'insert_pair', at: 2, generator: 1 })).toThrow(BraidError)
  })

  it('offers only the rewrites whose span matches at the selected crossing', () => {
    const rules = (w: Generator[], k: number) => rewriteOptions(w, k).map((o) => `${o.rule}@${o.at}${o.generator === null ? '' : `:${o.generator}`}`)
    expect(rules([1, 2, 1], 0)).toEqual(['braid_relation@0', 'insert_pair@0:1', 'insert_pair@0:2'])
    expect(rules([1, 2, 1], 1)).toEqual(['insert_pair@1:1', 'insert_pair@1:2'])
    expect(rules([1, -1], 1)).toEqual(['cancel_pair@0', 'insert_pair@1:1', 'insert_pair@1:2'])
    expect(rules([2, -2, 2], 1)).toEqual(['cancel_pair@1', 'cancel_pair@0', 'insert_pair@1:1', 'insert_pair@1:2'])
    expect(rules([1, 1], 0)).toEqual(['insert_pair@0:1', 'insert_pair@0:2'])
    const long = Array.from({ length: 23 }, () => 1 as Generator)
    expect(rules(long, 3)).toEqual([])
    expect(rules([1, 2, 1], 3)).toEqual([])
  })
})

describe('invariants and the supported-check status', () => {
  it('endpoint permutations and exponent sums', () => {
    expect(endpointPermutation([1, 2, 1])).toEqual([2, 1, 0])
    expect(describeWord([1, 2, 1], 'word').arrival).toEqual(['c', 'b', 'a'])
    expect(exponentSum([1, 2, 1])).toBe(3)
    expect(endpointPermutation([1, 1])).toEqual([0, 1, 2])
    expect(exponentSum([1, 1])).toBe(2)
    expect(exponentSum([1, -2, -1])).toBe(-1)
  })

  it('[1,1] is not the identity: same endpoint permutation, exponent sums 2 and 0', () => {
    expect(endpointPermutation([1, 1])).toEqual(endpointPermutation([]))
    expect(compareWords([1, 1], [])).toEqual({ kind: 'different', invariant: 'exponent_sum' })
    const d = deriveBraid(input([1, 1], { compare: [] }))
    expect(d.verdict).toEqual({ kind: 'different', invariant: 'exponent_sum' })
    expect(d.statusText).toContain('exponent sums 2 and 0')
    expect(d.summary).toBe('σ1 σ1 vs identity: different from the comparison (exponent sums differ)')
  })

  it('equal invariants with no witness are "not established", never "different" or "equal"', () => {
    for (const [w, c] of [[[1, 2, 1], [2, 1, 2]], [[1, -1], []], [[2, 1, 2, -1], [1, 2]]] as Generator[][][]) {
      expect(endpointPermutation(w!)).toEqual(endpointPermutation(c!))
      expect(exponentSum(w!)).toBe(exponentSum(c!))
      const d = deriveBraid(input(w!, { compare: c }))
      expect(d.verdict).toEqual({ kind: 'not_established' })
      expect(d.statusText).toContain('not established by the supported checks')
      expect(d.statusText).not.toMatch(/different|identical|equal by/i)
    }
  })

  it('the relation rewrite gives equality "checked by supported rewrite rules"', () => {
    const d = deriveBraid(input([2, 1, 2], { origin: [1, 2, 1], rewrites: [{ rule: 'braid_relation', at: 0, generator: null }], compare: [2, 1, 2] }))
    expect(d.status.originEqualsCompareByRewrites).toBe(true)
    expect(d.statusText).toContain('checked by supported rewrite rules')
    expect(d.statusText).not.toMatch(/Lean/)
    expect(d.summary).toBe('σ1 σ2 σ1 → σ2 σ1 σ2 by one supported rewrite; identical to the comparison')
  })

  it('cancelling the inverse pair establishes equality with the identity', () => {
    const d = deriveBraid(input([], { origin: [1, -1], rewrites: [{ rule: 'cancel_pair', at: 0, generator: null }], compare: [] }))
    expect(d.verdict).toEqual({ kind: 'identical' })
    expect(d.summary).toBe('σ1 σ1⁻¹ → identity by one supported rewrite; identical to the comparison')
  })

  it('different endpoint permutations prove inequality', () => {
    const { status, statusText } = statusLines([1], [1], [], [2])
    expect(status.vsCompare).toEqual({ kind: 'different', invariant: 'endpoint_permutation' })
    expect(statusText).toContain('endpoint permutations differ')
  })
})

describe('deriveBraid', () => {
  it('validates the selected crossing against the word and lists its options', () => {
    expect(deriveBraid(input([1, 2, 1], { item: 'crossing:0' })).options.map((o) => o.rule)).toEqual(['braid_relation', 'insert_pair', 'insert_pair'])
    const out = deriveBraid(input([1, 2, 1], { item: 'crossing:3' }))
    expect(out.selectedCrossing).toBeNull()
    expect(out.options).toEqual([])
    expect(deriveBraid(input([1], { item: 'strand:b' })).selectedStrand).toBe('b')
  })

  it('follows the recipe: comparison and invariants only when its operations ask for them', () => {
    const recipe = (ops: ('braid_diagram' | 'braid_invariants')[]) => ({ id: 'r', name: 'r', operations: ops.map((kind) => ({ kind, word: 'word', compare: 'compare' })) })
    const a = deriveBraid(input([1], { compare: [2], recipe: recipe(['braid_diagram']) }))
    expect(a.compare?.word).toEqual([2])
    expect(a.show.invariants).toBe(false)
    const b = deriveBraid(input([1], { compare: [2], recipe: recipe(['braid_invariants']) }))
    expect(b.compare).toBeNull()
  })

  it('is plain data, deterministic and bounded', () => {
    const d1 = deriveBraid(input([1, 2, -1], { compare: [1] }))
    const d2 = deriveBraid(input([1, 2, -1], { compare: [1] }))
    expect(JSON.parse(JSON.stringify(d1))).toEqual(d2)
    expect(deriveBraid(input(Array.from({ length: 24 }, () => 2 as Generator))).canAppend).toBe(false)
  })
})
