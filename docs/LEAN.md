# Lean checker (Lean track)

Server-side checker for the three M9 claim kinds (MATHEMATICAL-CONTRACT M9, WORKSPACE-AND-AI W6,
ACCEPTANCE A5). Owner: Lean track. Files: `server/lean/**`, `tests/lean/**` and this document.

| File | Role |
|---|---|
| `server/lean/index.ts` | `checkRoute` (POST `/api/check`), `leanCapabilities()`, `createChecker(deps)` for injection, `resolveReceipt(id, hash)`, `resolveEvidence(doc, refs)` (W5) |
| `server/lean/evidence.ts` | W5 resolution: `resolveEvidenceWith(doc, refs, lookup)`, `ResolvedEvidence`, `allUnavailable` |
| `server/lean/template.ts` | `TEMPLATE_VERSION = 'mw-lean-claims-1'`, `THEOREM = 'MathWorkspace.claim'`, `generateClaim(claim, hash)` |
| `server/lean/runner.ts` | Pinned toolchain, `runProcess` / `runLean` with the process limits, `probeToolchain()` |
| `server/lean/audit.ts` | `auditRun(run, theorem)`, `APPROVED_AXIOMS = []` |
| `server/lean/receipts.ts` | Bounded session receipt registry |
| `tests/lean/*.test.ts` | Real compiles (6) plus W5 on real receipts, injected route cases, W5 boundary cases, process limits |

## Trust boundary

What "Lean checked" means here: Lean 4.26.0's kernel accepted a `decide` proof of the generated
theorem `MathWorkspace.claim`, and `#print axioms` reports that the theorem depends on no axioms.
The theorem is about the specific rational vectors and matrices written in the source. It is not a
theorem about every real vector, and it says so in the source.

Trusted, in order:

1. **The Lean 4.26.0 kernel and core library.** The binary is pinned by path and by commit
   `d8204c9fd894f91bbb2cdfec5912ec8196fd8562`.
2. **The prelude below**, fixed per `TEMPLATE_VERSION`. It defines what `Q`, `SameVec`, `SameMat`,
   `Mat.mulVec`, `Mat.mul` and `compose` mean. It is about 30 lines and should be reviewed once
   per template version.
3. **The generator** (`template.ts`). It writes the descriptor's exact numbers into the claim block.
   - Faithfulness to the descriptor is enforced in TypeScript: the closed `parseClaimDescriptor`, a
     shape check, and numbers that are only ever printed from normalized `bigint`s.
   - Faithfulness is not proved in Lean. Reading the claim block against the descriptor is how
     you confirm it.

Not trusted, and never authority:

- anything the browser sends besides the exact descriptor (the envelope is closed);
- client hashes, results and receipts;
- labels and IDs;
- Lean's exit code on its own.

## Encoding of rationals (decision, accepted by the coordinator)

A rational is an integer pair `⟨num, den⟩` with `den > 0`. Pairs are **not reduced**. Equality of
denoted rationals is cross-multiplication (`Q.Same`). Addition and multiplication are the textbook
pair formulas. Literals print as `3`, `-1` or `-3 /. 8`.

Why this encoding:

- **No axioms.**
  - The integer and list machinery used here (`Int.mul`, `Int.decEq`, `Nat.gcd`, `List.zipWith`,
    `List.hasDecEq`) is axiom-free in core (verified with `#print axioms`). So every generated
    theorem reports `does not depend on any axioms`.
  - The audit can therefore approve the **empty** set.
- **Core `Rat` was measured and rejected.** It exists in core 4.26 (`Init/Data/Rat`) and would read
  more naturally, but:
  - `#print axioms Rat.mul` and `Rat.add` each report
    `[propext, Classical.choice, Quot.sound]`. These come from the library's proofs of its
    normalization invariant, so every statement using `Rat` arithmetic inherits them.
  - Its arithmetic is `@[irreducible]`, so plain `decide` stalls on it.
- **Cross-multiplication needs no invariant.** A reduced-pair encoding with structural `=` is
  correct only if every value is canonical. Cross-multiplication is correct for any nonzero
  denominators. All denominators here are positive, because they are products of positive
  denominators.
- **No reduction step is needed.**
  - The stress case is six dense 3 × 3 steps with prime denominators near 10⁶, composed
    unreduced. It compiles in about 0.3 s, with integers of tens of thousands of bits, using both
    `decide` and `decide +kernel`.
  - Authored inputs are smaller than that (see "Enforced bounds").
- **Proofs are plain `decide`.** The elaborator evaluates the `Decidable` instance and the kernel
  re-checks the `of_decide_eq_true` term. There is no `native_decide` (which would add
  `Lean.ofReduceBool, Lean.trustCompiler`) and no `sorry`.
