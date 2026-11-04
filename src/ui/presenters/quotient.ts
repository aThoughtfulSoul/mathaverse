// The quotient presenter (UI-REFINEMENT-SPEC section 5, "When do 24 rotations become six?"): changing the
// observation (Show all 24 / Group into classes), selecting a rotation or class on the stage, assigning
// operands (Choose as A / B, Another A / B) and the concise composition result. Grouping is the exact axis
// action pi (src/algebra/cube.ts), never visual proximity.
//
// Values come from the QuotientDesc (src/domains/quotient/derive.ts: its plates carry the exact actions the
// stage would propose) and src/algebra/cube.ts.

import { findAnyExperiment, type GroupExperiment } from '../../workspace/document'
import { domainControls } from '../../demo/four'
import { KERNEL, cubeGroup, piOf } from '../../algebra/cube'
import type { QuotientDesc } from '../../domains/quotient/derive'
import { className } from '../../domains/quotient/derive'
import type { ContextItem, DetailSection, DomainPresentation, PresenterInput, ResetItem, StatusView } from '../model'
import { EMPTY_CONTEXT, L, actionsRun, intRows, phaseOf, prettyPlain, problemStatus, scenePresentation } from './common'

const TOPIC = 'Ignoring axis direction'

function sceneDesc(input: PresenterInput): QuotientDesc | null {
  const s = input.scene
  return s && s.layout === 'quotient' ? (s.desc as QuotientDesc) : null
}

function groupExperiment(input: PresenterInput): GroupExperiment | null {
  try {
    const e = findAnyExperiment(input.doc, input.experimentId)
    return e.domain === 'group' ? e : null
  } catch {
    return null
  }
}

const label = (e: string) => {
  const l = cubeGroup().label(e)
  return { tex: l.tex, plain: prettyPlain(l.plain) }
}
const classOf = (d: QuotientDesc, key: string) => d.classes.find((c) => c.key === key) ?? null
const className_ = (d: QuotientDesc, key: string): string => {
  const c = classOf(d, key)
  return c ? (c.isKernel ? 'K' : c.name.plain) : key
}

/** "A then B: BA = V1 · [B][A] = (x y)" from the exact composition, or null until both operands are chosen. */
export function compositionLine(d: QuotientDesc): string | null {
  const c = d.composition
  if (!c || c.b === null || c.product === null) return null
  const ba = d.panel.find((p) => p.role === 'BA')
  const qba = d.panel.find((p) => p.role === 'qBA')
  return `A then B: ${ba ? prettyPlain(ba.label.plain) : `BA = ${label(c.product).plain}`} · ${qba ? qba.label.plain : `[B][A] = ${className(piOf(c.product)).plain}`}`
}

export function quotientStatus(input: PresenterInput, d: QuotientDesc): StatusView {
  const pb = input.playback
  if (pb.active) {
    const what = pb.step ? `${pb.step.label}${pb.step.count > 1 ? ` (step ${pb.step.index} of ${pb.step.count})` : ''}` : ''
    const target = d.grouped ? 'showing the grouping into 6 classes' : 'showing all 24 rotations'
    return { phase: phaseOf(pb, true), text: `${pb.playing ? 'Animating' : 'Paused'} · ${what} · ${target}`, tone: 'normal' }
  }
  const comp = compositionLine(d)
  if (comp) {
    const ok = d.composition!.agree === true && d.composition!.allChoices?.length === 1
    return { phase: 'result', text: ok ? comp : `${comp} · the class results disagree`, tone: ok ? 'normal' : 'error' }
  }
  const view = d.grouped ? 'Grouped: 24 rotations in 6 classes of 4' : 'All 24 rotations, nothing ignored'
  const [A, B] = d.operands
  const chosen = A !== null ? `A = ${label(A).plain} · choose B` : B !== null ? `B = ${label(B).plain} · choose A` : null
  const sel = d.selectedElement ? `${label(d.selectedElement).plain} selected` : d.selectedClass ? `class ${className_(d, d.selectedClass)} selected` : null
  // One operand chosen is a step towards a result, not a result: the phase stays ready.
  return { phase: 'ready', text: ['Ready', view, chosen ?? sel].filter(Boolean).join(' · '), tone: 'normal' }
}

