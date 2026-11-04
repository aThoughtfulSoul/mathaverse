// The proof lesson for Ask Meta Muse AI (PROOF-EXPLORER-SPEC section 6): curated lesson context and
// server-computed, validated action templates for a displayed vector walk. The lesson context is built from
// the application's own lesson modules (src/lessons/steinitz/source.ts and copy.ts), never from upstream
// repository text, and it is small: Muse gets the declaration, its assumptions, coverage and honest origin,
// not the whole source. The templates follow four.ts: every one is planned with planTransaction on the
// request's document before it is offered, and one that does not apply is given as {unavailable: reason}.
// The prepared signs, cases and endpoints are application data; nothing here searches for a "good" signing.
// The synthetic fixtures (walkSynthetic.ts) use the same templates, so a fixture and a live proposal take one
// validated path.

import type { ActionJson } from '../../src/workspace/actions'
import { type Doc, type VectorWalkExperiment, findAnyExperiment, walkInputOf } from '../../src/workspace/document'
import { type WalkFacts, type WalkItem, deriveWalk, parseWalkItem, representativeEndpoints } from '../../src/algebra/walk'
import { type CaseId, CASES, caseJson, caseOf } from '../../src/lessons/steinitz/cases'
import { LESSON_SOURCE, EVIDENCE_LEVELS } from '../../src/lessons/steinitz/source'
import { BOUND_NOTE, COUNTEREXAMPLE_COPY, LESSON_QUESTION, LESSON_SUBTITLE, NO_IMPROVEMENT_COPY, STAGE_COPY, WHY_BRANCH } from '../../src/lessons/steinitz/copy'
import { allPositiveActions, caseActions, flipSignActions, lessonExperiment, preparedSignsActions, proofActions } from '../../src/demo/proof'
import type { WalkStage } from '../../src/domains/inputs'
import { type Prepared, prepared } from './order'

const unavailable = (why: string): Prepared => ({ unavailable: why })
const NOT_SHOWN = 'the proof lesson is not displayed; open it first (openLesson)'

/** The displayed vector-walk experiment, else null. */
export function displayedWalk(doc: Doc): VectorWalkExperiment | null {
  const e = findAnyExperiment(doc, doc.selection.experimentId)
  return e.domain === 'vector_walk' ? e : null
}

/** The selected item of the displayed walk (null when nothing valid is selected). */
export function selectedWalkItem(doc: Doc, e: VectorWalkExperiment): WalkItem | null {
  if (doc.selection.experimentId !== e.id) return null
  try {
    return parseWalkItem(doc.selection.item, e)
  } catch {
    return null
  }
}

export const walkFactsOf = (e: VectorWalkExperiment): WalkFacts => deriveWalk(walkInputOf(e))

/**
 * Where a lesson template acts: the displayed walk (no prefix), else the lesson opened first (proofActions:
 * a select of the existing lesson experiment, or the prepared hero created and bound as `$walk`). `e` is the
 * experiment the template will act on, or null when it is created in the same transaction (then `facts` are
 * the prepared hero's).
 */
export function lessonTarget(doc: Doc): { prefix: unknown[]; ref: string; e: VectorWalkExperiment | null; facts: WalkFacts } {
  const shown = displayedWalk(doc)
  if (shown) return { prefix: [], ref: shown.id, e: shown, facts: walkFactsOf(shown) }
  const existing = lessonExperiment(doc)
  if (existing) return { prefix: proofActions(doc), ref: existing.id, e: existing, facts: walkFactsOf(existing) }
  return { prefix: proofActions(doc), ref: '$walk', e: null, facts: deriveWalk(CASES.hero.input) }
}

const stage = (ref: string, s: WalkStage) => ({ kind: 'show_walk_stage', experimentId: ref, stage: s })
const selectItem = (ref: string, item: string | null) => ({ kind: 'select_item', experimentId: ref, item })
const setCase = (ref: string, id: CaseId) => ({ kind: 'set_vector_walk', experimentId: ref, ...caseJson(id) })

// ------------------------------------------------------------------ templates

/** "Show me a step from an AI-produced proof": open the lesson on its first step. */
export function openLessonTemplate(doc: Doc): Prepared {
  const t = lessonTarget(doc)
  return prepared(doc, [...t.prefix, stage(t.ref, 'walk')])
}

/** "Why does returning home not keep it close?": the source walk with its farthest point selected. */
export function sourceWalkTemplate(doc: Doc): Prepared {
  const t = lessonTarget(doc)
  return prepared(doc, [...t.prefix, selectItem(t.ref, `walk:source:${t.facts.sourcePeakAt}`), stage(t.ref, 'walk')])
}

/** A lesson step (presentation only), opening the lesson first when needed. */
export function stageTemplate(doc: Doc, s: WalkStage): Prepared {
  const t = lessonTarget(doc)
  return prepared(doc, [...t.prefix, stage(t.ref, s)])
}

