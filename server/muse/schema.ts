// Strict structured-output schema for the W4 proposal, built from the action types in
// src/workspace/actions.ts. It is sent as Responses `text.format` (type json_schema, strict: true).
//
// Strict subset (dev.meta.ai/docs/structured-output, from documentation, not yet verified live): plain
// object root; `anyOf` below the root only; no `oneOf`/`allOf`; every object closed with
// `additionalProperties: false` and every property required. This builder uses only the keywords
// type, properties, required, additionalProperties, items, anyOf, enum and description, because
// other keywords (pattern, minLength, maxItems, minimum, ...) are not documented for the strict subset.
//
// What the schema cannot express exactly is stated in descriptions and enforced by the server's
// validators, which stay authoritative (parseProposal, then planTransaction):
// - string/array bounds (title <= 80, explanation <= 700, <= 8 actions, matrix shape, rational format);
// - the `play` duration range 0.2..5 s and the `play_comparison` step range 0.5..5 s;
// - `bind_recipe.bindings` is an open record in the action type; here it is one closed object per
//   distinct port set of the document's recipes (plus the W2 ports and the comparison ports), so a
//   recipe saved with novel port names cannot be bound in the same proposal;
// - `save_recipe.recipe.inputs` is an open record; here it is restricted to the W2 port names
//   (samples, map, selection) or the comparison port names (samples, left, right, selection), each
//   with or without `selection`; `sample_outline.vertices` holds 2..8 distinct sample IDs.
// One variant is not an action: use_prepared names an available prepared template by its context path
// (an enum of exactly the templates available on this document); validate.ts replaces it with that
// template's actions before parseProposal, so neither the planner nor the client ever sees it.

import type { Doc } from '../../src/workspace/document'
import { EQUATION_TEMPLATES, ORDER_MATTERS, PREDICATES, WHAT_GETS_LOST, GROUP_SCULPTURE, TWO_WORLDS, WEAVING, REARRANGE_WALK } from '../../src/recipes/recipe'
import { WALK_STAGES } from '../../src/domains/inputs'
import { CYCLIC_ORDERS } from '../../src/algebra/groups'
import { USE_PREPARED, preparedCatalog } from './prepared'

export type JsonSchema = { [k: string]: unknown }

const describe = (s: JsonSchema, description?: string): JsonSchema => (description ? { ...s, description } : s)
const str = (description?: string): JsonSchema => describe({ type: 'string' }, description)
const bool = (): JsonSchema => ({ type: 'boolean' })
const ints = (values: number[], description?: string): JsonSchema => describe({ type: 'integer', enum: values }, description)
const lit = (value: string): JsonSchema => ({ type: 'string', enum: [value] })
const oneOfStrings = (values: readonly string[]): JsonSchema => ({ type: 'string', enum: [...values] })
const arr = (items: JsonSchema, description?: string): JsonSchema => describe({ type: 'array', items }, description)
const anyOf = (variants: JsonSchema[], description?: string): JsonSchema => describe({ anyOf: variants }, description)
const nullable = (s: JsonSchema): JsonSchema => ({ anyOf: [s, { type: 'null' }] })
function obj(properties: Record<string, JsonSchema>, description?: string): JsonSchema {
  return describe({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false }, description)
}

const rational = obj(
  { n: str('numerator: decimal integer string such as "-3"'), d: str('denominator: positive decimal integer string, coprime to n; zero is {"n":"0","d":"1"}') },
  'exact rational; authored values lie in [-4, 4] with denominator at most 1000000',
)
const ref = (what: string) => str(`${what}: an existing ID from the document, or "$name" for one created earlier in this proposal`)
const localName = str('transaction-local name: lowercase letters, digits and _ (max 24); the app assigns the ID')
const dimension = ints([2, 3])
const axis = ints([0, 1, 2], 'coordinate index: 0 = x, 1 = y, 2 = z (must be below the dimension)')
const mapLabel = str('map label: one capital letter, optionally with a numeric subscript such as "P_{1}"')

