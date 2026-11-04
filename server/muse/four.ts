// Server-computed, validated action templates for the four algebra demonstrations (FOUR-DEMOS-PARALLEL-
// HANDOFF section 10). The prompt offers them as PREPARED templates and the synthetic fixtures use the same
// ones, so a prepared scene, a live proposal and a fixture take one validated path. References such as "this
// operation", "these two" or "that rewrite" are resolved from the displayed experiment's state; when the state
// does not decide them, the template is unavailable with the reason (the model then asks a brief question).
// Every template is planned on a temporary copy of the document before it is offered.

import { type Doc, type GroupExperiment, type BraidExperiment, findAnyExperiment, findGroup, groupFor } from '../../src/workspace/document'
import { chronologicalProduct } from '../../src/algebra/groups'
import { transposition } from '../../src/algebra/permutation'
import { classKey, phiOf, axisClasses } from '../../src/algebra/cube'
import { type Generator, applyRewrite, invertWord, wordEq } from '../../src/algebra/braid'
import { demoOf, experimentFor } from '../../src/demo/order'
import { FOUR_IDS, RZ90, braidActions, cubeActions, quotientActions, sculptureActions, sculptureRebindActions } from '../../src/demo/four'
import { type Prepared, prepared } from './order'

const unavailable = (why: string): Prepared => ({ unavailable: why })

function displayedGroup(doc: Doc, kind: 'sculpture' | 'cube' | 'quotient'): GroupExperiment | null {
  const e = findAnyExperiment(doc, doc.selection.experimentId)
  return e.domain === 'group' && demoOf(doc, e) === kind ? e : null
}

function displayedBraid(doc: Doc): BraidExperiment | null {
  const e = findAnyExperiment(doc, doc.selection.experimentId)
  return e.domain === 'braid' ? e : null
}

/** The sculpture experiment to act on: the displayed one, else none (the template then opens it first). */
function sculpture(doc: Doc) {
  return displayedGroup(doc, 'sculpture')
}

/** "Apply this operation again": the selected operation card, else the last applied element. */
export function applyAgainTemplate(doc: Doc): Prepared {
  const e = sculpture(doc) ?? displayedGroup(doc, 'cube')
  if (!e) return unavailable('no sculpture or cube is displayed, so "this operation" names nothing')
  const g = groupFor(doc, e)
  const item = doc.selection.item
  const op = item && g.has(item) ? item : e.history[e.history.length - 1]?.element ?? null
  if (!op) return unavailable('no operation is selected and none has been applied yet; ask which element to apply')
  return prepared(doc, [{ kind: 'apply_element', experimentId: e.id, element: op }])
}

/** "Use the same experiment with the Klein four-group": the SAME saved recipe bound to V4. */
export function kleinTemplate(doc: Doc): Prepared {
  const shown = sculpture(doc)
  if (shown && findGroup(doc, shown.groupId).definition.kind === 'klein_four') return unavailable('the Klein four-group is already displayed')
  if (shown) return prepared(doc, sculptureRebindActions(doc, shown))
  const v4 = doc.experiments.find((x) => x.id === FOUR_IDS.expV4)
  if (v4) return prepared(doc, [{ kind: 'select_item', experimentId: v4.id, item: 'v10' }])
  // Open C4 first, then rebind its recipe to V4 in one transaction is more than one experiment's state;
  // offer opening the sculpture on C4 instead.
  return unavailable('open the C4 sculpture first ("Show C4"), then use the same recipe on the Klein four-group')
}

/** "Swap objects i and j": the transposition of the lines the two objects occupy now, resolved to its rotation. */
export function swapTemplate(doc: Doc, i: number, j: number): Prepared {
  const e = displayedGroup(doc, 'cube')
  if (!e) return unavailable('the cube and its diagonal objects are not displayed')
  const k = chronologicalProduct(groupFor(doc, e), e.history.map((h) => h.element))
  const p = phiOf(k)
  return prepared(doc, [{ kind: 'apply_permutation', experimentId: e.id, representation: 'diagonal_lines', permutation: [...transposition(4, p[i]!, p[j]!)] }])
}

