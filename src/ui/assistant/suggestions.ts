// Suggested questions of the Ask Meta Muse AI inspector (UI-REFINEMENT-SPEC section 7, suggestions table).
//
// A suggestion is a REAL request: pressing it dispatches {kind:'assistant', action:{kind:'ask', text}} through
// the normal client, context and validation path; it is never a scene mutation. Suggestions are derived from
// the exact document (the displayed experiment, its selection and state), never from rendered labels, and a
// suggestion is offered only when its intent is valid now (the braid rewrite names a span that matches; the P/Q
// fiber explanation needs a selected sample; nothing is offered past a full history).
//
// Phrasing depends on who answers. A live model gets the spec's wording. The synthetic server answers only
// prompts that match one of its prepared fixtures (server/muse/synthetic.ts, server/muse/fourSynthetic.ts); every
// spec wording now has one, so both modes use the same text, except where the synthetic fixture would refuse the
// request on this document (then the suggestion is left out in synthetic mode and while the mode is not known).
// tests/ui/assistant/suggestions.test.ts checks every synthetic phrasing against the fixtures on the actual
// document. Two usable suggestions are preferred over three misleading ones.

import { type BraidExperiment, type Doc, type GroupExperiment, type LinearExperiment, type VectorWalkExperiment, branchMatrix, branchSymbol, findAnyExperiment, findRecipe, findSampleSet, groupFor, linearExperiments, walkInputOf } from '../../workspace/document'
import { deriveWalk, parseWalkItem } from '../../algebra/walk'
import { comparisonOf } from '../../recipes/recipe'
import { matEq } from '../../model/linear'
import { type Generator, type RewriteRule, applyRewrite, wordEq, wordText } from '../../algebra/braid'
import { DOMAIN_LIMITS } from '../../domains/inputs'
import { FOUR_IDS } from '../../demo/four'
import { demoOf } from '../../demo/order'
import { arrowNames } from '../../lessons/steinitz/cases'
import type { AssistantPanelInput, UiCommand } from '../model'
import { prettyPlain } from '../presenters/common'

export interface Suggestion {
  /** Stable intent ID ("sculpture.applyAgain"). */
  id: string
  /** The exact prompt that is submitted, shown as the suggestion's text. */
  text: string
  /** What the suggestion refers to right now (the element, span or rule), or null. */
  note: string | null
  command: UiCommand
}

/** Who will answer: the spec's wording (live), fixture phrasings only (synthetic or not known yet), or nothing. */
export type PhrasingMode = 'live' | 'synthetic' | 'none'

export function phrasingMode(cap: AssistantPanelInput['capability']): PhrasingMode {
  const a = cap?.assistant
  if (!a) return 'synthetic'
  if (a.mode === 'unavailable') return 'none'
  return a.mode === 'meta' ? 'live' : 'synthetic'
}

/** One intent with its live and synthetic phrasing (null: not offered in that mode). */
interface Intent {
  id: string
  live: string | null
  synthetic: string | null
  note?: string
}

export const MAX_SUGGESTIONS = 3

const HISTORY_MAX: number = DOMAIN_LIMITS.history

const ask = (text: string): UiCommand => ({ kind: 'assistant', action: { kind: 'ask', text } })

/** An intent whose wording has a prepared synthetic fixture: the same text in both modes. */
const both = (id: string, text: string, note?: string): Intent => ({ id, live: text, synthetic: text, note })

function selectedItem(doc: Doc, experimentId: string): string | null {
  return doc.selection.experimentId === experimentId ? doc.selection.item : null
}

// ------------------------------------------------------------------ sculpture (C4 / V4)

