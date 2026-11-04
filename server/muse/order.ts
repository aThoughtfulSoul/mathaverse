// Server-computed, validated action templates for the operation-order comparison (SECOND-DEMO-PARALLEL-
// HANDOFF "Shared engine and Muse contract"). The prompt offers them to the model as PREPARED templates and
// the synthetic fixtures use the same ones, so a prepared scene, a live proposal and a fixture take the same
// validated path. "Left" and "right" are resolved from the displayed comparison's binding ports, never from
// branch IDs or their order. Every template is planned on a temporary copy of the document before it is
// offered; one that does not apply is omitted with the planner's reason.

import type { ActionJson } from '../../src/workspace/actions'
import { type Doc, type Experiment, branchMatrix, branchSymbol, findAnyExperiment, findExperiment, findRecipe } from '../../src/workspace/document'
import { planTransaction } from '../../src/workspace/reducer'
import { comparisonOf } from '../../src/recipes/recipe'
import { differenceWitness, matEq } from '../../src/model/linear'
import { experimentFor, orderDemoActions, orderWords, reverseRouteActions } from '../../src/demo/order'

/** Seconds per replay step in prepared templates (the prepared scene's own value; the action allows 0.5-5). */
export const REPLAY_STEP_SECONDS = 1.6

export interface RouteInfo {
  /** The recipe port the branch is bound to (`left` or `right` in ORDER_MATTERS). */
  port: string
  branchId: string
  /** Chronological words ("R then S"). */
  order: string
  /** Resolved product, right to left ("SR"). */
  symbol: string
}

export interface ComparisonInfo {
  experimentId: string
  left: RouteInfo
  right: RouteInfo
  /** Exact matrix equality of the two resolved routes. */
  mapsEqual: boolean
  /** The first standard basis index where the routes differ (exact), or null when equal. */
  firstDifferingBasisIndex: number | null
}

/** The comparison an experiment's bound recipe lays out, with sides taken from its binding ports. */
export function comparisonInfo(doc: Doc, e: Experiment): ComparisonInfo | null {
  const cmp = e.binding ? comparisonOf(findRecipe(doc, e.binding.recipeId)) : null
  if (!cmp) return null
  const route = (port: string): RouteInfo => {
    const branchId = e.binding!.ports[port]!
    return { port, branchId, order: orderWords(doc, e, branchId), symbol: branchSymbol(doc, e, branchId) }
  }
  const left = route(cmp.left)
  const right = route(cmp.right)
  const L = branchMatrix(doc, e, left.branchId)
  const R = branchMatrix(doc, e, right.branchId)
  return { experimentId: e.id, left, right, mapsEqual: matEq(L, R), firstDifferingBasisIndex: differenceWitness(L, R) }
}

/** The comparison the views show right now, or null when the displayed experiment is not a comparison. */
export function displayedComparison(doc: Doc): ComparisonInfo | null {
  const e = findAnyExperiment(doc, doc.selection.experimentId)
  return e.domain === 'linear' ? comparisonInfo(doc, e) : null
}

export type Prepared = { actions: ActionJson[] } | { unavailable: string }

/** Offer an action list only when it plans on this document (all or nothing, nothing mutated). */
export function prepared(doc: Doc, actions: unknown[]): Prepared {
  try {
    planTransaction(doc, actions)
    return { actions: actions as ActionJson[] }
  } catch (e) {
    return { unavailable: (e as Error).message.slice(0, 200) }
  }
}

const replay = (experimentId: string): ActionJson => ({ kind: 'play_comparison', experimentId, stepDuration: REPLAY_STEP_SECONDS })
const sides = (c: ComparisonInfo) => ({ left: { experimentId: c.experimentId, branchId: c.left.branchId }, right: { experimentId: c.experimentId, branchId: c.right.branchId } })

/** Reverse one displayed route, then replay both (the same set_branch a local control commits). */
export function reverseTemplate(doc: Doc, c: ComparisonInfo, side: 'left' | 'right'): Prepared {
  const e = findExperiment(doc, c.experimentId)
  return prepared(doc, [...reverseRouteActions(e, c[side].branchId), replay(c.experimentId)])
}

/** Replay the comparison: the displayed one, else select the existing comparison first (explicitly). */
export function replayTemplate(doc: Doc): Prepared {
  const shown = displayedComparison(doc)
  if (shown) return prepared(doc, [replay(shown.experimentId)])
  const e = experimentFor(doc, 'order')
  if (!e) return { unavailable: 'the workspace has no branch comparison yet' }
  return prepared(doc, [...orderDemoActions(doc), replay(e.id)])
}

/** A difference check on the displayed comparison at the first differing basis vector (null when equal). */
export function differenceCheckTemplate(doc: Doc, c: ComparisonInfo): Prepared | null {
  if (c.firstDifferingBasisIndex === null) return null
  return prepared(doc, [{ kind: 'request_check', claim: { kind: 'map_difference_witness', ...sides(c), basisIndex: c.firstDifferingBasisIndex } }])
}

/** An equality check on the displayed comparison (null when the routes differ). */
export function equalityCheckTemplate(doc: Doc, c: ComparisonInfo): Prepared | null {
  if (!c.mapsEqual) return null
  return prepared(doc, [{ kind: 'request_check', claim: { kind: 'map_equality', ...sides(c) } }])
}

/** Everything the prompt offers as prepared templates for this document. */
export function preparedTemplates(doc: Doc) {
  const c = displayedComparison(doc)
  return {
    orderComparison: prepared(doc, orderDemoActions(doc)),
    replayComparison: replayTemplate(doc),
    displayedComparison: c && {
      ...c,
      reverseLeft: reverseTemplate(doc, c, 'left'),
      reverseRight: reverseTemplate(doc, c, 'right'),
      checkDifference: differenceCheckTemplate(doc, c),
      checkEquality: equalityCheckTemplate(doc, c),
    },
  }
}
