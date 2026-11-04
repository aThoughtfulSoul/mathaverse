# Weaving algebra: the bounded three-strand braid scene (Worker C)

Scope: FOUR-DEMOS-PARALLEL-HANDOFF section 8 (demonstration 4), sections 9-11; contract in
`docs/INTERFACES.md` "Four algebra demonstrations (2026-10-30)". Exact words and checks are the coordinator's
`src/algebra/braid.ts`; this track owns the strand geometry, the two deformation constructions, interaction,
the scene and its focused tests. Everything below the exact word is derived presentation.

## Files

| File | Role |
|---|---|
| `src/domains/braid/index.ts` | exports `deriveBraid`, `BraidScene`, `BraidDesc` (+ word/crossing/option types), `GEOMETRY` |
| `src/domains/braid/derive.ts` | `deriveBraid(input: BraidSceneInput): BraidDesc`, crossing interpretation, rewrite options, status lines |
| `src/domains/braid/constants.ts` | identity colours/shapes, metric parameters (`GEOMETRY`) |
| `src/domains/braid/curves.ts` | the shared horizontal step, generic depth bump, motif depth envelope |
| `src/domains/braid/relation.ts` | the canonical relation family, literally as in the handoff (normalized) |
| `src/domains/braid/cancel.ts` | the inverse-cancellation family (normalized) |
| `src/domains/braid/plan.ts` | word layout (`Plan`), opened motif layouts, `StrandEvaluator` (generic crossings + motif embedding) |
| `src/domains/braid/clearance.ts` | sampled centerline distances and horizontal crossing events (checks and reports) |
| `src/domains/braid/animator.ts` | presentation clips, playback, change classification (pure, no three.js) |
| `src/domains/braid/tubes.ts`, `view.ts`, `widgets.ts`, `scene.ts` | in-place tube meshes, one braid's view, plates, `BraidScene` |
| `src/domains/braid/harness.ts` | dev harness module: fixtures from exact words, planner simulation for this track's actions |
| `tests/braid/*.test.ts` | focused tests (43) |
| `docs/evidence/four-demos/braid/*.png` | captures |

## What the scene shows

- **Direction and convention** (stated once, in the line under the status): time runs **downward** from the
  first endpoint frame (top) to the second (bottom). sigma1 crosses places 1 and 2, sigma2 places 2 and 3
  (current positions, left to right); positive: the left strand passes **in front** (nearer the viewer, +z);
  inverse: behind.
- **Strands** a, b, c (named by starting position) in the shared identity colours (coral, teal, lavender) with a
  secondary cue: end-cap shape (a sphere, b cube, c octahedron) and the letter at both endpoint frames. The
  bottom letters show which identity arrives where. A dark back-face hull around each tube (the knot-diagram
  "gap", background colour) gives the under strand a visible break at every crossing.
- **Main word and comparison side by side** (main at x = -0.15, comparison at x = +0.15; main centred when there is
  no comparison). Under each braid: the word in chronological order (TeX via `wordTex`), then its endpoints and
  exponent sum (`a b c ↦ c b a   E = 3`). Beside each braid, a small generator label at every crossing (words up to
  11 crossings).
- **Status line** from `braidStatus`/`compareWords`: identical; "Different braids: exponent sums 2 and 0 differ (the
  endpoint permutations agree, which alone decides nothing)"; "Different braids: the endpoint permutations differ";
  "Identical to the comparison now; σ1 σ2 σ1 equals it by one supported rewrite (checked by supported rewrite
  rules)"; or "... not established by the supported checks (endpoints and E agree; no rewrite links them yet)".
  No Lean badge anywhere.
- **Controls** (scene plates, analytic picking): left column `append` σ1, σ2, σ1⁻¹, σ2⁻¹, then `inverse`,
  `reset`; right column: the rewrites whose span matches at the selected crossing.
- Bench-local extents: x in [-0.47, 0.49], y in [-0.22, 0.31], z in [-0.04, 0.03].

### Description (`BraidDesc`)

