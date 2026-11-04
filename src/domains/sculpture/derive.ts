// Kinetic group sculpture: the exact derivation (FOUR-DEMOS-PARALLEL-HANDOFF sections 4, 5; docs/INTERFACES.md).
//
// The left regular action of a finite group G on itself, shown as one persistent bead per element on a ring of
// |G| slots. Slot i is the home of bead elements[i] (canonical order). Bead x never changes identity; after the
// accumulated element k (applying g, then h gives h·g) it sits in the slot of k·x. Applying g moves the bead in
// slot s to slot g·s, so a step's motion assignments are exactly the cycles of regularPermutation(G, g).
//
// Everything here is computed from the group's multiplication: no branch on a group name supplies a permutation,
// a cycle or an order. The result is plain JSON data (no three.js, no time), deterministic in the input.
//
// Pure module: no rendering imports, usable from Node tests and the browser.

import { chronologicalProduct, definitionKey, regularPermutation, type ElementLabel, type FiniteGroup, type GroupDefinition } from '../../algebra/groups'
import { cycles, cycleText, cycleType, permOrder, type Perm } from '../../algebra/permutation'
import { DOMAIN_LIMITS, type GroupOperation, type GroupSceneInput, type GroupStep } from '../inputs'

export class SculptureError extends Error {
  override name = 'SculptureError'
}

/** One bead: identity is its element and never changes; `slot` is where it is now (index of k·x). */
export interface SculptureBead {
  element: string
  /** Index of the element in canonical order: its identity colour, shape and home slot. */
  index: number
  label: ElementLabel
  slot: number
  home: boolean
}

/** One slot of the arrangement: slot i is the home of bead elements[i]. */
export interface SculptureSlot {
  index: number
  home: string
}

/** One bead's motion in a step: from slot `from` to slot `to` along cycle `cycle` (length 1 = stays). */
export interface SculptureMove {
  bead: string
  beadIndex: number
  from: number
  to: number
  /** Index into the step's `cycles`. */
  cycle: number
  cycleLength: number
}

/** One applied operation of the history, with everything a scene needs to animate it. */
export interface SculptureStep {
  /** 0-based position in the history. */
  index: number
  element: string
  label: ElementLabel
  via: GroupStep['via']
  /** The regular action of `element` on slots: permutation[s] = slot of element·(slot element s). */
  permutation: number[]
  /** Its disjoint cycles, fixed points included (each from its smallest slot). */
  cycles: number[][]
  cycleText: string
  /** Accumulated element before and after this step (after = element·before). */
  before: string
  after: string
  /** Slot of each bead (by bead index) before and after. */
  slotsBefore: number[]
  slotsAfter: number[]
  /** One entry per bead, in bead index order. */
  moves: SculptureMove[]
}

/** The displayed state after `steps` operations of the history (0 = home, before anything). */
export interface SculptureMoment {
  steps: number
  accumulated: string
  accumulatedLabel: ElementLabel
  atHome: boolean
  /** Slot of each bead, by bead index. */
  slots: number[]
  /** Chronological words of the history so far ("1, then 1, then 1"); '' when empty. */
  historyText: string
  /** One plain status line for this moment. */
  status: string
  /** The short in-scene line: "every bead is home" / "one more returns every bead home". */
  homeLine: string
}

/** One operation card: an element, its order and the cycle notation of its regular action on slots. */
export interface SculptureCard {
  element: string
  index: number
  label: ElementLabel
  order: number
  permutation: number[]
  /** All cycles, fixed points included. */
  cycles: number[][]
  /** Cycle notation on slot indices, fixed points omitted ("(0 1 2 3)", "(0 2)(1 3)", "()"). */
  cycleText: string
  /** The same for TeX ("(0\,1\,2\,3)"). */
  cycleTex: string
  cycleType: number[]
  identity: boolean
  /** Order equals |G|: repeating this card alone visits every slot with every bead. */
  generates: boolean
  selected: boolean
}

export interface SculptureOrders {
  /** Element orders in canonical element order. */
  list: number[]
  maxOrder: number
  /** Elements whose order is |G| (the group is cyclic exactly when this is non-empty). */
  generators: string[]
  cyclic: boolean
  /** "orders 1, 4, 2, 4" */
  summary: string
  /** "two elements of order 4: each one cycles all four beads" / "no element of order 4: ..." */
  contrast: string
  /** The same in two short lines for scene text. */
  contrastLines: [string, string]
  /** The general point, phrased without naming any group. */
  explanation: string
}

