// Lean track, proof lesson: the finite claim `walk_reorder_instance` (PROOF-EXPLORER-MATH section 8) through
// POST /api/check with an injected runner (no Lean), its claim hash and its generated Lean source.
//   - A non-closed walk is refused with its exact arithmetic before any Lean run (and before the toolchain probe).
//   - Malformed descriptors are 400 with no run; browser-supplied answers (B, D, order, a selection) are rejected.
//   - A receipt exists only after a passing audit and records the walk template version mw-lean-walk-1.
//   - The hash covers the exact data in source order and the bound convention: occurrence IDs and the stored
//     order of occurrences do not change it; a sign, the source order or a coordinate does; no endpoint
//     selection is part of the claim.
//   - The generated source is a function of numbers and fixed text: IDs never reach it.
// Real compiles of the same claims are in walkCheck.test.ts.

import { describe, expect, it, vi } from 'vitest'
import { type CheckResponse, type ClaimDescriptor, claimHash, claimHashPayload, parseClaimDescriptor } from '../../src/workspace/claims'
import { type WalkClaimDescriptor, describeWalkClaim } from '../../src/workspace/walkClaim'
import { type Sign, type WalkInput, BOUND_CONVENTION, deriveWalk } from '../../src/algebra/walk'
import { CASES, type CaseId } from '../../src/lessons/steinitz/cases'
import { type CheckerDeps, createChecker } from '../../server/lean/index'
import { type RunResult, TOOLCHAIN_ID } from '../../server/lean/runner'
import { createReceiptRegistry } from '../../server/lean/receipts'
import { TEMPLATE_VERSION, THEOREM, TemplateError, preludeFor } from '../../server/lean/template'
import { generateAny, templateVersionFor } from '../../server/lean/templates'
import { WALK_TEMPLATE_VERSION, generateWalkClaim } from '../../server/lean/walkTemplate'
import { r } from './fixtures'

const msg = (data: string, severity = 'information') => JSON.stringify({ severity, data, caption: '', fileName: 'Claim.lean' })
const AUDIT_OK = msg("'MathWorkspace.claim' does not depend on any axioms")
const result = (over: Partial<RunResult> = {}): RunResult => ({ code: 0, stdout: `${AUDIT_OK}\n`, stderr: '', timedOut: false, aborted: false, overflow: false, spawnError: null, ms: 5, ...over })

function setup(run: CheckerDeps['run'] = async () => result(), probe: CheckerDeps['probe'] = async () => TOOLCHAIN_ID) {
  const receipts = createReceiptRegistry()
  const runSpy = vi.fn(run)
  const probeSpy = vi.fn(probe)
  const { checkRoute } = createChecker({ run: runSpy, probe: probeSpy, receipts })
  const post = (body: unknown) => checkRoute({ method: 'POST', path: '/api/check', body, signal: new AbortController().signal })
  return { post, runSpy, probeSpy, receipts }
}

const body = (claim: unknown) => ({ requestId: 'walk-1', claim })
const desc = (id: CaseId): WalkClaimDescriptor => describeWalkClaim(CASES[id].input)
const hashOf = (d: ClaimDescriptor) => claimHash(parseClaimDescriptor(d))
/** A loose copy for building malformed descriptors. */
const loose = (id: CaseId) => structuredClone(desc(id)) as unknown as Record<string, unknown> & { vectors: Record<string, unknown>[]; signs: unknown[] }

/** The same walk with every occurrence ID renamed (vectors, order and signs keep their pairing). */
function renamed(w: WalkInput, name: (id: string, i: number) => string): WalkInput {
  const map = new Map(w.vectors.map((v, i) => [v.id, name(v.id, i)]))
  return { dimension: w.dimension, vectors: w.vectors.map((v) => ({ id: map.get(v.id)!, coords: v.coords })), order: w.order.map((id) => map.get(id)!), signs: [...w.signs] }
}
/** The same walk with occurrence `id`'s sign flipped. */
function flipped(w: WalkInput, id: string): WalkInput {
  return { ...w, signs: w.signs.map((s, i) => (w.vectors[i]!.id === id ? (-s as Sign) : s)) }
}
/** The same occurrences with the source positions of `a` and `b` exchanged (signs stay with their occurrence). */
function swapped(w: WalkInput, a: string, b: string): WalkInput {
  return { ...w, order: w.order.map((id) => (id === a ? b : id === b ? a : id)) }
}

