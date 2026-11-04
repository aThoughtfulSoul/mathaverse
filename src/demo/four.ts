// Prepared data for the four algebra demonstrations (FOUR-DEMOS-PARALLEL-HANDOFF). Like pq.ts and order.ts
// these are ordinary actions planned by the same reducer as every other edit, so a demo switch, a spatial
// control, a scene press and an assistant proposal take one validated path (Undo and persistence included).
// Nothing here renders anything or computes mathematics: the planner and src/algebra do.

import { type Doc, type AnyExperiment, type GroupExperiment, type BraidExperiment, findGroup, groupFor } from '../workspace/document'
import { GROUP_SCULPTURE, TWO_WORLDS, CHOOSE_WHAT_MATTERS, WEAVING } from '../recipes/recipe'
import { chronologicalProduct } from '../algebra/groups'
import { wordEq } from '../algebra/braid'
import { type DemoKind, demoOf } from './order'

/** IDs the prepared actions create (the planner derives them from the local names below). */
export const FOUR_IDS = {
  groupC4: 'grp-c4',
  groupV4: 'grp-v4',
  groupCube: 'grp-cube',
  expC4: 'exp-c4',
  expV4: 'exp-v4',
  expCube: 'exp-cube',
  expQuotient: 'exp-quotient',
  expBraid: 'exp-braid',
  recipeSculpture: 'recipe-sculpture',
  recipeDiagonals: 'recipe-diagonals',
  recipeClasses: 'recipe-classes',
  recipeBraid: 'recipe-braid',
} as const

/** The C4 generator and a non-identity V4 element (the sculpture's starting selections). */
export const C4_GENERATOR = 'c1'
export const V4_ELEMENT = 'v10'
/** Rz90 and the half turn H of the handoff fixtures. */
export const RZ90 = 'r(y,-x,z)'
export const H_TURN = 'r(-x,z,y)'

/** Staged braid examples (handoff section 8): the braid relation, a double crossing, an inverse pair. */
export const BRAID_EXAMPLES = [
  { name: 'relation', word: [1, 2, 1], compare: [2, 1, 2] },
  { name: 'double', word: [1, 1], compare: [] },
  { name: 'cancel', word: [1, -1], compare: [] },
] as const

const has = (doc: Doc, kind: 'groups' | 'recipes', id: string) => (doc[kind] as { id: string }[]).some((x) => x.id === id)
const exp = (doc: Doc, id: string) => doc.experiments.find((e) => e.id === id) ?? null

function ensureGroup(doc: Doc, id: string, name: string, label: string, definition: unknown): { ref: string; actions: unknown[] } {
  return has(doc, 'groups', id) ? { ref: id, actions: [] } : { ref: `$${name}`, actions: [{ kind: 'create_group', name, label, definition }] }
}

function ensureRecipe(doc: Doc, id: string, name: string, recipe: unknown): { ref: string; actions: unknown[] } {
  return has(doc, 'recipes', id) ? { ref: id, actions: [] } : { ref: `$${name}`, actions: [{ kind: 'save_recipe', name, recipe }] }
}

/** Open (or create) the C4 sculpture, bound to the saved sculpture recipe with the generator selected. */
export function sculptureActions(doc: Doc, item: string | null = C4_GENERATOR): unknown[] {
  const existing = exp(doc, FOUR_IDS.expC4) ?? exp(doc, FOUR_IDS.expV4)
  if (existing) return [{ kind: 'select_item', experimentId: existing.id, item: existing.id === FOUR_IDS.expC4 ? item : V4_ELEMENT }]
  const g = ensureGroup(doc, FOUR_IDS.groupC4, 'c4', 'C_{4}', { kind: 'cyclic', order: 4 })
  const r = ensureRecipe(doc, FOUR_IDS.recipeSculpture, 'sculpture', GROUP_SCULPTURE)
  return [
    ...g.actions,
    ...r.actions,
    { kind: 'create_group_experiment', name: 'c4', groupId: g.ref },
    { kind: 'bind_recipe', experimentId: '$c4', recipeId: r.ref, bindings: { group: g.ref, operation: item } },
  ]
}

/** Rebind THE SAME saved recipe to the other group (C4 <-> V4), creating V4 and its experiment the first time. */
export function sculptureRebindActions(doc: Doc, shown: GroupExperiment): unknown[] {
  const toV4 = findGroup(doc, shown.groupId).definition.kind !== 'klein_four'
  const targetId = toV4 ? FOUR_IDS.expV4 : FOUR_IDS.expC4
  const recipeId = shown.binding?.recipeId ?? FOUR_IDS.recipeSculpture
  const target = exp(doc, targetId)
  if (target) return [{ kind: 'select_item', experimentId: target.id, item: toV4 ? V4_ELEMENT : C4_GENERATOR }]
  if (!toV4) return []
  const g = ensureGroup(doc, FOUR_IDS.groupV4, 'v4', 'V_{4}', { kind: 'klein_four' })
  return [
    ...g.actions,
    { kind: 'create_group_experiment', name: 'v4', groupId: g.ref },
    { kind: 'bind_recipe', experimentId: '$v4', recipeId, bindings: { group: g.ref, operation: V4_ELEMENT } },
  ]
}

/** Open (or create) the cube with its four diagonals. */
export function cubeActions(doc: Doc): unknown[] {
  const existing = exp(doc, FOUR_IDS.expCube)
  if (existing) return [{ kind: 'select_item', experimentId: existing.id, item: null }]
  const g = ensureGroup(doc, FOUR_IDS.groupCube, 'cube', 'G', { kind: 'cube_rotations' })
  const r = ensureRecipe(doc, FOUR_IDS.recipeDiagonals, 'diagonals', TWO_WORLDS)
  return [
    ...g.actions,
    ...r.actions,
    { kind: 'create_group_experiment', name: 'cube', groupId: g.ref },
    { kind: 'bind_recipe', experimentId: '$cube', recipeId: r.ref, bindings: { group: g.ref, selection: null } },
  ]
}

