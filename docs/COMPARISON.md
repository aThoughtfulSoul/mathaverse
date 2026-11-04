# Operation-order comparison and the label layout

29 October 2026 · worker A (visual demonstration) · source: `src/recipes/comparison.ts`, `src/recipes/derive.ts`,
`src/rendering/{manimAdapter,comparePlayback,labelLayout,textSlot,viewDescription}.ts`, `src/ui/{palette,phrases}.ts`,
`src/dev/verifyXR.ts`. Specification: `workspace-spec/SECOND-DEMO-PARALLEL-HANDOFF.md` and the label policy in
`workspace-spec/PQ-ARCHITECTURE-DECISIONS.md`.

## What the comparison shows

The same labelled square follows two routes:

- **Left route:** R then S. Its view is `output`.
- **Right route:** S then R. Its view is `output2`.

Both routes start from one compact shared input. The corners are a = (1, 1, 0), b, c and d, and the selected witness is e₁ = (1, 0, 0).

Every labelled sample keeps its name and one identity colour in all three views. The colours are `palette.identity`, assigned in sample order. The selected sample also has a ring and an arrow from the origin. The square's outline shows that both routes cover the same positions. The corner names show that the routes map points differently.

At rest the scene shows:

| Place | Content (exact data) |
|---|---|
| Top centre | Verdict `SRe₁ ≠ RSe₁`, caption "the routes differ". If the matrices are equal: `SR = RS`, "both routes give the same map". If the selected outputs agree but the maps differ: "the same here, but SR ≠ RS". |
| Above each output | The route's order in words (title "R then S"). Below it, one line per map ("Rotate 90° about z," / "then reflect (negate y)"), then the product read right to left: `SR = [[0, −1, 0], [−1, 0, 0], [0, 0, 1]]`. |
| Below each output | One line per step: "first R: Re₁ = (0, 1, 0)", "then S: SRe₁ = (0, −1, 0)". In the right route: "first S: Se₁ = e₁ (fixed)", "then R: RSe₁ = (0, 1, 0)". |
| Below the input | `e₁ = (1, 0, 0)`. |
| Workbench status | "R then S (left) vs S then R (right): select a point, or drag the selected one". This is `comparison.statusTokens`, and the app shows it as given. |

S is described as "reflect (negate y)". As a map of R³ its mirror is the xz-plane, so no caption calls it a reflection across the x-axis. A test checks this.

## Operations (all generic)

`deriveView` sends a recipe with `branch_comparison` to `deriveComparison`. It reads any two branches of the displayed experiment, with 0-6 maps each.

- **Resolution:**
  - Each branch is resolved in chronological order. A branch [A, B] resolves to BA.
  - Each step is a `RouteStage`. It holds the map label, the product so far, the verb, the motion, the display positions of every sample after the step, and whether the step leaves the selected sample fixed.
- **Verbs and motion come from the exact step matrix, never from a name:**
  - A quarter-turn rotation about a coordinate axis gives `{ kind: 'rotation', axis, angle }`.
  - The identity gives `{ kind: 'none' }`.
  - Anything else gives `{ kind: 'straight' }`.
- **`sample_outline`:**
  - Draws a closed outline through the vertices' current coordinates, in every view, through that view's map. Moving a corner moves its outline.
  - If a vertex ID is missing from the sample set, the outline is omitted and a note says so.
- **Picking:** a dot in the right panel picks as view `output2`. Selection then follows the ordinary `select` path.
- **Summary fields:** in a comparison, `mapSymbol` and `matrix` describe the left route, `fiberAvailable` is false and `fiberAxis` is null.
- **Token set:** `tokenSetFor` prepares every product prefix ("R", "SR"), plus `\neq`, `:`, `I` and the new phrases. No readout, status line or step indicator typesets during interaction.

## Playback (`compare_steps`)

The two routes play together. The longer route sets the step count.

- **Timeline:**
  - Step 0 holds the input for half a step.
  - Each step k moves for 70 % of `stepDuration`, then holds its exact result.
- **Motion within a step:**
  - A rotation step follows a true angular path. Intermediate trigonometry is presentation only.
  - Any other map moves in a straight line. Its caption reads "S: straight path to the image; / only its end is the reflection".
  - A straight path may pass through the mirror plane. Mid-step, the right square collapses onto y = 0.
