// The authoritative workspace document (WORKSPACE-AND-AI W1): versioned, validated at every import,
// model boundary and server boundary. Internally rationals are exact `Q`; the JSON form uses `QJson`.
// No engine objects, functions or executable text are stored. Transient state (drag previews, poses,
// animation progress, in-flight requests, receipt tokens) never lives here.
//
// Pure module: imported by the browser and by the Node server. It must not import rendering code.

import { type Dim, type Mat, type Sample, type Vec, compose, dimOf, matEq, presets, identity, checkAuthoredMatrix, checkAuthoredVector, gridSamples, DimensionError } from '../model/linear'
import { type Q, type QJson, fromJson as qFromJson, toJson as qToJson } from '../model/rational'
import { type Recipe, validateRecipe, WHAT_GETS_LOST, recipeDomain, layoutOf } from '../recipes/recipe'
import { type FiniteGroup, type GroupDefinition, GroupError, CYCLIC_ORDERS, groupOf } from '../algebra/groups'
import { type Generator, type RewriteStep, BraidError, REWRITE_RULES, STRAND_IDS, checkWord, isGenerator, replayRewrites, wordEq } from '../algebra/braid'
import { isClassKey } from '../algebra/cube'
import { type GroupStep, type Observation, DOMAIN_LIMITS } from '../domains/inputs'
import { type Sign, type WalkInput, type WalkOccurrence, checkWalk, parseWalkItem } from '../algebra/walk'

/** Version 2 adds groups, group and braid experiments and the selection item (FOUR-DEMOS handoff); version 3
 * adds vector-walk experiments (PROOF-EXPLORER-SPEC section 5). Version-1 and version-2 documents load through
 * migrateV1 and migrateV2. */
export const SCHEMA_VERSION = 3

/** W1 capacity (adjustable engineering limits; never truncate silently). */
export const DOC_LIMITS = {
  sampleSets: 4,
  samplesPerSet: 64,
  maps: 12,
  /** P, Q, the operation-order comparison and the four new demonstrations' presets fit with room to spare. */
  experiments: 10,
  branchesPerExperiment: 2,
  mapsPerBranch: 6,
  recipes: 12,
  groups: DOMAIN_LIMITS.groups,
  /** Applied operations per group experiment, and rewrites per braid experiment. */
  history: DOMAIN_LIMITS.history,
  maxBytes: 256 * 1024,
} as const

export class DocumentError extends Error {
  override name = 'DocumentError'
}

/** Preset metadata is a name plus parameters; the stored matrix stays the authority and must match it. */
export type PresetMeta =
  | { kind: 'identity' }
  | { kind: 'scaling'; factors: Q[] }
  | { kind: 'shear'; i: number; j: number; k: Q }
  | { kind: 'reflection'; axis: number }
  | { kind: 'projection'; keep: boolean[] }
  | { kind: 'rotation'; quarterTurns: number; axis: 0 | 1 | 2 }

export interface SampleSet {
  id: string
  dimension: Dim
  samples: Sample[]
}

export interface MapDef {
  id: string
  dimension: Dim
  /** Display text such as "P" (presentation; identity is the ID). */
  label: string
  matrix: Mat
  preset: PresetMeta | null
}

export interface Branch {
  id: string
  /** Chronological application order: [A, B] means "A then B", resolving to B A. */
  mapIds: string[]
}

/** Port bindings of a recipe on one experiment. sample_id ports always read the workspace selection. */
export interface Binding {
  recipeId: string
  ports: Record<string, string>
}

export const SELECTION_PORT_VALUE = 'workspace.selection'

/** A linear-map experiment (the P-to-Q and operation-order demonstrations). */
export interface LinearExperiment {
  domain: 'linear'
  id: string
  dimension: Dim
  sampleSetId: string
  branches: Branch[]
  binding: Binding | null
}

/** Linear code paths keep the name `Experiment`; group and braid experiments are separate types. */
export type Experiment = LinearExperiment

/** A finite-group experiment: the sculpture, the cube and the quotient demonstrations. */
export interface GroupExperiment {
  domain: 'group'
  id: string
  groupId: string
  /** Chronological operations since the last reset; the accumulated element is their product. */
  history: GroupStep[]
  /** Chosen elements, such as composition operands A and B. */
  operands: [string | null, string | null]
  observation: Observation
  binding: Binding | null
}

/** A bounded three-strand braid experiment. */
export interface BraidExperiment {
  domain: 'braid'
  id: string
  strands: 3
  word: Generator[]
  /** The word the current rewrite record started from; replayRewrites(origin, rewrites) equals word. */
  origin: Generator[]
  rewrites: RewriteStep[]
  compare: Generator[] | null
  binding: Binding | null
}

/** Prepared lesson metadata a vector walk may carry (trusted, closed list; never an arbitrary source URL). */
export const WALK_LESSONS = ['steinitz-reordering'] as const
export type WalkLesson = (typeof WALK_LESSONS)[number]

/** A finite vector walk with one sign per occurrence (the proof lesson). Inputs only: the three walks, the
 * bounds, the output order and every witness are derived by src/algebra/walk.ts, never stored. */
export interface VectorWalkExperiment {
  domain: 'vector_walk'
  id: string
  dimension: Dim
  /** Occurrences in canonical stored order (identity); 1 to 12, IDs unique. */
  vectors: WalkOccurrence[]
  /** Source order: every occurrence ID once. */
  order: string[]
  /** One sign per occurrence, parallel to `vectors`. */
  signs: Sign[]
  lesson: WalkLesson | null
  binding: Binding | null
}

