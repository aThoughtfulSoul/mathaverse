// Reusable representation recipes (WORKSPACE-AND-AI W2): a validated list of typed operation records
// on named input ports. A recipe is a rule, never executable text: it stores no positions, groups or
// fiber directions; binding it to an experiment recomputes every derived value from the exact model.

import type { Dim } from '../model/linear'
import type { BraidOperation, GroupOperation, WalkOperation } from '../domains/inputs'

export class RecipeError extends Error {
  override name = 'RecipeError'
}

export type PortSpec =
  | { type: 'sample_set'; dimensions: Dim[] }
  | { type: 'linear_branch'; sameDimensionAs: string }
  | { type: 'sample_id'; memberOf: string }
  /** A group experiment's group (bound to its group ID). */
  | { type: 'finite_group' }
  /** An element of that group; reads the workspace selection item, like sample_id. */
  | { type: 'group_element'; memberOf: string }
  /** One of a braid experiment's words: "word" (main) or "compare". */
  | { type: 'braid_word' }
  /** A vector-walk experiment's walk (bound to "walk": its vectors, source order and signs). */
  | { type: 'vector_walk' }

/** Capability predicates a recipe may require (computed from the resolved matrix, never a preset name). */
export const PREDICATES = ['coordinate_projector_nullity_one'] as const
export type Predicate = (typeof PREDICATES)[number]

/** Approved structured equation templates (W2): captions bound to mathematical data, not prose. */
export const EQUATION_TEMPLATES = ['current_linear_map'] as const
export type EquationTemplate = (typeof EQUATION_TEMPLATES)[number]

export type RecipeOperation =
  | { kind: 'linked_views'; samples: string; map: string }
  | { kind: 'exact_output_groups'; samples: string; map: string }
  | { kind: 'highlight_selection'; selection: string }
  | { kind: 'selected_fiber_segment'; map: string; selection: string; requires: Predicate; ifUnavailable: 'omit_with_explanation' }
  | { kind: 'equation_caption'; template: EquationTemplate; map: string }
  /** Operation-order comparison: one shared input view and one output view per branch, each branch resolved
   * step by step in chronological order (a branch [A, B] applies A, then B, and resolves to BA). */
  | { kind: 'branch_comparison'; samples: string; left: string; right: string }
  /** A closed outline through these samples of the set, in order, drawn in every view through each view's map.
   * IDs name samples, never positions; a missing ID omits the outline with an explanation. */
  | { kind: 'sample_outline'; samples: string; vertices: string[] }
  /** The four algebra demonstrations (FOUR-DEMOS-PARALLEL-HANDOFF), typed in src/domains/inputs.ts. */
  | GroupOperation
  | BraidOperation
  /** The proof lesson's vector walks (PROOF-EXPLORER-SPEC section 5). */
  | WalkOperation

/** W2 lists `point_trace` and `basis_arrows` too; this build does not render them, so they are rejected
 * with a clear error instead of being accepted and silently ignored. */
export const OPERATION_KINDS = [
  'linked_views', 'exact_output_groups', 'highlight_selection', 'selected_fiber_segment', 'equation_caption', 'branch_comparison', 'sample_outline',
  'regular_action', 'cycle_trails', 'element_orders', 'cube_diagonals', 'quotient_classes', 'braid_diagram', 'braid_invariants',
  'walk_reordering', 'walk_bounds', 'prefix_correspondence',
] as const

/** The operation that decides a recipe's view layout; a recipe has at most one. */
export const LAYOUT_OPERATIONS = ['linked_views', 'branch_comparison', 'regular_action', 'cube_diagonals', 'quotient_classes', 'braid_diagram', 'walk_reordering'] as const
export type LayoutKind = (typeof LAYOUT_OPERATIONS)[number]
export type RecipeDomain = 'linear' | 'group' | 'braid' | 'vector_walk'
const LAYOUT_DOMAIN: Record<LayoutKind, RecipeDomain> = { linked_views: 'linear', branch_comparison: 'linear', regular_action: 'group', cube_diagonals: 'group', quotient_classes: 'group', braid_diagram: 'braid', walk_reordering: 'vector_walk' }
export const UNSUPPORTED_OPERATION_KINDS = ['point_trace', 'basis_arrows'] as const

export interface Recipe {
  schemaVersion: 1
  id: string
  name: string
  inputs: Record<string, PortSpec>
  operations: RecipeOperation[]
}

