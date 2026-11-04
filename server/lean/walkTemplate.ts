// Lean source for the proof lesson's finite claim, `walk_reorder_instance` (PROOF-EXPLORER-MATH section 8).
// Like template.ts, the source is a pure function of the parsed exact claim: numbers only (vectors and signs in
// source order, and the two integer bounds of the stated convention). Lean itself recomputes every prefix of
// the source, signed and reordered walks, the output order and each endpoint's witness from that data; the
// browser's derived answers never reach it. The theorem is a conjunction of finite facts, so it cannot succeed
// vacuously: a walk that does not return home makes conjunct (1) false and the claim is never certified.
//
// Core Lean 4 with `decide`, the fixed prelude of template.ts (integer-pair rationals) and no imports: the
// audit's empty-axiom policy applies unchanged. This checks one finite example, not the general lemma
// `signedOrder_prefix_bound` (whose formal proof is in the pinned source, not compiled here).

import { BOUND_CONVENTION, deriveWalk } from '../../src/algebra/walk'
import { type ExactWalkClaim, walkOf } from '../../src/workspace/walkClaim'
import { THEOREM, TemplateError, leanRational, preludeFor, type GeneratedClaim } from './template'

export const WALK_TEMPLATE_VERSION = 'mw-lean-walk-1'

/** Fixed walk definitions of this template version (appended to the shared prelude). */
const WALK_DEFS = `
/-! Vector walks. |u|² = Σᵢ uᵢ² is the squared Euclidean norm; for r ≥ 0, |u| ≤ r is stated as |u|² ≤ r². -/

/-- n/d ≤ n'/d' (positive denominators): n·d' ≤ n'·d. -/
def Q.Le (a b : Q) : Prop := a.num * b.den ≤ b.num * a.den
instance (a b : Q) : Decidable (Q.Le a b) := inferInstanceAs (Decidable (_ ≤ _))
/-- The rational n² for a natural number n. -/
def sq (n : Nat) : Q := ⟨n * n, 1⟩

/-- The zero vector of ℚᵈ. -/
def vzero (d : Nat) : Vec := List.replicate d 0
/-- u + v, coordinate by coordinate. -/
def vadd (u v : Vec) : Vec := List.zipWith Q.add u v
/-- −u. -/
def vneg (u : Vec) : Vec := u.map (fun x => -x)
/-- 2u = u + u. -/
def twice (u : Vec) : Vec := vadd u u
/-- |u|² = Σᵢ uᵢ². -/
def norm2 (u : Vec) : Q := (u.map (fun x => Q.mul x x)).foldr Q.add 0
/-- The endpoint after the first j vectors of vs, starting at the origin of ℚᵈ (j = 0: the origin). -/
def walkPrefix (d : Nat) (vs : List Vec) (j : Nat) : Vec := (vs.take j).foldl vadd (vzero d)
/-- The auxiliary signed copies εᵢvᵢ (εᵢ = 1 keeps vᵢ, otherwise −vᵢ). -/
def signedCopies (vs : List Vec) (eps : List Int) : List Vec := List.zipWith (fun v e => if e = 1 then v else vneg v) vs eps
/-- Source positions whose sign is +1, increasing. -/
def plusPositions (eps : List Int) : List Nat := (List.range eps.length).filter (fun i => eps.getD i 0 = 1)
/-- Source positions whose sign is −1, increasing. -/
def minusPositions (eps : List Int) : List Nat := (List.range eps.length).filter (fun i => eps.getD i 0 = -1)
/-- The output order (\`signedOrder\` in the source): +1 positions in source order, then −1 positions reversed. -/
def outputOrder (eps : List Int) : List Nat := plusPositions eps ++ (minusPositions eps).reverse
/-- The original vectors listed in the output order: the same arrows, only reordered (none is negated). -/
def reordered (vs : List Vec) (eps : List Int) : List Vec := (outputOrder eps).map (fun i => vs.getD i [])
/-- The source prefix j that accounts for reordered endpoint k: k ≤ p gives j = 0 or (k-th +1 position) + 1;
otherwise q = m − (k − p) unused −1 positions remain and j = 0 or (q-th −1 position) + 1. -/
def witness (eps : List Int) (k : Nat) : Nat :=
  if k ≤ (plusPositions eps).length then (if k = 0 then 0 else (plusPositions eps).getD (k - 1) 0 + 1)
  else if (minusPositions eps).length - (k - (plusPositions eps).length) = 0 then 0
  else (minusPositions eps).getD ((minusPositions eps).length - (k - (plusPositions eps).length) - 1) 0 + 1
`

const DIGITS = /^-?[0-9]+$/

