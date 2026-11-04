// Assistant request context (WORKSPACE-AND-AI W5, MUSE-INTEGRATION-DESIGN "Facts and explanation").
// The document is the authority. Facts are exact, typed and recomputed from the validated document by
// whoever needs them (the server never trusts client-supplied facts). The context hash is computed by
// browser and server with this same code.
//
// Pure module: imported by the browser and by the Node server.

import { apply, describeMap, exactOutputGroups, projectorNullityOne, coordinateProjectorDiscarded, matEq, vecEq, type Vec } from '../model/linear'
import { comparisonOf } from '../recipes/recipe'
import { type Q, cmp as qcmp, format, mul } from '../model/rational'
import type { AssistantContext } from './actions'
import { HASH_VERSION, versionedHash } from './canonical'
import { type Doc, type GroupExperiment, type BraidExperiment, type VectorWalkExperiment, findAnyExperiment, findSampleSet, findRecipe, findBranch, findMap, findGroup, groupFor, branchMatrix, branchSymbol, linearExperiments, walkInputOf } from './document'
import { type WalkFacts, type WalkItem, approxSqrt, deriveWalk, isqrt, norm2, parseWalkItem, representativeEndpoints, vneg, vtext } from '../algebra/walk'
import { CASES, arrowNames, caseOf, hasHeroVectors } from '../lessons/steinitz/cases'
import { chronologicalProduct, groupName, regularPermutation } from '../algebra/groups'
import { cycleText, permOrder } from '../algebra/permutation'
import { KERNEL, classKey, phiOf, piOf, axisClasses } from '../algebra/cube'
import { braidStatus, endpointPermutation, exponentSum, wordText, applyRewrite, type Generator, type RewriteStep } from '../algebra/braid'
import { layoutOf } from '../recipes/recipe'

const AXES = ['x', 'y', 'z']
const t = (v: Vec) => `(${v.map(format).join(', ')})`

export function assistantContextHash(ctx: AssistantContext): Promise<string> {
  return versionedHash(HASH_VERSION.context, { document: ctx.document, evidence: ctx.evidence })
}

/** One exact, typed fact with the object IDs it refers to. */
export interface Fact {
  id: string
  kind: 'map' | 'selected_output' | 'shared_output' | 'fiber' | 'collisions' | 'order' | 'comparison' | 'group' | 'group_state' | 'diagonals' | 'quotient' | 'braid' | 'braid_rewrites'
    | 'walk' | 'walk_bounds' | 'walk_order' | 'walk_lemma' | 'walk_endpoints' | 'walk_selection'
  refs: string[]
  text: string
}