export const RECIPE_LIMITS = { maxOperations: 12, maxPorts: 6, maxName: 80, outlineVertices: 8 } as const

/** The layout operation of a recipe, if any. */
export function layoutOf(r: { operations: readonly RecipeOperation[] }): LayoutKind | null {
  return (r.operations.find((o) => (LAYOUT_OPERATIONS as readonly string[]).includes(o.kind))?.kind as LayoutKind | undefined) ?? null
}

/** Which kind of experiment a recipe binds to: from its layout, or from its port types without one. */
export function recipeDomain(r: { inputs: Record<string, PortSpec>; operations: readonly RecipeOperation[] }): RecipeDomain {
  const layout = layoutOf(r)
  if (layout) return LAYOUT_DOMAIN[layout]
  const types = Object.values(r.inputs).map((p) => p.type)
  return types.includes('vector_walk') ? 'vector_walk' : types.includes('braid_word') ? 'braid' : types.includes('finite_group') ? 'group' : 'linear'
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:()\-,]{0,63}$/
const PORT_RE = /^[a-z][a-zA-Z0-9_]{0,31}$/

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function closed(o: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new RecipeError(`${where}: unknown field "${k}"`)
  for (const k of allowed) if (!(k in o)) throw new RecipeError(`${where}: missing field "${k}"`)
}

function str(x: unknown, where: string, max = 200): string {
  if (typeof x !== 'string' || x.length === 0 || x.length > max) throw new RecipeError(`${where}: expected a non-empty string`)
  return x
}

function portSpec(x: unknown, where: string): PortSpec {
  if (!isObj(x)) throw new RecipeError(`${where}: expected an object`)
  switch (x.type) {
    case 'sample_set': {
      closed(x, ['type', 'dimensions'], where)
      if (!Array.isArray(x.dimensions) || x.dimensions.length === 0 || !x.dimensions.every((d) => d === 2 || d === 3)) throw new RecipeError(`${where}: dimensions must list 2 and/or 3`)
      return { type: 'sample_set', dimensions: [...new Set(x.dimensions as Dim[])] }
    }
    case 'linear_branch':
      closed(x, ['type', 'sameDimensionAs'], where)
      return { type: 'linear_branch', sameDimensionAs: str(x.sameDimensionAs, `${where}.sameDimensionAs`, 32) }
    case 'sample_id':
      closed(x, ['type', 'memberOf'], where)
      return { type: 'sample_id', memberOf: str(x.memberOf, `${where}.memberOf`, 32) }
    case 'finite_group':
      closed(x, ['type'], where)
      return { type: 'finite_group' }
    case 'group_element':
      closed(x, ['type', 'memberOf'], where)
      return { type: 'group_element', memberOf: str(x.memberOf, `${where}.memberOf`, 32) }
    case 'braid_word':
      closed(x, ['type'], where)
      return { type: 'braid_word' }
    case 'vector_walk':
      closed(x, ['type'], where)
      return { type: 'vector_walk' }
    default:
      throw new RecipeError(`${where}: unknown port type ${JSON.stringify(x.type)}`)
  }
}

function portRef(x: unknown, inputs: Record<string, PortSpec>, want: PortSpec['type'], where: string): string {
  const name = str(x, where, 32)
  const spec = inputs[name]
  if (!spec) throw new RecipeError(`${where}: unknown input port "${name}"`)
  if (spec.type !== want) throw new RecipeError(`${where}: port "${name}" is a ${spec.type}, expected ${want}`)
  return name
}

