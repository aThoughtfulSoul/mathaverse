// SYNTHETIC fixtures: prepared, clearly labelled proposals used when no Meta key is configured (W8:
// "clearly labeled prepared examples") and in tests. They are not Muse output. The route sends them
// with `source: 'synthetic'` and `model: 'synthetic:<fixture-name>'`, through the same parseProposal
// and planTransaction validation as live output. Explanations are composed from exact facts of the
// planned document, so they stay true for whatever document the request carries. The operation-order
// fixtures use the same server-computed templates the live prompt offers (order.ts); IDs come from the
// document, and left/right from the displayed comparison's binding ports.

import { apply, column, describeMap, projectorNullityOne, vecEq, type Vec } from '../../src/model/linear'
import { format } from '../../src/model/rational'
import type { ActionJson } from '../../src/workspace/actions'
import { computeFacts } from '../../src/workspace/context'
import { type Doc, type Experiment, BUILTIN_RECIPE_ID, branchMatrix, branchSymbol, findAnyExperiment, findBranch, findExperiment, findMap, findRecipe, findSampleSet, linearExperiments } from '../../src/workspace/document'
import { rebindTarget } from '../../src/demo/pq'
import { FOUR_FIXTURES } from './fourSynthetic'
import { WALK_FIXTURES } from './walkSynthetic'
import { planTransaction } from '../../src/workspace/reducer'
import { demoOf, experimentFor, orderDemoActions } from '../../src/demo/order'
import { type ComparisonInfo, type Prepared, differenceCheckTemplate, displayedComparison, equalityCheckTemplate, replayTemplate, reverseTemplate } from './order'

export interface Fixture {
  name: string
  /** The prompt as shown in docs and in the "no fixture" error. */
  example: string
  /** Matched against the normalized prompt (lowercase, single spaces, no trailing punctuation). */
  matches: RegExp
  /** `prompt` is the normalized request (fixtures that read a number from it, such as "swap objects 2 and 3"). */
  build(doc: Doc, prompt?: string): { proposalVersion: 1; title: string; explanation: string; actions: ActionJson[] }
}

const U = 's(1,0,1)'
const V = 's(1,0,-1)'
const A = 's(1,1,0)'
const B = 's(-1,1,0)'

export function normalizePrompt(p: string): string {
  return p.normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim()
}

const vt = (v: Vec) => `(${v.map(format).join(', ')})`

function displayed(doc: Doc): Experiment {
  return findExperiment(doc, doc.selection.experimentId)
}

/** The branch the displayed experiment's recipe shows (its bound linear_branch port), else the first. */
function displayedBranch(doc: Doc, e: Experiment): string {
  if (e.binding) {
    const port = Object.entries(findRecipe(doc, e.binding.recipeId).inputs).find(([, s]) => s.type === 'linear_branch')?.[0]
    if (port && e.binding.ports[port]) return e.binding.ports[port]!
  }
  return e.branches[0]!.id
}

function sample(doc: Doc, e: Experiment, id: string) {
  return findSampleSet(doc, e.sampleSetId).samples.find((s) => s.id === id) ?? null
}

/** Facts of the document after the planned actions, or null when the plan is invalid (validation reports it). */
function plannedFacts(doc: Doc, actions: ActionJson[]): { doc: Doc; text: (id: string) => string | null } | null {
  try {
    const planned = planTransaction(doc, actions).doc
    const facts = computeFacts(planned)
    return { doc: planned, text: (id) => facts.find((f) => f.id === id)?.text ?? null }
  } catch {
    return null
  }
}

const join = (parts: (string | null | false)[]) => parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ')
/** A fact sentence, or nothing when the fact is absent (never the text "null"). */
const sent = (text: string | null, end = '.') => (text ? `${text}${end}` : null)

// ------------------------------------------------------------------ operation-order explanations

const AXES = ['x', 'y', 'z']
/** `e_{1}` -> `e1` (plain text). */
const plain = (label: string) => label.replace(/_\{(\d+)\}/g, '$1')