/** Exact facts about every experiment's branches and the current selection (computed, not inferred). */
export function computeFacts(doc: Doc): Fact[] {
  const facts: Fact[] = []
  for (const e of linearExperiments(doc)) {
    const set = findSampleSet(doc, e.sampleSetId)
    const name = (id: string) => set.samples.find((s) => s.id === id)?.label || id
    for (const b of e.branches) {
      const A = branchMatrix(doc, e, b.id)
      const sym = branchSymbol(doc, e, b.id)
      facts.push({ id: `map:${e.id}/${b.id}`, kind: 'map', refs: [e.id, ...b.mapIds], text: `${sym} on ${e.id}/${b.id} is ${describeMap(A)}; rows ${A.map(t).join(' ')}` })
      const j = projectorNullityOne(A)
      const proj = coordinateProjectorDiscarded(A)
      facts.push({
        id: `fiber:${e.id}/${b.id}`, kind: 'fiber', refs: [e.id],
        text: j !== null ? `${sym}: a selected point's fiber is a line along ${AXES[j]} (the discarded coordinate)` : proj ? `${sym}: no line fiber (the kernel has dimension ${proj.length})` : `${sym}: no line-fiber view (not a coordinate projector with one discarded coordinate)`,
      })
      const groups = exactOutputGroups(A, set.samples).filter((g) => g.ids.length > 1)
      facts.push({ id: `collisions:${e.id}/${b.id}`, kind: 'collisions', refs: [e.id], text: `${sym}: ${groups.length} exact output groups with more than one sample among ${set.samples.length}` })
      if (doc.selection.experimentId === e.id && doc.selection.sampleId) {
        const s = set.samples.find((x) => x.id === doc.selection.sampleId)!
        const out = apply(A, s.coords)
        const group = exactOutputGroups(A, set.samples).find((g) => g.ids.includes(s.id))!.ids.filter((id) => id !== s.id)
        facts.push({ id: `selected:${e.id}/${b.id}`, kind: 'selected_output', refs: [s.id], text: `${sym}${name(s.id)} = ${sym}${t(s.coords)} = ${t(out)}` })
        facts.push({
          id: `shared:${e.id}/${b.id}`, kind: 'shared_output', refs: [s.id, ...group],
          text: group.length ? `${group.length} other samples share ${name(s.id)}'s output: ${group.map(name).join(', ')}` : `no other sample shares ${name(s.id)}'s output`,
        })
      }
    }
  }
  for (const e of linearExperiments(doc)) {
    const cmp = e.binding ? comparisonOf(findRecipe(doc, e.binding.recipeId)) : null
    if (!cmp) continue
    // Chronological order in words for each displayed route, then the exact comparison of the two maps.
    const set = findSampleSet(doc, e.sampleSetId)
    const name = (id: string) => set.samples.find((s) => s.id === id)?.label || id
    const side = { left: e.binding!.ports[cmp.left]!, right: e.binding!.ports[cmp.right]! }
    for (const [where, branchId] of Object.entries(side)) {
      const b = findBranch(e, branchId)
      const words = b.mapIds.length ? b.mapIds.map((id) => findMap(doc, id).label).join(' then ') : 'identity'
      facts.push({ id: `order:${e.id}/${branchId}`, kind: 'order', refs: [e.id, ...b.mapIds], text: `the ${where} route (${e.id}/${branchId}) applies ${words}, resolving to ${branchSymbol(doc, e, branchId)}` })
    }
    const L = branchMatrix(doc, e, side.left)
    const R = branchMatrix(doc, e, side.right)
    const ls = branchSymbol(doc, e, side.left)
    const rs = branchSymbol(doc, e, side.right)
    const differ = !matEq(L, R)
    const basis = Array.from({ length: e.dimension }, (_, j) => j).find((j) => !vecEq(L.map((r) => r[j]!), R.map((r) => r[j]!)))
    const witness = basis === undefined ? '' : `; on e${basis + 1}: ${ls}e${basis + 1} = ${t(L.map((r) => r[basis]!))}, ${rs}e${basis + 1} = ${t(R.map((r) => r[basis]!))}`
    const sel = doc.selection.experimentId === e.id && doc.selection.sampleId ? set.samples.find((s) => s.id === doc.selection.sampleId) : null
    const selText = sel ? `; selected ${name(sel.id)} = ${t(sel.coords)}: ${ls}${name(sel.id)} = ${t(apply(L, sel.coords))}, ${rs}${name(sel.id)} = ${t(apply(R, sel.coords))}` : ''
    facts.push({ id: `comparison:${e.id}`, kind: 'comparison', refs: [e.id, side.left, side.right], text: `${ls} (left) and ${rs} (right) ${differ ? 'differ' : 'are equal'}${witness}${selText}` })
  }
  for (const e of doc.experiments) {
    if (e.domain === 'group') facts.push(...groupFacts(doc, e))
    else if (e.domain === 'braid') facts.push(...braidFacts(doc, e))
    else if (e.domain === 'vector_walk') facts.push(...walkFacts(doc, e))
  }
  const sel = findAnyExperiment(doc, doc.selection.experimentId)
  facts.push({ id: 'displayed', kind: 'map', refs: [sel.id], text: `the views show experiment ${sel.id} (${sel.domain})${doc.selection.item ? `; selected item ${doc.selection.item}` : ''}` })
  return facts
}

