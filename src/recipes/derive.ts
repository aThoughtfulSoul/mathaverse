// The recipe interpreter (SPEC S3, WORKSPACE-AND-AI W2): one generic path from (document, bound recipe)
// to a ViewDescription. Every scene - P, Q or any other bound map - is derived here from the exact
// model; there is no per-example rendering code. The interpreter may omit a representation the map does
// not support (with an explanation) but never invents a mathematical operation.

import { type Mat, type Sample, apply, compose, describeMap, exactOutputGroups, projectorNullityOne, coordinateProjectorDiscarded, selectedFiberSegment } from '../model/linear'
import { toFloat, tex, format, q } from '../model/rational'
import { type Doc, type Experiment, findSampleSet, findBranch, findMap, findRecipe, findExperiment, linearExperiments } from '../workspace/document'
import { type Recipe, type RecipeOperation, comparisonOf } from './recipe'
import { deriveComparison, branchPrefixSymbols } from './comparison'
import {
  type ViewDescription, type Primitive, type Emphasis, type GlyphToken, type Role,
  vecTex, vecText, vecTokens, plainName, CUBE_CORNERS, CUBE_EDGES,
} from '../rendering/viewDescription'
import { PHRASE, phraseTokenSet } from '../ui/phrases'

const AXES = ['x', 'y', 'z']
const f = (v: readonly { n: bigint; d: bigint }[]): number[] => v.map(toFloat)

function matrixTex(rows: Mat): string {
  return `\\begin{bmatrix}${rows.map((r) => r.map((x) => tex(x)).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`
}

export interface DeriveOptions {
  /** The sample being dragged, when `doc` is an uncommitted preview copy. */
  previewSample?: string | null
  /** Precomputed tokenSetFor(doc) (it depends only on maps, labels and groups; callers cache it). */
  tokenSet?: string[]
}

interface Bound {
  e: Experiment
  recipe: Recipe | null
  samples: Sample[]
  matrix: Mat
  symbol: string
  selection: string | null
  ops: Set<RecipeOperation['kind']>
}

/** Resolve the displayed experiment's recipe ports against the document. */
export function resolveBinding(doc: Doc): Bound {
  const e = findExperiment(doc, doc.selection.experimentId)
  const recipe = e.binding ? findRecipe(doc, e.binding.recipeId) : null
  // A comparison's summary map (mapSymbol / matrix) is its left route; linked views use their one branch port.
  const cmp = recipe ? comparisonOf(recipe) : null
  const branchPort = cmp ? cmp.left : recipe ? Object.entries(recipe.inputs).find(([, s]) => s.type === 'linear_branch')?.[0] : undefined
  const branchId = branchPort && e.binding ? e.binding.ports[branchPort]! : e.branches[0]!.id
  const branch = findBranch(e, branchId)
  const maps = branch.mapIds.map((id) => findMap(doc, id))
  return {
    e,
    recipe,
    samples: findSampleSet(doc, e.sampleSetId).samples,
    matrix: compose(e.dimension, maps.map((m) => m.matrix)),
    symbol: maps.length ? [...maps].reverse().map((m) => m.label).join('') : 'I',
    selection: doc.selection.sampleId,
    ops: new Set(recipe ? recipe.operations.map((o) => o.kind) : []),
  }
}

/** Every glyph token the document's scenes and their drags can need (prepared before interaction). */
export function tokenSetFor(doc: Doc): string[] {
  const vals: string[] = []
  for (let k = -32; k <= 32; k++) vals.push(tex(q(k, 8)))
  const mapLabels = doc.maps.map((m) => m.label)
  const sampleLabels = doc.sampleSets.flatMap((s) => s.samples.map((x) => x.label)).filter(Boolean)
  // Generated names for unnamed members of the largest exact group any experiment shows (+1 for a free drag joining it).
  let biggest = 1
  for (const e of linearExperiments(doc)) for (const b of e.branches) {
    const A = compose(e.dimension, b.mapIds.map((id) => findMap(doc, id).matrix))
    for (const g of exactOutputGroups(A, findSampleSet(doc, e.sampleSetId).samples)) biggest = Math.max(biggest, g.ids.length)
  }
  const generated = Array.from({ length: Math.min(biggest + 1, 64) }, (_, i) => (i === 0 ? 'w' : `w_{${i + 1}}`))
  // Comparison step lines and verdicts name every product so far ("R", "SR") and use \\neq, ':' and I.
  return [...new Set([...vals, '(', ')', ',', '=', ':', '\\to', '\\neq', '\\cdots', 'I', ...mapLabels, ...branchPrefixSymbols(doc), ...sampleLabels, ...generated, ...AXES, ...phraseTokenSet()])]
}