export type AnyExperiment = LinearExperiment | GroupExperiment | BraidExperiment | VectorWalkExperiment
export type ExperimentDomain = AnyExperiment['domain']

/** A finite group chosen by a typed definition; its multiplication is computed (src/algebra/groups.ts). */
export interface GroupDef {
  id: string
  /** Display name such as "C_{4}" (presentation; identity is the ID). */
  label: string
  definition: GroupDefinition
}

/** Presentation-only view configuration (W1 "view configuration"). */
export interface ViewConfig {
  ghostCube: boolean
  sampleLabels: boolean
}

export interface Selection {
  /** The displayed experiment. */
  experimentId: string
  /** The selected sample of a linear experiment (null for group and braid experiments). */
  sampleId: string | null
  /** The selected item of a group or braid experiment (src/domains/inputs.ts conventions), else null. */
  item: string | null
}

export interface Doc {
  schemaVersion: 3
  workspaceId: string
  revision: number
  mathRevision: number
  sampleSets: SampleSet[]
  maps: MapDef[]
  groups: GroupDef[]
  experiments: AnyExperiment[]
  recipes: Recipe[]
  view: ViewConfig
  selection: Selection
}

// ------------------------------------------------------------------ presets

export function presetMatrix(d: Dim, p: PresetMeta): Mat {
  switch (p.kind) {
    case 'identity':
      return identity(d)
    case 'scaling':
      if (p.factors.length !== d) throw new DimensionError('scaling needs one factor per coordinate')
      return presets.scaling(p.factors)
    case 'shear':
      if (!(p.i >= 0 && p.i < d && p.j >= 0 && p.j < d)) throw new DimensionError('shear indices out of range')
      return presets.shear(d, p.i, p.j, p.k)
    case 'reflection':
      if (!(p.axis >= 0 && p.axis < d)) throw new DimensionError('reflection axis out of range')
      return presets.reflection(d, p.axis)
    case 'projection':
      if (p.keep.length !== d) throw new DimensionError('projection needs one keep flag per coordinate')
      return presets.projection(p.keep)
    case 'rotation':
      if (d === 2 && p.axis !== 2) throw new DimensionError('2D rotations have no axis other than the implicit z')
      return presets.rotation(d, p.quarterTurns, p.axis)
  }
}

// ------------------------------------------------------------------ queries

export function findSampleSet(doc: Doc, id: string): SampleSet {
  const s = doc.sampleSets.find((x) => x.id === id)
  if (!s) throw new DocumentError(`unknown sample set ${id}`)
  return s
}

export function findMap(doc: Doc, id: string): MapDef {
  const m = doc.maps.find((x) => x.id === id)
  if (!m) throw new DocumentError(`unknown map ${id}`)
  return m
}

/** Any experiment by ID. */
export function findAnyExperiment(doc: Doc, id: string): AnyExperiment {
  const e = doc.experiments.find((x) => x.id === id)
  if (!e) throw new DocumentError(`unknown experiment ${id}`)
  return e
}

/** A linear experiment by ID (a group or braid experiment is refused with its kind). */
export function findExperiment(doc: Doc, id: string): Experiment {
  const e = findAnyExperiment(doc, id)
  if (e.domain !== 'linear') throw new DocumentError(`experiment ${id} is a ${e.domain} experiment, not a linear one`)
  return e
}

export function findGroupExperiment(doc: Doc, id: string): GroupExperiment {
  const e = findAnyExperiment(doc, id)
  if (e.domain !== 'group') throw new DocumentError(`experiment ${id} is not a group experiment`)
  return e
}

export function findBraidExperiment(doc: Doc, id: string): BraidExperiment {
  const e = findAnyExperiment(doc, id)
  if (e.domain !== 'braid') throw new DocumentError(`experiment ${id} is not a braid experiment`)
  return e
}

export function findWalkExperiment(doc: Doc, id: string): VectorWalkExperiment {
  const e = findAnyExperiment(doc, id)
  if (e.domain !== 'vector_walk') throw new DocumentError(`experiment ${id} is not a vector-walk experiment`)
  return e
}

/** The canonical walk inputs of a vector-walk experiment. */
export function walkInputOf(e: VectorWalkExperiment): WalkInput {
  return { dimension: e.dimension, vectors: e.vectors, order: e.order, signs: e.signs }
}

export function findGroup(doc: Doc, id: string): GroupDef {
  const g = doc.groups.find((x) => x.id === id)
  if (!g) throw new DocumentError(`unknown group ${id}`)
  return g
}

/** The exact group of a group experiment. */
export function groupFor(doc: Doc, e: GroupExperiment): FiniteGroup {
  return groupOf(findGroup(doc, e.groupId).definition)
}

/** The linear experiments only (linear code paths iterate these). */
export function linearExperiments(doc: Doc): LinearExperiment[] {
  return doc.experiments.filter((e): e is LinearExperiment => e.domain === 'linear')
}

export function findBranch(e: Experiment, id: string): Branch {
  const b = e.branches.find((x) => x.id === id)
  if (!b) throw new DocumentError(`unknown branch ${id} in experiment ${e.id}`)
  return b
}

export function findRecipe(doc: Doc, id: string): Recipe {
  const r = doc.recipes.find((x) => x.id === id)
  if (!r) throw new DocumentError(`unknown recipe ${id}`)
  return r
}