- **No labels or IDs in the source.**
  - Steps are `a1…ak` (left / single sequence) and `b1…bk` (right), compositions are `A` and `B`,
    witnesses are `u` and `v`, and the basis vector is `e{j+1}` (1-based, as in the client's text).
  - The source is a pure function of the claim-hash payload: equal hashes give byte-identical
    programs, and no client string can reach Lean.
  - The client maps these names to display labels.

## Prelude (verbatim, `mw-lean-claims-1`)

Every generated file is this prelude, then a blank line, then `-- Claim hash <hex>`, the claim block,
`end MathWorkspace` and `#print axioms MathWorkspace.claim`.

```lean
-- Math Workspace claim, template mw-lean-claims-1. Core Lean 4 only: no imports, no mathlib.
-- Domain: the exact rational data written below. This is not a theorem about every real vector.
namespace MathWorkspace

/-- The rational number num/den as an integer pair (every den below is positive). Pairs are not
reduced: two pairs denote the same rational exactly when they cross-multiply equal (`Q.Same`). -/
structure Q where
  num : Int
  den : Nat

namespace Q
/-- `n /. d` is the pair for n/d. -/
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
```

## Generated sources (verbatim, one per kind)

The tails below follow the prelude above. Each was generated by `generateClaim` from a real
descriptor, compiled with the pinned toolchain, and passed the audit.

- **Inspection:** checked by hand for dimension, values, operation order and witness.
- **Response:** the `statement` field returned to the client is the claim block, from
  `-- Claim <kind>…` through `  decide`.

### same_image_witness: the P collision (P = diag(1,1,0), u = (1,0,1), v = (1,0,−1))

```lean
-- Claim hash 17669682ebea627a7d315a08220babdccb080ec3e6b66460ef6ef97dce477776
-- Claim same_image_witness, dimension 3, over the exact rationals ℚ.
def a1 : Mat := [[1, 0, 0], [0, 1, 0], [0, 0, 0]]
/-- One step, so A = a1. -/
def A : Mat := compose 3 [a1]
def u : Vec := [1, 0, 1]
def v : Vec := [1, 0, -1]

/-- u and v are different vectors of ℚ^3 with the same image under A. -/
theorem claim : ¬ SameVec u v ∧ SameVec (A.mulVec u) (A.mulVec v) := by
  decide

end MathWorkspace

#print axioms MathWorkspace.claim
```

### map_equality: P then P equals P

```lean
-- Claim hash 3acb08d95aa00e9adc4df8dbaaed939a3b36e79d363a8957280c745b63aecf56
-- Claim map_equality, dimension 3, over the exact rationals ℚ.
def a1 : Mat := [[1, 0, 0], [0, 1, 0], [0, 0, 0]]
def a2 : Mat := [[1, 0, 0], [0, 1, 0], [0, 0, 0]]
/-- Steps a1 → a2 (a1 acts first), so A = a2 · a1. -/
def A : Mat := compose 3 [a1, a2]
def b1 : Mat := [[1, 0, 0], [0, 1, 0], [0, 0, 0]]
/-- One step, so B = b1. -/
def B : Mat := compose 3 [b1]

/-- A and B are the same 3 × 3 matrix over ℚ, entry by entry. -/
theorem claim : SameMat A B := by
  decide

end MathWorkspace

#print axioms MathWorkspace.claim
```

### map_difference_witness: P vs Q = diag(0,1,1) on e1

```lean
-- Claim hash 98ddd36ac19806f2ec82bf8240138afcc66978e757545ae2385e7490f87b16f1
-- Claim map_difference_witness, dimension 3, over the exact rationals ℚ.
def a1 : Mat := [[1, 0, 0], [0, 1, 0], [0, 0, 0]]
/-- One step, so A = a1. -/
def A : Mat := compose 3 [a1]
def b1 : Mat := [[0, 0, 0], [0, 1, 0], [0, 0, 1]]
/-- One step, so B = b1. -/
def B : Mat := compose 3 [b1]
/-- The standard basis vector e1 of ℚ^3 (stored index 0). -/
def e1 : Vec := [1, 0, 0]

/-- A and B differ: they send e1 to different vectors of ℚ^3. -/
theorem claim : ¬ SameVec (A.mulVec e1) (B.mulVec e1) := by
  decide

end MathWorkspace

#print axioms MathWorkspace.claim
```

### map_difference_witness: A1 order, R then S versus S then R on e1

Here R = [[0,−1],[1,0]] and S = [[1,0],[0,−1]]. So A = S·R sends e1 to (0, −1), and B = R·S sends
e1 to (0, 1).

```lean
-- Claim hash 079e683c15bc1dc37d7b474e0d570d48dabccca52e09b6b5c62de8a14b439d15
-- Claim map_difference_witness, dimension 2, over the exact rationals ℚ.
def a1 : Mat := [[0, -1], [1, 0]]
def a2 : Mat := [[1, 0], [0, -1]]
/-- Steps a1 → a2 (a1 acts first), so A = a2 · a1. -/
def A : Mat := compose 2 [a1, a2]
def b1 : Mat := [[1, 0], [0, -1]]
def b2 : Mat := [[0, -1], [1, 0]]
/-- Steps b1 → b2 (b1 acts first), so B = b2 · b1. -/
def B : Mat := compose 2 [b1, b2]
/-- The standard basis vector e1 of ℚ^2 (stored index 0). -/
def e1 : Vec := [1, 0]

/-- A and B differ: they send e1 to different vectors of ℚ^2. -/
theorem claim : ¬ SameVec (A.mulVec e1) (B.mulVec e1) := by
  decide

end MathWorkspace

#print axioms MathWorkspace.claim
```

## Audit rule

`lean --json Claim.lean` prints one JSON message per line. A run is accepted only if **all** of the
following hold:

- there was no spawn failure, abort, timeout or output overflow;
- stderr is empty;
- every stdout line parses as a JSON message with string `severity` and `data`;
- every message has severity `information` (any `warning` or `error` rejects);
- the exit code is 0;
- there is exactly one message;
- that message, with whitespace collapsed, matches
  `'MathWorkspace.claim' does not depend on any axioms` or
  `'MathWorkspace.claim' depends on axioms: [ … ]`, with exactly that theorem name;
- every listed axiom is in `APPROVED_AXIOMS = []`. So **any** axiom rejects, including `propext`,
  `Classical.choice` and `Quot.sound`. These would indicate a template regression. `sorryAx` and
  `Lean.ofReduceBool` get their own named reasons.

Negative controls on real Lean output (phase 1). They show that exit status proves nothing:

| Variant | Lean exit | Output | Audit |
|---|---|---|---|
| False claim (v = (0,0,1)) | 1 | error "decide proved that the proposition … is false", `[sorryAx]` | rejected |
| `sorry` | **0** | warning `declaration uses 'sorry'`, `[sorryAx]` | rejected |
| `native_decide` | **0** | no warning, `[Lean.ofReduceBool, Lean.trustCompiler]` | rejected |
| Renamed theorem | 1 | error `Unknown constant MathWorkspace.claim` | rejected |

A compile failure, a timeout or a rejected audit is `not_established`: not verified, and never a
disproof.

## Process limits actually enforced

- **Pinned binary.** It is called directly, never through the elan proxy (which can auto-install a
  toolchain): `$ELAN_HOME/toolchains/leanprover--lean4---v4.26.0/bin/lean --json Claim.lean`, where
  `ELAN_HOME` defaults to `~/.elan`.
  - `probeToolchain()` requires `lean --githash` to equal the pinned commit. A success is cached for
    the process; a failure is retried on the next call.
  - Toolchain identifier: `leanprover/lean4:v4.26.0 (d8204c9fd894)`.
- **Fresh directory per run.** Each run gets its own `mkdtemp($TMPDIR/mw-lean-)` as working
  directory, removed in `finally`, including after a timeout, abort or error. The run has minimal
  environment variables `PATH=/usr/bin:/bin`, `HOME=<temp dir>`, `LANG=C`, and stdin is ignored.
- **Timeout.** 15 s, then SIGKILL.
- **Output cap.** 64 KiB of stdout and stderr combined, then SIGKILL; the audit rejects.
- **Abort.** The request's `AbortSignal` (client disconnect or the 45 s application timeout) sends
  SIGKILL. An already-aborted signal never spawns a process. The response is `status: 'error'`.
- **One proof at a time.** A second request that needs Lean while one runs gets **429
  `checker_busy`** (`retryable: true`). There is no queue. False claims and invalid requests need no
  Lean, so they are answered even while busy.
- **Enforced bounds.** Every step entry and witness coordinate must lie in the M1 authored range
  [−4, 4] with denominators of at most 1,000,000 (`checkAuthoredMatrix` / `checkAuthoredVector`);
  otherwise 400 `capacity`.
  - At most six steps per sequence and d ∈ {2, 3} (from `parseClaimDescriptor`).
  - The 256-bit budget during `evaluateExactly`; otherwise 400 `capacity`.
- **No memory limit is claimed.** Lean's `-M` flag did not stop a run even at `-M 8`, so it is not
  used. Memory use is bounded only indirectly, by the input bounds above and the timeout.

## Statuses and HTTP codes

| Case | HTTP | Body |
|---|---|---|
| Envelope not `{ requestId, claim }` (for example a client `claimHash`, `status` or `receipt`), bad request ID, invalid descriptor or malformed rational | 400 | `{ code: 'invalid_claim', message, retryable: false }`, no Lean run |
| Outside authored bounds or the 256-bit budget | 400 | `{ code: 'capacity', … }`, no Lean run |
| Claim false by `evaluateExactly` | 200 | `not_established`, reason `Computed exactly, the claim is false: <detail>. It was not submitted to Lean.` |
| Pinned toolchain unavailable | 503 | `{ code: 'checker_unavailable', retryable: false }` |
| Another proof running | 429 | `{ code: 'checker_busy', retryable: true }` |
| Compile error, timeout, overflow, stderr, audit rejection | 200 | `not_established`, specific reason |
| Cancelled, or process could not start | 200 | `error`, reason |
| Compiled and audited | 200 | `checked`, `provenance`, `receipt` |

`requestId` must match `^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$`. `timing.ms` is the total server time
for the request. `statement` and `claimHash` are present in every 200 body.

## Receipts

- Receipts are issued only by `checkRoute`, after a successful audit.
- Each receipt is bound to the server-recomputed `claimHash`, `templateVersion`, `toolchain`,
  `theorem`, the audited `axioms` and `issuedAt`. Its `id` is a `randomUUID()`.
- The registry is in memory, holds at most 64 receipts, and evicts the oldest first.
  `resolveReceipt(id, hash)` returns a record only for the exact hash it was issued for.
- The registry lives as long as the `server/lean/index.ts` module instance. A server restart, or a
  Vite reload of the module, empties it, and earlier results become historical.
- The assistant route reaches the same instance: under Vite's SSR loader, `server/index.ts` and the
  assistant module's lazy `import('../lean/index')` resolve to one module (checked on 2026-10-29 by
  loading `/server/index.ts` through `ssrLoadModule`, issuing a real receipt with `POST /api/check` and
  resolving it as `verified` through `defaultResolveEvidence`).

