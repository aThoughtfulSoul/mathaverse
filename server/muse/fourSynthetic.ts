// SYNTHETIC fixtures for the four algebra demonstrations (FOUR-DEMOS-PARALLEL-HANDOFF section 10): the
// required requests and close paraphrases. They are prepared, clearly labelled examples, not Muse output; the
// route sends them with source "synthetic" through the same validation as live output. Actions come from the
// server templates in four.ts (shared with the live prompt); explanations are composed from exact facts of
// the planned document ("computed exactly", "checked by supported rewrite rules"), never from a table here.

import { type ActionJson, type Proposal, PROPOSAL_LIMITS } from '../../src/workspace/actions'
import { computeFacts } from '../../src/workspace/context'
import { type BraidExperiment, type Doc, type GroupExperiment, findAnyExperiment, findGroup, groupFor } from '../../src/workspace/document'
import { planTransaction } from '../../src/workspace/reducer'
import { chronologicalProduct, groupName, groupOf, regularPermutation } from '../../src/algebra/groups'
import { cycleText, cycles } from '../../src/algebra/permutation'
import { KERNEL, axisClasses, phiOf } from '../../src/algebra/cube'
import { type Generator, type RewriteRule, applyRewrite, braidStatus, endpointPermutation, exponentSum, wordText } from '../../src/algebra/braid'
import { demoOf } from '../../src/demo/order'
import type { Prepared } from './order'
import {
  anotherRepresentativeTemplate, applyAgainTemplate, applyRewriteTemplate, buildWordTemplate, composeTemplate, doubleCrossingTemplate, expandClassTemplate,
  kleinTemplate, otherSideTemplate, quarterTurnTemplate, swapTemplate, trackPairsTemplate, undoBraidTemplate, undoRotationTemplate,
} from './four'
import { prepared } from './order'
import { braidActions, cubeActions, sculptureActions, sculptureRebindActions } from '../../src/demo/four'

interface FourFixture {
  name: string
  example: string
  matches: RegExp
  build(doc: Doc, prompt?: string): Proposal
}

type Part = string | null | false | undefined

/** An answer with no actions. Its explanation keeps whole sentences: a long one loses whole trailing sentences
 * (fitSentences), never part of one, so no expression is cut. */
const answer = (title: string, explanation: string | Part[]): Proposal => ({
  proposalVersion: 1, title, explanation: fitSentences(typeof explanation === 'string' ? sentencesOf(explanation) : explanation), actions: [],
})

/** The planned document's facts of these kinds for the displayed experiment (exact text), one sentence each. */
function plannedFacts(doc: Doc, actions: ActionJson[], kinds: string[]): string[] {
  try {
    const planned = planTransaction(doc, actions).doc
    const shown = planned.selection.experimentId
    return computeFacts(planned).filter((f) => kinds.includes(f.kind) && f.refs.includes(shown)).map((f) => `${f.text}.`)
  } catch {
    return []
  }
}

/** A proposal from a prepared template: its actions with an explanation from the planned facts, or the
 * template's reason as an answer with no actions. The lead and each fact are whole parts (fitSentences): a fact
 * that does not fit is left out whole, never cut. */
function fromTemplate(doc: Doc, t: Prepared, title: string, lead: string, kinds: string[]): Proposal {
  if ('unavailable' in t) return answer(title, `Not applied: ${t.unavailable}.`)
  return { proposalVersion: 1, title, explanation: fitSentences([lead, ...plannedFacts(doc, t.actions, kinds)]), actions: t.actions }
}

const C4 = groupOf({ kind: 'cyclic', order: 4 })
const V4 = groupOf({ kind: 'klein_four' })
const orderList = (g: typeof C4) => g.elements.map((x) => `${g.label(x).plain}: order ${g.elementOrder(x)}, ${cycleText(regularPermutation(g, x), (i) => g.label(g.elements[i]!).plain)}`).join('; ')

// ------------------------------------------------------------------ UI suggestion fixtures (UI-REFINEMENT-SPEC 7)
// The Ask Meta Muse AI suggestions for the four demonstrations. Explanations are computed from the request's
// document with the exact algebra (src/algebra) and its facts; answer-only fixtures carry no actions. When the
// displayed state does not support a request, the reply says so ("Not applied:" / "Not available:").

/** Join sentences up to the explanation limit (PROPOSAL_LIMITS.explanation), dropping whole trailing sentences
 * rather than cutting one. */
