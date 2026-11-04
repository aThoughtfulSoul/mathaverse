# Extending the workspace: providers, recipes, scenes and assistant actions

2026-10-30 · FOUR-DEMOS-PARALLEL-HANDOFF section 10. This is the small developer surface the four algebra
demonstrations were built on. It is a documented set of typed boundaries inside this repository, not a
published npm package. This source release is MIT-licensed (see [LICENSE](../LICENSE)); `"private": true` prevents accidental npm publication.

## The runnable example

```sh
npx vite-node examples/cycle-recipe.ts
```

[examples/cycle-recipe.ts](../examples/cycle-recipe.ts) saves one cycle recipe, registers three group
definitions (C4, V4, C6), binds the same recipe to each through `bind_recipe`, and applies the bound
operation until every bead is home. It prints the computed regular-action cycles and orders, for example
C4's generator `(0 1 2 3)`, order 4, home after 4 applications; V4's `(1,0)` as two exchanges, order 2; C6's
`2` as `(0 2 4)(1 3 5)`, order 3. Everything goes through the same planner as the app.

## Where things connect

| Layer | File | What an extension adds | Limits |
|---|---|---|---|
| Exact mathematics (providers) | `src/algebra/groups.ts`, `src/algebra/permutation.ts`, `src/algebra/cube.ts`, `src/algebra/braid.ts` | A `GroupDefinition` variant and its constructor in `groupOf` (elements with stable IDs, identity first, a multiplication table, labels). Group actions such as `phiOf` and `piOf` are plain functions over element IDs. | Group order at most 24 (`MAX_GROUP_ORDER`); cyclic orders 1 to 12; permutation degree at most 24; braid words of at most 24 crossings on 3 strands. |
| Document | `src/workspace/document.ts` | Groups are stored as typed definitions (`groups[]`). Experiments are discriminated by `domain` (`linear`, `group`, `braid`). A new domain adds its experiment type, its parser and reference checks, and a migration if the schema version changes. | 10 experiments, 6 groups, 12 recipes, 24 steps of history or rewrites per experiment, 256 KiB. |
| Actions | `src/workspace/actions.ts` (structure), `src/workspace/reducer.ts` (semantics) | A closed action kind with structural parsing and a planner case that checks it against a temporary document. Effects (such as `play_steps`) are returned, never run in the planner. | At most 16 actions per transaction and 8 per assistant proposal; everything applies all or nothing. |
| Recipes | `src/recipes/recipe.ts` | Port types (`finite_group`, `group_element`, `braid_word`) and typed operations. Exactly one layout operation per recipe decides the scene: `regular_action`, `cube_diagonals`, `quotient_classes` or `braid_diagram` (plus the linear `linked_views` and `branch_comparison`). Binding checks that the recipe's domain matches the experiment's. | A recipe is a rule, never code; its operations are a closed list. |
| Scene inputs | `src/domains/inputs.ts`, `src/domains/registry.ts` | `sceneInputFor(doc)` resolves the displayed experiment into exact input (accumulated element, operands, observation, selected item, words, the bound recipe's operations). | Inputs carry exact data only; geometry is derived presentation. |
| Scenes | `src/domains/scene.ts`, `src/domains/all.ts` | A `DomainScene` (mount, apply with `animate`/`snap`, step, playback, pick, status, report) and a derivation, registered with `registerLayout(layout, { derive, create })`. A press returns validated actions; the app commits them. | A scene never edits state. Text is `TextSlot` geometry, so it works in stereo. |
| Assistant | `server/muse/schema.ts`, `server/muse/prompt.ts`, `server/muse/four.ts`, `server/muse/fourSynthetic.ts`, `src/workspace/context.ts` | Schema variants for each action; exact facts from the validated document; server-computed prepared templates (planned before they are offered); synthetic fixtures labelled as such. | The model chooses supported operations only; multiplication tables, proof status and renderer code never come from it. |
| Evidence | `server/lean/**` (linear claims only) | Finite results are labelled "computed exactly"; braid equalities "checked by supported rewrite rules". | No Lean badge without a real formal claim and receipt; no new Lean theorem families in this milestone. |

## Adding a group definition: the minimal path

1. Add a variant to `GroupDefinition` and build its table in `groupOf` (`fromTable` checks that the identity is
   first and computes inverses and orders).
2. Accept it in `parseGroupDefinition` (`src/workspace/document.ts`), and in the assistant schema's
   `create_group` definition (`server/muse/schema.ts`).
3. Bind an existing recipe to an experiment on it: the sculpture recipe works for any group of at most 8
   elements, because its derivation reads cycles from `regularPermutation`, never from group names.

## Adding a scene layout

1. Add the layout operation to `src/recipes/recipe.ts` (`LAYOUT_OPERATIONS`, its domain) and to
   `src/domains/inputs.ts`.
2. Map it to a `SceneLayout` in `sceneInputFor`.
3. Implement `derive` and a `DomainScene`, add a harness module (`src/domains/<name>/harness.ts`, shown at
   `harness.html?domain=<name>`), and register both in `src/domains/all.ts`.