function operation(x: unknown, inputs: Record<string, PortSpec>, where: string): RecipeOperation {
  if (!isObj(x)) throw new RecipeError(`${where}: expected an object`)
  const kind = x.kind
  if ((UNSUPPORTED_OPERATION_KINDS as readonly unknown[]).includes(kind)) throw new RecipeError(`${where}: "${String(kind)}" is not supported in this build`)
  switch (kind) {
    case 'linked_views':
    case 'exact_output_groups':
      closed(x, ['kind', 'samples', 'map'], where)
      return { kind, samples: portRef(x.samples, inputs, 'sample_set', `${where}.samples`), map: portRef(x.map, inputs, 'linear_branch', `${where}.map`) }
    case 'highlight_selection':
      closed(x, ['kind', 'selection'], where)
      return { kind, selection: portRef(x.selection, inputs, 'sample_id', `${where}.selection`) }
    case 'selected_fiber_segment':
      closed(x, ['kind', 'map', 'selection', 'requires', 'ifUnavailable'], where)
      if (!(PREDICATES as readonly unknown[]).includes(x.requires)) throw new RecipeError(`${where}.requires: unrecognized predicate`)
      if (x.ifUnavailable !== 'omit_with_explanation') throw new RecipeError(`${where}.ifUnavailable: must be "omit_with_explanation"`)
      return { kind, map: portRef(x.map, inputs, 'linear_branch', `${where}.map`), selection: portRef(x.selection, inputs, 'sample_id', `${where}.selection`), requires: x.requires as Predicate, ifUnavailable: 'omit_with_explanation' }
    case 'equation_caption':
      closed(x, ['kind', 'template', 'map'], where)
      if (!(EQUATION_TEMPLATES as readonly unknown[]).includes(x.template)) throw new RecipeError(`${where}.template: unrecognized equation template`)
      return { kind, template: x.template as EquationTemplate, map: portRef(x.map, inputs, 'linear_branch', `${where}.map`) }
    case 'branch_comparison': {
      closed(x, ['kind', 'samples', 'left', 'right'], where)
      const left = portRef(x.left, inputs, 'linear_branch', `${where}.left`)
      const right = portRef(x.right, inputs, 'linear_branch', `${where}.right`)
      if (left === right) throw new RecipeError(`${where}: left and right must be different ports`)
      return { kind, samples: portRef(x.samples, inputs, 'sample_set', `${where}.samples`), left, right }
    }
    case 'sample_outline': {
      closed(x, ['kind', 'samples', 'vertices'], where)
      const v = x.vertices
      if (!Array.isArray(v) || v.length < 2 || v.length > RECIPE_LIMITS.outlineVertices) throw new RecipeError(`${where}.vertices: 2..${RECIPE_LIMITS.outlineVertices} sample IDs`)
      const vertices = v.map((id, i) => {
        if (typeof id !== 'string' || !ID_RE.test(id)) throw new RecipeError(`${where}.vertices[${i}]: invalid sample ID`)
        return id
      })
      if (new Set(vertices).size !== vertices.length) throw new RecipeError(`${where}.vertices: duplicate sample IDs`)
      return { kind, samples: portRef(x.samples, inputs, 'sample_set', `${where}.samples`), vertices }
    }
    case 'regular_action':
    case 'cycle_trails':
      closed(x, ['kind', 'group', 'operation'], where)
      return { kind, group: portRef(x.group, inputs, 'finite_group', `${where}.group`), operation: portRef(x.operation, inputs, 'group_element', `${where}.operation`) }
    case 'element_orders':
      closed(x, ['kind', 'group'], where)
      return { kind, group: portRef(x.group, inputs, 'finite_group', `${where}.group`) }
    case 'cube_diagonals':
      closed(x, ['kind', 'group', 'selection'], where)
      return { kind, group: portRef(x.group, inputs, 'finite_group', `${where}.group`), selection: portRef(x.selection, inputs, 'group_element', `${where}.selection`) }
    case 'quotient_classes':
      closed(x, ['kind', 'group', 'observation', 'selection'], where)
      if (x.observation !== 'unoriented_axis_lines') throw new RecipeError(`${where}.observation: only "unoriented_axis_lines" is supported`)
      return { kind, group: portRef(x.group, inputs, 'finite_group', `${where}.group`), observation: 'unoriented_axis_lines', selection: portRef(x.selection, inputs, 'group_element', `${where}.selection`) }
    case 'braid_diagram':
    case 'braid_invariants': {
      closed(x, ['kind', 'word', 'compare'], where)
      const word = portRef(x.word, inputs, 'braid_word', `${where}.word`)
      const compare = portRef(x.compare, inputs, 'braid_word', `${where}.compare`)
      if (word === compare) throw new RecipeError(`${where}: word and compare must be different ports`)
      return { kind, word, compare }
    }
    case 'walk_reordering':
    case 'walk_bounds':
    case 'prefix_correspondence':
      closed(x, ['kind', 'walk'], where)
      return { kind, walk: portRef(x.walk, inputs, 'vector_walk', `${where}.walk`) }
    default:
      throw new RecipeError(`${where}: unknown operation kind ${JSON.stringify(kind)}`)
  }
}

/** The rule part of a recipe (what `save_recipe` carries): no ID, which the planner assigns. */
export interface RecipeRule {
  name: string
  inputs: Record<string, PortSpec>
  operations: RecipeOperation[]
}

