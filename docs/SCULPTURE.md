# Kinetic group sculpture (demonstration 1)

Worker A track, 30 October 2026. Scope: FOUR-DEMOS-PARALLEL-HANDOFF sections 4, 5 and 9; contract:
`docs/INTERFACES.md`, "Four algebra demonstrations".

## What the scene shows

The left regular action of a finite group G on itself (|G| ≤ 8), as a small kinetic sculpture on the workbench:

- **Ring of slots.** A thin rail in a plane tilted 30° back, floating above a low plinth. Slot i is the home of bead
  `elements[i]` (canonical order, clockwise from the top). Each slot has a collar in its home bead's colour and a
  small engraved slot number on the inside. Cycle notation on the cards uses these slot numbers.
- **Beads.** One bead per element. Its identity is the element x and never changes. Three cues carry it: a
  colour, a silhouette (sphere, octahedron, cube, torus, then tetrahedron, puck, dodecahedron, capsule) and the
  element label next to it. After the accumulated element k, bead x sits in the slot of k·x.
- **Collars mark home.** A collar glows when its own bead rests in it, so "every bead is home" lights the whole
  ring, and a soft pulse runs around the rail when a step brings everything home.
- **Motion.** A step's moves are the cycles of `regularPermutation(G, g)`; nothing is chosen by group name. The
  path shape depends only on cycle length:
  - length 1: the bead stays;
  - length 2: a paired exchange, the two beads arcing past on opposite sides of their chord. Each pair gets its
    own depth level along the ring normal (one pair in front, one behind), so C4's `2` and every non-identity V4
    element show two clearly separated exchanges;
  - length ≥ 3: coherent flow around the ring, one direction per cycle (C4's generator turns all four beads
    together).

  Soft additive trails grow behind the moving beads and fade after arrival. Beads and trails in front of the ring
  plane are slightly brighter and larger than those behind it, which gives the depth separation a cue in flat
  footage too.
- **Selected operation (`cycle_trails`).** At rest, faint arcs with arrowheads and a travelling pulse preview where
  the selected card would send each bead. Each arc is coloured by the bead now in its source slot.
- **Operation cards.** One tangible card per element. It shows the label and, with `element_orders`, the cycle
  notation of its regular action on slots (`(0 1 2 3)`, `(0 2)(1 3)`, `()`), "order k" and k pips. Cards of order
  |G| (the elements that cycle every bead) get gold pips, gold text and a gold stripe. The selected card lifts
  and gets a gold rim. While a card's element is moving the beads, that card brightens.
- **Plates.** `Apply <g>` (gold rim, dimmed when nothing is selected or the history is full), `Replay` and `Reset`.
- **Info column (billboarded).** Group name, "n elements · bead x sits in slot k·x", the chronological history
  ("1, then 1, then 1"), `k = …`, and a home line: "one more returns every bead home", or "every bead is home
  again" in mint, or "applying 1 · (0 1 2 3)" while a step moves. With `element_orders` it adds the orders
  summary ("orders 1, 4, 2, 4"), the contrast ("two elements of order 4 / each one cycles all four beads" for
  C4; "no element of order 4 / repeat any card: home again within 2" for V4) and "same number of elements,
  different operation structure".

All text is `TextSlot` geometry: TeX for mathematics, plain for words. There are no DOM overlays.

## Files and exports

| File | Contents |
|---|---|
| `src/domains/sculpture/derive.ts` | `deriveSculpture(input: GroupSceneInput): SculptureDesc` (pure), `stepOf`, `slotsAfter`, `historyWords`, `plainGroupLabel`, `SculptureError` and the description types |
| `src/domains/sculpture/paths.ts` | Ring frame and path templates by cycle length: `pathSpecs(cycles, n)`, `evalPath`, `PathCurve`, `ease`, `RING` (presentation only) |
| `src/domains/sculpture/scene.ts` | `class SculptureScene implements DomainScene<SculptureDesc>` (layout `'sculpture'`), `BEAD_COLORS`, `BEAD_SHAPES` |
| `src/domains/sculpture/index.ts` | Re-exports all of the above |
| `src/domains/sculpture/harness.ts` | Default `HarnessModule<SculptureDesc>`: fixtures plus a planner simulation for this scene's actions |
| `tests/sculpture/derive.test.ts`, `tests/sculpture/paths.test.ts` | Focused checks (below) |

### `SculptureDesc` (plain JSON, deterministic in the input)

`layout`, `experimentId`, `revision`, `mathRevision`, `groupId`, `groupKey` (`definitionKey`), `definition`,
`groupLabel {tex, plain}`, `order`, `identity`, `elements`, `show {beads, trails, orders}` (from the recipe's
`regular_action` / `cycle_trails` / `element_orders`; with no recipe, beads only), `recipe {id, name, kinds} | null`,
`slots [{index, home}]`, `beads [{element, index, label, slot, home}]`,
`history [{element, label, via}]`, `steps[]`, `timeline[]`, `accumulated`, `atHome`, `operation` (the selected card,
from `input.operation`), `item`, `cards[]`, `orders`, `historyFull`, `status`.

