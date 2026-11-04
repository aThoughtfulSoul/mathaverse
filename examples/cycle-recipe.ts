// Runnable reuse example (FOUR-DEMOS-PARALLEL-HANDOFF section 10): one cycle recipe, registered once and
// bound to two (here three) group definitions through the same validated actions the app, a spatial control
// and the assistant use. Run from the implementation root:
//
//   npx vite-node examples/cycle-recipe.ts
//
// It prints, for each group, the computed regular-action cycles and orders of the bound operation and how
// many applications bring every bead home. Nothing here renders; the scene derivation is the same function
// the app calls (src/domains/registry.ts sceneInputFor + the sculpture track's deriveSculpture, when built).

import { Workspace } from '../src/workspace/reducer'
import { demoDocument, findGroupExperiment } from '../src/workspace/document'
import type { RecipeRule } from '../src/recipes/recipe'
import { sceneInputFor } from '../src/domains/registry'
import { chronologicalProduct, regularPermutation } from '../src/algebra/groups'
import { cycleText, permOrder } from '../src/algebra/permutation'

// 1. A recipe is a rule over typed ports, never code: a group port and an element port that reads the selection.
const CYCLES: RecipeRule = {
  name: 'Cycles of one operation',
  inputs: { group: { type: 'finite_group' }, operation: { type: 'group_element', memberOf: 'group' } },
  operations: [
    { kind: 'regular_action', group: 'group', operation: 'operation' },
    { kind: 'cycle_trails', group: 'group', operation: 'operation' },
    { kind: 'element_orders', group: 'group' },
  ],
}

// 2. Register it once, and three group definitions (the mathematical providers are typed definitions).
const ws = new Workspace(demoDocument('ws-example'))
const tx = (actions: unknown[]) => ws.commit({ baseRevision: ws.current.revision, actions })
tx([
  { kind: 'save_recipe', name: 'cycles', recipe: CYCLES },
  { kind: 'create_group', name: 'c4', label: 'C_{4}', definition: { kind: 'cyclic', order: 4 } },
  { kind: 'create_group', name: 'v4', label: 'V_{4}', definition: { kind: 'klein_four' } },
  { kind: 'create_group', name: 'c6', label: 'C_{6}', definition: { kind: 'cyclic', order: 6 } },
])

// 3. Bind THE SAME recipe to each group with an operation selected, then apply that operation until home.
const runs: [string, string, string][] = [['c4', 'grp-c4', 'c1'], ['v4', 'grp-v4', 'v10'], ['c6', 'grp-c6', 'c2']]
for (const [name, groupId, element] of runs) {
  tx([
    { kind: 'create_group_experiment', name, groupId },
    { kind: 'bind_recipe', experimentId: `$${name}`, recipeId: 'recipe-cycles', bindings: { group: groupId, operation: element } },
  ])
  const input = sceneInputFor(ws.current)
  if (!input || input.layout === 'braid' || input.layout === 'walk') throw new Error('expected a group scene input')
  const g = input.group.group
  const p = regularPermutation(g, element)
  let steps = 0
  do {
    tx([{ kind: 'apply_element', experimentId: `exp-${name}`, element }])
    steps++
  } while (chronologicalProduct(g, findGroupExperiment(ws.current, `exp-${name}`).history.map((h) => h.element)) !== g.identity && steps < 24)
  const name4 = (i: number) => g.label(g.elements[i]!).plain
  console.log(`${input.group.groupLabel.replace(/_\{(\d+)\}/, '$1')}: recipe "${input.group.recipe?.name}", operation ${g.label(element).plain}`)
  console.log(`  regular action ${cycleText(p, name4)} (computed exactly), order ${permOrder(p)} = element order ${g.elementOrder(element)}`)
  console.log(`  applied ${steps} times -> every bead home; orders of all elements: ${g.elements.map((x) => `${g.label(x).plain}:${g.elementOrder(x)}`).join(' ')}`)
}
console.log(`one recipe (${ws.current.recipes.filter((r) => r.name === CYCLES.name).length} saved copy), ${ws.current.experiments.filter((e) => e.domain === 'group').length} group experiments bound to it`)
