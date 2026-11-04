// The P / Q presenter (UI-REFINEMENT-SPEC section 5, "What gets lost when we flatten space?"): the selected
// pair and fiber stay on the stage; the context offers the drag mode (along the fiber / freely) and the recipe
// reuse on the other map (rebindTarget: Use on Q / Show P); the status is the drag preview while dragging.
// Formal readouts (the map matrix, exact coordinates, kernel, Lean checks and receipts) are in the detail.

import { branchMatrix, findSampleSet, type LinearExperiment } from '../../workspace/document'
import { rebindTarget } from '../../demo/pq'
import { demoOf } from '../../demo/order'
import { apply, coordinateProjectorDiscarded, describeMap, differenceWitness, exactOutputGroups, selectedFiberSegment } from '../../model/linear'
import type { ClaimRequest } from '../../workspace/claims'
import type { ContextItem, DetailItem, DetailSection, DomainPresentation, PresenterInput, StatusView } from '../model'
import { EMPTY_CONTEXT, L, actionsRun, phaseOf, problemStatus, scenePresentation, topicLabel } from './common'
import { AXES, boundBranch, dragStatus, evidenceItems, linearExperiment, mapFormula, matRows, receiptProvenance, sampleCoords, sampleName, vecTex, vecText } from './linear'

const TOPIC = 'Linear maps'

interface Shown {
  e: LinearExperiment
  branch: string
  symbol: string
  A: ReturnType<typeof branchMatrix>
  sel: string | null
  fiberAxis: number | null
}

function shown(input: PresenterInput): Shown | null {
  const e = linearExperiment(input)
  if (!e) return null
  const branch = boundBranch(input.doc, e)
  const A = branchMatrix(input.doc, e, branch)
  const sel = input.doc.selection.sampleId
  const coords = sel ? sampleCoords(input, e, sel) : null
  const seg = coords ? selectedFiberSegment(A, coords) : null
  return { e, branch, symbol: input.linear?.mapSymbol ?? '?', A, sel, fiberAxis: seg ? seg.direction : null }
}

/** Members of the selected sample's exact output group (selected first), from the exact matrix. */
function sharing(input: PresenterInput, s: Shown): string[] {
  if (!s.sel) return []
  const samples = findSampleSet(input.doc, s.e.sampleSetId).samples
  const g = exactOutputGroups(s.A, samples).find((x) => x.ids.includes(s.sel!))
  return g ? [s.sel, ...g.ids.filter((id) => id !== s.sel)] : [s.sel]
}

export function pqStatus(input: PresenterInput, s: Shown): StatusView {
  const drag = dragStatus(input, s.e)
  if (drag) return drag
  const pb = input.playback
  if (pb.active) return { phase: phaseOf(pb, true), text: `${pb.playing ? 'Animating' : 'Paused'} · applying ${s.symbol} to every sample · the in-between path is illustrative`, tone: 'normal' }
  if (!s.sel) return { phase: 'ready', text: `Ready · ${s.symbol}: ${describeMap(s.A).toLowerCase()} · select a point`, tone: 'normal' }
  const n = sampleName(input, s.e, s.sel)
  const members = sharing(input, s)
  const others = members.length - 1
  return {
    phase: 'result',
    text: others > 0 ? `${n} selected · ${members.length} samples share its exact output ${s.symbol}${n}` : `${n} selected · no other sample shares ${s.symbol}${n}`,
    tone: 'normal',
  }
}