/** "Rotate a quarter turn about z" on the displayed cube (opening it first when needed). */
export function quarterTurnTemplate(doc: Doc): Prepared {
  const e = displayedGroup(doc, 'cube')
  if (e) return prepared(doc, [{ kind: 'apply_element', experimentId: e.id, element: RZ90 }])
  const open = cubeActions(doc)
  const id = experimentFor(doc, 'cube')?.id ?? '$cube'
  return prepared(doc, [...open, { kind: 'apply_element', experimentId: id, element: RZ90 }])
}

/** "Undo that rotation": remove the last applied step (a validated action; Undo stays available too). */
export function undoRotationTemplate(doc: Doc): Prepared {
  const e = displayedGroup(doc, 'cube') ?? sculpture(doc)
  if (!e) return unavailable('no cube is displayed')
  if (!e.history.length) return unavailable('nothing has been rotated yet')
  return prepared(doc, [{ kind: 'undo_step', experimentId: e.id }])
}

/** "Track only the opposite-face pairs": the quotient view grouped by the axis-line observation. */
export function trackPairsTemplate(doc: Doc): Prepared {
  const e = displayedGroup(doc, 'quotient')
  if (e) return prepared(doc, [{ kind: 'set_observation', experimentId: e.id, observation: 'unoriented_axis_lines' }])
  const open = quotientActions(doc)
  const id = experimentFor(doc, 'quotient')?.id ?? '$quotient'
  return prepared(doc, [...open, { kind: 'set_observation', experimentId: id, observation: 'unoriented_axis_lines' }])
}

/** "Expand this class": the selected class, or the class of the selected rotation or of A. */
export function expandClassTemplate(doc: Doc): Prepared {
  const e = displayedGroup(doc, 'quotient')
  if (!e) return unavailable('the 24-rotation constellation is not displayed')
  const item = doc.selection.item
  const g = groupFor(doc, e)
  const key = item?.startsWith('class:') ? item.slice(6) : item && g.has(item) ? classKey(item) : e.operands[0] ? classKey(e.operands[0]) : null
  if (!key) return unavailable('no class or rotation is selected; ask which class to expand')
  return prepared(doc, [
    ...(e.observation === 'none' ? [{ kind: 'set_observation', experimentId: e.id, observation: 'unoriented_axis_lines' }] : []),
    { kind: 'select_item', experimentId: e.id, item: `class:${key}` },
  ])
}

/** "Choose another representative": the next member of A's class (or of the selected class) as A. */
export function anotherRepresentativeTemplate(doc: Doc): Prepared {
  const e = displayedGroup(doc, 'quotient')
  if (!e) return unavailable('the 24-rotation constellation is not displayed')
  const [A, B] = e.operands
  const item = doc.selection.item
  const g = groupFor(doc, e)
  const current = A ?? (item && g.has(item) ? item : null)
  if (!current) return unavailable('no representative is chosen yet; ask which class to use')
  const cls = axisClasses().find((c) => c.key === classKey(current))!
  const next = cls.elements[(cls.elements.indexOf(current) + 1) % cls.elements.length]!
  return prepared(doc, [{ kind: 'set_operands', experimentId: e.id, operands: [next, B] }])
}

/** "Compose these two": A and B chosen (or the selection completes them); the scene shows both products. */
export function composeTemplate(doc: Doc): Prepared {
  const e = displayedGroup(doc, 'quotient') ?? displayedGroup(doc, 'cube')
  if (!e) return unavailable('no rotation group is displayed')
  const [A, B] = e.operands
  const item = doc.selection.item
  const g = groupFor(doc, e)
  const sel = item && g.has(item) ? item : null
  if (A && B) return prepared(doc, [{ kind: 'set_operands', experimentId: e.id, operands: [A, B] }])
  if (A && sel && sel !== A) return prepared(doc, [{ kind: 'set_operands', experimentId: e.id, operands: [A, sel] }])
  return unavailable('choose two rotations (A, then B) first; "these two" names nothing yet')
}

/** "Build sigma1, sigma2, sigma1" (or another word) as the main braid. */
export function buildWordTemplate(doc: Doc, word: Generator[]): Prepared {
  const e = displayedBraid(doc)
  if (e) return prepared(doc, [{ kind: 'set_braid', experimentId: e.id, target: 'word', word }])
  const open = braidActions(doc)
  const id = experimentFor(doc, 'braid')?.id ?? '$braid'
  return prepared(doc, [...open, { kind: 'set_braid', experimentId: id, target: 'word', word }])
}