const OPEN_TWO_REASON =
  'Computed exactly, the claim is false: the walk does not return to its start (total (2, 0, 0)), so the reordering lemma does not apply; ' +
  'here W_2 = (2, 0, 0) has |W_2|^2 = 4 > 9/4 = (3/2)^2. It was not submitted to Lean.'

describe('walk_reorder_instance: a non-closed walk is refused before Lean', () => {
  it('open-two: not_established with the exact arithmetic; Lean is neither probed nor run; no receipt', async () => {
    const { post, runSpy, probeSpy, receipts } = setup()
    const res = await post(body(desc('open-two')))
    expect(res.status).toBe(200)
    const r = res.json as CheckResponse
    expect(r).toMatchObject({ requestId: 'walk-1', status: 'not_established', provenance: null, receipt: null, reason: OPEN_TWO_REASON })
    expect(r.claimHash).toBe(await hashOf(desc('open-two')))
    // The statement that would have been checked is still shown (numbers only), and is false: Lean never sees it.
    expect(r.statement).toContain('def eps : List Int := [1, -1]')
    expect(r.statement).toContain('def B : Nat := 2\ndef D : Nat := 1')
    expect(r.statement).toContain('outputOrder eps = [0, 1]')
    expect(runSpy).not.toHaveBeenCalled()
    expect(probeSpy).not.toHaveBeenCalled()
    expect(receipts.size).toBe(0)
  })

  it('the refusal does not depend on the toolchain: answered even when Lean is unavailable', async () => {
    const { post, runSpy } = setup(undefined, async () => null)
    const res = await post(body(desc('open-two')))
    expect(res.status).toBe(200)
    expect((res.json as CheckResponse).reason).toBe(OPEN_TWO_REASON)
    expect(runSpy).not.toHaveBeenCalled()
  })

  it('a non-closed walk whose bound happens to hold is refused too: the missing hypothesis decides, not the conclusion', async () => {
    const one: ClaimDescriptor = { claimVersion: 1, kind: 'walk_reorder_instance', dimension: 3, vectors: [{ id: 'v0', coords: [r(1), r(0), r(0)] }], signs: [1], convention: BOUND_CONVENTION }
    const { post, runSpy, receipts } = setup()
    const r1 = (await post(body(one))).json as CheckResponse
    expect(r1.status).toBe('not_established')
    expect(r1.reason).toBe('Computed exactly, the claim is false: the walk does not return to its start (total (1, 0, 0)), so the reordering lemma does not apply; here the bound happens to hold, but nothing guarantees it. It was not submitted to Lean.')
    expect(runSpy).not.toHaveBeenCalled()
    expect(receipts.size).toBe(0)
  })
})