/** Derive the description of the displayed experiment from its bound recipe (linked views or a branch comparison). */
export function deriveView(doc: Doc, opts: DeriveOptions = {}): ViewDescription {
  const b = resolveBinding(doc)
  if (b.recipe && b.ops.has('branch_comparison')) return deriveComparison(doc, b.e, b.recipe, { previewSample: opts.previewSample ?? null, tokenSet: opts.tokenSet ?? tokenSetFor(doc) })
  const { matrix: A, symbol: S, samples, selection: selected, ops } = b
  const prims: Primitive[] = []
  const notes: string[] = []
  const has = (k: RecipeOperation['kind']) => ops.has(k)
  const preview = !!opts.previewSample
  if (!b.recipe) notes.push('No representation recipe is bound to this experiment.')

  const groups = exactOutputGroups(A, samples)
  const grouping = has('exact_output_groups')
  const groupOf = new Map<string, string[]>()
  if (grouping) for (const g of groups) for (const id of g.ids) groupOf.set(id, g.ids)
  const highlight = has('highlight_selection') && selected !== null
  const selectedGroup = highlight ? groupOf.get(selected) ?? [selected] : []

  // Display names: the samples' own labels, plus w, w_2, ... for unlabelled members of the selected
  // exact group (in ID order), so every highlighted sample is identifiable in both views and readouts.
  const names: Record<string, string> = {}
  for (const s of samples) if (s.label) names[s.id] = s.label
  selectedGroup.filter((id) => !names[id]).sort().forEach((id, i) => (names[id] = i === 0 ? 'w' : `w_{${i + 1}}`))

  // Every named sample gets its labels here. Which labels are readable where is a presentation decision made
  // by the adapter from projected bounds at the viewing pose (PQ-ARCHITECTURE-DECISIONS "Label policy"): the
  // selected relationship first, the others moved, given a leader or faded. This replaced a mathematical
  // one-unit distance test that hid single-name labels near the selected group.

  if (has('linked_views')) {
    prims.push({ kind: 'cube', id: 'cube:in', view: 'input', corners: CUBE_CORNERS, edges: CUBE_EDGES, role: 'neutral' })
    // A faint source reference in the output view (VISUAL-DIRECTION "Ask"): where the inputs started.
    if (doc.view.ghostCube) prims.push({ kind: 'cube', id: 'cube:ghost', view: 'output', corners: CUBE_CORNERS, edges: CUBE_EDGES, role: 'neutral' })
    prims.push({ kind: 'cube', id: 'cube:out', view: 'output', corners: CUBE_CORNERS.map((c) => f(apply(A, c.map((x) => q(x))))), edges: CUBE_EDGES, role: 'neutral' })
    for (const s of samples) {
      const isSel = highlight && s.id === selected
      const inGroup = selectedGroup.includes(s.id)
      const emphasis: Emphasis = isSel ? 'focus' : inGroup && grouping ? 'group' : highlight ? 'dim' : 'normal'
      const label = doc.view.sampleLabels || isSel ? names[s.id] ?? null : null
      prims.push({ kind: 'point', id: `pt:in:${s.id}`, sourceId: s.id, view: 'input', at: f(s.coords), role: isSel ? 'selected' : 'input', label, interaction: isSel ? 'handle' : 'select', emphasis })
      prims.push({ kind: 'point', id: `pt:out:${s.id}`, sourceId: s.id, view: 'output', at: f(apply(A, s.coords)), role: inGroup ? 'selected' : 'output', label: null, interaction: 'select', emphasis })
    }
    // One label per exact output location holding a named sample: "Pu = Pv" where they collide, "Qv"
    // alone where they separate. The selected group's label is emphasized.
    if (doc.view.sampleLabels) {
      for (const g of groups) {
        // Selected sample first, the rest by name ("Qa = Qb", "Pu = Pv = Pw"), so labels read like the equation.
        const named = g.ids.filter((id) => names[id] && (samples.find((s) => s.id === id)!.label || selectedGroup.includes(id)))
          .sort((x, y) => names[x]!.localeCompare(names[y]!, 'en', { numeric: true }))
        if (!named.length) continue
        const ordered = selected && named.includes(selected) ? [selected, ...named.filter((id) => id !== selected)] : named
        const tokens: GlyphToken[] = []
        ordered.forEach((id, i) => {
          if (i > 0) tokens.push({ tex: '=', role: 'output', space: 'rel' })
          tokens.push({ tex: S, role: 'output' }, { tex: names[id]!, role: 'output' })
        })
        prims.push({ kind: 'label', id: `lbl:grp:${ordered[0]}`, view: 'output', anchorSourceId: ordered[0]!, tokens, plain: ordered.map((id) => `${S}${plainName(names[id]!)}`).join(' = '), emphasis: selectedGroup.includes(ordered[0]!) ? 'focus' : 'normal' })
      }
    }
  }

  const sel = highlight ? samples.find((s) => s.id === selected)! : null
  if (sel && has('linked_views')) {
    const name = names[sel.id] ?? sel.id
    prims.push({ kind: 'vector', id: 'vec:in', sourceId: sel.id, view: 'input', from: [0, 0, 0], to: f(sel.coords), role: 'input', label: name })
    prims.push({ kind: 'vector', id: 'vec:out', sourceId: sel.id, view: 'output', from: [0, 0, 0], to: f(apply(A, sel.coords)), role: 'output', label: `${S}${name}` })
  }

  // selected_fiber_segment: only for a coordinate projector with nullity one (computed from the matrix).
  const fiberOp = b.recipe?.operations.find((o) => o.kind === 'selected_fiber_segment')
  const seg = fiberOp && sel ? selectedFiberSegment(A, sel.coords) : null
  if (fiberOp && sel && !seg) {
    const proj = coordinateProjectorDiscarded(A)
    notes.push(proj ? `Line-fiber view unavailable: the kernel has dimension ${proj.length}, not 1.` : 'Line-fiber view unavailable: this map is not a coordinate projector with one discarded coordinate.')
  }
  if (seg) {
    prims.push({ kind: 'segment', id: 'fiber', view: 'input', from: f(seg.from), to: f(seg.to), role: 'fiber', label: `${AXES[seg.direction]}-fiber, bounded to |${AXES[seg.direction]}| ≤ 4` })
    prims.push({ kind: 'plane', id: 'plane:image', view: 'output', normalAxis: seg.direction, halfExtent: 1.6, role: 'plane', label: `image of ${S}: ${AXES[seg.direction]} = 0` })
  }
  const discarded = seg?.direction ?? null

  if (has('equation_caption')) {
    const caption = [describeMap(A), ...notes].join(' · ')
    prims.push({ kind: 'equation', id: 'eq:map', view: 'bench', parts: [{ tex: S, role: 'output' }, { tex: `= ${matrixTex(A)}` }], plain: `${S} = [${A.map((r) => `[${r.map(format).join(', ')}]`).join(', ')}]`, captionTex: `\\textsf{${caption}}`, captionPlain: caption, preview: false })
  }

  if (sel) {
    const name = names[sel.id]!
    const rel = preview ? '\\to' : '='
    prims.push({
      kind: 'equation', id: 'eq:sel', view: 'input',
      parts: [{ tex: name, role: 'selected' }, { tex: `${rel} ${vecTex(sel.coords)}` }],
      tokens: [{ tex: name, role: 'selected' }, { tex: rel, space: 'rel' }, ...vecTokens(sel.coords)],
      plain: `${plainName(name)} ${preview ? '→' : '='} ${vecText(sel.coords)}`,
      captionTex: preview ? PHRASE.previewCommit : '', captionPlain: preview ? 'preview: release to commit' : '', preview,
      captionTokens: preview ? [{ tex: PHRASE.previewCommit, space: 'word' }] : undefined,
    })
    const out = apply(A, sel.coords)
    // Every member of the exact group is named (at most four shown; the count is always stated).
    const members = grouping ? [sel.id, ...selectedGroup.filter((id) => id !== sel.id).sort((x, y) => (names[x] ?? x).localeCompare(names[y] ?? y, 'en', { numeric: true }))] : [sel.id]
    const shown = members.slice(0, 4)
    const parts: { tex: string; role?: Role }[] = []
    const tokens: GlyphToken[] = []
    for (const id of shown) {
      parts.push({ tex: S, role: 'output' }, { tex: names[id]! }, { tex: '=' })
      tokens.push({ tex: S, role: 'output' }, { tex: names[id]! }, { tex: '=', space: 'rel' })
    }
    if (members.length > shown.length) {
      parts.push({ tex: '\\cdots =' })
      tokens.push({ tex: '\\cdots' }, { tex: '=', space: 'rel' })
    }
    parts.push({ tex: vecTex(out) })
    tokens.push(...vecTokens(out))
    const plain = `${shown.map((id) => `${S}${plainName(names[id]!)}`).join(' = ')}${members.length > shown.length ? ' = …' : ''} = ${vecText(out)}`
    const what = !grouping ? '' : members.length > 1 ? `${members.length}\\ \\textsf{samples share this exact output}` : '\\textsf{no other sample shares this output}'
    const whatPlain = !grouping ? '' : members.length > 1 ? `${members.length} samples share this exact output` : 'no other sample shares this output'
    prims.push({
      kind: 'equation', id: 'eq:out', view: 'output', parts, tokens, plain,
      captionTex: preview && what ? `\\textsf{preview:}\\ ${what}` : what, captionPlain: preview && whatPlain ? `preview: ${whatPlain}` : whatPlain, preview,
      captionTokens: grouping ? [
        ...(preview ? [{ tex: PHRASE.previewColon, space: 'word' as const }] : []),
        ...(members.length > 1 ? [{ tex: String(members.length) }, { tex: PHRASE.share, space: 'word' as const }] : [{ tex: PHRASE.noOther, space: 'word' as const }]),
      ] : undefined,
    })
  }

  return {
    comparison: null,
    mathRevision: doc.mathRevision,
    revision: doc.revision,
    experimentId: b.e.id,
    mapSymbol: S,
    mapName: describeMap(A),
    matrix: A.map((row) => row.map(toFloat)),
    primitives: prims,
    collisions: grouping ? groups.filter((g) => g.ids.length > 1).map((g) => g.ids) : [],
    fiberAvailable: seg !== null,
    fiberAxis: discarded,
    previewSample: opts.previewSample ?? null,
    notes,
    tokenSet: opts.tokenSet ?? tokenSetFor(doc),
  }
}

/** The projector predicate used for the fiber gesture (exported for interaction code and tests). */
export { projectorNullityOne }
