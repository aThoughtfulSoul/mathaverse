// The proof-lesson presenter (PROOF-EXPLORER-SPEC sections 3, 6, 7; "How does rearranging these steps keep us
// closer to home?"). The step strip Walk → Signs → Reorder → Why → Assumptions is presentation (a `stage` run,
// never a transaction); sign flips, endpoint selection and case changes are validated actions, so Undo and
// persistence cover them. Every number comes from the exact derivation (src/algebra/walk.ts) of the CURRENT
// document; the lesson words come from src/lessons/steinitz/copy.ts and the provenance from source.ts.
// Bounds are always called bounds; actual peaks are labelled separately with an approximation marker.

import { findAnyExperiment, type VectorWalkExperiment, walkInputOf } from '../../workspace/document'
import { type WalkFacts, type PrefixWitness, deriveWalk, parseWalkItem, representativeEndpoints, approxSqrt, isqrt, vtext } from '../../algebra/walk'
import { type Q, format, mul } from '../../model/rational'
import { WALK_STAGES, type WalkStage } from '../../domains/inputs'
import { CASES, arrowNames, caseOf, hasHeroVectors } from '../../lessons/steinitz/cases'
import { LESSON_SUBTITLE, STAGE_COPY, WHY_BRANCH, WHY_LEAD, WHY_NEGATIVE_OPEN, COUNTEREXAMPLE_COPY, NO_IMPROVEMENT_COPY, BOUND_NOTE } from '../../lessons/steinitz/copy'
import { LESSON_SOURCE, EVIDENCE_LEVELS } from '../../lessons/steinitz/source'
import { allPositiveActions, caseActions, endpointActions, flipSignActions, preparedSignsActions } from '../../demo/proof'
import { endpointBound } from '../../workspace/context'
import type { ContextGroup, ContextItem, DetailItem, DetailSection, DomainPresentation, EvidenceItem, PresenterInput, ResetItem, StatusView } from '../model'
import { EMPTY_CONTEXT, L, actionsRun, phaseOf, problemStatus, scenePresentation } from './common'

const SUB = '₀₁₂₃₄₅₆₇₈₉'
const sub = (n: number) => String(n).split('').map((c) => SUB[Number(c)]).join('')
const approx = (x: number) => `≈ ${x.toFixed(3)}`
const signGlyph = (s: 1 | -1) => (s === 1 ? '+' : '−')

/** A rational as a short decimal when it has one (3/2 -> "1.5"), else its exact fraction. */
function decimalText(x: Q): string {
  let d = x.d
  while (d % 2n === 0n) d /= 2n
  while (d % 5n === 0n) d /= 5n
  return d === 1n ? String(Number(x.n) / Number(x.d)) : format(x)
}

/** The length with this exact square: exact when it is a perfect rational square (4 -> "2"), else ≈. */
function lengthText(sq: Q): string {
  const rn = isqrt(sq.n)
  const rd = isqrt(sq.d)
  return rn * rn === sq.n && rd * rd === sq.d ? decimalText({ n: rn, d: rd }) : approx(approxSqrt(sq))
}

function walkExperiment(input: PresenterInput): VectorWalkExperiment | null {
  try {
    const e = findAnyExperiment(input.doc, input.experimentId)
    return e.domain === 'vector_walk' ? e : null
  } catch {
    return null
  }
}

/** An arrow's name as the scene labels it (a₁ … −c₂ on the hero's arrows, else its ID), from the shared
 * arrowNames(): presentation only; actions keep the ID. */
function occurrenceName(e: VectorWalkExperiment, id: string): string {
  return arrowNames(walkInputOf(e)).get(id) ?? id
}

interface Selection {
  kind: 'source' | 'signed' | 'reordered' | 'vector' | null
  index: number | null
  id: string | null
}