describe('walk_reorder_instance: malformed descriptors are 400 with no Lean run', () => {
  const thirteen = () => {
    const c = loose('hero')
    c.vectors.push({ id: 'v12', coords: [r(0), r(0), r(0)] })
    c.signs.push(1)
    return body(c)
  }
  it.each([
    ['an unknown claim field (an endpoint selection)', () => body({ ...loose('hero'), selection: 'walk:reordered:3' }), 'invalid_claim', /claim: unknown field "selection"/],
    ['a browser-supplied bound', () => body({ ...loose('hero'), B: 5 }), 'invalid_claim', /claim: unknown field "B"/],
    ['a browser-supplied output order', () => body({ ...loose('hero'), order: [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 3, 1] }), 'invalid_claim', /claim: unknown field "order"/],
    ['an unknown vector field (a display label)', () => { const c = loose('hero'); c.vectors[0]!.label = 'a'; return body(c) }, 'invalid_claim', /claim\.vectors\[0\]: unknown field "label"/],
    ['a browser-supplied hash in the envelope', () => ({ ...body(desc('hero')), claimHash: 'f'.repeat(64) }), 'invalid_claim', /request: unknown field "claimHash"/],
    ['a missing convention', () => { const c = loose('hero'); delete c.convention; return body(c) }, 'invalid_claim', /missing field "convention"/],
    ['a wrong convention', () => body({ ...loose('hero'), convention: 'integer-ceiling-v2' }), 'invalid_claim', /claim\.convention: expected integer-ceiling-v1/],
    ['a wrong claim version', () => body({ ...loose('hero'), claimVersion: 2 }), 'invalid_claim', /claimVersion: must be 1/],
    ['dimension 4', () => body({ ...loose('hero'), dimension: 4 }), 'invalid_claim', /claim\.dimension: 2 or 3/],
    ['a sign 0', () => { const c = loose('hero'); c.signs[3] = 0; return body(c) }, 'invalid_claim', /claim\.signs: one sign \(1 or -1\) per vector/],
    ['a sign given as a string', () => { const c = loose('hero'); c.signs[0] = '+1'; return body(c) }, 'invalid_claim', /claim\.signs: one sign/],
    ['one sign too few', () => { const c = loose('hero'); c.signs.pop(); return body(c) }, 'invalid_claim', /claim\.signs: one sign/],
    ['13 vectors', thirteen, 'invalid_claim', /claim\.vectors: 1 to 12 vectors/],
    ['no vectors', () => body({ ...loose('hero'), vectors: [], signs: [] }), 'invalid_claim', /claim\.vectors: 1 to 12 vectors/],
    ['a coordinate outside [-4, 4]', () => { const c = loose('hero'); (c.vectors[0]!.coords as unknown[])[0] = r(5); return body(c) }, 'invalid_claim', /vector v0\[0\]: outside \[-4, 4\]/],
    ['a denominator above 1000', () => { const c = loose('hero'); (c.vectors[2]!.coords as unknown[])[1] = r(1, 1001); return body(c) }, 'invalid_claim', /vector v2\[1\]: denominator above 1000/],
    ['a rational beyond the arithmetic budget', () => { const c = loose('hero'); (c.vectors[0]!.coords as unknown[])[0] = { n: `1${'0'.repeat(90)}`, d: '1' }; return body(c) }, 'invalid_claim', /256-bit arithmetic budget/],
    ['a non-coprime rational', () => { const c = loose('hero'); (c.vectors[0]!.coords as unknown[])[0] = r(6, 10); return body(c) }, 'invalid_claim', /coprime/],
    ['a number in place of a rational', () => { const c = loose('hero'); (c.vectors[0]!.coords as unknown[])[0] = 0.6; return body(c) }, 'invalid_claim', /rational must be an object/],
    ['two coordinates in 3D', () => { const c = loose('hero'); (c.vectors[1]!.coords as unknown[]).pop(); return body(c) }, 'invalid_claim', /claim\.vectors\[1\]\.coords: expected 3 rationals/],
    ['duplicate occurrence IDs', () => { const c = loose('hero'); c.vectors[5]!.id = 'v4'; return body(c) }, 'invalid_claim', /duplicate occurrence ID v4/],
    ['an occurrence ID that is not an identifier', () => { const c = loose('hero'); c.vectors[0]!.id = '-/ theorem x'; return body(c) }, 'invalid_claim', /claim\.vectors\[0\]\.id: invalid occurrence ID/],
  ])('rejects %s', async (_, make, code, message) => {
    const { post, runSpy, probeSpy, receipts } = setup()
    const res = await post(make())
    expect(res.status).toBe(400)
    expect(res.json).toMatchObject({ code, retryable: false })
    expect((res.json as { message: string }).message).toMatch(message)
    expect(runSpy).not.toHaveBeenCalled()
    expect(probeSpy).not.toHaveBeenCalled()
    expect(receipts.size).toBe(0)
  })
})

