// Lean source generation for the M9 claim kinds (MATHEMATICAL-CONTRACT M9). The source is a pure
// function of the parsed exact claim: numbers only. Labels, IDs and other client text never reach Lean,
// so equal claim hashes always yield the same program and no client string can become Lean code.
//
// Rationals are integer pairs with cross-multiplied equality (docs/LEAN.md, "Encoding"). The prelude is
// fixed per TEMPLATE_VERSION; only the claim block below it varies.

import type { ExactClaim } from '../../src/workspace/claims'
import type { Mat, Vec } from '../../src/model/linear'
import type { Q } from '../../src/model/rational'

export const TEMPLATE_VERSION = 'mw-lean-claims-1'
/** Every template proves exactly this theorem; the audit accepts no other name. */
export const THEOREM = 'MathWorkspace.claim'

export class TemplateError extends Error {
  override name = 'TemplateError'
}

/** The fixed prelude of a template version (the walk template, server/lean/walkTemplate.ts, reuses it). */
export const preludeFor = (version: string): string => `-- Math Workspace claim, template ${version}. Core Lean 4 only: no imports, no mathlib.
-- Domain: the exact rational data written below. This is not a theorem about every real vector.
namespace MathWorkspace

/-- The rational number num/den as an integer pair (every den below is positive). Pairs are not
reduced: two pairs denote the same rational exactly when they cross-multiply equal (\`Q.Same\`). -/
structure Q where
  num : Int
  den : Nat

namespace Q
/-- \`n /. d\` is the pair for n/d. -/
def frac (n : Int) (d : Nat) : Q := ⟨n, d⟩
instance : OfNat Q n := ⟨⟨n, 1⟩⟩
instance : Neg Q := ⟨fun a => ⟨-a.num, a.den⟩⟩
/-- n/d + n'/d' = (n·d' + n'·d)/(d·d'). -/
def add (a b : Q) : Q := ⟨a.num * b.den + b.num * a.den, a.den * b.den⟩
/-- (n/d)·(n'/d') = (n·n')/(d·d'). -/
def mul (a b : Q) : Q := ⟨a.num * b.num, a.den * b.den⟩
/-- n/d and n'/d' are the same rational: n·d' = n'·d. -/
def Same (a b : Q) : Prop := a.num * b.den = b.num * a.den
instance (a b : Q) : Decidable (Same a b) := inferInstanceAs (Decidable (_ = _))
end Q

infixl:70 " /. " => Q.frac

/-- A vector of ℚᵈ, listed by coordinate. -/
abbrev Vec := List Q
/-- A d × d matrix over ℚ, listed by rows. Column vectors: (A v)ᵢ = Σⱼ Aᵢⱼ vⱼ. -/
abbrev Mat := List (List Q)

/-- Equal vectors of ℚᵈ: the same length and every coordinate the same rational. -/
def SameVec (u v : Vec) : Prop := u.length = v.length ∧ ∀ p ∈ u.zip v, Q.Same p.1 p.2
instance (u v : Vec) : Decidable (SameVec u v) := inferInstanceAs (Decidable (_ ∧ _))
/-- Entrywise equal matrices: the same number of rows and every row the same vector. -/
def SameMat (A B : Mat) : Prop := A.length = B.length ∧ ∀ p ∈ A.zip B, SameVec p.1 p.2
instance (A B : Mat) : Decidable (SameMat A B) := inferInstanceAs (Decidable (_ ∧ _))

/-- Σᵢ rᵢ vᵢ. -/
def dot (r v : Vec) : Q := (List.zipWith Q.mul r v).foldr Q.add 0
/-- The image A v. -/
def Mat.mulVec (A : Mat) (v : Vec) : Vec := A.map (fun row => dot row v)
/-- Column j of B. -/
def Mat.col (B : Mat) (j : Nat) : Vec := B.map (fun row => row.getD j 0)
/-- The product A B: apply B first, then A. -/
def Mat.mul (A B : Mat) : Mat := A.map (fun row => (List.range B.length).map (fun k => dot row (B.col k)))
/-- The d × d identity. -/
def identity (d : Nat) : Mat := (List.range d).map (fun i => (List.range d).map (fun j => if i = j then 1 else 0))
/-- The ordered steps M₁ → M₂ → … → Mₖ resolve to Mₖ ⋯ M₂ M₁ (M₁ acts first); no steps is the identity. -/
def compose (d : Nat) (steps : List Mat) : Mat := steps.foldl (fun acc M => M.mul acc) (identity d)
`

const DIGITS = /^-?[0-9]+$/