type Proposal = ReturnType<Fixture['build']>
const answer = (title: string, explanation: string): Proposal => ({ proposalVersion: 1, title, explanation, actions: [] })
const NO_COMPARISON = 'No branch comparison is displayed, so "left" and "right" do not name a route.'
/** P-to-Q fixtures name u, v and a single map: on the comparison they would guess, so they explain instead. */
const onComparison = (doc: Doc, title: string): Proposal | null => {
  const shown = findAnyExperiment(doc, doc.selection.experimentId)
  if (shown.domain !== 'linear') return answer(title, `The workbench shows ${shown.domain === 'group' ? 'a group demonstration' : shown.domain === 'vector_walk' ? 'the proof lesson' : 'the braid demonstration'} (${shown.id}), not a linear map, so this request names nothing there. Switch to the P-to-Q demonstration first; it then applies to the map shown there.`)
  return demoOf(doc, shown) === 'order'
    ? answer(title, `The views show the operation-order comparison ${doc.selection.experimentId}, which has two routes and no single map or u, v pair. Switch to the P-to-Q demonstration first; this request then applies to the map shown there.`)
    : null
}
const OPEN_IT = '"Show me why rotation and reflection order matters" opens the prepared comparison.'

/** "R = rotation by 90° about z" from the exact matrix; a 3D reflection names its mirror plane, and the line
 * it reflects across on a coordinate plane that holds every sample. Nothing here is R/S-specific. */
function mapPhrase(doc: Doc, mapId: string, onPlane: number | null): string {
  const m = findMap(doc, mapId)
  const what = describeMap(m.matrix)
  const neg = /^Reflection negating ([xyz])$/.exec(what)
  if (!neg || m.dimension !== 3) return `${m.label} = ${what.charAt(0).toLowerCase()}${what.slice(1)}`
  const k = AXES.indexOf(neg[1]!)
  const others = [0, 1, 2].filter((i) => i !== k)
  const line = onPlane !== null && onPlane !== k ? `; on ${AXES[onPlane]} = 0, across the ${AXES[others.find((i) => i !== onPlane)!]}-axis` : ''
  return `${m.label} = reflection negating ${neg[1]} (across the ${others.map((i) => AXES[i]).join('')}-plane${line})`
}

/** The coordinate that is 0 for every sample of the set (the plane they lie in), if any. */
function commonZeroAxis(doc: Doc, e: Experiment): number | null {
  const set = findSampleSet(doc, e.sampleSetId)
  for (let i = e.dimension - 1; i >= 0; i--) if (set.samples.every((s) => s.coords[i]!.n === 0n)) return i
  return null
}

/** Exact sentences about a comparison in a (planned) document: routes in words, the first difference, and
 * what the first step of each route does to the selected sample. */
function comparisonStory(doc: Doc, c: ComparisonInfo): string[] {
  const e = findExperiment(doc, c.experimentId)
  const set = findSampleSet(doc, e.sampleSetId)
  const name = (id: string) => plain(set.samples.find((s) => s.id === id)?.label || id)
  const L = branchMatrix(doc, e, c.left.branchId)
  const R = branchMatrix(doc, e, c.right.branchId)
  const out: string[] = [`The left route applies ${c.left.order} (${c.left.symbol}); the right route applies ${c.right.order} (${c.right.symbol}).`]
  if (c.firstDifferingBasisIndex === null) out.push(`Both resolve to the same matrix, so every sample lands in the same place under both routes.`)
  else {
    const j = c.firstDifferingBasisIndex
    out.push(`${c.left.symbol}e${j + 1} = ${vt(column(L, j))} but ${c.right.symbol}e${j + 1} = ${vt(column(R, j))}, so the two maps differ: the order matters.`)
  }
  const sel = doc.selection.experimentId === e.id && doc.selection.sampleId ? set.samples.find((s) => s.id === doc.selection.sampleId) : undefined
  if (sel) {
    for (const route of [c.left, c.right]) {
      const first = findBranch(e, route.branchId).mapIds[0]
      if (!first) continue
      const M = findMap(doc, first).matrix
      if (!vecEq(apply(M, sel.coords), sel.coords)) continue
      const moved = set.samples.filter((s) => s.id !== sel.id && !vecEq(apply(M, s.coords), s.coords)).length
      out.push(`In the ${route.port} route the first step ${findMap(doc, first).label} leaves ${name(sel.id)} fixed at ${vt(sel.coords)}${moved ? ` while ${moved} other labelled samples move` : ''}.`)
    }
  }
  return out
}

/** The comparison of the document after `actions`, or null when they do not plan (validation reports it). */
function plannedComparison(doc: Doc, actions: ActionJson[]): { doc: Doc; c: ComparisonInfo } | null {
  try {
    const planned = planTransaction(doc, actions).doc
    const c = displayedComparison(planned)
    return c ? { doc: planned, c } : null
  } catch {
    return null
  }
}