/** Exact facts of a group experiment (all "computed exactly" from the group's own multiplication). */
function groupFacts(doc: Doc, e: GroupExperiment): Fact[] {
  const def = findGroup(doc, e.groupId)
  const g = groupFor(doc, e)
  // Plain names with real superscripts (Rz³, not Rz^3), as the rest of the interface writes them.
  const name = (x: string) => g.label(x).plain.replace(/\^1(?!\d)/g, '¹').replace(/\^2/g, '²').replace(/\^3/g, '³')
  const gname = groupName(def.definition).plain
  const layout = e.binding ? layoutOf(findRecipe(doc, e.binding.recipeId)) : null
  const out: Fact[] = []
  const elems = g.order <= 8 ? g.elements.map((x) => `${name(x)} (order ${g.elementOrder(x)}; regular action ${cycleText(regularPermutation(g, x), (i) => name(g.elements[i]!))})`).join(', ') : (() => {
    const by = new Map<number, number>()
    for (const x of g.elements) by.set(g.elementOrder(x), (by.get(g.elementOrder(x)) ?? 0) + 1)
    return [...by].sort((a, b) => a[0] - b[0]).map(([o, n]) => `${n} of order ${o}`).join(', ')
  })()
  out.push({ id: `group:${e.id}`, kind: 'group', refs: [e.id, def.id], text: `${e.id} uses ${gname}, ${g.order} elements, identity ${name(g.identity)}; computed exactly: ${elems}` })
  const k = chronologicalProduct(g, e.history.map((h) => h.element))
  const steps = e.history.map((h) => name(h.element))
  const back = (() => {
    if (!e.history.length) return ''
    if (k === g.identity) return '; every bead/orientation is home (accumulated element is the identity)'
    // Repeating the last operation returns home only when k lies in the cyclic subgroup it generates.
    const last = e.history[e.history.length - 1]!.element
    let n = 0
    let x = k
    while (x !== g.identity && n < g.order) {
      x = g.multiply(last, x)
      n++
    }
    return x === g.identity
      ? `; applying ${name(last)} ${n} more time${n === 1 ? '' : 's'} returns home`
      : `; repeating ${name(last)} never returns home; applying ${name(g.inverse(k))} once does`
  })()
  out.push({ id: `state:${e.id}`, kind: 'group_state', refs: [e.id, ...e.history.map((h) => h.element)], text: `${e.id}: applied ${steps.length ? steps.join(', then ') : 'nothing'} (${steps.length} step${steps.length === 1 ? '' : 's'}); accumulated element ${name(k)} (order ${g.elementOrder(k)})${back}` })
  if (def.definition.kind === 'cube_rotations' && layout !== 'quotient_classes') {
    const p = phiOf(k)
    const lastVia = e.history[e.history.length - 1]?.via
    out.push({ id: `diagonals:${e.id}`, kind: 'diagonals', refs: [e.id], text: `${e.id}: the accumulated rotation ${name(k)} permutes the four diagonal lines by phi = [${p.join(',')}] = ${cycleText(p)}; object i (line i at the start) now lies on line phi[i]${lastVia ? `; the last step was driven by ${lastVia === 'diagonal_lines' ? 'the diagonal objects' : 'the cube'}` : ''}. phi is a bijection G -> S4 preserving composition` })
  }
  if (def.definition.kind === 'cube_rotations' && layout === 'quotient_classes') {
    const cls = axisClasses()
    const keyText = (key: string) => `[${key.split('').join(',')}]`
    const [A, B] = e.operands
    const comp = A && B ? (() => {
      const ba = g.multiply(B, A)
      return `; A = ${name(A)} (class ${keyText(classKey(A))}), B = ${name(B)} (class ${keyText(classKey(B))}): A, then B = B·A = ${name(ba)}, class ${keyText(classKey(ba))} (the same for every choice of representatives)`
    })() : A ? `; A = ${name(A)} (class ${keyText(classKey(A))}), B not chosen` : ''
    out.push({
      id: `quotient:${e.id}`, kind: 'quotient', refs: [e.id, ...e.operands.filter((x): x is string => x !== null)],
      text: `${e.id}: observation ${e.observation === 'none' ? 'none (all 24 rotations shown)' : 'unoriented coordinate-axis lines (pi)'}; pi groups the 24 rotations into ${cls.length} classes of 4 (cosets of the kernel K = {${KERNEL.map(name).join(', ')}}, which acts trivially on all three axis lines); classes by pi: ${cls.map((c) => `${keyText(c.key)}: ${c.elements.map(name).join(' ')}`).join('; ')}; Rz has order ${g.elementOrder('r(y,-x,z)')} in G but pi(Rz) = [${piOf('r(y,-x,z)').join(',')}] has order ${permOrder(piOf('r(y,-x,z)'))}${comp}`,
    })
  }
  return out
}