function selectionOf(input: PresenterInput, e: VectorWalkExperiment): Selection {
  if (input.doc.selection.experimentId !== e.id) return { kind: null, index: null, id: null }
  try {
    const it = parseWalkItem(input.doc.selection.item, e)
    if (!it) return { kind: null, index: null, id: null }
    return it.kind === 'vector' ? { kind: 'vector', index: null, id: it.id } : { kind: it.kind, index: it.index, id: null }
  } catch {
    return { kind: null, index: null, id: null }
  }
}

function caseTitle(e: VectorWalkExperiment): string {
  const c = caseOf(walkInputOf(e))
  if (c) return CASES[c].title
  return hasHeroVectors(walkInputOf(e)) ? 'Closed 3D walk · edited signs' : 'Edited walk'
}

/** "W₃ = (U₅ + S₅)/2" for a witness. */
function identityText(w: PrefixWitness, zeroSum: boolean): string {
  const k = sub(w.k)
  const j = sub(w.j)
  if (w.branch === 'positive') return `W${k} = (U${j} + S${j})/2`
  return zeroSum ? `W${k} = (S${j} − U${j})/2` : `W${k} = T + (S${j} − U${j})/2`
}

function identityTex(w: PrefixWitness, zeroSum: boolean): string {
  if (w.branch === 'positive') return `W_{${w.k}} = \\tfrac{1}{2}(U_{${w.j}} + S_{${w.j}})`
  return zeroSum ? `W_{${w.k}} = \\tfrac{1}{2}(S_{${w.j}} - U_{${w.j}})` : `W_{${w.k}} = T + \\tfrac{1}{2}(S_{${w.j}} - U_{${w.j}})`
}

function boundsLine(f: WalkFacts): string {
  return `source bound ${f.B} · signed bound ${f.D} · new bound ${format(f.R)}`
}

function stageStatus(input: PresenterInput, e: VectorWalkExperiment, f: WalkFacts, stage: WalkStage, sel: Selection): StatusView {
  const pb = input.playback
  if (pb.active) {
    const what = stage === 'reorder' ? 'showing the rearrangement (the bound is stated once the arrows settle)' : stage === 'signs' ? 'flipping the signed copies' : stage === 'why' ? 'building the two half-sized arrows' : stage === 'assumptions' ? 'showing the open walk' : 'tracing the walk'
    return { phase: phaseOf(pb, false), text: `${pb.playing ? 'Playing' : 'Paused'} · ${what}`, tone: 'normal' }
  }
  if (!f.zeroSum) {
    const k = f.firstFailure
    const fail = k !== null ? ` Here, ${lengthText(f.wNorm2[k]!)} exceeds ${decimalText(f.R)}.` : ''
    return { phase: 'result', text: `${COUNTEREXAMPLE_COPY}${fail}`, tone: 'warning' }
  }
  switch (stage) {
    case 'walk':
      return { phase: 'ready', text: `${f.n} arrows return home · peak ${approx(approxSqrt(f.sourcePeak2))} inside source bound ${f.B}`, tone: 'normal' }
    case 'signs':
      return { phase: 'ready', text: `Signed walk stays within signed bound ${f.D} (peak ${approx(approxSqrt(f.signedPeak2))}) · signs ${f.signs.map(signGlyph).join(' ')}`, tone: 'normal' }
    case 'reorder': {
      const cmp = f.comparison === 'better' ? `new bound ${format(f.R)} (source bound ${f.B})` : f.comparison === 'same' ? `${NO_IMPROVEMENT_COPY} New bound ${format(f.R)} = source bound ${f.B}` : `new bound ${format(f.R)} is weaker than source bound ${f.B}`
      return { phase: 'result', text: `Same arrows, new order · ${cmp} · actual peak ${approx(approxSqrt(f.reorderedPeak2))}`, tone: 'normal' }
    }
    case 'why': {
      if (sel.kind !== 'reordered' || sel.index === null) return { phase: 'ready', text: 'Select a point of the new walk to see why it is inside the new bound', tone: 'normal' }
      const w = f.witnesses[sel.index]!
      return { phase: 'result', text: `${identityText(w, f.zeroSum)} · |W${sub(w.k)}| ≤ (${f.B} + ${f.D})/2 = ${format(f.R)} · ${w.branch === 'positive' ? 'positive' : 'negative'} part`, tone: 'normal' }
    }
    case 'assumptions':
      return { phase: 'result', text: `All three hypotheses hold: total zero, source bound ${f.B}, signed bound ${f.D}`, tone: 'normal' }
  }
  void e
}

