// Live cases for three-strand braids (UI-REFINEMENT-SPEC section 7 braid suggestions, each on a document where
// the Ask Meta Muse AI panel offers it with exactly this text). Assertions check the meaning of an answer on the
// braid experiment's words and rewrite record, so a live model may reach it with different valid actions (an
// extra select or replay, or the comparison built crossing by crossing).
//
// A rewrite only counts when it is CHECKED: the rewrite record must continue from the same origin, so the app
// itself establishes "same braid (checked by supported rewrite rules)". Setting the main word to the expected
// result restarts the record, so the app no longer knows it is the same braid; such an answer is rejected.
//
// Positions: rewrite_braid.at, select_item "crossing:<k>" and the context facts ("braid_relation at 2 -> ...")
// count crossings from 0, while the panel's prompts count from 1. So "crossings n–m" is at = n − 1: "crossings
// 3–5" is at 2 and "crossings 2–3" is at 1 (server/muse/prompt.ts states this for the model). If a live rewrite
// case fails with a span error, check this first.
//
// Explanations: no check matches exact wording, and wording never fails a case. The guards below read the
// explanation clause by clause and FLAG (LiveCase.flags, recorded for a person to read) an unhedged claim that
// equal braids differ or, where nothing is checked yet, that equality is already checked or proved by
// invariants. Pattern matching cannot judge prose reliably (an independent recheck found both false alarms and
// misses), so a flag means "read this answer", not "wrong".

import { expect } from 'vitest'
import { type BraidExperiment, type Doc, demoDocument, findBraidExperiment } from '../../../src/workspace/document'
import { Workspace } from '../../../src/workspace/reducer'
import { type Generator, applyRewrite, braidStatus, replayRewrites, wordText } from '../../../src/algebra/braid'
import { FOUR_IDS, braidActions } from '../../../src/demo/four'
import { suggestionsFor } from '../../../src/ui/assistant/suggestions'
import { CAP, SPEECH, panelInput } from '../../ui/assistant/helpers'
import { type LiveCase, type LiveResult, noMathChange } from '../liveKit'

const ID = FOUR_IDS.expBraid
const braidOf = (doc: Doc): BraidExperiment => findBraidExperiment(doc, ID)

/** The braid demonstration, then further edits committed as the client does. */
function braidDoc(...edits: unknown[][]): Doc {
  const ws = new Workspace(demoDocument())
  ws.commit({ baseRevision: ws.current.revision, actions: braidActions(ws.current) })
  for (const actions of edits) ws.commit({ baseRevision: ws.current.revision, actions })
  return ws.current
}
const setWord = (target: 'word' | 'compare', word: Generator[] | null) => ({ kind: 'set_braid', experimentId: ID, target, word })
const relationAt = (at: number) => ({ kind: 'rewrite_braid', experimentId: ID, rule: 'braid_relation', at, generator: null })

/** σ1 σ2 σ1 beside the identity: the relation's other side is not shown. */
export const otherSideDoc = () => braidDoc([setWord('compare', [])])
/** σ1 σ2 σ1 σ2 σ1 beside σ1 σ2 σ2 σ1 σ2 with crossing 3 selected (item crossing:2): three spans match the
 * relation, the panel names crossings 3–5 (at 2), and only that rewrite turns the word into the comparison. */
export const relationDoc = () => braidDoc([setWord('word', [1, 2, 1, 2, 1]), setWord('compare', [1, 2, 2, 1, 2]), { kind: 'select_item', experimentId: ID, item: 'crossing:2' }])
/** σ1 σ2 σ2⁻¹ σ1⁻¹ beside the identity ("Undo this braid" on σ1 σ2): the innermost inverse pair is crossings 2–3 (at 1). */
export const cancelDoc = () => braidDoc([setWord('word', [1, 2, -2, -1]), setWord('compare', [])])
/** The demonstration as it opens: σ1 σ2 σ1 beside σ2 σ1 σ2. */
export const explainDoc = () => braidDoc()

