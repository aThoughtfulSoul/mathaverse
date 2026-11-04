// Live cases for the sculpture (C₄ / V₄ acting on beads), the cube (rotations acting on the four body diagonals)
// and the quotient (24 rotations in six classes by their action on the unoriented axes): every UI-REFINEMENT-SPEC
// section 7 suggestion of these experiments, on a document where the UI offers it, with its exact text.
// Assertions check the meaning of an answer, computed exactly from the committed document (src/algebra), so a
// live model may reach it with different valid actions (an extra selection, apply_permutation instead of
// apply_element); they never compare action lists.

import { expect } from 'vitest'
import { type Doc, type GroupExperiment, demoDocument, findGroup, findGroupExperiment, groupFor } from '../../../src/workspace/document'
import { planTransaction } from '../../../src/workspace/reducer'
import { chronologicalProduct, groupOf } from '../../../src/algebra/groups'
import { compose, transposition } from '../../../src/algebra/permutation'
import { classKey, phiOf } from '../../../src/algebra/cube'
import { FOUR_IDS, RZ90, cubeActions, quotientActions, sculptureActions, sculptureRebindActions } from '../../../src/demo/four'
import { demoOf } from '../../../src/demo/order'
import { suggestionsFor } from '../../../src/ui/assistant/suggestions'
import { CAP, panelInput } from '../../ui/assistant/helpers'
import { type LiveCase, type LiveResult, noMathChange } from '../liveKit'

const G = groupOf({ kind: 'cube_rotations' })
/** The quarter turn about x (x fixed, y -> z): B in the compose fixtures. */
const RX90 = 'r(x,z,-y)'

// ------------------------------------------------------------------ documents (built with the prepared actions)

const plan = (doc: Doc, actions: unknown[]): Doc => planTransaction(doc, actions).doc
const apply = (experimentId: string, element: string) => ({ kind: 'apply_element', experimentId, element })
const select = (experimentId: string, item: string | null) => ({ kind: 'select_item', experimentId, item })

/** C₄ sculpture as opened: +1 selected, nothing applied. UI: "Apply +1", "Use this representation on V₄", "Explain this cycle". */
const c4Doc = (): Doc => plan(demoDocument(), sculptureActions(demoDocument()))
/** C₄ after +1 was applied once, +1 still selected. UI: "Apply +1 again", ... */
const c4AppliedDoc = (): Doc => plan(c4Doc(), [apply(FOUR_IDS.expC4, 'c1')])
/** C₄ after +1 was applied once, then the +2 card selected. UI: "Apply +2", ... */
const c4Select2Doc = (): Doc => plan(c4AppliedDoc(), [select(FOUR_IDS.expC4, 'c2')])
/** V₄ made from C₄ (C₄ has +1 applied), then (1,0) applied on V₄. UI: "Apply (1,0) again", "Use this representation on C₄", ... */
const v4Doc = (): Doc => {
  const c4 = c4AppliedDoc()
  const v4 = plan(c4, sculptureRebindActions(c4, findGroupExperiment(c4, FOUR_IDS.expC4)))
  return plan(v4, [apply(FOUR_IDS.expV4, 'v10')])
}
/** The cube as opened (identity). UI: "Rotate the cube 90 degrees about z", "Swap objects 0 and 1". */
const cubeDoc = (): Doc => plan(demoDocument(), cubeActions(demoDocument()))
/** The cube after Rz: objects 0..3 now lie on lines phi(Rz) = [1,3,0,2]. UI adds "Explain how the diagonals were rearranged". */
const cubeRotatedDoc = (): Doc => plan(cubeDoc(), [apply(FOUR_IDS.expCube, RZ90)])
/** The 24 rotations, not grouped. UI: "Group rotations by their action on the unoriented axes", "Why are there six classes?". */
const quotientDoc = (): Doc => plan(demoDocument(), quotientActions(demoDocument()))
/** Grouped, nothing chosen or selected. UI: only "Why are there six classes?". */
const groupedDoc = (): Doc => plan(quotientDoc(), [{ kind: 'set_observation', experimentId: FOUR_IDS.expQuotient, observation: 'unoriented_axis_lines' }])
/** Grouped, A = Rz chosen and Rx selected (B not set). UI: "Compose these two", "Why are there six classes?", "Expand this class". */
const composeDoc = (): Doc => plan(groupedDoc(), [{ kind: 'set_operands', experimentId: FOUR_IDS.expQuotient, operands: [RZ90, null] }, select(FOUR_IDS.expQuotient, RX90)])
/** Grouped, Rz selected, nothing chosen. UI: "Why are there six classes?", "Expand this class", "Choose another representative". */
const expandDoc = (): Doc => plan(groupedDoc(), [select(FOUR_IDS.expQuotient, RZ90)])
/** Grouped, A = Rz, B = Rx, A's class expanded. UI: "Compose these two", "Why are there six classes?", "Choose another representative". */
const anotherRepDoc = (): Doc =>
  plan(groupedDoc(), [{ kind: 'set_operands', experimentId: FOUR_IDS.expQuotient, operands: [RZ90, RX90] }, select(FOUR_IDS.expQuotient, `class:${classKey(RZ90)}`)])

