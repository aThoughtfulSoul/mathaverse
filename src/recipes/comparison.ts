// Branch comparison (recipe operation `branch_comparison`, SECOND-DEMO-PARALLEL-HANDOFF): one shared input
// view and one output view per branch (left -> `output`, right -> `output2`), each branch resolved step by
// step in chronological order. Generic: any two branches of the displayed experiment with 0-6 maps each.
// Words, products, readouts, motions and the verdict all come from the exact matrices and the current
// samples; nothing here knows which maps the prepared demonstration uses.

import { type Mat, type Vec, apply, compose, identity, matEq, vecEq, dimOf, presets, describeMap, coordinateProjectorDiscarded } from '../model/linear'
import { toFloat, tex, format } from '../model/rational'
import { type Doc, type Experiment, type MapDef, findBranch, findMap, findSampleSet, linearExperiments } from '../workspace/document'
import { comparisonOf, type Recipe } from './recipe'
import {
  type ViewDescription, type Primitive, type GlyphToken, type RouteDesc, type RouteStage, type StepMotion, type ViewRole,
  vecTex, vecText, vecTokens, plainName,
} from '../rendering/viewDescription'
import { PHRASE } from '../ui/phrases'

const AXES = ['x', 'y', 'z']
const f = (v: Vec): number[] => v.map(toFloat)

function matrixTex(rows: Mat): string {
  return `\\begin{bmatrix}${rows.map((r) => r.map((x) => tex(x)).join(' & ')).join(' \\\\ ')}\\end{bmatrix}`
}

function rotationOf(M: Mat): { axis: 0 | 1 | 2; turns: number } | null {
  const d = dimOf(M)
  for (let t = 1; t < 4; t++) {
    if (d === 2 && matEq(M, presets.rotation(2, t))) return { axis: 2, turns: t }
    if (d === 3) for (const axis of [0, 1, 2] as const) if (matEq(M, presets.rotation(3, t, axis))) return { axis, turns: t }
  }
  return null
}

function reflectionAxis(M: Mat): number | null {
  const d = dimOf(M)
  for (let k = 0; k < d; k++) if (matEq(M, presets.reflection(d, k))) return k
  return null
}

/** Presentation motion for one step, chosen from its exact matrix (a quarter-turn rotation, or straight). */
export function stepMotion(M: Mat): StepMotion {
  if (matEq(M, identity(dimOf(M)))) return { kind: 'none' }
  const r = rotationOf(M)
  return r ? { kind: 'rotation', axis: r.axis, angle: (r.turns * Math.PI) / 2 } : { kind: 'straight' }
}

/**
 * What one map does, in words, from its exact matrix. A coordinate reflection is named by the coordinate it
 * negates ("reflect (negate y)"): in R^3 its mirror is the xz-plane, so it is never called a reflection across
 * the x-axis, although on the plane z = 0 it reads as one.
 */
export function stepVerb(M: Mat, label: string): string {
  const d = dimOf(M)
  if (matEq(M, identity(d))) return 'leave everything in place (identity)'
  const r = rotationOf(M)
  if (r) return d === 3 ? `rotate ${r.turns * 90}° about ${AXES[r.axis]}` : `rotate ${r.turns * 90}°`
  const k = reflectionAxis(M)
  if (k !== null) return `reflect (negate ${AXES[k]})`
  const proj = coordinateProjectorDiscarded(M)
  if (proj) return `project (discard ${proj.map((i) => AXES[i]).join(', ')})`
  const name = describeMap(M)
  return `apply ${label} (${name.charAt(0).toLowerCase()}${name.slice(1)})`
}

/**
 * The chronological words of a route, one line per map ("Rotate 90° about z," / "then reflect (negate y)");
 * a route of more than three maps puts two per line. Joined with spaces they are one sentence.
 */
export function routeLines(maps: { matrix: Mat; label: string }[]): string[] {
  if (!maps.length) return ['No maps: the identity']
  const parts = maps.map((m, i) => `${i ? 'then ' : ''}${stepVerb(m.matrix, m.label)}${i < maps.length - 1 ? ',' : ''}`)
  parts[0] = parts[0]!.charAt(0).toUpperCase() + parts[0]!.slice(1)
  if (parts.length <= 3) return parts
  const lines: string[] = []
  for (let i = 0; i < parts.length; i += 2) lines.push(parts.slice(i, i + 2).join(' '))
  return lines
}

/**
 * The playback caption of one step, from its exact matrix: a true rotation path, or a straight path whose
 * in-between frames are not the map (only its end is the map's image), or the identity.
 */