function stageGroup(stage: WalkStage): ContextGroup {
  return {
    id: 'steps',
    label: 'Step',
    layout: 'choices',
    items: WALK_STAGES.map((s) => ({ id: `stage:${s}`, label: L(STAGE_COPY[s].label), role: 'choice' as const, selected: s === stage, enabled: true, hint: STAGE_COPY[s].lead, run: s === stage ? { kind: 'none' as const } : { kind: 'stage' as const, stage: s } })),
  }
}

function stageItems(e: VectorWalkExperiment, f: WalkFacts, stage: WalkStage, sel: Selection): { items: ContextItem[]; hint: string } {
  const ends = representativeEndpoints(f)
  const items: ContextItem[] = []
  let hint = STAGE_COPY[stage].lead
  const checkItem = (): ContextItem => (f.zeroSum
    ? { id: 'check', label: L('Check in Lean'), role: 'secondary', enabled: true, hint: 'Lean checks this finite example only: every prefix, both bounds and the new order', run: { kind: 'check', claim: { kind: 'walk_reorder_instance', experimentId: e.id } } }
    : { id: 'check', label: L('Check in Lean'), role: 'secondary', enabled: false, reason: 'The return-to-start assumption is missing: nothing to certify', run: { kind: 'none' } })
  switch (stage) {
    case 'walk': {
      items.push({ id: 'peak', label: L('Show the farthest point'), role: 'secondary', enabled: true, hint: `U${sub(f.sourcePeakAt)}, ${approx(approxSqrt(f.sourcePeak2))} from home`, run: actionsRun([{ kind: 'select_item', experimentId: e.id, item: `walk:source:${f.sourcePeakAt}` }]) })
      items.push({ id: 'next', label: L('Next: signs'), role: 'primary', enabled: true, run: { kind: 'stage', stage: 'signs' } })
      break
    }
    case 'signs': {
      const id = sel.kind === 'vector' ? sel.id : null
      const i = id ? e.vectors.findIndex((v) => v.id === id) : -1
      items.push(id && i >= 0
        ? { id: 'flip', label: L(`Flip sign of ${occurrenceName(e, id)}`), role: 'primary', enabled: true, hint: `Now ${signGlyph(e.signs[i]!)}; the bound can improve, stay the same or get worse`, run: actionsRun(flipSignActions(e, id)) }
        : { id: 'flip', label: L('Flip a sign'), role: 'primary', enabled: false, reason: 'Select an arrow first', run: { kind: 'none' } })
      const prepared = preparedSignsActions(e)
      items.push({ id: 'prepared', label: L('Prepared signs'), role: 'secondary', enabled: prepared.length > 0, reason: prepared.length ? undefined : hasHeroVectors(walkInputOf(e)) ? 'Already the prepared signs' : 'Prepared signs belong to the 3D walk', run: actionsRun(prepared) })
      const allPos = allPositiveActions(e)
      items.push({ id: 'all-positive', label: L('Every sign +'), role: 'secondary', enabled: allPos.length > 0, reason: allPos.length ? undefined : 'Every sign is already +', hint: 'A valid case with no improvement', run: actionsRun(allPos) })
      hint = id ? `${occurrenceName(e, id)} (source step ${f.ids.indexOf(id) + 1}) is ${signGlyph(e.signs[i]!)} · signed bound ${f.D}` : 'Select an arrow to flip its sign. Signs label arrows; only the signed walk flips copies.'
      break
    }
    case 'reorder':
      items.push({ id: 'show', label: L('Show the rearrangement'), role: 'primary', enabled: true, run: { kind: 'playback', command: 'replay' } })
      items.push({ id: 'next', label: L('Next: why'), role: 'secondary', enabled: true, run: ends.positive !== null ? actionsRun(endpointActions(e, ends.positive, 'why')) : { kind: 'stage', stage: 'why' } })
      hint = f.comparison === 'same' ? NO_IMPROVEMENT_COPY : `${boundsLine(f)}. ${BOUND_NOTE}`
      break
    case 'why': {
      const k = sel.kind === 'reordered' ? sel.index : null
      items.push({ id: 'prev', label: L('◀ Previous point'), ariaLabel: 'Previous point of the new walk', role: 'secondary', enabled: k !== null && k > 0, reason: k === null ? 'Select a point first' : 'Already at the start', run: k !== null && k > 0 ? actionsRun(endpointActions(e, k - 1)) : { kind: 'none' } })
      items.push({ id: 'next-point', label: L('Next point ▶'), ariaLabel: 'Next point of the new walk', role: 'secondary', enabled: k !== null && k < f.n, reason: k === null ? 'Select a point first' : 'Already at the end', run: k !== null && k < f.n ? actionsRun(endpointActions(e, k + 1)) : { kind: 'none' } })
      items.push(ends.positive !== null
        ? { id: 'positive', label: L(`+ part · W${sub(ends.positive)}`), role: 'choice', selected: k === ends.positive, enabled: true, hint: 'A point whose witness is the positive branch', run: k === ends.positive ? { kind: 'none' } : actionsRun(endpointActions(e, ends.positive)) }
        : { id: 'positive', label: L('+ part'), role: 'secondary', enabled: false, reason: 'No + arrows in this walk', run: { kind: 'none' } })
      items.push(ends.negative !== null
        ? { id: 'negative', label: L(`− part · W${sub(ends.negative)}`), role: 'choice', selected: k === ends.negative, enabled: true, hint: 'A point whose witness is the negative branch', run: k === ends.negative ? { kind: 'none' } : actionsRun(endpointActions(e, ends.negative)) }
        : { id: 'negative', label: L('− part'), role: 'secondary', enabled: false, reason: 'No − arrows in this walk', run: { kind: 'none' } })
      items.push(checkItem())
      if (k !== null) {
        const w = f.witnesses[k]!
        const branchCopy = w.branch === 'positive' ? WHY_BRANCH.positive : f.zeroSum ? WHY_BRANCH.negative : WHY_NEGATIVE_OPEN
        hint = `${identityText(w, f.zeroSum)}. ${branchCopy.replace(/\bk\b/, String(k)).replace(/\bj\b/, String(w.j))}`
      } else hint = 'Select a point of the new walk (or choose the + part or − part example).'
      break
    }
    case 'assumptions': {
      const shown = caseOf(walkInputOf(e))
      items.push(shown === 'open-two'
        ? { id: 'restore', label: L('Restore example'), role: 'primary', enabled: true, hint: 'Back to the closed 3D walk (undoable)', run: actionsRun(caseActions(e, 'hero')) }
        : { id: 'open', label: L('Why must it return home?'), role: 'primary', enabled: true, hint: 'Open the two-arrow example without the return-to-start assumption', run: actionsRun(caseActions(e, 'open-two')) })
      items.push({ id: 'simpler', label: L(CASES['line-six'].title), role: 'choice', selected: shown === 'line-six', enabled: true, hint: CASES['line-six'].note, run: shown === 'line-six' ? { kind: 'none' } : actionsRun(caseActions(e, 'line-six')) })
      if (shown !== 'hero' && shown !== 'open-two') items.push({ id: 'hero', label: L(CASES.hero.title), role: 'secondary', enabled: true, run: actionsRun(caseActions(e, 'hero')) })
      items.push(checkItem())
      hint = f.zeroSum ? `Hypotheses: the walk returns home (total zero), every source point within ${f.B}, every signed point within ${f.D}. ${LESSON_SOURCE.assumptions.theoremOnly[0]}` : `${COUNTEREXAMPLE_COPY} Residual T = ${vtext(f.total)}; the proposed bound ${format(f.R)} fails.`
      break
    }
  }
  return { items, hint }
}