// ------------------------------------------------------------------ exact readings of a committed document

const exp = (doc: Doc, id: string): GroupExperiment => findGroupExperiment(doc, id)
const shownId = (doc: Doc) => doc.selection.experimentId
const accumulated = (doc: Doc, id: string) => {
  const e = exp(doc, id)
  return chronologicalProduct(groupFor(doc, e), e.history.map((h) => h.element))
}
const json = (x: unknown) => JSON.stringify(x)

/** The steps appended to an experiment's history; the earlier history must be kept as it was (no reset, no undo). */
function newSteps({ before, after }: LiveResult, id: string): string[] {
  const b = exp(before, id).history.map((h) => h.element)
  const a = exp(after, id).history.map((h) => h.element)
  expect(a.slice(0, b.length), `${id}: the earlier history was changed`).toEqual(b)
  return a.slice(b.length)
}

/** Every experiment, group and recipe of `before` other than `changed` is exactly as it was. */
function othersUnchanged({ before, after }: LiveResult, changed: string[] = []) {
  for (const e of before.experiments) if (!changed.includes(e.id)) expect(json(after.experiments.find((x) => x.id === e.id)), `${e.id} changed`).toBe(json(e))
  for (const g of before.groups) expect(json(after.groups.find((x) => x.id === g.id)), `group ${g.id} changed`).toBe(json(g))
  for (const r of before.recipes) expect(json(after.recipes.find((x) => x.id === r.id)), `recipe ${r.id} changed`).toBe(json(r))
}

const nothingCreated = ({ before, after }: LiveResult) => expect(after.experiments.map((e) => e.id), 'an experiment was created or removed').toEqual(before.experiments.map((e) => e.id))

/** `id` still shows the same demonstration: re-binding it to a recipe with another layout (the cube shown as the
 *  quotient classes, say) is not a math change, but the learner no longer sees what they asked about. Re-binding
 *  the same recipe, or a copy with the same layout, keeps it. */
function sameDemo({ before, after }: LiveResult, id: string) {
  expect(demoOf(after, exp(after, id)), `${id} no longer shows the same demonstration`).toBe(demoOf(before, exp(before, id)))
}

/** Exactly one operation applied to `id`, and it is `element` (by element or through the diagonal lines). */
function appliedOnce(r: LiveResult, id: string, element: string, name: string) {
  expect(shownId(r.after), `${id} is no longer displayed`).toBe(id)
  expect(newSteps(r, id), `not exactly one application of ${name}`).toEqual([element])
  sameDemo(r, id)
  othersUnchanged(r, [id])
  nothingCreated(r)
}

/** An answer-only request: no mathematical change, the same experiment displayed as the same demonstration, a
 *  non-empty explanation. */
function answerOnly(r: LiveResult, id: string) {
  noMathChange(r)
  expect(shownId(r.after), `${id} is no longer displayed`).toBe(id)
  sameDemo(r, id)
  expect(r.j.proposal.explanation.trim().length).toBeGreaterThan(0)
}

/** The quotient view keeps its demonstration, grouping and history (and its operands unless the request changes them). */
function quotientKept(r: LiveResult, { operands = true } = {}) {
  const b = exp(r.before, FOUR_IDS.expQuotient)
  const a = exp(r.after, FOUR_IDS.expQuotient)
  expect(shownId(r.after), 'the quotient is no longer displayed').toBe(FOUR_IDS.expQuotient)
  sameDemo(r, FOUR_IDS.expQuotient)
  expect(a.observation, 'the grouping by axis lines was changed').toBe(b.observation)
  expect(a.history).toEqual(b.history)
  if (operands) expect(a.operands, 'A and B were changed').toEqual(b.operands)
  othersUnchanged(r, [FOUR_IDS.expQuotient])
  nothingCreated(r)
}

/** Guard on the case itself: the UI (live phrasing) offers exactly this prompt on the case's document. */
function offered(doc: Doc, prompt: string) {
  const texts = suggestionsFor(panelInput(doc, { capability: { assistant: CAP.liveVerified, speech: null } })).map((s) => s.text)
  expect(texts, `case is stale: the UI does not offer "${prompt}" on this document`).toContain(prompt)
}

// ------------------------------------------------------------------ cases