function fitSentences(parts: Part[], limit: number = PROPOSAL_LIMITS.explanation): string {
  let out = ''
  for (const p of parts) {
    if (typeof p !== 'string' || !p) continue
    const next = out ? `${out} ${p}` : p
    if (next.length > limit) break
    out = next
  }
  return out
}

/** A prepared text's sentences (split after a full stop), so fitSentences can drop whole trailing ones. */
const sentencesOf = (text: string): string[] => text.split(/(?<=\.) +/)

/** The displayed group experiment of a demonstration, else null. */
function shownGroup(doc: Doc, kind: 'sculpture' | 'cube' | 'quotient'): GroupExperiment | null {
  const e = findAnyExperiment(doc, doc.selection.experimentId)
  return e.domain === 'group' && demoOf(doc, e) === kind ? e : null
}

function shownBraid(doc: Doc): BraidExperiment | null {
  const e = findAnyExperiment(doc, doc.selection.experimentId)
  return e.domain === 'braid' ? e : null
}

/** "+1" for an element of a cyclic group (addition mod n), its pair label "(1,0)" in V4. */
function operationText(doc: Doc, e: GroupExperiment, x: string): string {
  const g = groupFor(doc, e)
  return g.definition.kind === 'cyclic' ? `+${g.label(x).plain}` : g.label(x).plain
}

const APPLY_NAMED = /^apply (\+?[0-9]+|\(\s*[01]\s*,\s*[01]\s*\))(?: again)?$/

/** "Apply +1 again" / "Apply (1,0)": apply the NAMED element of the displayed sculpture's group. */
function applyNamed(doc: Doc, prompt?: string): Proposal {
  const e = shownGroup(doc, 'sculpture')
  if (!e) return answer('Apply an operation', 'Not applied: no sculpture is displayed, so the operation names nothing. "Show C4" opens the sculpture.')
  const m = APPLY_NAMED.exec(prompt ?? '')
  if (!m) return answer('Apply an operation', 'Not applied: name the operation to apply, for example "Apply +1 again".')
  const g = groupFor(doc, e)
  const raw = m[1]!
  const wanted = raw.startsWith('(') ? `(${raw.replace(/[()\s]/g, '')})` : raw.replace(/^\+/, '')
  const x = g.elements.find((y) => g.label(y).plain === wanted)
  const gname = groupName(findGroup(doc, e.groupId).definition).plain
  if (!x) return answer(`Apply ${raw}`, `Not applied: ${raw} is not an operation of ${gname}; its operations are ${g.elements.map((y) => operationText(doc, e, y)).join(', ')}.`)
  const op = operationText(doc, e, x)
  return fromTemplate(doc, prepared(doc, [{ kind: 'apply_element', experimentId: e.id, element: x }]), `Apply ${op}`, `This applies ${op} to every bead; each bead keeps its identity and moves to its new slot.`, ['group_state'])
}

/** "Use this representation on C4": the same saved recipe shown on C4 again (sculptureRebindActions from V4). */
function useOnC4(doc: Doc): Proposal {
  const title = 'The same experiment on C4'
  const e = shownGroup(doc, 'sculpture')
  if (!e) return answer(title, 'Not applied: no sculpture is displayed. "Show C4" opens it.')
  if (findGroup(doc, e.groupId).definition.kind !== 'klein_four') return answer(title, `Not applied: ${groupName(findGroup(doc, e.groupId).definition).plain} is already displayed.`)
  const actions = sculptureRebindActions(doc, e)
  if (!actions.length) return answer(title, 'Not applied: this workspace has no C4 experiment to show the recipe on.')
  return fromTemplate(doc, prepared(doc, actions), title, 'This shows the same saved sculpture recipe on C4 (addition mod 4) again with +1 selected; nothing is created and V4 keeps its history.', ['group_state'])
}