/** A prepared template, or an honest explanation of why it does not apply. */
const templateOr = (t: Prepared | null, title: string, why: string): ActionJson[] | Proposal => (t && 'actions' in t ? t.actions : answer(title, why))

function orderDemo(doc: Doc): Proposal {
  const actions = orderDemoActions(doc) as ActionJson[]
  const existed = experimentFor(doc, 'order') !== null
  const p = plannedComparison(doc, actions)
  if (!p) return { proposalVersion: 1, title: 'Show why the order matters', explanation: 'The prepared comparison does not apply to this workspace as it is.', actions }
  const e = findExperiment(p.doc, p.c.experimentId)
  const set = findSampleSet(p.doc, e.sampleSetId)
  const r = findRecipe(p.doc, e.binding!.recipeId)
  const outline = r.operations.flatMap((o) => (o.kind === 'sample_outline' ? o.vertices : [])).map((id) => set.samples.find((s) => s.id === id)?.label).filter((l): l is string => !!l).map(plain)
  const sel = p.doc.selection.sampleId ? plain(set.samples.find((s) => s.id === p.doc.selection.sampleId)?.label || p.doc.selection.sampleId) : null
  const plane = commonZeroAxis(p.doc, e)
  const mapIds = [...new Set([...findBranch(e, p.c.left.branchId).mapIds, ...findBranch(e, p.c.right.branchId).mapIds])]
  const what = outline.length ? `the labelled square ${outline.join(', ')}${sel ? ` with ${sel} selected` : ''}${plane !== null ? ` on ${AXES[plane]} = 0` : ''}` : 'the samples'
  return {
    proposalVersion: 1,
    title: 'Show why the order matters',
    explanation: join([
      existed ? `This shows the prepared comparison ${e.id} again (a select).` : `This is a prepared comparison (an application template, validated on this workspace; not a new operation): ${what}, two routes and a replay.`,
      `${mapIds.map((id) => mapPhrase(p.doc, id, plane)).join('; ')}.`,
      ...comparisonStory(p.doc, p.c),
      'Nothing is Lean-checked yet.',
    ]),
    actions,
  }
}

function reverse(side: 'left' | 'right'): (doc: Doc) => Proposal {
  return (doc) => {
    const title = `Reverse the ${side} route`
    const c = displayedComparison(doc)
    if (!c) return answer(title, join([NO_COMPARISON, OPEN_IT]))
    const route = c[side]
    const e = findExperiment(doc, c.experimentId)
    const ids = findBranch(e, route.branchId).mapIds
    if (ids.join('|') === [...ids].reverse().join('|')) return answer(title, `The ${side} route applies ${route.order}; reversed, it is the same sequence, so nothing would change.`)
    const actions = templateOr(reverseTemplate(doc, c, side), title, `The ${side} route cannot be reversed in this workspace as it is.`)
    if (!Array.isArray(actions)) return actions
    const p = plannedComparison(doc, actions)
    return {
      proposalVersion: 1,
      title,
      explanation: join([
        `This reverses the ${side} route of ${c.experimentId} (the branch bound to its ${side} port): it applies ${p ? p.c[side].order : 'the reversed order'} instead of ${route.order}, then replays both routes.`,
        ...(p ? comparisonStory(p.doc, p.c).slice(1, 2) : []),
        `Undo restores ${route.order}.`,
      ]),
      actions,
    }
  }
}

function replayComparison(doc: Doc): Proposal {
  const title = 'Replay the comparison'
  const actions = templateOr(replayTemplate(doc), title, join(['The workspace has no branch comparison to replay yet.', OPEN_IT]))
  if (!Array.isArray(actions)) return actions
  const shown = displayedComparison(doc)
  const p = plannedComparison(doc, actions)
  const c = p?.c ?? shown
  return {
    proposalVersion: 1,
    title,
    explanation: join([
      shown ? `This replays ${shown.experimentId} step by step: the input, then the first operation, then the second, on both routes.` : `This displays the comparison${c ? ` ${c.experimentId}` : ''} (another experiment was shown) and replays it step by step: the input, then the first operation, then the second.`,
      c && `Left: ${c.left.order}; right: ${c.right.order}.`,
      'The committed maps do not change.',
    ]),
    actions,
  }
}

