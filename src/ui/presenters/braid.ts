// The braid presenter (UI-REFINEMENT-SPEC sections 5, 6, "Can different moves make the same braid?"):
// crossing selection on the stage (displayed crossing 1 = internal index 0), the rewrite action named by its
// rule with invalid rules disabled and a short reason, and the example switcher. Append and invert are
// word-editing tools under Show mathematics; clearing to the identity is the More reset "Clear braid". The short
// status keeps the engine's distinctions: identical words, a witnessed rewrite, inequality by an invariant, and
// "Same endpoints; equivalence not established".
//
// Values come from the BraidDesc (src/domains/braid/derive.ts: options are checked with applyRewrite) and
// src/algebra/braid.ts; the prepared examples and the restore action from src/demo/four.ts.

import { findAnyExperiment, type BraidExperiment } from '../../workspace/document'
import { BRAID_EXAMPLES, braidExampleIndex, domainControls } from '../../demo/four'
import { type Generator, MAX_BRAID_LENGTH, wordTex, wordText } from '../../algebra/braid'
import type { BraidDesc, BraidOptionDesc, BraidWordDesc } from '../../domains/braid/derive'
import { primaryRewrite, rewriteSpan } from '../../domains/braid/span'
import type { ContextItem, DetailItem, DetailSection, DomainPresentation, PresenterInput, ResetItem, StatusView } from '../model'
import { EMPTY_CONTEXT, L, actionsRun, count, phaseOf, problemStatus, scenePresentation } from './common'

const TOPIC = 'Three-strand braids'

/** Names of the prepared examples, by BRAID_EXAMPLES name. */
const EXAMPLE_NAMES: Record<string, string> = { relation: 'Braid relation', double: 'Double crossing', cancel: 'Inverse pair' }

/** The exact limitation wording the simplified view must keep (spec section 5). */
export const NOT_ESTABLISHED = 'Same endpoints; equivalence not established'

function sceneDesc(input: PresenterInput): BraidDesc | null {
  const s = input.scene
  return s && s.layout === 'braid' ? (s.desc as BraidDesc) : null
}

function braidExperiment(input: PresenterInput): BraidExperiment | null {
  try {
    const e = findAnyExperiment(input.doc, input.experimentId)
    return e.domain === 'braid' ? e : null
  } catch {
    return null
  }
}

const span = (o: BraidOptionDesc): string => {
  const s = rewriteSpan(o)
  return s.length ? `crossings ${s.at + 1}–${s.at + s.length}` : `before crossing ${o.at + 1}`
}

/** One short line from the exact verdict (never "Same braid" without identical words). */
export function braidResultLine(d: BraidDesc): { text: string; decided: boolean; tone: StatusView['tone'] } {
  const n = d.rewrites.length
  const w = wordText(d.main.word)
  const v = d.verdict
  if (v && d.compare) {
    const c = wordText(d.compare.word)
    if (v.kind === 'identical') {
      return d.status.originEqualsCompareByRewrites
        ? { text: `Same braid: ${wordText(d.origin)} becomes ${c} by ${count(n, 'supported rewrite')} (checked)`, decided: true, tone: 'normal' }
        : { text: 'Identical words: the same braid', decided: true, tone: 'normal' }
    }
    if (v.kind === 'different') {
      return v.invariant === 'exponent_sum'
        ? { text: `Different braids: exponent sums differ (${d.main.exponentSum} vs ${d.compare.exponentSum})`, decided: true, tone: 'normal' }
        : { text: `Different braids: endpoints differ (${d.main.arrival.join(' ')} vs ${d.compare.arrival.join(' ')})`, decided: true, tone: 'normal' }
    }
    return { text: `${NOT_ESTABLISHED} · ${w} vs ${c}${n ? ` after ${count(n, 'rewrite')}` : ''}`, decided: false, tone: 'normal' }
  }
  if (n) return { text: `${w} equals ${wordText(d.origin)} by ${count(n, 'supported rewrite')} (checked)`, decided: true, tone: 'normal' }
  return { text: d.main.word.length ? `${w} · E = ${d.main.exponentSum}` : 'Identity braid: no crossings', decided: false, tone: 'normal' }
}

const MOTION: Record<string, string> = { relation: 'applying the braid relation', cancel: 'cancelling an inverse pair', insert: 'inserting an inverse pair', append: 'appending a crossing' }