/** Validate a recipe rule: closed fields, known ports and kinds, no cycles, port types consistent. */
export function validateRule(x: unknown, where = 'recipe'): RecipeRule {
  if (!isObj(x)) throw new RecipeError(`${where}: expected an object`)
  closed(x, ['name', 'inputs', 'operations'], where)
  const name = str(x.name, `${where}.name`, RECIPE_LIMITS.maxName)
  if (!isObj(x.inputs)) throw new RecipeError(`${where}.inputs: expected an object`)
  const portNames = Object.keys(x.inputs)
  if (portNames.length === 0 || portNames.length > RECIPE_LIMITS.maxPorts) throw new RecipeError(`${where}.inputs: 1..${RECIPE_LIMITS.maxPorts} ports`)
  const inputs: Record<string, PortSpec> = {}
  for (const p of portNames) {
    if (!PORT_RE.test(p)) throw new RecipeError(`${where}.inputs: invalid port name "${p}"`)
    inputs[p] = portSpec(x.inputs[p], `${where}.inputs.${p}`)
  }
  // Port references between ports: must name a port of the right type (and so cannot be cyclic: the
  // only references are linear_branch -> sample_set and sample_id -> sample_set, never back).
  for (const [p, spec] of Object.entries(inputs)) {
    if (spec.type === 'linear_branch' && inputs[spec.sameDimensionAs]?.type !== 'sample_set') throw new RecipeError(`${where}.inputs.${p}: sameDimensionAs must name a sample_set port`)
    if (spec.type === 'sample_id' && inputs[spec.memberOf]?.type !== 'sample_set') throw new RecipeError(`${where}.inputs.${p}: memberOf must name a sample_set port`)
    if (spec.type === 'group_element' && inputs[spec.memberOf]?.type !== 'finite_group') throw new RecipeError(`${where}.inputs.${p}: memberOf must name a finite_group port`)
  }
  // One domain per recipe: linear ports never mix with group or braid ports.
  const domains = new Set(Object.values(inputs).map((s) => (s.type === 'finite_group' || s.type === 'group_element' ? 'group' : s.type === 'braid_word' ? 'braid' : s.type === 'vector_walk' ? 'vector_walk' : 'linear')))
  if (domains.size > 1) throw new RecipeError(`${where}.inputs: ports of different domains (${[...domains].join(', ')}) cannot be mixed`)
  if (!Array.isArray(x.operations) || x.operations.length === 0 || x.operations.length > RECIPE_LIMITS.maxOperations) throw new RecipeError(`${where}.operations: 1..${RECIPE_LIMITS.maxOperations} operations`)
  const operations = x.operations.map((o, i) => operation(o, inputs, `${where}.operations[${i}]`))
  // One view layout per recipe: linked views (one map) or a branch comparison (two), never both.
  const kinds = operations.map((o) => o.kind)
  if (kinds.includes('branch_comparison') && kinds.includes('linked_views')) throw new RecipeError(`${where}.operations: branch_comparison and linked_views are alternative layouts`)
  if (kinds.filter((k) => k === 'branch_comparison').length > 1) throw new RecipeError(`${where}.operations: at most one branch_comparison`)
  const layouts = kinds.filter((k) => (LAYOUT_OPERATIONS as readonly string[]).includes(k))
  if (layouts.length > 1) throw new RecipeError(`${where}.operations: ${layouts.join(' and ')} are alternative layouts; a recipe has at most one`)
  return { name, inputs, operations }
}

export function validateRecipe(x: unknown, where = 'recipe'): Recipe {
  if (!isObj(x)) throw new RecipeError(`${where}: expected an object`)
  closed(x, ['schemaVersion', 'id', 'name', 'inputs', 'operations'], where)
  if (x.schemaVersion !== 1) throw new RecipeError(`${where}.schemaVersion: must be 1`)
  if (typeof x.id !== 'string' || !ID_RE.test(x.id)) throw new RecipeError(`${where}.id: invalid ID`)
  const rule = validateRule({ name: x.name, inputs: x.inputs, operations: x.operations }, where)
  return { schemaVersion: 1, id: x.id, ...rule }
}