function sculptureIntents(doc: Doc, e: GroupExperiment): Intent[] {
  const g = groupFor(doc, e)
  const cyclic = g.definition.kind === 'cyclic'
  const klein = g.definition.kind === 'klein_four'
  const opLabel = (x: string) => (cyclic ? `+${g.label(x).plain}` : g.label(x).plain)
  const item = selectedItem(doc, e.id)
  const selected = item && g.has(item) ? item : null
  const last = e.history[e.history.length - 1]?.element ?? null
  // The fixture's template applies the selected card, else the last applied element (server/muse/four.ts).
  const op = selected ?? last
  const full = e.history.length >= HISTORY_MAX
  const out: Intent[] = []
  if (op && !full) {
    // "again" only when this very operation was the last one applied.
    out.push(both('sculpture.applyAgain', op === last ? `Apply ${opLabel(op)} again` : `Apply ${opLabel(op)}`, `Applies ${opLabel(op)} to every bead`))
  }
  if (!klein) {
    out.push(both('sculpture.useOther', 'Use this representation on V₄', 'The same saved recipe, bound to V₄'))
  } else {
    // V4 -> C4: shows the C4 experiment the recipe came from (V4 was made from it), exactly like Use on C₄.
    const hasC4 = doc.experiments.some((x) => x.id === FOUR_IDS.expC4)
    if (hasC4) out.push(both('sculpture.useOther', 'Use this representation on C₄', 'The same saved recipe, on C₄'))
  }
  if (op) out.push(both('sculpture.explainCycle', 'Explain this cycle', `The cycles of ${opLabel(op)}`))
  return out
}

// ------------------------------------------------------------------ cube and diagonals

function cubeIntents(e: GroupExperiment): Intent[] {
  const full = e.history.length >= HISTORY_MAX
  const out: Intent[] = []
  if (!full) out.push(both('cube.rotateZ', 'Rotate the cube 90 degrees about z', 'The quarter turn about z'))
  if (e.history.length) out.push(both('cube.explainDiagonals', 'Explain how the diagonals were rearranged', 'Where each diagonal object is now'))
  if (!full) out.push(both('cube.swap01', 'Swap objects 0 and 1', 'The rotation that exchanges the lines of objects 0 and 1'))
  return out
}

// ------------------------------------------------------------------ quotient

function quotientIntents(doc: Doc, e: GroupExperiment): Intent[] {
  const g = groupFor(doc, e)
  const grouped = e.observation === 'unoriented_axis_lines'
  const [A, B] = e.operands
  const item = selectedItem(doc, e.id)
  const selRot = item && g.has(item) ? item : null
  const selClass = item?.startsWith('class:') ? item.slice(6) : null
  // Display names in the notes, with the same superscripts as the rest of the UI (the prompts never contain them).
  const name = (x: string) => prettyPlain(g.label(x).plain)
  const out: Intent[] = []
  if (!grouped) {
    out.push(both('quotient.group', 'Group rotations by their action on the unoriented axes', 'Keeps only which axis line goes where'))
  }
  const second = B ?? (selRot && selRot !== A ? selRot : null)
  if (A && second) out.push(both('quotient.compose', 'Compose these two', `A = ${name(A)}, then B = ${name(second)}`))
  // Answered grouped or not (the reply says how to see the grouping).
  out.push(both('quotient.whySix', 'Why are there six classes?', '24 rotations, a kernel of four'))
  // Not while a class is already the selection (expanding it again would change nothing).
  if (grouped && !selClass && (selRot || A)) out.push(both('quotient.expand', 'Expand this class', selRot ? `The class of ${name(selRot)}` : `The class of A = ${name(A!)}`))
  if (grouped && (A || selRot)) out.push(both('quotient.anotherRep', 'Choose another representative', `Another member of the class of ${name((A ?? selRot)!)}`))
  return out
}

// ------------------------------------------------------------------ braids

/** The rewrite the "apply that rewrite" template picks (server/muse/four.ts applyRewriteTemplate): the braid
 * relation at its first matching span, else the first inverse pair; only at the selected crossing if one is
 * selected. Null when no supported rewrite matches. */
export function availableRewrite(word: readonly Generator[], selectedCrossing: number | null): { rule: Exclude<RewriteRule, 'insert_pair'>; at: number } | null {
  const positions = selectedCrossing !== null ? [selectedCrossing] : word.map((_, i) => i)
  for (const rule of ['braid_relation', 'cancel_pair'] as const) {
    for (const at of positions) {
      try {
        applyRewrite(word, { rule, at, generator: null })
        return { rule, at }
      } catch {
        /* not this span */
      }
    }
  }
  return null
}

