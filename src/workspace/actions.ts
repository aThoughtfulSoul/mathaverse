// The closed action vocabulary (WORKSPACE-AND-AI W3, W4) shared by local controls, the assistant
// planner and the server. This module does structural validation only: closed fields, types, exact
// rationals, bounds that need no document. Semantic validation (references, dimensions, capability
// predicates, capacity) happens by planning the transaction on a temporary document (reducer.ts).
//
// Pure module: imported by the browser and by the Node server. It must not import rendering code.

import type { Dim } from '../model/linear'
import type { QJson } from '../model/rational'
import { fromJson as qFromJson } from '../model/rational'
import { type PresetJson, type DocJson, DocumentError, parsePreset, parseMapLabel, parseSampleLabel, parseGroupDefinition, ID_RE } from './document'
import type { GroupDefinition } from '../algebra/groups'
import { type Generator, type RewriteRule, REWRITE_RULES, MAX_BRAID_LENGTH, isGenerator } from '../algebra/braid'
import { MAX_DEGREE } from '../algebra/permutation'
import { type Observation, type WalkStage, WALK_STAGES } from '../domains/inputs'
import { type Sign, OCCURRENCE_ID_RE, WALK_LIMITS } from '../algebra/walk'
import { type RecipeRule, validateRule } from '../recipes/recipe'
import { type ClaimRequest, parseClaimRequest } from './claims'

export class ActionError extends Error {
  override name = 'ActionError'
  constructor(message: string, readonly index: number | null = null) {
    super(message)
  }
}

/** An existing object ID, or `$name` for an object created earlier in the same transaction. */
export type Ref = string
/** Transaction-local name for a created object (`$name` refers to it later in the transaction). */
export const LOCAL_NAME_RE = /^[a-z][a-z0-9_]{0,23}$/

export type MapDefinitionJson = { preset: PresetJson } | { matrix: QJson[][] }
/** One vector occurrence as an action carries it (exact coordinates; the ID is its identity). */
export type WalkVectorJson = { id: string; coords: QJson[] }
export type SampleSourceJson = { preset: 'cartesian_-1_0_1' } | { samples: { id: string; label: string; coords: QJson[] }[] }