function context(input: PresenterInput, s: Shown): { items: ContextItem[]; rebind: ContextItem; hint: string } {
  const fiberOk = s.fiberAxis !== null
  const fiberMode = input.dragMode === 'fiber' && fiberOk
  const axis = s.fiberAxis !== null ? AXES[s.fiberAxis] : null
  const items: ContextItem[] = [
    {
      id: 'drag:fiber',
      label: L('Along the fiber'),
      role: 'choice',
      selected: fiberMode,
      enabled: fiberOk,
      reason: fiberOk ? undefined : s.sel ? 'This map has no line fiber' : 'Select a point first',
      hint: axis ? `Drags slide along the ${axis}-direction: the input changes, the output stays` : undefined,
      run: fiberMode ? { kind: 'none' } : { kind: 'dragMode' },
    },
    {
      id: 'drag:free',
      label: L('Freely'),
      role: 'choice',
      selected: !fiberMode,
      enabled: true,
      hint: 'Drags move the point anywhere (snapped to eighths)',
      // The app's mode can be "fiber" while no fiber exists (drags are free then): toggling is still exact.
      run: input.dragMode === 'free' ? { kind: 'none' } : { kind: 'dragMode' },
    },
  ]
  const target = rebindTarget(input.doc)
  const rebind: ContextItem = {
    id: 'rebind',
    label: L(target.label),
    role: 'primary',
    enabled: target.actions.length > 0,
    reason: target.actions.length ? undefined : 'No other map to reuse this representation on',
    hint: target.label.startsWith('Use on') ? 'Reuse this saved representation on the other map (the same recipe, rebound)' : 'Show the other map with the same representation and selection',
    run: actionsRun(target.actions),
  }
  // While dragging (always the selected point), the same statement for the drag in progress: the hint row
  // stays, so the context card keeps its height and the stage is not refitted under the pointer.
  const drag = input.drag
  const id = drag?.sampleId ?? s.sel
  let hint: string
  if (!id) hint = 'Select a point to see where it goes'
  else {
    const n = sampleName(input, s.e, id)
    const verb = drag ? 'Dragging' : 'Drag'
    hint = (drag ? drag.mode === 'fiber' : fiberMode) && axis ? `${verb} ${n} along its fiber: the input changes, ${s.symbol}${n} stays`
      : axis ? `${verb} ${n} freely: ${s.symbol}${n} changes unless you move only along ${axis}`
        : `${verb} ${n} freely`
  }
  return { items, rebind, hint }
}

function checks(input: PresenterInput, s: Shown): DetailItem[] {
  const doc = input.doc
  const out: DetailItem[] = []
  const ref = (e: LinearExperiment) => ({ experimentId: e.id, branchId: boundBranch(doc, e) })
  // Same image: the selected sample and a partner in its exact output group (a labelled one first).
  const members = sharing(input, s)
  const partner = members.slice(1).find((id) => findSampleSet(doc, s.e.sampleSetId).samples.find((x) => x.id === id)?.label) ?? members[1] ?? null
  if (s.sel && partner) {
    const u = sampleName(input, s.e, s.sel)
    const v = sampleName(input, s.e, partner)
    const claim: ClaimRequest = { kind: 'same_image_witness', branch: ref(s.e), u: s.sel, v: partner }
    out.push({ kind: 'action', id: 'check:same', label: L(`Check with Lean: ${u} ≠ ${v} and ${s.symbol}${u} = ${s.symbol}${v}`), enabled: true, run: { kind: 'check', claim } })
  } else out.push({ kind: 'action', id: 'check:same', label: L('Check with Lean: two inputs, one output'), enabled: false, reason: s.sel ? 'No other sample shares this output' : 'Select a point first', run: { kind: 'none' } })
  const pq = doc.experiments.filter((x): x is LinearExperiment => x.domain === 'linear' && demoOf(doc, x) === 'pq')
  if (pq.length >= 2) {
    const [a, b] = [pq[0]!, pq[1]!]
    const Am = branchMatrix(doc, a, boundBranch(doc, a))
    const Bm = branchMatrix(doc, b, boundBranch(doc, b))
    const j = differenceWitness(Am, Bm)
    if (j !== null) {
      const claim: ClaimRequest = { kind: 'map_difference_witness', left: ref(a), right: ref(b), basisIndex: j }
      out.push({ kind: 'action', id: 'check:diff', label: L(`Check with Lean: the two maps differ on e${j + 1}`), enabled: true, run: { kind: 'check', claim } })
    } else {
      const claim: ClaimRequest = { kind: 'map_equality', left: ref(a), right: ref(b) }
      out.push({ kind: 'action', id: 'check:eq', label: L('Check with Lean: the two maps are equal'), enabled: true, run: { kind: 'check', claim } })
    }
  } else out.push({ kind: 'action', id: 'check:diff', label: L('Check with Lean: P and Q differ'), enabled: false, reason: 'Use the representation on Q first: there is only one map', run: { kind: 'none' } })
  return out
}