export function braidStatus(input: PresenterInput, d: BraidDesc): StatusView {
  const pb = input.playback
  const r = braidResultLine(d)
  if (pb.active) {
    if (pb.phase === 'replay') return { phase: phaseOf(pb, r.decided), text: `${pb.playing ? 'Replaying' : 'Paused'}${pb.step ? ` · ${pb.step.label}` : ''} · ${wordText(d.main.word)}`, tone: 'normal' }
    const kind = pb.phase.split(':')[0] ?? ''
    // A committed rewrite whose deformation is still shown: name the target word, not the moving pose.
    return { phase: phaseOf(pb, true), text: `${pb.playing ? 'Animating' : 'Paused'} · ${MOTION[kind] ?? 'changing the braid'} · showing the move to ${wordText(d.main.word)}`, tone: 'normal' }
  }
  return { phase: r.decided ? 'result' : 'ready', text: r.text, tone: r.tone }
}

/** The rule a rewrite option applies, as the evidence list names it. */
const RULE: Record<string, string> = { braid_relation: 'braid relation', cancel_pair: 'cancel inverse pair' }

function rewriteItems(d: BraidDesc, animating: boolean): { items: ContextItem[]; hint: string } {
  const k = d.selectedCrossing
  const exp = d.experimentId
  const run = (o: BraidOptionDesc) => actionsRun([{ kind: 'rewrite_braid', experimentId: exp, rule: o.rule, at: o.at, generator: o.generator }])
  const primary = primaryRewrite(d.options)
  const relation = d.options.filter((o) => o.rule === 'braid_relation')
  const cancels = d.options.filter((o) => o.rule === 'cancel_pair')
  const inserts = d.options.filter((o) => o.rule === 'insert_pair')
  const none = k === null ? 'Select a crossing first' : null
  const items: ContextItem[] = []
  if (relation.length) for (const o of relation) items.push({ id: `rewrite:${o.id.slice(8)}`, label: L('Apply braid relation'), role: o === primary ? 'primary' : 'secondary', enabled: true, ariaLabel: `Apply braid relation at ${span(o)}`, hint: o.hint, run: run(o) })
  // With no rule available here the disabled relation keeps the primary slot, so a selection never resizes the card.
  else items.push({ id: 'rewrite:braid_relation', label: L('Apply braid relation'), role: cancels.length ? 'secondary' : 'primary', enabled: false, reason: none ?? (k! + 3 > d.main.word.length ? 'Needs three crossings from here' : `Crossings ${k! + 1}–${k! + 3} are not σ1 σ2 σ1 or σ2 σ1 σ2`), run: { kind: 'none' } })
  if (cancels.length) for (const o of cancels) items.push({ id: `rewrite:${o.id.slice(8)}`, label: L(cancels.length > 1 ? `Cancel inverse pair · ${span(o)}` : 'Cancel inverse pair'), role: o === primary ? 'primary' : 'secondary', enabled: true, ariaLabel: `Cancel inverse pair at ${span(o)}`, hint: o.hint, run: run(o) })
  else items.push({ id: 'rewrite:cancel_pair', label: L('Cancel inverse pair'), role: 'secondary', enabled: false, reason: none ?? 'No inverse pair next to this crossing', run: { kind: 'none' } })
  // Both insertion slots are always listed (disabled with a reason when they cannot apply), so selecting a
  // crossing does not change the card's layout under the pointer. The identity braid has no crossing to
  // select: there a pair is inserted at position 0 (the rewrite the hint offers).
  const empty = d.main.word.length === 0
  for (const g of [1, 2] as Generator[]) {
    const pair = wordText([g, -g as Generator])
    // Short visible label (the card must fit beside the examples); the accessible names say "inverse pair".
    const label = L(`Insert ${pair}`, `\\textsf{Insert }${wordTex([g, -g as Generator])}`)
    const o = inserts.find((x) => x.generator === g)
    if (o) items.push({ id: `rewrite:${o.id.slice(8)}`, label, role: 'secondary', enabled: true, ariaLabel: `Insert inverse pair ${pair} before crossing ${k! + 1}`, hint: o.hint, run: run(o) })
    else if (k === null && empty) items.push({ id: `rewrite:insert_pair:0:${g}`, label, role: 'secondary', enabled: true, ariaLabel: `Insert inverse pair ${pair} into the identity braid`, hint: `Insert ${pair}: the identity braid becomes ${pair}`, run: actionsRun([{ kind: 'rewrite_braid', experimentId: exp, rule: 'insert_pair', at: 0, generator: g }]) })
    else items.push({ id: `rewrite:insert_pair:${g}`, label, role: 'secondary', enabled: false, ariaLabel: `Insert inverse pair ${pair}`, reason: none ?? `The word would exceed ${MAX_BRAID_LENGTH} crossings`, run: { kind: 'none' } })
  }
  let hint: string
  if (k === null) hint = empty ? 'The braid has no crossings: insert a pair or choose an example' : 'Select a crossing on the stage to see its rewrite'
  else {
    const c = d.main.crossings[k]!
    // The stage lights the span only at rest (the scene hides its lane while a rewrite animates).
    const shown = primary ? `${span(primary)} (${wordText(d.main.word.slice(primary.at, primary.at + rewriteSpan(primary).length))})` : ''
    hint = !primary
      ? `Crossing ${k + 1} (${c.text}) · no relation or cancellation here; an inverse pair can be inserted`
      : animating ? `Crossing ${k + 1} (${c.text}) · offered: ${RULE[primary.rule]} at ${shown}` : `Crossing ${k + 1} (${c.text}) · highlighted: ${shown}`
  }
  return { items, hint }
}