/** "Explain this cycle": the regular action of the selected (or last applied) operation, computed exactly. */
function explainCycle(doc: Doc): Proposal {
  const title = 'This cycle'
  const e = shownGroup(doc, 'sculpture')
  if (!e) return answer(title, 'Not available: no sculpture is displayed, so "this cycle" names nothing. "Show C4" opens the sculpture.')
  const g = groupFor(doc, e)
  const item = doc.selection.experimentId === e.id ? doc.selection.item : null
  const op = item && g.has(item) ? item : e.history[e.history.length - 1]?.element ?? null
  if (!op) return answer(title, 'Not available: no operation is selected and none has been applied yet, so there is no cycle to explain. Choose an operation card first.')
  const name = (x: string) => g.label(x).plain
  const opText = operationText(doc, e, op)
  const p = regularPermutation(g, op)
  const cs = cycles(p).filter((c) => c.length > 1)
  const ord = g.elementOrder(op)
  const notation = cycleText(p, (i) => name(g.elements[i]!))
  const gname = groupName(findGroup(doc, e.groupId).definition).plain
  const shape =
    !cs.length ? `${opText} is the identity of ${gname}: it moves no bead, so its order is 1.`
    : `Applying ${opText} sends the bead in slot y to slot ${g.definition.kind === 'cyclic' ? `y + ${name(op)} (mod ${g.order})` : g.definition.kind === 'klein_four' ? `y + ${name(op)} (componentwise mod 2)` : `${name(op)}·y`}, which moves the slots in ${cs.length === 1 ? `one ${cs[0]!.length}-cycle` : `${cs.length} cycles of length ${cs.map((c) => c.length).join(' and ')}`}: ${notation}.`
  // ord applications return every bead to where it was before them; whether that is home is the state fact's to say.
  const back = cs.length ? `Every cycle closes after ${ord} application${ord === 1 ? '' : 's'}, so ${opText} has order ${ord}: applying it ${ord} times in a row brings every bead back to the slot it was in before.` : null
  const state = computeFacts(doc).find((f) => f.id === `state:${e.id}`)?.text ?? null
  return answer(title, [`Computed exactly in ${gname}.`, shape, back, state && `Now: ${state}.`])
}

/** "Explain how the diagonals were rearranged": phi of the accumulated rotation, computed exactly. */
function explainDiagonals(doc: Doc): Proposal {
  const title = 'How the diagonals were rearranged'
  const e = shownGroup(doc, 'cube')
  if (!e) return answer(title, 'Not available: the cube and its diagonal objects are not displayed. "Show the four diagonals" opens them.')
  const g = groupFor(doc, e)
  const k = chronologicalProduct(g, e.history.map((h) => h.element))
  const p = phiOf(k)
  if (!e.history.length) return answer(title, 'Not available: nothing has been applied yet. The accumulated rotation is the identity, so phi = [0,1,2,3] and every diagonal object is on its own line. Rotate the cube or swap two objects first.')
  const moved = p.map((to, i) => (to !== i ? `object ${i} is on line ${to}` : null)).filter((x): x is string => x !== null)
  if (moved.length) moved[0] = `O${moved[0]!.slice(1)}`
  const stay = p.map((to, i) => (to === i ? i : -1)).filter((i) => i >= 0)
  return answer(title, [
    `Computed exactly: after ${e.history.length} step${e.history.length === 1 ? '' : 's'} the accumulated rotation is ${g.label(k).plain}, and it permutes the four unoriented body-diagonal lines by phi = [${p.join(',')}] = ${cycleText(p)}.`,
    moved.length ? `${moved.join(', ')}${stay.length ? `; object${stay.length === 1 ? '' : 's'} ${stay.join(' and ')} stay${stay.length === 1 ? 's' : ''} on ${stay.length === 1 ? 'its own line' : 'their own lines'}` : ''}.` : 'Every object is back on its own line: the accumulated rotation fixes all four diagonal lines.',
    'The diagonals are lines, not arrows: a rotation that reverses one still leaves it on its line.',
    'phi turns composition of rotations into composition of permutations and gives each of the 24 rotations a different permutation of the four lines.',
  ])
}

/** "Why are there six classes?": 24 rotations, the kernel of the action on the three axis lines, 24/4 = 6. */
function whySixClasses(doc: Doc): Proposal {
  const G = groupOf({ kind: 'cube_rotations' })
  const cls = axisClasses()
  const name = (x: string) => G.label(x).plain
  const shown = shownGroup(doc, 'quotient')
  const where = !shown ? 'The quotient view is not displayed; "Track only the opposite-face pairs" opens it grouped.'
    : shown.observation === 'unoriented_axis_lines' ? 'The view shows the six classes now.'
    : 'Ask "Group rotations by their action on the unoriented axes" to see them grouped.'
  return answer('Why there are six classes', [
    `Computed exactly: the cube has ${G.order} rotations. Watching only where the three unoriented coordinate-axis lines (the opposite-face pairs) go gives each rotation a permutation of those three lines.`,
    `The rotations that leave every axis line in place form the kernel K = {${KERNEL.map(name).join(', ')}} (${KERNEL.length} rotations), and two rotations give the same permutation exactly when they differ by an element of K.`,
    `So the rotations fall into ${G.order} / ${KERNEL.length} = ${cls.length} classes of ${KERNEL.length}, one for each of the ${cls.length} permutations of three lines.`,
    where,
  ])
}

