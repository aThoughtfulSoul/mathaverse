// One transaction planner for every source (WORKSPACE-AND-AI W3): local controls, the desktop pointer
// and assistant proposals all produce an ordered action list against an expected base revision. Every
// action is validated on a temporary document; the whole transaction applies once, or nothing does.
// Presentation effects (`play`) and external effects (`request_check`) are returned, never run here.
//
// Pure module: imported by the browser and by the Node server (same validators on both sides, W4).

import { type Mat, type Vec, checkAuthoredMatrix, checkAuthoredVector, gridSamples, vecEq, matEq, describeMap } from '../model/linear'
import { fromJson as qFromJson, format } from '../model/rational'
import {
  type Doc, type MapDef, type PresetMeta, type SampleSet, type Experiment, type AnyExperiment, type GroupExperiment, type BraidExperiment, type VectorWalkExperiment, DOC_LIMITS, DocumentError, SELECTION_PORT_VALUE,
  findSampleSet, findMap, findExperiment, findAnyExperiment, findGroupExperiment, findBraidExperiment, findWalkExperiment, findGroup, groupFor, findBranch, findRecipe, checkReferences, checkItem, presetMatrix, parsePreset, branchMatrix, docToJson, docBytes, walkInputOf,
} from './document'
import { groupOf, groupName } from '../algebra/groups'
import { checkPermutation, cycleText } from '../algebra/permutation'
import { rotationForDiagonalPermutation } from '../algebra/cube'
import { type Generator, applyRewrite, invertWord, wordText, MAX_BRAID_LENGTH } from '../algebra/braid'
import { type ActionJson, type MapDefinitionJson, type Ref, type WalkVectorJson, ActionError, parseActions } from './actions'
import type { ClaimRequest, ClaimDescriptor, MapStepJson, WitnessJson } from './claims'
import { comparisonOf } from '../recipes/recipe'
import { toJson as qToJson } from '../model/rational'
import type { WalkStage } from '../domains/inputs'
import { type Sign, type WalkInput, WalkError, checkWalk, deriveWalk, parseWalkItem, vtext } from '../algebra/walk'
import { describeWalkClaim } from './walkClaim'
import { arrowNames } from '../lessons/steinitz/cases'

export class TransactionError extends Error {
  override name = 'TransactionError'
  constructor(message: string, readonly index: number | null = null) {
    super(message)
  }
}

export type Effect =
  | { kind: 'play'; experimentId: string; branchId: string; duration: number }
  | { kind: 'play_comparison'; experimentId: string; stepDuration: number }
  /** Replay a group or braid experiment's construction (presentation only). */
  | { kind: 'play_steps'; experimentId: string; stepDuration: number }
  | { kind: 'request_check'; claim: ClaimRequest }
  /** Show one step of the proof lesson (presentation only, like play). */
  | { kind: 'show_walk_stage'; experimentId: string; stage: WalkStage }

export type ObjectType = 'sampleSet' | 'map' | 'experiment' | 'recipe' | 'group'

export interface Plan {
  /** The planned document (revision counters untouched: the Workspace assigns them on commit). */
  doc: Doc
  /** Some document field changed. */
  changed: boolean
  /** Mathematical data changed (maps, samples, branches, experiments). */
  math: boolean
  effects: Effect[]
  /** Transaction-local name -> assigned ID, per object type (`$q` in a map field names the created map q). */
  created: Record<ObjectType, Record<string, string>>
  /** Application-generated, human-readable account of what the transaction does. */
  summary: string[]
}

function cloneExperiment(e: AnyExperiment): AnyExperiment {
  const binding = e.binding ? { ...e.binding, ports: { ...e.binding.ports } } : null
  switch (e.domain) {
    case 'linear':
      return { ...e, branches: e.branches.map((b) => ({ ...b, mapIds: [...b.mapIds] })), binding }
    case 'group':
      return { ...e, history: e.history.map((h) => ({ ...h })), operands: [...e.operands], binding }
    case 'braid':
      return { ...e, word: [...e.word], origin: [...e.origin], rewrites: e.rewrites.map((r) => ({ ...r })), compare: e.compare ? [...e.compare] : null, binding }
    case 'vector_walk':
      return { ...e, vectors: e.vectors.map((v) => ({ ...v })), order: [...e.order], signs: [...e.signs], binding }
  }
}

const cloneDoc = (d: Doc): Doc => ({
  ...d,
  sampleSets: d.sampleSets.map((s) => ({ ...s, samples: [...s.samples] })),
  maps: [...d.maps],
  groups: [...d.groups],
  experiments: d.experiments.map(cloneExperiment),
  recipes: [...d.recipes],
  view: { ...d.view },
  selection: { ...d.selection },
})

