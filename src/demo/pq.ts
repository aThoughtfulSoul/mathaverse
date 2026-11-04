// Prepared demonstration data for the P-to-Q session (SPEC S10, WORKSPACE W2): the second map and the
// actions that bind the displayed experiment's recipe to it. These are ordinary W4 actions planned by the
// same reducer as every other edit; there is no separate rendering path for Q (A3).

import type { Doc } from '../workspace/document'
import { activeExperiment, findMap, findBranch, isLinearDisplayed, linearExperiments } from '../workspace/document'
import { demoOf } from './order'

/** Q = diag(0, 1, 1) (MATHEMATICAL-CONTRACT M6), as preset metadata the planner turns into a matrix. */
export const Q_DEFINITION = { preset: { kind: 'projection', keep: [false, true, true] } } as const

/** The experiment the rebind control switches to next, and the button text for it. */
export function rebindTarget(doc: Doc): { label: string; actions: unknown[] } {
  if (!isLinearDisplayed(doc)) return { label: 'Use on Q', actions: [] }
  const shown = activeExperiment(doc)
  // The comparison has its own controls (reverse a route); rebinding applies to the P-to-Q recipe only.
  if (demoOf(doc, shown) === 'order') return { label: 'Use on Q', actions: [] }
  const recipeId = shown.binding?.recipeId ?? null
  // Only the other P-to-Q experiment (same samples, linked views): never the operation-order comparison.
  const other = linearExperiments(doc).find((e) => e.id !== shown.id && e.sampleSetId === shown.sampleSetId && demoOf(doc, e) === 'pq')
  const sel = doc.selection.sampleId
  if (other) {
    const sym = other.branches[0] ? findBranch(other, other.branches[0].id).mapIds.map((id) => findMap(doc, id).label).reverse().join('') : '?'
    const keepSel = sel !== null && other.sampleSetId === shown.sampleSetId ? sel : null
    // Showing the other experiment keeps the selected sample ID, so the learner sees what happens to the
    // same pair under the other map before choosing a new one (W2). When the shown experiment's representation
    // is not the other's yet (e.g. one saved since), the control reuses it there: the same recipe, rebound.
    if (recipeId && other.binding?.recipeId !== recipeId) {
      return { label: `Use on ${sym}`, actions: [{ kind: 'bind_recipe', experimentId: other.id, recipeId, bindings: bindingsFor(doc, recipeId, other.sampleSetId, other.branches[0]!.id, keepSel) }] }
    }
    return { label: `Show ${sym}`, actions: [{ kind: 'select', experimentId: other.id, sampleId: keepSel }] }
  }
  if (!recipeId) return { label: 'Use on Q', actions: [] }
  return {
    label: 'Use on Q',
    actions: [
      { kind: 'create_map', name: 'q', label: 'Q', dimension: shown.dimension, definition: Q_DEFINITION },
      { kind: 'create_experiment', name: 'q', sampleSetId: shown.sampleSetId, branches: [{ id: 'main', mapIds: ['$q'] }] },
      { kind: 'bind_recipe', experimentId: '$q', recipeId, bindings: bindingsFor(doc, recipeId, shown.sampleSetId, 'main', sel) },
    ],
  }
}

/** Port bindings for a recipe: sample_set -> the set, linear_branch -> the branch, sample_id -> selection. */
export function bindingsFor(doc: Doc, recipeId: string, sampleSetId: string, branchId: string, selection: string | null): Record<string, string | null> {
  const r = doc.recipes.find((x) => x.id === recipeId)
  const out: Record<string, string | null> = {}
  if (!r) return out
  for (const [port, spec] of Object.entries(r.inputs)) out[port] = spec.type === 'sample_set' ? sampleSetId : spec.type === 'linear_branch' ? branchId : selection
  return out
}