const CASES: LiveCase[] = [
  // ---- sculpture
  {
    name: 'sculpture: "Apply +1 again" (C₄, +1 applied and selected) applies +1 once more, accumulated 2',
    prompt: 'Apply +1 again',
    doc: c4AppliedDoc,
    check: (r) => {
      appliedOnce(r, FOUR_IDS.expC4, 'c1', '+1')
      expect(accumulated(r.after, FOUR_IDS.expC4)).toBe('c2')
    },
  },
  {
    name: 'sculpture: "Apply +2" (C₄, +1 applied, +2 selected) applies the selected +2, not the last +1',
    prompt: 'Apply +2',
    doc: c4Select2Doc,
    check: (r) => {
      appliedOnce(r, FOUR_IDS.expC4, 'c2', '+2')
      expect(accumulated(r.after, FOUR_IDS.expC4)).toBe('c3')
    },
  },
  {
    // The one apply suggestion whose label (the pair (1,0)) the model must map to an element ID: v10, not v01.
    name: 'sculpture: "Apply (1,0) again" (V₄, (1,0) applied and selected) applies (1,0) once more, accumulated (0,0)',
    prompt: 'Apply (1,0) again',
    doc: v4Doc,
    check: (r) => {
      appliedOnce(r, FOUR_IDS.expV4, 'v10', '(1,0)')
      expect(accumulated(r.after, FOUR_IDS.expV4)).toBe('v00')
    },
    wrong: () => [apply(FOUR_IDS.expV4, 'v01')],
  },
  {
    name: 'sculpture: "Use this representation on V₄" shows V₄ bound to the same saved recipe; C₄ unchanged',
    prompt: 'Use this representation on V₄',
    doc: c4Doc,
    check: (r) => {
      const { before, after } = r
      const id = shownId(after)
      expect(id, 'C₄ is still displayed').not.toBe(FOUR_IDS.expC4)
      const e = exp(after, id)
      expect(findGroup(after, e.groupId).definition.kind, 'the displayed group is not V₄').toBe('klein_four')
      expect(e.binding?.recipeId, 'not the same saved recipe').toBe(exp(before, FOUR_IDS.expC4).binding!.recipeId)
      expect(e.binding!.ports.group, 'the recipe is not bound to the V₄ group').toBe(e.groupId)
      expect(demoOf(after, e)).toBe('sculpture')
      // Reusing the representation applies nothing (selecting or playing an operation is fine).
      expect(e.history.map((h) => h.element), 'V₄ has applied steps the request did not ask for').toEqual([])
      othersUnchanged(r)
    },
  },
  {
    name: 'sculpture: "Use this representation on C₄" (from V₄) shows the existing C₄ again; both histories kept, nothing created',
    prompt: 'Use this representation on C₄',
    doc: v4Doc,
    check: (r) => {
      const { before, after } = r
      expect(shownId(after), 'C₄ is not displayed').toBe(FOUR_IDS.expC4)
      expect(exp(after, FOUR_IDS.expC4).binding?.recipeId, 'C₄ does not show the same saved recipe').toBe(exp(before, FOUR_IDS.expV4).binding!.recipeId)
      expect(exp(after, FOUR_IDS.expC4).history, 'C₄ history changed').toEqual(exp(before, FOUR_IDS.expC4).history)
      othersUnchanged(r, [FOUR_IDS.expC4])
      nothingCreated(r)
    },
  },
  {
    name: 'sculpture: "Explain this cycle" (C₄, +1 selected) explains without changing the mathematics; +1 stays selected',
    prompt: 'Explain this cycle',
    doc: c4Doc,
    check: (r) => {
      answerOnly(r, FOUR_IDS.expC4)
      expect(r.after.selection.item, 'the explained operation is no longer selected').toBe(r.before.selection.item)
    },
    wrong: () => [apply(FOUR_IDS.expC4, 'c1')],
  },
  // ---- cube and diagonals
  {
    name: 'cube: "Rotate the cube 90 degrees about z" applies the positive quarter turn Rz = r(y,-x,z) once',
    prompt: 'Rotate the cube 90 degrees about z',
    doc: cubeDoc,
    check: (r) => {
      appliedOnce(r, FOUR_IDS.expCube, RZ90, 'Rz')
      expect(phiOf(accumulated(r.after, FOUR_IDS.expCube))).toEqual([1, 3, 0, 2])
    },
  },
  {
    name: 'cube: "Explain how the diagonals were rearranged" (after Rz) explains without changing the rotation',
    prompt: 'Explain how the diagonals were rearranged',
    doc: cubeRotatedDoc,
    check: (r) => answerOnly(r, FOUR_IDS.expCube),
    wrong: () => [{ kind: 'undo_step', experimentId: FOUR_IDS.expCube }],
  },
  {
    name: 'cube: "Swap objects 0 and 1" (after Rz) exchanges the lines of objects 0 and 1; objects 2 and 3 stay',
    prompt: 'Swap objects 0 and 1',
    doc: cubeRotatedDoc,
    check: (r) => {
      const id = FOUR_IDS.expCube
      expect(shownId(r.after)).toBe(id)
      expect(newSteps(r, id), 'not exactly one rotation').toHaveLength(1)
      // Object i lies on line phi(k)[i]; after the swap objects 0 and 1 trade lines: phi(k') = phi(k) ∘ (0 1).
      const was = phiOf(accumulated(r.before, id))
      expect(phiOf(accumulated(r.after, id)), `objects 0..3 were on lines ${json(was)}`).toEqual(compose(was, transposition(4, 0, 1)))
      sameDemo(r, id)
      othersUnchanged(r, [id])
      nothingCreated(r)
    },
  },
  // ---- quotient
  {
    name: 'quotient: "Group rotations by their action on the unoriented axes" groups the 24 rotations by axis lines',
    prompt: 'Group rotations by their action on the unoriented axes',
    doc: quotientDoc,
    check: (r) => {
      const b = exp(r.before, FOUR_IDS.expQuotient)
      const a = exp(r.after, FOUR_IDS.expQuotient)
      expect(shownId(r.after)).toBe(FOUR_IDS.expQuotient)
      sameDemo(r, FOUR_IDS.expQuotient)
      expect(a.observation, 'not grouped by the unoriented axis lines').toBe('unoriented_axis_lines')
      expect(a.history).toEqual(b.history)
      expect(a.operands).toEqual(b.operands)
      othersUnchanged(r, [FOUR_IDS.expQuotient])
      nothingCreated(r)
    },
  },
  {
    name: 'quotient: "Compose these two" (A = Rz, Rx selected) composes A, then B = Rx: the class of Rx·Rz',
    prompt: 'Compose these two',
    doc: composeDoc,
    check: (r) => {
      quotientKept(r, { operands: false })
      const [A, B] = exp(r.after, FOUR_IDS.expQuotient).operands
      expect([A, B], 'A, then B is not Rz, then Rx').toEqual([RZ90, RX90])
      // A, then B = B·A; the view shows its class (A·B, the other order, is a different class here).
      const composite = classKey(G.multiply(RX90, RZ90))
      expect(composite).not.toBe(classKey(G.multiply(RZ90, RX90)))
      const item = r.after.selection.item
      if (item?.startsWith('class:')) expect(item.slice(6), 'the selected class is not the class of B·A').toBe(composite)
      else if (item && G.has(item) && item !== A && item !== B) expect(classKey(item), 'the selected rotation is not in the class of B·A').toBe(composite)
    },
  },
  {
    name: 'quotient: "Why are there six classes?" (grouped) explains without changing the rotations, grouping or A/B',
    prompt: 'Why are there six classes?',
    doc: groupedDoc,
    check: (r) => {
      answerOnly(r, FOUR_IDS.expQuotient)
      quotientKept(r)
    },
    wrong: () => [apply(FOUR_IDS.expQuotient, RZ90)],
  },
  {
    name: 'quotient: "Expand this class" (grouped, Rz selected) selects the class of Rz, [1,0,2]',
    prompt: 'Expand this class',
    doc: expandDoc,
    check: (r) => {
      quotientKept(r)
      expect(r.after.selection.item, 'the class of Rz is not the selection').toBe(`class:${classKey(RZ90)}`)
    },
  },
  {
    name: 'quotient: "Choose another representative" (A = Rz, B = Rx) puts another member of A\'s class as A; B and the class of B·A kept',
    prompt: 'Choose another representative',
    doc: anotherRepDoc,
    check: (r) => {
      quotientKept(r, { operands: false })
      const [A0, B0] = exp(r.before, FOUR_IDS.expQuotient).operands as [string, string]
      const [A, B] = exp(r.after, FOUR_IDS.expQuotient).operands
      expect(A, 'A was removed').not.toBeNull()
      expect(A, 'A was not replaced').not.toBe(A0)
      expect(classKey(A!), 'the new A is not in the class of the old A').toBe(classKey(A0))
      expect(B, 'B was changed').toBe(B0)
      expect(classKey(G.multiply(B!, A!)), 'the class of B·A changed').toBe(classKey(G.multiply(B0, A0)))
    },
  },
]

/** Each check first confirms that the UI offers the case's prompt on the document it is asked on. */
export const GROUP_CASES: LiveCase[] = CASES.map((c) => ({
  ...c,
  check: (r: LiveResult) => {
    offered(r.before, c.prompt)
    c.check(r)
  },
}))