/** "Why is this point inside the bound?" on the persisted selection walk:reordered:<k> (never a guess). */
export function whyThisPointTemplate(doc: Doc): Prepared {
  const e = displayedWalk(doc)
  if (!e) return unavailable(NOT_SHOWN)
  const it = selectedWalkItem(doc, e)
  if (!it || it.kind !== 'reordered') return unavailable('no reordered endpoint W_k is selected; use whyRepresentative (and say it selects the prepared endpoint) or ask which point')
  return prepared(doc, [stage(e.id, 'why')])
}

/** The representative endpoint of a branch (hero: k = 3 positive, k = 9 negative), selected, on the Why step. */
export function endpointTemplate(doc: Doc, branch: 'positive' | 'negative'): Prepared {
  const t = lessonTarget(doc)
  const k = representativeEndpoints(t.facts)[branch]
  if (k === null) return unavailable(`the walk has no ${branch === 'positive' ? '+' : '−'} arrows, so there is no ${branch} branch`)
  return prepared(doc, [...t.prefix, selectItem(t.ref, `walk:reordered:${k}`), stage(t.ref, 'why')])
}

/** "Why is this point inside the bound?" with nothing selected: the prepared positive endpoint (negative when
 * the walk has no + arrows). */
export function whyRepresentativeTemplate(doc: Doc): Prepared {
  const t = lessonTarget(doc)
  return endpointTemplate(doc, representativeEndpoints(t.facts).positive !== null ? 'positive' : 'negative')
}

/** "Show the other half of the argument": the representative endpoint of the branch NOT selected now (the
 * negative branch unless a negative endpoint is selected). */
export function otherHalfTemplate(doc: Doc): Prepared {
  const e = displayedWalk(doc)
  const it = e ? selectedWalkItem(doc, e) : null
  const current = e && it?.kind === 'reordered' ? walkFactsOf(e).witnesses[it.index]!.branch : null
  return endpointTemplate(doc, current === 'negative' ? 'positive' : 'negative')
}

/** "Flip this sign": the selected arrow walk:vector:<id>, or a named occurrence. */
export function flipSignTemplate(doc: Doc, named: string | null = null): Prepared {
  const e = displayedWalk(doc)
  if (!e) return unavailable(NOT_SHOWN)
  const it = selectedWalkItem(doc, e)
  const id = named ?? (it?.kind === 'vector' ? it.id : null)
  if (!id) return unavailable('no arrow is selected, so "this sign" names nothing; ask which arrow (select one, walk:vector:<id>)')
  if (!e.vectors.some((v) => v.id === id)) return unavailable(`the walk has no arrow ${id}`)
  return prepared(doc, flipSignActions(e, id))
}

/** "Make all signs positive" (the all-positive variation on the current arrows). */
export function allPositiveTemplate(doc: Doc): Prepared {
  const e = displayedWalk(doc)
  if (!e) return unavailable(NOT_SHOWN)
  const actions = allPositiveActions(e)
  return actions.length ? prepared(doc, [...actions, stage(e.id, 'reorder')]) : unavailable('every sign is already +')
}

/** "Restore the prepared signs" (hero arrows in the hero order only). */
export function preparedSignsTemplate(doc: Doc): Prepared {
  const e = displayedWalk(doc)
  if (!e) return unavailable(NOT_SHOWN)
  const actions = preparedSignsActions(e)
  if (actions.length) return prepared(doc, [...actions, stage(e.id, 'reorder')])
  return unavailable(caseOf(walkInputOf(e)) === 'hero' ? 'the prepared signs are already in place' : 'the walk does not have the prepared arrows in their prepared order, so there are no prepared signs to restore')
}

/** "Why must the arrows return home?": the prepared two-arrow counterexample on the Assumptions step (one
 * undoable set_vector_walk; Undo restores the previous walk). */
export function counterexampleTemplate(doc: Doc): Prepared {
  const t = lessonTarget(doc)
  if (t.e && caseOf(walkInputOf(t.e)) === 'open-two') return prepared(doc, [...t.prefix, stage(t.ref, 'assumptions')])
  return prepared(doc, [...t.prefix, setCase(t.ref, 'open-two'), stage(t.ref, 'assumptions')])
}

/** "Restore the closed walk": the prepared hero again (only when the displayed walk does not return home). */
export function restoreClosedTemplate(doc: Doc): Prepared {
  const e = displayedWalk(doc)
  if (!e) return unavailable(NOT_SHOWN)
  if (walkFactsOf(e).zeroSum) return unavailable('the walk already returns to its start')
  return prepared(doc, caseActions(e, 'hero', 'reorder'))
}

/** "Why does the bound fail here?": select the first reordered point outside the proposed bound, Why step. */
export function explainFailureTemplate(doc: Doc): Prepared {
  const e = displayedWalk(doc)
  if (!e) return unavailable(NOT_SHOWN)
  const f = walkFactsOf(e)
  if (f.firstFailure === null) return unavailable(f.zeroSum ? 'the bound does not fail: the walk returns to its start and every reordered point is within the new bound' : 'every reordered point happens to lie within the proposed bound here')
  return prepared(doc, [selectItem(e.id, `walk:reordered:${f.firstFailure}`), stage(e.id, 'why')])
}