/** "Explain this comparison": the braid word against its comparison word, by invariants and checked rewrites. */
function explainComparison(doc: Doc): Proposal {
  const title = 'This comparison'
  const e = shownBraid(doc)
  if (!e) return answer(title, 'Not available: no braid comparison is displayed. For the operation-order comparison, ask "Explain why the results differ".')
  if (!e.compare) return answer(title, 'Not available: no comparison word is shown beside the braid, so there is nothing to compare. "Show the other side of the braid relation" adds one for σ1 σ2 σ1.')
  const inv = (w: readonly number[]) => `${wordText(w)} (endpoint permutation [${endpointPermutation(w).join(',')}], exponent sum ${exponentSum(w)})`
  const st = braidStatus(e.origin, e.word, e.rewrites, e.compare)
  const v = st.vsCompare!
  const verdict =
    v.kind === 'identical'
      ? st.originEqualsCompareByRewrites
        ? `After ${e.rewrites.length} checked rewrite${e.rewrites.length === 1 ? '' : 's'} the word is identical to the comparison, so ${wordText(e.origin)} and ${wordText(e.compare)} are the same braid (checked by supported rewrite rules).`
        : 'The two words are the same list of crossings, so they are the same braid.'
      : v.kind === 'different'
        ? `They are different braids: their ${v.invariant === 'exponent_sum' ? 'exponent sums' : 'endpoint permutations'} differ, and equal braids always agree on it.`
        : 'Their endpoint permutations and exponent sums agree, but these invariants do not decide equality, so equivalence is not established. Only a sequence of checked rewrites can establish it.'
  const spans: string[] = []
  if (v.kind === 'not_established') {
    for (let at = 0; at < e.word.length; at++) for (const rule of ['braid_relation', 'cancel_pair'] as const) {
      try {
        applyRewrite(e.word, { rule, at, generator: null })
        spans.push(`${rule === 'braid_relation' ? 'the braid relation' : 'an inverse-pair cancellation'} at crossings ${at + 1}–${at + (rule === 'braid_relation' ? 3 : 2)}`)
      } catch {
        /* not applicable here */
      }
    }
  }
  return answer(title, [
    `Computed exactly: the word is ${inv(e.word)}; the comparison is ${inv(e.compare)}.`,
    verdict,
    spans.length ? `Supported rewrites available now: ${spans.join('; ')}.` : null,
  ])
}

const SPAN = { braid_relation: 3, cancel_pair: 2 } as const

/** "Apply the braid relation at crossings 1–3" / "Cancel the inverse pair at crossings 2–3": a checked rewrite
 * at the NAMED span (crossing n is index n - 1), refused when the span does not match the current word. */
function rewriteAt(rule: Exclude<RewriteRule, 'insert_pair'>) {
  return (doc: Doc, prompt?: string): Proposal => {
    const what = rule === 'braid_relation' ? 'Apply the braid relation' : 'Cancel the inverse pair'
    const e = shownBraid(doc)
    if (!e) return answer(what, 'Not applied: no braid is displayed.')
    const m = /crossings ([0-9]+)(?:[–-]| to )([0-9]+)$/.exec(prompt ?? '')
    if (!m) return answer(what, `Not applied: name the crossings, for example "${what} at crossings 1–${SPAN[rule]}".`)
    const first = Number(m[1])
    const last = Number(m[2])
    const title = `${what} at crossings ${first}–${last}`
    if (first < 1 || last - first !== SPAN[rule] - 1) return answer(title, `Not applied: this rule rewrites ${SPAN[rule]} adjacent crossings, so crossings ${first}–${last} cannot be its span.`)
    const at = first - 1
    if (last > e.word.length) return answer(title, `Not applied: the braid ${wordText(e.word)} has only ${e.word.length} crossing${e.word.length === 1 ? '' : 's'}.`)
    const span = e.word.slice(at, at + SPAN[rule])
    let next: Generator[]
    try {
      next = applyRewrite(e.word, { rule, at, generator: null })
    } catch {
      return answer(title, `Not applied: crossings ${first}–${last} of ${wordText(e.word)} are ${wordText(span)}, ${rule === 'braid_relation' ? 'not σ1 σ2 σ1 or σ2 σ1 σ2' : 'not a crossing followed by its inverse'}.`)
    }
    return fromTemplate(doc, prepared(doc, [{ kind: 'rewrite_braid', experimentId: e.id, rule, at, generator: null }]), title,
      `This applies the supported rewrite to crossings ${first}–${last} (${wordText(span)} becomes ${rule === 'braid_relation' ? wordText(next.slice(at, at + 3)) : 'nothing'}); the planner re-checks the span against the current word.`, ['braid'])
  }
}