export interface SculptureDesc {
  layout: 'sculpture'
  experimentId: string
  revision: number
  mathRevision: number
  groupId: string
  /** definitionKey of the group ("cyclic:4", "klein_four"): a change means new beads, slots and cards. */
  groupKey: string
  definition: GroupDefinition
  groupLabel: ElementLabel
  order: number
  identity: string
  elements: string[]
  /** What the bound recipe shows (no recipe: beads only). */
  show: { beads: boolean; trails: boolean; orders: boolean }
  recipe: { id: string; name: string; kinds: GroupOperation['kind'][] } | null
  slots: SculptureSlot[]
  /** One bead per element, in canonical order, at its committed slot. */
  beads: SculptureBead[]
  history: { element: string; label: ElementLabel; via: GroupStep['via'] }[]
  steps: SculptureStep[]
  /** timeline[j] = the state after the first j steps; timeline[history.length] is the committed state. */
  timeline: SculptureMoment[]
  accumulated: string
  atHome: boolean
  /** The selected operation card (the recipe's group_element port), or null. */
  operation: string | null
  item: string | null
  cards: SculptureCard[]
  orders: SculptureOrders
  /** The history bound: at the limit, Apply is refused by the planner, so the scene does not offer it. */
  historyFull: boolean
  status: string
}

const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']
export const numberWord = (k: number): string => NUMBER_WORDS[k] ?? String(k)
export const timesWord = (k: number): string => (k === 1 ? 'once' : k === 2 ? 'twice' : `${k} times`)

/** Plain group name from the stored TeX label ("C_{4}" -> "C4"). */
export function plainGroupLabel(tex: string): string {
  return tex.replace(/\\[a-zA-Z]+/g, '').replace(/[_{}^\\]/g, '').trim() || tex
}

function cycleTexOf(p: Perm): string {
  const cs = cycles(p).filter((c) => c.length > 1)
  return cs.length ? cs.map((c) => `(${c.join('\\,')})`).join('') : '()'
}

/** Chronological words: "1, then 1, then 1"; long histories keep the count and the last three. */
export function historyWords(labels: readonly string[]): string {
  if (!labels.length) return ''
  if (labels.length <= 4) return labels.join(', then ')
  return `${labels.length} steps: …, ${labels.slice(-3).join(', then ')}`
}

function momentStatus(group: FiniteGroup, name: string, history: readonly string[], k: string, operation: string | null): string {
  const lab = (x: string) => group.label(x).plain
  const m = history.length
  const home = k === group.identity
  if (m === 0) {
    return operation ? `${name} · every bead is home · ${lab(operation)} selected, order ${group.elementOrder(operation)}` : `${name} · every bead is home · choose an operation card`
  }
  const first = history[0]!
  if (history.every((g) => g === first)) {
    const head = `${name} · ${lab(first)} applied ${timesWord(m)}`
    if (home) return `${head}: every bead is home`
    const rest = group.elementOrder(first) - (m % group.elementOrder(first))
    return `${head} · ${rest === 1 ? 'one more returns' : `${numberWord(rest)} more return`} every bead home`
  }
  const head = `${name} · ${m} operations applied, k = ${lab(k)}`
  return home ? `${head}: every bead is home` : `${head} · applying ${lab(group.inverse(k))} once returns every bead home`
}

function momentHomeLine(group: FiniteGroup, history: readonly string[], k: string): string {
  const m = history.length
  if (k === group.identity) return m === 0 ? 'every bead is home' : 'every bead is home again'
  const first = history[0]!
  if (history.every((g) => g === first)) {
    const rest = group.elementOrder(first) - (m % group.elementOrder(first))
    return `${rest === 1 ? 'one more returns' : `${numberWord(rest)} more return`} every bead home`
  }
  return `applying ${group.label(group.inverse(k)).plain} once returns every bead home`
}

function ordersOf(group: FiniteGroup): SculptureOrders {
  const n = group.order
  const list = group.elements.map((x) => group.elementOrder(x))
  const maxOrder = Math.max(...list)
  const generators = group.elements.filter((x) => group.elementOrder(x) === n)
  const count = generators.length
  const contrastLines: [string, string] =
    n === 1
      ? ['one element', 'nothing moves']
      : count > 0
        ? [`${numberWord(count)} ${count === 1 ? 'element' : 'elements'} of order ${n}`, `${count === 1 ? 'it cycles' : 'each one cycles'} all ${numberWord(n)} beads`]
        : [`no element of order ${n}`, `repeat any card: home again within ${maxOrder}`]
  const contrast = contrastLines.join(': ')
  return {
    list,
    maxOrder,
    generators,
    cyclic: count > 0,
    summary: `orders ${list.join(', ')}`,
    contrast,
    contrastLines,
    explanation: 'same number of elements, different operation structure',
  }
}

/** The slot of each bead (by index) after accumulated k: index of k·x. */
export function slotsAfter(group: FiniteGroup, k: string): number[] {
  return group.elements.map((x) => group.indexOf(group.multiply(k, x)))
}