function definitionToMatrix(def: MapDefinitionJson, d: 2 | 3, where: string): { matrix: Mat; preset: PresetMeta | null } {
  if ('preset' in def) {
    const preset = parsePreset(def.preset, d, `${where}.preset`)
    return { matrix: presetMatrix(d, preset), preset }
  }
  if (def.matrix.length !== d || def.matrix.some((r) => r.length !== d)) throw new DocumentError(`${where}.matrix: expected ${d} x ${d}`)
  const matrix = def.matrix.map((r) => r.map((c) => qFromJson(c)))
  checkAuthoredMatrix(matrix)
  return { matrix, preset: null }
}

const vecText = (v: Vec) => `(${v.map(format).join(', ')})`

/** Walk inputs from action JSON, validated exactly (src/algebra/walk.ts); a WalkError becomes a DocumentError. */
function walkFromJson(dimension: 2 | 3, vectors: WalkVectorJson[], order: string[], signs: Sign[]): WalkInput {
  const w: WalkInput = { dimension, vectors: vectors.map((v) => ({ id: v.id, coords: v.coords.map((c) => qFromJson(c)) })), order: [...order], signs: [...signs] }
  try {
    checkWalk(w)
  } catch (e) {
    if (e instanceof WalkError) throw new DocumentError(e.message)
    throw e
  }
  return w
}

const signText = (signs: readonly Sign[]) => signs.map((s) => (s === 1 ? '+' : '−')).join(' ')

/**
 * Plan a transaction on a temporary copy of `base`. Throws TransactionError (with the failing action's
 * index) and leaves `base` untouched on any error. `actions` may be unvalidated JSON.
 */