export const FOUR_FIXTURES: FourFixture[] = [
  // ---- sculpture
  {
    name: 'show-c4',
    example: 'Show C4',
    matches: /^(?:show|open) (?:me )?(?:the )?(?:c ?4|cyclic group(?: of order 4)?)(?: sculpture)?$/,
    build: (doc) => fromTemplate(doc, prepared(doc, sculptureActions(doc)), 'Show C4 as a sculpture', 'This opens the prepared group sculpture (a prepared recipe, not an operation the model invented): C4 acting on its own four elements as beads, with the generator 1 selected.', ['group', 'group_state']),
  },
  {
    name: 'apply-again',
    example: 'Apply this operation again',
    matches: /^(?:apply|use) (?:this|that|the(?: selected)?) operation again$|^(?:apply|do) (?:it|that) again$/,
    build: (doc) => fromTemplate(doc, applyAgainTemplate(doc), 'Apply the operation again', 'This applies the selected operation once more; every bead keeps its identity and moves to its new slot.', ['group_state', 'diagonals']),
  },
  {
    name: 'use-klein-four',
    example: 'Use the same experiment with the Klein four-group',
    matches: /^use (?:the same|this) (?:experiment|recipe|sculpture|representation) (?:with|on|for) (?:the )?klein(?: four)?(?:-| )?group$|^(?:use|show) (?:it|this) (?:with|on|for) (?:the )?klein(?: four)?(?:-| )?group$|^use (?:the same (?:experiment|recipe) )?(?:with|on) v ?4$|^use (?:this|the same) (?:experiment|recipe|sculpture|representation) (?:with|on|for) v ?4$/,
    build: (doc) => fromTemplate(doc, kleinTemplate(doc), 'The same experiment on V4', 'This binds the same saved sculpture recipe to the Klein four-group V4 (componentwise addition mod 2); the rule is unchanged and every permutation, cycle and order is recomputed.', ['group', 'group_state']),
  },
  {
    name: 'element-orders',
    example: "Show each element's order",
    matches: /^show (?:me )?(?:each|every|all(?: the)?) elements?'?s? orders?$|^show (?:me )?the (?:element )?orders$|^what (?:are|is) the orders? of (?:the|each|every) elements?$/,
    build(doc) {
      const facts = computeFacts(doc).filter((f) => f.kind === 'group' && f.refs.includes(doc.selection.experimentId)).map((f) => f.text)
      if (!facts.length) return answer("Each element's order", `No group is displayed. Computed exactly: C4 has ${orderList(C4)}; V4 has ${orderList(V4)}.`)
      return answer("Each element's order", [...facts.map((f) => `${f}.`), 'The order of an element is how many times in a row it must be applied before every bead is back in the slot it started from.'])
    },
  },
  {
    name: 'why-different',
    example: 'Why are these different?',
    matches: /^why are (?:these|they|those|c ?4 and v ?4|the two groups) different$|^how (?:are|do) (?:c ?4 and v ?4|these|they) differ$/,
    build: () => answer('Same size, different structure', `Both groups have four elements, so both sculptures have four beads. Computed exactly: in C4, 1 and 3 each move all four beads in one four-cycle (order 4) and 2 makes two exchanges (order 2); in V4 every non-identity element makes two exchanges (order 2) and none has order 4. No V4 operation carries a bead through all four slots, so the two operations are structured differently. C4: ${orderList(C4)}. V4: ${orderList(V4)}.`),
  },
  // ---- cube and diagonals
  {
    name: 'show-diagonals',
    example: 'Show the four diagonals',
    matches: /^show (?:me )?the (?:four )?(?:body )?diagonals(?: of the cube)?$|^(?:show|open) (?:me )?the cube(?: and its diagonals)?$/,
    build: (doc) => fromTemplate(doc, prepared(doc, cubeActions(doc)), 'The cube and its four diagonals', 'This opens the prepared scene: the cube with its four body-diagonal lines, and four matching objects that follow them.', ['diagonals', 'group_state']),
  },
  {
    name: 'quarter-turn-z',
    example: 'Rotate a quarter turn about z',
    matches: /^rotate (?:it |the cube )?(?:by )?a quarter(?:-| )turn (?:about|around) (?:the )?z(?:-axis| axis)?$|^rotate (?:it |the cube )?(?:by )?90(?: degrees|°)? (?:about|around) (?:the )?z(?:-axis| axis)?$/,
    build: (doc) => fromTemplate(doc, quarterTurnTemplate(doc), 'A quarter turn about z', 'This applies Rz = r(y,-x,z), the quarter turn about z; the diagonal objects move by the permutation it induces, computed from the same element.', ['diagonals', 'group_state']),
  },
  {
    name: 'swap-objects',
    example: 'Swap objects 0 and 1',
    matches: /^swap (?:objects?|diagonals?|lines?|the objects?) ([0-3]) and ([0-3])$/,
    build(doc, prompt) {
      const m = /([0-3]) and ([0-3])$/.exec(prompt ?? '')
      const i = Number(m?.[1] ?? 0)
      const j = Number(m?.[2] ?? 1)
      if (i === j) return answer('Swap two objects', 'Name two different objects (0 to 3).')
      return fromTemplate(doc, swapTemplate(doc, i, j), `Swap objects ${i} and ${j}`, `This applies the unique cube rotation that exchanges the lines of objects ${i} and ${j} and keeps the other two lines; the cube turns with it.`, ['diagonals', 'group_state'])
    },
  },
  {
    name: 'undo-rotation',
    example: 'Undo that rotation',
    matches: /^undo (?:that|the|this|the last) (?:rotation|turn|swap|step)$/,
    build: (doc) => fromTemplate(doc, undoRotationTemplate(doc), 'Undo that rotation', 'This removes the last applied rotation from the history; the cube and the four objects return together.', ['diagonals', 'group_state']),
  },
  // ---- quotient
  {
    name: 'track-face-pairs',
    example: 'Track only the opposite-face pairs',
    matches: /^track only (?:the )?opposite(?:-| )face pairs$|^track only which opposite(?:-| )face pair goes where$|^(?:group|sort) the (?:24 )?rotations by (?:the )?opposite(?:-| )face pairs$|^group (?:the )?(?:24 )?rotations by their action on the unoriented (?:coordinate(?:-| ))?ax(?:es|is lines)$/,
    build: (doc) => fromTemplate(doc, trackPairsTemplate(doc), 'Track only the opposite-face pairs', 'This keeps only which coordinate-axis line (opposite-face pair) goes where and forgets its direction.', ['quotient']),
  },
  {
    name: 'expand-class',
    example: 'Expand this class',
    matches: /^expand (?:this|that|the(?: selected)?) class$|^open (?:this|that) class$/,
    build: (doc) => fromTemplate(doc, expandClassTemplate(doc), 'Expand the class', 'This expands the class to its four rotations.', ['quotient']),
  },
  {
    name: 'another-representative',
    example: 'Choose another representative',
    matches: /^(?:choose|pick|use) (?:another|a different) representative$/,
    build: (doc) => fromTemplate(doc, anotherRepresentativeTemplate(doc), 'Another representative', 'This replaces A by the next rotation in the same class; the class of the composition stays the same.', ['quotient']),
  },
  {
    name: 'compose-these',
    example: 'Compose these two',
    matches: /^compose (?:these|those|the|the chosen) two(?: rotations| classes)?$/,
    build: (doc) => fromTemplate(doc, composeTemplate(doc), 'Compose A, then B', 'This composes the chosen rotations, A, then B: the detailed result is B·A and the class result is its class.', ['quotient']),
  },
  // ---- braids
  {
    name: 'build-sigma121',
    example: 'Build sigma1, sigma2, sigma1',
    matches: /^build (?:sigma ?1,? sigma ?2,? sigma ?1|σ ?1,? ?σ ?2,? ?σ ?1)$/,
    build: (doc) => fromTemplate(doc, buildWordTemplate(doc, [1, 2, 1]), 'Build σ1 σ2 σ1', 'This sets the braid to σ1, then σ2, then σ1 (chronological).', ['braid', 'braid_rewrites']),
  },
  {
    name: 'other-side',
    example: 'Show the other side of the braid relation',
    matches: /^show (?:me )?the other side of the braid relation$/,
    build: (doc) => fromTemplate(doc, otherSideTemplate(doc), 'The other side of the braid relation', 'This shows the relation\'s other side beside the braid. Until a supported rewrite connects them, the invariants alone do not establish equality.', ['braid', 'braid_rewrites']),
  },
  {
    name: 'apply-rewrite',
    example: 'Apply that rewrite',
    matches: /^apply (?:that|the|this) rewrite$|^apply the braid relation$/,
    build: (doc) => fromTemplate(doc, applyRewriteTemplate(doc), 'Apply the rewrite', 'This applies the supported rewrite at its matching span; the application checks the span against the current word.', ['braid', 'braid_rewrites']),
  },
  {
    name: 'double-crossing',
    example: 'Compare two positive crossings with doing nothing',
    matches: /^compare two positive crossings with doing nothing$|^compare (?:a )?double (?:positive )?crossing with (?:doing nothing|the identity(?: braid)?)$/,
    build: (doc) => fromTemplate(doc, doubleCrossingTemplate(doc), 'Two positive crossings versus nothing', 'This shows σ1 σ1 beside the identity braid. Both have the identity endpoint permutation, but the exponent sums differ (2 and 0), so σ1 σ1 is not the identity braid.', ['braid', 'braid_rewrites']),
  },
  {
    name: 'undo-braid',
    example: 'Undo this braid',
    matches: /^undo (?:this|the) braid$/,
    build: (doc) => fromTemplate(doc, undoBraidTemplate(doc), 'Undo the braid with its inverse', 'This follows the braid by its inverse (reversed, every crossing flipped) and shows it beside doing nothing; the adjacent inverse pairs can then be cancelled one supported rewrite at a time.', ['braid', 'braid_rewrites']),
  },
  {
    name: 'show-braids',
    example: 'Show the braids',
    matches: /^(?:show|open) (?:me )?(?:the )?braids?(?: workspace| demo)?$/,
    build: (doc) => fromTemplate(doc, prepared(doc, braidActions(doc)), 'Three-strand braids', 'This opens the prepared braid workspace with σ1 σ2 σ1 beside σ2 σ1 σ2.', ['braid', 'braid_rewrites']),
  },
  // ---- UI suggestion fixtures (Ask Meta Muse AI, UI-REFINEMENT-SPEC section 7)
  { name: 'apply-named', example: 'Apply +1 again', matches: APPLY_NAMED, build: applyNamed },
  {
    name: 'use-on-c4',
    example: 'Use this representation on C₄',
    matches: /^use (?:this|the same) (?:experiment|recipe|sculpture|representation) (?:with|on|for) (?:c ?4|the cyclic group(?: of order 4)?)$/,
    build: useOnC4,
  },
  { name: 'explain-cycle', example: 'Explain this cycle', matches: /^explain (?:this|that|the(?: selected)?) cycles?$|^explain the cycles? of (?:this|that|the(?: selected)?) operation$/, build: explainCycle },
  { name: 'explain-diagonals', example: 'Explain how the diagonals were rearranged', matches: /^explain how the (?:four )?(?:body )?diagonals (?:were|are|have been|got) (?:rearranged|permuted|moved)$/, build: explainDiagonals },
  { name: 'why-six-classes', example: 'Why are there six classes?', matches: /^why (?:are there|do we get|is it) (?:six|6) classes$/, build: whySixClasses },
  { name: 'explain-comparison', example: 'Explain this comparison', matches: /^explain (?:this|the) (?:braid )?comparison$/, build: explainComparison },
  { name: 'braid-relation-at', example: 'Apply the braid relation at crossings 1–3', matches: /^apply the braid relation at crossings [0-9]+(?:[–-]| to )[0-9]+$/, build: rewriteAt('braid_relation') },
  { name: 'cancel-pair-at', example: 'Cancel the inverse pair at crossings 1–2', matches: /^cancel the inverse pair at crossings [0-9]+(?:[–-]| to )[0-9]+$/, build: rewriteAt('cancel_pair') },
]