/** The normative minimal recipe of W2 ("What gets lost"). */
export const WHAT_GETS_LOST: RecipeRule = {
  name: 'What gets lost',
  inputs: {
    samples: { type: 'sample_set', dimensions: [2, 3] },
    map: { type: 'linear_branch', sameDimensionAs: 'samples' },
    selection: { type: 'sample_id', memberOf: 'samples' },
  },
  operations: [
    { kind: 'linked_views', samples: 'samples', map: 'map' },
    { kind: 'exact_output_groups', samples: 'samples', map: 'map' },
    { kind: 'highlight_selection', selection: 'selection' },
    { kind: 'selected_fiber_segment', map: 'map', selection: 'selection', requires: 'coordinate_projector_nullity_one', ifUnavailable: 'omit_with_explanation' },
    { kind: 'equation_caption', template: 'current_linear_map', map: 'map' },
  ],
}

/** The operation-order comparison (SECOND-DEMO-PARALLEL-HANDOFF): two branches of one experiment on the same
 * labelled samples. The outline names the square's corners by sample ID; geometry comes from the samples. */
export const ORDER_MATTERS: RecipeRule = {
  name: 'Does order matter?',
  inputs: {
    samples: { type: 'sample_set', dimensions: [2, 3] },
    left: { type: 'linear_branch', sameDimensionAs: 'samples' },
    right: { type: 'linear_branch', sameDimensionAs: 'samples' },
    selection: { type: 'sample_id', memberOf: 'samples' },
  },
  operations: [
    { kind: 'branch_comparison', samples: 'samples', left: 'left', right: 'right' },
    { kind: 'sample_outline', samples: 'samples', vertices: ['s(1,1,0)', 's(-1,1,0)', 's(-1,-1,0)', 's(1,-1,0)'] },
    { kind: 'highlight_selection', selection: 'selection' },
  ],
}

/** The recipe's comparison operation, if it lays out a branch comparison. */
export function comparisonOf(r: { operations: RecipeOperation[] }): Extract<RecipeOperation, { kind: 'branch_comparison' }> | null {
  return (r.operations.find((o) => o.kind === 'branch_comparison') as Extract<RecipeOperation, { kind: 'branch_comparison' }> | undefined) ?? null
}

/** The kinetic group sculpture (demonstration 1): the left regular action as beads, the selected operation's
 * cycles as trails, every element's order. The same rule binds to C4 and to V4. */
export const GROUP_SCULPTURE: RecipeRule = {
  name: 'Group sculpture',
  inputs: { group: { type: 'finite_group' }, operation: { type: 'group_element', memberOf: 'group' } },
  operations: [
    { kind: 'regular_action', group: 'group', operation: 'operation' },
    { kind: 'cycle_trails', group: 'group', operation: 'operation' },
    { kind: 'element_orders', group: 'group' },
  ],
}

/** Two worlds, one structure (demonstration 2): the cube linked to the permutations of its diagonals. */
export const TWO_WORLDS: RecipeRule = {
  name: 'Two worlds, one structure',
  inputs: { group: { type: 'finite_group' }, selection: { type: 'group_element', memberOf: 'group' } },
  operations: [{ kind: 'cube_diagonals', group: 'group', selection: 'selection' }],
}

/** Choose what matters (demonstration 3): the 24 rotations grouped by their action on the axis lines. */
export const CHOOSE_WHAT_MATTERS: RecipeRule = {
  name: 'Choose what matters',
  inputs: { group: { type: 'finite_group' }, selection: { type: 'group_element', memberOf: 'group' } },
  operations: [{ kind: 'quotient_classes', group: 'group', observation: 'unoriented_axis_lines', selection: 'selection' }],
}

/** Weaving algebra (demonstration 4): the braid and its comparison, with the supported-check status. */
export const WEAVING: RecipeRule = {
  name: 'Weaving algebra',
  inputs: { word: { type: 'braid_word' }, compare: { type: 'braid_word' } },
  operations: [
    { kind: 'braid_diagram', word: 'word', compare: 'compare' },
    { kind: 'braid_invariants', word: 'word', compare: 'compare' },
  ],
}

/** Rearranging a closed walk (the proof lesson): the source walk, its auxiliary signed walk and the
 * positive-forward / negative-reverse reordering, with the integer bounds and, for the selected reordered
 * endpoint, its witness prefixes. The same rule binds to every vector-walk experiment (hero, simpler example). */
export const REARRANGE_WALK: RecipeRule = {
  name: 'Rearranging a closed walk',
  inputs: { walk: { type: 'vector_walk' } },
  operations: [
    { kind: 'walk_reordering', walk: 'walk' },
    { kind: 'walk_bounds', walk: 'walk' },
    { kind: 'prefix_correspondence', walk: 'walk' },
  ],
}