- `steps[i]`: `{index, element, label, via, permutation, cycles (fixed points included), cycleText, before, after,
  slotsBefore, slotsAfter, moves[]}`, where `moves[b] = {bead, beadIndex, from, to, cycle, cycleLength}`.
- `timeline[j]`: the state after j steps: `{steps, accumulated, accumulatedLabel, atHome, slots, historyText,
  status, homeLine}`.
- `cards[]`: `{element, index, label, order, permutation, cycles, cycleText, cycleTex, cycleType, identity,
  generates (order = |G|), selected}`.
- `orders`: `{list, maxOrder, generators, cyclic, summary, contrast, contrastLines, explanation}`.

The derivation checks its input. It throws `SculptureError` when the order is above 8 (`DOMAIN_LIMITS.sculptureOrder`),
the history is above 24 steps or holds a non-element, or `input.accumulated` is not the chronological product of
the history.

## Scene behaviour

- **`apply(desc, 'animate')`.** First, any running animation is finished at its exact end. The scene then diffs
  against the previous description. If it is the same experiment and group and the history grew by exactly one
  step on the same prefix, that step animates (1.6 s). If only the selection or recipe changed, nothing moves.
  Anything else (reset, undo, another experiment, a rebind to another group) jumps to the committed state and
  clears trails. A change of group rebuilds beads, slots, cards and paths, with a 0.5 s scale-in.
- **`apply(desc, 'snap')`.** Jumps to the committed state.
- **Readouts.** Bead slots, collars and readouts come from `timeline` and `steps`, never from interpolated
  geometry. The readouts change when a step arrives.
- **`setPlayback`.**
  - `'replay'` replays the whole history from home: 1.6 s per step, 0.5 s hold between steps.
  - `'toggle'` pauses or resumes; when idle it starts a replay.
  - `'play'` and `'pause'` do what they say.
  - `'finish'` jumps to the end.
  - `{seek}` seeks a replay, starting it paused if needed.
- **`playback()`.** Returns `{active, playing, time, duration, phase: 'apply' | 'replay', step: {index (1-based),
  count (history length), label: "1 · step 2 of 4"}}`, or idle.
- **`setStepDuration(seconds)`.** An extra method, not part of `DomainScene`: 0.3–5 s per step, for `play_steps`.
- **`pick(ray)`.** Builds actions from the current description:
  - an unselected card returns `[{kind:'select_item', experimentId, item: g}]` with the hint
    "Select 1 · order 4 · (0 1 2 3)";
  - the selected card or the Apply plate returns `[{kind:'apply_element', experimentId, element: g}]` with the
    hint "Apply 1";
  - Reset returns `[{kind:'reset_group', experimentId}]`;
  - Replay returns `presentation: 'replay'`.

  Pressing Reset when already home, Apply with nothing selected, or Apply when the history is full returns `[]`
  with an explanatory hint. Pick targets are the card or plate plus 6–13 mm of margin; cards are 92 × 112 mm
  for |G| ≤ 4.
- **`status()`.** One plain line for the state on screen, for example "C4 · 1 applied 3 times · one more returns
  every bead home", "V4 · (1,0) applied twice: every bead is home" or "C4 · 2 operations applied, k = 3 ·
  applying 1 once returns every bead home". During an animation it describes the state being shown, and changes
  when the step arrives.
- **`report()`.** Plain data: the displayed moment, bead positions, shapes and colours, cards, playback, mesh and
  tube counts, and the state of every text slot.
- **Frame cost.** `step()` allocates nothing. It uses scratch vectors, indexed loops, precomputed pick IDs and
  tubes, and only sets text when a step boundary is crossed.
- **Resources.** Tubes for every element and source slot are built when the group changes: 12 for C4 or V4, at
  most 56 for C8. `dispose()` frees all geometry, materials, textures and text slots; the scene's own geometry
  count drops back after it.

Harness counts: C4 has 74 draw calls and about 21k triangles including the environment; C8 has 161 draw calls and
about 54k triangles.

## Filming sequence (harness)

Open `http://localhost:3010/harness.html?domain=sculpture&fixture=c4-home`. You can click through it, or script it
with `__harness.show(name)`, which animates from the previous fixture.

1. `c4-home`: four beads at home, four cards with orders 1, 4, 2, 4. Click card **1** to select it; its preview
   arcs appear.
2. Click card **1** again, or **Apply 1**, four times. The beads flow clockwise together. After the fourth step
   every collar lights, the rail pulses and the home line reads "every bead is home again". The fixtures
   `c4-1` … `c4-4` give the same states.
3. Optional: click card **2** and apply it twice. You see two exchanges, front and back, and the beads are home
   after two (`c4-c2-selected`, `c4-c2`, `c4-c2-twice`).
4. Rebind the same recipe to V4. In the app this is the coordinator's `bind_recipe`; in the harness, show
   `v4-selected`. The beads rebuild with V4 labels and the cards read orders 1, 2, 2, 2.
5. Apply **(1,0)** twice (`v4-1`, `v4-2`). You see two paired exchanges at different depths, and every bead is
   home after two. `v4-v01` shows the crossing exchanges through the centre, where the depth separation is
   clearest.
