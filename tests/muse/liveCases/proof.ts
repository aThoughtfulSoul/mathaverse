// Live cases for the proof lesson (PROOF-EXPLORER-SPEC section 6, "Muse's role and supported conversation",
// and the proof-lesson suggestions in src/ui/assistant/suggestions.ts). Every suggestion runs on a document where
// the UI offers it (the closed hero with nothing, W₉, W₃ or arrow v4 selected; the open counterexample), and the
// section 6 typed requests run on the hero. Assertions check the meaning of an answer from the exact walk
// derivation of the committed document (src/algebra/walk.ts), so a live model may reach it with different valid
// actions (an extra select, another lesson step, the same walk set another way). The lesson step
// (show_walk_stage) is presentation state: it is asserted only where it is the answer, or where moving to an
// unrelated step would leave the question unanswered. Where the actions cannot carry the meaning (a clarifying
// question, a "no", a vacuous success), negation-aware text guards FLAG the explanation for a person to read
// (LiveCase.flags) instead of failing the case: an independent recheck showed pattern matching cannot judge prose
// reliably in either direction.

import { expect } from 'vitest'
import { type Doc, type VectorWalkExperiment, demoDocument, findRecipe, walkInputOf } from '../../../src/workspace/document'
import { type Plan, Workspace } from '../../../src/workspace/reducer'
import { deriveWalk } from '../../../src/algebra/walk'
import type { WalkStage } from '../../../src/domains/inputs'
import { LESSON_ID, caseOf, hasHeroVectors } from '../../../src/lessons/steinitz/cases'
import { allPositiveActions, caseActions, endpointActions, lessonExperiment, proofActions, selectedEndpoint } from '../../../src/demo/proof'
import { displayedWalk, selectedWalkItem } from '../../../server/muse/walk'
import { type LiveCase, type LiveResult, noMathChange } from '../liveKit'

// ------------------------------------------------------------------ documents (committed as the client does)

const commit = (doc: Doc, actions: unknown[]): Doc => new Workspace(doc).commit({ baseRevision: doc.revision, actions }).doc
const walkOf = (doc: Doc): VectorWalkExperiment => lessonExperiment(doc)!
const stageAction = (doc: Doc, stage: WalkStage) => ({ kind: 'show_walk_stage', experimentId: walkOf(doc).id, stage })

/** The demo document with the proof lesson opened: the prepared closed hero walk, displayed, nothing selected. */
export function heroDoc(): Doc {
  const pq = demoDocument()
  return commit(pq, proofActions(pq))
}
/** The hero with one walk item selected (walk:reordered:<k>, walk:vector:<id>, ...). */
export const heroWith = (item: string) => (): Doc => {
  const hero = heroDoc()
  return commit(hero, [{ kind: 'select_item', experimentId: walkOf(hero).id, item }])
}
/** The prepared open two-arrow counterexample in the lesson (the walk does not return home), nothing selected. */
export function openDoc(): Doc {
  const hero = heroDoc()
  return commit(hero, caseActions(walkOf(hero), 'open-two'))
}

// ------------------------------------------------------------------ meaning helpers

/** The displayed vector walk after the answer (fails when the displayed experiment is not a walk). */
function shownWalk(doc: Doc): VectorWalkExperiment {
  const e = displayedWalk(doc)
  expect(e, `the displayed experiment ${doc.selection.experimentId} is not a vector walk`).not.toBeNull()
  return e!
}
const factsOf = (e: VectorWalkExperiment) => deriveWalk(walkInputOf(e))
/** The lesson step the answer leaves on screen: its last show_walk_stage effect, else null (unchanged). */
const finalStage = (plan: Plan): WalkStage | null => plan.effects.flatMap((e) => (e.kind === 'show_walk_stage' ? [e.stage] : [])).at(-1) ?? null
const checks = (plan: Plan) => plan.effects.flatMap((e) => (e.kind === 'request_check' ? [e.claim] : []))
/** The walk the request was made on is still the displayed one, unchanged (the selection may differ). */
const sameWalkShown = ({ before, after }: LiveResult) => {
  const b = shownWalk(before)
  const a = shownWalk(after)
  expect(a.id, 'another experiment is displayed').toBe(b.id)
  expect(walkInputOf(a), 'the displayed walk changed').toEqual(walkInputOf(b))
}
/** Nothing outside the lesson walk `walkId` changed: the maps, sample sets and groups, every recipe and every
 *  experiment the document had before (an answer may still add an experiment or a recipe, such as a new walk). */