/** Exact facts of a braid experiment: words, invariants and what the supported checks establish. */
function braidFacts(_doc: Doc, e: BraidExperiment): Fact[] {
  const inv = (w: readonly number[]) => `${wordText(w)} (endpoint permutation [${endpointPermutation(w).join(',')}], exponent sum ${exponentSum(w)})`
  const st = braidStatus(e.origin, e.word, e.rewrites, e.compare)
  const verdict = !st.vsCompare ? 'no comparison word' : st.vsCompare.kind === 'identical' ? 'identical words' : st.vsCompare.kind === 'different' ? `different braids (the ${st.vsCompare.invariant === 'exponent_sum' ? 'exponent sums' : 'endpoint permutations'} differ)` : 'not established by the supported checks (the invariants agree, and no rewrite sequence has shown equality)'
  const rewrites = st.rewrites ? `; ${wordText(st.rewrites.origin)} = ${wordText(e.word)} checked by ${st.rewrites.steps.length} supported rewrite${st.rewrites.steps.length === 1 ? '' : 's'}${st.originEqualsCompareByRewrites ? `, so ${wordText(st.rewrites.origin)} equals the comparison braid` : ''}` : ''
  const out: Fact[] = [{ id: `braid:${e.id}`, kind: 'braid', refs: [e.id], text: `${e.id}: braid ${inv(e.word)}${e.compare ? `; comparison ${inv(e.compare)}; ${verdict}` : ''}${rewrites}` }]
  // Every supported rewrite that applies to the current word, by position (the planner re-checks each span).
  const spans: string[] = []
  for (let at = 0; at < e.word.length; at++) {
    for (const rule of ['braid_relation', 'cancel_pair'] as const) {
      const step: RewriteStep = { rule, at, generator: null }
      try {
        const next = applyRewrite(e.word as Generator[], step)
        spans.push(`${rule} at ${at} -> ${wordText(next)}`)
      } catch {
        /* not applicable here */
      }
    }
  }
  out.push({ id: `rewrites:${e.id}`, kind: 'braid_rewrites', refs: [e.id], text: `${e.id}: supported rewrites available now: ${spans.length ? spans.join('; ') : 'none (insert_pair can insert an inverse pair at any position)'}` })
  return out
}

// ------------------------------------------------------------------ vector walks (the proof lesson)
// Exact facts of a vector-walk experiment (PROOF-EXPLORER-MATH sections 2-6), recomputed from its inputs by
// src/algebra/walk.ts. Bounds are always called bounds (whole-number upper bounds); actual peaks are separate
// facts with exact squared values and an approximation-marked length. "This point" is the persisted
// selection: the walk_selection fact states its witness j, branch, identity and squared-norm chain.