/** The exact matrix a branch resolves to (M3 composition order). */
export function branchMatrix(doc: Doc, e: Experiment, branchId: string): Mat {
  const b = findBranch(e, branchId)
  return compose(e.dimension, b.mapIds.map((id) => findMap(doc, id).matrix))
}

/** Display symbol for a branch: one map's label, or the labels in application order composed ("QP"). */
export function branchSymbol(doc: Doc, e: Experiment, branchId: string): string {
  const b = findBranch(e, branchId)
  if (b.mapIds.length === 0) return 'I'
  return [...b.mapIds].reverse().map((id) => findMap(doc, id).label).join('')
}

/** The displayed experiment, of any domain. */
export function displayedExperiment(doc: Doc): AnyExperiment {
  return findAnyExperiment(doc, doc.selection.experimentId)
}

/** The displayed linear experiment (throws when a group or braid experiment is displayed: check first). */
export function activeExperiment(doc: Doc): Experiment {
  return findExperiment(doc, doc.selection.experimentId)
}

export function isLinearDisplayed(doc: Doc): boolean {
  return displayedExperiment(doc).domain === 'linear'
}

// ------------------------------------------------------------------ JSON form

export interface SampleJson {
  id: string
  label: string
  coords: QJson[]
}
export type PresetJson =
  | { kind: 'identity' }
  | { kind: 'scaling'; factors: QJson[] }
  | { kind: 'shear'; i: number; j: number; k: QJson }
  | { kind: 'reflection'; axis: number }
  | { kind: 'projection'; keep: boolean[] }
  | { kind: 'rotation'; quarterTurns: number; axis: 0 | 1 | 2 }
export interface MapJson {
  id: string
  dimension: Dim
  label: string
  matrix: QJson[][]
  preset: PresetJson | null
}
export interface VectorWalkExperimentJson extends Omit<VectorWalkExperiment, 'vectors'> {
  vectors: { id: string; coords: QJson[] }[]
}
export type ExperimentJson = Exclude<AnyExperiment, VectorWalkExperiment> | VectorWalkExperimentJson
export interface DocJson {
  schemaVersion: 3
  workspaceId: string
  revision: number
  mathRevision: number
  sampleSets: { id: string; dimension: Dim; samples: SampleJson[] }[]
  maps: MapJson[]
  groups: GroupDef[]
  experiments: ExperimentJson[]
  recipes: Recipe[]
  view: ViewConfig
  selection: Selection
}

const vecJson = (v: Vec): QJson[] => v.map(qToJson)
const matJson = (m: Mat): QJson[][] => m.map(vecJson)

export function presetToJson(p: PresetMeta): PresetJson {
  switch (p.kind) {
    case 'scaling':
      return { kind: 'scaling', factors: p.factors.map(qToJson) }
    case 'shear':
      return { kind: 'shear', i: p.i, j: p.j, k: qToJson(p.k) }
    default:
      return structuredClone(p) as PresetJson
  }
}

export function mapToJson(m: MapDef): MapJson {
  return { id: m.id, dimension: m.dimension, label: m.label, matrix: matJson(m.matrix), preset: m.preset ? presetToJson(m.preset) : null }
}

function experimentToJson(e: AnyExperiment): ExperimentJson {
  if (e.domain !== 'vector_walk') return structuredClone(e)
  return { ...e, vectors: e.vectors.map((v) => ({ id: v.id, coords: vecJson(v.coords) })), order: [...e.order], signs: [...e.signs], binding: e.binding ? { recipeId: e.binding.recipeId, ports: { ...e.binding.ports } } : null }
}

export function docToJson(doc: Doc): DocJson {
  return {
    schemaVersion: 3,
    workspaceId: doc.workspaceId,
    revision: doc.revision,
    mathRevision: doc.mathRevision,
    sampleSets: doc.sampleSets.map((s) => ({ id: s.id, dimension: s.dimension, samples: s.samples.map((x) => ({ id: x.id, label: x.label, coords: vecJson(x.coords) })) })),
    maps: doc.maps.map(mapToJson),
    groups: structuredClone(doc.groups),
    experiments: doc.experiments.map(experimentToJson),
    recipes: structuredClone(doc.recipes),
    view: { ...doc.view },
    selection: { ...doc.selection },
  }
}

// ------------------------------------------------------------------ validation (import / server boundary)

export const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:()\-,]{0,63}$/
const LABEL_RE = /^[A-Za-z](_\{[0-9]{1,2}\})?$|^$/

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function closed(o: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new DocumentError(`${where}: unknown field "${k}"`)
  for (const k of allowed) if (!(k in o)) throw new DocumentError(`${where}: missing field "${k}"`)
}

function id(x: unknown, where: string): string {
  if (typeof x !== 'string' || !ID_RE.test(x)) throw new DocumentError(`${where}: invalid ID`)
  return x
}

function dim(x: unknown, where: string): Dim {
  if (x !== 2 && x !== 3) throw new DocumentError(`${where}: dimension must be 2 or 3`)
  return x
}

function int(x: unknown, where: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) throw new DocumentError(`${where}: expected an integer in [${min}, ${max}]`)
  return x
}

function wrap<T>(where: string, f: () => T): T {
  try {
    return f()
  } catch (e) {
    if (e instanceof DocumentError) throw e
    throw new DocumentError(`${where}: ${(e as Error).message}`)
  }
}

export function parseVec(x: unknown, d: Dim, where: string): Vec {
  if (!Array.isArray(x) || x.length !== d) throw new DocumentError(`${where}: expected ${d} rationals`)
  return wrap(where, () => x.map((c) => qFromJson(c)))
}