function othersUnchanged({ before, after }: LiveResult, walkId: string): void {
  expect(after.maps, 'a map changed').toEqual(before.maps)
  expect(after.sampleSets, 'a sample set changed').toEqual(before.sampleSets)
  expect(after.groups, 'a group changed').toEqual(before.groups)
  for (const x of before.recipes) expect(after.recipes.find((y) => y.id === x.id), `recipe ${x.id} changed`).toEqual(x)
  for (const x of before.experiments) if (x.id !== walkId) expect(after.experiments.find((y) => y.id === x.id), `${x.id} changed`).toEqual(x)
}
const explains = ({ j }: LiveResult) => expect(j.proposal.explanation.trim().length, 'empty explanation').toBeGreaterThan(0)

// ------------------------------------------------------------------ explanation guards (negation-aware)

/** A clarifying question about the point: "Which point do you mean?", "What point…?", or a request to select one
 *  ("Select a point of the new walk and ask again"; not "there is no need to select"). A trailing "Anything
 *  else?" or a rhetorical "Why is it inside?" is not one. */
const ASKS_WHICH = /\b(?:which|what (?:point|endpoint|one)|you mean|specify)\b/i
const SELECT_REQUEST = /(?:^|[.!?;:]\s*|\b(?:please|then|and|so)\s+)(?:select|pick|choose|tap|click)\b/i
const asksWhichPoint = (t: string) => (/\?/.test(t) && ASKS_WHICH.test(t)) || SELECT_REQUEST.test(t)

