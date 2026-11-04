// The cube presenter (UI-REFINEMENT-SPEC section 5, "Can a rotation be a rearrangement?"): rotation choices,
// the implemented pair selection of diagonal objects (first object on the stage, then a second object or a
// named "Swap a and b" commit resolved by the CURRENT slots phi(k)[a], phi(k)[b]), and Return by inverse.
//
// Values come from the CubeDesc (src/domains/cube/derive.ts: its cards and object actions are the exact
// actions the stage proposes) and src/algebra/cube.ts. Nothing is parsed from rendered text.

import { findAnyExperiment, type GroupExperiment } from '../../workspace/document'
import { domainControls } from '../../demo/four'
import { cubeGroup, phiOf } from '../../algebra/cube'
import { permKey } from '../../algebra/permutation'
import type { CubeDesc } from '../../domains/cube/derive'
import type { ContextGroup, ContextItem, DetailSection, DomainPresentation, PresenterInput, ResetItem, StatusView } from '../model'
import { EMPTY_CONTEXT, L, actionsRun, count, intRows, phaseOf, prettyPlain, problemStatus, scenePresentation } from './common'

const TOPIC = 'Four diagonals'

function sceneDesc(input: PresenterInput): CubeDesc | null {
  const s = input.scene
  return s && s.layout === 'cube' ? (s.desc as CubeDesc) : null
}

function groupExperiment(input: PresenterInput): GroupExperiment | null {
  try {
    const e = findAnyExperiment(input.doc, input.experimentId)
    return e.domain === 'group' ? e : null
  } catch {
    return null
  }
}

/** The prompt after a first diagonal is chosen (spec section 5, exact wording with the selected identity). */
export const swapPrompt = (identity: number): string => `Choose another diagonal to swap with ${identity}`

export function cubeStatus(input: PresenterInput, d: CubeDesc): StatusView {
  const pb = input.playback
  const m = d.history.length
  if (!d.agree) return { phase: phaseOf(pb, m > 0), text: 'The cube and the diagonal record disagree: please report this', tone: 'error' }
  if (pb.active) {
    const lab = prettyPlain(pb.step?.label ?? '')
    const k = prettyPlain(d.label.plain)
    const kind = pb.phase
    if (kind === 'replay' && pb.step) return { phase: phaseOf(pb, true), text: `${pb.playing ? 'Replaying' : 'Paused'} · step ${pb.step.index} of ${pb.step.count} · ${lab} · ending at k = ${k}`, tone: 'normal' }
    if (kind === 'undo') return { phase: phaseOf(pb, true), text: `${pb.playing ? 'Undoing' : 'Paused undoing'} ${lab} · showing the return to k = ${k}`, tone: 'normal' }
    const last = d.history[m - 1]
    const what = last && last.via === 'diagonal_lines' && last.swapped ? `swap ${last.swapped[0]} and ${last.swapped[1]} (rotation ${prettyPlain(last.label.plain)})` : lab
    return { phase: phaseOf(pb, true), text: `${pb.playing ? 'Rotating' : 'Paused rotating'} · ${what} · showing the move to k = ${k}`, tone: 'normal' }
  }
  if (m === 0) return { phase: 'ready', text: 'Ready · identity orientation · each diagonal on its own line', tone: 'normal' }
  const where = d.isHome ? 'back at the identity: each diagonal on its own line' : `diagonal lines permuted ${d.phiCycles}`
  const full = d.historyFull ? ` · history full (${m} steps)` : ''
  return { phase: 'result', text: `${count(m, 'rotation')} · k = ${prettyPlain(d.label.plain)} · ${where}${full}`, tone: d.historyFull ? 'warning' : 'normal' }
}