/** The prompt is a suggestion the panel offers on this document (live phrasing), with exactly this text. */
function offered(doc: Doc, prompt: string) {
  const texts = suggestionsFor(panelInput(doc, { capability: { assistant: CAP.live, speech: SPEECH } })).map((s) => s.text)
  expect(texts, 'the panel does not offer this suggestion on the document').toContain(prompt)
}

const braidShown = ({ after }: LiveResult) => expect(after.selection.experimentId, 'the braid is no longer displayed').toBe(ID)

/** Nothing but the braid experiment changed: the same experiments (none added or removed), every other one
 * deep-equal, and the same sample sets, maps, groups and recipes. A select or replay changes none of these. */
function othersUnchanged({ before, after }: LiveResult) {
  expect(after.experiments.map((e) => e.id), 'experiments were added or removed').toEqual(before.experiments.map((e) => e.id))
  for (const e of before.experiments) if (e.id !== ID) expect(after.experiments.find((x) => x.id === e.id), `${e.id} changed`).toEqual(e)
  const rest = (d: Doc) => ({ sampleSets: d.sampleSets, maps: d.maps, groups: d.groups, recipes: d.recipes })
  expect(rest(after), 'sample sets, maps, groups or recipes changed').toEqual(rest(before))
}

// ---- Explanation guards (see the file header).