/** Open (or create) the 24-rotation constellation for the quotient. */
export function quotientActions(doc: Doc): unknown[] {
  const existing = exp(doc, FOUR_IDS.expQuotient)
  if (existing) return [{ kind: 'select_item', experimentId: existing.id, item: null }]
  const g = ensureGroup(doc, FOUR_IDS.groupCube, 'cube', 'G', { kind: 'cube_rotations' })
  const r = ensureRecipe(doc, FOUR_IDS.recipeClasses, 'classes', CHOOSE_WHAT_MATTERS)
  return [
    ...g.actions,
    ...r.actions,
    { kind: 'create_group_experiment', name: 'quotient', groupId: g.ref },
    { kind: 'bind_recipe', experimentId: '$quotient', recipeId: r.ref, bindings: { group: g.ref, selection: null } },
  ]
}

/** Open (or create) the braid workspace on the braid relation, [1,2,1] beside [2,1,2]. */
export function braidActions(doc: Doc): unknown[] {
  const existing = exp(doc, FOUR_IDS.expBraid)
  if (existing) return [{ kind: 'select_item', experimentId: existing.id, item: null }]
  const r = ensureRecipe(doc, FOUR_IDS.recipeBraid, 'braid', WEAVING)
  const first = BRAID_EXAMPLES[0]
  return [
    ...r.actions,
    { kind: 'create_braid_experiment', name: 'braid', word: [...first.word], compare: [...first.compare] },
    { kind: 'bind_recipe', experimentId: '$braid', recipeId: r.ref, bindings: { word: 'word', compare: 'compare' } },
  ]
}

/** Prepared actions that show one of the four demonstrations. */
export function fourDemoActions(doc: Doc, kind: Exclude<DemoKind, 'pq' | 'order' | 'proof'>): unknown[] {
  switch (kind) {
    case 'sculpture':
      return sculptureActions(doc)
    case 'cube':
      return cubeActions(doc)
    case 'quotient':
      return quotientActions(doc)
    case 'braid':
      return braidActions(doc)
  }
}

/** The braid example currently shown (by its compare word and origin), or -1. */
export function braidExampleIndex(e: BraidExperiment): number {
  return BRAID_EXAMPLES.findIndex((x) => wordEq(x.compare, e.compare ?? []) && wordEq(x.word, e.origin))
}

/**
 * The two demonstration-specific spatial controls of a group or braid experiment (the `mode` and `rebind`
 * buttons of the linear demos): their labels and the actions a press commits. An empty action list means
 * nothing to do (the press is ignored).
 */
export function domainControls(doc: Doc, e: AnyExperiment): { reset: { label: string; actions: unknown[] }; extra: { label: string; actions: unknown[] } } {
  const kind = demoOf(doc, e)
  if (e.domain === 'group') {
    const reset = { label: 'Reset', actions: e.history.length || e.operands.some((o) => o !== null) ? [{ kind: 'reset_group', experimentId: e.id }, ...(e.operands.some((o) => o !== null) ? [{ kind: 'set_operands', experimentId: e.id, operands: [null, null] }] : [])] : [] }
    if (kind === 'sculpture') {
      const v4 = findGroup(doc, e.groupId).definition.kind === 'klein_four'
      return { reset, extra: { label: v4 ? 'Show C4' : 'Use on V4', actions: sculptureRebindActions(doc, e) } }
    }
    if (kind === 'quotient') {
      const grouped = e.observation === 'unoriented_axis_lines'
      return { reset, extra: { label: grouped ? 'Show all 24' : 'Group classes', actions: [{ kind: 'set_observation', experimentId: e.id, observation: grouped ? 'none' : 'unoriented_axis_lines' }] } }
    }
    // Cube: return to the identity orientation by applying the inverse of the accumulated rotation.
    const g = groupFor(doc, e)
    const k = chronologicalProduct(g, e.history.map((h) => h.element))
    return { reset, extra: { label: 'Return', actions: k === g.identity ? [] : [{ kind: 'apply_element', experimentId: e.id, element: g.inverse(k) }] } }
  }
  if (e.domain === 'braid') {
    const i = braidExampleIndex(e)
    const next = BRAID_EXAMPLES[(i + 1) % BRAID_EXAMPLES.length]!
    const current = BRAID_EXAMPLES[Math.max(i, 0)]!
    const atStart = wordEq(e.word, current.word) && wordEq(e.origin, current.word) && !e.rewrites.length
    return {
      reset: { label: 'Reset', actions: atStart ? [] : [{ kind: 'set_braid', experimentId: e.id, target: 'word', word: [...current.word] }, { kind: 'set_braid', experimentId: e.id, target: 'compare', word: [...current.compare] }] },
      extra: { label: 'Next example', actions: [{ kind: 'set_braid', experimentId: e.id, target: 'word', word: [...next.word] }, { kind: 'set_braid', experimentId: e.id, target: 'compare', word: [...next.compare] }] },
    }
  }
  return { reset: { label: 'Reset', actions: [] }, extra: { label: 'Use on Q', actions: [] } }
}

/** Button labels the domain controls can show (prepared as glyph tokens like every other label). */
export const FOUR_CONTROL_TEXTS = ['Reset', 'Use on V4', 'Show C4', 'Show all 24', 'Group classes', 'Return', 'Next example', 'Sculpture', 'Cube demo', 'Quotient', 'Braids']