function context(d: CubeDesc): { groups: ContextGroup[]; hint: string } {
  const full = d.historyFull
  const fullReason = `History full (${d.history.length} steps): reset the experiment first`
  const rotate: ContextItem[] = d.cards.filter((c) => c.id !== 'card:return').map((c) => ({
    id: `rotate:${c.id.slice(5)}`,
    label: L(prettyPlain(c.label.plain), c.label.tex),
    role: 'secondary',
    enabled: c.enabled,
    reason: c.enabled ? undefined : fullReason,
    ariaLabel: `Rotate the cube: ${c.label.plain}, ${c.caption.plain}`,
    hint: c.hint,
    run: actionsRun(c.actions),
  }))
  const groups: ContextGroup[] = [{ id: 'rotate', label: 'Rotate', layout: 'actions', items: rotate }]
  const a = d.selectedLine
  let hint: string
  if (a !== null) {
    // The implemented pair selection: the second object commits the swap of the two CURRENT slots.
    const swaps: ContextItem[] = d.objects.filter((o) => o.identity !== a && o.swap).map((o) => {
      const lo = Math.min(a, o.identity)
      const hi = Math.max(a, o.identity)
      const sa = d.phi[a]!
      const sb = d.phi[o.identity]!
      return {
        id: `swap:${o.identity}`,
        label: L(`Swap ${lo} and ${hi}`),
        role: 'secondary',
        enabled: o.actions.length > 0,
        reason: o.actions.length ? undefined : fullReason,
        ariaLabel: `Swap diagonals ${lo} and ${hi}`,
        hint: `Exchange lines ${Math.min(sa, sb)} and ${Math.max(sa, sb)}, where ${lo} and ${hi} lie now: the unique rotation ${prettyPlain(o.swap!.label.plain)}`,
        run: actionsRun(o.actions),
      }
    })
    swaps.push({ id: 'deselect', label: L('Clear selection'), role: 'secondary', enabled: true, hint: `Deselect diagonal ${a}`, run: { kind: 'actions', actions: [{ kind: 'select_item', experimentId: d.experimentId, item: null }] } })
    groups.push({ id: 'swap', label: `Swap with ${a}`, layout: 'actions', items: swaps })
    hint = swapPrompt(a)
  } else hint = 'Or choose a diagonal on the stage to swap it with another'
  const ret = d.cards.find((c) => c.id === 'card:return')
  if (ret && !d.isHome) {
    groups.push({
      id: 'inverse',
      layout: 'actions',
      items: [{
        id: 'return',
        label: L('Return by inverse'),
        role: 'secondary',
        enabled: ret.enabled,
        reason: ret.enabled ? undefined : full ? fullReason : 'Already at the identity',
        ariaLabel: `Return by inverse: apply ${ret.caption.plain}`,
        hint: `Apply ${prettyPlain(ret.caption.plain)}: a rotation that undoes k (a new step, not Undo or Reset)`,
        run: actionsRun(ret.actions),
      }],
    })
  }
  return { groups, hint }
}