// Map definitions: {preset} or {matrix}. The preset variants are flattened into the outer anyOf
// (the same instances as {preset: anyOf[...]}) to keep nesting shallow.
const presetVariants: JsonSchema[] = [
  obj({ kind: lit('identity') }),
  obj({ kind: lit('scaling'), factors: arr(rational, 'one factor per coordinate') }),
  obj({ kind: lit('shear'), i: axis, j: axis, k: rational }, 'output coordinate i gains k times input coordinate j (i != j)'),
  obj({ kind: lit('reflection'), axis }, 'negates one coordinate'),
  obj({ kind: lit('projection'), keep: arr(bool(), 'one flag per coordinate: true keeps it, false sends it to 0') }),
  obj({ kind: lit('rotation'), quarterTurns: ints([-3, -2, -1, 0, 1, 2, 3], 'multiples of 90 degrees only'), axis: ints([0, 1, 2], 'rotation axis in 3D; must be 2 in 2D') }),
]
const definition = anyOf(
  [...presetVariants.map((p) => obj({ preset: p })), obj({ matrix: arr(arr(rational), 'row-major, square, one row per coordinate') })],
  'complete map definition: a preset or an exact matrix',
)

const sampleSource = anyOf([
  obj({ preset: oneOfStrings(['cartesian_-1_0_1']) }, 'the grid {-1, 0, 1}^d'),
  obj({ samples: arr(obj({ id: str('stable sample ID'), label: str('empty, or one letter with an optional numeric subscript'), coords: arr(rational, 'one rational per coordinate') }), '1 to 64 samples') }),
])

const branchRef = obj({ experimentId: ref('experiment'), branchId: str('branch ID within that experiment') })

const walkVectors = arr(obj({ id: str('occurrence ID such as "v0" (lowercase letter, then letters, digits or _)'), coords: arr(rational, 'one rational per coordinate; |x| <= 4, denominator <= 1000') }), '1 to 12 occurrences; equal coordinates are still separate occurrences')
const walkOrder = arr(str('occurrence ID'), 'source order: every occurrence ID exactly once')
const walkSigns = arr(ints([1, -1]), 'one sign per occurrence, in the order of `vectors`')