function braidIntents(doc: Doc, e: BraidExperiment): Intent[] {
  const item = selectedItem(doc, e.id)
  const k = item?.startsWith('crossing:') ? Number(item.slice('crossing:'.length)) : null
  const crossing = k !== null && Number.isInteger(k) ? k : null
  const out: Intent[] = []
  const other = wordEq(e.word, [1, 2, 1]) ? [2, 1, 2] : wordEq(e.word, [2, 1, 2]) ? [1, 2, 1] : null
  if (other && !(e.compare && wordEq(e.compare, other))) {
    out.push(both('braid.otherSide', 'Show the other side of the braid relation', `Compares with ${wordText(other)}`))
  }
  const rw = availableRewrite(e.word, crossing)
  if (rw) {
    if (rw.rule === 'braid_relation') {
      const span = e.word.slice(rw.at, rw.at + 3)
      const to = wordEq(span, [1, 2, 1]) ? [2, 1, 2] : [1, 2, 1]
      out.push(both('braid.rewrite', `Apply the braid relation at crossings ${rw.at + 1}–${rw.at + 3}`, `${wordText(span)} → ${wordText(to)}`))
    } else {
      const span = e.word.slice(rw.at, rw.at + 2)
      out.push(both('braid.rewrite', `Cancel the inverse pair at crossings ${rw.at + 1}–${rw.at + 2}`, `${wordText(span)} → nothing`))
    }
  }
  if (e.compare !== null) out.push(both('braid.explainComparison', 'Explain this comparison', 'Invariants and checked rewrites'))
  return out
}

// ------------------------------------------------------------------ linear: P / Q and the order comparison

function plainLabel(label: string): string {
  return label.replace(/_\{(.*?)\}/g, '$1')
}

function pqIntents(doc: Doc, e: LinearExperiment): Intent[] {
  const out: Intent[] = []
  const other = linearExperiments(doc).find((x) => x.id !== e.id && x.sampleSetId === e.sampleSetId && demoOf(doc, x) === 'pq')
  if (!other) {
    // The use-on-q fixture creates Q (it would be refused once Q exists).
    out.push(both('pq.useOther', 'Use this representation on Q', 'The same recipe on Q(x, y, z) = (0, y, z)'))
  } else if (other.branches[0]) {
    // Back to P has a fixture (a select); "on Q" once Q exists has not (the use-on-q fixture creates Q).
    const sym = branchSymbol(doc, other, other.branches[0].id)
    out.push({ id: 'pq.useOther', live: `Use this representation on ${sym}`, synthetic: sym === 'P' ? `Use this representation on ${sym}` : null, note: `The same recipe on ${sym}` })
  }
  const sel = doc.selection.experimentId === e.id ? doc.selection.sampleId : null
  if (sel) {
    const sample = findSampleSet(doc, e.sampleSetId).samples.find((s) => s.id === sel)
    const name = sample?.label ? plainLabel(sample.label) : sel
    out.push(both('pq.explainFiber', 'Explain the selected fiber', `The fiber through ${name}`))
  } else {
    out.push(both('pq.whatLost', 'Show me what this transformation loses', 'Selects u and its fiber'))
  }
  return out
}

/** The displayed comparison's routes (sides from the bound recipe's ports) and whether they resolve equal. */
function comparison(doc: Doc, e: LinearExperiment): { left: string[]; right: string[]; mapsEqual: boolean } | null {
  const cmp = e.binding ? comparisonOf(findRecipe(doc, e.binding.recipeId)) : null
  if (!cmp) return null
  const l = e.binding!.ports[cmp.left]
  const r = e.binding!.ports[cmp.right]
  const lb = e.branches.find((b) => b.id === l)
  const rb = e.branches.find((b) => b.id === r)
  if (!lb || !rb) return null
  return { left: lb.mapIds, right: rb.mapIds, mapsEqual: matEq(branchMatrix(doc, e, lb.id), branchMatrix(doc, e, rb.id)) }
}

function orderIntents(doc: Doc, e: LinearExperiment): Intent[] {
  const c = comparison(doc, e)
  if (!c) return []
  const same = (ids: string[]) => ids.join('|') === [...ids].reverse().join('|')
  const out: Intent[] = []
  // Reversing a route that reads the same both ways changes nothing: offer the other side, or neither.
  if (!same(c.left)) out.push(both('order.reverse', 'Reverse the left branch', 'Applies the left route’s maps in the opposite order'))
  else if (!same(c.right)) out.push(both('order.reverse', 'Reverse the right branch', 'Applies the right route’s maps in the opposite order'))
  out.push(both('order.explain', c.mapsEqual ? 'Explain why the results agree' : 'Explain why the results differ', c.mapsEqual ? 'Both routes give the same map here' : 'The two routes give different maps here'))
  return out
}