export type ActionJson =
  | { kind: 'create_samples'; name: string; dimension: Dim; source: SampleSourceJson }
  | { kind: 'create_map'; name: string; label: string; dimension: Dim; definition: MapDefinitionJson }
  | { kind: 'update_map'; mapId: Ref; label: string; definition: MapDefinitionJson }
  | { kind: 'update_sample'; sampleSetId: Ref; sampleId: string; coords: QJson[] }
  | { kind: 'create_experiment'; name: string; sampleSetId: Ref; branches: { id: string; mapIds: Ref[] }[] }
  | { kind: 'set_branch'; experimentId: Ref; branchId: string; mapIds: Ref[] }
  | { kind: 'bind_recipe'; experimentId: Ref; recipeId: Ref; bindings: Record<string, string | null> }
  | { kind: 'set_view'; ghostCube: boolean; sampleLabels: boolean }
  | { kind: 'select'; experimentId: Ref; sampleId: string | null }
  | { kind: 'play'; experimentId: Ref; branchId: string; transition: 'apply_map'; duration: number }
  /** Replay a branch comparison step by step (both routes together: input, first operation, second ...).
   * Distinct from `play`, which animates one branch; neither is reinterpreted as the other. */
  | { kind: 'play_comparison'; experimentId: Ref; stepDuration: number }
  | { kind: 'save_recipe'; name: string; recipe: RecipeRule }
  | { kind: 'request_check'; claim: ClaimRequest }
  // ---- finite groups (FOUR-DEMOS handoff: sculpture, cube, quotient)
  | { kind: 'create_group'; name: string; label: string; definition: GroupDefinition }
  | { kind: 'create_group_experiment'; name: string; groupId: Ref }
  | { kind: 'apply_element'; experimentId: Ref; element: string }
  /** Apply the unique cube rotation inducing this permutation of the four diagonal lines. */
  | { kind: 'apply_permutation'; experimentId: Ref; representation: 'diagonal_lines'; permutation: number[] }
  | { kind: 'reset_group'; experimentId: Ref }
  /** Remove the last applied operation ("undo that rotation" as a validated, undoable action). */
  | { kind: 'undo_step'; experimentId: Ref }
  | { kind: 'set_operands'; experimentId: Ref; operands: [string | null, string | null] }
  | { kind: 'set_observation'; experimentId: Ref; observation: Observation }
  | { kind: 'select_item'; experimentId: Ref; item: string | null }
  /** Replay the displayed group or braid experiment's construction (presentation effect). */
  | { kind: 'play_steps'; experimentId: Ref; stepDuration: number }
  // ---- three-strand braids
  | { kind: 'create_braid_experiment'; name: string; word: Generator[]; compare: Generator[] | null }
  | { kind: 'set_braid'; experimentId: Ref; target: BraidTarget; word: Generator[] | null }
  | { kind: 'append_crossing'; experimentId: Ref; target: BraidTarget; generator: Generator }
  | { kind: 'invert_braid'; experimentId: Ref; target: BraidTarget }
  | { kind: 'rewrite_braid'; experimentId: Ref; rule: RewriteRule; at: number; generator: Generator | null }
  // ---- vector walks (the proof lesson, PROOF-EXPLORER-SPEC section 5)
  /** A bounded walk: occurrences (canonical stored order), the source order and one sign per occurrence. */
  | { kind: 'create_vector_walk'; name: string; dimension: Dim; vectors: WalkVectorJson[]; order: string[]; signs: Sign[]; lesson: 'steinitz-reordering' | null }
  /** Replace a walk's inputs atomically (a prepared case); the old case stays recoverable by Undo. */
  | { kind: 'set_vector_walk'; experimentId: Ref; dimension: Dim; vectors: WalkVectorJson[]; order: string[]; signs: Sign[] }
  /** Set the signs of the named occurrences; the others keep theirs. */
  | { kind: 'set_walk_signs'; experimentId: Ref; signs: { id: string; sign: Sign }[] }
  /** Replace the source order with a full permutation of the occurrence IDs (signs stay with their occurrences). */
  | { kind: 'set_walk_order'; experimentId: Ref; order: string[] }
  /** Presentation effect: show one step of the lesson (never a mathematical edit). */
  | { kind: 'show_walk_stage'; experimentId: Ref; stage: WalkStage }

export type BraidTarget = 'word' | 'compare'

export const ACTION_KINDS = [
  'create_samples', 'create_map', 'update_map', 'update_sample', 'create_experiment', 'set_branch', 'bind_recipe', 'set_view', 'select', 'play', 'play_comparison', 'save_recipe', 'request_check',
  'create_group', 'create_group_experiment', 'apply_element', 'apply_permutation', 'reset_group', 'undo_step', 'set_operands', 'set_observation', 'select_item', 'play_steps',
  'create_braid_experiment', 'set_braid', 'append_crossing', 'invert_braid', 'rewrite_braid',
  'create_vector_walk', 'set_vector_walk', 'set_walk_signs', 'set_walk_order', 'show_walk_stage',
] as const
export type ActionKind = (typeof ACTION_KINDS)[number]

export const PROPOSAL_LIMITS = { title: 80, explanation: 700, actions: 8 } as const

