// Where the validated document meets the four demonstrations' derivations and scenes (FOUR-DEMOS handoff
// section 2). sceneInputFor resolves the displayed group or braid experiment into exact scene inputs (the
// accumulated element, the selected operation, the bound recipe's operations); layout modules are registered
// once (src/domains/all.ts) and looked up by layout. Linear experiments keep the existing deriveView path.

import { type Doc, findAnyExperiment, findGroup, findRecipe, groupFor, walkInputOf } from '../workspace/document'
import { chronologicalProduct } from '../algebra/groups'
import { layoutOf } from '../recipes/recipe'
import type { AnySceneInput, BraidOperation, BraidSceneInput, GroupOperation, GroupSceneInput, SceneInput, SceneLayout, WalkOperation, WalkSceneInput } from './inputs'
import type { DomainScene } from './scene'

export interface LayoutModule<I, D> {
  derive(input: I): D
  create(): DomainScene<D>
}

type AnyModule = LayoutModule<GroupSceneInput, unknown> | LayoutModule<BraidSceneInput, unknown> | LayoutModule<WalkSceneInput, unknown>
const modules = new Map<SceneLayout, AnyModule>()

export function registerLayout(layout: 'sculpture' | 'cube' | 'quotient', mod: LayoutModule<GroupSceneInput, unknown>): void
export function registerLayout(layout: 'braid', mod: LayoutModule<BraidSceneInput, unknown>): void
export function registerLayout(layout: 'walk', mod: LayoutModule<WalkSceneInput, unknown>): void
export function registerLayout(layout: SceneLayout, mod: AnyModule): void {
  modules.set(layout, mod)
}

export function registeredLayouts(): SceneLayout[] {
  return [...modules.keys()]
}

/** Derive the description of a scene input with its registered module (null when none is registered). */
export function deriveScene(input: AnySceneInput): { layout: SceneLayout; desc: unknown; create: () => DomainScene<unknown> } | null {
  const mod = modules.get(input.layout)
  if (!mod) return null
  const desc = input.layout === 'braid' ? (mod as LayoutModule<BraidSceneInput, unknown>).derive(input.braid) : input.layout === 'walk' ? (mod as LayoutModule<WalkSceneInput, unknown>).derive(input.walk) : (mod as LayoutModule<GroupSceneInput, unknown>).derive(input.group)
  return { layout: input.layout, desc, create: () => mod.create() }
}

/** The displayed group, braid or vector-walk experiment as exact scene input; null for a linear experiment. */
export function sceneInputFor(doc: Doc): SceneInput | null {
  const e = findAnyExperiment(doc, doc.selection.experimentId)
  if (e.domain === 'linear') return null
  const recipe = e.binding ? findRecipe(doc, e.binding.recipeId) : null
  const item = doc.selection.item
  if (e.domain === 'group') {
    const def = findGroup(doc, e.groupId)
    const group = groupFor(doc, e)
    const layout = recipe ? layoutOf(recipe) : null
    const scene: 'sculpture' | 'cube' | 'quotient' = layout === 'cube_diagonals' ? 'cube' : layout === 'quotient_classes' ? 'quotient' : layout === 'regular_action' ? 'sculpture' : def.definition.kind === 'cube_rotations' ? 'cube' : 'sculpture'
    const input: GroupSceneInput = {
      experimentId: e.id,
      revision: doc.revision,
      mathRevision: doc.mathRevision,
      groupId: def.id,
      groupLabel: def.label,
      definition: def.definition,
      group,
      history: e.history,
      accumulated: chronologicalProduct(group, e.history.map((h) => h.element)),
      operands: e.operands,
      observation: e.observation,
      item,
      operation: item !== null && group.has(item) ? item : null,
      recipe: recipe ? { id: recipe.id, name: recipe.name, operations: recipe.operations.filter((o): o is GroupOperation => ['regular_action', 'cycle_trails', 'element_orders', 'cube_diagonals', 'quotient_classes'].includes(o.kind)) } : null,
    }
    return { layout: scene, group: input }
  }
  if (e.domain === 'vector_walk') {
    const input: WalkSceneInput = {
      experimentId: e.id,
      revision: doc.revision,
      mathRevision: doc.mathRevision,
      walk: walkInputOf(e),
      lesson: e.lesson,
      item,
      recipe: recipe ? { id: recipe.id, name: recipe.name, operations: recipe.operations.filter((o): o is WalkOperation => o.kind === 'walk_reordering' || o.kind === 'walk_bounds' || o.kind === 'prefix_correspondence') } : null,
    }
    return { layout: 'walk', walk: input }
  }
  const input: BraidSceneInput = {
    experimentId: e.id,
    revision: doc.revision,
    mathRevision: doc.mathRevision,
    word: e.word,
    origin: e.origin,
    rewrites: e.rewrites,
    compare: e.compare,
    item,
    recipe: recipe ? { id: recipe.id, name: recipe.name, operations: recipe.operations.filter((o): o is BraidOperation => o.kind === 'braid_diagram' || o.kind === 'braid_invariants') } : null,
  }
  return { layout: 'braid', braid: input }
}