export function planTransaction(base: Doc, actionsInput: unknown): Plan {
  let actions: ActionJson[]
  try {
    actions = parseActions(actionsInput, 16)
  } catch (e) {
    throw new TransactionError((e as Error).message, e instanceof ActionError ? e.index : null)
  }
  const doc = cloneDoc(base)
  const created: Record<ObjectType, Record<string, string>> = { sampleSet: {}, map: {}, experiment: {}, recipe: {}, group: {} }
  const effects: Effect[] = []
  const summary: string[] = []
  let math = false

  const resolve = (r: Ref, type: ObjectType, what: string): string => {
    if (!r.startsWith('$')) return r
    const id = created[type][r.slice(1)]
    if (!id) throw new DocumentError(`${what}: no ${type} named ${r} was created earlier in this transaction`)
    return id
  }
  const PREFIX: Record<ObjectType, string> = { sampleSet: 'set', map: 'map', experiment: 'exp', recipe: 'recipe', group: 'grp' }
  const fresh = (type: ObjectType, name: string, taken: string[]): string => {
    if (created[type][name]) throw new DocumentError(`local ${type} name "${name}" used twice`)
    const id = `${PREFIX[type]}-${name}`
    if (taken.includes(id)) throw new DocumentError(`an object with ID ${id} already exists; use an update action`)
    created[type][name] = id
    return id
  }
  // Summaries are plain text: a label's TeX subscript reads as a plain suffix (e_{1} -> e1).
  const nameOf = (set: SampleSet, sampleId: string) => set.samples.find((s) => s.id === sampleId)?.label.replace(/_\{(.*?)\}/g, '$1') || sampleId
  const plainLabel = (l: string) => l.replace(/_\{(.*?)\}/g, '$1')
  /** Replace one experiment in the planned document. */
  const put = (next: AnyExperiment) => {
    doc.experiments = doc.experiments.map((x) => (x.id === next.id ? next : x))
  }
  const elementName = (e: GroupExperiment, el: string) => groupFor(doc, e).label(el).plain
  /** A selected non-element item, as the learner reads it (src/domains/inputs.ts conventions); a walk's arrows by
   *  the names its scene labels them with (`names`, from arrowNames). */
  const itemName = (item: string, names?: Map<string, string>) => {
    const [kind, v] = [item.slice(0, item.indexOf(':')), item.slice(item.indexOf(':') + 1)]
    if (kind === 'class') return `the class [${v.split('').join(',')}]`
    if (kind === 'line') return `diagonal object ${v}`
    if (kind === 'axis') return `the ${'xyz'[Number(v)] ?? v}-axis line`
    if (kind === 'crossing') return `crossing ${Number(v) + 1}`
    if (kind === 'strand') return `strand ${v}`
    if (kind === 'walk') {
      const [what, x] = v.split(':')
      const n = (x ?? '').replace(/[0-9]/g, (c) => '₀₁₂₃₄₅₆₇₈₉'[Number(c)]!)
      return what === 'vector' ? `arrow ${names?.get(x ?? '') ?? x}` : what === 'reordered' ? `reordered endpoint W${n}` : what === 'signed' ? `signed prefix S${n}` : `source prefix U${n}`
    }
    return item
  }
  const walkExp = (r: Ref) => findWalkExperiment(doc, resolve(r, 'experiment', 'experimentId'))
  /** A walk's inputs changed: a selected item that no longer exists in it is cleared (never clamped). */
  const putWalk = (e: VectorWalkExperiment, w: WalkInput) => {
    put({ ...e, dimension: w.dimension, vectors: w.vectors.map((v) => ({ id: v.id, coords: v.coords })), order: [...w.order], signs: [...w.signs] })
    if (doc.selection.experimentId === e.id && doc.selection.item !== null) {
      try {
        parseWalkItem(doc.selection.item, w)
      } catch {
        doc.selection = { ...doc.selection, item: null }
      }
    }
  }
  const domainName = (e: AnyExperiment) => (e.domain === 'group' ? plainLabel(findGroup(doc, e.groupId).label) : e.domain === 'braid' ? 'the braid' : e.domain === 'vector_walk' ? 'the walk' : e.id)
  const groupExp = (r: Ref) => findGroupExperiment(doc, resolve(r, 'experiment', 'experimentId'))
  const braidExp = (r: Ref) => findBraidExperiment(doc, resolve(r, 'experiment', 'experimentId'))
  /** A braid's main word changed outside the rewrite record: the record restarts from the new word, and a
   * selected crossing that no longer exists is cleared. */
  const setMainWord = (e: BraidExperiment, w: Generator[], keepRecord: boolean, steps = e.rewrites) => {
    put({ ...e, word: w, origin: keepRecord ? e.origin : w, rewrites: keepRecord ? steps : [] })
    const m = doc.selection.experimentId === e.id ? /^crossing:(\d+)$/.exec(doc.selection.item ?? '') : null
    if (m && Number(m[1]) >= w.length) doc.selection = { ...doc.selection, item: null }
  }

  for (const [index, a] of actions.entries()) {
    try {
      switch (a.kind) {
        case 'create_samples': {
          if (doc.sampleSets.length >= DOC_LIMITS.sampleSets) throw new DocumentError('capacity: too many sample sets')
          const id = fresh('sampleSet', a.name, doc.sampleSets.map((s) => s.id))
          const samples = 'preset' in a.source
            ? gridSamples(a.dimension).map((s) => ({ ...s, label: '' }))
            : a.source.samples.map((s) => {
                const coords = s.coords.map((c) => qFromJson(c))
                checkAuthoredVector(coords)
                return { id: s.id, label: s.label, coords }
              })
          if (new Set(samples.map((s) => s.id)).size !== samples.length) throw new DocumentError('duplicate sample IDs')
          doc.sampleSets.push({ id, dimension: a.dimension, samples })
          math = true
          summary.push(`Created ${samples.length} samples (${id})`)
          break
        }
        case 'create_map': {
          if (doc.maps.length >= DOC_LIMITS.maps) throw new DocumentError('capacity: too many maps')
          const id = fresh('map', a.name, doc.maps.map((m) => m.id))
          const { matrix, preset } = definitionToMatrix(a.definition, a.dimension, 'definition')
          doc.maps.push({ id, dimension: a.dimension, label: a.label, matrix, preset })
          math = true
          summary.push(`Created map ${a.label}: ${describeMap(matrix)}`)
          break
        }
        case 'update_map': {
          const id = resolve(a.mapId, 'map', 'mapId')
          const old = findMap(doc, id)
          const { matrix, preset } = definitionToMatrix(a.definition, old.dimension, 'definition')
          const next: MapDef = { ...old, label: a.label, matrix, preset }
          doc.maps = doc.maps.map((m) => (m.id === id ? next : m))
          if (!matEq(old.matrix, matrix)) {
            math = true
            summary.push(`Changed map ${a.label}: ${describeMap(matrix)}`)
          } else if (old.label !== a.label) summary.push(`Renamed map ${old.label} to ${a.label}`)
          break
        }
        case 'update_sample': {
          const setId = resolve(a.sampleSetId, 'sampleSet', 'sampleSetId')
          const set = findSampleSet(doc, setId)
          const i = set.samples.findIndex((s) => s.id === a.sampleId)
          if (i < 0) throw new DocumentError(`unknown sample ${a.sampleId} in ${setId}`)
          if (a.coords.length !== set.dimension) throw new DocumentError(`sample needs ${set.dimension} coordinates`)
          const coords = a.coords.map((c) => qFromJson(c))
          checkAuthoredVector(coords)
          if (!vecEq(set.samples[i]!.coords, coords)) {
            const samples = set.samples.map((s, k) => (k === i ? { ...s, coords } : s))
            doc.sampleSets = doc.sampleSets.map((s) => (s.id === setId ? { ...s, samples } : s))
            math = true
            summary.push(`Moved ${nameOf(set, a.sampleId)} to ${vecText(coords)}`)
          }
          break
        }
        case 'create_experiment': {
          if (doc.experiments.length >= DOC_LIMITS.experiments) throw new DocumentError(`capacity: at most ${DOC_LIMITS.experiments} experiments`)
          const id = fresh('experiment', a.name, doc.experiments.map((e) => e.id))
          const set = findSampleSet(doc, resolve(a.sampleSetId, 'sampleSet', 'sampleSetId'))
          const branches = a.branches.map((b) => ({ id: b.id, mapIds: b.mapIds.map((m) => resolve(m, 'map', 'mapIds')) }))
          const e: Experiment = { domain: 'linear', id, dimension: set.dimension, sampleSetId: set.id, branches, binding: null }
          doc.experiments.push(e)
          math = true
          summary.push(`Created experiment ${id}`)
          break
        }
        case 'set_branch': {
          const id = resolve(a.experimentId, 'experiment', 'experimentId')
          const e = findExperiment(doc, id)
          const b = findBranch(e, a.branchId)
          const mapIds = a.mapIds.map((m) => resolve(m, 'map', 'mapIds'))
          if (b.mapIds.join('|') !== mapIds.join('|')) {
            put({ ...e, branches: e.branches.map((y) => (y.id === b.id ? { ...y, mapIds } : y)) })
            math = true
            summary.push(`Set ${id}/${b.id} to ${mapIds.map((m) => findMap(doc, m).label).join(' then ') || 'identity'}`)
          }
          break
        }
        case 'bind_recipe': {
          const eid = resolve(a.experimentId, 'experiment', 'experimentId')
          const e = findAnyExperiment(doc, eid)
          const r = findRecipe(doc, resolve(a.recipeId, 'recipe', 'recipeId'))
          const ports: Record<string, string> = {}
          let selection: string | null | undefined
          for (const k of Object.keys(a.bindings)) if (!(k in r.inputs)) throw new DocumentError(`recipe ${r.id} has no port "${k}"`)
          for (const [port, spec] of Object.entries(r.inputs)) {
            if (!(port in a.bindings)) throw new DocumentError(`port "${port}" of ${r.id} is unbound`)
            const v = a.bindings[port]!
            if (spec.type === 'sample_id' || spec.type === 'group_element') {
              ports[port] = SELECTION_PORT_VALUE
              selection = v
            } else {
              if (v === null) throw new DocumentError(`port "${port}" needs a value`)
              ports[port] = spec.type === 'sample_set' ? resolve(v, 'sampleSet', `bindings.${port}`) : spec.type === 'finite_group' ? resolve(v, 'group', `bindings.${port}`) : v
            }
          }
          put({ ...e, binding: { recipeId: r.id, ports } } as AnyExperiment)
          const same = doc.selection.experimentId === eid
          if (e.domain === 'linear') {
            doc.selection = selection !== undefined ? { experimentId: eid, sampleId: selection, item: null } : { experimentId: eid, sampleId: same ? doc.selection.sampleId : null, item: null }
            const set = findSampleSet(doc, e.sampleSetId)
            const branchId = Object.entries(r.inputs).find(([, s]) => s.type === 'linear_branch')?.[0]
            const sym = branchId ? [...findBranch(e, ports[branchId]!).mapIds].reverse().map((m) => findMap(doc, m).label).join('') : ''
            summary.push(`Bound "${r.name}" to ${sym || eid}${selection ? `, selecting ${nameOf(set, selection)}` : ''}`)
          } else {
            doc.selection = { experimentId: eid, sampleId: null, item: selection !== undefined ? selection : same ? doc.selection.item : null }
            const what = domainName(e)
            const sel = selection && e.domain === 'group' && groupFor(doc, e).has(selection) ? `, selecting ${elementName(e, selection)}` : ''
            summary.push(`Bound "${r.name}" to ${what}${sel}`)
          }
          break
        }
        case 'set_view':
          doc.view = { ghostCube: a.ghostCube, sampleLabels: a.sampleLabels }
          summary.push('Changed visible layers')
          break
        case 'select': {
          const eid = resolve(a.experimentId, 'experiment', 'experimentId')
          const e = findAnyExperiment(doc, eid)
          if (e.domain !== 'linear') {
            if (a.sampleId !== null) throw new DocumentError(`${e.domain} experiment ${eid} has no samples; select it with sampleId null, then select_item`)
            doc.selection = { experimentId: eid, sampleId: null, item: null }
            summary.push(`Showed ${domainName(e)} (${eid})`)
            break
          }
          const set = findSampleSet(doc, e.sampleSetId)
          if (a.sampleId !== null && !set.samples.some((s) => s.id === a.sampleId)) throw new DocumentError(`sample ${a.sampleId} is not in ${eid}`)
          doc.selection = { experimentId: eid, sampleId: a.sampleId, item: null }
          summary.push(a.sampleId ? `Selected ${nameOf(set, a.sampleId)}` : 'Cleared the selection')
          break
        }
        case 'play': {
          const eid = resolve(a.experimentId, 'experiment', 'experimentId')
          findBranch(findExperiment(doc, eid), a.branchId)
          effects.push({ kind: 'play', experimentId: eid, branchId: a.branchId, duration: a.duration })
          summary.push('Play the transformation')
          break
        }
        case 'play_comparison': {
          const eid = resolve(a.experimentId, 'experiment', 'experimentId')
          findExperiment(doc, eid)
          effects.push({ kind: 'play_comparison', experimentId: eid, stepDuration: a.stepDuration })
          summary.push('Replay the comparison step by step')
          break
        }
        case 'save_recipe': {
          if (doc.recipes.length >= DOC_LIMITS.recipes) throw new DocumentError('capacity: at most eight recipes')
          const id = fresh('recipe', a.name, doc.recipes.map((r) => r.id))
          doc.recipes.push({ schemaVersion: 1, id, ...structuredClone(a.recipe) })
          summary.push(`Saved recipe "${a.recipe.name}"`)
          break
        }
        case 'create_group': {
          if (doc.groups.length >= DOC_LIMITS.groups) throw new DocumentError(`capacity: at most ${DOC_LIMITS.groups} groups`)
          const id = fresh('group', a.name, doc.groups.map((g) => g.id))
          const g = groupOf(a.definition)
          doc.groups.push({ id, label: a.label, definition: a.definition })
          math = true
          summary.push(`Created group ${plainLabel(a.label)}: ${groupName(a.definition).plain}, ${g.order} elements`)
          break
        }
        case 'create_group_experiment': {
          if (doc.experiments.length >= DOC_LIMITS.experiments) throw new DocumentError(`capacity: at most ${DOC_LIMITS.experiments} experiments`)
          const id = fresh('experiment', a.name, doc.experiments.map((e) => e.id))
          const groupId = resolve(a.groupId, 'group', 'groupId')
          const def = findGroup(doc, groupId)
          doc.experiments.push({ domain: 'group', id, groupId, history: [], operands: [null, null], observation: 'none', binding: null })
          math = true
          summary.push(`Created experiment ${id} on ${plainLabel(def.label)}`)
          break
        }
        case 'apply_element': {
          const e = groupExp(a.experimentId)
          const g = groupFor(doc, e)
          if (!g.has(a.element)) throw new DocumentError(`${a.element} is not an element of ${e.groupId}`)
          if (e.history.length >= DOC_LIMITS.history) throw new DocumentError(`the history holds ${DOC_LIMITS.history} steps; reset it first`)
          put({ ...e, history: [...e.history, { element: a.element, via: 'element' }] })
          math = true
          summary.push(`Applied ${elementName(e, a.element)}`)
          break
        }
        case 'apply_permutation': {
          const e = groupExp(a.experimentId)
          if (findGroup(doc, e.groupId).definition.kind !== 'cube_rotations') throw new DocumentError('only the cube group acts on the diagonal lines')
          const p = checkPermutation(a.permutation, 'permutation', 4)
          const element = rotationForDiagonalPermutation(p)
          if (!element) throw new DocumentError(`no cube rotation permutes the diagonal lines by ${JSON.stringify(a.permutation)}`)
          if (e.history.length >= DOC_LIMITS.history) throw new DocumentError(`the history holds ${DOC_LIMITS.history} steps; reset it first`)
          put({ ...e, history: [...e.history, { element, via: 'diagonal_lines' }] })
          math = true
          summary.push(`Applied ${elementName(e, element)}, the rotation that permutes the diagonal lines by ${cycleText(p)}`)
          break
        }
        case 'reset_group': {
          const e = groupExp(a.experimentId)
          if (e.history.length) {
            put({ ...e, history: [] })
            math = true
            summary.push(`Reset ${e.id} to the identity`)
          }
          break
        }
        case 'undo_step': {
          const e = groupExp(a.experimentId)
          const last = e.history[e.history.length - 1]
          if (!last) throw new DocumentError(`${e.id} has no applied operation to undo`)
          put({ ...e, history: e.history.slice(0, -1) })
          math = true
          summary.push(`Removed the last step (${elementName(e, last.element)})`)
          break
        }
        case 'set_operands': {
          const e = groupExp(a.experimentId)
          const g = groupFor(doc, e)
          for (const o of a.operands) if (o !== null && !g.has(o)) throw new DocumentError(`${o} is not an element of ${e.groupId}`)
          put({ ...e, operands: [a.operands[0], a.operands[1]] })
          summary.push(`Chose ${a.operands.map((o, i) => `${i ? 'B' : 'A'} = ${o === null ? 'none' : elementName(e, o)}`).join(', ')}`)
          break
        }
        case 'set_observation': {
          const e = groupExp(a.experimentId)
          if (a.observation !== 'none' && findGroup(doc, e.groupId).definition.kind !== 'cube_rotations') throw new DocumentError('the axis-line observation needs the cube group')
          put({ ...e, observation: a.observation })
          summary.push(a.observation === 'none' ? 'Showed all 24 rotations' : 'Tracked only which opposite-face pair goes where')
          break
        }
        case 'select_item': {
          const eid = resolve(a.experimentId, 'experiment', 'experimentId')
          const e = findAnyExperiment(doc, eid)
          if (e.domain === 'linear') throw new DocumentError(`${eid} is a linear experiment; use select with a sample`)
          checkItem(doc, e, a.item)
          doc.selection = { experimentId: eid, sampleId: null, item: a.item }
          summary.push(a.item === null ? 'Cleared the selection' : `Selected ${e.domain === 'group' && groupFor(doc, e).has(a.item) ? elementName(e, a.item) : itemName(a.item, e.domain === 'vector_walk' ? arrowNames(walkInputOf(e)) : undefined)}`)
          break
        }
        case 'play_steps': {
          const eid = resolve(a.experimentId, 'experiment', 'experimentId')
          const e = findAnyExperiment(doc, eid)
          if (e.domain === 'linear') throw new DocumentError(`${eid} is a linear experiment; use play or play_comparison`)
          effects.push({ kind: 'play_steps', experimentId: eid, stepDuration: a.stepDuration })
          summary.push('Replay the construction step by step')
          break
        }
        case 'create_braid_experiment': {
          if (doc.experiments.length >= DOC_LIMITS.experiments) throw new DocumentError(`capacity: at most ${DOC_LIMITS.experiments} experiments`)
          const id = fresh('experiment', a.name, doc.experiments.map((e) => e.id))
          doc.experiments.push({ domain: 'braid', id, strands: 3, word: [...a.word], origin: [...a.word], rewrites: [], compare: a.compare ? [...a.compare] : null, binding: null })
          math = true
          summary.push(`Created braid ${wordText(a.word)}${a.compare ? ` beside ${wordText(a.compare)}` : ''}`)
          break
        }
        case 'set_braid': {
          const e = braidExp(a.experimentId)
          if (a.target === 'word') {
            if (a.word === null) throw new DocumentError('the main word cannot be removed; use [] for the identity braid')
            setMainWord(e, [...a.word], false)
          } else put({ ...e, compare: a.word ? [...a.word] : null })
          math = true
          summary.push(a.target === 'word' ? `Set the braid to ${wordText(a.word!)}` : a.word ? `Compare with ${wordText(a.word)}` : 'Removed the comparison')
          break
        }
        case 'append_crossing': {
          const e = braidExp(a.experimentId)
          const base = a.target === 'word' ? e.word : e.compare ?? []
          if (base.length >= MAX_BRAID_LENGTH) throw new DocumentError(`a braid word holds at most ${MAX_BRAID_LENGTH} crossings`)
          const next = [...base, a.generator]
          if (a.target === 'word') setMainWord(e, next, false)
          else put({ ...e, compare: next })
          math = true
          summary.push(`Appended ${wordText([a.generator])} to the ${a.target === 'word' ? 'braid' : 'comparison'}`)
          break
        }
        case 'invert_braid': {
          const e = braidExp(a.experimentId)
          if (a.target === 'word') setMainWord(e, invertWord(e.word), false)
          else if (e.compare) put({ ...e, compare: invertWord(e.compare) })
          else throw new DocumentError('there is no comparison word to invert')
          math = true
          summary.push(`Inverted the ${a.target === 'word' ? 'braid' : 'comparison'}: reversed order, every crossing flipped`)
          break
        }
        case 'rewrite_braid': {
          const e = braidExp(a.experimentId)
          if (e.rewrites.length >= DOC_LIMITS.history) throw new DocumentError(`the rewrite record holds ${DOC_LIMITS.history} steps; set the word again to start a new one`)
          const step = { rule: a.rule, at: a.at, generator: a.generator }
          const next = applyRewrite(e.word, step)
          setMainWord(e, next, true, [...e.rewrites, step])
          math = true
          summary.push(`${a.rule === 'cancel_pair' ? 'Cancelled an inverse pair' : a.rule === 'insert_pair' ? 'Inserted an inverse pair' : 'Applied the braid relation'} at crossing ${a.at + 1}: ${wordText(e.word)} -> ${wordText(next)}`)
          break
        }
        case 'create_vector_walk': {
          if (doc.experiments.length >= DOC_LIMITS.experiments) throw new DocumentError(`capacity: at most ${DOC_LIMITS.experiments} experiments`)
          const id = fresh('experiment', a.name, doc.experiments.map((e) => e.id))
          const w = walkFromJson(a.dimension, a.vectors, a.order, a.signs)
          doc.experiments.push({ domain: 'vector_walk', id, dimension: w.dimension, vectors: w.vectors.map((v) => ({ id: v.id, coords: v.coords })), order: [...w.order], signs: [...w.signs], lesson: a.lesson, binding: null })
          math = true
          const f = deriveWalk(w)
          summary.push(`Created a walk of ${f.n} arrows in ${w.dimension}D (${id}); total ${f.zeroSum ? 'zero' : vtext(f.total)}`)
          break
        }
        case 'set_vector_walk': {
          const e = walkExp(a.experimentId)
          const w = walkFromJson(a.dimension, a.vectors, a.order, a.signs)
          putWalk(e, w)
          math = true
          const f = deriveWalk(w)
          summary.push(`Replaced the walk: ${f.n} arrows, signs ${signText(f.signs)}; total ${f.zeroSum ? 'zero (closed)' : `${vtext(f.total)} (not closed)`}`)
          break
        }
        case 'set_walk_signs': {
          const e = walkExp(a.experimentId)
          const at = new Map(e.vectors.map((v, i) => [v.id, i]))
          const signs = [...e.signs]
          for (const s of a.signs) {
            const i = at.get(s.id)
            if (i === undefined) throw new DocumentError(`there is no occurrence ${s.id} in ${e.id}`)
            signs[i] = s.sign
          }
          const changed = a.signs.filter((s) => e.signs[at.get(s.id)!] !== s.sign)
          if (changed.length) {
            putWalk(e, { ...walkInputOf(e), signs })
            math = true
            summary.push(changed.length === 1 ? `Set the sign of ${arrowNames(walkInputOf(e)).get(changed[0]!.id) ?? changed[0]!.id} to ${changed[0]!.sign === 1 ? '+' : '−'}` : `Changed ${changed.length} signs: ${signText(deriveWalk({ ...walkInputOf(e), signs }).signs)} in source order`)
          }
          break
        }
        case 'set_walk_order': {
          const e = walkExp(a.experimentId)
          const w = { ...walkInputOf(e), order: [...a.order] }
          try {
            checkWalk(w)
          } catch (err) {
            throw new DocumentError((err as Error).message)
          }
          if (a.order.join('|') !== e.order.join('|')) {
            putWalk(e, w)
            math = true
            summary.push(`Reordered the source walk: ${a.order.map((id) => arrowNames(walkInputOf(e)).get(id) ?? id).join(' ')}`)
          }
          break
        }
        case 'show_walk_stage': {
          const e = walkExp(a.experimentId)
          effects.push({ kind: 'show_walk_stage', experimentId: e.id, stage: a.stage })
          summary.push(`Show the ${a.stage === 'why' ? 'Why' : a.stage[0]!.toUpperCase() + a.stage.slice(1)} step`)
          break
        }
        case 'request_check': {
          const c = a.claim
          const rb = (b: { experimentId: string; branchId: string }) => {
            const eid = resolve(b.experimentId, 'experiment', 'experimentId')
            findBranch(findExperiment(doc, eid), b.branchId)
            return { experimentId: eid, branchId: b.branchId }
          }
          let claim: ClaimRequest
          if (c.kind === 'walk_reorder_instance') {
            const e = walkExp(c.experimentId)
            const f = deriveWalk(walkInputOf(e))
            // No vacuous certificate: without the zero-sum hypothesis there is nothing for the finite claim to check.
            if (!f.zeroSum) throw new DocumentError(`the walk does not return to its start (total ${vtext(f.total)}), so the reordering lemma does not apply and there is no finite reorder certificate to check`)
            claim = { kind: c.kind, experimentId: e.id }
          } else if (c.kind === 'same_image_witness') {
            const branch = rb(c.branch)
            const set = findSampleSet(doc, findExperiment(doc, branch.experimentId).sampleSetId)
            for (const s of [c.u, c.v]) if (!set.samples.some((x) => x.id === s)) throw new DocumentError(`sample ${s} is not in ${branch.experimentId}`)
            claim = { ...c, branch }
          } else if (c.kind === 'map_equality') claim = { ...c, left: rb(c.left), right: rb(c.right) }
          else claim = { ...c, left: rb(c.left), right: rb(c.right) }
          effects.push({ kind: 'request_check', claim })
          summary.push('Request a Lean check')
          break
        }
      }
    } catch (e) {
      if (e instanceof DocumentError || e instanceof ActionError || e instanceof TransactionError) throw new TransactionError(`actions[${index}] (${a.kind}): ${e.message}`, index)
      throw new TransactionError(`actions[${index}] (${a.kind}): ${(e as Error).message}`, index)
    }
  }
  try {
    checkReferences(doc)
    for (const eff of effects) {
      if (eff.kind !== 'play' && eff.kind !== 'play_comparison' && eff.kind !== 'play_steps' && eff.kind !== 'show_walk_stage') continue
      if (eff.experimentId !== doc.selection.experimentId) throw new DocumentError(`${eff.kind}: only the displayed experiment can ${eff.kind === 'show_walk_stage' ? 'show a lesson step' : 'play'}`)
      if (eff.kind === 'play_steps' || eff.kind === 'show_walk_stage') continue
      if (findAnyExperiment(doc, eff.experimentId).domain !== 'linear') throw new DocumentError(`${eff.kind}: the displayed experiment is not a linear one; use play_steps`)
      // The layout is decided by the bound recipe after the whole transaction: one-branch playback of a
      // comparison (or a comparison replay of linked views) is refused, never reinterpreted.
      const e = findExperiment(doc, eff.experimentId)
      const comparing = e.binding ? comparisonOf(findRecipe(doc, e.binding.recipeId)) !== null : false
      if (eff.kind === 'play' && comparing) throw new DocumentError('play: the displayed experiment shows a branch comparison; use play_comparison')
      if (eff.kind === 'play_comparison' && !comparing) throw new DocumentError('play_comparison: the displayed experiment shows no branch comparison')
    }
    if (docBytes(docToJson(doc)) > DOC_LIMITS.maxBytes) throw new DocumentError('capacity: document above 256 KiB')
  } catch (e) {
    throw new TransactionError((e as Error).message, null)
  }
  const changed = JSON.stringify(docToJson({ ...doc, revision: 0, mathRevision: 0 })) !== JSON.stringify(docToJson({ ...base, revision: 0, mathRevision: 0 }))
  return { doc, changed, math: math && changed, effects, created, summary }
}