## W5: server-resolved evidence for the assistant

The browser sends evidence references `{ claim, claimHash, receiptId }` with an assistant request
(`EvidenceRef`, validated closed by `parseEvidenceRefs`, at most 8). `claim` is a typed `ClaimRequest`
locator into the submitted document. The hash and the receipt ID are lookup keys only; nothing the
browser asserts is evidence. `resolveEvidence(doc, refs)` resolves each reference, in order, against the
document the server rebuilt with `docFromJson`:

1. **Locator.** `describeClaim(doc, claim)` must succeed: the experiments, branches and samples exist
   and the dimensions agree. Otherwise `unresolved_reference` (a deleted or never-existing reference).
2. **Exact claim.** `parseClaimDescriptor` then `claimHash`: the same shared code as the client and
   `POST /api/check`. Labels and IDs are not hashed.
3. **Hash.** A recomputed hash different from `claimHash` is unavailable: `historical` when this
   server holds a receipt with that ID for the recorded hash (a real proof about different exact data),
   otherwise `hash_mismatch`.
4. **Receipt.** `receipts.resolve(receiptId, recomputedHash)`: none (fabricated, evicted, or issued
   before a restart) is `no_receipt`, and a new check is needed. The receipt's provenance is audited
   again: template `mw-lean-claims-1`, theorem `MathWorkspace.claim`, the pinned toolchain and only
   approved axioms (none), otherwise `provenance_rejected`.