export function parseMat(x: unknown, d: Dim, where: string): Mat {
  if (!Array.isArray(x) || x.length !== d) throw new DocumentError(`${where}: expected ${d} rows`)
  const m = x.map((row, i) => parseVec(row, d, `${where}[${i}]`))
  wrap(where, () => dimOf(m))
  return m
}

export function parsePreset(x: unknown, d: Dim, where: string): PresetMeta {
  if (!isObj(x)) throw new DocumentError(`${where}: expected an object`)
  switch (x.kind) {
    case 'identity':
      closed(x, ['kind'], where)
      return { kind: 'identity' }
    case 'scaling':
      closed(x, ['kind', 'factors'], where)
      return { kind: 'scaling', factors: [...parseVec(x.factors, d, `${where}.factors`)] }
    case 'shear':
      closed(x, ['kind', 'i', 'j', 'k'], where)
      return { kind: 'shear', i: int(x.i, `${where}.i`, 0, d - 1), j: int(x.j, `${where}.j`, 0, d - 1), k: wrap(`${where}.k`, () => qFromJson(x.k)) }
    case 'reflection':
      closed(x, ['kind', 'axis'], where)
      return { kind: 'reflection', axis: int(x.axis, `${where}.axis`, 0, d - 1) }
    case 'projection':
      closed(x, ['kind', 'keep'], where)
      if (!Array.isArray(x.keep) || x.keep.length !== d || !x.keep.every((k) => typeof k === 'boolean')) throw new DocumentError(`${where}.keep: expected ${d} booleans`)
      return { kind: 'projection', keep: [...(x.keep as boolean[])] }
    case 'rotation':
      closed(x, ['kind', 'quarterTurns', 'axis'], where)
      return { kind: 'rotation', quarterTurns: int(x.quarterTurns, `${where}.quarterTurns`, -3, 3), axis: int(x.axis, `${where}.axis`, 0, 2) as 0 | 1 | 2 }
    default:
      throw new DocumentError(`${where}: unknown preset ${JSON.stringify(x.kind)}`)
  }
}

export function parseMapLabel(x: unknown, where: string): string {
  if (typeof x !== 'string' || !/^[A-Z](_\{[0-9]{1,2}\})?$/.test(x)) throw new DocumentError(`${where}: a map label is one capital letter, optionally with a numeric subscript`)
  return x
}

export function parseSampleLabel(x: unknown, where: string): string {
  if (typeof x !== 'string' || !LABEL_RE.test(x)) throw new DocumentError(`${where}: a sample label is empty or one letter, optionally with a numeric subscript`)
  return x
}

/** Check stored preset metadata against the matrix (M3: names are metadata, the matrix is the authority). */
export function checkPresetMatches(d: Dim, matrix: Mat, preset: PresetMeta | null, where: string): void {
  if (!preset) return
  const expected = wrap(where, () => presetMatrix(d, preset))
  if (!matEq(expected, matrix)) throw new DocumentError(`${where}: preset metadata does not match the stored matrix`)
}

/** Version 1 -> 2 (explicit, lossless): every experiment is linear, there are no groups, nothing is selected
 * beyond the sample. The result is validated as a version-2 document. */
export function migrateV1(x: Record<string, unknown>): Record<string, unknown> {
  closed(x, ['schemaVersion', 'workspaceId', 'revision', 'mathRevision', 'sampleSets', 'maps', 'experiments', 'recipes', 'view', 'selection'], 'document (version 1)')
  if (!Array.isArray(x.experiments)) throw new DocumentError('document.experiments: expected an array')
  const experiments = x.experiments.map((e, i) => {
    if (!isObj(e)) throw new DocumentError(`document.experiments[${i}]: expected an object`)
    if ('domain' in e) throw new DocumentError(`document.experiments[${i}]: version-1 experiments have no "domain" field`)
    return { domain: 'linear', ...e }
  })
  if (!isObj(x.selection)) throw new DocumentError('document.selection: expected an object')
  closed(x.selection, ['experimentId', 'sampleId'], 'document.selection (version 1)')
  return { ...x, schemaVersion: 2, groups: [], experiments, selection: { ...x.selection, item: null } }
}

/** Version 2 -> 3 (explicit, lossless): the structure is unchanged; version 3 only adds the vector_walk domain. */
export function migrateV2(x: Record<string, unknown>): Record<string, unknown> {
  return { ...x, schemaVersion: 3 }
}

function parseGroupDefinition(x: unknown, where: string): GroupDefinition {
  if (!isObj(x)) throw new DocumentError(`${where}: expected an object`)
  switch (x.kind) {
    case 'cyclic':
      closed(x, ['kind', 'order'], where)
      return { kind: 'cyclic', order: int(x.order, `${where}.order`, CYCLIC_ORDERS.min, CYCLIC_ORDERS.max) }
    case 'klein_four':
      closed(x, ['kind'], where)
      return { kind: 'klein_four' }
    case 'cube_rotations':
      closed(x, ['kind'], where)
      return { kind: 'cube_rotations' }
    default:
      throw new DocumentError(`${where}: unknown group kind ${JSON.stringify(x.kind)} (cyclic, klein_four or cube_rotations)`)
  }
}

export { parseGroupDefinition }