/** "Show the other side of the braid relation": the comparison word becomes the relation's other side. */
export function otherSideTemplate(doc: Doc): Prepared {
  const e = displayedBraid(doc)
  if (!e) return unavailable('no braid is displayed')
  const other = wordEq(e.word, [1, 2, 1]) ? [2, 1, 2] : wordEq(e.word, [2, 1, 2]) ? [1, 2, 1] : null
  if (!other) return unavailable('the braid is not σ1σ2σ1 or σ2σ1σ2, so the relation has no other side here')
  return prepared(doc, [{ kind: 'set_braid', experimentId: e.id, target: 'compare', word: other }])
}

/** "Apply that rewrite": the braid relation at its first matching span, else the first inverse pair. */
export function applyRewriteTemplate(doc: Doc): Prepared {
  const e = displayedBraid(doc)
  if (!e) return unavailable('no braid is displayed')
  const item = doc.selection.item
  const at0 = item?.startsWith('crossing:') ? Number(item.slice(9)) : null
  const tryAt = (rule: 'braid_relation' | 'cancel_pair', at: number) => {
    try {
      applyRewrite(e.word, { rule, at, generator: null })
      return true
    } catch {
      return false
    }
  }
  const positions = at0 !== null ? [at0] : Array.from({ length: e.word.length }, (_, i) => i)
  for (const rule of ['braid_relation', 'cancel_pair'] as const) for (const at of positions) if (tryAt(rule, at)) return prepared(doc, [{ kind: 'rewrite_braid', experimentId: e.id, rule, at, generator: null }])
  return unavailable('no supported rewrite matches the braid here')
}

/** "Compare two positive crossings with doing nothing": σ1 σ1 beside the identity braid. */
export function doubleCrossingTemplate(doc: Doc): Prepared {
  const e = displayedBraid(doc)
  const id = e?.id ?? experimentFor(doc, 'braid')?.id ?? '$braid'
  return prepared(doc, [...(e ? [] : braidActions(doc)), { kind: 'set_braid', experimentId: id, target: 'word', word: [1, 1] }, { kind: 'set_braid', experimentId: id, target: 'compare', word: [] }])
}

/** "Undo this braid": follow it by its inverse (reversed, flipped) and compare with doing nothing. */
export function undoBraidTemplate(doc: Doc): Prepared {
  const e = displayedBraid(doc)
  if (!e) return unavailable('no braid is displayed')
  if (!e.word.length) return unavailable('the braid is already the identity')
  if (e.word.length * 2 > 24) return unavailable('the braid followed by its inverse would exceed 24 crossings')
  return prepared(doc, [{ kind: 'set_braid', experimentId: e.id, target: 'word', word: [...e.word, ...invertWord(e.word)] }, { kind: 'set_braid', experimentId: e.id, target: 'compare', word: [] }])
}

/** Everything the prompt offers for the four demonstrations on this document. */
export function fourTemplates(doc: Doc) {
  return {
    showSculptureC4: prepared(doc, sculptureActions(doc)),
    applyAgain: applyAgainTemplate(doc),
    useKleinFour: kleinTemplate(doc),
    showCube: prepared(doc, cubeActions(doc)),
    quarterTurnZ: quarterTurnTemplate(doc),
    swapObjects01: swapTemplate(doc, 0, 1),
    undoRotation: undoRotationTemplate(doc),
    showQuotient: prepared(doc, quotientActions(doc)),
    trackOppositeFacePairs: trackPairsTemplate(doc),
    expandClass: expandClassTemplate(doc),
    anotherRepresentative: anotherRepresentativeTemplate(doc),
    composeChosen: composeTemplate(doc),
    showBraids: prepared(doc, braidActions(doc)),
    buildSigma121: buildWordTemplate(doc, [1, 2, 1]),
    otherSideOfRelation: otherSideTemplate(doc),
    applyRewrite: applyRewriteTemplate(doc),
    doubleCrossingVsNothing: doubleCrossingTemplate(doc),
    undoBraid: undoBraidTemplate(doc),
  }
}