/** A rational as a short decimal when it terminates (3/2 -> "1.5"), else its exact fraction. */
export function decimalText(x: Q): string {
  let d = x.d
  while (d % 2n === 0n) d /= 2n
  while (d % 5n === 0n) d /= 5n
  return d === 1n ? String(Number(x.n) / Number(x.d)) : format(x)
}

/** The length whose exact square is `sq`: exact when sq is a perfect rational square (4 -> "2"), else marked
 * approximate ("≈4.850"; display only, never fed back into exact state). */
export function lengthText(sq: Q): string {
  const rn = isqrt(sq.n)
  const rd = isqrt(sq.d)
  return rn * rn === sq.n && rd * rd === sq.d ? decimalText({ n: rn, d: rd }) : `≈${approxSqrt(sq).toFixed(3)}`
}

/** The square root of a squared length in exact form: "2" when exact, else a surd ("√147/5", "3/√2", "√(3/2)"). */
export function surdText(sq: Q): string {
  const rn = isqrt(sq.n)
  const rd = isqrt(sq.d)
  const n = rn * rn === sq.n
  const d = rd * rd === sq.d
  if (n && d) return decimalText({ n: rn, d: rd })
  if (d) return rd === 1n ? `√${sq.n}` : `√${sq.n}/${rd}`
  if (n) return `${rn}/√${sq.d}`
  return `√(${format(sq)})`
}

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'
const subscript = (n: number) => String(n).split('').map((c) => SUBSCRIPT[Number(c)]).join('')

/**
 * Reordered endpoint W_k against the bound R, in the scene's notation (W₉), from the exact derivation. The
 * exact verdict compares the squared length with R² ("|W₉|² = 147/25 ≤ 9 = R²"); the length is stated
 * separately against R, exact when it is ("|W₂| = 2 > 1.5 = R") or marked approximate ("|W₉| = √147/5 ≈ 2.425
 * ≤ 3 = R", the relation still decided exactly). A squared value is never compared with R.
 */
export function endpointBound(f: Pick<WalkFacts, 'wNorm2' | 'R'>, k: number): { name: string; within: boolean; relation: '≤' | '>'; squared: string; length: string; lengthExact: boolean } {
  const sq = f.wNorm2[k]!
  const R2 = mul(f.R, f.R)
  const within = qcmp(sq, R2) <= 0
  const relation = within ? '≤' : '>'
  const name = `W${subscript(k)}`
  const exact = !lengthText(sq).startsWith('≈')
  const len = exact ? surdText(sq) : `${surdText(sq)} ≈ ${approxSqrt(sq).toFixed(3)}`
  return {
    name, within, relation,
    squared: `|${name}|² = ${format(sq)} ${relation} ${format(R2)} = R²`,
    length: `|${name}| = ${len} ${relation} ${decimalText(f.R)} = R`,
    lengthExact: exact,
  }
}

/** "= 2" for an exact length, "≈4.850" for an approximate one. */
const lengthIs = (sq: Q) => {
  const t = lengthText(sq)
  return t.startsWith('≈') ? t : `= ${t}`
}

const signGlyph = (s: 1 | -1) => (s === 1 ? '+' : '−')

/** How the walk relates to the prepared lesson cases (by content, so an edited sign is no longer "the hero"). */
export function walkCaseText(e: VectorWalkExperiment): string {
  const w = walkInputOf(e)
  const c = caseOf(w)
  if (c) return `prepared case "${c}" (${CASES[c].title})`
  return hasHeroVectors(w) ? 'the hero arrows with edited signs or order' : 'an edited walk (not a prepared case)'
}

/** The new bound against the source bound, in words (bounds, not measured distances). */
export function comparisonText(f: Pick<WalkFacts, 'comparison' | 'B' | 'R' | 'zeroSum'>): string {
  const r = decimalText(f.R)
  if (!f.zeroSum) return `the proposed bound ${r} is not a valid bound here: the walk does not return to its start, so the lemma does not apply`
  return f.comparison === 'better' ? `new bound ${r} is smaller than source bound ${f.B} (a better bound)`
    : f.comparison === 'same' ? `new bound ${r} equals source bound ${f.B} (valid, no improvement from these signs)`
    : `new bound ${r} is larger than source bound ${f.B} (a worse bound from these signs)`
}