/** The model's output (W4). Unknown fields or actions are rejected. */
export interface Proposal {
  proposalVersion: 1
  title: string
  explanation: string
  actions: ActionJson[]
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function closed(o: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new ActionError(`${where}: unknown field "${k}"`)
  for (const k of allowed) if (!(k in o)) throw new ActionError(`${where}: missing field "${k}"`)
}

function ref(x: unknown, where: string): Ref {
  if (typeof x !== 'string') throw new ActionError(`${where}: expected an ID or $name`)
  if (x.startsWith('$') ? !LOCAL_NAME_RE.test(x.slice(1)) : !ID_RE.test(x)) throw new ActionError(`${where}: invalid reference ${JSON.stringify(x)}`)
  return x
}

function idStr(x: unknown, where: string): string {
  if (typeof x !== 'string' || !ID_RE.test(x)) throw new ActionError(`${where}: invalid ID`)
  return x
}

function localName(x: unknown, where: string): string {
  if (typeof x !== 'string' || !LOCAL_NAME_RE.test(x)) throw new ActionError(`${where}: a local name is lowercase letters, digits and _ (max 24)`)
  return x
}

function dim(x: unknown, where: string): Dim {
  if (x !== 2 && x !== 3) throw new ActionError(`${where}: dimension must be 2 or 3`)
  return x
}

function rationals(x: unknown, where: string, length?: number): QJson[] {
  if (!Array.isArray(x) || (length !== undefined && x.length !== length) || x.length > 3) throw new ActionError(`${where}: expected ${length ?? 'up to 3'} rationals`)
  for (const [i, c] of x.entries()) {
    try {
      qFromJson(c)
    } catch (e) {
      throw new ActionError(`${where}[${i}]: ${(e as Error).message}`)
    }
  }
  return x as QJson[]
}

function viaDocument<T>(where: string, f: () => T): T {
  try {
    return f()
  } catch (e) {
    if (e instanceof DocumentError) throw new ActionError(`${where}: ${e.message}`)
    throw e
  }
}

const PRESET_KINDS = ['identity', 'scaling', 'shear', 'reflection', 'projection', 'rotation']

function word(x: unknown, where: string, nullable = false): Generator[] | null {
  if (x === null && nullable) return null
  if (!Array.isArray(x) || x.length > MAX_BRAID_LENGTH) throw new ActionError(`${where}: expected at most ${MAX_BRAID_LENGTH} crossings (1, 2, -1, -2)`)
  x.forEach((g, i) => {
    if (!isGenerator(g)) throw new ActionError(`${where}[${i}]: a crossing is 1, 2, -1 or -2`)
  })
  return [...(x as Generator[])]
}

function target(x: unknown, where: string): BraidTarget {
  if (x !== 'word' && x !== 'compare') throw new ActionError(`${where}: "word" or "compare"`)
  return x
}

function nullableId(x: unknown, where: string): string | null {
  return x === null ? null : idStr(x, where)
}

function item(x: unknown, where: string): string | null {
  if (x === null) return null
  if (typeof x !== 'string' || x.length === 0 || x.length > 64 || !/^[A-Za-z0-9_.:()\-,]+$/.test(x)) throw new ActionError(`${where}: an element ID, class:<key>, line:<i>, axis:<j>, crossing:<k>, strand:<a|b|c>, walk:<source|signed|reordered>:<j>, walk:vector:<id> or null`)
  return x
}

function occurrenceId(x: unknown, where: string): string {
  if (typeof x !== 'string' || !OCCURRENCE_ID_RE.test(x)) throw new ActionError(`${where}: an occurrence ID (lowercase letter, then letters, digits or _; at most 16)`)
  return x
}

function sign(x: unknown, where: string): Sign {
  if (x !== 1 && x !== -1) throw new ActionError(`${where}: 1 or -1`)
  return x
}

/** Walk inputs: 1-12 occurrences with exact coordinates, a source order and one sign per occurrence (lengths
 * are checked here; uniqueness, the permutation and coordinate bounds by the planner's walk validation). */
function walkData(x: Record<string, unknown>, where: string): { dimension: Dim; vectors: WalkVectorJson[]; order: string[]; signs: Sign[] } {
  const d = dim(x.dimension, `${where}.dimension`)
  const n = WALK_LIMITS.maxVectors
  if (!Array.isArray(x.vectors) || x.vectors.length < WALK_LIMITS.minVectors || x.vectors.length > n) throw new ActionError(`${where}.vectors: ${WALK_LIMITS.minVectors} to ${n} occurrences`)
  const vectors = x.vectors.map((v, i) => {
    const w = `${where}.vectors[${i}]`
    if (!isObj(v)) throw new ActionError(`${w}: expected an object`)
    closed(v, ['id', 'coords'], w)
    return { id: occurrenceId(v.id, `${w}.id`), coords: rationals(v.coords, `${w}.coords`, d) }
  })
  if (!Array.isArray(x.order) || x.order.length !== vectors.length) throw new ActionError(`${where}.order: every occurrence ID once (${vectors.length})`)
  const order = x.order.map((o, i) => occurrenceId(o, `${where}.order[${i}]`))
  if (!Array.isArray(x.signs) || x.signs.length !== vectors.length) throw new ActionError(`${where}.signs: one sign per occurrence (${vectors.length})`)
  const signs = x.signs.map((s, i) => sign(s, `${where}.signs[${i}]`))
  return { dimension: d, vectors, order, signs }
}

function mapDefinition(x: unknown, d: Dim | null, where: string): MapDefinitionJson {
  if (!isObj(x)) throw new ActionError(`${where}: expected an object`)
  if ('preset' in x) {
    closed(x, ['preset'], where)
    // With a known dimension, parse fully; for update_map only the kind is checked here and the
    // planner re-parses against the existing map's dimension.
    if (d !== null) viaDocument(where, () => parsePreset(x.preset, d, `${where}.preset`))
    else if (!isObj(x.preset) || !PRESET_KINDS.includes(x.preset.kind as string)) throw new ActionError(`${where}.preset: unknown preset`)
    return { preset: x.preset as PresetJson }
  }
  closed(x, ['matrix'], where)
  if (!Array.isArray(x.matrix) || (x.matrix.length !== 2 && x.matrix.length !== 3)) throw new ActionError(`${where}.matrix: expected 2 or 3 rows`)
  const n = x.matrix.length
  x.matrix.forEach((row, i) => rationals(row, `${where}.matrix[${i}]`, n))
  return { matrix: x.matrix as QJson[][] }
}

/** Structural validation of one action (closed fields, exact rationals). Throws ActionError. */
export function parseAction(x: unknown, where = 'action'): ActionJson {
  if (!isObj(x)) throw new ActionError(`${where}: expected an object`)
  const kind = x.kind
  switch (kind) {
    case 'create_samples': {
      closed(x, ['kind', 'name', 'dimension', 'source'], where)
      const d = dim(x.dimension, `${where}.dimension`)
      if (!isObj(x.source)) throw new ActionError(`${where}.source: expected an object`)
      let source: SampleSourceJson
      if ('preset' in x.source) {
        closed(x.source, ['preset'], `${where}.source`)
        if (x.source.preset !== 'cartesian_-1_0_1') throw new ActionError(`${where}.source.preset: unknown sample preset`)
        source = { preset: 'cartesian_-1_0_1' }
      } else {
        closed(x.source, ['samples'], `${where}.source`)
        if (!Array.isArray(x.source.samples) || x.source.samples.length === 0 || x.source.samples.length > 64) throw new ActionError(`${where}.source.samples: 1..64 samples`)
        source = {
          samples: x.source.samples.map((s, i) => {
            const w = `${where}.source.samples[${i}]`
            if (!isObj(s)) throw new ActionError(`${w}: expected an object`)
            closed(s, ['id', 'label', 'coords'], w)
            return { id: idStr(s.id, `${w}.id`), label: viaDocument(w, () => parseSampleLabel(s.label, `${w}.label`)), coords: rationals(s.coords, `${w}.coords`, d) }
          }),
        }
      }
      return { kind, name: localName(x.name, `${where}.name`), dimension: d, source }
    }
    case 'create_map': {
      closed(x, ['kind', 'name', 'label', 'dimension', 'definition'], where)
      const d = dim(x.dimension, `${where}.dimension`)
      return { kind, name: localName(x.name, `${where}.name`), label: viaDocument(where, () => parseMapLabel(x.label, `${where}.label`)), dimension: d, definition: mapDefinition(x.definition, d, `${where}.definition`) }
    }
    case 'update_map':
      closed(x, ['kind', 'mapId', 'label', 'definition'], where)
      return { kind, mapId: ref(x.mapId, `${where}.mapId`), label: viaDocument(where, () => parseMapLabel(x.label, `${where}.label`)), definition: mapDefinition(x.definition, null, `${where}.definition`) }
    case 'update_sample':
      closed(x, ['kind', 'sampleSetId', 'sampleId', 'coords'], where)
      return { kind, sampleSetId: ref(x.sampleSetId, `${where}.sampleSetId`), sampleId: idStr(x.sampleId, `${where}.sampleId`), coords: rationals(x.coords, `${where}.coords`) }
    case 'create_experiment': {
      closed(x, ['kind', 'name', 'sampleSetId', 'branches'], where)
      if (!Array.isArray(x.branches) || x.branches.length === 0 || x.branches.length > 2) throw new ActionError(`${where}.branches: one or two branches`)
      const branches = x.branches.map((b, i) => {
        const w = `${where}.branches[${i}]`
        if (!isObj(b)) throw new ActionError(`${w}: expected an object`)
        closed(b, ['id', 'mapIds'], w)
        if (!Array.isArray(b.mapIds) || b.mapIds.length > 6) throw new ActionError(`${w}.mapIds: at most six maps`)
        return { id: idStr(b.id, `${w}.id`), mapIds: b.mapIds.map((m, j) => ref(m, `${w}.mapIds[${j}]`)) }
      })
      return { kind, name: localName(x.name, `${where}.name`), sampleSetId: ref(x.sampleSetId, `${where}.sampleSetId`), branches }
    }
    case 'set_branch':
      closed(x, ['kind', 'experimentId', 'branchId', 'mapIds'], where)
      if (!Array.isArray(x.mapIds) || x.mapIds.length > 6) throw new ActionError(`${where}.mapIds: at most six maps`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), branchId: idStr(x.branchId, `${where}.branchId`), mapIds: x.mapIds.map((m, j) => ref(m, `${where}.mapIds[${j}]`)) }
    case 'bind_recipe': {
      closed(x, ['kind', 'experimentId', 'recipeId', 'bindings'], where)
      if (!isObj(x.bindings) || Object.keys(x.bindings).length > 6) throw new ActionError(`${where}.bindings: expected an object of port bindings`)
      const bindings: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(x.bindings)) bindings[k] = v === null ? null : ref(v, `${where}.bindings.${k}`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), recipeId: ref(x.recipeId, `${where}.recipeId`), bindings }
    }
    case 'set_view':
      closed(x, ['kind', 'ghostCube', 'sampleLabels'], where)
      if (typeof x.ghostCube !== 'boolean' || typeof x.sampleLabels !== 'boolean') throw new ActionError(`${where}: flags must be booleans`)
      return { kind, ghostCube: x.ghostCube, sampleLabels: x.sampleLabels }
    case 'select':
      closed(x, ['kind', 'experimentId', 'sampleId'], where)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), sampleId: x.sampleId === null ? null : idStr(x.sampleId, `${where}.sampleId`) }
    case 'play':
      closed(x, ['kind', 'experimentId', 'branchId', 'transition', 'duration'], where)
      if (x.transition !== 'apply_map') throw new ActionError(`${where}.transition: only "apply_map" is supported`)
      if (typeof x.duration !== 'number' || !(x.duration >= 0.2 && x.duration <= 5)) throw new ActionError(`${where}.duration: 0.2 to 5 seconds`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), branchId: idStr(x.branchId, `${where}.branchId`), transition: 'apply_map', duration: x.duration }
    case 'play_comparison':
      closed(x, ['kind', 'experimentId', 'stepDuration'], where)
      if (typeof x.stepDuration !== 'number' || !(x.stepDuration >= 0.5 && x.stepDuration <= 5)) throw new ActionError(`${where}.stepDuration: 0.5 to 5 seconds per step`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), stepDuration: x.stepDuration }
    case 'save_recipe':
      closed(x, ['kind', 'name', 'recipe'], where)
      try {
        return { kind, name: localName(x.name, `${where}.name`), recipe: validateRule(x.recipe, `${where}.recipe`) }
      } catch (e) {
        if (e instanceof ActionError) throw e
        throw new ActionError((e as Error).message)
      }
    case 'request_check':
      closed(x, ['kind', 'claim'], where)
      try {
        return { kind, claim: parseClaimRequest(x.claim, `${where}.claim`) }
      } catch (e) {
        throw new ActionError((e as Error).message)
      }
    case 'create_group':
      closed(x, ['kind', 'name', 'label', 'definition'], where)
      return { kind, name: localName(x.name, `${where}.name`), label: viaDocument(where, () => parseMapLabel(x.label, `${where}.label`)), definition: viaDocument(where, () => parseGroupDefinition(x.definition, `${where}.definition`)) }
    case 'create_group_experiment':
      closed(x, ['kind', 'name', 'groupId'], where)
      return { kind, name: localName(x.name, `${where}.name`), groupId: ref(x.groupId, `${where}.groupId`) }
    case 'apply_element':
      closed(x, ['kind', 'experimentId', 'element'], where)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), element: idStr(x.element, `${where}.element`) }
    case 'apply_permutation':
      closed(x, ['kind', 'experimentId', 'representation', 'permutation'], where)
      if (x.representation !== 'diagonal_lines') throw new ActionError(`${where}.representation: only "diagonal_lines" is supported`)
      if (!Array.isArray(x.permutation) || x.permutation.length === 0 || x.permutation.length > MAX_DEGREE || !x.permutation.every((v) => Number.isInteger(v))) throw new ActionError(`${where}.permutation: expected destination indices`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), representation: 'diagonal_lines', permutation: [...(x.permutation as number[])] }
    case 'reset_group':
    case 'undo_step':
      closed(x, ['kind', 'experimentId'], where)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`) }
    case 'set_operands':
      closed(x, ['kind', 'experimentId', 'operands'], where)
      if (!Array.isArray(x.operands) || x.operands.length !== 2) throw new ActionError(`${where}.operands: expected [a, b] (element IDs or null)`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), operands: [nullableId(x.operands[0], `${where}.operands[0]`), nullableId(x.operands[1], `${where}.operands[1]`)] }
    case 'set_observation':
      closed(x, ['kind', 'experimentId', 'observation'], where)
      if (x.observation !== 'none' && x.observation !== 'unoriented_axis_lines') throw new ActionError(`${where}.observation: "none" or "unoriented_axis_lines"`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), observation: x.observation }
    case 'select_item':
      closed(x, ['kind', 'experimentId', 'item'], where)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), item: item(x.item, `${where}.item`) }
    case 'play_steps':
      closed(x, ['kind', 'experimentId', 'stepDuration'], where)
      if (typeof x.stepDuration !== 'number' || !(x.stepDuration >= 0.3 && x.stepDuration <= 5)) throw new ActionError(`${where}.stepDuration: 0.3 to 5 seconds per step`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), stepDuration: x.stepDuration }
    case 'create_braid_experiment':
      closed(x, ['kind', 'name', 'word', 'compare'], where)
      return { kind, name: localName(x.name, `${where}.name`), word: word(x.word, `${where}.word`)!, compare: word(x.compare, `${where}.compare`, true) }
    case 'set_braid': {
      closed(x, ['kind', 'experimentId', 'target', 'word'], where)
      const t = target(x.target, `${where}.target`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), target: t, word: word(x.word, `${where}.word`, t === 'compare') }
    }
    case 'append_crossing':
      closed(x, ['kind', 'experimentId', 'target', 'generator'], where)
      if (!isGenerator(x.generator)) throw new ActionError(`${where}.generator: 1, 2, -1 or -2`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), target: target(x.target, `${where}.target`), generator: x.generator }
    case 'invert_braid':
      closed(x, ['kind', 'experimentId', 'target'], where)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), target: target(x.target, `${where}.target`) }
    case 'rewrite_braid':
      closed(x, ['kind', 'experimentId', 'rule', 'at', 'generator'], where)
      if (!(REWRITE_RULES as readonly unknown[]).includes(x.rule)) throw new ActionError(`${where}.rule: one of ${REWRITE_RULES.join(', ')}`)
      if (typeof x.at !== 'number' || !Number.isInteger(x.at) || x.at < 0 || x.at > MAX_BRAID_LENGTH) throw new ActionError(`${where}.at: a crossing index 0..${MAX_BRAID_LENGTH}`)
      if (x.generator !== null && !isGenerator(x.generator)) throw new ActionError(`${where}.generator: 1, 2, -1, -2 or null`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), rule: x.rule as RewriteRule, at: x.at, generator: x.generator as Generator | null }
    case 'create_vector_walk': {
      closed(x, ['kind', 'name', 'dimension', 'vectors', 'order', 'signs', 'lesson'], where)
      if (x.lesson !== null && x.lesson !== 'steinitz-reordering') throw new ActionError(`${where}.lesson: null or "steinitz-reordering"`)
      return { kind, name: localName(x.name, `${where}.name`), ...walkData(x, where), lesson: x.lesson }
    }
    case 'set_vector_walk':
      closed(x, ['kind', 'experimentId', 'dimension', 'vectors', 'order', 'signs'], where)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), ...walkData(x, where) }
    case 'set_walk_signs': {
      closed(x, ['kind', 'experimentId', 'signs'], where)
      if (!Array.isArray(x.signs) || x.signs.length === 0 || x.signs.length > WALK_LIMITS.maxVectors) throw new ActionError(`${where}.signs: 1 to ${WALK_LIMITS.maxVectors} entries { id, sign }`)
      const signs = x.signs.map((s, i) => {
        const w = `${where}.signs[${i}]`
        if (!isObj(s)) throw new ActionError(`${w}: expected { id, sign }`)
        closed(s, ['id', 'sign'], w)
        return { id: occurrenceId(s.id, `${w}.id`), sign: sign(s.sign, `${w}.sign`) }
      })
      if (new Set(signs.map((s) => s.id)).size !== signs.length) throw new ActionError(`${where}.signs: an occurrence is named twice`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), signs }
    }
    case 'set_walk_order':
      closed(x, ['kind', 'experimentId', 'order'], where)
      if (!Array.isArray(x.order) || x.order.length === 0 || x.order.length > WALK_LIMITS.maxVectors) throw new ActionError(`${where}.order: every occurrence ID once`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), order: x.order.map((o, i) => occurrenceId(o, `${where}.order[${i}]`)) }
    case 'show_walk_stage':
      closed(x, ['kind', 'experimentId', 'stage'], where)
      if (!(WALK_STAGES as readonly unknown[]).includes(x.stage)) throw new ActionError(`${where}.stage: one of ${WALK_STAGES.join(', ')}`)
      return { kind, experimentId: ref(x.experimentId, `${where}.experimentId`), stage: x.stage as WalkStage }
    default:
      throw new ActionError(`${where}: unknown action kind ${JSON.stringify(kind)}`)
  }
}

/** Structural validation of a whole action list; at most one request_check (W4). */
export function parseActions(x: unknown, max: number = PROPOSAL_LIMITS.actions): ActionJson[] {
  if (!Array.isArray(x) || x.length > max) throw new ActionError(`actions: expected at most ${max} actions`)
  const actions = x.map((a, i) => {
    try {
      return parseAction(a, `actions[${i}]`)
    } catch (e) {
      throw new ActionError((e as Error).message, i)
    }
  })
  if (actions.filter((a) => a.kind === 'request_check').length > 1) throw new ActionError('actions: at most one request_check per transaction')
  return actions
}

/** W4 proposal envelope: closed fields, bounded strings, at most 8 structurally valid actions. */
export function parseProposal(x: unknown): Proposal {
  if (!isObj(x)) throw new ActionError('proposal: expected an object')
  closed(x, ['proposalVersion', 'title', 'explanation', 'actions'], 'proposal')
  if (x.proposalVersion !== 1) throw new ActionError('proposal.proposalVersion: must be 1')
  if (typeof x.title !== 'string' || x.title.length === 0 || x.title.length > PROPOSAL_LIMITS.title) throw new ActionError(`proposal.title: 1..${PROPOSAL_LIMITS.title} characters`)
  if (typeof x.explanation !== 'string' || x.explanation.length > PROPOSAL_LIMITS.explanation) throw new ActionError(`proposal.explanation: at most ${PROPOSAL_LIMITS.explanation} characters`)
  return { proposalVersion: 1, title: x.title, explanation: x.explanation, actions: parseActions(x.actions) }
}

// ------------------------------------------------------------------ application HTTP API (W6)

/** Error body of every API endpoint. */
export interface ApiError {
  code: string
  message: string
  retryable: boolean
}

/**
 * W5 evidence reference sent with a request. The browser's hash and receipt ID are lookup keys only: the
 * server validates `claim` (a typed locator into the submitted document), rebuilds the exact claim with the
 * shared claim code, recomputes its hash and resolves a server-issued receipt for that hash. Anything that
 * fails (fabricated ID, mismatched hash, edited data, evicted receipt) is unavailable evidence.
 */
export interface EvidenceRef {
  claim: ClaimRequest
  claimHash: string
  receiptId: string
}

const HASH_RE = /^[0-9a-f]{64}$/
const RECEIPT_RE = /^[A-Za-z0-9_-]{1,80}$/

/** Structural validation of one evidence reference (closed fields; the server resolves it). */
export function parseEvidenceRef(x: unknown, where = 'evidence'): EvidenceRef {
  if (!isObj(x)) throw new ActionError(`${where}: expected an object`)
  closed(x, ['claim', 'claimHash', 'receiptId'], where)
  if (typeof x.claimHash !== 'string' || !HASH_RE.test(x.claimHash)) throw new ActionError(`${where}.claimHash: expected a SHA-256 hex digest`)
  if (typeof x.receiptId !== 'string' || !RECEIPT_RE.test(x.receiptId)) throw new ActionError(`${where}.receiptId: invalid receipt ID`)
  let claim: ClaimRequest
  try {
    claim = parseClaimRequest(x.claim, `${where}.claim`)
  } catch (e) {
    throw new ActionError((e as Error).message)
  }
  return { claim, claimHash: x.claimHash, receiptId: x.receiptId }
}

/** At most API_LIMITS.evidenceRefs references, each structurally valid. */
export function parseEvidenceRefs(x: unknown): EvidenceRef[] {
  if (!Array.isArray(x) || x.length > API_LIMITS.evidenceRefs) throw new ActionError(`evidence: expected at most ${API_LIMITS.evidenceRefs} references`)
  return x.map((r, i) => parseEvidenceRef(r, `evidence[${i}]`))
}

/** W5 request context: the validated document is the authority; the server recomputes facts and the hash. */
export interface AssistantContext {
  contextVersion: 1
  document: DocJson
  evidence: EvidenceRef[]
}

export interface AssistantRequest {
  requestId: string
  workspaceId: string
  baseRevision: number
  /** <= 2,000 characters. */
  prompt: string
  context: AssistantContext
}

/** Application-owned envelope (W4): provenance comes from the server, never from the model. */
export interface AssistantResponse {
  requestId: string
  /** `meta` = a live provider call; `synthetic` = a labelled fixture (never presented as live output). */
  source: 'meta' | 'synthetic'
  /** The actual configured model for a live call; for synthetic, the fixture name. */
  model: string
  baseRevision: number
  contextHash: string
  timing: { providerMs: number | null; totalMs: number }
  proposal: Proposal
}

export const API_LIMITS = { requestBytes: 256 * 1024, prompt: 2000, responseBytes: 64 * 1024, timeoutMs: 45_000, proofTimeoutMs: 15_000, evidenceRefs: 8 } as const