function checkDiffer(doc: Doc): Proposal {
  const title = 'Check that the two maps differ'
  const c = displayedComparison(doc)
  if (!c) return answer(title, join([NO_COMPARISON, OPEN_IT]))
  if (c.mapsEqual) return answer('The two maps are equal', `The left route (${c.left.order}) and the right route (${c.right.order}) both resolve to ${c.left.symbol}: computed exactly, the two maps are equal, so there is no difference to check. To check the equality instead, ask: "Check that these two maps are equal".`)
  const actions = templateOr(differenceCheckTemplate(doc, c), title, 'The difference check does not apply to this workspace as it is.')
  if (!Array.isArray(actions)) return actions
  const e = findExperiment(doc, c.experimentId)
  const j = c.firstDifferingBasisIndex!
  return {
    proposalVersion: 1,
    title,
    explanation: join([
      `This asks the Lean checker whether ${c.left.symbol} (left: ${c.left.order}) and ${c.right.symbol} (right: ${c.right.order}) differ, with the witness e${j + 1}.`,
      `Computed exactly: ${c.left.symbol}e${j + 1} = ${vt(column(branchMatrix(doc, e, c.left.branchId), j))} and ${c.right.symbol}e${j + 1} = ${vt(column(branchMatrix(doc, e, c.right.branchId), j))}.`,
      'Nothing is Lean-checked until the checker answers.',
    ]),
    actions,
  }
}

function checkEqual(doc: Doc): Proposal {
  const title = 'Check that the two maps are equal'
  const c = displayedComparison(doc)
  if (!c) return answer(title, join([NO_COMPARISON, OPEN_IT]))
  if (!c.mapsEqual) {
    const e = findExperiment(doc, c.experimentId)
    const j = c.firstDifferingBasisIndex!
    return answer('The two maps differ', `Computed exactly, ${c.left.symbol} (left: ${c.left.order}) and ${c.right.symbol} (right: ${c.right.order}) are not equal: ${c.left.symbol}e${j + 1} = ${vt(column(branchMatrix(doc, e, c.left.branchId), j))} but ${c.right.symbol}e${j + 1} = ${vt(column(branchMatrix(doc, e, c.right.branchId), j))}. To check the difference, ask: "Check that these two maps differ".`)
  }
  const actions = templateOr(equalityCheckTemplate(doc, c), title, 'The equality check does not apply to this workspace as it is.')
  if (!Array.isArray(actions)) return actions
  return {
    proposalVersion: 1,
    title,
    explanation: `This asks the Lean checker whether the left route (${c.left.order}) and the right route (${c.right.order}) are the same matrix, entry by entry; computed exactly, both are ${c.left.symbol}. Nothing is Lean-checked until the checker answers.`,
    actions,
  }
}

/** Join sentences up to the explanation limit, dropping whole trailing sentences rather than cutting one. */
function fit(parts: (string | null | false)[], limit = 700): string {
  let out = ''
  for (const p of parts) {
    if (typeof p !== 'string' || !p) continue
    const next = out ? `${out} ${p}` : p
    if (next.length > limit) break
    out = next
  }
  return out
}

// ------------------------------------------------------------------ UI suggestion fixtures (P / Q and order)
// The Ask Meta Muse AI suggestions (UI-REFINEMENT-SPEC section 7). Explanations come from exact facts of the
// request's document; the answer-only ones never carry actions (the client shows them as "answered").

/** "Use this representation on P": show the P experiment again with the same recipe (rebindTarget's select). */
function useOnP(doc: Doc): Proposal {
  const title = 'Use the same representation on P'
  const guard = onComparison(doc, title)
  if (guard) return guard
  const e = displayed(doc)
  const shownSym = branchSymbol(doc, e, displayedBranch(doc, e))
  const other = linearExperiments(doc).find((x) => x.id !== e.id && x.sampleSetId === e.sampleSetId && demoOf(doc, x) === 'pq')
  if (!other) return answer(title, `Not applied: ${shownSym === 'P' ? 'P is already displayed' : `no other experiment shares these samples`}, so there is nothing to switch to. "Use this representation on Q" adds Q.`)
  const otherSym = branchSymbol(doc, other, displayedBranch(doc, other))
  if (otherSym !== 'P') return answer(title, `Not applied: ${shownSym} is displayed and the other experiment shows ${otherSym}, not P.`)
  const actions = rebindTarget(doc).actions as ActionJson[]
  if (!actions.length) return answer(title, 'Not applied: the P experiment cannot be shown with this recipe here.')
  const p = plannedFacts(doc, actions)
  return {
    proposalVersion: 1,
    title,
    explanation: fit([
      `This shows ${other.id} again with the same recipe (a select; nothing is created and ${e.id} is unchanged), keeping the selected sample.`,
      p && sent(p.text(`selected:${other.id}/${displayedBranch(p.doc, other)}`) && `Under P, ${p.text(`selected:${other.id}/${displayedBranch(p.doc, other)}`)}`),
      p && sent(p.text(`shared:${other.id}/${displayedBranch(p.doc, other)}`)),
      p && sent(p.text(`fiber:${other.id}/${displayedBranch(p.doc, other)}`)),
    ]),
    actions,
  }
}