function parseBinding(x: unknown, where: string): Binding | null {
  if (x === null) return null
  if (!isObj(x)) throw new DocumentError(`${where}: expected an object or null`)
  closed(x, ['recipeId', 'ports'], where)
  if (!isObj(x.ports)) throw new DocumentError(`${where}.ports: expected an object`)
  const ports: Record<string, string> = {}
  for (const [k, v] of Object.entries(x.ports)) ports[k] = v === SELECTION_PORT_VALUE ? v : id(v, `${where}.ports.${k}`)
  return { recipeId: id(x.recipeId, `${where}.recipeId`), ports }
}

function braidWord(x: unknown, where: string): Generator[] {
  try {
    return checkWord(x, where)
  } catch (e) {
    throw new DocumentError((e as Error).message)
  }
}

export function parseRewriteStep(x: unknown, where: string): RewriteStep {
  if (!isObj(x)) throw new DocumentError(`${where}: expected an object`)
  closed(x, ['rule', 'at', 'generator'], where)
  if (!(REWRITE_RULES as readonly unknown[]).includes(x.rule)) throw new DocumentError(`${where}.rule: one of ${REWRITE_RULES.join(', ')}`)
  if (x.generator !== null && !isGenerator(x.generator)) throw new DocumentError(`${where}.generator: 1, 2, -1, -2 or null`)
  return { rule: x.rule as RewriteStep['rule'], at: int(x.at, `${where}.at`, 0, 64), generator: x.generator as Generator | null }
}

function parseExperiment(e: unknown, w: string): AnyExperiment {
  if (!isObj(e)) throw new DocumentError(`${w}: expected an object`)
  const arr = (v: unknown, where: string, max: number): unknown[] => {
    if (!Array.isArray(v) || v.length > max) throw new DocumentError(`${where}: expected at most ${max} entries`)
    return v
  }
  switch (e.domain) {
    case 'linear': {
      closed(e, ['domain', 'id', 'dimension', 'sampleSetId', 'branches', 'binding'], w)
      const branches = arr(e.branches, `${w}.branches`, DOC_LIMITS.branchesPerExperiment).map((b, k) => {
        const wb = `${w}.branches[${k}]`
        if (!isObj(b)) throw new DocumentError(`${wb}: expected an object`)
        closed(b, ['id', 'mapIds'], wb)
        return { id: id(b.id, `${wb}.id`), mapIds: arr(b.mapIds, `${wb}.mapIds`, DOC_LIMITS.mapsPerBranch).map((m, j) => id(m, `${wb}.mapIds[${j}]`)) }
      })
      if (branches.length === 0) throw new DocumentError(`${w}.branches: at least one branch`)
      return { domain: 'linear', id: id(e.id, `${w}.id`), dimension: dim(e.dimension, `${w}.dimension`), sampleSetId: id(e.sampleSetId, `${w}.sampleSetId`), branches, binding: parseBinding(e.binding, `${w}.binding`) }
    }
    case 'group': {
      closed(e, ['domain', 'id', 'groupId', 'history', 'operands', 'observation', 'binding'], w)
      const history = arr(e.history, `${w}.history`, DOC_LIMITS.history).map((h, k) => {
        const wh = `${w}.history[${k}]`
        if (!isObj(h)) throw new DocumentError(`${wh}: expected an object`)
        closed(h, ['element', 'via'], wh)
        if (h.via !== 'element' && h.via !== 'diagonal_lines') throw new DocumentError(`${wh}.via: "element" or "diagonal_lines"`)
        return { element: id(h.element, `${wh}.element`), via: h.via } as GroupStep
      })
      if (!Array.isArray(e.operands) || e.operands.length !== 2) throw new DocumentError(`${w}.operands: expected two entries`)
      const operands = e.operands.map((o, k) => (o === null ? null : id(o, `${w}.operands[${k}]`))) as [string | null, string | null]
      if (e.observation !== 'none' && e.observation !== 'unoriented_axis_lines') throw new DocumentError(`${w}.observation: "none" or "unoriented_axis_lines"`)
      return { domain: 'group', id: id(e.id, `${w}.id`), groupId: id(e.groupId, `${w}.groupId`), history, operands, observation: e.observation, binding: parseBinding(e.binding, `${w}.binding`) }
    }
    case 'braid': {
      closed(e, ['domain', 'id', 'strands', 'word', 'origin', 'rewrites', 'compare', 'binding'], w)
      if (e.strands !== 3) throw new DocumentError(`${w}.strands: this build supports three strands`)
      const word = braidWord(e.word, `${w}.word`)
      const origin = braidWord(e.origin, `${w}.origin`)
      const rewrites = arr(e.rewrites, `${w}.rewrites`, DOC_LIMITS.history).map((r, k) => parseRewriteStep(r, `${w}.rewrites[${k}]`))
      // The rewrite record is evidence: it must take the origin to the stored word, span by span.
      let replayed: Generator[]
      try {
        replayed = replayRewrites(origin, rewrites)
      } catch (err) {
        throw new DocumentError(`${w}.rewrites: ${(err as Error).message}`)
      }
      if (!wordEq(replayed, word)) throw new DocumentError(`${w}.rewrites: the recorded rewrites do not take origin to word`)
      const compare = e.compare === null ? null : braidWord(e.compare, `${w}.compare`)
      return { domain: 'braid', id: id(e.id, `${w}.id`), strands: 3, word, origin, rewrites, compare, binding: parseBinding(e.binding, `${w}.binding`) }
    }
    case 'vector_walk': {
      closed(e, ['domain', 'id', 'dimension', 'vectors', 'order', 'signs', 'lesson', 'binding'], w)
      const d = dim(e.dimension, `${w}.dimension`)
      const vectors = arr(e.vectors, `${w}.vectors`, 12).map((v, k) => {
        const wv = `${w}.vectors[${k}]`
        if (!isObj(v)) throw new DocumentError(`${wv}: expected an object`)
        closed(v, ['id', 'coords'], wv)
        if (typeof v.id !== 'string') throw new DocumentError(`${wv}.id: expected a string`)
        return { id: v.id, coords: parseVec(v.coords, d, `${wv}.coords`) }
      })
      const order = arr(e.order, `${w}.order`, 12).map((o, k) => {
        if (typeof o !== 'string') throw new DocumentError(`${w}.order[${k}]: expected an occurrence ID`)
        return o
      })
      const signs = arr(e.signs, `${w}.signs`, 12).map((s, k) => {
        if (s !== 1 && s !== -1) throw new DocumentError(`${w}.signs[${k}]: 1 or -1`)
        return s as Sign
      })
      if (e.lesson !== null && !(WALK_LESSONS as readonly unknown[]).includes(e.lesson)) throw new DocumentError(`${w}.lesson: null or one of ${WALK_LESSONS.join(', ')}`)
      const walk: VectorWalkExperiment = { domain: 'vector_walk', id: id(e.id, `${w}.id`), dimension: d, vectors, order, signs, lesson: e.lesson as WalkLesson | null, binding: parseBinding(e.binding, `${w}.binding`) }
      wrap(w, () => checkWalk(walkInputOf(walk)))
      return walk
    }
    default:
      throw new DocumentError(`${w}.domain: "linear", "group", "braid" or "vector_walk"`)
  }
}

