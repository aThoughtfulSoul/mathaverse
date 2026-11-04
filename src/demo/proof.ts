// Prepared actions of the proof lesson (PROOF-EXPLORER-SPEC sections 3 and 5). Like four.ts these are ordinary
// actions planned by the same reducer as every other edit, so the picker, a context item, the assistant and
// Undo take one validated path. The prepared cases are data (src/lessons/steinitz/cases.ts); nothing here
// computes a path, a bound or a result, and nothing selects "a good outcome": the derivation does.

import { type Doc, type VectorWalkExperiment, walkInputOf } from '../workspace/document'
import { REARRANGE_WALK } from '../recipes/recipe'
import { type Sign, deriveWalk, parseWalkItem, representativeEndpoints } from '../algebra/walk'
import { type CaseId, CASES, LESSON_ID, caseJson } from '../lessons/steinitz/cases'
import type { WalkStage } from '../domains/inputs'

/** IDs the prepared actions create (the planner derives them from the local names below). */
export const PROOF_IDS = {
  experiment: 'exp-walk',
  recipe: 'recipe-walk',
} as const

const exp = (doc: Doc): VectorWalkExperiment | null => (doc.experiments.find((e) => e.id === PROOF_IDS.experiment && e.domain === 'vector_walk') as VectorWalkExperiment | undefined) ?? null

/** The lesson's experiment, if the document has one. */
export function lessonExperiment(doc: Doc): VectorWalkExperiment | null {
  return exp(doc) ?? (doc.experiments.find((e) => e.domain === 'vector_walk') as VectorWalkExperiment | undefined) ?? null
}

/** Open (or create) the lesson: the saved walk recipe bound to a vector-walk experiment holding the hero case. */
export function proofActions(doc: Doc, item: string | null = null): unknown[] {
  const existing = lessonExperiment(doc)
  if (existing) return [{ kind: 'select_item', experimentId: existing.id, item }]
  const recipeExists = doc.recipes.some((r) => r.id === PROOF_IDS.recipe)
  const hero = caseJson('hero')
  return [
    ...(recipeExists ? [] : [{ kind: 'save_recipe', name: 'walk', recipe: REARRANGE_WALK }]),
    { kind: 'create_vector_walk', name: 'walk', ...hero, lesson: LESSON_ID },
    { kind: 'bind_recipe', experimentId: '$walk', recipeId: recipeExists ? PROOF_IDS.recipe : '$walk', bindings: { walk: 'walk' } },
  ]
}

/** Replace the lesson walk with a prepared case (one undoable edit; the binding and lesson stay). */
export function caseActions(e: VectorWalkExperiment, id: CaseId, stage?: WalkStage): unknown[] {
  return [{ kind: 'set_vector_walk', experimentId: e.id, ...caseJson(id) }, ...(stage ? [{ kind: 'show_walk_stage', experimentId: e.id, stage }] : [])]
}

/** Flip one occurrence's sign. */
export function flipSignActions(e: VectorWalkExperiment, id: string): unknown[] {
  const i = e.vectors.findIndex((v) => v.id === id)
  if (i < 0) return []
  return [{ kind: 'set_walk_signs', experimentId: e.id, signs: [{ id, sign: (e.signs[i] === 1 ? -1 : 1) as Sign }] }]
}

/** Set every sign to +1 (the all-positive variation, on whatever vectors the walk has). */
export function allPositiveActions(e: VectorWalkExperiment): unknown[] {
  if (e.signs.every((s) => s === 1)) return []
  return [{ kind: 'set_walk_signs', experimentId: e.id, signs: e.vectors.map((v) => ({ id: v.id, sign: 1 })) }]
}

/** Restore the prepared hero signs when the walk has the hero's vectors in the hero's order (else []). */
export function preparedSignsActions(e: VectorWalkExperiment): unknown[] {
  const hero = CASES.hero.input
  if (e.vectors.length !== hero.vectors.length || e.order.join('|') !== hero.order.join('|')) return []
  const want = hero.signs
  const changes = e.vectors.flatMap((v, i) => (e.signs[i] !== want[hero.vectors.findIndex((h) => h.id === v.id)] ? [{ id: v.id, sign: want[hero.vectors.findIndex((h) => h.id === v.id)]! }] : []))
  return changes.length ? [{ kind: 'set_walk_signs', experimentId: e.id, signs: changes }] : []
}

/** Select a reordered endpoint W_k (a prefix length 0..N). */
export function endpointActions(e: VectorWalkExperiment, k: number, stage: WalkStage | null = null): unknown[] {
  return [{ kind: 'select_item', experimentId: e.id, item: `walk:reordered:${k}` }, ...(stage ? [{ kind: 'show_walk_stage', experimentId: e.id, stage }] : [])]
}

/** The selected reordered endpoint k, if the selection is one. */
export function selectedEndpoint(doc: Doc, e: VectorWalkExperiment): number | null {
  if (doc.selection.experimentId !== e.id) return null
  try {
    const it = parseWalkItem(doc.selection.item, e)
    return it && it.kind === 'reordered' ? it.index : null
  } catch {
    return null
  }
}

/** The representative endpoint of a branch for this walk (hero: k = 3 positive, k = 9 negative), or null. */
export function branchEndpoint(e: VectorWalkExperiment, branch: 'positive' | 'negative'): number | null {
  return representativeEndpoints(deriveWalk(walkInputOf(e)))[branch]
}