/** "Explain the selected fiber": the exact fiber of the displayed map through the selected sample. */
function explainFiber(doc: Doc): Proposal {
  const title = 'The selected fiber'
  const guard = onComparison(doc, title)
  if (guard) return guard
  const e = displayed(doc)
  const b = displayedBranch(doc, e)
  const sym = branchSymbol(doc, e, b)
  const selId = doc.selection.experimentId === e.id ? doc.selection.sampleId : null
  const s = selId ? sample(doc, e, selId) : null
  if (!s) return answer(title, `Not available: no sample is selected in ${e.id}, so there is no selected fiber. Select a sample first, or ask "Show me what this transformation loses".`)
  const facts = computeFacts(doc)
  const fact = (id: string) => facts.find((f) => f.id === id)?.text ?? null
  const name = plain(s.label || s.id)
  const M = branchMatrix(doc, e, b)
  const j = projectorNullityOne(M)
  if (j === null) {
    return answer(title, fit([sent(fact(`selected:${e.id}/${b}`) && `Computed exactly: ${fact(`selected:${e.id}/${b}`)}`), sent(fact(`fiber:${e.id}/${b}`)), `${sym} does not discard exactly one coordinate, so its fiber through ${name} is not a single line here.`]))
  }
  const line = `(${s.coords.map((c, i) => (i === j ? 't' : format(c))).join(', ')})`
  return answer(title, fit([
    sent(fact(`selected:${e.id}/${b}`) && `Computed exactly: ${fact(`selected:${e.id}/${b}`)}`),
    `${sym} discards ${AXES[j]}, so the fiber through ${name} is the whole line ${line}, t any number: every point on it has the same output ${vt(apply(M, s.coords))}, and only ${AXES[j]} is lost.`,
    sent(fact(`shared:${e.id}/${b}`)),
    'The scene draws only a finite segment of that line; the fiber itself is infinite.',
  ]))
}

/** "Explain why the results differ / agree": the exact comparison of the two routes, with no actions. */
function explainResults(doc: Doc, prompt?: string): Proposal {
  const c = displayedComparison(doc)
  if (!c) return answer('Why the results differ', `Not available: ${NO_COMPARISON} ${OPEN_IT}`)
  const askedAgree = prompt ? /agree|the same|equal/.test(prompt) : null
  const lead =
    askedAgree === false && c.mapsEqual ? 'Computed exactly, the two results do not differ here.'
    : askedAgree === true && !c.mapsEqual ? 'Computed exactly, the two results do not agree here.'
    : null
  return answer(c.mapsEqual ? 'Why the results agree' : 'Why the results differ', fit([
    lead,
    ...comparisonStory(doc, c),
    'Applying A, then B, to column vectors gives BA, so each product reads right to left. Nothing was changed or selected.',
  ]))
}