describe('walk_reorder_instance: a receipt only after a passing audit', () => {
  it('the hero: one run of exactly the generated source; the receipt records mw-lean-walk-1 and the server hash', async () => {
    const { post, runSpy, receipts } = setup()
    const r = (await post(body(desc('hero')))).json as CheckResponse
    const exact = parseClaimDescriptor(desc('hero'))
    const hash = await claimHash(exact)
    expect(r).toMatchObject({ requestId: 'walk-1', claimHash: hash, status: 'checked', reason: null })
    expect(r.provenance).toEqual({ templateVersion: 'mw-lean-walk-1', toolchain: TOOLCHAIN_ID, theorem: 'MathWorkspace.claim', axioms: [], inputHash: hash })
    expect(receipts.resolve(r.receipt!.id, hash)).toMatchObject({ claimHash: hash, templateVersion: WALK_TEMPLATE_VERSION, theorem: THEOREM, axioms: [], issuedAt: r.receipt!.issuedAt })
    expect(receipts.resolve(r.receipt!.id, await hashOf(desc('all-positive')))).toBeNull()
    expect(runSpy).toHaveBeenCalledOnce()
    const source = runSpy.mock.calls[0]![0]
    expect(source).toBe(generateAny(exact, hash).source)
    expect(source).toContain(r.statement)
    expect(source.endsWith('\n#print axioms MathWorkspace.claim\n')).toBe(true)
  })

  it('template versions are per kind: walk claims mw-lean-walk-1, linear claims unchanged', () => {
    expect(WALK_TEMPLATE_VERSION).toBe('mw-lean-walk-1')
    expect(templateVersionFor('walk_reorder_instance')).toBe('mw-lean-walk-1')
    for (const k of ['same_image_witness', 'map_equality', 'map_difference_witness'] as const) expect(templateVersionFor(k)).toBe(TEMPLATE_VERSION)
  })

  it.each([
    ['a sorryAx dependency', result({ stdout: msg("'MathWorkspace.claim' depends on axioms: [sorryAx]") })],
    ['native evaluation', result({ stdout: msg("'MathWorkspace.claim' depends on axioms: [Lean.ofReduceBool, Lean.trustCompiler]") })],
    ['the standard axioms', result({ stdout: msg("'MathWorkspace.claim' depends on axioms: [propext, Classical.choice, Quot.sound]") })],
    ['two audit lines', result({ stdout: `${AUDIT_OK}\n${AUDIT_OK}\n` })],
    ['an extra information message', result({ stdout: `${msg('W_3 = (1, 1, 1)')}\n${AUDIT_OK}\n` })],
    ['no audit line', result({ stdout: '' })],
    ['decide failing (Lean exits 1)', result({ code: 1, stdout: `${msg('Tactic `decide` proved that the proposition ... is false', 'error')}\n${AUDIT_OK}\n` })],
    ['a renamed theorem', result({ stdout: msg("'MathWorkspace.claim2' does not depend on any axioms") })],
    ['a timeout', result({ timedOut: true, code: null, stdout: '' })],
  ])('no receipt for the hero with %s', async (_, run) => {
    const { post, runSpy, receipts } = setup(async () => run)
    const r = (await post(body(desc('hero')))).json as CheckResponse
    expect(r.status).toBe('not_established')
    expect(r.receipt).toBeNull()
    expect(r.provenance).toBeNull()
    expect(r.reason).toBeTruthy()
    expect(runSpy).toHaveBeenCalledOnce()
    expect(receipts.size).toBe(0)
  })
})

describe('walk_reorder_instance: the claim hash covers the exact data in source order', () => {
  const hero = CASES.hero.input

  it('renaming every occurrence ID keeps the hash, the statement and the Lean source', async () => {
    const other = describeWalkClaim(renamed(hero, (_, i) => `occ_${11 - i}`))
    expect(other.vectors.map((v) => v.id)).not.toEqual(desc('hero').vectors.map((v) => v.id))
    expect(await hashOf(other)).toBe(await hashOf(desc('hero')))
    const { post, runSpy } = setup()
    const a = (await post(body(desc('hero')))).json as CheckResponse
    const b = (await post(body(other))).json as CheckResponse
    expect(b.claimHash).toBe(a.claimHash)
    expect(b.statement).toBe(a.statement)
    expect(runSpy.mock.calls[1]![0]).toBe(runSpy.mock.calls[0]![0])
  })

  it('the stored order of occurrences is not the source order: shuffling storage keeps the hash', async () => {
    const perm = [5, 0, 11, 3, 8, 1, 10, 2, 7, 4, 9, 6]
    const stored: WalkInput = { dimension: 3, vectors: perm.map((i) => hero.vectors[i]!), order: [...hero.order], signs: perm.map((i) => hero.signs[i]!) }
    expect(await hashOf(describeWalkClaim(stored))).toBe(await hashOf(desc('hero')))
  })

  it('flipping one sign changes the hash (and the order Lean recomputes)', async () => {
    const f = flipped(hero, 'v1')
    expect(await hashOf(describeWalkClaim(f))).not.toBe(await hashOf(desc('hero')))
    expect(deriveWalk(f).permutation).not.toEqual(deriveWalk(hero).permutation)
  })

  it('reordering the source changes the hash; exchanging two equal occurrences with equal signs is the same claim', async () => {
    // v0 = a (+1) and v2 = b (+1): a different sequence of vectors.
    expect(await hashOf(describeWalkClaim(swapped(hero, 'v0', 'v2')))).not.toBe(await hashOf(desc('hero')))
    // v0 = a (+1) and v1 = a (−1): the signs travel with their occurrences, so the sign sequence changes.
    expect(await hashOf(describeWalkClaim(swapped(hero, 'v0', 'v1')))).not.toBe(await hashOf(desc('hero')))
    // all-positive v0 = a (+1) and v1 = a (+1): the same vectors and signs in source order, the same claim.
    const ap = CASES['all-positive'].input
    expect(await hashOf(describeWalkClaim(swapped(ap, 'v0', 'v1')))).toBe(await hashOf(desc('all-positive')))
  })

  it('changing one coordinate changes the hash', async () => {
    const c = loose('hero')
    ;(c.vectors[0]!.coords as unknown[])[0] = r(4, 5)
    expect(await hashOf(c as unknown as ClaimDescriptor)).not.toBe(await hashOf(desc('hero')))
  })

  it('no endpoint selection is part of the claim: the descriptor and the hash payload have no such field', () => {
    const d = desc('hero')
    expect(Object.keys(d).sort()).toEqual(['claimVersion', 'convention', 'dimension', 'kind', 'signs', 'vectors'])
    expect(Object.keys(d.vectors[0]!).sort()).toEqual(['coords', 'id'])
    const payload = claimHashPayload(parseClaimDescriptor(d)) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(['convention', 'dimension', 'kind', 'signs', 'vectors'])
    expect(payload.convention).toBe(BOUND_CONVENTION)
    // vectors in source order as exact rationals, no IDs
    expect(JSON.stringify(payload.vectors)).not.toMatch(/"v\d+"/)
  })

  it('the four prepared cases have four different hashes', async () => {
    const hashes = await Promise.all((['hero', 'all-positive', 'line-six', 'open-two'] as const).map((id) => hashOf(desc(id))))
    expect(new Set(hashes).size).toBe(4)
  })
})