6. Show `c4-orders` and `v4-orders` side by side, or in sequence. C4 has gold order-4 cards and "two elements of
   order 4"; V4 has none, and "no element of order 4". Both show "same number of elements, different operation
   structure".
7. **Replay** re-runs the history from home; the readouts follow each step.

Other fixtures: `c4-beads-only` (a recipe with only `regular_action`), `c3-selected`, `c6-selected`, `c6-2`,
`c8-selected`. These are genericity checks.

## Captures (`docs/evidence/four-demos/sculpture/`, headless Chrome WebGL, 1600×1000)

| File | Shows |
|---|---|
| `01-c4-home.png` | C4 at home with the cards (orders 1, 4, 2, 4; order-4 cards in gold) |
| `02-c4-generator-selected.png` | Card 1 selected: lifted card, preview arcs for (0 1 2 3) |
| `03-c4-generator-midflow.png` | Mid-step: one coherent clockwise flow, trails, "applying 1 · (0 1 2 3)" |
| `04-c4-after-one.png`, `05-c4-after-three.png` | k = 1, k = 3 ("one more returns every bead home") |
| `06-c4-home-after-four-pulse.png`, `07-c4-home-after-four.png` | Home after four: every collar lit, rail pulse, "every bead is home again" |
| `08`–`10` (`c4-order-two-*`) | C4's order-two element: two exchanges (front and back), home after two |
| `11-v4-rebound-selected.png` | Same recipe on V4: (1,0) selected, orders 1, 2, 2, 2 |
| `12-v4-paired-exchange-mid.png` | V4 (1,0) mid-step: two paired exchanges, front pair brighter |
| `13-v4-after-one.png`, `14-v4-home-after-two-pulse.png` | V4 after one; home after two with the pulse |
| `15-v4-crossing-exchanges-depth.png` | V4 (0,1): both exchanges cross the centre, separated in depth |
| `16-c4-orders.png`, `17-v4-orders.png` | The order contrast (gold order-4 cards vs. none) |
| `18-c4-replay-step-two.png` | Replay paused in step 2 of 3; the readouts follow the replay |
| `19-c4-hover-card-3.png` | Hover feedback on a card |

The capture scripts are short `scripts/shot.mjs` invocations, with the same steps as the filming sequence above.

## Visual decisions

- **Quiet scene.** No environment additions. The beads are emissive, with soft additive halos (opacity 0.3);
  trails and previews are additive tubes that soften at the rim. Gold (`#ffd27a`) marks only selection and
  order-|G|. Mint marks only "home again".
- **Ring tilt.** At 30° the ring reads as a ring from the seated view, the in-front and behind levels are real
  depth in stereo, and the front pair also shifts slightly upward on screen.
- **Bead labels.** They sit radially outside the collar, further out for wide labels such as "(1,1)", and are
  nudged 3 cm toward the head so the rail never cuts them. Slot numbers sit inside the ring and fade out while
  beads travel; collars dim to open sockets during motion.
- **Card text.** It lies on the card face and is not billboarded: the card is the tangible object. Text anchors
  sit 2.6 mm above the face, because TeX glyphs are built 1 mm behind their anchor (`tex.ts`) and were
  z-fighting with the face. Long cycle notation (C6, C8) shrinks to fit the card.

## Limitations

- Mid-crossing (V4 `(0,1)`, C4 `2`), bead labels can sit over the dimmed collars of the slots the beads pass. They
  stay legible, but the frame is busier than at rest.
- The depth separation is real 3D (about ±5.5 cm along the ring normal). In flat captures it shows only through
  size, brightness, slight vertical offset and occlusion. Stereo in a headset has not been checked in this track.
- For C8 the card cycle notation is small (it is scaled to fit 60 mm cards). The required sequence uses only C4
  and V4.
- The "same number of elements, different operation structure" caption is a fixed sentence shown with the
  orders. Each scene only knows its own group, so the comparison is made by the sequence (C4, then V4).
- Only desktop harness captures. The scene has not been checked inside the integrated app or on a headset here.

## Requests to the coordinator

1. **Registry wiring.** Create `new SculptureScene()` for layout `'sculpture'`. On every committed change, call
   `deriveSculpture(input)`, then `apply(desc, 'animate')` after an action, or `apply(desc, 'snap')` after open,
   import, undo or a demonstration switch. The scene animates only a history that grew by exactly one step, so
   sending `'animate'` for everything is also safe.
2. **`play_steps { stepDuration }`.** Call `(scene as SculptureScene).setStepDuration(stepDuration)` before
   `setPlayback('replay')`, or add an optional `setStepDuration?(s)` to `DomainScene`.
3. **Status timing.** `status()` follows the displayed state, so it changes when an animated step arrives. If the
   controls panel should show the committed status immediately, read `desc.status` instead.
4. **Small core comment fix (not blocking).** `src/algebra/permutation.ts` says the sculpture bound is
   `MAX_SCULPTURE_ORDER in groups.ts`, but the bound is `DOMAIN_LIMITS.sculptureOrder` in `src/domains/inputs.ts`.
