// The operation-order presenter (UI-REFINEMENT-SPEC section 5, "Does the order change the result?"): both
// branches with their chronological order readable ("R then S"), Reverse left order (primary) and Reverse
// right order, the result comparison in the status, and under Show mathematics the matrices, the composition
// convention (A then B gives BA), the exact differing-point witness and the supported claim checks.

import { branchMatrix, branchSymbol, findBranch, type LinearExperiment } from '../../workspace/document'
import { orderWords, reverseRouteActions } from '../../demo/order'
import { apply, differenceWitness, matEq, vecEq } from '../../model/linear'
import type { ClaimRequest } from '../../workspace/claims'
import type { ContextGroup, DetailItem, DetailSection, DomainPresentation, PresenterInput, StatusView } from '../model'
import { EMPTY_CONTEXT, L, actionsRun, phaseOf, problemStatus, scenePresentation } from './common'
import { comparedBranches, dragStatus, evidenceItems, linearExperiment, matRows, receiptProvenance, sampleCoords, sampleName, vecText } from './linear'

const TOPIC = 'Rotations and reflections'

interface Route {
  side: 'left' | 'right'
  branchId: string
  order: string
  symbol: string
  A: ReturnType<typeof branchMatrix>
  maps: number
}

function routes(input: PresenterInput): { e: LinearExperiment; left: Route; right: Route } | null {
  const e = linearExperiment(input)
  if (!e) return null
  const b = comparedBranches(input.doc, e)
  if (!b) return null
  const mk = (side: 'left' | 'right', branchId: string): Route => ({
    side,
    branchId,
    order: orderWords(input.doc, e, branchId),
    symbol: branchSymbol(input.doc, e, branchId),
    A: branchMatrix(input.doc, e, branchId),
    maps: findBranch(e, branchId).mapIds.length,
  })
  return { e, left: mk('left', b.left), right: mk('right', b.right) }
}

export function orderStatus(input: PresenterInput, r: NonNullable<ReturnType<typeof routes>>): StatusView {
  const drag = dragStatus(input, r.e)
  if (drag) return drag
  const pb = input.playback
  if (pb.active) return { phase: phaseOf(pb, true), text: `${pb.playing ? 'Playing' : 'Paused'}${pb.step ? ` · ${pb.step.label}` : ''}`, tone: 'normal' }
  const { left: L0, right: R0 } = r
  if (matEq(L0.A, R0.A)) return { phase: 'result', text: `${L0.order} and ${R0.order} give the same map`, tone: 'normal' }
  const sel = input.doc.selection.sampleId
  const c = sel ? sampleCoords(input, r.e, sel) : null
  if (sel && c) {
    const n = sampleName(input, r.e, sel)
    return vecEq(apply(L0.A, c), apply(R0.A, c))
      ? { phase: 'result', text: `Same result for ${n}, but ${L0.order} and ${R0.order} differ elsewhere (${L0.symbol} ≠ ${R0.symbol})`, tone: 'normal' }
      : { phase: 'result', text: `${L0.order} and ${R0.order} differ: ${L0.symbol}${n} ≠ ${R0.symbol}${n}`, tone: 'normal' }
  }
  return { phase: 'result', text: `${L0.order} and ${R0.order} give different maps (${L0.symbol} ≠ ${R0.symbol})`, tone: 'normal' }
}

function context(r: NonNullable<ReturnType<typeof routes>>): { groups: ContextGroup[]; hint: string } {
  const item = (route: Route, primary: boolean) => {
    const actions = route.maps >= 2 ? reverseRouteActions(r.e, route.branchId) : []
    const reversed = route.order.split(' then ').reverse().join(' then ')
    return {
      id: `reverse:${route.side}`,
      label: L(`Reverse ${route.side} order`),
      role: primary ? ('primary' as const) : ('secondary' as const),
      enabled: actions.length > 0,
      reason: actions.length ? undefined : 'Fewer than two operations: nothing to reverse',
      ariaLabel: `Reverse the ${route.side} branch: ${route.order} becomes ${reversed}`,
      hint: `${route.order} becomes ${reversed}`,
      run: actionsRun(actions),
    }
  }
  return {
    groups: [
      { id: 'left', label: `Left: ${r.left.order}`, layout: 'actions', items: [item(r.left, true)] },
      { id: 'right', label: `Right: ${r.right.order}`, layout: 'actions', items: [item(r.right, false)] },
    ],
    hint: `${r.left.order} gives ${r.left.symbol}; ${r.right.order} gives ${r.right.symbol}`,
  }
}