function exampleItems(d: BraidDesc, e: BraidExperiment | null): ContextItem[] {
  const current = e ? braidExampleIndex(e) : -1
  return BRAID_EXAMPLES.map((x, i) => {
    const selected = i === current
    const actions = [
      { kind: 'set_braid', experimentId: d.experimentId, target: 'word', word: [...x.word] },
      { kind: 'set_braid', experimentId: d.experimentId, target: 'compare', word: [...x.compare] },
    ]
    return {
      id: `example:${x.name}`,
      label: L(EXAMPLE_NAMES[x.name] ?? x.name),
      role: 'choice' as const,
      selected,
      enabled: true,
      hint: `${wordText(x.word)} beside ${wordText(x.compare)}`,
      run: selected ? { kind: 'none' as const } : actionsRun(actions),
    }
  })
}

function wordItems(w: BraidWordDesc, title: string): DetailItem[] {
  return [
    { kind: 'formula', formula: L(`${title}: ${w.text}`, `\\textsf{${title}: }${w.tex}`) },
    { kind: 'list', items: w.crossings.map((c) => L(`${c.index + 1}. ${c.text}: ${c.over} over ${c.under} (places ${c.positions[0] + 1} and ${c.positions[1] + 1})`)) },
  ]
}

function detail(d: BraidDesc, animating: boolean): DetailSection[] {
  const exp = d.experimentId
  const sections: DetailSection[] = []
  sections.push({
    title: 'Braid words',
    provenance: 'computed exactly',
    items: [...wordItems(d.main, 'word'), ...(d.compare ? wordItems(d.compare, 'comparison') : []), { kind: 'text', text: d.convention }],
  })
  sections.push({
    title: 'Invariants',
    provenance: 'computed exactly',
    items: [
      { kind: 'pairs', rows: [
        { key: L('word: endpoints'), value: L(`a b c → ${d.main.arrival.join(' ')}`) },
        { key: L('word: exponent sum'), value: L(`E = ${d.main.exponentSum}`) },
        ...(d.compare ? [
          { key: L('comparison: endpoints'), value: L(`a b c → ${d.compare.arrival.join(' ')}`) },
          { key: L('comparison: exponent sum'), value: L(`E = ${d.compare.exponentSum}`) },
        ] : []),
      ] },
      { kind: 'text', text: 'Different invariants prove two braids different; equal invariants alone establish nothing.' },
    ],
  })
  const k = d.selectedCrossing
  const primary = primaryRewrite(d.options)
  sections.push({
    title: 'Selected rule',
    provenance: 'checked by supported rewrite rules',
    items: k === null
      ? [{ kind: 'text', text: 'No crossing selected. Supported rules: the braid relation σ1 σ2 σ1 ↔ σ2 σ1 σ2, cancelling or inserting an adjacent inverse pair.' }]
      : [
        { kind: 'text', text: `Crossing ${k + 1} (internal index ${k}): ${d.main.crossings[k]!.text}.${primary ? ` ${animating ? 'Offered' : 'Highlighted'} span: ${span(primary)}.` : ''}` },
        { kind: 'list', items: d.options.length ? d.options.map((o) => L(o.hint)) : [L('No supported rewrite matches here')] },
      ],
  })
  const n = d.rewrites.length
  sections.push({
    title: 'Rewrite evidence',
    provenance: 'checked by supported rewrite rules',
    items: n
      ? [
        { kind: 'list', items: d.rewrites.map((r, i) => L(`${i + 1}. ${r.rule === 'braid_relation' ? 'braid relation' : r.rule === 'cancel_pair' ? 'cancel inverse pair' : `insert ${wordText([r.generator!, -r.generator! as Generator])}`} at crossing ${r.at + 1}`)) },
        { kind: 'text', text: `${wordText(d.origin)} = ${wordText(d.main.word)}: every step was checked against the word it applies to.` },
        { kind: 'text', text: d.statusText },
      ]
      : [{ kind: 'text', text: `No rewrites recorded. ${d.statusText}` }],
  })
  const tool = (id: string, plain: string, tex: string | undefined, actions: unknown[], enabled: boolean, reason?: string): DetailItem => ({ kind: 'action', id, label: L(plain, tex), enabled, reason: enabled ? undefined : reason, run: enabled ? actionsRun(actions) : { kind: 'none' } })
  const gens: Generator[] = [1, 2, -1, -2]
  sections.push({
    title: 'Word tools',
    provenance: 'presentation',
    items: [
      ...gens.map((g) => tool(`append:${g}`, `Append ${wordText([g])}`, `\\textsf{Append }${wordTex([g])}`, [{ kind: 'append_crossing', experimentId: exp, target: 'word', generator: g }], d.canAppend, `At most ${MAX_BRAID_LENGTH} crossings`)),
      tool('invert', 'Invert braid', undefined, [{ kind: 'invert_braid', experimentId: exp, target: 'word' }], d.main.word.length > 0, 'The identity braid is its own inverse'),
      { kind: 'text', text: 'Invert replaces the word by its inverse (reversed, every crossing flipped); it is a new braid, not Undo.' },
    ],
  })
  return sections
}