- **Exact endpoints:** every step boundary shows the stage positions from the description, not computed trigonometry. The IWER check measures the deviation at every boundary as 0.
- **Step text:**
  - A central indicator reads "Input", "Step 1 of 2: left R, right S" or "Step 2 of 2: left S, right R".
  - A route's step line appears when that step's result is on show.
  - The step's motion caption shows while the step plays.
  - Names ride outside the turning square: during playback their offset points away from the view's origin.
- **`PlaybackState.step`** is `{ index, count, label }` during comparison playback and `null` otherwise. Phases are `input`, `step k`, `step k result` and `done`.
- **Replay:** `setPlayback('replay')` replays with the kind that matches the description. A comparison uses `compare_steps` with the last step duration (default 1.6 s). Linked views keep `apply_map` exactly as before.
- **Mismatched requests:** an `apply_map` request on a comparison, or the reverse, is converted and counted in `stats.kindMismatches`.
- **Pause, play, finish and seek** work as before.
- **Interruption:** a new `mathRevision` finishes the playback and shows the committed target. So does a change of layout, such as switching demos mid-play.

## Layout

The three panels use the existing host and adapter. The panel placement is presentation only.

| View | Position (bench) | Placement |
|---|---|---|
| input | centre, 4 cm forward | scale 0.056 |
| output (left route) | x = −0.36, turned +0.36 rad | scale 0.076 |
| output2 (right route) | x = +0.36, turned −0.36 rad | scale 0.076 |

All three views are tilted 56° about the bench x-axis. The mathematical plane z = 0 therefore faces a seated viewer about 14° off-normal, and the z-axis stays visible as the rotation axis. The embedding E₃ is unchanged.

Linked views (P/Q) keep their earlier placement, yaw easing and titles. `output2` is hidden there.

`adapter.setVoiceLine(line)` draws the push-to-talk caption:

- It sits at bench (0, 0.448), above the assistant line.
- It uses the new `plain` slot content kind: canvas text that is fresh as soon as it is drawn and never typeset.
- It is redrawn only when the text or state changes; repeated identical calls cost nothing.
- State colours: recording rose, pending cyan, transcript text colour, error red.

## Label policy implementation

Code: `src/rendering/labelLayout.ts` (pure, unit-tested); `runLayout` in `manimAdapter.ts`.

- **Description vs presentation:**
  - Derive now describes every named label.
  - The old one-unit mathematical distance test and the "multi-name labels are never hidden" rule are removed.
  - Visibility is a presentation decision. No point, plane, value, selection target or document field changes.
- **Projection:**
  - The layout projects labels into one screen frame at the head pose: tangent-plane units, with forward toward the workbench centre.
  - Label extents use the head-facing size (w·D/z²).
  - Each label carries its stereo parallax (IPD 64 mm). Two labels at different depths must also clear their relative parallax, so one decision clears both eyes.
- **Priority order:**
  - 100: the selected output relationship (must show).
  - 90: the selected sample's name (must show).
  - 60: names in the selected exact group.
  - 30-39: other location labels, including multi-name ones.
  - 20: other names.
- **Candidates:** each label tries a small fixed set:
  - its resting offset first, so an uncrowded P/Q scene looks exactly as before;
  - then eight directions next to the point, ordered by preference (outward from the view origin in the comparison);
  - then the same eight further out with a short leader.
- **Obstacles:** fixed scene text (readouts, titles, captions, axis names, padded by 4 mm) and the ringed dots of the selected relationship.
- **Unplaceable labels:** a must-show label takes its least-overlapping place. Any other label fades out but keeps its point and its selection target. The readout under the output still lists the selected group in full.
- **Hysteresis:**
  - A shown label keeps its place while that place overlaps others by less than the margin (2.5 mm).
  - A new place, or a hidden label's return, needs that margin clear.
  - A label whose point moved in the scene (an edit or a reversed route) is placed afresh. Head movement does not count, because it does not move points in bench space.
- **Bounded work:** layout runs only when the description changes, a label's size changes, or the head moves more than 1 cm or 1°, at most every third frame. It never runs while a transition owns the outputs. Text bounds are the slots' cached sizes. Fades take about 0.12 s.
- **Unchanged:** no text size was reduced, and depth testing is unchanged.