/**
 * How an arrow is named in the facts: its persistent ID, then the label the scene shows when that label is
 * different ("v4 (c₁)" on the hero's arrows; "v4" on a walk whose scene labels are its IDs). The ID is the
 * identity (actions, selection items); the label is presentation from the shared arrowNames().
 */
export function arrowRef(names: ReadonlyMap<string, string>, id: string): string {
  const shown = names.get(id)
  return shown !== undefined && shown !== id ? `${id} (${shown})` : id
}

function walkFacts(doc: Doc, e: VectorWalkExperiment): Fact[] {
  let f: WalkFacts
  try {
    f = deriveWalk(walkInputOf(e))
  } catch {
    return []
  }
  const R2 = mul(f.R, f.R)
  const B2 = f.B * f.B
  const D2 = f.D * f.D
  const r = decimalText(f.R)
  const out: Fact[] = []
  const names = arrowNames(walkInputOf(e))
  const ref = (id: string) => arrowRef(names, id)
  const labelled = f.ids.some((id) => names.get(id) !== id)
  const naming = labelled
    ? `each arrow is its ID followed by the label the scene shows, in parentheses (a display label only: actions and selection items use the ID, for example walk:vector:${f.ids[0]})`
    : 'the scene labels these arrows by their IDs'
  const arrows = f.ids.map((id, i) => `${ref(id)} = ${vtext(f.vectors[i]!)} sign ${signGlyph(f.signs[i]!)}`).join(', ')
  out.push({
    id: `walk:${e.id}`, kind: 'walk', refs: [e.id, ...f.ids],
    text: `${e.id}: a vector walk of ${f.n} arrow${f.n === 1 ? '' : 's'} in ${f.dimension}D, ${walkCaseText(e)}${e.lesson ? `, lesson ${e.lesson}` : ''}; arrows in source order with their signs (${naming}): ${arrows}; total T = ${vtext(f.total)}: ${f.zeroSum ? 'the walk returns to its start (closed)' : 'the walk does NOT return to its start (not closed)'}; ${f.allInUnitBall ? 'every arrow has length at most 1' : 'some arrow is longer than 1'} (a condition of the surrounding theorem, not of this lemma)`,
  })
  out.push({
    id: `walk_bounds:${e.id}`, kind: 'walk_bounds', refs: [e.id],
    text: `${e.id} bounds (whole-number upper bounds chosen to contain every point, not measured distances): source bound B = ${f.B}, signed bound D = ${f.D}, ${f.zeroSum ? 'new' : 'proposed'} bound R = (B + D)/2 = ${r}; actual peaks, computed exactly: source |U_${f.sourcePeakAt}|² = ${format(f.sourcePeak2)} (|U_${f.sourcePeakAt}| ${lengthIs(f.sourcePeak2)}), signed |S_${f.signedPeakAt}|² = ${format(f.signedPeak2)} (|S_${f.signedPeakAt}| ${lengthIs(f.signedPeak2)}), reordered |W_${f.reorderedPeakAt}|² = ${format(f.reorderedPeak2)} (|W_${f.reorderedPeakAt}| ${lengthIs(f.reorderedPeak2)}); ${comparisonText(f)}`,
  })
  const pos = f.positive.map((i) => ref(f.ids[i]!))
  const negRev = [...f.negative].reverse().map((i) => ref(f.ids[i]!))
  out.push({
    id: `walk_order:${e.id}`, kind: 'walk_order', refs: [e.id, ...f.reorderedIds],
    text: `${e.id} new order (+ arrows in source order, then − arrows in reverse source order; every arrow used once with its direction and length unchanged; not the whole source reversed): ${pos.length ? pos.join(' ') : '(no + arrows)'} | ${negRev.length ? negRev.join(' ') : '(no − arrows)'}; p = ${f.positive.length} positive, m = ${f.negative.length} negative; source positions [${f.permutation.join(',')}]`,
  })
  if (f.zeroSum) {
    out.push({
      id: `walk_lemma:${e.id}`, kind: 'walk_lemma', refs: [e.id],
      text: `${e.id}: the lemma signedOrder_prefix_bound applies (total zero, every |U_j| ≤ B = ${f.B}, every |S_j| ≤ D = ${f.D}), so every reordered point satisfies |W_k| ≤ (B + D)/2 = ${r}; computed exactly, every |W_k|² ≤ R² = ${format(R2)}; a walk_reorder_instance check can be requested for this finite example`,
    })
  } else {
    const k = f.firstFailure
    const w = k === null ? null : f.witnesses[k]!
    const failure = w
      ? `the proposed bound (B + D)/2 = ${r} fails first at k = ${w.k}: |W_${w.k}|² = ${format(w.wNorm2)} > R² = ${format(R2)} (${lengthText(w.wNorm2)} exceeds ${r}); there j = ${w.j} (${w.branch} branch) and W_${w.k} = ${w.branch === 'negative' ? `T + (S_${w.j} − U_${w.j})/2 = ${vtext(f.W[w.k]!)}, while dropping T would wrongly give ${vtext(w.halfSum)}` : `(U_${w.j} + S_${w.j})/2 = ${vtext(f.W[w.k]!)}`}`
      : `the proposed bound (B + D)/2 = ${r} happens to hold for every reordered point here, but nothing guarantees it without the hypothesis`
    out.push({
      id: `walk_lemma:${e.id}`, kind: 'walk_lemma', refs: [e.id],
      text: `${e.id}: the lemma does NOT apply: its hypothesis "the walk returns to its start" fails (total T = ${vtext(f.total)}, not zero); ${failure}; no finite reorder certificate can be requested (a counterexample to dropping the assumption, not to the published theorem)`,
    })
  }
  const rep = representativeEndpoints(f)
  const repText = (b: 'positive' | 'negative') => (rep[b] === null ? `no ${b} branch (no ${b === 'positive' ? '+' : '−'} arrows)` : `${b} branch W_${rep[b]} (witness j = ${f.witnesses[rep[b]!]!.j})`)
  out.push({ id: `walk_endpoints:${e.id}`, kind: 'walk_endpoints', refs: [e.id], text: `${e.id} representative endpoints: ${repText('positive')}; ${repText('negative')}` })

  if (doc.selection.experimentId !== e.id) return out
  let parsed: WalkItem | null
  try {
    parsed = parseWalkItem(doc.selection.item, e)
  } catch {
    return out
  }
  if (!parsed) return out
  const it: WalkItem = parsed
  const witnessesOf = (j: number) => f.witnesses.filter((x) => x.j === j).map((x) => `W_${x.k}`)
  const used = (ws: string[]) => (ws.length ? `; witness prefix of reordered ${ws.join(', ')}` : '')
  let text: string
  if (it.kind === 'reordered') {
    const w = f.witnesses[it.index]!
    const { k, j } = w
    const W = vtext(f.W[k]!)
    const counted = w.counted.map((i) => ref(f.ids[i]!))
    const uj = `|U_${j}|² = ${format(f.uNorm2[j]!)} ≤ B² = ${B2}`
    const sj = `|S_${j}|² = ${format(f.sNorm2[j]!)} ≤ D² = ${D2}`
    const exact = `exactly |W_${k}|² = ${format(w.wNorm2)} ${w.withinBound ? '≤' : '>'} R² = ${format(R2)}`
    if (w.branch === 'positive') {
      text = `selected W_${k} = ${W} (reordered endpoint k = ${k} of ${f.n}; positive branch; witness j = ${j}): its first ${k} arrow${k === 1 ? ' is' : 's are'} the + arrows among the first ${j} source steps (${counted.length ? counted.join(' ') : 'none'}), so W_${k} = P_${j} = (U_${j} + S_${j})/2 with U_${j} = ${vtext(f.U[j]!)}, S_${j} = ${vtext(f.S[j]!)}; half-vectors U_${j}/2 = ${vtext(w.halves[0])} then S_${j}/2 = ${vtext(w.halves[1])}; ${uj} and ${sj}, so |W_${k}| = |U_${j} + S_${j}|/2 ≤ (|U_${j}| + |S_${j}|)/2 ≤ (B + D)/2 = ${r}${f.zeroSum ? '' : ' (this identity and this bound need no zero total; without a zero total the lemma as a whole still does not apply to the walk)'}; ${exact}`
    } else if (f.zeroSum) {
      text = `selected W_${k} = ${W} (reordered endpoint k = ${k} of ${f.n}; negative branch; witness j = ${j}): the − arrows not used yet are the − arrows among the first ${j} source steps (${counted.length ? counted.join(' ') : 'none'}), so W_${k} = T − M_${j} = T + (S_${j} − U_${j})/2, and T = 0 gives W_${k} = (S_${j} − U_${j})/2 with S_${j} = ${vtext(f.S[j]!)}, U_${j} = ${vtext(f.U[j]!)}; half-vectors S_${j}/2 = ${vtext(w.halves[0])} then −U_${j}/2 = ${vtext(w.halves[1])}; ${sj} and ${uj}, so |W_${k}| = |S_${j} − U_${j}|/2 ≤ (|S_${j}| + |U_${j}|)/2 ≤ (B + D)/2 = ${r}; ${exact}`
    } else {
      text = `selected W_${k} = ${W} (reordered endpoint k = ${k} of ${f.n}; negative branch; witness j = ${j}): W_${k} = T + (S_${j} − U_${j})/2 with T = ${vtext(f.total)} not zero, so T cannot be dropped: (S_${j} − U_${j})/2 = ${vtext(w.halfSum)} but W_${k} = ${W}; ${exact}${w.withinBound ? '' : ` (${lengthText(w.wNorm2)} exceeds ${r})`}; the lemma does not apply to this walk`
    }
  } else if (it.kind === 'source') {
    const j = it.index
    text = `selected source point U_${j} = ${vtext(f.U[j]!)} (after ${j} of ${f.n} source steps): |U_${j}|² = ${format(f.uNorm2[j]!)} ≤ B² = ${B2} (inside source bound ${f.B} by the choice of B; |U_${j}| ${lengthIs(f.uNorm2[j]!)})${used(witnessesOf(j))}`
  } else if (it.kind === 'signed') {
    const j = it.index
    text = `selected signed point S_${j} = ${vtext(f.S[j]!)} (auxiliary signed walk after ${j} steps; signed copies, not the original arrows): |S_${j}|² = ${format(f.sNorm2[j]!)} ≤ D² = ${D2} (inside signed bound ${f.D} by the choice of D)${used(witnessesOf(j))}`
  } else if (it.kind === 'vector') {
    const i = f.ids.indexOf(it.id)
    const t = f.reorderedIds.indexOf(it.id)
    const v = f.vectors[i]!
    text = `selected arrow ${ref(it.id)} = ${vtext(v)}: source step ${i + 1} of ${f.n} (from U_${i} to U_${i + 1}), sign ${signGlyph(f.signs[i]!)}, |${names.get(it.id) ?? it.id}|² = ${format(norm2(v))}; its signed copy is ${vtext(f.signs[i] === 1 ? v : vneg(v))}; in the new order it is step ${t + 1} (from W_${t} to W_${t + 1}); flipping its sign changes S, D, the new order and R, never U or B`
  } else return out
  out.push({ id: `walk_selection:${e.id}`, kind: 'walk_selection', refs: [e.id, doc.selection.item!], text })
  return out
}