function detail(input: PresenterInput, r: NonNullable<ReturnType<typeof routes>>): DetailSection[] {
  const { e, left, right } = r
  const sections: DetailSection[] = []
  sections.push({
    title: 'Routes and matrices',
    provenance: 'computed exactly',
    items: [
      { kind: 'matrix', label: L(`left, ${left.order}: ${left.symbol}`, left.symbol), rows: matRows(left.A) },
      { kind: 'matrix', label: L(`right, ${right.order}: ${right.symbol}`, right.symbol), rows: matRows(right.A) },
      { kind: 'text', text: `Applying A then B to column vectors gives BA: ${left.order} is the matrix ${left.symbol}, ${right.order} is ${right.symbol}.` },
    ],
  })
  const j = differenceWitness(left.A, right.A)
  const witness: DetailItem[] = []
  if (j === null) witness.push({ kind: 'text', text: `The two routes give the same matrix: ${left.symbol} = ${right.symbol}.` })
  else {
    const ej = left.A.map((_, i) => (i === j ? { n: 1n, d: 1n } : { n: 0n, d: 1n }))
    witness.push({ kind: 'pairs', rows: [
      { key: L(`${left.symbol}e${j + 1}`), value: L(vecText(apply(left.A, ej))) },
      { key: L(`${right.symbol}e${j + 1}`), value: L(vecText(apply(right.A, ej))) },
    ] })
    witness.push({ kind: 'text', text: `The basis vector e${j + 1} = ${vecText(ej)} lands in different places, so ${left.symbol} ≠ ${right.symbol}.` })
  }
  const sel = input.doc.selection.sampleId
  const c = sel ? sampleCoords(input, e, sel) : null
  if (sel && c) {
    const n = sampleName(input, e, sel)
    witness.push({ kind: 'pairs', rows: [
      { key: L(n), value: L(vecText(c)) },
      { key: L(`${left.symbol}${n}`), value: L(vecText(apply(left.A, c))) },
      { key: L(`${right.symbol}${n}`), value: L(vecText(apply(right.A, c))) },
    ] })
  }
  sections.push({ title: 'Differing-point witness', provenance: 'computed exactly', items: witness })
  const ref = (route: Route) => ({ experimentId: e.id, branchId: route.branchId })
  const claim: ClaimRequest = j === null ? { kind: 'map_equality', left: ref(left), right: ref(right) } : { kind: 'map_difference_witness', left: ref(left), right: ref(right), basisIndex: j }
  sections.push({
    title: 'Checks and receipts',
    ...receiptProvenance(input.evidence, [e.id]),
    items: [
      { kind: 'action', id: j === null ? 'check:eq' : 'check:diff', label: L(j === null ? `Check with Lean: ${left.symbol} = ${right.symbol}` : `Check with Lean: ${left.symbol}e${j + 1} ≠ ${right.symbol}e${j + 1}`), enabled: true, run: { kind: 'check', claim } },
      ...evidenceItems(input.evidence, [e.id]),
    ],
  })
  return sections
}

export function presentOrder(input: PresenterInput): DomainPresentation {
  const r = routes(input)
  if (!r) {
    return {
      subtitle: L(TOPIC),
      context: EMPTY_CONTEXT,
      status: problemStatus(input) ?? { phase: 'ready', text: 'The comparison is not shown yet', tone: 'warning' },
      playback: { play: { enabled: false, reason: 'No scene' }, replay: { enabled: false, reason: 'No scene' } },
      resets: [],
      detail: { sections: [] },
      scene: scenePresentation(input),
    }
  }
  const { groups, hint } = context(r)
  return {
    subtitle: L(TOPIC),
    context: { title: null, groups, hint },
    status: problemStatus(input) ?? orderStatus(input, r),
    // The comparison replays its construction step by step whatever the history.
    playback: { play: { enabled: true }, replay: { enabled: true } },
    resets: [],
    detail: { sections: detail(input, r) },
    scene: scenePresentation(input),
  }
}
