// Application-computed facts beside an Ask Meta Muse AI answer about a reordered walk endpoint W_k
// (LOCAL-SUBMISSION-META-STT-HANDOFF section 2, "Squared lengths"). When the answer concerns W_k (the
// committed selection after an applied answer, else the selection when the request was sent, is
// walk:reordered:<k> on a vector-walk experiment), the panel shows a compact block, labelled as computed by
// the app and not by the model:
//
//   exact      |W₉|² = 147/25 ≤ 9 = R²          (squared length against the squared bound, never against R)
//   length     |W₉| = √147/5 ≈ 2.425 ≤ 3 = R    (separately labelled approximate when it is not exact)
//   bound      R = (B + D)/2 = (5 + 1)/2 = 3
//
// Every number comes from the exact derivation (src/algebra/walk.ts deriveWalk) of the walk inputs the
// answer was scoped to, stated with the same endpointBound text as the model context and the mathematics
// panel (src/workspace/context.ts); nothing is parsed from the model's prose and nothing here judges that
// prose. When the
// walk's inputs (vectors, order, signs) or the selected endpoint have changed since, the block keeps the
// numbers of the earlier input and says so (historical); it never presents them as the current scene.
//
// Pure module: no DOM, no clients; unit-tested in node.

import { type WalkInput, type WalkFacts, deriveWalk } from '../../algebra/walk'
import { fromJson } from '../../model/rational'
import type { Dim } from '../../model/linear'
import { type AnswerScope, type AssistantState, type ScopeSnapshot, walkInputsJson } from '../../assistant/client'
import { decimalText, endpointBound } from '../../workspace/context'
import type { Doc } from '../../workspace/document'

export interface FactsRow {
  /** "Exact", "Length (approx.)" or "Length", "Bound" / "Proposed bound". */
  label: string
  text: string
}

export interface AnswerFactsView {
  /** The endpoint in display notation ("W₉"). */
  endpoint: string
  k: number
  /** "Computed by the app" (current) or "Computed by the app · historical". */
  label: string
  /** Who computed it, in one short line (never the model). */
  detail: string
  /** True when the scene still shows exactly this endpoint of exactly this input. */
  current: boolean
  /** Historical: why these numbers no longer describe the scene (null when current). */
  note: string | null
  /** |W_k|² ≤ R² (exact): whether the endpoint lies within the bound. */
  within: boolean
  rows: FactsRow[]
}

export const FACTS_LABEL = 'Computed by the app'
export const FACTS_DETAIL = 'exact arithmetic from the walk, not from Meta Muse AI'

const SUB = '₀₁₂₃₄₅₆₇₈₉'
const sub = (n: number) => String(n).split('').map((c) => SUB[Number(c)]).join('')

const REORDERED = /^walk:reordered:(0|[1-9][0-9]?)$/

/** The reordered endpoint k a selection item names, else null. */
export function reorderedEndpoint(item: string | null): number | null {
  const m = item === null ? null : REORDERED.exec(item)
  return m ? Number(m[1]) : null
}

function parseWalk(json: string): WalkInput {
  const x = JSON.parse(json) as { dimension: Dim; vectors: { id: string; coords: unknown[] }[]; order: string[]; signs: (1 | -1)[] }
  return { dimension: x.dimension, vectors: x.vectors.map((v) => ({ id: v.id, coords: v.coords.map(fromJson) })), order: x.order, signs: x.signs }
}

/** The three rows for endpoint k of derived facts f. */
export function endpointRows(f: WalkFacts, k: number): { rows: FactsRow[]; within: boolean } {
  // endpointBound decides the relation exactly (|W_k|² against R²), like the witness's withinBound.
  const b = endpointBound(f, k)
  return {
    within: b.within,
    rows: [
      { label: 'Exact', text: b.squared },
      // |W| ≤ R exactly when |W|² ≤ R² (lengths are non-negative): the relation is the exact one above.
      { label: b.lengthExact ? 'Length' : 'Length (approx.)', text: b.length },
      { label: f.lemmaApplicable ? 'Bound' : 'Proposed bound', text: `R = (B + D)/2 = (${f.B} + ${f.D})/2 = ${decimalText(f.R)}` },
    ],
  }
}

/** Why a scope no longer describes the document (null when it still does). */
function historicalNote(target: ScopeSnapshot, k: number, doc: Doc): string | null {
  const W = `W${sub(k)}`
  const e = doc.experiments.find((x) => x.id === target.experimentId)
  if (!e || e.domain !== 'vector_walk') return 'For an earlier walk that is no longer in the workspace.'
  const now = walkInputsJson(e)
  if (now !== target.walk) {
    const before = JSON.parse(target.walk!) as { dimension: unknown; vectors: unknown; order: unknown }
    const after = JSON.parse(now) as { dimension: unknown; vectors: unknown; order: unknown }
    const sameArrows = JSON.stringify([before.dimension, before.vectors, before.order]) === JSON.stringify([after.dimension, after.vectors, after.order])
    return sameArrows ? 'For the earlier signs: a sign has changed since this answer.' : 'For the earlier walk: its arrows or their order have changed since this answer.'
  }
  if (doc.selection.experimentId !== target.experimentId) return `For ${W} of a walk that is no longer displayed.`
  if (doc.selection.item !== target.item) return `For ${W}, which is no longer selected.`
  return null
}

/** The facts block for one scope snapshot against the current document, or null when it is not a walk endpoint. */
export function factsForScope(target: ScopeSnapshot, doc: Doc): AnswerFactsView | null {
  const k = reorderedEndpoint(target.item)
  if (k === null || target.walk === null) return null
  let f: WalkFacts
  try {
    f = deriveWalk(parseWalk(target.walk))
  } catch {
    return null
  }
  if (k > f.n) return null
  const { rows, within } = endpointRows(f, k)
  const note = historicalNote(target, k, doc)
  const endpoint = `W${sub(k)}`
  return {
    endpoint,
    k,
    label: note ? `${FACTS_LABEL} · historical` : FACTS_LABEL,
    detail: `${endpoint} · ${FACTS_DETAIL}`,
    current: note === null,
    note,
    within,
    rows,
  }
}

/** The endpoint an answer concerns: the committed selection of an applied answer, else the request's. */
export function answerTarget(scope: AnswerScope): ScopeSnapshot {
  return scope.committed ?? scope.request
}

/** The facts block for an assistant result (applied, answered, stale, rejected), or null. */
export function answerFacts(state: AssistantState, doc: Doc): AnswerFactsView | null {
  if (state.kind !== 'applied' && state.kind !== 'answered' && state.kind !== 'stale' && state.kind !== 'rejected') return null
  if (!state.scope) return null
  return factsForScope(answerTarget(state.scope), doc)
}