export const FIXTURES: Fixture[] = [
  {
    name: 'what-gets-lost',
    example: 'Show me what this transformation loses',
    matches: /^show me what (?:this|the) (?:transformation|map) loses$/,
    build(doc) {
      const guard = onComparison(doc, 'Show what this map loses')
      if (guard) return guard
      const e = displayed(doc)
      const b = displayedBranch(doc, e)
      const actions: ActionJson[] = [{ kind: 'select', experimentId: e.id, sampleId: U }]
      const p = plannedFacts(doc, actions)
      const lineFiber = projectorNullityOne(branchMatrix(doc, e, b)) !== null
      const explanation = p
        ? join([
            sent(p.text(`selected:${e.id}/${b}`) && `Selecting u highlights it and its output: ${p.text(`selected:${e.id}/${b}`)}`),
            sent(p.text(`shared:${e.id}/${b}`)),
            sent(p.text(`fiber:${e.id}/${b}`), ';'),
            lineFiber ? 'sliding u along that line changes the input but not the output.' : 'the exact output groups still show which samples collide.',
          ])
        : 'u is not a sample of the displayed experiment.'
      return { proposalVersion: 1, title: `Show what ${branchSymbol(doc, e, b)} loses`, explanation, actions }
    },
  },
  {
    name: 'use-on-q',
    example: 'Use this representation on Q',
    matches: /^use (?:this|the same) (?:representation|recipe) on q$/,
    build(doc) {
      const guard = onComparison(doc, 'Use the same representation on Q')
      if (guard) return guard
      const e = displayed(doc)
      const recipeId = e.binding?.recipeId ?? BUILTIN_RECIPE_ID
      // The same transaction as `bindQ` in tests/workspace.test.ts; binding the selection port selects u.
      const actions: ActionJson[] = [
        { kind: 'create_map', name: 'q', label: 'Q', dimension: 3, definition: { preset: { kind: 'projection', keep: [false, true, true] } } },
        { kind: 'create_experiment', name: 'q', sampleSetId: e.sampleSetId, branches: [{ id: 'main', mapIds: ['$q'] }] },
        { kind: 'bind_recipe', experimentId: '$q', recipeId, bindings: { samples: e.sampleSetId, map: 'main', selection: U } },
      ]
      const p = plannedFacts(doc, actions)
      let separated: string | null = null
      let next: string | null = null
      if (p) {
        const q = findExperiment(p.doc, 'exp-q')
        const Qm = branchMatrix(p.doc, q, 'main')
        const [u, v, a, bb] = [U, V, A, B].map((id) => sample(p.doc, q, id))
        if (u && v && !vecEq(apply(Qm, u.coords), apply(Qm, v.coords))) separated = `Qv = ${vt(apply(Qm, v.coords))}, so u and v no longer share an output.`
        if (a && bb && vecEq(apply(Qm, a.coords), apply(Qm, bb.coords))) next = `Selecting a next shows a new collision: Qa = Qb = ${vt(apply(Qm, a.coords))}.`
      }
      const explanation = p
        ? join([
            'This adds Q = diag(0, 1, 1) as a new map and experiment and binds the same recipe with u selected; P is unchanged.',
            sent(p.text('selected:exp-q/main') && `Under Q, ${p.text('selected:exp-q/main')}`),
            separated,
            sent(p.text('fiber:exp-q/main')),
            next,
          ])
        : 'Q cannot be added to this workspace as proposed.'
      return { proposalVersion: 1, title: 'Use the same representation on Q', explanation, actions }
    },
  },
  {
    name: 'check-same-image',
    example: 'Check that u and v have the same image',
    matches: /^check (?:that )?u and v have the same (?:image|output)$/,
    build(doc) {
      const guard = onComparison(doc, 'Check that u and v share an image')
      if (guard) return guard
      const e = displayed(doc)
      const b = displayedBranch(doc, e)
      const sym = branchSymbol(doc, e, b)
      const actions: ActionJson[] = [{ kind: 'request_check', claim: { kind: 'same_image_witness', branch: { experimentId: e.id, branchId: b }, u: U, v: V } }]
      const u = sample(doc, e, U)
      const v = sample(doc, e, V)
      const M = branchMatrix(doc, e, b)
      const explanation = join([
        `This asks the Lean checker whether u and v have the same image under ${sym} (${e.id}/${b}).`,
        u && v ? `The exact outputs are ${sym}u = ${vt(apply(M, u.coords))} and ${sym}v = ${vt(apply(M, v.coords))}.` : null,
        'Nothing is Lean-checked until the checker answers.',
      ])
      return { proposalVersion: 1, title: 'Check that u and v share an image', explanation, actions }
    },
  },
  {
    name: 'answer-map',
    example: 'What does this map do',
    matches: /^what does (?:this|the) (?:map|transformation) do$/,
    build(doc) {
      const guard = onComparison(doc, 'What this map does')
      if (guard && findAnyExperiment(doc, doc.selection.experimentId).domain !== 'linear') return guard
      const e = displayed(doc)
      const b = displayedBranch(doc, e)
      const facts = computeFacts(doc)
      const fact = (id: string) => facts.find((f) => f.id === id)?.text ?? null
      return { proposalVersion: 1, title: `What ${branchSymbol(doc, e, b)} does`, explanation: join([sent(fact(`map:${e.id}/${b}`)), sent(fact(`fiber:${e.id}/${b}`)), sent(fact(`collisions:${e.id}/${b}`))]), actions: [] }
    },
  },
  {
    name: 'order-demo',
    example: 'Show me why rotation and reflection order matters',
    matches: /^(?:(?:show me|show|explain|tell me) )?(?:why|that|how) (?:the )?(?:(?:rotation and reflection|reflection and rotation) )?order (?:of (?:the )?(?:rotation and (?:the )?reflection|reflection and (?:the )?rotation|(?:the )?operations|(?:the )?maps) )?matters$|^(?:why )?does (?:the )?order (?:of (?:the )?(?:rotation and (?:the )?reflection|reflection and (?:the )?rotation|(?:the )?operations|(?:the )?maps) )?matter$/,
    build: orderDemo,
  },
  {
    name: 'reverse-left',
    example: 'Reverse the order on the left',
    matches: /^(?:reverse|swap|flip|switch) the (?:order (?:on|of|in) the left(?: route| branch| side| view)?|left (?:route|branch)(?:'s order)?)$/,
    build: reverse('left'),
  },
  {
    name: 'reverse-right',
    example: 'Reverse the order on the right',
    matches: /^(?:reverse|swap|flip|switch) the (?:order (?:on|of|in) the right(?: route| branch| side| view)?|right (?:route|branch)(?:'s order)?)$/,
    build: reverse('right'),
  },
  {
    name: 'replay-comparison',
    example: 'Replay the comparison',
    matches: /^(?:replay|play|rerun|re-run|animate|show)(?: again)? (?:the comparison|both routes|the two routes|the routes)(?: again| step by step)?$/,
    build: replayComparison,
  },
  {
    name: 'check-maps-differ',
    example: 'Check that these two maps differ',
    matches: /^(?:check|verify|prove|confirm) (?:that )?(?:these|the) (?:two )?(?:maps|routes|branches) (?:differ|are different|are not equal|are not the same)$/,
    build: checkDiffer,
  },
  {
    name: 'check-maps-equal',
    example: 'Check that these two maps are equal',
    matches: /^(?:check|verify|prove|confirm) (?:that )?(?:these|the) (?:two )?(?:maps|routes|branches) are (?:equal|the same)$/,
    build: checkEqual,
  },
  {
    name: 'unsupported-rotation',
    example: 'Rotate by 30 degrees',
    matches: /^rotate (?:it |this |the map )?by 30(?: degrees|°| deg)$/,
    build() {
      return {
        proposalVersion: 1,
        title: 'A 30° rotation is not available',
        explanation: 'Every matrix entry here is an exact rational, and a 30° rotation needs √3/2, so rotations exist only in quarter turns (90°). A quarter-turn rotation, a reflection or a shear can be proposed instead.',
        actions: [],
      }
    },
  },
  {
    name: 'unsupported-code',
    example: 'Run this Python',
    matches: /^(?:please )?(?:run|execute) (?:this |my |some )?(?:python|javascript|code|script)\b/,
    build() {
      return {
        proposalVersion: 1,
        title: 'Code cannot run here',
        explanation: 'The workspace cannot run Python or any other code, fetch URLs or add packages. Proposals use only the workspace actions: maps, samples, experiments, recipes, selection, view, play, comparison replay and Lean check requests. Describe the experiment you want and it can be proposed with those.',
        actions: [],
      }
    },
  },
  {
    name: 'use-on-p',
    example: 'Use this representation on P',
    matches: /^use (?:this|the same) (?:representation|recipe) on p$/,
    build: useOnP,
  },
  {
    name: 'explain-fiber',
    example: 'Explain the selected fiber',
    matches: /^explain (?:the|this) (?:selected )?fib(?:er|re)$/,
    build: explainFiber,
  },
  {
    name: 'explain-results',
    example: 'Explain why the results differ',
    matches: /^explain why the (?:results|routes|maps|two (?:results|routes|maps)) (?:differ|agree|are (?:different|the same|equal))$/,
    build: explainResults,
  },
  ...FOUR_FIXTURES,
  ...WALK_FIXTURES,
]

export function matchFixture(prompt: string): Fixture | null {
  const p = normalizePrompt(prompt)
  return FIXTURES.find((f) => f.matches.test(p)) ?? null
}