function context(d: QuotientDesc): { items: { observe: ContextItem[]; compose: ContextItem[] }; hint: string | null } {
  const exp = d.experimentId
  const observe: ContextItem[] = [
    { id: 'observe:none', label: L('Show all 24'), role: 'choice', selected: !d.grouped, enabled: true, hint: 'Show all 24 rotations with their direction marks', run: d.grouped ? { kind: 'actions', actions: [{ kind: 'set_observation', experimentId: exp, observation: 'none' }] } : { kind: 'none' } },
    { id: 'observe:axes', label: L('Group into classes'), role: 'choice', selected: d.grouped, enabled: true, hint: 'Track only which opposite-face pair goes to which axis line', run: d.grouped ? { kind: 'none' } : { kind: 'actions', actions: [{ kind: 'set_observation', experimentId: exp, observation: 'unoriented_axis_lines' }] } },
  ]
  const [A, B] = d.operands
  const sel = d.selectedElement
  // One primary at a time: Choose as A while A is open, then Choose as B.
  const primary = sel === null ? null : A === null ? 'plate:chooseA' : B === null ? 'plate:chooseB' : null
  // "Another A / B" (another representative of the same class) appears once that operand exists.
  const shownPlate = (id: string) => id !== 'plate:observe' && (id !== 'plate:anotherA' || A !== null) && (id !== 'plate:anotherB' || B !== null)
  const compose: ContextItem[] = d.plates.filter((p) => shownPlate(p.id)).map((p) => {
    const isChoose = p.id === 'plate:chooseA' || p.id === 'plate:chooseB'
    const reason = p.enabled ? undefined : isChoose ? (d.selectedClass ? 'Select one rotation of the class first' : 'Select a rotation first') : p.id === 'plate:anotherA' ? 'Choose A first' : 'Choose B first'
    return {
      id: p.id.replace('plate:', ''),
      label: L(p.label),
      role: p.id === primary ? 'primary' : 'secondary',
      enabled: p.enabled,
      reason,
      hint: p.hint,
      run: actionsRun(p.actions),
    }
  })
  let hint: string | null
  if (sel === null && d.selectedClass === null) hint = A === null || B === null ? 'Select a rotation on the stage, then choose it as A or B' : null
  else if (sel === null) hint = `Class ${className_(d, d.selectedClass!)}: select one of its rotations to use it as A or B`
  else hint = null
  return { items: { observe, compose }, hint }
}