function detail(input: PresenterInput, s: Shown): DetailSection[] {
  const sections: DetailSection[] = []
  sections.push({
    title: 'Map',
    provenance: 'computed exactly',
    items: [
      { kind: 'formula', formula: mapFormula(s.symbol, s.A) },
      { kind: 'matrix', label: L(s.symbol, s.symbol), rows: matRows(s.A) },
      { kind: 'text', text: describeMap(s.A) },
    ],
  })
  const discarded = coordinateProjectorDiscarded(s.A)
  const kernelItems: DetailItem[] = discarded && discarded.length === 1
    ? [
      { kind: 'text', text: `Kernel: the ${AXES[discarded[0]!]}-axis, every point with only a ${AXES[discarded[0]!]}-coordinate. Each fiber is a whole line parallel to the ${AXES[discarded[0]!]}-axis; every point on it has the same image.` },
      { kind: 'text', text: `The drawn fiber segment is bounded to |${AXES[discarded[0]!]}| ≤ 4: a finite piece of an infinite line.` },
    ]
    : [{ kind: 'text', text: discarded ? `Kernel of dimension ${discarded.length} (discards ${discarded.map((i) => AXES[i]).join(', ')}): no line-fiber view.` : (input.linear?.notes[0] ?? 'This map is not a coordinate projector: no line-fiber view.') }]
  sections.push({ title: 'Kernel and fibers', provenance: 'computed exactly', items: kernelItems })
  if (s.sel) {
    const c = sampleCoords(input, s.e, s.sel)
    const n = sampleName(input, s.e, s.sel)
    if (c) {
      const img = apply(s.A, c)
      const members = sharing(input, s)
      sections.push({
        title: 'Selected point',
        provenance: 'computed exactly',
        items: [
          { kind: 'pairs', rows: [
            { key: L(n), value: L(vecText(c), vecTex(c)) },
            { key: L(`${s.symbol}${n}`), value: L(vecText(img), vecTex(img)) },
            { key: L('Same exact output'), value: L(members.length > 1 ? members.map((id) => sampleName(input, s.e, id)).join(', ') : 'no other sample') },
            ...(s.fiberAxis !== null ? [{ key: L('Its fiber'), value: L(`${vecText(c)} + t·e${s.fiberAxis + 1}, every real t`) }] : []),
          ] },
        ],
      })
    }
  }
  const pqIds = input.doc.experiments.filter((x) => x.domain === 'linear' && demoOf(input.doc, x) === 'pq').map((x) => x.id)
  sections.push({
    title: 'Checks and receipts',
    ...receiptProvenance(input.evidence, pqIds),
    items: [...checks(input, s), ...evidenceItems(input.evidence, pqIds), { kind: 'text', text: 'Moving the workbench or relabelling a view is layout, not a mathematical transformation.' }],
  })
  return sections
}

export function presentPq(input: PresenterInput): DomainPresentation {
  const s = shown(input)
  if (!s) {
    return {
      subtitle: L(TOPIC),
      context: EMPTY_CONTEXT,
      status: problemStatus(input) ?? { phase: 'ready', text: 'The linear-map views are not shown yet', tone: 'warning' },
      playback: { play: { enabled: false, reason: 'No scene' }, replay: { enabled: false, reason: 'No scene' } },
      resets: [],
      detail: { sections: [] },
      scene: scenePresentation(input),
    }
  }
  const { items, rebind, hint } = context(input, s)
  return {
    subtitle: topicLabel(TOPIC, s.symbol, s.symbol),
    context: {
      title: null,
      groups: [
        { id: 'drag', label: 'Drag', layout: 'choices', items },
        { id: 'reuse', layout: 'actions', items: [rebind] },
      ],
      hint,
    },
    status: problemStatus(input) ?? pqStatus(input, s),
    // A linear map replays its application (no group history is needed).
    playback: { play: { enabled: true }, replay: { enabled: true } },
    resets: [],
    detail: { sections: detail(input, s) },
    scene: scenePresentation(input),
  }
}
