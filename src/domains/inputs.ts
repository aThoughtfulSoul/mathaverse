// Inputs to the four new demonstrations' derivations (FOUR-DEMOS-PARALLEL-HANDOFF section 2). The
// coordinator builds them from the validated document (src/domains/registry.ts); a derivation turns one
// into a plain scene description; a scene (src/domains/scene.ts) shows that description. Inputs carry exact
// data only: element IDs, words, chosen operands. Geometry, easing and layout are derived presentation.
//
// Pure module (types and constants only): imported by the browser and by the Node server.

import type { FiniteGroup, GroupDefinition } from '../algebra/groups'
import type { Generator, RewriteStep } from '../algebra/braid'
import type { WalkInput } from '../algebra/walk'

/** One applied group operation. `via` records which representation drove it: the element itself (sculpture
 * card, cube rotation) or a permutation of the cube's diagonal lines resolved to its unique rotation. */
export interface GroupStep {
  element: string
  via: 'element' | 'diagonal_lines'
}

/** What a group experiment observes: everything, or only the unoriented coordinate-axis lines (pi). */
export type Observation = 'none' | 'unoriented_axis_lines'

/** Recipe operations of the group domain (validated in src/recipes/recipe.ts; port names, never IDs). */
export type GroupOperation =
  /** Layout: the left regular action as persistent beads on slots (sculpture). */
  | { kind: 'regular_action'; group: string; operation: string }
  /** Trails of the operation's cycles under the regular action. */
  | { kind: 'cycle_trails'; group: string; operation: string }
  /** Every element's order, computed exactly. */
  | { kind: 'element_orders'; group: string }
  /** Layout: the cube and its four body-diagonal objects, linked through phi. */
  | { kind: 'cube_diagonals'; group: string; selection: string }
  /** Layout: the 24 rotations as a constellation, groupable into classes by an observation (pi). */
  | { kind: 'quotient_classes'; group: string; observation: 'unoriented_axis_lines'; selection: string }

/** Recipe operations of the braid domain. */
export type BraidOperation =
  /** Layout: three strands between fixed endpoint frames, for the main word and the comparison word. */
  | { kind: 'braid_diagram'; word: string; compare: string }
  /** Endpoint permutation, exponent sum and the supported-check status. */
  | { kind: 'braid_invariants'; word: string; compare: string }

/** Recipe operations of the vector-walk domain (the proof lesson, PROOF-EXPLORER-SPEC section 5). */
export type WalkOperation =
  /** Layout: the source walk, its auxiliary signed walk and the positive-forward / negative-reverse reordering. */
  | { kind: 'walk_reordering'; walk: string }
  /** The integer bounds B, D and R = (B + D)/2 as wire spheres, with the actual peaks labelled separately. */
  | { kind: 'walk_bounds'; walk: string }
  /** For the selected reordered endpoint: its source/signed witness prefixes and the half-vector construction. */
  | { kind: 'prefix_correspondence'; walk: string }

export type SceneLayout = 'sculpture' | 'cube' | 'quotient' | 'braid' | 'walk'

/** The lesson's step strip (transient presentation state, never in the document): Walk -> Signs -> Reorder ->
 * Why -> Assumptions. A stage change is not a mathematical transaction. */
export const WALK_STAGES = ['walk', 'signs', 'reorder', 'why', 'assumptions'] as const
export type WalkStage = (typeof WALK_STAGES)[number]

/** The bound recipe as a scene sees it: which representations to show. */
export interface SceneRecipe<Op> {
  id: string
  name: string
  operations: readonly Op[]
}

/**
 * Selection item conventions (`item`, the workspace selection inside the displayed experiment):
 * - group experiments: an element ID ("c1", "v10", "r(y,-x,z)"; for the sculpture the bead whose identity is
 *   that element), "class:<key>" (a class of pi, key = permKey(pi(M)) such as "102"), "line:<0-3>" (a body
 *   diagonal line), "axis:<0-2>" (a coordinate-axis line);
 * - braid experiments: "crossing:<k>" (0-based index into the main word) or "strand:<a|b|c>".
 * Validated by the planner; null = nothing selected.
 */
export type Item = string | null

export interface GroupSceneInput {
  experimentId: string
  revision: number
  mathRevision: number
  groupId: string
  /** Display name of the group as stored ("C_{4}"). */
  groupLabel: string
  definition: GroupDefinition
  group: FiniteGroup
  /** Chronological operations since the last reset (at most 24). */
  history: readonly GroupStep[]
  /** The accumulated element k: product of the history (applying g, then h gives h·g). Bead x sits at slot k·x. */
  accumulated: string
  /** Chosen elements, e.g. composition operands A and B ("A, then B"). */
  operands: readonly [string | null, string | null]
  observation: Observation
  item: Item
  /** The operation the recipe's group_element port reads (the selected element), or null. */
  operation: string | null
  recipe: SceneRecipe<GroupOperation> | null
}

export interface BraidSceneInput {
  experimentId: string
  revision: number
  mathRevision: number
  /** The main word now. */
  word: readonly Generator[]
  /** The word the current rewrite sequence started from (equal to `word` when there are no rewrites). */
  origin: readonly Generator[]
  /** Checked rewrites taking `origin` to `word` (at most 24). */
  rewrites: readonly RewriteStep[]
  /** The comparison word, or null when none is shown. */
  compare: readonly Generator[] | null
  item: Item
  recipe: SceneRecipe<BraidOperation> | null
}

export interface WalkSceneInput {
  experimentId: string
  revision: number
  mathRevision: number
  /** The canonical inputs (vectors with identities, source order, signs); every walk is derived from them. */
  walk: WalkInput
  /** Trusted prepared lesson metadata (null for a plain vector walk). */
  lesson: 'steinitz-reordering' | null
  /** walk:source:<j>, walk:signed:<j>, walk:reordered:<k> (prefix lengths, 0..N) or walk:vector:<id>; null = none. */
  item: Item
  recipe: SceneRecipe<WalkOperation> | null
}

export type SceneInput =
  | { layout: 'sculpture' | 'cube' | 'quotient'; group: GroupSceneInput }
  | { layout: 'braid'; braid: BraidSceneInput }
  | { layout: 'walk'; walk: WalkSceneInput }

/** Alias kept for the registry's signature. */
export type AnySceneInput = SceneInput

/** Bounds of the new domains (handoff section 2: adjust deliberately, never truncate silently). */
export const DOMAIN_LIMITS = {
  groups: 6,
  history: 24,
  /** The sculpture shows one bead per element. */
  sculptureOrder: 8,
} as const