5. **Only then** the entry is `verified`, with the canonical statement (the claim block that
   `generateClaim` produces for exactly this claim: numbers only), display names reconstructed from the
   **current** document (branch `ref`, `symbol`, chronological `order`, whether it is displayed, its
   comparison side from the binding ports; sample IDs, labels and coordinates; the basis vector), and the
   provenance (receipt ID, issue time, template, toolchain, theorem, axioms).

Every entry also carries `computed`, the exact rational evaluation on the current data ("computed
exactly", never "Lean checked"), and a fixed `note`. Unavailable entries never carry a statement,
hash or provenance. When the proof module cannot be consulted, the assistant marks every reference
`checker_unavailable`. Resolution runs on the server per assistant request, never in a frame callback.

| Status / reason | Meaning for Muse |
|---|---|
| `verified` | Server-verified for the current inputs; may be called Lean-checked for that concrete data |
| `unavailable` / `unresolved_reference` | The reference no longer exists in the document |
| `unavailable` / `historical` | A real receipt covers different exact data; historical at most, never about the current inputs |
| `unavailable` / `hash_mismatch` | The current data does not match the recorded claim; no receipt for either |
| `unavailable` / `no_receipt` | No matching receipt in this server session; a new check is needed |
| `unavailable` / `provenance_rejected` | The receipt is not from the audited template, theorem, toolchain and axioms |
| `unavailable` / `checker_unavailable` | The proof service could not be consulted |

Because the hash covers mathematical content only, a rename (`update_map` with a new label and the
same matrix) or a presentation move (view flags, selection) keeps a claim `verified`, with the new
names. Undo to identical exact data makes it `verified` again with the same receipt. A receipt is
never transferred: P's same-image receipt stays P's when Q is displayed (P remains a valid, current
claim elsewhere), and the same receipt pointed at Q is `historical` (computed exactly, Qu ≠ Qv). A
P/Q receipt is not authority for the R/S comparison, and a comparison receipt becomes `historical`
when a branch is edited.

Boundary tests (`tests/lean/evidence.test.ts`, injected runner, receipts issued by the check route):
valid current receipt (P collision; SR e1 ≠ RS e1 with sides from the binding ports); fabricated ID;
hash mismatch; edited matrix; edited witness; unresolved and deleted references (Q after undo, a
missing branch, a missing sample, a `$name` locator); server registry loss; rejected provenance;
unreachable service; rename and presentation moves; undo to identical content; switching the display
to Q; a P/Q receipt pointed at the comparison; an edited branch (difference receipt historical,
equality receipt current only while the routes agree). `tests/lean/check.test.ts` repeats the last
case with **real** Lean receipts.

## Sample requests and responses (real runs of `checkRoute`)

Responses were produced by the mounted `checkRoute` with the real toolchain. Statements are elided
here as `…`; each is the claim block shown above.

### same_image_witness (P collision): checked

Request:

```json
{"requestId":"req-same_image","claim":{"claimVersion":1,"kind":"same_image_witness","dimension":3,"sequence":[{"mapId":"map-p","label":"P","matrix":[[{"n":"1","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"1","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}]]}],"u":{"sampleId":"s(1,0,1)","label":"u","coords":[{"n":"1","d":"1"},{"n":"0","d":"1"},{"n":"1","d":"1"}]},"v":{"sampleId":"s(1,0,-1)","label":"v","coords":[{"n":"1","d":"1"},{"n":"0","d":"1"},{"n":"-1","d":"1"}]}}}
```

Response (HTTP 200):

```json
{
  "requestId": "req-same_image",
  "claimHash": "17669682ebea627a7d315a08220babdccb080ec3e6b66460ef6ef97dce477776",
  "statement": "…",
  "status": "checked",
  "provenance": {
    "templateVersion": "mw-lean-claims-1",
    "toolchain": "leanprover/lean4:v4.26.0 (d8204c9fd894)",
    "theorem": "MathWorkspace.claim",
    "axioms": [],
    "inputHash": "17669682ebea627a7d315a08220babdccb080ec3e6b66460ef6ef97dce477776"
  },
  "receipt": {
    "id": "88bd89b7-a03f-4640-bfcf-3fe09d64c12f",
    "issuedAt": "2026-10-29T03:38:06.604Z"
  },
  "reason": null,
  "timing": {
    "ms": 254
  }
}
```

### map_equality (P then P = P): checked

Request:

```json
{"requestId":"req-map_equality","claim":{"claimVersion":1,"kind":"map_equality","dimension":3,"left":[{"mapId":"map-p","label":"P","matrix":[[{"n":"1","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"1","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}]]},{"mapId":"map-p","label":"P","matrix":[[{"n":"1","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"1","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}]]}],"right":[{"mapId":"map-p","label":"P","matrix":[[{"n":"1","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"1","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}]]}]}}
```

Response (HTTP 200):

```json
{
  "requestId": "req-map_equality",
  "claimHash": "3acb08d95aa00e9adc4df8dbaaed939a3b36e79d363a8957280c745b63aecf56",
  "statement": "…",
  "status": "checked",
  "provenance": {
    "templateVersion": "mw-lean-claims-1",
    "toolchain": "leanprover/lean4:v4.26.0 (d8204c9fd894)",
    "theorem": "MathWorkspace.claim",
    "axioms": [],
    "inputHash": "3acb08d95aa00e9adc4df8dbaaed939a3b36e79d363a8957280c745b63aecf56"
  },
  "receipt": {
    "id": "746f8ef5-740b-4c55-9889-603327e4e923",
    "issuedAt": "2026-10-29T03:38:06.833Z"
  },
  "reason": null,
  "timing": {
    "ms": 228
  }
}
```

### map_difference_witness (P vs Q on e1): checked

Request:

```json
{"requestId":"req-map_difference","claim":{"claimVersion":1,"dimension":3,"left":[{"mapId":"map-p","label":"P","matrix":[[{"n":"1","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"1","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}]]}],"right":[{"mapId":"map-q","label":"Q","matrix":[[{"n":"0","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"1","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"0","d":"1"},{"n":"1","d":"1"}]]}],"kind":"map_difference_witness","basisIndex":0}}
```

Response (HTTP 200):

```json
{
  "requestId": "req-map_difference",
  "claimHash": "98ddd36ac19806f2ec82bf8240138afcc66978e757545ae2385e7490f87b16f1",
  "statement": "…",
  "status": "checked",
  "provenance": {
    "templateVersion": "mw-lean-claims-1",
    "toolchain": "leanprover/lean4:v4.26.0 (d8204c9fd894)",
    "theorem": "MathWorkspace.claim",
    "axioms": [],
    "inputHash": "98ddd36ac19806f2ec82bf8240138afcc66978e757545ae2385e7490f87b16f1"
  },
  "receipt": {
    "id": "1ade1a71-a146-4955-97cb-70ef7b2e64da",
    "issuedAt": "2026-10-29T03:38:07.036Z"
  },
  "reason": null,
  "timing": {
    "ms": 202
  }
}
```

### map_difference_witness with an incorrect witness (P vs Q on e2): not established

Request:

```json
{"requestId":"req-bad_witness","claim":{"claimVersion":1,"dimension":3,"left":[{"mapId":"map-p","label":"P","matrix":[[{"n":"1","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"1","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}]]}],"right":[{"mapId":"map-q","label":"Q","matrix":[[{"n":"0","d":"1"},{"n":"0","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"1","d":"1"},{"n":"0","d":"1"}],[{"n":"0","d":"1"},{"n":"0","d":"1"},{"n":"1","d":"1"}]]}],"kind":"map_difference_witness","basisIndex":1}}
```

Response (HTTP 200):

```json
{
  "requestId": "req-bad_witness",
  "claimHash": "673f56ba2d89225f73a0fd3620ffee8312a2f1ebc8ac7c97ce4503e8fed07eff",
  "statement": "…",
  "status": "not_established",
  "provenance": null,
  "receipt": null,
  "reason": "Computed exactly, the claim is false: both send e2 to (0, 1, 0). It was not submitted to Lean.",
  "timing": {
    "ms": 0
  }
}
```

## Tests

`npx vitest run tests/lean` runs four files:

- **`check.test.ts`** makes 6 real compiles through `checkRoute`, using the descriptors built in
  `fixtures.ts` (the workspace descriptors come from `describeClaim`):
  - the P collision;
  - P vs Q on e1;
  - P then P = P;
  - the A1 R/S order (2D, hand-built);
  - the 3D operation-order comparison from the prepared demo actions: `map_difference_witness` with
    left = [R, S], right = [S, R], basis index 0 (SR e1 = (0, −1, 0) ≠ RS e1 = (0, 1, 0));
  - `map_equality` after the left route is reversed, so both routes are [S, R].

  Each is checked for provenance and the receipt binding to the recomputed hash (and the first for
  temp-directory cleanup). A further test resolves the real comparison receipts through
  `resolveEvidence`: `verified` while current, `historical` after the branch edit, the equality receipt
  `verified`, and after Undo the difference `verified` again and the equality `historical`. The file is
  skipped when the pinned toolchain is absent.
- **`evidence.test.ts`** covers the W5 boundary cases above with an injected runner.
- **`route.test.ts`** uses an injected runner:
  - malformed rationals and unknown or browser-supplied fields (400, no run);
  - capacity (400);
  - false same-image, equal inputs, an incorrect witness and a false equality (`not_established`,
    no run);
  - 16 audit anomalies, including `sorryAx`, `native_decide`, extra or standard axioms, renamed or
    missing theorems, warnings, stderr, exit code, overflow and timeout (none issue a receipt);
  - busy (429), real-signal abort, spawn failure, unavailable (503);
  - receipt binding and eviction;
  - label independence of the hash and statement.
- **`runner.test.ts`** exercises SIGKILL timeout, abort, the output cap, spawn failure and the
  minimal environment on real non-Lean processes.

## Requests to the coordinator

None required. Notes:

- `resolveReceipt(id, hash)` and `resolveEvidence(doc, refs)` are exported for other server modules
  (the assistant route uses `resolveEvidence`). They are not part of the INTERFACES route contract.
- `parseClaimDescriptor` does not enforce M1 authored bounds; this checker enforces them itself.

## Proof lesson: walk_reorder_instance

The proof lesson adds a fourth claim kind: `walk_reorder_instance` (PROOF-EXPLORER-MATH section 8).
It explains one reordering lemma, `OAI.EuclideanSteinitzBergstrom.signedOrder_prefix_bound`, with a
finite vector walk. The checker can certify the walk currently shown, and nothing more general.

| File | Role |
|---|---|
| `src/workspace/walkClaim.ts` | Descriptor, strict parser, hash payload (IDs excluded), exact evaluation |
| `server/lean/walkTemplate.ts` | `WALK_TEMPLATE_VERSION = 'mw-lean-walk-1'`, the walk definitions, `generateWalkClaim(claim, hash)` |
| `server/lean/templates.ts` | `templateVersionFor(kind)` and `generateAny(claim, hash)`: the template version per kind |
| `tests/lean/walk.test.ts` | Injected route cases, hash coverage, template sanity (no Lean) |
| `tests/lean/walkCheck.test.ts` | Real compiles of the prepared cases and of tampered statements |
| `scripts/proof-lean-evidence.ts` | Writes `docs/evidence/proof-explorer/lean/` from real runs |

### The descriptor

`POST /api/check` receives `{ claimVersion: 1, kind: 'walk_reorder_instance', dimension, vectors:
[{ id, coords }], signs, convention: 'integer-ceiling-v1' }`. The vectors and signs are listed in
source order. The fields are closed, as with the other kinds. A field the browser adds, such as
`B`, `order` or `selection`, is a 400 `invalid_claim`.

The parser also enforces the walk bounds (`WALK_LIMITS` in `src/algebra/walk.ts`):

- 1 to 12 vectors;
- dimension 2 or 3;
- coordinates in [−4, 4], with denominators of at most 1000;
- distinct occurrence IDs matching `^[a-z][a-z0-9_]{0,15}$`;
- one sign, 1 or −1, per vector.

A violation is **400 `invalid_claim`**, not `capacity`. So is a rational beyond the 256-bit budget,
because the walk parser wraps every error. In both cases nothing is run.

### What the theorem states

The generated `theorem claim` is a conjunction. Its parts are numbered (0) to (6) in its doc comment
and in this list. N is the number of vectors and d the dimension. U_j is the source prefix after j
vectors and S_j is the signed prefix (vector i is replaced by ε_i v_i). W_k is the prefix of the
reordered walk. That walk uses the original vectors with no sign change, in the output order.

0. **Well-formed data.** There are N vectors of length d and N signs, and every sign is 1 or −1.
1. **The walk is closed.** U_N is the zero vector.
2. **Source bound.** |U_j|² ≤ B² for every j from 0 to N, and B is the least such natural. That is,
   B = 0, or some j has |U_j|² > (B − 1)².
3. **Signed bound.** The same holds for S_j and D.
4. **Order.** The output order lists every position 0 to N − 1 exactly once (length N, each index
   counted once), and it equals the literal stated (for the hero, [0, 2, 4, 6, 8, 10, 11, 9, 7, 5, 3, 1]).
5. **Witnesses.** For every k from 0 to N, with j = `witness eps k`:
   - 2·W_k = U_j + S_j when k ≤ p, where p is the number of +1 signs;
   - otherwise 2·W_k = S_j − U_j.
6. **Conclusion.** |W_k|² ≤ R·R for every k, where R = (B + D)/2.

**Squared norms.** |x|² is defined in Lean as Σᵢ xᵢ² over the integer-pair rationals. Every bound
compares a squared norm with a squared bound, and the statement says so. Section 5 of the math
contract gives the reason: B, D and R are non-negative, so |x| ≤ r is equivalent to |x|² ≤ r². That
equivalence belongs to the explanation. The theorem itself contains no square roots.

**Recomputed in Lean.** The claim block contains only these numbers: d, N, the coordinates, the
signs, B, D and the order literal. Lean recomputes everything else from v and eps with the fixed
definitions of the template: the prefixes, the signed copies, the positive and negative positions,
the output order, the reordered walk and the witness indices. B, D and the order are computed in
TypeScript and written into the source as claims, and Lean then checks each of them: (2) and (3)
check B and D, and (4) checks the order. The definitions are about 36 lines, appended to the shared
prelude (`WALK_DEFS` in `walkTemplate.ts`). Like the prelude, they should be reviewed once per
template version.

**Core Lean only.** The template uses no imports and proves the theorem with `decide`. The audit
policy is unchanged (`APPROVED_AXIOMS = []`), and the real hero run printed `'MathWorkspace.claim'
does not depend on any axioms`. The theorem name and the audit command are the same as for the other
kinds.

### Why it cannot succeed vacuously

The theorem is a conjunction of facts about one fixed data set, not an implication with
hypotheses. A false hypothesis therefore makes the theorem false, and `decide` refutes it. The
route never submits a false claim, so this was tested by compiling tampered sources directly
(`walkCheck.test.ts` and `negative-controls.json`). In each case Lean exited with code 1, reported
"`decide` proved that the proposition … is false", and the audit rejected the run. The tampered
sources were:

- open-two (U_N ≠ 0) forced through Lean;
- the hero with B = 4 (not a bound);
- the hero with B = 6 (a bound, but not the least natural one);
- the hero with a wrong order literal;
- the hero with one sign flipped while the old order is kept.

### Refusal of a non-closed walk

If the total is non-zero, the lemma does not apply, so there is nothing to certify. `evaluateExactly`
reports the claim false. The route answers 200 `not_established` with the exact arithmetic before it
probes or runs Lean, and issues no receipt. The answer does not depend on the toolchain: it is the
same when Lean is unavailable. For open-two the reason is:

> Computed exactly, the claim is false: the walk does not return to its start (total (2, 0, 0)), so
> the reordering lemma does not apply; here W_2 = (2, 0, 0) has |W_2|^2 = 4 > 9/4 = (3/2)^2. It was
> not submitted to Lean.

A non-closed walk whose bound happens to hold, for example the single vector (1, 0, 0), is refused
too. Its reason says "here the bound happens to hold, but nothing guarantees it". It is the missing
hypothesis that decides the refusal, not the conclusion. The 200 body still contains the `statement`
that would have been checked, and this statement is false.

### What a `checked` walk does NOT establish

- the general lemma `signedOrder_prefix_bound` for all walks; its formal proof is in the pinned
  upstream source and is not compiled here;
- the research theorem, or any build of the upstream project (OpenAI `math` @ `4eaee875`);
- that the renderer draws these vectors, prefixes or spheres correctly;
- any explanation, caption or assistant text;
- anything about norms beyond the squared-norm inequalities stated, and anything about the
  condition |v_i| ≤ 1 of the surrounding theorem (it is not part of this lemma and is not stated).

### Hash coverage and invalidation

- **Hash input.** The claim hash is SHA-256 of the canonical JSON `{ version: 'claim-v1', payload }`.
  The payload is `{ kind, dimension, vectors, signs, convention }`, with the vectors as exact
  rationals and the signs, both in source order.
- **Not in the hash:** occurrence IDs, the stored order of occurrences, which endpoint is selected,
  and any camera or presentation state. The descriptor has no selection field at all.
- **Effects:**
  - Renaming every ID gives the same hash, the same statement and the same Lean source, byte for
    byte. So does shuffling the stored occurrences while the source order stays the same. Selecting
    another endpoint leaves a receipt current.
  - Flipping one sign, exchanging two source positions or changing a coordinate gives a new hash.
    The old receipt then does not resolve for the new hash, in either direction.
  - Exchanging two equal vectors that carry equal signs leaves the mathematical content, and so the
    hash, unchanged.
- **Template version.** The template version is not in the hash. It is bound in the receipt
  (`templateVersion: 'mw-lean-walk-1'`), and W5 provenance checking accepts a receipt only with its
  kind's version (`templateVersionFor`).
- **No client text in the source.** IDs never reach Lean. The vector comments name source positions
  (`-- v₀` … `-- v₁₁`), and the convention is written from the constant. With hostile-looking IDs
  (`sorry`, `native_decide`, `set_option`, …) the source is byte-identical to the hero's. For the
  same N and d, two statements differ only in their numbers.

### Real runs (2026-10-31, this Mac)

| Case | Status | Hash prefix | Route time |
|---|---|---|---|
| hero | `checked`, axioms `[]` | `25edeca082f4` | 0.40 s (1.1 to 1.6 s as the first run in a fresh process: toolchain probe and cold start) |
| all-positive | `checked`, axioms `[]` | `123504c92afd` | 0.35 to 0.43 s |
| line-six | `checked`, axioms `[]` | `3691e8f831d3` | 0.28 to 0.31 s |
| sign-edited hero (ε₁ = +1) | `checked`, a different hash | — | about 0.4 s |
| open-two | `not_established`, no Lean run | `726245ae4424` | 0 ms |
| tampered sources (5) | rejected by Lean and the audit | — | 0.22 to 0.27 s each |

All of these are far below the 15 s limit. `walkCheck.test.ts` makes 11 real compiles in about
3.6 s. The full route responses and the hero's complete Lean source are in
`docs/evidence/proof-explorer/lean/`.

### Tests

- **`tests/lean/walk.test.ts`** (49 tests, injected runner, no Lean):
  - open-two refused with the exact reason, with no probe and no run (also when Lean is unavailable),
    and the non-closed walk whose bound happens to hold;
  - 22 malformed descriptors (400, no run);
  - a receipt with `mw-lean-walk-1` only after a passing audit, and 9 audit anomalies that issue none;
  - hash coverage as above;
  - template sanity: the hero literals, the seven conjuncts, no forbidden constructs, IDs never in
    the source, and the generator's own refusals.
- **`tests/lean/walkCheck.test.ts`** (8 tests, real toolchain, skipped when it is absent):
  - hero, line-six and all-positive `checked`, with provenance and a receipt that resolves through
    `resolveReceipt`;
  - the sign-edited hero as a separate claim;
  - open-two refused;
  - the audit on the real output (exactly one axioms line);
  - the five tampered sources rejected by Lean;
  - temp-directory cleanup. The file sets its own `TMPDIR`, because `check.test.ts` counts `mw-lean-*`
    directories in the shared temp directory and test files run in parallel.

### Open points

- W5 (`resolveEvidence`) cannot yet resolve a walk receipt from a document. `ClaimRequest` and
  `describeClaim` have no walk locator, so there is no server-side way to rebuild the walk claim
  from the current document. Receipts are issued and resolve through `resolveReceipt(id, hash)`.
- `leanCapabilities()` lists `walk_reorder_instance` among `claimKinds` but reports a single
  `templateVersion`, which is `mw-lean-claims-1`.