function detail(d: CubeDesc): DetailSection[] {
  const G = cubeGroup()
  const distinct = new Set(G.elements.map((e) => permKey(phiOf(e)))).size
  const sections: DetailSection[] = []
  sections.push({
    title: 'Current orientation',
    provenance: 'computed exactly',
    items: [
      { kind: 'formula', formula: L(prettyPlain(d.state.plain), d.state.tex) },
      { kind: 'matrix', label: L('k', 'k'), rows: intRows(d.matrix) },
      // The description's plain form spells phi; the inspector uses the symbol, like the rest of the UI.
      { kind: 'formula', formula: L(d.phiText.plain.replace(/^phi/, 'φ'), d.phiText.tex) },
      { kind: 'pairs', rows: d.objects.map((o) => ({ key: L(`diagonal ${o.identity}`), value: L(`on line ${o.slot}`) })) },
      { kind: 'text', text: d.agree ? 'The objects\' own record (each step\'s φ composed in order) equals φ(k).' : 'The objects\' record differs from φ(k).' },
    ],
  })
  sections.push({
    title: 'Rotations and their composition',
    provenance: 'computed exactly',
    items: d.history.length
      ? [
        { kind: 'list', items: d.history.map((h) => L(prettyPlain(`${h.index + 1}. ${h.via === 'diagonal_lines' ? (h.swapped ? `swap ${h.swapped[0]} and ${h.swapped[1]}, resolved to ${h.label.plain}` : `permutation ${h.phiCycles}, resolved to ${h.label.plain}`) : h.op.plain.replace(/^applying /, '')} · lines ${h.phiCycles === '()' ? 'unchanged' : h.phiCycles}`))) },
        ...(d.word ? [{ kind: 'formula' as const, formula: L(prettyPlain(d.word.plain), d.word.tex) }] : []),
        { kind: 'text', text: `Applying g, then h gives the product h·g (read right to left).${d.driverText ? ` Last step ${prettyPlain(d.driverText)}.` : ''}` },
      ]
      : [{ kind: 'text', text: 'No rotation applied yet: k is the identity.' }],
  })
  sections.push({
    title: '24 rotations ↔ 24 permutations',
    provenance: 'computed exactly',
    items: [
      { kind: 'text', text: `φ sends each proper rotation of the cube to the permutation it induces on the four unoriented body-diagonal lines. The 24 rotations give ${distinct} distinct permutations, so φ is a bijection onto all 24 permutations of four lines, and φ(AB) = φ(A)φ(B).` },
    ],
  })
  const a = d.selectedLine
  sections.push({
    title: 'Identities and slots',
    provenance: 'presentation',
    items: [
      { kind: 'text', text: 'Diagonal object i keeps its identity (colour, shape, number); it lies on line slot φ(k)[i]. Swapping objects a and b exchanges their current lines φ(k)[a] and φ(k)[b]: the unique rotation with that permutation is applied.' },
      ...(a !== null
        ? [{ kind: 'pairs' as const, rows: d.objects.filter((o) => o.identity !== a && o.swap).map((o) => ({ key: L(`swap ${Math.min(a, o.identity)} and ${Math.max(a, o.identity)}`), value: L(`lines ${d.phi[a]} ↔ ${d.phi[o.identity]} · rotation ${prettyPlain(o.swap!.label.plain)}`, `${o.swap!.label.tex}`) })) }]
        : []),
    ],
  })
  return sections
}

export function presentCube(input: PresenterInput): DomainPresentation {
  const d = sceneDesc(input)
  const e = groupExperiment(input)
  if (!d) {
    return {
      subtitle: L(TOPIC),
      context: EMPTY_CONTEXT,
      status: problemStatus(input) ?? { phase: 'ready', text: 'The cube scene is not shown yet', tone: 'warning' },
      playback: { play: { enabled: false, reason: 'No scene' }, replay: { enabled: false, reason: 'No scene' } },
      resets: [],
      detail: { sections: [] },
      scene: scenePresentation(input),
    }
  }
  const { groups, hint } = context(d)
  const m = d.history.length
  const reset = e ? domainControls(input.doc, e).reset.actions : []
  const resets: ResetItem[] = [{
    id: 'reset',
    label: 'Reset experiment',
    helper: 'Empty the rotation history: the cube returns to the identity orientation and each diagonal to its own line (undoable)',
    enabled: reset.length > 0,
    reason: reset.length ? undefined : 'Already at the identity orientation',
    run: actionsRun(reset),
  }]
  return {
    subtitle: L(TOPIC),
    context: { title: 'Choose a rotation', groups, hint },
    status: cubeStatus(input, d),
    playback: {
      play: input.playback.active || m > 0 ? { enabled: true } : { enabled: false, reason: 'Nothing applied yet' },
      replay: m > 0 ? { enabled: true } : { enabled: false, reason: 'Nothing applied yet' },
    },
    resets,
    detail: { sections: detail(d) },
    scene: scenePresentation(input),
  }
}
