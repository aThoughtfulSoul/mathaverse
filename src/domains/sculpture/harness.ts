// DEV harness module for the kinetic group sculpture (src/dev/harness.ts):
//   http://localhost:3010/harness.html?domain=sculpture&fixture=c4-home
// Fixtures are built from exact inputs through groupOf; onPick simulates the planner for this scene's own
// actions (select_item, apply_element, reset_group) so the filming sequence can be clicked through in isolation.
// The C4 -> V4 rebind is the coordinator's bind_recipe; here the V4 fixtures stand in for its result.

import type { HarnessModule } from '../../dev/harness'
import { chronologicalProduct, groupOf, type GroupDefinition } from '../../algebra/groups'
import type { GroupOperation, GroupSceneInput, SceneRecipe } from '../inputs'
import { deriveSculpture, type SculptureDesc } from './derive'
import { SculptureScene } from './scene'

/** The prepared sculpture rule's operations (GROUP_SCULPTURE in src/recipes/recipe.ts). */
const SCULPTURE_OPS: GroupOperation[] = [
  { kind: 'regular_action', group: 'group', operation: 'operation' },
  { kind: 'cycle_trails', group: 'group', operation: 'operation' },
  { kind: 'element_orders', group: 'group' },
]
const RECIPE: SceneRecipe<GroupOperation> = { id: 'recipe-sculpture', name: 'Group sculpture', operations: SCULPTURE_OPS }

const C4: GroupDefinition = { kind: 'cyclic', order: 4 }
const V4: GroupDefinition = { kind: 'klein_four' }

function ids(def: GroupDefinition): { experimentId: string; groupId: string; label: string } {
  if (def.kind === 'klein_four') return { experimentId: 'exp-v4', groupId: 'grp-v4', label: 'V_{4}' }
  if (def.kind === 'cyclic') return { experimentId: `exp-c${def.order}`, groupId: `grp-c${def.order}`, label: `C_{${def.order}}` }
  return { experimentId: 'exp-cube', groupId: 'grp-cube', label: 'G' }
}

let revision = 0

function input(def: GroupDefinition, history: readonly string[], operation: string | null, recipe: SceneRecipe<GroupOperation> | null = RECIPE): GroupSceneInput {
  const group = groupOf(def)
  const { experimentId, groupId, label } = ids(def)
  revision++
  return {
    experimentId,
    revision,
    mathRevision: revision,
    groupId,
    groupLabel: label,
    definition: def,
    group,
    history: history.map((element) => ({ element, via: 'element' as const })),
    accumulated: chronologicalProduct(group, history),
    operands: [null, null],
    observation: 'none',
    item: operation,
    operation,
    recipe,
  }
}

const desc = (def: GroupDefinition, history: readonly string[], operation: string | null) => deriveSculpture(input(def, history, operation))
const times = (g: string, k: number) => Array<string>(k).fill(g)

const fixtures: Record<string, () => SculptureDesc> = {
  'c4-home': () => desc(C4, [], null),
  'c4-selected': () => desc(C4, [], 'c1'),
  'c4-1': () => desc(C4, times('c1', 1), 'c1'),
  'c4-2': () => desc(C4, times('c1', 2), 'c1'),
  'c4-3': () => desc(C4, times('c1', 3), 'c1'),
  'c4-4': () => desc(C4, times('c1', 4), 'c1'),
  'c4-c2-selected': () => desc(C4, [], 'c2'),
  'c4-c2': () => desc(C4, ['c2'], 'c2'),
  'c4-c2-twice': () => desc(C4, ['c2', 'c2'], 'c2'),
  'c4-orders': () => desc(C4, [], null),
  'v4-home': () => desc(V4, [], null),
  'v4-selected': () => desc(V4, [], 'v10'),
  'v4-1': () => desc(V4, ['v10'], 'v10'),
  'v4-2': () => desc(V4, ['v10', 'v10'], 'v10'),
  'v4-v01-selected': () => desc(V4, [], 'v01'),
  'v4-v01': () => desc(V4, ['v01'], 'v01'),
  'v4-orders': () => desc(V4, [], null),
  'c4-beads-only': () => deriveSculpture(input(C4, ['c1'], 'c1', { id: 'recipe-plain', name: 'Plain', operations: [SCULPTURE_OPS[0]!] })),
  'c6-selected': () => desc({ kind: 'cyclic', order: 6 }, [], 'c2'),
  'c6-2': () => desc({ kind: 'cyclic', order: 6 }, ['c2'], 'c2'),
  'c8-selected': () => desc({ kind: 'cyclic', order: 8 }, [], 'c3'),
  'c3-selected': () => desc({ kind: 'cyclic', order: 3 }, [], 'c1'),
}

/** Rebuild the input a description came from, change it as the planner would, derive again. */
function onPick(pick: { actions: unknown[] }, current: SculptureDesc): SculptureDesc | null {
  const action = pick.actions[0] as { kind: string; item?: string | null; element?: string } | undefined
  if (!action) return null
  const recipe: SceneRecipe<GroupOperation> | null = current.recipe ? { id: current.recipe.id, name: current.recipe.name, operations: SCULPTURE_OPS.filter((o) => current.recipe!.kinds.includes(o.kind)) } : null
  const history = current.history.map((h) => h.element)
  if (action.kind === 'select_item') return deriveSculpture(input(current.definition, history, action.item ?? null, recipe))
  if (action.kind === 'apply_element' && action.element) return deriveSculpture(input(current.definition, [...history, action.element], current.operation, recipe))
  if (action.kind === 'reset_group') return deriveSculpture(input(current.definition, [], current.operation, recipe))
  return null
}

const harness: HarnessModule<SculptureDesc> = {
  title: 'Kinetic group sculpture',
  create: () => new SculptureScene(),
  fixtures,
  onPick,
}

export default harness