/**
 * The heading of the selected endpoint's explanation, from its actual result: "Why W₉ is inside the new bound"
 * (closed walk), "W₂ is outside the proposed bound", and on an open walk "Why W₁ is inside the proposed bound"
 * (positive part: a valid calculation without a zero total) or "W₁ happens to be inside the proposed bound"
 * (negative part with a residual T: nothing guarantees it).
 */
export function whyTitle(f: Pick<WalkFacts, 'zeroSum' | 'witnesses'>, k: number): string {
  const w = f.witnesses[k]!
  const Wk = `W${sub(w.k)}`
  if (!w.withinBound) return `${Wk} is outside the proposed bound`
  if (f.zeroSum) return `Why ${Wk} is inside the new bound`
  return w.branch === 'positive' ? `Why ${Wk} is inside the proposed bound` : `${Wk} happens to be inside the proposed bound`
}

/**
 * The selected endpoint W_k: a plain-language lead, the exact identity of its witness, the exact squared
 * comparison with R² and (labelled separately) its length against R, then the branch's precise step. The
 * calculation for this endpoint is kept apart from the applicability of the whole lemma.
 */
function whySection(f: WalkFacts, k: number, name: (i: number) => string): DetailSection {
  const w = f.witnesses[k]!
  const U = f.U[w.j]!
  const S = f.S[w.j]!
  const [Wk, Uj, Sj] = [`W${sub(w.k)}`, `U${sub(w.j)}`, `S${sub(w.j)}`]
  const r = decimalText(f.R)
  const positive = w.branch === 'positive'
  const bound = endpointBound(f, w.k)
  const lead = w.k === 0 ? WHY_LEAD.start : f.zeroSum ? WHY_LEAD.inside : positive ? WHY_LEAD.positiveOpen : WHY_LEAD.negativeOpen
  const counted = w.counted.map(name).join(' ') || 'none'
  const items: DetailItem[] = [
    { kind: 'text', text: lead },
    { kind: 'formula', formula: L(identityText(w, f.zeroSum), identityTex(w, f.zeroSum)) },
    { kind: 'pairs', rows: [
      { key: L(Wk), value: L(vtext(f.W[w.k]!)) },
      { key: L(`${Uj} (source, first ${w.j} steps)`), value: L(`${vtext(U)} · |U|² = ${format(f.uNorm2[w.j]!)} ≤ ${f.B}²`) },
      { key: L(`${Sj} (signed, first ${w.j} steps)`), value: L(`${vtext(S)} · |S|² = ${format(f.sNorm2[w.j]!)} ≤ ${f.D}²`) },
      { key: L(positive ? `+ arrows among the first ${w.j} steps` : `− arrows among the first ${w.j} steps (not used yet)`), value: L(counted) },
      ...(f.zeroSum ? [] : [{ key: L('Residual T'), value: L(`${vtext(f.total)} (not zero: the assumption is missing)`) }]),
      { key: L('Exact (squared lengths)'), value: L(bound.squared) },
      { key: L(bound.lengthExact ? 'Length' : 'Length (approximate)'), value: L(bound.length) },
    ] },
  ]
  if (positive) {
    items.push({ kind: 'formula', formula: L(`|${Wk}| = |${Uj} + ${Sj}|/2 ≤ (|${Uj}| + |${Sj}|)/2 ≤ (B + D)/2 = ${r}`, `\\lVert W_{${w.k}}\\rVert = \\tfrac{1}{2}\\lVert U_{${w.j}} + S_{${w.j}}\\rVert \\le \\tfrac{1}{2}(\\lVert U_{${w.j}}\\rVert + \\lVert S_{${w.j}}\\rVert) \\le \\tfrac{B + D}{2}`) })
    items.push({ kind: 'text', text: `Positive part (signed_parts: 2P = U + S). ${f.zeroSum ? 'By the triangle inequality, half the two bounds combined contains this point.' : `This calculation is valid for ${Wk}: the identity ${Wk} = (${Uj} + ${Sj})/2 and its triangle-inequality bound do not need a zero total.`} Source: ${LESSON_SOURCE.declaration.name}.` })
  } else if (f.zeroSum) {
    items.push({ kind: 'formula', formula: L(`|${Wk}| = |${Sj} − ${Uj}|/2 ≤ (|${Sj}| + |${Uj}|)/2 ≤ (B + D)/2 = ${r}`, `\\lVert W_{${w.k}}\\rVert = \\tfrac{1}{2}\\lVert S_{${w.j}} - U_{${w.j}}\\rVert \\le \\tfrac{1}{2}(\\lVert S_{${w.j}}\\rVert + \\lVert U_{${w.j}}\\rVert) \\le \\tfrac{B + D}{2}`) })
    items.push({ kind: 'text', text: `Negative part (signed_parts: 2M = U − S): ${Wk} = T + (${Sj} − ${Uj})/2, and the walk returns home (T = 0), so T is dropped. Source: ${LESSON_SOURCE.declaration.name}.` })
  } else {
    items.push({ kind: 'formula', formula: L(`${Wk} = T + (${Sj} − ${Uj})/2 = ${vtext(w.residual)} + ${vtext(w.halfSum)} = ${vtext(f.W[w.k]!)}`) })
    items.push({ kind: 'text', text: `Negative part (signed_parts: 2M = U − S). The triangle inequality is still valid: it bounds (${Sj} − ${Uj})/2 by (B + D)/2 = ${r}. Dropping T to reach ${Wk} requires a zero total, and here T = ${vtext(f.total)} is not zero, so that bound is not guaranteed for ${Wk}. Source: ${LESSON_SOURCE.declaration.name}.` })
  }
  // The whole lemma, kept apart from this endpoint's calculation: it needs the walk to return home.
  if (!f.zeroSum) items.push({ kind: 'text', text: `The whole lemma, separately: ${COUNTEREXAMPLE_COPY} Its hypothesis that the walk returns to its start fails (T = ${vtext(f.total)}), so it guarantees nothing about the new walk as a whole${positive && w.withinBound ? `, even though the calculation for ${Wk} is valid` : ''}.` })
  return { title: whyTitle(f, k), provenance: 'computed exactly', items }
}