/** Generate the Lean program of a parsed walk claim. `hash` is the server-recomputed claim hash. */
export function generateWalkClaim(c: ExactWalkClaim, hash: string): GeneratedClaim {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new TemplateError('claim hash must be 64 hex digits')
  const d = c.dimension
  const n = c.vectors.length
  // Defence in depth (the parser already enforces these): only numbers and fixed text reach the source.
  // Occurrence IDs never do (the comments name source positions v₀, v₁, …), and the convention is written from
  // the constant, not from the claim object.
  if (d !== 2 && d !== 3) throw new TemplateError('dimension must be 2 or 3')
  if (c.convention !== BOUND_CONVENTION) throw new TemplateError(`unknown bound convention (expected ${BOUND_CONVENTION})`)
  if (c.vectors.some((v) => v.length !== d)) throw new TemplateError(`data does not match dimension ${d}`)
  if (c.signs.length !== n || !c.signs.every((s) => s === 1 || s === -1)) throw new TemplateError('one sign (1 or -1) per vector')
  // The bound convention's two integers (least naturals with B² ≥ every |Uⱼ|², D² ≥ every |Sⱼ|²): the theorem
  // states them and Lean checks both that they bound every prefix and that no smaller natural does.
  const f = deriveWalk(walkOf(c))
  const B = f.B.toString()
  const D = f.D.toString()
  const order = f.permutation.join(', ')
  if (![B, D].every((x) => DIGITS.test(x))) throw new TemplateError('bounds must be naturals')
  const vecs = c.vectors.map((v, i) => `  [${v.map(leanRational).join(', ')}]${i < n - 1 ? ',' : ''}   -- v${subscript(i)}`)
  const block = [
    `-- Claim walk_reorder_instance, dimension ${d}, over the exact rationals ℚ: ${n} vectors in source order.`,
    `def d : Nat := ${d}`,
    `def N : Nat := ${n}`,
    `/-- The source vectors, in source order. -/`,
    'def v : List Vec := [',
    ...vecs,
    ']',
    '/-- One sign per source vector (+1 or −1), in source order. -/',
    `def eps : List Int := [${c.signs.join(', ')}]`,
    `/-- Integer bounds of convention ${BOUND_CONVENTION}: the least naturals bounding every source / signed prefix norm. -/`,
    `def B : Nat := ${B}`,
    `def D : Nat := ${D}`,
    '/-- The source walk Uⱼ, the auxiliary signed walk Sⱼ and the reordered walk W_k (prefix endpoints). -/',
    'def U (j : Nat) : Vec := walkPrefix d v j',
    'def S (j : Nat) : Vec := walkPrefix d (signedCopies v eps) j',
    'def W (k : Nat) : Vec := walkPrefix d (reordered v eps) k',
    '/-- p, the number of +1 signs: endpoints k ≤ p use the positive branch. -/',
    'def p : Nat := (plusPositions eps).length',
    '/-- The new bound R = (B + D)/2. -/',
    'def R : Q := ⟨B + D, 2⟩',
    '',
    `/-- This finite example satisfies the hypotheses and the conclusion of the reordering lemma, in squared norms:
every bound compares a squared Euclidean norm |x|² = Σᵢ xᵢ² with a squared bound.
(0) N vectors of ℚ^${d} and N signs ±1. (1) The source walk returns to its start: U_N = 0.
(2) |Uⱼ|² ≤ B² for every j ≤ N, and B is the least such natural. (3) |Sⱼ|² ≤ D² likewise for D.
(4) The output order lists every source position exactly once, and is [${order}].
(5) Every reordered endpoint is accounted for by its source prefix j = witness k: 2·W_k = Uⱼ + Sⱼ when k ≤ p,
    2·W_k = Sⱼ − Uⱼ otherwise. (6) Every reordered endpoint satisfies |W_k|² ≤ ((B + D)/2)².
Scope: these ${n} exact vectors and signs only. This file does not prove the general lemma. -/`,
    'theorem claim :',
    '    (v.length = N ∧ (∀ x ∈ v, x.length = d) ∧ eps.length = N ∧ (∀ e ∈ eps, e = 1 ∨ e = -1)) ∧',
    '    SameVec (U N) (vzero d) ∧',
    '    ((∀ j ∈ List.range (N + 1), Q.Le (norm2 (U j)) (sq B)) ∧ (B = 0 ∨ ∃ j ∈ List.range (N + 1), ¬ Q.Le (norm2 (U j)) (sq (B - 1)))) ∧',
    '    ((∀ j ∈ List.range (N + 1), Q.Le (norm2 (S j)) (sq D)) ∧ (D = 0 ∨ ∃ j ∈ List.range (N + 1), ¬ Q.Le (norm2 (S j)) (sq (D - 1)))) ∧',
    `    ((outputOrder eps).length = N ∧ (∀ i ∈ List.range N, (outputOrder eps).count i = 1) ∧ outputOrder eps = [${order}]) ∧`,
    '    (∀ k ∈ List.range (N + 1), if k ≤ p then SameVec (twice (W k)) (vadd (U (witness eps k)) (S (witness eps k)))',
    '      else SameVec (twice (W k)) (vadd (S (witness eps k)) (vneg (U (witness eps k))))) ∧',
    '    (∀ k ∈ List.range (N + 1), Q.Le (norm2 (W k)) (Q.mul R R)) := by',
    '  decide',
  ].join('\n')
  const source = `${preludeFor(WALK_TEMPLATE_VERSION)}${WALK_DEFS}\n-- Claim hash ${hash}\n${block}\n\nend MathWorkspace\n\n#print axioms ${THEOREM}\n`
  return { source, statement: block }
}

const SUB = '₀₁₂₃₄₅₆₇₈₉'
const subscript = (i: number) => String(i).split('').map((c) => SUB[Number(c)]).join('')