function detail(d: QuotientDesc): DetailSection[] {
  const G = cubeGroup()
  const sections: DetailSection[] = []
  sections.push({
    title: 'Observation',
    provenance: 'computed exactly',
    items: [
      { kind: 'text', text: d.grouped
        ? 'Observed: only which unoriented coordinate-axis line (opposite-face pair) goes to which. The 24 proper rotations fall into six classes of four rotations each.'
        : 'Nothing is ignored yet: the 24 proper rotations are all distinct.' },
      { kind: 'text', text: 'This experiment observes the three unoriented coordinate-axis lines (π). The cube experiment observes the four unoriented body-diagonal lines (φ); they are different observations.' },
    ],
  })
  sections.push({
    title: 'Classes and their members',
    provenance: 'computed exactly',
    items: [
      { kind: 'pairs', rows: d.classes.map((c) => ({ key: L(c.isKernel ? 'K (identity class)' : `class ${c.name.plain}`, c.isKernel ? 'K' : c.name.tex), value: L(c.elements.map((e) => label(e).plain).join(', '), c.elements.map((e) => label(e).tex).join(',\\ ')) })) },
      { kind: 'text', text: 'Two rotations are in the same class exactly when they induce the same permutation π of the three axis lines. Any member can represent its class.' },
    ],
  })
  sections.push({
    title: 'Kernel K',
    provenance: 'computed exactly',
    items: [
      { kind: 'list', items: KERNEL.map((e) => L(label(e).plain, label(e).tex)) },
      { kind: 'text', text: 'K is the identity and the three coordinate-axis half-turns: it fixes every axis line, and the six classes are its cosets.' },
    ],
  })
  if (d.selectedElement) {
    const e = d.selectedElement
    const cn = className(piOf(e))
    sections.push({
      title: 'Selected rotation',
      provenance: 'computed exactly',
      items: [
        { kind: 'matrix', label: L(label(e).plain, label(e).tex), rows: intRows(G.matrix(e)!) },
        { kind: 'formula', formula: L(`π(${label(e).plain}) = ${cn.plain}`, `\\pi(${label(e).tex}) = ${cn.tex}`) },
        ...(d.info ? [{ kind: 'text' as const, text: prettyPlain(d.info.plain) }] : []),
      ],
    })
  } else if (d.selectedClass) {
    const c = classOf(d, d.selectedClass)
    if (c) sections.push({ title: `Selected class ${c.isKernel ? 'K' : c.name.plain}`, provenance: 'computed exactly', items: [{ kind: 'text', text: prettyPlain(d.info?.plain ?? '') }] })
  }
  const c = d.composition
  sections.push({
    title: 'Composition',
    provenance: 'computed exactly',
    items: c && c.b !== null && c.product !== null
      ? [
        { kind: 'pairs', rows: [
          { key: L('A'), value: L(`${label(c.a).plain} (class ${className_(d, c.aClass)})`) },
          { key: L('B'), value: L(`${label(c.b).plain} (class ${className_(d, c.bClass!)})`) },
        ] },
        { kind: 'text', text: prettyPlain(c.detail.plain) },
        { kind: 'text', text: prettyPlain(c.quotient.plain) },
        ...(c.check ? [{ kind: 'text' as const, text: `${c.check.plain} (A then B gives BA; on classes [A] then [B] gives [B][A])` }] : []),
      ]
      : [{ kind: 'text', text: c ? prettyPlain(c.detail.plain) : 'Choose A and B to compose: A then B gives BA.' }],
  })
  return sections
}

export function presentQuotient(input: PresenterInput): DomainPresentation {
  const d = sceneDesc(input)
  const e = groupExperiment(input)
  if (!d) {
    return {
      subtitle: L(TOPIC),
      context: EMPTY_CONTEXT,
      status: problemStatus(input) ?? { phase: 'ready', text: 'The quotient scene is not shown yet', tone: 'warning' },
      playback: { play: { enabled: false, reason: 'No scene' }, replay: { enabled: false, reason: 'No scene' } },
      resets: [],
      detail: { sections: [] },
      scene: scenePresentation(input),
    }
  }
  const { items, hint } = context(d)
  const reset = e ? domainControls(input.doc, e).reset.actions : []
  const clears = reset.map((a) => (a as { kind: string }).kind)
  const helper = clears.includes('reset_group') && clears.includes('set_operands')
    ? 'Clear the chosen A and B and the operation history; the observation stays (undoable)'
    : clears.includes('set_operands') ? 'Clear the chosen A and B; the observation stays (undoable)' : 'Empty the operation history; the observation stays (undoable)'
  const resets: ResetItem[] = [{ id: 'reset', label: 'Reset experiment', helper, enabled: reset.length > 0, reason: reset.length ? undefined : 'Nothing chosen yet', run: actionsRun(reset) }]
  const replay = d.grouped ? { enabled: true } : { enabled: false, reason: 'Group into classes first: the replay shows the regrouping' }
  return {
    subtitle: L(TOPIC),
    context: {
      title: 'Choose what to observe',
      groups: [
        { id: 'observe', label: 'Observation', layout: 'choices', items: items.observe },
        { id: 'compose', label: 'Compose', layout: 'actions', items: items.compose },
      ],
      hint,
    },
    status: quotientStatus(input, d),
    playback: { play: input.playback.active ? { enabled: true } : replay, replay },
    resets,
    detail: { sections: detail(d) },
    scene: scenePresentation(input),
  }
}
