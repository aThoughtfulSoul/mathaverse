// The C4 / V4 sculpture presenter (UI-REFINEMENT-SPEC sections 2, 5, 6): "Choose an operation", one card per
// group element (selection only), one Apply button for the selected element, the quiet recipe reuse on the
// other group, and a status line derived from the exact accumulated element and the scene's real playback.
//
// Every value comes from the SculptureDesc (src/domains/sculpture/derive.ts), the group (src/algebra/groups.ts)
// and the prepared actions (src/demo/four.ts). Nothing is parsed from rendered text.

import { findAnyExperiment, type GroupExperiment } from '../../workspace/document'
import { domainControls, sculptureRebindActions } from '../../demo/four'
import { groupOf } from '../../algebra/groups'
import type { SculptureDesc } from '../../domains/sculpture/derive'
import type { ContextItem, DetailSection, DomainPresentation, Label, PresenterInput, ResetItem, StatusView } from '../model'
import { EMPTY_CONTEXT, L, actionsRun, count, noteSection, numberWord, phaseOf, problemStatus, scenePresentation, topicLabel, unicodeLabel } from './common'

const TOPIC = 'Cycle experiment'

/** The operation as the learner reads it: "+1" for addition mod n (C_n), the pair label "(1,0)" for V4. */
export function operationLabel(d: SculptureDesc, element: string): Label {
  const card = d.cards.find((c) => c.element === element)
  const lab = card ? card.label : { plain: element, tex: element }
  return d.definition.kind === 'cyclic' ? L(`+${lab.plain}`, `+${lab.tex}`) : L(lab.plain, lab.tex)
}

function groupLabel(d: SculptureDesc): Label {
  return L(unicodeLabel(d.groupLabel.tex), d.groupLabel.tex)
}

function sceneDesc(input: PresenterInput): SculptureDesc | null {
  const s = input.scene
  return s && s.layout === 'sculpture' ? (s.desc as SculptureDesc) : null
}

function groupExperiment(input: PresenterInput): GroupExperiment | null {
  try {
    const e = findAnyExperiment(input.doc, input.experimentId)
    return e.domain === 'group' ? e : null
  } catch {
    return null
  }
}

/** "every bead home" phrasing for the committed state, from the exact accumulated element. */
function homeClause(d: SculptureDesc): string {
  const g = groupOf(d.definition)
  const m = d.history.length
  if (d.atHome) return m === 0 ? 'Starting arrangement' : 'every bead is home again'
  const first = d.history[0]!.element
  if (d.history.every((h) => h.element === first)) {
    // Repeating one operation: home after a multiple of its order (the order of that element, not of k).
    const rest = g.elementOrder(first) - (m % g.elementOrder(first))
    return `apply ${operationLabel(d, first).plain} ${rest === 1 ? 'once more' : `${numberWord(rest)} more times`} to bring every bead home`
  }
  return `apply ${operationLabel(d, g.inverse(d.accumulated)).plain} once to bring every bead home`
}

export function sculptureStatus(input: PresenterInput, d: SculptureDesc): StatusView {
  const pb = input.playback
  const m = d.history.length
  const k = d.timeline[m]!.accumulatedLabel.plain
  if (pb.active) {
    const step = pb.step
    if (pb.phase === 'replay' && step) {
      const h = d.history[step.index - 1]
      const what = h ? operationLabel(d, h.element).plain : ''
      return { phase: phaseOf(pb, m > 0), text: `${pb.playing ? 'Replaying' : 'Paused'} · step ${step.index} of ${step.count}${what ? ` · ${what}` : ''} · ending at k = ${k}`, tone: 'normal' }
    }
    // A committed apply whose motion is still shown: describe its target, never the moving pose.
    const last = d.history[m - 1]
    const op = last ? operationLabel(d, last.element).plain : ''
    const target = d.atHome ? 'the starting arrangement (k = 0)' : `k = ${k}`
    return { phase: phaseOf(pb, true), text: `${pb.playing ? 'Applying' : 'Paused applying'} ${op} · showing the move to ${target}`, tone: 'normal' }
  }
  if (m === 0) return { phase: 'ready', text: `Ready · 0 moves · ${homeClause(d)}`, tone: 'normal' }
  const full = d.historyFull ? ` · history full (${m} moves)` : ''
  return { phase: 'result', text: `${count(m, 'move')} · k = ${k} · ${homeClause(d)}${full}`, tone: d.historyFull ? 'warning' : 'normal' }
}