/** Structural and referential validation of an imported/received document (version 1, 2 or 3). Returns the
 * internal (version-3) form. */
export function docFromJson(input: unknown): Doc {
  if (!isObj(input)) throw new DocumentError('document: expected an object')
  if (input.schemaVersion !== 1 && input.schemaVersion !== 2 && input.schemaVersion !== 3) throw new DocumentError('document.schemaVersion: must be 1, 2 or 3')
  const x = input.schemaVersion === 3 ? input : migrateV2(input.schemaVersion === 1 ? migrateV1(input) : input)
  closed(x, ['schemaVersion', 'workspaceId', 'revision', 'mathRevision', 'sampleSets', 'maps', 'groups', 'experiments', 'recipes', 'view', 'selection'], 'document')
  const workspaceId = id(x.workspaceId, 'document.workspaceId')
  const revision = int(x.revision, 'document.revision')
  const mathRevision = int(x.mathRevision, 'document.mathRevision')
  const arr = (v: unknown, where: string, max: number): unknown[] => {
    if (!Array.isArray(v) || v.length > max) throw new DocumentError(`${where}: expected at most ${max} entries`)
    return v
  }
  const sampleSets: SampleSet[] = arr(x.sampleSets, 'document.sampleSets', DOC_LIMITS.sampleSets).map((s, i) => {
    const w = `document.sampleSets[${i}]`
    if (!isObj(s)) throw new DocumentError(`${w}: expected an object`)
    closed(s, ['id', 'dimension', 'samples'], w)
    const d = dim(s.dimension, `${w}.dimension`)
    const samples = arr(s.samples, `${w}.samples`, DOC_LIMITS.samplesPerSet).map((p, k) => {
      const ws = `${w}.samples[${k}]`
      if (!isObj(p)) throw new DocumentError(`${ws}: expected an object`)
      closed(p, ['id', 'label', 'coords'], ws)
      const coords = parseVec(p.coords, d, `${ws}.coords`)
      wrap(ws, () => checkAuthoredVector(coords))
      return { id: id(p.id, `${ws}.id`), label: parseSampleLabel(p.label, `${ws}.label`), coords }
    })
    if (new Set(samples.map((p) => p.id)).size !== samples.length) throw new DocumentError(`${w}: duplicate sample IDs`)
    return { id: id(s.id, `${w}.id`), dimension: d, samples }
  })
  const maps: MapDef[] = arr(x.maps, 'document.maps', DOC_LIMITS.maps).map((m, i) => {
    const w = `document.maps[${i}]`
    if (!isObj(m)) throw new DocumentError(`${w}: expected an object`)
    closed(m, ['id', 'dimension', 'label', 'matrix', 'preset'], w)
    const d = dim(m.dimension, `${w}.dimension`)
    const matrix = parseMat(m.matrix, d, `${w}.matrix`)
    wrap(w, () => checkAuthoredMatrix(matrix))
    const preset = m.preset === null ? null : parsePreset(m.preset, d, `${w}.preset`)
    checkPresetMatches(d, matrix, preset, w)
    return { id: id(m.id, `${w}.id`), dimension: d, label: parseMapLabel(m.label, `${w}.label`), matrix, preset }
  })
  const groups: GroupDef[] = arr(x.groups, 'document.groups', DOC_LIMITS.groups).map((g, i) => {
    const w = `document.groups[${i}]`
    if (!isObj(g)) throw new DocumentError(`${w}: expected an object`)
    closed(g, ['id', 'label', 'definition'], w)
    return { id: id(g.id, `${w}.id`), label: parseMapLabel(g.label, `${w}.label`), definition: parseGroupDefinition(g.definition, `${w}.definition`) }
  })
  const recipes: Recipe[] = arr(x.recipes, 'document.recipes', DOC_LIMITS.recipes).map((r, i) => wrap(`document.recipes[${i}]`, () => validateRecipe(r, `document.recipes[${i}]`)))
  const experiments: AnyExperiment[] = arr(x.experiments, 'document.experiments', DOC_LIMITS.experiments).map((e, i) => parseExperiment(e, `document.experiments[${i}]`))
  if (!isObj(x.view)) throw new DocumentError('document.view: expected an object')
  closed(x.view, ['ghostCube', 'sampleLabels'], 'document.view')
  if (typeof x.view.ghostCube !== 'boolean' || typeof x.view.sampleLabels !== 'boolean') throw new DocumentError('document.view: flags must be booleans')
  if (!isObj(x.selection)) throw new DocumentError('document.selection: expected an object')
  closed(x.selection, ['experimentId', 'sampleId', 'item'], 'document.selection')
  if (x.selection.item !== null && (typeof x.selection.item !== 'string' || x.selection.item.length > 64)) throw new DocumentError('document.selection.item: a string of at most 64 characters, or null')
  const doc: Doc = {
    schemaVersion: 3,
    workspaceId,
    revision,
    mathRevision,
    sampleSets,
    maps,
    groups,
    experiments,
    recipes,
    view: { ghostCube: x.view.ghostCube, sampleLabels: x.view.sampleLabels },
    selection: {
      experimentId: id(x.selection.experimentId, 'document.selection.experimentId'),
      sampleId: x.selection.sampleId === null ? null : id(x.selection.sampleId, 'document.selection.sampleId'),
      item: x.selection.item as string | null,
    },
  }
  checkReferences(doc)
  return doc
}