/** Port names a saved recipe may use under this schema: W2 (linked views) and the comparison ports. */
const portSpecs = {
  samples: obj({ type: lit('sample_set'), dimensions: arr(ints([2, 3]), 'accepted dimensions') }),
  map: obj({ type: lit('linear_branch'), sameDimensionAs: lit('samples') }),
  left: obj({ type: lit('linear_branch'), sameDimensionAs: lit('samples') }, 'the branch shown in the left output view'),
  right: obj({ type: lit('linear_branch'), sameDimensionAs: lit('samples') }, 'the branch shown in the right output view'),
  selection: obj({ type: lit('sample_id'), memberOf: lit('samples') }),
  group: obj({ type: lit('finite_group') }, 'the experiment\'s group'),
  operation: obj({ type: lit('group_element'), memberOf: lit('group') }, 'the selected element (reads the selection item)'),
  groupSelection: obj({ type: lit('group_element'), memberOf: lit('group') }, 'the selected element (reads the selection item)'),
  word: obj({ type: lit('braid_word') }, 'bound to "word" (the main braid)'),
  compare: obj({ type: lit('braid_word') }, 'bound to "compare" (the comparison braid)'),
  walk: obj({ type: lit('vector_walk') }, 'bound to "walk" (the vector-walk experiment\'s vectors, order and signs)'),
}
const recipeRule = obj({
  name: str('recipe name, at most 80 characters'),
  inputs: anyOf([
    obj({ samples: portSpecs.samples, map: portSpecs.map, selection: portSpecs.selection }),
    obj({ samples: portSpecs.samples, map: portSpecs.map }),
    obj({ samples: portSpecs.samples, left: portSpecs.left, right: portSpecs.right, selection: portSpecs.selection }),
    obj({ samples: portSpecs.samples, left: portSpecs.left, right: portSpecs.right }),
    obj({ group: portSpecs.group, operation: portSpecs.operation }),
    obj({ group: portSpecs.group, selection: portSpecs.groupSelection }),
    obj({ word: portSpecs.word, compare: portSpecs.compare }),
    obj({ walk: portSpecs.walk }),
  ]),
  operations: arr(
    anyOf([
      obj({ kind: lit('linked_views'), samples: lit('samples'), map: lit('map') }, 'linked input/output views of one branch (not with branch_comparison)'),
      obj({ kind: lit('exact_output_groups'), samples: lit('samples'), map: lit('map') }),
      obj({ kind: lit('highlight_selection'), selection: lit('selection') }),
      obj({ kind: lit('selected_fiber_segment'), map: lit('map'), selection: lit('selection'), requires: oneOfStrings(PREDICATES), ifUnavailable: lit('omit_with_explanation') }),
      obj({ kind: lit('equation_caption'), template: oneOfStrings(EQUATION_TEMPLATES), map: lit('map') }),
      obj({ kind: lit('branch_comparison'), samples: lit('samples'), left: lit('left'), right: lit('right') }, 'one shared input view and one output view per branch, each resolved step by step (not with linked_views)'),
      obj({ kind: lit('sample_outline'), samples: lit('samples'), vertices: arr(str('sample ID of the set'), '2 to 8 distinct sample IDs, in outline order') }, 'a closed outline through these samples in every view'),
      obj({ kind: lit('regular_action'), group: lit('group'), operation: lit('operation') }, 'layout: the group acting on itself as persistent beads (groups of at most 8 elements)'),
      obj({ kind: lit('cycle_trails'), group: lit('group'), operation: lit('operation') }, 'trails of the selected operation\'s cycles'),
      obj({ kind: lit('element_orders'), group: lit('group') }, 'every element\'s order, computed exactly'),
      obj({ kind: lit('cube_diagonals'), group: lit('group'), selection: lit('selection') }, 'layout: the cube and its four diagonal objects (cube group only)'),
      obj({ kind: lit('quotient_classes'), group: lit('group'), observation: lit('unoriented_axis_lines'), selection: lit('selection') }, 'layout: the 24 rotations grouped by the axis-line observation (cube group only)'),
      obj({ kind: lit('braid_diagram'), word: lit('word'), compare: lit('compare') }, 'layout: the braid and its comparison'),
      obj({ kind: lit('braid_invariants'), word: lit('word'), compare: lit('compare') }, 'endpoint permutation, exponent sum and the supported-check status'),
      obj({ kind: lit('walk_reordering'), walk: lit('walk') }, 'layout: the source walk, its auxiliary signed walk and the positive-forward / negative-reverse reordering'),
      obj({ kind: lit('walk_bounds'), walk: lit('walk') }, 'the integer bounds B, D and (B + D)/2, with the actual peaks labelled separately'),
      obj({ kind: lit('prefix_correspondence'), walk: lit('walk') }, 'for the selected reordered endpoint: its witness prefixes and the half-vector construction'),
    ]),
    '1 to 12 operations on the input ports',
  ),
})

const claim = anyOf([
  obj({ kind: lit('same_image_witness'), branch: branchRef, u: str('sample ID'), v: str('sample ID') }),
  obj({ kind: lit('map_equality'), left: branchRef, right: branchRef }),
  obj({ kind: lit('map_difference_witness'), left: branchRef, right: branchRef, basisIndex: axis }),
  obj({ kind: lit('walk_reorder_instance'), experimentId: ref('vector-walk experiment') }, 'the current finite walk (every prefix); refused when the walk does not return to its start'),
])

/** Distinct recipe port sets in the document, plus the W2 and comparison ports (for a recipe saved in the proposal). */
export function bindingPortSets(doc: Doc): string[][] {
  const sets = [Object.keys(WHAT_GETS_LOST.inputs), Object.keys(ORDER_MATTERS.inputs), Object.keys(GROUP_SCULPTURE.inputs), Object.keys(TWO_WORLDS.inputs), Object.keys(WEAVING.inputs), Object.keys(REARRANGE_WALK.inputs), ...doc.recipes.map((r) => Object.keys(r.inputs))]
  const seen = new Map<string, string[]>()
  for (const s of sets) seen.set([...s].sort().join('|'), s)
  return [...seen.values()]
}