`adapter.labelLayoutReport()` lists each label's decision. `adapter.layoutDebug.enabled = false` shows the scene without the layout; it was used only for the before/after captures.

## Checks run

**Unit tests (`npx vitest run tests/visual`, 21 tests):**

- the comparison description built through `Workspace.commit(orderDemoActions(demoDocument()))`;
- the exact witness table step by step, including the fixed step;
- identity names and colours in all views;
- motion kinds from matrices;
- route reversal: outputs and `mapsEqual` agree, and Undo restores;
- the outline following a moved corner, and a missing vertex omitted with a note;
- the "same here, but" verdict;
- token coverage;
- P/Q still described as linked views;
- playback timing and paths: the angular path keeps |p|, and straight paths pass through the mirror;
- the label layout: resting offset kept, priority and no overlap, hide vs must-show, own point, far ring with leader, preferred direction, jitter hysteresis, margin asymmetry, stereo parallax.

**IWER suite (`__mw.verify`, fresh page `?rafshim=1`):** 31/31 pass, in evidence/second-demo/iwer-verify-run-second-demo.json (local evidence; not included). That is the 29 earlier steps plus two new ones.

- **`comparison`:**
  - The prepared actions open the comparison.
  - Every step boundary deviates by 0 m from the exact stages.
  - Mid-rotation, e₁ is at (0.7071, 0.7071, 0); mid-reflection, a is at (1, 0, 0).
  - Step text and indicator are correct.
  - Labels at rest have no overlap in either eye.
  - Replay uses `compare_steps`.
  - Picking in the right panel returns `output2` and selects b.
  - Reversing the left route through `set_branch` makes the views agree (0 m) and gives `RS = RS`; Undo restores.
  - A commit mid-play finishes on the committed target.
  - P comes back with the linked layout and `apply_map` playback.
- **`labelOverlap`:**
  - P with u (u/v), P with w₃ (origin group), Q with (−1, 0, 0) (origin group), the same from an oblique head pose (0.32 m right, 11° yaw), Q with a (a/b), and a selection change.
  - In every case the must-show labels are shown and no shown floating label overlaps another label or fixed text in either eye camera.
  - 40 frames of millimetre head jitter change no decision.
  - Head movement leaves the document byte-identical.
  - Undo walks back to P with w₃.
- **`rebindQ`:** now asserts that "Pa" is described. Its readability is checked by `labelOverlap`. The earlier assertion that the mathematical declutter removed it is gone with that rule.

**Desktop captures (`docs/evidence/second-demo/`):**

- `comparison-rest.png`
- `comparison-step1-mid.png` (left turning 45°, right collapsing onto the mirror)
- `comparison-step1-result.png` (R e₁ = (0, 1, 0); S e₁ = e₁ fixed)
- `comparison-step2-mid.png`
- `comparison-left-reversed.png` (both S then R, `RS = RS`)
- `comparison-xr-stereo-iwer.png` (both emulated eyes)
- `labels-pq-w3-before.png` / `labels-pq-w3-after.png` and `labels-pq-q-before.png` / `labels-pq-q-after.png`. The "before" captures are the same scene with the layout switched off (labels at their resting offsets). They do not reproduce the removed declutter rule, which hid single-name labels near the selected group.

Console during comparison playback and idle frames: no errors and no warnings. The known F11 `emissive` warning appears only when Dot3D materials are created, such as on a demo switch.

## Not verified / limits

- **No headset session yet.** Readability at 0.8 m, the panel tilt and the side panels' 30° extent need a short wearer check. Emulator and desktop evidence is not headset evidence.
- **During playback:**
  - The label layout is frozen; names use the outward rule.
  - At the midpoint of a straight step the collapsed square's names overlap (for example "b c" on the left) until the step ends.
- **Fixed text on the side panels** is yawed toward the viewer, not billboarded. From a desktop camera above it, the text reads slightly slanted.
- **The voice line and the assistant line** sit above the desktop camera's frame (bench y = 0.405-0.448). They are in view in XR.
- **Long routes:** a route of four to six maps puts two verbs per line and narrows the step-line spacing. That case was not reviewed visually.