Plain data, deterministic from the input: `layout: 'braid'`, `experimentId`, `revision`, `mathRevision`,
`main` and `compare` (`BraidWordDesc`: `word`, `tex`, `text`, `crossings[]` with `positions`, `left`, `right`,
`over`, `under`; `positions` (= `positionsBefore`), `endpoint` (= `endpointPermutation`), `arrival`,
`exponentSum`, `invariantsTex/Text`), `origin`, `rewrites`, `status` (`BraidStatus`), `verdict`, `statusText`,
`summary` (the `status()` line), `item`, `selectedCrossing` (validated against the word), `selectedStrand`,
`options` (`{id, rule, at, generator, tex, hint}`, each checked with `applyRewrite`), `canAppend` (n < 24),
`show {compare, invariants}` (from the recipe's `braid_diagram` / `braid_invariants`; everything when no
recipe), `convention`.

### Picks (ScenePick.actions; the scene never edits state)

| Press | Actions |
|---|---|
| append plate | `[{kind:'append_crossing', experimentId, target:'word', generator}]` (none at 24 crossings; hint says unavailable) |
| a crossing lane of the main braid | `[{kind:'select_item', experimentId, item:'crossing:<k>'}]` (pressing the selected one: `item: null`) |
| option plate | `[{kind:'rewrite_braid', experimentId, rule, at, generator}]`: `cancel_pair` when the crossing and a neighbour are inverse (either side, `at` = the pair's first index); `braid_relation` when σ1σ2σ1 / σ2σ1σ2 starts there; `insert_pair` at that position with generator 1 or 2 |
| inverse | `[{kind:'invert_braid', experimentId, target:'word'}]` |
| reset | `[{kind:'set_braid', experimentId, target:'word', word:[]}]` |

### apply / playback

- `apply(desc, 'animate')` diffs the previous description (same experiment): rewrites grew by exactly one with
  that rule and `applyRewrite(prev.word, step)` gives the new word → `braid_relation` plays the canonical
  deformation at its span, `cancel_pair` the cancellation deformation, `insert_pair` the cancellation of the new
  word played backwards; one crossing appended → the braid grows (old tail retracts, the strands weave the new
  crossing down to the second frame); a comparison word that grew by one crossing grows the same way; anything
  else jumps. `'snap'` always jumps.
- An apply during an animation first ends it at its exact end (the committed word's static geometry), then
  diffs. Texts (word, invariants, status, options) always show the committed exact state immediately.
- `setPlayback('replay')`: the construction drawn crossing by crossing from the first frame on both braids, the
  crossing being drawn highlighted; `setStepDuration(s)` (play_steps) sets seconds per crossing (0.3-5, default
  0.75). `'toggle'`/`'play'` start a replay when idle, otherwise pause/resume; `'pause'`; `'finish'` jumps to the
  end; `{seek}`. `playback()` reports `phase` (`relation:prepare|deform|settle` (+`open`/`close` mid-word),
  `cancel:open|prepare|straighten|flatten|close`, `insert:...`, `append:retract|weave`, `replay`) and `step`
  (replay: `{index: crossing, count: n, label: 'crossing 2: σ2'}`; edits: the phase index).
- `status()`: e.g. `σ1 σ2 σ1 → σ2 σ1 σ2 by one supported rewrite; identical to the comparison`,
  `σ1 σ1 vs identity: different from the comparison (exponent sums differ)`.
- `report()`: word/compare, summary, status text, last transition, playback, stats (applies, animated,
  snapped, interrupted), `GEOMETRY`, and per braid the units, pitch, tube radius, motif, lambda, reveal and the
  measured clearance of the current geometry, plus text-slot freshness.

## Strand geometry as implemented

Braid-local coordinates: x = (position - 1) · D, y = -u (u = metres below the first frame), z = depth (over =
+z). Parameters (`GEOMETRY`): D = 0.046 m, length 0.33 m, lead 0.035 m (top-anchored), tail ≥ 0.03 m, unit pitch
P = min(0.085, 0.265 / n), tube radius r = min(5.8 mm, 0.2 P), 400 centerline samples per strand (uniform in u),
10 vertices per ring.

- **Shared horizontal step** E: the cubic smoothstep S(s) = 3s² - 2s³ on the central part of each unit, constant
  on shoulders of fraction p = 0.1 at both ends (monotone, C1, the same for every strand, every generic crossing
  and every motif knot interval). The shoulders give each crossing breathing room and supply the straight
  pieces the motifs' collars use.
- **Generic crossing**: the two strands at positions i-1, i move with E; over strand at +δ·sin²(π v), under at
  -δ·sin²(π v) over the moving part (v), δ = 15 mm; zero on the shoulders. The rendered over strand is the
  `over` of `describeWord` at every crossing (tested on 9 words by detecting horizontal coincidences).

### Canonical relation deformation (handoff construction, embedded)

`relation.ts` implements the family literally: identities by entry position at -1, 0, 1, knot tables L and R,
collars [0, ε] and [1-ε, 1] with constant horizontals, four knot levels equally spaced in [ε, 1-ε], the step E
between them, depths d = (+h, 0, -h)·b(t), and C_i(t, λ) = ((1-λ)x_i^L + λ x_i^R, d_i b(t), H t).

Embedding at a span k..k+2 of a word (`plan.ts`): the knot intervals are exactly the span's three units, so at
λ = 0 (λ = 1) the motif's horizontals equal the generic σ1σ2σ1 (σ2σ1σ2) horizontals. The depth ranks go to the
identities occupying positions 0, 1, 2 at the span's entry (`where[k]`). The collars are straight pieces next to
the span: the lead/tail at a word's ends, otherwise the neighbour's shoulder plus a straight unit **opened** for
the duration of the clip (`setMotifPlan`: straight units of up to 34 mm inserted at both ends of the span, paid
for by tail slack, then lead slack, then shortening the other units; a longitudinal reparametrization of straight
pieces that changes no crossing). Outside the footprint the prefix and suffix keep their generic geometry.

Clip phases: `open` (mid-word only, 0.45 s) → `prepare` (0.6 s: depth morphs from the generic bumps to the
canonical ranks with horizontals fixed; at every horizontal coincidence the over strand of the word is also
higher-ranked, so the order is kept) → `deform` (2.6 s: λ from 0 to 1, or 1 to 0 for σ2σ1σ2 → σ1σ2σ1) →
`settle` (0.6 s, ranks back to generic) → `close`. Hero values (σ1σ2σ1 at the start of a 3-crossing word):
P = 85 mm, collar c = 35 mm (the lead), H = 3P + 2c = 325 mm, ε = c/H = 0.108, h = 22 mm, r = 5.8 mm. In the
knot region the three depths differ by h; at λ = 1/2 the three strands meet x = 0 at one u, separated in depth
by h, h, 2h (tested).

Depth envelope b(t): a C1 piecewise-quadratic ramp (2s², then 1 - 2(1-s)²) over each collar. The handoff only
asks for a smooth envelope; this shape has the smallest peak curvature (4/c² against 6/c² for the cubic), so the
collar bend radius c²/(4h) stays above the tube-plus-gap radius (≈ 14 mm for the hero). Earlier frames with
12 mm collars and the cubic showed tube folds; they are fixed.

### Inverse cancellation deformation

`cancel.ts`: for [s, s⁻¹] the left entry strand is over at both crossings (positive first), for [s⁻¹, s] the
right one (the opposite ranking). Phases: `open` (mid-word only) → `prepare` (generic depths → constant ranking
±η·b(t), η = 16 mm) → `straighten` (the out-and-back horizontal paths interpolate to the constant entry positions,
endpoints fixed; the pair stays depth-separated) → `flatten` (depth → 0 with horizontals fixed and distinct) →
`close` (the straight span and the opened collars shrink to zero while the other units relax to the shorter
word's pitch). `insert_pair` plays the same clip of the resulting word backwards. The positive double crossing
σ1σ1 is a different picture (a over b, then b over a) and never animates away: its exponent sum is 2.

### Measured clearances (sampled; 400 samples per strand, all pairs within 5 cm, `clearance.ts`)

| Geometry | min centerline distance | r | surface gap |
|---|---|---|---|
| static σ1σ2σ1, σ2σ1σ2, σ1σ1, σ1σ1⁻¹ | 30.0 mm | 5.8 mm | 18.4 mm |
| static identity | 46.0 mm | 5.8 mm | 34.4 mm |
| static 7-crossing word | 20.9 mm | 5.8 mm | 9.3 mm |
| static 24-crossing word | 7.7 mm | 2.2 mm | 3.2 mm |
| relation clip, hero (161 times; λ grid of 41 alone gives the same) | 22.0 mm | 5.8 mm | 10.4 mm |
| relation clip, mid-word in a 7-crossing word | 16.9 mm | 5.7 mm | 5.5 mm |
| cancel clip σ1σ1⁻¹ | 30.0 mm | 5.8 mm | 18.4 mm |
| cancel clip mid-word [2,1,-1,2,2] | 22.2 mm | 5.8 mm | 10.6 mm |
| insert, append clips | 30.0 mm | 5.8 mm | 18.4 mm |

Sampling supports the implementation; it is not a topology proof. The exact word checks never depend on it.

## Tests

`npx vitest run tests/braid` → 3 files, **43 tests passed**.

- `words.test.ts` (18): crossing signs and the current-position interpretation (σ2 then σ1 crosses a with c);
  hero over/under; inverse pair keeps one strand over, σ1σ1 changes it; inverse words and word·inverse reducing to
  the identity by checked cancellations; valid spans with prefix/suffix unchanged, invalid spans refused; options
  offered only where spans match (incl. the 24 bound); endpoint permutations and exponent sums; [1,1] vs identity
  different by E despite equal endpoint permutations; three pairs with equal invariants and no witness →
  `not_established` and never "different"/"equal"; the relation rewrite → "checked by supported rewrite rules";
  recipe flags; determinism.
- `geometry.test.ts` (18): knot tables at the four levels for λ = 0 and 1; endpoints fixed and collars constant for
  21 λ values; distinct knot-region depths and a sampled minimum distance over the λ grid; the depth-separated
  triple point; crossing order λ = 0 (a>b, a>c, b>c) and λ = 1 (b>c, a>c, a>b) on the embedded motif; clearance >
  2r + 8 mm (hero) and 2r + 4 mm (mid-word) over the λ grid; position and tangent continuity at the footprint
  joins (λ = 0, 0.3, 0.5, 1); motif = generic geometry at μ = 0 (no jump when the motif starts); opened collars
  keep every crossing; rendered over/under = exact interpretation on 9 words; static clearance up to 24
  crossings; cancellation ranking (both signs), straightening/flattening, embedded endpoints and separation; every
  clip keeps both endpoint frames, stays separated and ends exactly on the target word's static geometry.
- `scene.test.ts` (7, DOM stubbed): plate and crossing picks produce the action JSON above; options only at the
  selected crossing; append refused at 24; transition classification (relation, mid-word relation, cancel,
  insert, append; anything else jumps); an apply during an animation ends it and the scene shows exactly the
  committed word (also for an interrupted mid-word relation); replay with `setStepDuration`; `status()` lines.

`npx tsc --noEmit -p .`: no errors in braid files (and none elsewhere at the time of the last run).

## Captures (`docs/evidence/four-demos/braid/`, headless Chrome, real WebGL, 1600×1000)

| File | Shows |
|---|---|
| `relation.png` | σ1σ2σ1 beside σ2σ1σ2; equal invariants; status "not established by the supported checks" |
| `deform-mid.png` | the canonical deformation at λ ≈ 0.5 (front): b straight, a and c meeting it at one height |
| `deform-mid-side.png` | the same frame from the left: a in front of b, c behind, depth gaps visible |
| `relation-done.png` | after the rewrite: identical to the comparison, equal by one supported rewrite |
| `selected-options.png` | crossing 1 selected; the matching rewrites offered on the right |
| `double-vs-identity.png` | σ1σ1 vs identity: same endpoints, E = 2 vs 0, different braids |
| `cancel-mid.png` | σ1σ1⁻¹ cancelling: a stays in front at both crossings while the paths straighten |
| `cancel-done.png` | the result: three straight strands, identical to the identity by one supported rewrite |
| `long-selected.png` | a 7-crossing edited word with a relation span selected mid-word, comparison beside it |
| `long-relation-mid.png` | the mid-word relation at λ ≈ 0.5 with opened collars (prefix/suffix compressed) |
| `replay-mid.png` | construction replay mid-way, current crossing highlighted |
| `append-weave.png` | an appended σ1⁻¹ being woven in (layout compressing from 3 to 4 crossings) |
| `max-24.png` | the 24-crossing bound (append disabled): legible but cramped |

Reproduce (dev server on :3010), e.g. the mid-deformation:

```
node --experimental-websocket scripts/shot.mjs --url 'http://localhost:3010/harness.html?domain=braid' \
  --size 1600x1000 --wait 'window.__harness' --eval '__harness.show("relation","snap")' --sleep 2000 \
  --eval '__harness.show("relationDone","animate")' --eval '__harness.playback("pause")' \
  --eval '__harness.playback({seek: 1.9})' --sleep 1200 --class capture --shot docs/evidence/four-demos/braid/deform-mid.png
```

Side view: then `--eval '(()=>{const c=__harness.host.camera; c.position.set(-0.78,1.32,-0.12); c.lookAt(-0.05,1.06,-0.8); return 1})()'`.
Fixtures: `relation`, `relationSelected`, `relationDone`, `double`, `cancel`, `cancelDone`, `inserted`, `long`,
`longDone`, `empty`, `max`. Seek times: relation λ = 0.5 at 1.9 s (hero), 2.35 s (mid-word, with `open`);
cancellation straightening at 0.85 s.

## Filming sequence (about 90 s; integrated app or harness)

1. Open the braid experiment showing σ1σ2σ1 beside σ2σ1σ2 (harness `relation`; app: set_braid word [1,2,1],
   compare [2,1,2]). Hold 3 s on the status: invariants agree, "not established by the supported checks".
2. Press crossing 1 of the main braid, then the option `σ1σ2σ1 → σ2σ1σ2` (rewrite_braid braid_relation at 0).
   The deformation plays (3.8 s); status becomes "identical ... by one supported rewrite (checked by supported
   rewrite rules)". Optional: Replay on the controls panel to redraw the construction.
3. Reset, append σ1, σ1; set the comparison to the identity (set_braid compare []). Status: E = 2 vs 0, different;
   the endpoints agree (a b c ↦ a b c on both).
4. Reset, append σ1, σ1⁻¹ (compare still the identity): "not established" until you select crossing 1 and press
   `σ1σ1⁻¹ → e`: a stays in front while the strands straighten and the span closes; status: identical by one
   supported rewrite.
5. Edit freely (append, inverse): words, endpoints and E update from state; Undo goes back with a jump.

## Limitations

- Long words compress: P = 0.265 m / n, tube radius 0.2·P (2.2 mm at 24 crossings), crossings become near
  horizontal beyond ~12; per-crossing labels only up to 11 crossings. A mid-word relation or cancellation
  temporarily squeezes the other units to open 34 mm collars (visible during `open`/`close`).
- The horizontal step has flat shoulders (p = 0.1) around the cubic smoothstep, and the collar envelope is a C1
  quadratic ramp; both satisfy the handoff's "same monotone smoothstep" / "smooth envelope" in spirit and are the
  same everywhere, but they are a deliberate reading, stated here.
- The `prepare`/`settle` depth morphs (generic ↔ canonical ranks) keep horizontals fixed; their validity rests on
  depth order being kept at the crossing midpoints (argued above, sampled in tests), not on a proof.
- The comparison braid is not pickable; `strand:<x>` selection is displayed (emphasis) but no press produces it.
  Comparison words change only through actions (no plate).
- Word, invariants and status update immediately on apply, so during an animation the text already names the
  committed word.
- Only desktop headless-Chrome captures; no headset, Muse or voice check was made for this track.
- Per-crossing TeX labels use per-slot cache entries in the shared 160-entry TeX LRU; heavy editing can evict
  other scenes' cached entries (they rebuild on demand, showing the plain fallback briefly).

## Requests to the coordinator

None blocking. Suggestions:
1. Planner: keeping `selection.item = crossing:<k>` after a `rewrite_braid` (when k is still in range) lets the
   user apply the relation back immediately; the scene validates k either way.
2. The app should call `apply(desc, 'snap')` after Undo (as the contract says): the scene only animates a
   rewrite record that grew by exactly one step.
3. If the controls panel has a free slot for this layout, `presentation: 'replay'` is not emitted by the scene;
   the panel's existing replay command drives `setPlayback('replay')`.