/** Evidence entries about this walk's finite claim (walk_reorder_instance on this experiment) only. */
function walkEvidence(all: EvidenceItem[], experimentId: string): EvidenceItem[] {
  return all.filter((x) => x.claim?.kind === 'walk_reorder_instance' && x.claim.experimentId === experimentId)
}

/** A current receipt: a successful server check of this exact walk claim, still matching the current data. */
const isCurrentReceipt = (x: EvidenceItem) => x.status === 'checked' && x.current && x.provenance !== null

/**
 * The Lean section. The "Lean receipt" badge appears only with a current receipt for this exact walk claim;
 * a receipt for earlier data is labelled historical (no badge), and unchecked, pending, refused or failed
 * checks carry no receipt badge. Lean certifies the stated finite claim only.
 */
function leanSection(e: VectorWalkExperiment, f: WalkFacts, all: EvidenceItem[]): DetailSection {
  const mine = walkEvidence(all, e.id)
  const current = mine.some(isCurrentReceipt)
  const historical = mine.some((x) => x.status === 'checked' && !x.current)
  const pending = mine.some((x) => x.status === 'checking' && x.current)
  const failed = mine.some((x) => x.current && (x.status === 'error' || x.status === 'not_established' || x.status === 'not_sent'))
  const scope = 'A check covers these exact vectors and signs only: not the general lemma, the research theorem, the animation or any explanation.'
  const lines: string[] = []
  if (!mine.length) lines.push(`Not checked yet. ${scope}`)
  if (current) lines.push(`Current receipt: Lean checked this finite claim for the walk shown now. ${scope}`)
  else {
    if (pending) lines.push('Checking: no receipt yet.')
    if (failed) lines.push('No receipt: the latest check for this data did not succeed.')
    if (historical) lines.push(`Historical receipt: it was issued for earlier data (other vectors or signs), not for the walk shown now. ${f.zeroSum ? 'Check this example again for the current data.' : 'The walk shown now cannot be checked: the return-to-start assumption is missing.'}`)
  }
  return {
    title: 'Lean check of this finite example',
    ...(current ? { provenance: 'Lean receipt' as const } : {}),
    items: [
      ...(mine.length ? [{ kind: 'evidence' as const, items: mine }] : []),
      ...lines.map((text) => ({ kind: 'text' as const, text })),
      f.zeroSum
        ? { kind: 'action' as const, id: 'check-detail', label: L('Check this example in Lean'), enabled: true, run: { kind: 'check' as const, claim: { kind: 'walk_reorder_instance' as const, experimentId: e.id } } }
        : { kind: 'action' as const, id: 'check-detail', label: L('Check this example in Lean'), enabled: false, reason: 'The return-to-start assumption is missing', run: { kind: 'none' as const } },
    ],
  }
}