/** A negation in a clause ("no", "not", "n't", "far from", "partly"). */
const NEGATION = /(?:\b(?:no|not|nope|nah|never|neither|nor|far from|partly|partially)\b|n['’]t\b)/i
/** An affirmative verdict: "yes", "absolutely", a bare "it does", "proves the whole …". */
const AFFIRM = /\b(?:yes|yeah|yep|yup|absolutely|certainly|definitely|of course)\b|\b(?:it|this|that|the lesson) (?:does|do)\b(?=\s*(?:[,—–-]|$)|\s+(?:prove|so\b|indeed|cover))|\b(?:prove[sd]?|is|gives|establishes|covers|amounts to) (?:the |a )?(?:whole|entire|full|complete)\b/i
const clauses = (t: string) => t.trim().split(/[.!?;:—–]|\s-\s/).map((s) => s.trim()).filter(Boolean)
/** The clause that carries the verdict: the first, or the next one after a short label ("Short answer: no"). */
function verdictClause(t: string): string {
  const [c0 = '', c1] = clauses(t)
  return !AFFIRM.test(c0) && !NEGATION.test(c0) && c0.split(/\s+/).length <= 3 && c1 ? c1 : c0
}
/** The answer opens with an unnegated yes ("In short, yes", "Essentially yes: …", "It does.", "This proves the
 *  whole theorem"); "It does not", "Not by itself: it does prove one lemma", "Yes and no" are not. */
const saysYes = (t: string) => { const c = verdictClause(t); return AFFIRM.test(c) && !NEGATION.test(c) }
/** The answer limits the claim somewhere: no / not / only / one lemma / a separate result / elsewhere / … */
const LIMITS = /(?:\b(?:no|not|nope|nah|never|only|just|merely|single|part|partly|partial(?:ly)?|portion|piece|ingredient|component|separate(?:ly)?|elsewhere|outside|beyond|far from|alone|by itself|(?:a|one) (?:\w+ )?(?:lemma|step|part))\b|n['’]t\b)/i

/** Negated, conditional or hypothetical sentence: such a sentence reports no success ("would succeed
 *  vacuously", "applies only when", "cannot be checked"). */
const HEDGED = /(?:\b(?:no|not|never|nothing|none|neither|nor|cannot|without|unless|if|when|whenever|once|only|would|could|might|vacuous(?:ly)?|instead)\b|n['’]t\b)/i
const SUCCESS = [
  /\b(?:checked|verified|certified|confirmed)\b[\s:,—–-]+(?:(?:this|the|that|your|our) )?(?:example|walk|instance|case|claim|reordering|lemma|bound)\b/i,
  /\b(?:example|walk|instance|claim|reordering)\b[^.!?;]*?\b(?:checks out|(?:is|was|has been|have been) (?:now )?(?:lean[- ])?(?:checked|verified|certified|confirmed|proven|proved)|passe[sd] (?:the |a |its )?(?:lean )?(?:check|test)|succeed(?:ed|s))\b/i,
  /\b(?:lemma|theorem) (?:still |also )?(?:applies|holds)\b/i,
  /\b(?:lean|the checker|the check)\b[^.!?;]*?\b(?:confirm(?:s|ed)|succeed(?:s|ed)|passe[sd]|accept(?:s|ed)|verif(?:ies|ied)|certif(?:ies|ied))\b/i,
]
/** The first sentence that reports a success the open walk cannot have ("Checked: this example holds", "the
 *  lemma applies", "Lean confirmed it"), unless it is negated or hypothetical; null when there is none. */
const vacuousSuccess = (t: string): string | null => t.split(/[.!?;\n]+(?:\s|$)/).find((s) => SUCCESS.some((re) => re.test(s)) && !HEDGED.test(s)) ?? null

// ------------------------------------------------------------------ shared checks

/** "Show the other half of the argument" (nothing or a + endpoint selected): a negative-branch endpoint W_k. */
function otherHalfCheck(r: LiveResult): void {
  noMathChange(r)
  sameWalkShown(r)
  const e = shownWalk(r.after)
  const k = selectedEndpoint(r.after, e)
  expect(k, `no reordered endpoint W_k is selected (selection ${r.after.selection.item})`).not.toBeNull()
  expect(factsOf(e).witnesses[k!]!.branch, `W_${k} is on the positive branch, not the other half`).toBe('negative')
}

/** A presentation request answered by one lesson step: no math change, the lesson stays displayed, `stage` shown. */
const stageCheck = (stage: WalkStage, label: string) => (r: LiveResult) => {
  noMathChange(r)
  sameWalkShown(r)
  expect(finalStage(r.plan), `the ${label} step is not shown`).toBe(stage)
}

// ------------------------------------------------------------------ cases

export const PROOF_CASES: LiveCase[] = [
  // ---------------------------------------------------------------- opening the lesson (demo document)
  {
    name: 'proof: "Show me a step from an AI-produced proof" opens the lesson: the closed prepared hero walk displayed with its lesson recipe and provenance; P/Q, samples and every other experiment untouched',
    prompt: 'Show me a step from an AI-produced proof',
    doc: demoDocument,
    check: (r) => {
      const e = shownWalk(r.after)
      expect(e.lesson, 'the displayed walk carries no lesson (no source provenance)').toBe(LESSON_ID)
      expect(factsOf(e).zeroSum, 'the displayed walk does not return home').toBe(true)
      expect(caseOf(walkInputOf(e)), 'the displayed walk is not the prepared hero case').toBe('hero')
      expect(e.binding, 'the walk is not bound to the lesson recipe').not.toBeNull()
      expect(findRecipe(r.after, e.binding!.recipeId).operations.map((o) => o.kind)).toEqual(expect.arrayContaining(['walk_reordering', 'walk_bounds', 'prefix_correspondence']))
      othersUnchanged(r, e.id)
    },
  },

  // ---------------------------------------------------------------- section 6 typed requests on the hero
  {
    name: 'proof: "Why does returning home not keep it close?" on the hero selects a source point U_j or shows the Walk step; no math change',
    prompt: 'Why does returning home not keep it close?',
    doc: heroDoc,
    check: (r) => {
      noMathChange(r)
      sameWalkShown(r)
      const e = shownWalk(r.after)
      const source = selectedWalkItem(r.after, e)?.kind === 'source'
      expect(source || finalStage(r.plan) === 'walk', `neither a source point U_j is selected (selection ${r.after.selection.item}) nor the Walk step shown`).toBe(true)
    },
    // Answering a different question: the open counterexample ("Why must the arrows return home?") on the Walk step.
    wrong: (doc) => caseActions(walkOf(doc), 'open-two', 'walk'),
  },
  {
    name: 'proof: "Show the sign trick" on the hero shows the Signs step of the displayed lesson; no math change',
    prompt: 'Show the sign trick',
    doc: heroDoc,
    check: stageCheck('signs', 'Signs'),
    // Changing the signs instead of showing them.
    wrong: (doc) => [...allPositiveActions(walkOf(doc)), stageAction(doc, 'signs')],
  },
  {
    name: 'proof: "Rearrange the same arrows" on the hero shows the Reorder step of the displayed lesson; no math change (the source order stays)',
    prompt: 'Rearrange the same arrows',
    doc: heroDoc,
    check: stageCheck('reorder', 'Reorder'),
    // Storing the new order as the walk's source order: the reordering shown is then of a different walk.
    wrong: (doc) => [{ kind: 'set_walk_order', experimentId: walkOf(doc).id, order: [...factsOf(walkOf(doc)).reorderedIds] }, stageAction(doc, 'reorder')],
  },
  {
    name: 'proof: "Make all signs positive" on the hero sets every sign to +; the same walk with the same arrows and order; nothing else changes',
    prompt: 'Make all signs positive',
    doc: heroDoc,
    check: (r) => {
      const b = shownWalk(r.before)
      const a = shownWalk(r.after)
      expect(a.id, 'another experiment is displayed').toBe(b.id)
      expect(a.vectors, 'the arrows changed').toEqual(b.vectors)
      expect(a.order, 'the source order changed').toEqual(b.order)
      expect(a.signs, 'not every sign is +').toEqual(b.signs.map(() => 1))
      expect(a.lesson, 'the lesson provenance changed').toBe(b.lesson)
      expect(a.binding, 'the recipe binding changed').toEqual(b.binding)
      othersUnchanged(r, b.id)
    },
  },

  // ---------------------------------------------------------------- suggestions on the closed hero
  {
    name: 'proof: "Why is this point inside the bound?" with nothing selected selects a reordered endpoint W_k on the Why step (or keeps the selection and asks which point); no math change',
    prompt: 'Why is this point inside the bound?',
    doc: heroDoc,
    check: (r) => {
      noMathChange(r)
      sameWalkShown(r)
      const e = shownWalk(r.after)
      const k = selectedEndpoint(r.after, e)
      // The spec and the model instructions also allow a clarifying question: the selection is left as it was
      // (presentation steps are harmless) and the answer asks which point, never silently explains another one.
      if (k === null && r.after.selection.item === r.before.selection.item) return
      expect(k, `no reordered endpoint W_k is selected (selection ${r.after.selection.item}); never another kind of point`).not.toBeNull()
      expect([null, 'why'], 'the answer moved to a lesson step that does not explain the point').toContain(finalStage(r.plan))
    },
    // With the selection left as it was, the answer should ask which point, never silently explain another one.
    flags: (r) => (selectedEndpoint(r.after, shownWalk(r.after)) === null && !asksWhichPoint(r.j.proposal.explanation) ? ['nothing is selected and the answer may not ask which point'] : []),
    // Silently substituting an unrelated point: the source point U_5 on the Why step.
    wrong: (doc) => [{ kind: 'select_item', experimentId: walkOf(doc).id, item: 'walk:source:5' }, stageAction(doc, 'why')],
  },
  {
    name: 'proof: "Why is this point inside the bound?" with W₉ selected explains W₉: the selection stays W₉ and the step stays or becomes Why; no math change',
    prompt: 'Why is this point inside the bound?',
    doc: heroWith('walk:reordered:9'),
    check: (r) => {
      noMathChange(r)
      sameWalkShown(r)
      expect(r.after.selection.item, 'the answer moved off W₉').toBe('walk:reordered:9')
      expect([null, 'why'], 'the answer moved to another lesson step instead of explaining W₉').toContain(finalStage(r.plan))
      explains(r)
    },
    // Substituting the prepared positive example W₃ for the selected W₉.
    wrong: (doc) => endpointActions(walkOf(doc), 3, 'why'),
  },
  {
    name: 'proof: "Show the other half of the argument" with nothing selected selects a negative-branch endpoint W_k; no math change',
    prompt: 'Show the other half of the argument',
    doc: heroDoc,
    check: otherHalfCheck,
  },
  {
    name: 'proof: "Show the other half of the argument" with W₃ (+ branch) selected selects a negative-branch endpoint W_k; no math change',
    prompt: 'Show the other half of the argument',
    doc: heroWith('walk:reordered:3'),
    check: otherHalfCheck,
  },
  {
    name: 'proof: "Why must the arrows return home?" displays a walk that does not return home, where the new bound fails at some W_k; nothing else changes; Undo restores the hero',
    prompt: 'Why must the arrows return home?',
    doc: heroDoc,
    check: (r) => {
      const f = factsOf(shownWalk(r.after))
      expect(f.zeroSum, 'the displayed walk still returns home').toBe(false)
      expect(f.firstFailure, 'every W_k is within the proposed bound, so the walk shows no failure').not.toBeNull()
      othersUnchanged(r, shownWalk(r.before).id)
    },
  },
  {
    name: 'proof: "Flip this sign" with arrow v4 (c₁) selected changes exactly v4\'s sign; arrows, order, every other sign and everything outside the walk unchanged',
    prompt: 'Flip this sign',
    doc: heroWith('walk:vector:v4'),
    check: (r) => {
      const b = shownWalk(r.before)
      const a = shownWalk(r.after)
      expect(a.id, 'another experiment is displayed').toBe(b.id)
      expect(a.vectors, 'the arrows changed').toEqual(b.vectors)
      expect(a.order, 'the source order changed').toEqual(b.order)
      const flipped = b.vectors.flatMap((v, i) => (a.signs[i] !== b.signs[i] ? [v.id] : []))
      expect(flipped, 'the signs that changed').toEqual(['v4'])
      othersUnchanged(r, b.id)
    },
  },
  {
    name: 'proof: "Check this example" on the closed hero with W₉ selected requests one walk_reorder_instance check of the displayed walk; no math change',
    prompt: 'Check this example',
    doc: heroWith('walk:reordered:9'),
    check: (r) => {
      noMathChange(r)
      sameWalkShown(r)
      expect(checks(r.plan), 'requested checks').toEqual([{ kind: 'walk_reorder_instance', experimentId: shownWalk(r.before).id }])
    },
  },

  // ---------------------------------------------------------------- the open counterexample
  {
    name: 'proof: "Why does the bound fail here?" on the open counterexample keeps the open walk; any W_k left selected is outside the proposed bound, on the Why or Assumptions step; no math change',
    prompt: 'Why does the bound fail here?',
    doc: openDoc,
    check: (r) => {
      noMathChange(r)
      sameWalkShown(r)
      const e = shownWalk(r.after)
      const k = selectedEndpoint(r.after, e)
      if (k !== null) expect(factsOf(e).witnesses[k]!.withinBound, `W_${k} is inside the proposed bound, so it does not show the failure`).toBe(false)
      // The Why step shows the identity with its leftover total T; the Assumptions step the missing hypothesis.
      expect([null, 'why', 'assumptions'], 'the answer moved to a lesson step that does not explain the failure').toContain(finalStage(r.plan))
    },
    // With no point and no step shown, the meaning is all in the text: it should name the missing return home.
    flags: (r) => (selectedEndpoint(r.after, shownWalk(r.after)) === null && finalStage(r.plan) === null && !/home|start|total|residual|leftover|assum|hypothes/i.test(r.j.proposal.explanation) ? ['the answer may not name the missing return home'] : []),
    // W₁ is inside the proposed bound 3/2 (|W₁| = 1), so it explains nothing about the failure at W₂.
    wrong: (doc) => endpointActions(walkOf(doc), 1, 'why'),
  },
  {
    name: 'proof: "Restore the closed walk" on the open counterexample displays the prepared closed hero again in the same lesson experiment (lesson and recipe binding kept); nothing else changes',
    prompt: 'Restore the closed walk',
    doc: openDoc,
    check: (r) => {
      const b = shownWalk(r.before)
      const a = shownWalk(r.after)
      expect(a.id, 'another experiment is displayed').toBe(b.id)
      expect(factsOf(a).zeroSum, 'the displayed walk still does not return home').toBe(true)
      expect(hasHeroVectors(walkInputOf(a)), 'the displayed walk does not have the hero arrows in their order').toBe(true)
      expect(caseOf(walkInputOf(a)), 'the hero arrows are back but not with the prepared signs').toBe('hero')
      expect(a.lesson, 'the lesson provenance changed').toBe(b.lesson)
      expect(a.binding, 'the recipe binding changed').toEqual(b.binding)
      othersUnchanged(r, b.id)
    },
  },
  {
    name: 'proof: "Does this prove the whole theorem?" on the open counterexample answers no (no unnegated yes; says what it does not cover) without changing the mathematics or requesting a check',
    prompt: 'Does this prove the whole theorem?',
    doc: openDoc,
    check: (r) => {
      noMathChange(r)
      sameWalkShown(r)
      expect(checks(r.plan), 'an answer-only question requested a check').toEqual([])
      explains(r)
    },
    flags: ({ j }) => [
      ...(saysYes(j.proposal.explanation) ? ['the answer may say yes'] : []),
      ...(LIMITS.test(j.proposal.explanation) ? [] : ['the answer may not say what the lesson does not prove']),
    ],
    wrong: (doc) => allPositiveActions(walkOf(doc)),
  },
  {
    name: 'proof: "Check this example" on the open counterexample requests no check (it would be vacuous), reports no success in words and keeps the open walk; no math change',
    prompt: 'Check this example',
    doc: openDoc,
    check: (r) => {
      expect(checks(r.plan), 'a check of a walk that does not return home would succeed vacuously').toEqual([])
      noMathChange(r)
      sameWalkShown(r)
      expect(factsOf(shownWalk(r.after)).zeroSum).toBe(false)
      explains(r)
    },
    flags: ({ j }) => {
      const s = vacuousSuccess(j.proposal.explanation)
      return s ? [`the answer may report a success the open walk cannot have: "${s}"`] : []
    },
    // Swapping in the closed hero and checking that instead: a different example (a request_check on the open
    // walk itself is refused by the planner, so it cannot even be proposed).
    wrong: (doc) => [...caseActions(walkOf(doc), 'hero'), { kind: 'request_check', claim: { kind: 'walk_reorder_instance', experimentId: walkOf(doc).id } }],
  },
]