describe('walk template mw-lean-walk-1: numbers and fixed text only', () => {
  const gen = async (d: WalkClaimDescriptor) => {
    const exact = parseClaimDescriptor(d)
    if (exact.kind !== 'walk_reorder_instance') throw new Error('unexpected kind')
    const hash = await claimHash(exact)
    return { exact, hash, ...generateWalkClaim(exact, hash) }
  }

  it('the hero statement states the data, B = 5, D = 1 and the order [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 3, 1]', async () => {
    const { statement, source, hash } = await gen(desc('hero'))
    expect(statement).toContain('def d : Nat := 3\ndef N : Nat := 12')
    expect(statement).toContain('  [3 /. 5, 4 /. 5, 0],   -- v₀\n  [3 /. 5, 4 /. 5, 0],   -- v₁\n  [0, 3 /. 5, 4 /. 5],   -- v₂')
    expect(statement).toContain('  [-4 /. 5, 0, -3 /. 5]   -- v₁₁\n]')
    expect(statement).toContain('def eps : List Int := [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1]')
    expect(statement).toContain('def B : Nat := 5\ndef D : Nat := 1')
    expect(statement).toContain('outputOrder eps = [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 3, 1]')
    expect(statement).toContain('def R : Q := ⟨B + D, 2⟩')
    expect(statement).toContain('theorem claim :')
    expect(statement.endsWith('  decide')).toBe(true)
    // The squared-norm meaning and the scope are part of the displayed statement.
    expect(statement).toContain('every bound compares a squared Euclidean norm |x|² = Σᵢ xᵢ² with a squared bound')
    expect(statement).toContain('Scope: these 12 exact vectors and signs only. This file does not prove the general lemma.')
    expect(source.startsWith(preludeFor('mw-lean-walk-1'))).toBe(true)
    expect(source).toContain(`-- Claim hash ${hash}\n${statement}\n\nend MathWorkspace\n\n#print axioms MathWorkspace.claim\n`)
  })

  it('the theorem is a conjunction of the seven finite facts, recomputed in Lean (not an implication)', async () => {
    const { statement } = await gen(desc('hero'))
    const theorem = statement.slice(statement.indexOf('theorem claim :'))
    expect(theorem).not.toMatch(/→|->/)
    for (const fact of [
      '(v.length = N ∧ (∀ x ∈ v, x.length = d) ∧ eps.length = N ∧ (∀ e ∈ eps, e = 1 ∨ e = -1)) ∧',
      'SameVec (U N) (vzero d) ∧',
      '((∀ j ∈ List.range (N + 1), Q.Le (norm2 (U j)) (sq B)) ∧ (B = 0 ∨ ∃ j ∈ List.range (N + 1), ¬ Q.Le (norm2 (U j)) (sq (B - 1)))) ∧',
      '((∀ j ∈ List.range (N + 1), Q.Le (norm2 (S j)) (sq D)) ∧ (D = 0 ∨ ∃ j ∈ List.range (N + 1), ¬ Q.Le (norm2 (S j)) (sq (D - 1)))) ∧',
      '((outputOrder eps).length = N ∧ (∀ i ∈ List.range N, (outputOrder eps).count i = 1) ∧ outputOrder eps = [',
      '(∀ k ∈ List.range (N + 1), if k ≤ p then SameVec (twice (W k)) (vadd (U (witness eps k)) (S (witness eps k)))',
      '(∀ k ∈ List.range (N + 1), Q.Le (norm2 (W k)) (Q.mul R R)) := by',
    ]) expect(theorem).toContain(fact)
    // Prefixes, signed copies, the order and the witnesses are Lean definitions applied to v and eps.
    expect(statement).toContain('def U (j : Nat) : Vec := walkPrefix d v j')
    expect(statement).toContain('def S (j : Nat) : Vec := walkPrefix d (signedCopies v eps) j')
    expect(statement).toContain('def W (k : Nat) : Vec := walkPrefix d (reordered v eps) k')
  })

  it('core Lean only: no import, sorry, native_decide, axiom declaration, unsafe code or option change', async () => {
    const { source } = await gen(desc('hero'))
    expect(source).not.toMatch(/^\s*import\b/m)
    expect(source).not.toMatch(/\bsorry\b|native_decide|\bunsafe\b|\bimplemented_by\b|\bextern\b|^\s*axiom\b|set_option|#eval|ofReduceBool/m)
    expect(source.match(/#print axioms/g)).toHaveLength(1)
    expect(source.match(/^theorem /gm)).toHaveLength(1)
  })

  it('occurrence IDs never reach Lean: hostile-looking IDs give the byte-identical source', async () => {
    const names = ['sorry', 'native_decide', 'import_mathlib', 'axiom_x', 'end_namespace', 'theorem_claim', 'by_decide', 'trust_me', 'zz', 'set_option', 'unsafe', 'eval']
    const hostile = describeWalkClaim(renamed(CASES.hero.input, (_, i) => names[i]!))
    const a = await gen(desc('hero'))
    const b = await gen(hostile)
    expect(b.hash).toBe(a.hash)
    expect(b.source).toBe(a.source)
    for (const n of names) expect(b.source).not.toContain(n)
    // The comments name source positions (v₀ … v₁₁), never an ID: every comment in the claim block is fixed text.
    const comments = b.statement.split('\n').flatMap((l) => { const m = /(?<![/-])--/.exec(l); return m ? [l.slice(m.index)] : [] })
    expect(comments[0]).toBe('-- Claim walk_reorder_instance, dimension 3, over the exact rationals ℚ: 12 vectors in source order.')
    expect(comments.slice(1)).toEqual(Array.from({ length: 12 }, (_, i) => `-- v${String(i).replace(/\d/g, (c) => '₀₁₂₃₄₅₆₇₈₉'[Number(c)]!)}`))
  })

  it('for the same N and dimension, two statements differ only in numbers', async () => {
    const skeleton = (s: string) => s.replace(/-?\d+/g, '#').replace(/ \/\. #/g, '')
    const hero = await gen(desc('hero'))
    const allPositive = await gen(desc('all-positive'))
    const edited = await gen(describeWalkClaim(flipped(CASES.hero.input, 'v1')))
    expect(skeleton(allPositive.statement)).toBe(skeleton(hero.statement))
    expect(skeleton(edited.statement)).toBe(skeleton(hero.statement))
    expect(allPositive.statement).toContain('def B : Nat := 5\ndef D : Nat := 5')
    expect(allPositive.statement).toContain('outputOrder eps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]')
  })

  it('the generator refuses anything the parser would have refused (defence in depth)', async () => {
    const { exact, hash } = await gen(desc('hero'))
    if (exact.kind !== 'walk_reorder_instance') throw new Error('unexpected kind')
    expect(() => generateWalkClaim(exact, 'not-a-hash')).toThrow(TemplateError)
    expect(() => generateWalkClaim({ ...exact, convention: 'x' as typeof BOUND_CONVENTION }, hash)).toThrow(/bound convention/)
    expect(() => generateWalkClaim({ ...exact, dimension: 4 as 3 }, hash)).toThrow(/dimension/)
    expect(() => generateWalkClaim({ ...exact, signs: exact.signs.map(() => 0 as Sign) }, hash)).toThrow(/one sign/)
    expect(() => generateWalkClaim({ ...exact, vectors: exact.vectors.map((v) => v.slice(0, 2)) }, hash)).toThrow(/dimension 3/)
  })
})