/** The motion of one step from accumulated `before`: one move per bead, from the cycles of L_g. */
export function stepOf(group: FiniteGroup, index: number, step: GroupStep, before: string): SculptureStep {
  const g = step.element
  const permutation = [...regularPermutation(group, g)]
  const cs = cycles(permutation)
  const slotsBefore = slotsAfter(group, before)
  const after = group.multiply(g, before)
  const slotsAft = slotsAfter(group, after)
  // Which bead occupies each slot before the step.
  const beadInSlot = new Array<number>(group.order)
  slotsBefore.forEach((s, b) => (beadInSlot[s] = b))
  const moves: SculptureMove[] = new Array(group.order)
  cs.forEach((c, ci) => {
    c.forEach((from, j) => {
      const to = c[(j + 1) % c.length]!
      const b = beadInSlot[from]!
      moves[b] = { bead: group.elements[b]!, beadIndex: b, from, to, cycle: ci, cycleLength: c.length }
    })
  })
  return {
    index,
    element: g,
    label: group.label(g),
    via: step.via,
    permutation,
    cycles: cs,
    cycleText: cycleText(permutation),
    before,
    after,
    slotsBefore,
    slotsAfter: slotsAft,
    moves,
  }
}

/** The sculpture description: plain data derived deterministically from the exact input. */
export function deriveSculpture(input: GroupSceneInput): SculptureDesc {
  const group = input.group
  const n = group.order
  if (n > DOMAIN_LIMITS.sculptureOrder) throw new SculptureError(`the sculpture shows one bead per element: group order ${n} is above ${DOMAIN_LIMITS.sculptureOrder}`)
  if (input.history.length > DOMAIN_LIMITS.history) throw new SculptureError(`history above ${DOMAIN_LIMITS.history} steps`)
  for (const s of input.history) if (!group.has(s.element)) throw new SculptureError(`history: ${JSON.stringify(s.element)} is not an element of ${input.groupLabel}`)
  const words = input.history.map((s) => s.element)
  const k = chronologicalProduct(group, words)
  if (k !== input.accumulated) throw new SculptureError(`accumulated ${JSON.stringify(input.accumulated)} differs from the product of the history (${JSON.stringify(k)})`)
  const operation = input.operation !== null && group.has(input.operation) ? input.operation : null
  const name = plainGroupLabel(input.groupLabel)

  const kinds = input.recipe ? input.recipe.operations.map((o) => o.kind) : []
  const show = input.recipe
    ? { beads: kinds.includes('regular_action'), trails: kinds.includes('cycle_trails'), orders: kinds.includes('element_orders') }
    : { beads: true, trails: false, orders: false }

  const steps: SculptureStep[] = []
  const timeline: SculptureMoment[] = []
  let acc = group.identity
  const moment = (j: number): SculptureMoment => ({
    steps: j,
    accumulated: acc,
    accumulatedLabel: group.label(acc),
    atHome: acc === group.identity,
    slots: slotsAfter(group, acc),
    historyText: historyWords(words.slice(0, j).map((g) => group.label(g).plain)),
    status: momentStatus(group, name, words.slice(0, j), acc, operation),
    homeLine: momentHomeLine(group, words.slice(0, j), acc),
  })
  timeline.push(moment(0))
  input.history.forEach((s, i) => {
    const st = stepOf(group, i, s, acc)
    steps.push(st)
    acc = st.after
    timeline.push(moment(i + 1))
  })

  const finalSlots = slotsAfter(group, k)
  const cards: SculptureCard[] = group.elements.map((g, index) => {
    const permutation = [...regularPermutation(group, g)]
    const order = group.elementOrder(g)
    if (order !== permOrder(permutation)) throw new SculptureError(`order of ${g}: ${order} differs from its regular permutation's order ${permOrder(permutation)}`)
    return {
      element: g,
      index,
      label: group.label(g),
      order,
      permutation,
      cycles: cycles(permutation),
      cycleText: cycleText(permutation),
      cycleTex: cycleTexOf(permutation),
      cycleType: cycleType(permutation),
      identity: g === group.identity,
      generates: order === n,
      selected: g === operation,
    }
  })

  return {
    layout: 'sculpture',
    experimentId: input.experimentId,
    revision: input.revision,
    mathRevision: input.mathRevision,
    groupId: input.groupId,
    groupKey: definitionKey(input.definition),
    definition: JSON.parse(JSON.stringify(input.definition)) as GroupDefinition,
    groupLabel: { tex: input.groupLabel, plain: name },
    order: n,
    identity: group.identity,
    elements: [...group.elements],
    show,
    recipe: input.recipe ? { id: input.recipe.id, name: input.recipe.name, kinds } : null,
    slots: group.elements.map((home, index) => ({ index, home })),
    beads: group.elements.map((x, index) => ({ element: x, index, label: group.label(x), slot: finalSlots[index]!, home: finalSlots[index] === index })),
    history: input.history.map((s) => ({ element: s.element, label: group.label(s.element), via: s.via })),
    steps,
    timeline,
    accumulated: k,
    atHome: k === group.identity,
    operation,
    item: input.item,
    cards,
    orders: ordersOf(group),
    historyFull: input.history.length >= DOMAIN_LIMITS.history,
    status: timeline[timeline.length - 1]!.status,
  }
}