function contextItems(input: PresenterInput, d: SculptureDesc, e: GroupExperiment | null): { cards: ContextItem[]; actions: ContextItem[]; hint: string | null } {
  const exp = d.experimentId
  const cards: ContextItem[] = d.cards.map((c) => ({
    id: `op:${c.element}`,
    label: L(c.label.plain, c.label.tex),
    role: 'choice',
    selected: c.selected,
    enabled: true,
    ariaLabel: `Choose operation ${operationLabel(d, c.element).plain}`,
    hint: c.selected ? `${operationLabel(d, c.element).plain} is selected: Apply applies it` : `Select ${operationLabel(d, c.element).plain}`,
    // A card only ever selects (an already selected card is a no-op selection); Apply is the one execution path.
    run: { kind: 'actions', actions: [{ kind: 'select_item', experimentId: exp, item: c.element }] },
  }))
  const op = d.operation
  const opLab = op !== null ? operationLabel(d, op).plain : null
  const apply: ContextItem = {
    id: 'apply',
    label: L(opLab !== null ? `Apply ${opLab}` : 'Apply'),
    role: 'primary',
    enabled: op !== null && !d.historyFull,
    reason: op === null ? 'Choose an operation first' : d.historyFull ? `History full (${d.history.length} moves): reset the experiment first` : undefined,
    ariaLabel: opLab !== null ? `Apply ${opLab} to every bead` : 'Apply the selected operation',
    run: op !== null && !d.historyFull ? { kind: 'actions', actions: [{ kind: 'apply_element', experimentId: exp, element: op }] } : { kind: 'none' },
  }
  const toV4 = d.definition.kind !== 'klein_four'
  const rebindActions = e ? sculptureRebindActions(input.doc, e) : []
  const target = toV4 ? 'V₄' : 'C₄'
  const rebind: ContextItem = {
    id: 'rebind',
    label: L(`Use on ${target}`, `\\textsf{Use on }${toV4 ? 'V_{4}' : 'C_{4}'}`),
    role: 'secondary',
    enabled: rebindActions.length > 0,
    reason: rebindActions.length ? undefined : `No ${target} experiment in this workspace`,
    hint: `Reuse this saved representation on ${target}: the same recipe, bound to the other group`,
    run: actionsRun(rebindActions),
  }
  const hint = d.historyFull ? `History full (${d.history.length} moves): reset the experiment to continue` : op === null ? 'Choose an operation card' : null
  return { cards, actions: [apply, rebind], hint }
}