/** `3`, `-1`, `-3 /. 8`. Input is an already-normalized rational (positive denominator). */
export function leanRational(x: Q): string {
  const n = x.n.toString()
  const d = x.d.toString()
  if (!DIGITS.test(n) || !DIGITS.test(d) || x.d <= 0n) throw new TemplateError('not a normalized rational')
  return x.d === 1n ? n : `${n} /. ${d}`
}

const vecText = (v: Vec): string => `[${v.map(leanRational).join(', ')}]`
const matText = (m: Mat): string => `[${m.map(vecText).join(', ')}]`

function checkShape(d: number, mats: readonly Mat[], vecs: readonly Vec[]): void {
  const ok = mats.every((m) => m.length === d && m.every((r) => r.length === d)) && vecs.every((v) => v.length === d)
  if (!ok) throw new TemplateError(`data does not match dimension ${d}`)
}

/** Step definitions `p1 … pk` and the composed map `name`, with the order spelled out. */
function sequenceBlock(prefix: string, name: string, d: number, steps: readonly Mat[]): string {
  const ids = steps.map((_, i) => `${prefix}${i + 1}`)
  const defs = steps.map((m, i) => `def ${ids[i]} : Mat := ${matText(m)}`)
  const doc =
    ids.length === 0 ? `No steps, so ${name} is the ${d} × ${d} identity.`
    : ids.length === 1 ? `One step, so ${name} = ${ids[0]}.`
    : `Steps ${ids.join(' → ')} (${ids[0]} acts first), so ${name} = ${[...ids].reverse().join(' · ')}.`
  return [...defs, `/-- ${doc} -/`, `def ${name} : Mat := compose ${d} [${ids.join(', ')}]`].join('\n')
}

export interface GeneratedClaim {
  /** Complete Lean file (prelude, claim block, axiom audit command). */
  source: string
  /** The claim block alone: the canonical human-readable statement. */
  statement: string
}

/** Generate the Lean program for a parsed exact claim. `hash` is the server-recomputed claim hash. */
export function generateClaim(c: ExactClaim, hash: string): GeneratedClaim {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new TemplateError('claim hash must be 64 hex digits')
  const d = c.dimension
  let block: string
  switch (c.kind) {
    case 'same_image_witness':
      checkShape(d, c.sequence, [c.u, c.v])
      block = [
        `-- Claim same_image_witness, dimension ${d}, over the exact rationals ℚ.`,
        sequenceBlock('a', 'A', d, c.sequence),
        `def u : Vec := ${vecText(c.u)}`,
        `def v : Vec := ${vecText(c.v)}`,
        '',
        `/-- u and v are different vectors of ℚ^${d} with the same image under A. -/`,
        'theorem claim : ¬ SameVec u v ∧ SameVec (A.mulVec u) (A.mulVec v) := by',
        '  decide',
      ].join('\n')
      break
    case 'map_equality':
      checkShape(d, [...c.left, ...c.right], [])
      block = [
        `-- Claim map_equality, dimension ${d}, over the exact rationals ℚ.`,
        sequenceBlock('a', 'A', d, c.left),
        sequenceBlock('b', 'B', d, c.right),
        '',
        `/-- A and B are the same ${d} × ${d} matrix over ℚ, entry by entry. -/`,
        'theorem claim : SameMat A B := by',
        '  decide',
      ].join('\n')
      break
    case 'map_difference_witness': {
      const j = c.basisIndex
      if (!Number.isInteger(j) || j < 0 || j >= d) throw new TemplateError(`basis index ${j} outside 0..${d - 1}`)
      checkShape(d, [...c.left, ...c.right], [])
      const e = `e${j + 1}`
      block = [
        `-- Claim map_difference_witness, dimension ${d}, over the exact rationals ℚ.`,
        sequenceBlock('a', 'A', d, c.left),
        sequenceBlock('b', 'B', d, c.right),
        `/-- The standard basis vector ${e} of ℚ^${d} (stored index ${j}). -/`,
        `def ${e} : Vec := [${Array.from({ length: d }, (_, i) => (i === j ? '1' : '0')).join(', ')}]`,
        '',
        `/-- A and B differ: they send ${e} to different vectors of ℚ^${d}. -/`,
        `theorem claim : ¬ SameVec (A.mulVec ${e}) (B.mulVec ${e}) := by`,
        '  decide',
      ].join('\n')
      break
    }
    case 'walk_reorder_instance':
      // A different template version with its own definitions (server/lean/walkTemplate.ts, via templates.ts).
      throw new TemplateError('walk claims are generated by the walk template')
  }
  const source = `${preludeFor(TEMPLATE_VERSION)}\n-- Claim hash ${hash}\n${block}\n\nend MathWorkspace\n\n#print axioms ${THEOREM}\n`
  return { source, statement: block }
}