/** Sentences of an explanation, split after . ; : ! or ?. A question asserts nothing, so it is left out. */
const statements = (text: string) => text.split(/(?<=[.;:!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 0 && !s.endsWith('?'))

/** A noun after "braid" that makes the phrase about words or pictures, not braids ("not the same braid word"). */
const NOT_BRAID = String.raw`(?!\s+(?:words?|records?|diagrams?|pictures?|drawings?|experiments?|orders?|spans?|crossings?))`
/** A claim that two braids differ, in its common forms (contractions, distinct, inequivalent, "braids differ"). */
const DIFFERENT_BRAIDS = new RegExp([
  String.raw`\b(?:different|distinct|inequivalent|non-?equivalent|unequal)\s+braids\b`,
  String.raw`\b(?:a|another|one)\s+(?:different|distinct|inequivalent|unequal)\s+braid\b${NOT_BRAID}`,
  String.raw`\bbraids?\s+(?:(?:is|are|was|were|be)\s+)?(?:\w+ly\s+)?(?:different|distinct|inequivalent|unequal|not\s+(?:equal|equivalent|the\s+same))\b${NOT_BRAID}`,
  String.raw`\bbraids?\s+differs?\b`,
  String.raw`\bdiffer(?:s|ed|ent)?\s+as\s+braids\b`,
  String.raw`(?:\bnot|\bnever|n't)\s+(?:be\s+)?(?:the\s+)?same\s+braids?\b${NOT_BRAID}`,
  String.raw`\bnot\s+equal\s+braids\b`,
  String.raw`(?:\bnot|n't)\s+(?:braid[- ])?equivalent\b(?!\s+to\s+(?:an?\s+)?(?:proof|check|equality|saying))`,
  String.raw`\bdifferent\s+(?:elements?|members?)\s+of\s+(?:the\s+)?(?:braid\s+group|B3|B₃)\b`,
].join('|'), 'gi')
/** Before a difference claim in its clause: words that make it a non-claim (negation, modality, appearance, a
 * condition, a contrast, calling it a mistake, or the generic rule that DISAGREEING invariants prove difference). */
const HEDGE_BEFORE = new RegExp([
  String.raw`\b(?:not|never|no|nor|neither|none|nothing|cannot|can|could|would|might|may|should|only|seems?|seemed|looks?|looked|appears?|appeared|whether|if|when|whenever|rather\s+than|instead\s+of|as\s+opposed\s+to|tempt\w*|mistak\w*|wrong\w*|false\w*|incorrect\w*|mislead\w*|disagree\w*|mismatch\w*|detect\w*|distinguish\w*)\b`,
  String.raw`n't\b`,
  String.raw`\b(?:different|differing|distinct|unequal)\s+(?:invariants?|endpoint\s+permutations?|exponent\s+sums?)\b`,
].join('|'), 'i')
/** After a difference claim in its clause: it is called a mistake, or it is conditional on disagreeing invariants. */
const HEDGE_AFTER = /\b(?:apart|mistak\w*|wrong\w*|false|incorrect|mislead\w*|untrue|myth)\b|\bnot\s+(?:true|right|correct|so|the\s+case)\b|\b(?:when|whenever|if|unless)\b[\s\S]*\b(?:disagree|differ)\w*/i
/** Clause boundaries inside a sentence: a conjunction that starts a new assertion. */
const CLAUSE = /,\s*(?:but|so|yet|and|while|whereas|although|though|because|since|hence|thus|therefore)\b|\s(?:but|yet|so|whereas|although|though|hence|thus|therefore)\s/i

/** The first clause of `text` that claims two braids differ without a hedge, or null. Sentences matching `skip`
 * are not read (case 1: a sentence about the identity may truthfully call it a different braid). */
function differenceClaim(text: string, skip?: RegExp): string | null {
  for (const s of statements(text)) {
    if (skip?.test(s)) continue
    for (const clause of s.split(CLAUSE)) {
      for (const m of clause.matchAll(DIFFERENT_BRAIDS)) {
        if (!HEDGE_BEFORE.test(clause.slice(0, m.index)) && !HEDGE_AFTER.test(clause.slice(m.index + m[0].length))) return clause.trim()
      }
    }
  }
  return null
}

const INVARIANT = String.raw`(?:invariants?|endpoint\s+permutations?|exponent\s+sums?)`
const EQUAL = String.raw`(?:(?:the\s+)?same\s+braids?\b(?!\s+words?)|equal\s+braids|equivalent\s+braids|braid[- ]equivalent|(?:they|these|those|both|the\s+two|the\s+braids|the\s+words)(?:\s+(?:words|braids))?(?:\s+(?:are|is|be|being)|'re)\s+(?:equal|equivalent)\b|equality\b(?!\s+of\s+(?:the\s+|their\s+)?(?:invariants?|exponent|endpoint|permutations?))|equivalence\b)`
const CHECKED = String.raw`(?:checked|verified|established|proved|proven|confirmed)`
/** A claim that equality is already settled: by agreeing invariants, or as already checked by the app. */
const OVERCLAIM = new RegExp([
  // the invariants prove, show, establish or mean that they are equal
  String.raw`\b${INVARIANT}\b[^.;:!?]*?\b(?:prove[sdn]?|proving|show(?:s|ed)?|establish(?:es|ed)?|confirm(?:s|ed)?|guarantee[sd]?|impl(?:y|ies|ied)|mean[st]?|decide[sd]?|settle[sd]?|demonstrate[sd]?)\b[^.;:!?]*?${EQUAL}`,
  // the invariants agree, so (therefore, which means) they are equal
  String.raw`\b${INVARIANT}\b[^.;:!?]*?\b(?:so|therefore|thus|hence|which\s+means|meaning|it\s+follows|consequently)\b[^.;:!?]*?${EQUAL}`,
  // because the invariants agree, they are equal
  String.raw`\b(?:because|since|given\s+that)\b[^.;:!?]*?\b${INVARIANT}\b[^.;:!?]*?\b(?:agree|match|coincide|are\s+(?:equal|the\s+same))\w*[^.;:!?]*?${EQUAL}`,
  // the app has (already) checked that they are the same braid
  String.raw`\b(?:(?:will|would|could|can|might|may)\s+)?(?:already|has|have|had|been|now)\s+(?:been\s+)?${CHECKED}\b[^.;:!?]*?${EQUAL}`,
  // the same braid ... is (already) checked; the same braid (checked by supported rewrite rules)
  String.raw`${EQUAL}[^.;:!?]*?\b(?:(?:is|are|was|were|has\s+been|have\s+been|been|already|now)\s+(?:now\s+|already\s+)?${CHECKED}|${CHECKED}\s+by)\b`,
].join('|'), 'gi')
/** In or after an overclaim: words that make it a non-claim (negation, modality, "alone", "consistent with"). */
const HEDGE_IN = /\b(?:not|never|no|nothing|none|neither|nor|cannot|can|could|would|might|may|will|should|once|until|unless|if|whether|yet|alone|only|enough|sufficient|necessary|consistent|compatible|possible|possibly|perhaps|without|need|needs|needed|later)\b|n't\b|\bby\s+(?:itself|themselves)\b|\bon\s+(?:its|their)\s+own\b|\bto\s+(?:check|prove|establish|confirm|verify)\b/i
/** Before an overclaim in its clause: a condition or modality. */
const CONDITION_BEFORE = /\b(?:if|whether|unless|until|once|when|would|will|could|can|might|may)\b/i
/** Contrast boundaries: "X, but Y" asserts Y on its own, while "so" and "which" carry an overclaim's reasoning. */
const CONTRAST = /,?\s+(?:but|yet|while|whereas|although|though|however)\b/i

/** The first clause of `text` that claims equality is already checked or proved by invariants, or null. */
function overclaim(text: string): string | null {
  for (const s of statements(text)) {
    for (const clause of s.split(CONTRAST)) {
      for (const m of clause.matchAll(OVERCLAIM)) {
        if (!HEDGE_IN.test(clause.slice(m.index)) && !CONDITION_BEFORE.test(clause.slice(0, m.index))) return clause.trim()
      }
    }
  }
  return null
}

const differenceFlag = (r: LiveResult, skip?: RegExp): string[] => {
  const c = differenceClaim(r.j.proposal.explanation, skip)
  return c ? [`may call equal braids different: "${c}"`] : []
}
const overclaimFlag = (r: LiveResult): string[] => {
  const c = overclaim(r.j.proposal.explanation)
  return c ? [`may claim equality is already checked or proved by invariants (no rewrite connects the words): "${c}"`] : []
}
/** Case 1: a sentence about the identity (the comparison before the answer) may truthfully call it a different braid. */
const ABOUT_IDENTITY = /\bidentity\b|\bdoing nothing\b|\btrivial braid\b|\bempty (?:word|braid|comparison)\b/i

/** The new word is checked to be the same braid: the rewrite record continues from the same origin with at
 * least one more supported rewrite, and replays to the word. */
function checkedSameBraid(b: BraidExperiment, a: BraidExperiment) {
  expect(a.origin, 'the rewrite record restarted (the word was set, not rewritten), so it is not checked to be the same braid').toEqual(b.origin)
  expect(a.rewrites.slice(0, b.rewrites.length), 'earlier rewrites were lost').toEqual(b.rewrites)
  expect(a.rewrites.length, 'no supported rewrite was recorded').toBeGreaterThan(b.rewrites.length)
  expect(replayRewrites(a.origin, a.rewrites)).toEqual(a.word)
}

/** A rewrite of the named span (crossing n is index n - 1): exactly that span changes; the rest of the word,
 * the comparison, the other experiments and the display do not; the result is checked to be the same braid. */
function rewroteExactly(rule: 'braid_relation' | 'cancel_pair', at: number, prompt: string) {
  const n = rule === 'braid_relation' ? 3 : 2
  return (r: LiveResult) => {
    offered(r.before, prompt)
    const b = braidOf(r.before)
    const a = braidOf(r.after)
    const expected = applyRewrite(b.word, { rule, at, generator: null })
    expect(a.word, `expected ${wordText(expected)} (only crossings ${at + 1}–${at + n} rewritten), got ${wordText(a.word)}`).toEqual(expected)
    expect(a.word.slice(0, at), `crossings before ${at + 1} changed`).toEqual(b.word.slice(0, at))
    expect(a.word.slice(a.word.length - (b.word.length - at - n)), `crossings after ${at + n} changed`).toEqual(b.word.slice(at + n))
    checkedSameBraid(b, a)
    expect(a.compare, 'the comparison changed').toEqual(b.compare)
    othersUnchanged(r)
    braidShown(r)
  }
}

const OTHER_SIDE = 'Show the other side of the braid relation'
const RELATION = 'Apply the braid relation at crossings 3–5'
const CANCEL = 'Cancel the inverse pair at crossings 2–3'
const EXPLAIN = 'Explain this comparison'

export const BRAID_CASES: LiveCase[] = [
  {
    name: 'braid: "Show the other side of the braid relation" shows σ2 σ1 σ2 beside the unchanged σ1 σ2 σ1',
    prompt: OTHER_SIDE,
    doc: otherSideDoc,
    check: (r) => {
      offered(r.before, OTHER_SIDE)
      const b = braidOf(r.before)
      const a = braidOf(r.after)
      expect(a.word, 'the braid itself changed; the other side belongs beside it').toEqual(b.word)
      expect(a.compare, `the comparison is ${a.compare ? wordText(a.compare) : 'not shown'}, not σ2 σ1 σ2`).toEqual([2, 1, 2])
      othersUnchanged(r)
      braidShown(r)
    },
    // σ1 σ2 σ1 = σ2 σ1 σ2 is the braid relation, but no rewrite connects them yet: neither "different braids" nor
    // "already checked / proved by the invariants". σ1 σ2 σ1 does differ from the identity it replaces.
    flags: (r) => [...differenceFlag(r, ABOUT_IDENTITY), ...overclaimFlag(r)],
    // Plausible confusion: rewriting the braid itself to σ2 σ1 σ2 (the comparison still the identity).
    wrong: () => [relationAt(0)],
  },
  {
    name: 'braid: "Apply the braid relation at crossings 3–5" rewrites only crossings 3–5 by a checked rewrite, so the word becomes the comparison as the same braid',
    prompt: RELATION,
    doc: relationDoc,
    check: (r) => {
      rewroteExactly('braid_relation', 2, RELATION)(r)
      const a = braidOf(r.after)
      expect(braidStatus(a.origin, a.word, a.rewrites, a.compare).originEqualsCompareByRewrites, 'the record does not establish that the braid equals the comparison').toBe(true)
    },
    // After the rewrite the app HAS checked equality, so only a difference claim is suspect here.
    flags: (r) => differenceFlag(r),
    // Plausible confusion: the relation at the first matching span (crossings 1–3) instead of the named one.
    wrong: () => [relationAt(0)],
  },
  {
    name: 'braid: "Cancel the inverse pair at crossings 2–3" removes only that pair by a checked rewrite (two crossings shorter, the same braid)',
    prompt: CANCEL,
    doc: cancelDoc,
    check: (r) => {
      rewroteExactly('cancel_pair', 1, CANCEL)(r)
      expect(braidOf(r.after).word.length).toBe(braidOf(r.before).word.length - 2)
    },
    // Plausible shortcut: setting the word to the result, which restarts the record (not a checked rewrite).
    wrong: () => [setWord('word', [1, -1])],
  },
  {
    name: 'braid: "Explain this comparison" explains σ1 σ2 σ1 against σ2 σ1 σ2 without changing the mathematics or calling them different braids',
    prompt: EXPLAIN,
    doc: explainDoc,
    check: (r) => {
      offered(r.before, EXPLAIN)
      noMathChange(r)
      const b = braidOf(r.before)
      const a = braidOf(r.after)
      expect({ word: a.word, origin: a.origin, rewrites: a.rewrites, compare: a.compare }, 'the braid, its record or its comparison changed').toEqual({ word: b.word, origin: b.origin, rewrites: b.rewrites, compare: b.compare })
      braidShown(r)
      expect(r.j.proposal.explanation.trim().length, 'no explanation').toBeGreaterThan(0)
    },
    // σ1 σ2 σ1 = σ2 σ1 σ2 is the braid relation itself, so an explanation must never call them different braids;
    // and no rewrite has been applied, so it must not say equality is already checked or proved by invariants.
    flags: (r) => [...differenceFlag(r), ...overclaimFlag(r)],
    // A math-changing answer: the relation applied at crossings 1–3.
    wrong: () => [relationAt(0)],
  },
]
