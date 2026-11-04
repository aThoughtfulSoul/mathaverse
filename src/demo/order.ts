// Prepared data for the operation-order demonstration (SECOND-DEMO-PARALLEL-HANDOFF): a labelled square on
// the plane z = 0 and one experiment with two branches, "R then S" and "S then R". Like the P-to-Q data in
// pq.ts these are ordinary W4 actions planned by the same reducer as every other edit, so the prepared entry,
// a local control and an assistant proposal take the same validated path. Nothing here renders anything.

import { type Doc, type Experiment, type AnyExperiment, findRecipe, findBranch, findMap, findGroup } from '../workspace/document'
import { ORDER_MATTERS, comparisonOf, layoutOf } from '../recipes/recipe'

/** R: a positive quarter turn about mathematical z. S: negate y (across the xz-plane; the x-axis on z = 0). */
export const R_DEFINITION = { preset: { kind: 'rotation', quarterTurns: 1, axis: 2 } } as const
export const S_DEFINITION = { preset: { kind: 'reflection', axis: 1 } } as const

/** IDs the prepared actions create (the planner derives them from the local names below). */
export const ORDER_IDS = {
  sampleSet: 'set-square',
  mapR: 'map-r',
  mapS: 'map-s',
  recipe: 'recipe-compare',
  experiment: 'exp-order',
  left: 'left',
  right: 'right',
  /** The selected witness e1 = (1, 0, 0). */
  witness: 's(1,0,0)',
} as const

const r = (n: number) => ({ n: String(n), d: '1' })
const sample = (id: string, label: string, x: number, y: number) => ({ id, label, coords: [r(x), r(y), r(0)] })

/** The square's corners a, b, c, d (counterclockwise from (1, 1, 0)) and the witness e1. */
export const SQUARE_SAMPLES = [
  sample('s(1,1,0)', 'a', 1, 1),
  sample('s(-1,1,0)', 'b', -1, 1),
  sample('s(-1,-1,0)', 'c', -1, -1),
  sample('s(1,-1,0)', 'd', 1, -1),
  sample(ORDER_IDS.witness, 'e_{1}', 1, 0),
]

/** The seven demonstrations: P-to-Q, the operation-order comparison, the four algebra demonstrations
 * (FOUR-DEMOS handoff: the C4/V4 sculpture, cube rotations and diagonals, the quotient, braids) and the proof
 * lesson (PROOF-EXPLORER-SPEC: a reordering step of the Steinitz–Bergström proof, on a vector walk). */
export const DEMO_KINDS = ['pq', 'order', 'sculpture', 'cube', 'quotient', 'braid', 'proof'] as const
export type DemoKind = (typeof DEMO_KINDS)[number]

/** Which demonstration an experiment belongs to: from its bound recipe's layout (or its domain when unbound). */
export function demoOf(doc: Doc, e: AnyExperiment): DemoKind {
  if (e.domain === 'vector_walk') return 'proof'
  if (e.domain === 'braid') return 'braid'
  if (e.domain === 'group') {
    const layout = e.binding ? layoutOf(findRecipe(doc, e.binding.recipeId)) : null
    if (layout === 'cube_diagonals') return 'cube'
    if (layout === 'quotient_classes') return 'quotient'
    if (layout === 'regular_action') return 'sculpture'
    return findGroup(doc, e.groupId).definition.kind === 'cube_rotations' ? 'cube' : 'sculpture'
  }
  return e.binding && comparisonOf(findRecipe(doc, e.binding.recipeId)) ? 'order' : 'pq'
}

/** The experiment shown for a demonstration, if the document has one. */
export function experimentFor(doc: Doc, kind: DemoKind): AnyExperiment | null {
  return doc.experiments.find((e) => demoOf(doc, e) === kind) ?? null
}

/**
 * Actions that show the operation-order comparison: select it when it exists, otherwise create it (seven
 * actions, inside the eight-action proposal limit) and replay it. Objects that already exist are reused.
 */
export function orderDemoActions(doc: Doc, selection: string | null = ORDER_IDS.witness): unknown[] {
  const existing = experimentFor(doc, 'order')
  if (existing) return [{ kind: 'select', experimentId: existing.id, sampleId: selection }]
  const has = (id: string) => doc.maps.some((m) => m.id === id)
  const setExists = doc.sampleSets.some((s) => s.id === ORDER_IDS.sampleSet)
  const recipeExists = doc.recipes.some((x) => x.id === ORDER_IDS.recipe)
  const set = setExists ? ORDER_IDS.sampleSet : '$square'
  const R = has(ORDER_IDS.mapR) ? ORDER_IDS.mapR : '$r'
  const S = has(ORDER_IDS.mapS) ? ORDER_IDS.mapS : '$s'
  return [
    ...(setExists ? [] : [{ kind: 'create_samples', name: 'square', dimension: 3, source: { samples: SQUARE_SAMPLES } }]),
    ...(has(ORDER_IDS.mapR) ? [] : [{ kind: 'create_map', name: 'r', label: 'R', dimension: 3, definition: R_DEFINITION }]),
    ...(has(ORDER_IDS.mapS) ? [] : [{ kind: 'create_map', name: 's', label: 'S', dimension: 3, definition: S_DEFINITION }]),
    ...(recipeExists ? [] : [{ kind: 'save_recipe', name: 'compare', recipe: ORDER_MATTERS }]),
    { kind: 'create_experiment', name: 'order', sampleSetId: set, branches: [{ id: ORDER_IDS.left, mapIds: [R, S] }, { id: ORDER_IDS.right, mapIds: [S, R] }] },
    {
      kind: 'bind_recipe', experimentId: '$order', recipeId: recipeExists ? ORDER_IDS.recipe : '$compare',
      bindings: { samples: set, left: ORDER_IDS.left, right: ORDER_IDS.right, selection },
    },
    { kind: 'play_comparison', experimentId: '$order', stepDuration: 1.6 },
  ]
}

/** Actions that show the P-to-Q demonstration again (the experiment shown last there, with its selection). */
export function pqDemoActions(doc: Doc, experimentId: string | null, selection: string | null): unknown[] {
  const e = (experimentId && doc.experiments.find((x) => x.id === experimentId && demoOf(doc, x) === 'pq')) || experimentFor(doc, 'pq')
  if (!e) return []
  return [{ kind: 'select', experimentId: e.id, sampleId: selection }]
}

/** Reverse one route of a comparison experiment (the same set_branch action an assistant would propose). */
export function reverseRouteActions(e: Experiment, branchId: string): unknown[] {
  return [{ kind: 'set_branch', experimentId: e.id, branchId, mapIds: [...findBranch(e, branchId).mapIds].reverse() }]
}

/** Chronological words for a branch ("R then S"); the resolved product reads right to left ("SR"). */
export function orderWords(doc: Doc, e: Experiment, branchId: string): string {
  const ids = findBranch(e, branchId).mapIds
  return ids.length ? ids.map((id) => findMap(doc, id).label).join(' then ') : 'identity'
}