// ------------------------------------------------------------------ committed workspace with undo

export const UNDO_LIMIT = 20

export interface CommitResult {
  doc: Doc
  plan: Plan
}

/** Committed document, revision counters and a 20-step undo (W3). Previews never live here. */
export class Workspace {
  private state: Doc
  private readonly undoStack: Doc[] = []
  private readonly listeners = new Set<(s: Doc, prev: Doc) => void>()

  constructor(initial: Doc) {
    checkReferences(initial)
    this.state = initial
  }

  get current(): Doc {
    return this.state
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  subscribe(fn: (s: Doc, prev: Doc) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Plan on a temporary document and commit everything once; nothing changes on any error. */
  commit(tx: { baseRevision: number; actions: unknown }, undoable = true): CommitResult {
    if (tx.baseRevision !== this.state.revision) throw new TransactionError('stale base revision')
    const plan = planTransaction(this.state, tx.actions)
    if (!plan.changed) return { doc: this.state, plan }
    const prev = this.state
    const next: Doc = { ...plan.doc, revision: prev.revision + 1, mathRevision: prev.mathRevision + (plan.math ? 1 : 0) }
    if (undoable) {
      this.undoStack.push(prev)
      if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    }
    this.state = next
    this.listeners.forEach((fn) => fn(next, prev))
    return { doc: next, plan }
  }

  /** Restore the prior committed state through a new revision. */
  undo(): Doc | null {
    const target = this.undoStack.pop()
    if (!target) return null
    const prev = this.state
    const math = target.mathRevision !== prev.mathRevision
    this.state = { ...target, revision: prev.revision + 1, mathRevision: prev.mathRevision + (math ? 1 : 0) }
    this.listeners.forEach((fn) => fn(this.state, prev))
    return this.state
  }

  /** Open a different document as a new workspace (import / reopen): history starts empty. */
  replace(doc: Doc): void {
    checkReferences(doc)
    const prev = this.state
    this.undoStack.length = 0
    this.state = doc
    this.listeners.forEach((fn) => fn(doc, prev))
  }
}

// ------------------------------------------------------------------ claim descriptors from a document

function steps(doc: Doc, e: Experiment, branchId: string): MapStepJson[] {
  return findBranch(e, branchId).mapIds.map((id) => {
    const m = findMap(doc, id)
    return { mapId: m.id, label: m.label, matrix: m.matrix.map((r) => r.map(qToJson)) }
  })
}

/** Resolve a claim request against committed state into exact data for POST /api/check. */
export function describeClaim(doc: Doc, c: ClaimRequest): ClaimDescriptor {
  if (c.kind === 'walk_reorder_instance') return describeWalkClaim(walkInputOf(findWalkExperiment(doc, c.experimentId)))
  if (c.kind === 'same_image_witness') {
    const e = findExperiment(doc, c.branch.experimentId)
    const set = findSampleSet(doc, e.sampleSetId)
    const w = (id: string): WitnessJson => {
      const s = set.samples.find((x) => x.id === id)
      if (!s) throw new DocumentError(`unknown sample ${id}`)
      return { sampleId: s.id, label: s.label, coords: s.coords.map(qToJson) }
    }
    return { claimVersion: 1, kind: c.kind, dimension: e.dimension, sequence: steps(doc, e, c.branch.branchId), u: w(c.u), v: w(c.v) }
  }
  const l = findExperiment(doc, c.left.experimentId)
  const r = findExperiment(doc, c.right.experimentId)
  if (l.dimension !== r.dimension) throw new DocumentError('compared maps have different dimensions')
  const base = { claimVersion: 1 as const, dimension: l.dimension, left: steps(doc, l, c.left.branchId), right: steps(doc, r, c.right.branchId) }
  return c.kind === 'map_equality' ? { ...base, kind: c.kind } : { ...base, kind: c.kind, basisIndex: c.basisIndex }
}

/** The resolved matrix of the displayed experiment's bound map port (or its first branch). */
export function displayedMatrix(doc: Doc): Mat {
  const e = findExperiment(doc, doc.selection.experimentId)
  const port = e.binding ? Object.entries(findRecipe(doc, e.binding.recipeId).inputs).find(([, s]) => s.type === 'linear_branch')?.[0] : undefined
  return branchMatrix(doc, e, port ? e.binding!.ports[port]! : e.branches[0]!.id)
}