export function presentBraid(input: PresenterInput): DomainPresentation {
  const d = sceneDesc(input)
  const e = braidExperiment(input)
  if (!d) {
    return {
      subtitle: L(TOPIC),
      context: EMPTY_CONTEXT,
      status: problemStatus(input) ?? { phase: 'ready', text: 'The braid scene is not shown yet', tone: 'warning' },
      playback: { play: { enabled: false, reason: 'No scene' }, replay: { enabled: false, reason: 'No scene' } },
      resets: [],
      detail: { sections: [] },
      scene: scenePresentation(input),
    }
  }
  const { items, hint } = rewriteItems(d, input.playback.active)
  const exp = d.experimentId
  const restore = e ? domainControls(input.doc, e).reset.actions : []
  const idx = e ? Math.max(braidExampleIndex(e), 0) : 0
  const ex = BRAID_EXAMPLES[idx]!
  const clearable = d.main.word.length > 0 || d.rewrites.length > 0
  const resets: ResetItem[] = [
    { id: 'clear', label: 'Clear braid', helper: 'Set the main word to the identity braid (no crossings); the comparison stays (undoable)', enabled: clearable, reason: clearable ? undefined : 'Already the identity braid', run: clearable ? actionsRun([{ kind: 'set_braid', experimentId: exp, target: 'word', word: [] }]) : { kind: 'none' } },
    { id: 'restore', label: 'Restore example', helper: `Restore the ${EXAMPLE_NAMES[ex.name] ?? ex.name} example: ${wordText(ex.word)} beside ${wordText(ex.compare)} (undoable)`, enabled: restore.length > 0, reason: restore.length ? undefined : 'The example is shown unchanged', run: actionsRun(restore) },
  ]
  const crossings = d.main.word.length + (d.compare?.word.length ?? 0)
  const replay = crossings > 0 ? { enabled: true } : { enabled: false, reason: 'No crossings to replay' }
  return {
    subtitle: L(TOPIC),
    context: {
      title: 'Rewrite at a crossing',
      groups: [
        { id: 'rewrite', label: 'Rewrite', layout: 'actions', items },
        { id: 'example', label: 'Example', layout: 'choices', items: exampleItems(d, e) },
      ],
      hint,
    },
    status: braidStatus(input, d),
    playback: { play: input.playback.active ? { enabled: true } : replay, replay },
    resets,
    detail: { sections: detail(d, input.playback.active) },
    scene: scenePresentation(input),
  }
}