/** "Check this example": the finite walk_reorder_instance claim, only when the walk returns to its start. */
export function checkTemplate(doc: Doc): Prepared {
  const e = displayedWalk(doc)
  if (!e) return unavailable(NOT_SHOWN)
  if (!walkFactsOf(e).zeroSum) return unavailable('the walk does not return to its start, so the lemma does not apply and there is no finite reorder certificate to check; explain the missing hypothesis and the exact failure instead')
  return prepared(doc, [{ kind: 'request_check', claim: { kind: 'walk_reorder_instance', experimentId: e.id } }])
}

/** "Show the simpler example": the collinear six-step teaching case. */
export function simplerExampleTemplate(doc: Doc): Prepared {
  const t = lessonTarget(doc)
  if (t.e && caseOf(walkInputOf(t.e)) === 'line-six') return unavailable('the simpler example is already displayed')
  return prepared(doc, [...t.prefix, setCase(t.ref, 'line-six'), stage(t.ref, 'reorder')])
}

/** Every lesson template on this document (each planned on it, or {unavailable}). When the lesson is not
 * displayed only the two opening templates are offered (the others act on the displayed walk). */
export function walkTemplates(doc: Doc): Record<string, Prepared> {
  if (!displayedWalk(doc)) return { openLesson: openLessonTemplate(doc), counterexample: counterexampleTemplate(doc) }
  return {
    openLesson: openLessonTemplate(doc),
    showSourceWalk: sourceWalkTemplate(doc),
    showSigns: stageTemplate(doc, 'signs'),
    showReorder: stageTemplate(doc, 'reorder'),
    whyThisPoint: whyThisPointTemplate(doc),
    whyRepresentative: whyRepresentativeTemplate(doc),
    otherHalf: otherHalfTemplate(doc),
    flipSelectedSign: flipSignTemplate(doc),
    allSignsPositive: allPositiveTemplate(doc),
    restorePreparedSigns: preparedSignsTemplate(doc),
    counterexample: counterexampleTemplate(doc),
    restoreClosedWalk: restoreClosedTemplate(doc),
    explainFailure: explainFailureTemplate(doc),
    checkExample: checkTemplate(doc),
    showSimplerExample: simplerExampleTemplate(doc),
  }
}

// ------------------------------------------------------------------ curated lesson context

/** Provenance in one short object (always sent: "Show me a step from an AI-produced proof" needs it). */
export function lessonSourceSummary() {
  return {
    title: LESSON_SOURCE.title,
    author: LESSON_SOURCE.author,
    date: LESSON_SOURCE.date,
    commit: LESSON_SOURCE.commit,
    declaration: LESSON_SOURCE.declaration.name,
    declarationUrl: LESSON_SOURCE.declaration.url,
    origin: LESSON_SOURCE.origin,
    framing: 'The workspace offers a prepared interactive explanation of this one lemma. The proof and the formalization are the source authors’ work; the prepared signs and cases are application data.',
  }
}

/** The curated lesson context for a displayed walk (application lesson modules only). */
export function lessonContext() {
  return {
    ...lessonSourceSummary(),
    question: LESSON_QUESTION,
    subtitle: LESSON_SUBTITLE,
    statement: LESSON_SOURCE.declaration.role,
    paperSection: LESSON_SOURCE.paperSection,
    supporting: LESSON_SOURCE.supporting.map((d) => ({ name: d.name, role: d.role })),
    assumptions: LESSON_SOURCE.assumptions,
    coverage: LESSON_SOURCE.coverageLine,
    minimality: LESSON_SOURCE.minimality,
    notCovered: LESSON_SOURCE.notCovered,
    evidenceLevels: EVIDENCE_LEVELS,
    stages: Object.fromEntries(Object.entries(STAGE_COPY).map(([k, v]) => [k, v.lead])),
    whyBranch: WHY_BRANCH,
    boundNote: BOUND_NOTE,
    counterexample: COUNTEREXAMPLE_COPY,
    noImprovement: NO_IMPROVEMENT_COPY,
  }
}

/** The model-facing `proofLesson` block: provenance and the opening templates always; the curated lesson
 * context and every template only while a vector walk is displayed. */
export function proofLessonBlock(doc: Doc) {
  const e = displayedWalk(doc)
  if (!e) return { displayed: false, source: lessonSourceSummary(), templates: walkTemplates(doc) }
  const c = caseOf(walkInputOf(e))
  return { displayed: true, experimentId: e.id, case: c, lesson: lessonContext(), templates: walkTemplates(doc) }
}

/** Actions of a prepared template, or null when it does not apply (helpers for the synthetic fixtures). */
export const actionsOf = (t: Prepared): ActionJson[] | null => ('actions' in t ? t.actions : null)