function detailSections(d: SculptureDesc): DetailSection[] {
  const name = groupLabel(d)
  const m = d.history.length
  const now = d.timeline[m]!
  const sections: DetailSection[] = []
  sections.push({
    title: 'Accumulated element',
    provenance: 'computed exactly',
    items: [
      { kind: 'formula', formula: L(`k = ${now.accumulatedLabel.plain}`, `k = ${now.accumulatedLabel.tex}`) },
      { kind: 'pairs', rows: [
        { key: L('Moves applied'), value: L(String(m)) },
        { key: L('Every bead home'), value: L(d.atHome ? 'yes (k is the identity)' : 'no') },
        ...(d.atHome ? [] : [{ key: L('Returns every bead home'), value: L(`apply ${operationLabel(d, groupOf(d.definition).inverse(d.accumulated)).plain} (the inverse of k)`) }]),
      ] },
      { kind: 'text', text: 'Applying g, then h gives h·g. The number of moves is not the order of an element when different operations are mixed.' },
    ],
  })
  sections.push({
    title: 'Operation history',
    provenance: 'computed exactly',
    items: m
      ? [{ kind: 'list', items: d.steps.map((s) => L(`${s.index + 1}. ${operationLabel(d, s.element).plain} · slots ${s.cycleText === '()' ? 'unchanged' : s.cycleText} · k = ${groupOf(d.definition).label(s.after).plain}`)) }]
      : [{ kind: 'text', text: 'Nothing applied yet.' }],
  })
  if (d.show.orders) {
    sections.push({
      title: 'Element orders',
      provenance: 'computed exactly',
      items: [
        { kind: 'pairs', rows: d.cards.map((c) => ({ key: L(c.label.plain, c.label.tex), value: L(`order ${c.order}`) })) },
        { kind: 'text', text: d.orders.contrast },
      ],
    })
  } else sections.push(noteSection('Element orders', `This representation does not include element orders (recipe ${d.recipe?.name ?? 'none'}).`))
  sections.push({
    title: 'Cycle decompositions on slots',
    provenance: 'computed exactly',
    items: [
      { kind: 'pairs', rows: d.cards.map((c) => ({ key: L(operationLabel(d, c.element).plain, c.label.tex), value: L(c.cycleText === '()' ? 'every bead stays' : c.cycleText, c.cycleTex === '()' ? undefined : c.cycleTex) })) },
      { kind: 'text', text: 'Applying g moves the bead in slot s to slot g·s.' },
    ],
  })
  sections.push({
    title: 'Identities and slots',
    provenance: 'presentation',
    items: [
      { kind: 'text', text: `Each bead is one element of ${name.plain}: its colour, shape and label never change. Slot i is the home of bead i; after the accumulated element k, bead x sits in slot k·x. Path curvature and distance are presentation only.` },
      { kind: 'pairs', rows: d.beads.map((b) => ({ key: L(`bead ${b.label.plain}`), value: L(`slot ${b.slot}${b.home ? ' (home)' : ''}`) })) },
    ],
  })
  return sections
}

export function presentSculpture(input: PresenterInput): DomainPresentation {
  const d = sceneDesc(input)
  const e = groupExperiment(input)
  if (!d) {
    const problem = problemStatus(input) ?? { phase: 'ready' as const, text: 'The sculpture scene is not shown yet', tone: 'warning' as const }
    return {
      subtitle: L(TOPIC),
      context: EMPTY_CONTEXT,
      status: problem,
      playback: { play: { enabled: false, reason: 'No scene' }, replay: { enabled: false, reason: 'No scene' } },
      resets: [],
      detail: { sections: [] },
      scene: scenePresentation(input),
    }
  }
  const name = groupLabel(d)
  const m = d.history.length
  const { cards, actions, hint } = contextItems(input, d, e)
  const canReplay = m > 0 && d.show.beads
  const noReplay = m === 0 ? 'Nothing applied yet' : 'This representation shows no beads'
  const reset = e ? domainControls(input.doc, e).reset.actions : []
  const resets: ResetItem[] = [{
    id: 'reset',
    label: 'Reset experiment',
    helper: `Empty the ${name.plain} history: every bead returns to its home slot (undoable)`,
    enabled: reset.length > 0,
    reason: reset.length ? undefined : 'Already at the starting arrangement',
    run: actionsRun(reset),
  }]
  return {
    subtitle: topicLabel(TOPIC, name.plain, name.tex!),
    context: {
      title: 'Choose an operation',
      groups: [
        { id: 'operations', layout: 'choices', items: cards },
        { id: 'apply', layout: 'actions', items: actions },
      ],
      hint,
    },
    status: sculptureStatus(input, d),
    playback: {
      play: input.playback.active || canReplay ? { enabled: true } : { enabled: false, reason: noReplay },
      replay: canReplay ? { enabled: true } : { enabled: false, reason: noReplay },
    },
    resets,
    detail: { sections: detailSections(d) },
    scene: scenePresentation(input),
  }
}