function actionVariants(doc: Doc): JsonSchema[] {
  const bindingVariants = bindingPortSets(doc).map((ports) =>
    obj(Object.fromEntries(ports.map((p) => [p, nullable(str())])), 'every recipe port: sample_set -> the experiment\'s sample-set ID, linear_branch -> a branch ID, sample_id -> the sample to select (or null)'),
  )
  return [
    obj({ kind: lit('create_samples'), name: localName, dimension, source: sampleSource }),
    obj({ kind: lit('create_map'), name: localName, label: mapLabel, dimension, definition }),
    obj({ kind: lit('update_map'), mapId: ref('map'), label: mapLabel, definition }),
    obj({ kind: lit('update_sample'), sampleSetId: ref('sample set'), sampleId: str('existing sample ID'), coords: arr(rational) }),
    obj({ kind: lit('create_experiment'), name: localName, sampleSetId: ref('sample set'), branches: arr(obj({ id: str('branch ID such as "main"'), mapIds: arr(ref('map'), 'application order: [A, B] means A then B; at most 6') }), 'one or two branches') }),
    obj({ kind: lit('set_branch'), experimentId: ref('experiment'), branchId: str('existing branch ID'), mapIds: arr(ref('map'), 'application order, at most 6') }),
    obj({ kind: lit('bind_recipe'), experimentId: ref('experiment'), recipeId: ref('recipe'), bindings: bindingVariants.length === 1 ? bindingVariants[0]! : anyOf(bindingVariants) }),
    obj({ kind: lit('set_view'), ghostCube: bool(), sampleLabels: bool() }),
    obj({ kind: lit('select'), experimentId: ref('experiment'), sampleId: nullable(str('sample ID in that experiment\'s sample set')) }),
    obj({ kind: lit('play'), experimentId: ref('experiment'), branchId: str('branch ID'), transition: lit('apply_map'), duration: describe({ type: 'number' }, 'seconds, from 0.2 to 5') }, 'animate one branch of linked views (refused on a comparison)'),
    obj({ kind: lit('play_comparison'), experimentId: ref('experiment'), stepDuration: describe({ type: 'number' }, 'seconds per step, from 0.5 to 5') }, 'replay the displayed branch comparison step by step (refused on linked views)'),
    obj({ kind: lit('save_recipe'), name: localName, recipe: recipeRule }),
    obj({ kind: lit('request_check'), claim }, 'requests a Lean check of a concrete claim on the current data; never a claimed result; at most one per proposal'),
    // ---- finite groups (sculpture, cube, quotient)
    obj({ kind: lit('create_group'), name: localName, label: mapLabel, definition: anyOf([obj({ kind: lit('cyclic'), order: ints(Array.from({ length: CYCLIC_ORDERS.max }, (_, i) => i + 1)) }), obj({ kind: lit('klein_four') }), obj({ kind: lit('cube_rotations') })]) }, 'a group by typed definition; its multiplication is computed by the application'),
    obj({ kind: lit('create_group_experiment'), name: localName, groupId: ref('group') }),
    obj({ kind: lit('apply_element'), experimentId: ref('group experiment'), element: str('element ID of that group ("c1", "v10", "r(y,-x,z)")') }, 'apply one operation (appended to the experiment\'s history, at most 24 steps)'),
    obj({ kind: lit('apply_permutation'), experimentId: ref('cube experiment'), representation: lit('diagonal_lines'), permutation: arr(ints([0, 1, 2, 3]), 'p[i] = destination line of line i; 4 distinct entries') }, 'apply the unique cube rotation inducing this permutation of the diagonal lines'),
    obj({ kind: lit('reset_group'), experimentId: ref('group experiment') }, 'empty the history (identity)'),
    obj({ kind: lit('undo_step'), experimentId: ref('group experiment') }, 'remove the last applied operation'),
    obj({ kind: lit('set_operands'), experimentId: ref('group experiment'), operands: arr(nullable(str('element ID')), 'exactly two entries: A, B (A, then B)') }),
    obj({ kind: lit('set_observation'), experimentId: ref('cube experiment'), observation: oneOfStrings(['none', 'unoriented_axis_lines']) }, '"unoriented_axis_lines" groups the 24 rotations into classes'),
    obj({ kind: lit('select_item'), experimentId: ref('group, braid or vector-walk experiment'), item: nullable(str('element ID, class:<key>, line:<0-3>, axis:<0-2>, crossing:<k> (k from 0), strand:<a|b|c>; for a walk walk:source:<j>, walk:signed:<j>, walk:reordered:<k> (prefix lengths 0..N) or walk:vector:<id>')) }, 'display that experiment and select one item'),
    obj({ kind: lit('play_steps'), experimentId: ref('group, braid or vector-walk experiment'), stepDuration: describe({ type: 'number' }, 'seconds per step, from 0.3 to 5') }, 'replay the displayed group or braid experiment\'s construction'),
    // ---- three-strand braids
    obj({ kind: lit('create_braid_experiment'), name: localName, word: arr(ints([1, 2, -1, -2]), 'chronological crossings: 1 = sigma1, -1 = its inverse; at most 24'), compare: nullable(arr(ints([1, 2, -1, -2]))) }),
    obj({ kind: lit('set_braid'), experimentId: ref('braid experiment'), target: oneOfStrings(['word', 'compare']), word: nullable(arr(ints([1, 2, -1, -2]), 'at most 24 crossings; null removes the comparison')) }),
    obj({ kind: lit('append_crossing'), experimentId: ref('braid experiment'), target: oneOfStrings(['word', 'compare']), generator: ints([1, 2, -1, -2]) }),
    obj({ kind: lit('invert_braid'), experimentId: ref('braid experiment'), target: oneOfStrings(['word', 'compare']) }, 'reverse the order and flip every crossing'),
    // ---- vector walks (the proof lesson)
    obj({ kind: lit('create_vector_walk'), name: localName, dimension, vectors: walkVectors, order: walkOrder, signs: walkSigns, lesson: nullable(oneOfStrings(['steinitz-reordering'])) }, 'a walk of 1 to 12 vector occurrences with one sign each'),
    obj({ kind: lit('set_vector_walk'), experimentId: ref('vector-walk experiment'), dimension, vectors: walkVectors, order: walkOrder, signs: walkSigns }, 'replace the walk\'s inputs atomically (Undo restores the previous case)'),
    obj({ kind: lit('set_walk_signs'), experimentId: ref('vector-walk experiment'), signs: arr(obj({ id: str('occurrence ID'), sign: ints([1, -1]) }), 'the occurrences to change; the others keep their signs') }, 'signs label occurrences; they never change the source or reordered arrows'),
    obj({ kind: lit('set_walk_order'), experimentId: ref('vector-walk experiment'), order: walkOrder }, 'a new source order: every occurrence ID once; signs stay with their occurrences'),
    obj({ kind: lit('show_walk_stage'), experimentId: ref('the displayed vector-walk experiment'), stage: oneOfStrings(WALK_STAGES) }, 'show one step of the lesson (presentation only)'),
    obj({ kind: lit('rewrite_braid'), experimentId: ref('braid experiment'), rule: oneOfStrings(['cancel_pair', 'insert_pair', 'braid_relation']), at: describe({ type: 'integer' }, 'index of the span\'s first crossing, counted from 0 (the panel\'s "crossings 3–5" is 2; insert: the insertion index, from 0)'), generator: nullable(ints([1, 2, -1, -2])) }, 'a supported local rewrite of the main word; the application checks the span'),
    // ---- a prepared template by reference: not an action kind; the server expands it before validation
    ...preparedVariant(doc),
  ]
}

/** use_prepared, with the paths of the templates available on this document (none: no variant). */
function preparedVariant(doc: Doc): JsonSchema[] {
  const names = [...preparedCatalog(doc).keys()]
  return names.length
    ? [obj({ kind: lit(USE_PREPARED), template: oneOfStrings(names) }, 'one prepared template from the context, by its path; the application replaces it with exactly that template\'s actions, which count toward the 8')]
    : []
}

/** The proposal schema for one request (bindings depend on the document's recipes). */
export function proposalSchema(doc: Doc): JsonSchema {
  return obj({
    proposalVersion: ints([1]),
    title: str('short title, at most 80 characters'),
    explanation: str('plain explanation for the learner, at most 700 characters'),
    actions: arr(anyOf(actionVariants(doc)), 'at most 8 actions, applied as one all-or-nothing transaction; [] to answer or explain only'),
  })
}

export const SCHEMA_NAME = 'workspace_proposal'