function detail(input: PresenterInput, e: VectorWalkExperiment, f: WalkFacts, sel: Selection): DetailSection[] {
  const sections: DetailSection[] = []
  sections.push({
    title: 'What this lesson covers',
    provenance: 'published source',
    items: [
      { kind: 'formula', formula: L(LESSON_SOURCE.coverageLine) },
      { kind: 'text', text: `This explains one step of the larger proof: ${LESSON_SOURCE.declaration.role}` },
      { kind: 'text', text: LESSON_SOURCE.origin },
    ],
  })
  const R2 = mul(f.R, f.R)
  const names = arrowNames(walkInputOf(e))
  /** The scene's name of the arrow at a source position. */
  const name = (i: number) => names.get(f.ids[i]!) ?? f.ids[i]!
  sections.push({
    title: 'This walk',
    provenance: 'computed exactly',
    items: [
      { kind: 'pairs', rows: [
        { key: L('Example'), value: L(caseTitle(e)) },
        { key: L('Arrows'), value: L(`${f.n} in ${f.dimension}D`) },
        { key: L('Signs'), value: L(f.signs.map(signGlyph).join(' ')) },
        { key: L('Total T'), value: L(`${vtext(f.total)} · ${f.zeroSum ? 'home' : 'not home'}`) },
        { key: L('Source bound B'), value: L(String(f.B)) },
        { key: L('Actual source peak'), value: L(`${approx(approxSqrt(f.sourcePeak2))} · |U${sub(f.sourcePeakAt)}|² = ${format(f.sourcePeak2)}`) },
        { key: L('Signed bound D'), value: L(String(f.D)) },
        { key: L('Actual signed peak'), value: L(`${approx(approxSqrt(f.signedPeak2))} · |S${sub(f.signedPeakAt)}|² = ${format(f.signedPeak2)}`) },
        { key: L('New bound (B + D)/2'), value: L(format(f.R), `\\tfrac{B + D}{2} = ${format(f.R)}`) },
        { key: L('Actual new peak'), value: L(`${approx(approxSqrt(f.reorderedPeak2))} · |W${sub(f.reorderedPeakAt)}|² = ${format(f.reorderedPeak2)}`) },
        { key: L('New order (+ arrows | − arrows reversed)'), value: L(`${f.positive.map(name).join(' ') || '(no + arrows)'} | ${[...f.negative].reverse().map(name).join(' ') || '(no − arrows)'}`) },
        { key: L('All new points within'), value: L(f.boundHolds ? `yes · |W_k|² ≤ ${format(R2)} = R², k = 0…${f.n}` : `no · |W${sub(f.firstFailure!)}|² = ${format(f.wNorm2[f.firstFailure!]!)} > ${format(R2)} = R²`) },
      ] },
      { kind: 'text', text: BOUND_NOTE },
    ],
  })
  if (sel.kind === 'reordered' && sel.index !== null) sections.push(whySection(f, sel.index, name))
  sections.push(leanSection(e, f, input.evidence))
  sections.push({
    title: 'Source',
    provenance: 'published source',
    items: [
      { kind: 'pairs', rows: [
        { key: L('Paper'), value: L(`${LESSON_SOURCE.title} · ${LESSON_SOURCE.author}, ${LESSON_SOURCE.date}`) },
        { key: L('Formal lemma'), value: L(LESSON_SOURCE.declaration.name) },
        { key: L('Commit'), value: L(`${LESSON_SOURCE.repository} @ ${LESSON_SOURCE.commit.slice(0, 12)}`) },
        { key: L('Where'), value: L(`${LESSON_SOURCE.file} · ${LESSON_SOURCE.paperSection}`) },
        { key: L('License'), value: L(LESSON_SOURCE.license) },
      ] },
      { kind: 'list', items: [...LESSON_SOURCE.assumptions.lemma.map((a) => L(`Hypothesis: ${a}`)), ...LESSON_SOURCE.assumptions.theoremOnly.map((a) => L(`Theorem only: ${a}`))] },
      { kind: 'list', items: LESSON_SOURCE.supporting.map((d) => L(`${d.name.replace('OAI.EuclideanSteinitzBergstrom.', '')}: ${d.role}`)) },
      { kind: 'text', text: `Links: ${LESSON_SOURCE.declaration.url}` },
      { kind: 'text', text: 'Source provenance is not a local Lean run of the research project; that build was not run here.' },
    ],
  })
  sections.push({
    title: 'Where it leads',
    provenance: 'published source',
    items: [{ kind: 'text', text: LESSON_SOURCE.minimality }],
  })
  sections.push({
    title: 'Three kinds of statement',
    provenance: 'presentation',
    items: [{ kind: 'list', items: [L(EVIDENCE_LEVELS.published), L(EVIDENCE_LEVELS.computed), L(EVIDENCE_LEVELS.checked)] }],
  })
  return sections
}