// ------------------------------------------------------------------ proof lesson (vector walk)

/** The selected reordered endpoint k of the walk, or null. */
function selectedEndpoint(doc: Doc, e: VectorWalkExperiment): number | null {
  try {
    const it = parseWalkItem(selectedItem(doc, e.id), e)
    return it && it.kind === 'reordered' ? it.index : null
  } catch {
    return null
  }
}

function proofIntents(doc: Doc, e: VectorWalkExperiment): Intent[] {
  const f = deriveWalk(walkInputOf(e))
  const k = selectedEndpoint(doc, e)
  if (!f.zeroSum) return [both('proof.whyFails', 'Why does the bound fail here?'), both('proof.restore', 'Restore the closed walk'), both('proof.wholeTheorem', 'Does this prove the whole theorem?')]
  const out: Intent[] = []
  let item = null
  try {
    item = parseWalkItem(selectedItem(doc, e.id), e)
  } catch {
    /* no valid selection */
  }
  // A selected arrow is what "this sign" names; "this point" would name nothing (the fixture would only ask
  // which point), so the Why question waits until a point or nothing is selected.
  // Notes name things as the lesson shows them: the scene's arrow names (a₁ … −c₂) and W₃ with a subscript.
  if (item?.kind === 'vector') out.push(both('proof.flipSign', 'Flip this sign', `The sign of ${arrowNames(walkInputOf(e)).get(item.id) ?? item.id}`))
  else out.push(both('proof.whyPoint', 'Why is this point inside the bound?', k !== null ? `W${String(k).replace(/[0-9]/g, (c) => '₀₁₂₃₄₅₆₇₈₉'[Number(c)]!)}` : undefined))
  // The other branch is offered when it exists for this walk (the negative part needs a − arrow).
  const branch = k !== null ? f.witnesses[k]!.branch : null
  if (branch !== 'negative' && f.negative.length) out.push(both('proof.otherHalf', 'Show the other half of the argument'))
  out.push(both('proof.returnHome', 'Why must the arrows return home?'))
  out.push(both('proof.check', 'Check this example'))
  return out
}

// ------------------------------------------------------------------ entry

function intentsFor(input: AssistantPanelInput): Intent[] {
  const doc = input.doc
  let e
  try {
    e = findAnyExperiment(doc, input.experimentId)
  } catch {
    return []
  }
  switch (input.demo) {
    case 'sculpture':
      return e.domain === 'group' ? sculptureIntents(doc, e) : []
    case 'cube':
      return e.domain === 'group' ? cubeIntents(e) : []
    case 'quotient':
      return e.domain === 'group' ? quotientIntents(doc, e) : []
    case 'braid':
      return e.domain === 'braid' ? braidIntents(doc, e) : []
    case 'pq':
      return e.domain === 'linear' ? pqIntents(doc, e) : []
    case 'order':
      return e.domain === 'linear' ? orderIntents(doc, e) : []
    case 'proof':
      return e.domain === 'vector_walk' ? proofIntents(doc, e) : []
  }
}

/** What to say when no suggestion fits the current state (instead of offering a misleading one). */
export function emptySuggestionHint(input: Pick<AssistantPanelInput, 'demo'>): string {
  switch (input.demo) {
    case 'quotient':
      return 'Select a rotation or a class for suggested questions, or ask your own.'
    case 'braid':
      return 'Select a crossing or change the braid for suggested questions, or ask your own.'
    default:
      return 'No suggested question fits this state; ask your own.'
  }
}

/** Two or three context-appropriate suggestions for the displayed experiment (empty when none is usable). */
export function suggestionsFor(input: AssistantPanelInput): Suggestion[] {
  const mode = phrasingMode(input.capability)
  if (mode === 'none') return []
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const i of intentsFor(input)) {
    const text = mode === 'live' ? i.live : i.synthetic
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push({ id: i.id, text, note: i.note ?? null, command: ask(text) })
    if (out.length === MAX_SUGGESTIONS) break
  }
  return out
}