export function motionLines(M: Mat, label: string): string[] {
  const m = stepMotion(M)
  if (m.kind === 'none') return [`${label}: the identity, nothing moves`]
  if (m.kind === 'rotation') {
    const r = rotationOf(M)!
    return [`${label}: rotating ${r.turns * 90}°${dimOf(M) === 3 ? ` about ${AXES[r.axis]}` : ''}`, '(a true rotation path)']
  }
  return [`${label}: straight path to the image;`, reflectionAxis(M) !== null ? 'only its end is the reflection' : `only its end shows ${label}`]
}

/** Plain words as TeX: \textsf runs, with degree signs set as ^{\circ} and TeX specials escaped. */
export function wordsTex(s: string): string {
  const esc = (t: string) => t.replace(/[\\{}$&#^_%~]/g, (c) => (c === '\\' ? '\\textbackslash{}' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\textasciicircum{}' : `\\${c}`))
  return s.split('°').map((part) => (part ? `\\textsf{${esc(part)}}` : '')).join('^{\\circ}')
}

/** Lines of words as one centred TeX block. */
export function linesTex(lines: string[]): string {
  return lines.length === 1 ? wordsTex(lines[0]!) : `\\begin{array}{c}${lines.map(wordsTex).join(' \\\\ ')}\\end{array}`
}

interface Resolved {
  desc: RouteDesc
  matrix: Mat
  maps: MapDef[]
}

const VIEWS: { view: ViewRole; pfx: string }[] = [{ view: 'input', pfx: 'in' }, { view: 'output', pfx: 'out' }, { view: 'output2', pfx: 'out2' }]

/** Derive the comparison description of the displayed experiment `e` (its bound recipe has branch_comparison). */
export function deriveComparison(doc: Doc, e: Experiment, recipe: Recipe, opts: { previewSample: string | null; tokenSet: string[] }): ViewDescription {
  const cmp = comparisonOf(recipe)!
  const ports = e.binding!.ports
  const set = findSampleSet(doc, e.sampleSetId)
  const samples = set.samples
  const prims: Primitive[] = []
  const notes: string[] = []
  const ops = new Set(recipe.operations.map((o) => o.kind))
  for (const k of ops) if (k !== 'branch_comparison' && k !== 'sample_outline' && k !== 'highlight_selection') notes.push(`${k} is not drawn in a branch comparison.`)
  const preview = !!opts.previewSample
  const selId = doc.selection.experimentId === e.id ? doc.selection.sampleId : null
  const sel = ops.has('highlight_selection') && selId ? samples.find((s) => s.id === selId) ?? null : null

  // Identity: every labelled sample keeps its name and one colour (sample order) in all three views; an
  // unlabelled selected sample is named w, like the selected group in the linked views.
  const names: Record<string, string> = {}
  const ident: Record<string, number> = {}
  let next = 0
  for (const s of samples) if (s.label) {
    names[s.id] = s.label
    ident[s.id] = next++
  }
  if (sel && !names[sel.id]) names[sel.id] = 'w'

  const resolve = (branchId: string, view: 'output' | 'output2'): Resolved => {
    const maps = findBranch(e, branchId).mapIds.map((id) => findMap(doc, id))
    const stages: RouteStage[] = []
    let C = identity(e.dimension)
    maps.forEach((m, i) => {
      const prev = C
      C = compose(e.dimension, [prev, m.matrix])
      const at: Record<string, number[]> = {}
      for (const s of samples) at[s.id] = f(apply(C, s.coords))
      const before = sel ? apply(prev, sel.coords) : null
      stages.push({
        mapId: m.id, label: m.label, symbol: maps.slice(0, i + 1).reverse().map((x) => x.label).join(''),
        verb: stepVerb(m.matrix, m.label), motion: stepMotion(m.matrix), at,
        selectedFixed: !!before && vecEq(apply(m.matrix, before), before),
      })
    })
    return {
      desc: { branchId, view, symbol: maps.length ? [...maps].reverse().map((m) => m.label).join('') : 'I', order: maps.length ? maps.map((m) => m.label).join(' then ') : 'identity', steps: maps.length, stages },
      matrix: C,
      maps,
    }
  }
  const left = resolve(ports[cmp.left]!, 'output')
  const right = resolve(ports[cmp.right]!, 'output2')
  const mapOf: Record<ViewRole, Mat> = { input: identity(e.dimension), output: left.matrix, output2: right.matrix }

  for (const { view, pfx } of VIEWS) {
    for (const s of samples) {
      const isSel = sel?.id === s.id
      prims.push({
        kind: 'point', id: `pt:${pfx}:${s.id}`, sourceId: s.id, view, at: f(apply(mapOf[view], s.coords)),
        role: isSel ? 'selected' : view === 'input' ? 'input' : 'output',
        label: doc.view.sampleLabels || isSel ? names[s.id] ?? null : null,
        interaction: view === 'input' && isSel ? 'handle' : 'select', emphasis: isSel ? 'focus' : 'normal', ident: ident[s.id],
      })
    }
    if (sel) prims.push({ kind: 'vector', id: `vec:${pfx}`, sourceId: sel.id, view, from: [0, 0, 0], to: f(apply(mapOf[view], sel.coords)), role: 'selected', label: null, ident: ident[sel.id] })
  }

  // sample_outline: through the vertices' current coordinates, in every view through that view's map.
  recipe.operations.forEach((op, i) => {
    if (op.kind !== 'sample_outline') return
    const missing = op.vertices.filter((id) => !samples.some((s) => s.id === id))
    if (missing.length) {
      notes.push(`Outline omitted: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in sample set ${set.id}.`)
      return
    }
    const vs = op.vertices.map((id) => samples.find((s) => s.id === id)!)
    for (const { view, pfx } of VIEWS) prims.push({ kind: 'outline', id: `outline:${i}:${pfx}`, view, vertexIds: [...op.vertices], points: vs.map((s) => f(apply(mapOf[view], s.coords))), role: 'neutral' })
  })

  const name = sel ? names[sel.id]! : ''
  const nameTok = (): GlyphToken => ({ tex: name, ident: sel ? ident[sel.id] : undefined, role: 'selected' })
  const W = (t: string): GlyphToken => ({ tex: t, space: 'word' })
  const sym = (t: string): GlyphToken => ({ tex: t, role: 'output' })
  const EQ: GlyphToken = { tex: '=', space: 'rel' }
  const pn = plainName(name)

  if (sel) {
    const rel = preview ? '\\to' : '='
    prims.push({
      kind: 'equation', id: 'eq:sel', view: 'input',
      parts: [{ tex: name, role: 'selected' }, { tex: `${rel} ${vecTex(sel.coords)}` }],
      tokens: [nameTok(), { tex: rel, space: 'rel' }, ...vecTokens(sel.coords)],
      plain: `${pn} ${preview ? '→' : '='} ${vecText(sel.coords)}`,
      captionTex: preview ? PHRASE.previewCommit : '', captionPlain: preview ? 'preview: release to commit' : '', preview,
      captionTokens: preview ? [W(PHRASE.previewCommit)] : undefined,
    })
  }

  for (const r of [left, right]) {
    const V = r.desc.view
    const lines = routeLines(r.maps)
    prims.push({
      kind: 'equation', id: `eq:route:${V}`, view: V,
      parts: [{ tex: r.desc.symbol, role: 'output' }, { tex: `= ${matrixTex(r.matrix)}` }],
      plain: `${r.desc.symbol} = [${r.matrix.map((row) => `[${row.map(format).join(', ')}]`).join(', ')}]`,
      captionTex: linesTex(lines), captionPlain: lines.join(' '), preview: false,
    })
    // One line per step, in chronological order ("first R: Re1 = (0, 1, 0)"); a step that leaves the selected
    // sample in place says so instead of a repeated tuple ("first S: Se1 = e1 (fixed)", "then R: RSe1 = Se1
    // (fixed)"). Its caption is the step's motion, shown while that step plays.
    if (!r.maps.length) {
      const tokens: GlyphToken[] = sel ? [sym('I'), nameTok(), EQ, ...vecTokens(sel.coords), W(PHRASE.noMaps)] : [W(PHRASE.noMaps)]
      prims.push({ kind: 'equation', id: `eq:step:${V}:0`, view: V, parts: [{ tex: tokens.map((t) => t.tex).join(' ') }], tokens, plain: sel ? `I${pn} = ${vecText(sel.coords)} (no maps: the identity)` : '(no maps: the identity)', captionTex: '', captionPlain: '', preview })
    }
    let prevPos = sel ? sel.coords : null
    r.desc.stages.forEach((st, i) => {
      const M = r.maps[i]!.matrix
      const head: GlyphToken[] = [W(i === 0 ? PHRASE.first : PHRASE.then), sym(st.label), { tex: ':', space: 'punct' }]
      const lead = `${i === 0 ? 'first' : 'then'} ${st.label}:`
      let tokens = head
      let plain = lead
      if (sel && prevPos) {
        const pos = apply(M, prevPos)
        const prevSym = i === 0 ? '' : r.desc.stages[i - 1]!.symbol
        const fixed = st.selectedFixed
        tokens = fixed
          ? [...head, sym(st.symbol), nameTok(), EQ, ...(prevSym ? [sym(prevSym)] : []), nameTok(), W(PHRASE.fixed)]
          : [...head, sym(st.symbol), nameTok(), EQ, ...vecTokens(pos)]
        plain = fixed ? `${lead} ${st.symbol}${pn} = ${prevSym}${pn} (fixed)` : `${lead} ${st.symbol}${pn} = ${vecText(pos)}`
        prevPos = pos
      }
      const motion = motionLines(M, st.label)
      prims.push({ kind: 'equation', id: `eq:step:${V}:${i + 1}`, view: V, parts: [{ tex: tokens.map((t) => t.tex).join(' ') }], tokens, plain, captionTex: linesTex(motion), captionPlain: motion.join(' '), preview })
    })
  }

  // The verdict, from exact data: the selected sample under both routes, or the two maps.
  const equal = matEq(left.matrix, right.matrix)
  const sL = left.desc.symbol
  const sR = right.desc.symbol
  const NEQ: GlyphToken = { tex: '\\neq', space: 'rel' }
  let vTokens: GlyphToken[]
  let vPlain: string
  let cTokens: GlyphToken[]
  let cPlain: string
  if (equal) {
    vTokens = [sym(sL), EQ, sym(sR)]
    vPlain = `${sL} = ${sR}`
    cTokens = [W(PHRASE.sameMap)]
    cPlain = 'both routes give the same map'
  } else if (sel && !vecEq(apply(left.matrix, sel.coords), apply(right.matrix, sel.coords))) {
    vTokens = [sym(sL), nameTok(), NEQ, sym(sR), nameTok()]
    vPlain = `${sL}${pn} ≠ ${sR}${pn}`
    cTokens = [W(PHRASE.routesDiffer)]
    cPlain = 'the routes differ'
  } else if (sel) {
    vTokens = [sym(sL), nameTok(), EQ, sym(sR), nameTok()]
    vPlain = `${sL}${pn} = ${sR}${pn}`
    cTokens = [W(PHRASE.agreeHereBut), sym(sL), NEQ, sym(sR)]
    cPlain = `the same here, but ${sL} ≠ ${sR}`
  } else {
    vTokens = [sym(sL), NEQ, sym(sR)]
    vPlain = `${sL} ≠ ${sR}`
    cTokens = [W(PHRASE.routesDiffer)]
    cPlain = 'the routes differ'
  }
  prims.push({ kind: 'equation', id: 'eq:verdict', view: 'bench', parts: [{ tex: vTokens.map((t) => t.tex).join(' ') }], tokens: vTokens, plain: vPlain, captionTex: cTokens.map((t) => t.tex).join('\\ '), captionPlain: cPlain, captionTokens: cTokens, preview })

  // Workbench status line: both routes' order in words, then what the learner can do.
  const words = (r: Resolved): GlyphToken[] => (r.maps.length ? r.maps.flatMap((m, i) => (i ? [W(PHRASE.then), { tex: m.label }] : [{ tex: m.label }])) : [W(PHRASE.identityRoute)])
  const statusTokens = [...words(left), W(PHRASE.leftVs), ...words(right), W(PHRASE.rightColon), W(PHRASE.compareHint)]
  const statusPlain = `${left.desc.order} (left) vs ${right.desc.order} (right): select a point, or drag the selected one`

  return {
    comparison: { left: left.desc, right: right.desc, mapsEqual: equal, statusTokens, statusPlain },
    mathRevision: doc.mathRevision,
    revision: doc.revision,
    experimentId: e.id,
    mapSymbol: sL,
    mapName: describeMap(left.matrix),
    matrix: left.matrix.map((row) => row.map(toFloat)),
    primitives: prims,
    collisions: [],
    fiberAvailable: false,
    fiberAxis: null,
    previewSample: opts.previewSample,
    notes,
    tokenSet: opts.tokenSet,
  }
}

/** Every product a branch's steps show ("R", "SR"), for the prepared glyph-token set. */
export function branchPrefixSymbols(doc: Doc): string[] {
  const out: string[] = []
  for (const e of linearExperiments(doc)) for (const b of e.branches) {
    const labels = b.mapIds.map((id) => findMap(doc, id).label)
    for (let k = 1; k <= labels.length; k++) out.push(labels.slice(0, k).reverse().join(''))
  }
  return out
}