export function presentProof(input: PresenterInput): DomainPresentation {
  const e = walkExperiment(input)
  const stage: WalkStage = input.lesson?.stage ?? 'walk'
  if (!e) {
    return {
      subtitle: L(LESSON_SUBTITLE),
      context: EMPTY_CONTEXT,
      status: problemStatus(input) ?? { phase: 'ready', text: 'The lesson is not shown yet', tone: 'warning' },
      playback: { play: { enabled: false, reason: 'No scene' }, replay: { enabled: false, reason: 'No scene' } },
      resets: [],
      detail: { sections: [] },
      scene: scenePresentation(input),
    }
  }
  const f = deriveWalk(walkInputOf(e))
  const sel = selectionOf(input, e)
  const { items, hint } = stageItems(e, f, stage, sel)
  const problem = problemStatus(input)
  const shown = caseOf(walkInputOf(e))
  const prepared = preparedSignsActions(e)
  const resets: ResetItem[] = [
    { id: 'restore', label: 'Restore example', helper: 'Show the closed 3D walk with its prepared signs (undoable)', enabled: shown !== 'hero', reason: shown === 'hero' ? 'The example is shown unchanged' : undefined, run: shown === 'hero' ? { kind: 'none' } : actionsRun(caseActions(e, 'hero')) },
    { id: 'prepared-signs', label: 'Restore prepared signs', helper: 'Return the 3D walk’s signs to + − + − … (undoable)', enabled: prepared.length > 0, reason: prepared.length ? undefined : 'Already the prepared signs', run: actionsRun(prepared) },
  ]
  return {
    subtitle: L(LESSON_SUBTITLE),
    context: {
      title: `${caseTitle(e)} · ${STAGE_COPY[stage].label}`,
      groups: [stageGroup(stage), { id: 'stage-actions', layout: 'actions', items }],
      hint,
    },
    status: problem ?? stageStatus(input, e, f, stage, sel),
    playback: { play: { enabled: true }, replay: { enabled: true } },
    resets,
    detail: { sections: detail(input, e, f, sel) },
    scene: scenePresentation(input),
  }
}