/** Referential integrity and binding validity; used after import and after every planned transaction. */
export function checkReferences(doc: Doc): void {
  const unique = (ids: string[], what: string) => {
    if (new Set(ids).size !== ids.length) throw new DocumentError(`duplicate ${what} IDs`)
  }
  unique(doc.sampleSets.map((s) => s.id), 'sample set')
  unique(doc.maps.map((m) => m.id), 'map')
  unique(doc.groups.map((g) => g.id), 'group')
  unique(doc.experiments.map((e) => e.id), 'experiment')
  unique(doc.recipes.map((r) => r.id), 'recipe')
  for (const g of doc.groups) {
    try {
      groupOf(g.definition)
    } catch (err) {
      throw new DocumentError(`group ${g.id}: ${(err as Error).message}`)
    }
  }
  for (const e of doc.experiments) {
    if (e.domain === 'linear') {
      const set = findSampleSet(doc, e.sampleSetId)
      if (set.dimension !== e.dimension) throw new DocumentError(`experiment ${e.id}: sample set dimension ${set.dimension} differs from ${e.dimension}`)
      unique(e.branches.map((b) => b.id), `branch (experiment ${e.id})`)
      for (const b of e.branches) for (const m of b.mapIds) if (findMap(doc, m).dimension !== e.dimension) throw new DocumentError(`experiment ${e.id}: map ${m} has a different dimension`)
    } else if (e.domain === 'group') checkGroupExperiment(doc, e)
    if (e.binding) checkBinding(doc, e, e.binding)
  }
  const sel = findAnyExperiment(doc, doc.selection.experimentId)
  if (sel.domain === 'linear') {
    if (doc.selection.sampleId !== null && !findSampleSet(doc, sel.sampleSetId).samples.some((s) => s.id === doc.selection.sampleId)) {
      throw new DocumentError(`selection: sample ${doc.selection.sampleId} is not in experiment ${sel.id}`)
    }
    if (doc.selection.item !== null) throw new DocumentError(`selection: a linear experiment selects a sample, not an item`)
  } else {
    if (doc.selection.sampleId !== null) throw new DocumentError(`selection: ${sel.domain} experiment ${sel.id} has no samples`)
    checkItem(doc, sel, doc.selection.item)
  }
}

function checkGroupExperiment(doc: Doc, e: GroupExperiment): void {
  const def = findGroup(doc, e.groupId)
  const g = groupOf(def.definition)
  for (const [k, h] of e.history.entries()) {
    if (!g.has(h.element)) throw new DocumentError(`experiment ${e.id}: history[${k}] ${h.element} is not an element of ${def.id}`)
    if (h.via === 'diagonal_lines' && def.definition.kind !== 'cube_rotations') throw new DocumentError(`experiment ${e.id}: history[${k}] is driven by diagonal lines, which only the cube group has`)
  }
  for (const o of e.operands) if (o !== null && !g.has(o)) throw new DocumentError(`experiment ${e.id}: operand ${o} is not an element of ${def.id}`)
  if (e.observation !== 'none' && def.definition.kind !== 'cube_rotations') throw new DocumentError(`experiment ${e.id}: the axis-line observation needs the cube group`)
}

/** A selection item of a group or braid experiment (conventions in src/domains/inputs.ts). */
export function checkItem(doc: Doc, e: AnyExperiment, item: string | null): void {
  if (item === null) return
  if (e.domain === 'group') {
    const def = findGroup(doc, e.groupId)
    const g = groupOf(def.definition)
    if (g.has(item)) return
    const cube = def.definition.kind === 'cube_rotations'
    if (cube && /^line:[0-3]$/.test(item)) return
    if (cube && /^axis:[0-2]$/.test(item)) return
    if (cube && item.startsWith('class:') && isClassKey(item.slice(6))) return
    throw new DocumentError(`selection: "${item}" is not an element${cube ? ', line:<0-3>, axis:<0-2> or class:<key>' : ''} of ${def.id}`)
  }
  if (e.domain === 'vector_walk') {
    try {
      parseWalkItem(item, e)
    } catch (err) {
      throw new DocumentError(`selection: ${(err as Error).message}`)
    }
    return
  }
  if (e.domain === 'braid') {
    const m = /^crossing:(\d{1,2})$/.exec(item)
    if (m && Number(m[1]) < e.word.length) return
    if (/^strand:[abc]$/.test(item) && (STRAND_IDS as readonly string[]).includes(item.slice(7))) return
    throw new DocumentError(`selection: "${item}" is not crossing:<0-${e.word.length - 1}> or strand:<a|b|c> of ${e.id}`)
  }
  throw new DocumentError('selection: a linear experiment has no items')
}

/** A binding names every recipe port, and the recipe fits the experiment's domain:
 * linear - sample_set -> this experiment's set, linear_branch -> one of its branches, sample_id -> the selection;
 * group  - finite_group -> its group, group_element -> the selection item;
 * braid  - braid_word -> "word" or "compare";
 * vector_walk - vector_walk -> "walk". */
export function checkBinding(doc: Doc, e: AnyExperiment, b: Binding): void {
  const r = findRecipe(doc, b.recipeId)
  const domain = recipeDomain(r)
  if (domain !== e.domain) throw new DocumentError(`binding of ${r.id} on ${e.id}: a ${domain} recipe cannot bind to a ${e.domain} experiment`)
  const names = Object.keys(r.inputs)
  for (const k of Object.keys(b.ports)) if (!names.includes(k)) throw new DocumentError(`binding of ${r.id} on ${e.id}: unknown port "${k}"`)
  for (const [port, spec] of Object.entries(r.inputs)) {
    const v = b.ports[port]
    const where = `binding of ${r.id} on ${e.id}: port "${port}"`
    if (v === undefined) throw new DocumentError(`${where} is unbound`)
    switch (spec.type) {
      case 'sample_set':
        if (e.domain !== 'linear') break
        if (v !== e.sampleSetId) throw new DocumentError(`${where} must be the experiment's sample set ${e.sampleSetId}`)
        if (!spec.dimensions.includes(e.dimension)) throw new DocumentError(`binding of ${r.id} on ${e.id}: recipe does not accept dimension ${e.dimension}`)
        break
      case 'linear_branch':
        if (e.domain === 'linear') findBranch(e, v)
        break
      case 'sample_id':
      case 'group_element':
        if (v !== SELECTION_PORT_VALUE) throw new DocumentError(`${where} must read ${SELECTION_PORT_VALUE}`)
        break
      case 'finite_group':
        if (e.domain === 'group' && v !== e.groupId) throw new DocumentError(`${where} must be the experiment's group ${e.groupId}`)
        break
      case 'braid_word':
        if (v !== 'word' && v !== 'compare') throw new DocumentError(`${where} must be "word" or "compare"`)
        break
      case 'vector_walk':
        if (v !== 'walk') throw new DocumentError(`${where} must be "walk"`)
        break
    }
  }
  if (e.domain === 'group') {
    const def = findGroup(doc, e.groupId).definition
    const layout = layoutOf(r)
    if (layout === 'regular_action' && groupOf(def).order > DOMAIN_LIMITS.sculptureOrder) throw new DocumentError(`binding of ${r.id} on ${e.id}: the sculpture shows one bead per element, at most ${DOMAIN_LIMITS.sculptureOrder}`)
    if ((layout === 'cube_diagonals' || layout === 'quotient_classes') && def.kind !== 'cube_rotations') throw new DocumentError(`binding of ${r.id} on ${e.id}: ${layout} needs the cube-rotation group`)
  }
}

export { GroupError, BraidError }

// ------------------------------------------------------------------ demo document

/** Display labels for the acceptance witnesses (MATHEMATICAL-CONTRACT M6); IDs never change. */
export const DEMO_LABELS: Record<string, string> = { 's(1,0,1)': 'u', 's(1,0,-1)': 'v', 's(1,1,0)': 'a', 's(-1,1,0)': 'b' }

export const BUILTIN_RECIPE_ID = 'what-gets-lost'

/** The starting workspace: the {-1,0,1}^3 samples, P = diag(1,1,0) and the W2 recipe bound to it. */
export function demoDocument(workspaceId = 'ws-demo'): Doc {
  const samples = gridSamples(3).map((s) => ({ ...s, label: DEMO_LABELS[s.id] ?? '' }))
  const keep = [true, true, false]
  return {
    schemaVersion: 3,
    workspaceId,
    revision: 0,
    mathRevision: 0,
    sampleSets: [{ id: 'grid3', dimension: 3, samples }],
    maps: [{ id: 'map-p', dimension: 3, label: 'P', matrix: presets.projection(keep), preset: { kind: 'projection', keep } }],
    groups: [],
    experiments: [{ domain: 'linear', id: 'exp-p', dimension: 3, sampleSetId: 'grid3', branches: [{ id: 'main', mapIds: ['map-p'] }], binding: { recipeId: BUILTIN_RECIPE_ID, ports: { samples: 'grid3', map: 'main', selection: SELECTION_PORT_VALUE } } }],
    recipes: [{ schemaVersion: 1, id: BUILTIN_RECIPE_ID, ...structuredClone(WHAT_GETS_LOST) }],
    view: { ghostCube: true, sampleLabels: true },
    selection: { experimentId: 'exp-p', sampleId: 's(1,0,1)', item: null },
  }
}

export function docBytes(json: DocJson): number {
  return new TextEncoder().encode(JSON.stringify(json)).length
}
