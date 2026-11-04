// DEV harness module for the proof-lesson walk scene (src/dev/harness.ts):
//   http://localhost:3010/harness.html?domain=walk&fixture=hero-why-3
// Fixtures are built from the prepared exact inputs (src/lessons/steinitz/cases.ts) through deriveWalkScene; each
// also names the lesson stage (presentation state, shown through the real setStage API) and whether Show
// mathematics is open. onPick simulates the planner for select_item by deriving again with the new item.
// Scripted helpers (captures): window.__walkStage(stage, 'animate'|'snap'), window.__walkDetails(open),
// window.__walkFlip(occurrenceId) (a sign edit, re-derived and applied with 'animate'), window.__walkSelect(item).

import type { HarnessModule } from '../../dev/harness'
import type { ScenePick, SceneTransition } from '../scene'
import type { WalkOperation, WalkSceneInput, WalkStage, SceneRecipe } from '../inputs'
import type { Sign, WalkInput } from '../../algebra/walk'
import { CASES, type CaseId } from '../../lessons/steinitz/cases'
import { deriveWalkScene, type WalkDesc } from './derive'
import { WalkScene } from './scene'

/** The prepared lesson rule (walk_reordering with bounds and prefix correspondence). */
const RECIPE: SceneRecipe<WalkOperation> = {
  id: 'recipe-walk',
  name: 'Reordering lesson',
  operations: [
    { kind: 'walk_reordering', walk: 'walk' },
    { kind: 'walk_bounds', walk: 'walk' },
    { kind: 'prefix_correspondence', walk: 'walk' },
  ],
}

let revision = 0
const inputs = new WeakMap<WalkDesc, WalkSceneInput>()

function derive(walk: WalkInput, item: string | null, recipe: SceneRecipe<WalkOperation> | null = RECIPE): WalkDesc {
  revision++
  const input: WalkSceneInput = { experimentId: 'exp-walk', revision, mathRevision: revision, walk, lesson: 'steinitz-reordering', item, recipe }
  const d = deriveWalkScene(input)
  inputs.set(d, input)
  return d
}

/** What a fixture shows besides its description. */
let pending: { stage: WalkStage; details: boolean } | null = null

function fixture(c: CaseId, stage: WalkStage, item: string | null = null, details = false, recipe: SceneRecipe<WalkOperation> | null = RECIPE): () => WalkDesc {
  return () => {
    pending = { stage, details }
    return derive(CASES[c].input, item, recipe)
  }
}

const fixtures: Record<string, () => WalkDesc> = {
  'hero-walk': fixture('hero', 'walk'),
  'hero-walk-select-u6': fixture('hero', 'walk', 'walk:source:6', true),
  'hero-signs': fixture('hero', 'signs'),
  'hero-reorder': fixture('hero', 'reorder'),
  'hero-why-none': fixture('hero', 'why'),
  'hero-why-3': fixture('hero', 'why', 'walk:reordered:3'),
  'hero-why-3-details': fixture('hero', 'why', 'walk:reordered:3', true),
  'hero-why-9': fixture('hero', 'why', 'walk:reordered:9'),
  'hero-why-9-details': fixture('hero', 'why', 'walk:reordered:9', true),
  'hero-assumptions': fixture('hero', 'assumptions'),
  'all-positive-reorder': fixture('all-positive', 'reorder'),
  'all-positive-why-6': fixture('all-positive', 'why', 'walk:reordered:6'),
  'line-six-walk': fixture('line-six', 'walk'),
  'line-six-reorder': fixture('line-six', 'reorder'),
  'line-six-why': fixture('line-six', 'why', 'walk:reordered:2'),
  'line-six-why-neg': fixture('line-six', 'why', 'walk:reordered:5'),
  'open-two-walk': fixture('open-two', 'walk'),
  'open-two-assumptions': fixture('open-two', 'assumptions'),
  'open-two-why-2': fixture('open-two', 'why', 'walk:reordered:2', true),
  'hero-plain-rule': fixture('hero', 'reorder', null, false, { id: 'recipe-plain', name: 'Walk only', operations: [{ kind: 'walk_reordering', walk: 'walk' }] }),
}

/** The harness applies fixtures through scene.apply only; this wrapper then shows the fixture's stage. */
class HarnessWalkScene extends WalkScene {
  override apply(desc: WalkDesc, transition: SceneTransition): void {
    super.apply(desc, transition)
    if (pending) {
      const p = pending
      pending = null
      this.setPresentation({ inSceneControls: true, detailsOpen: p.details })
      this.setStage(p.stage, transition)
    }
  }
}

type W = typeof window & {
  __walkStage?: (s: WalkStage, t?: SceneTransition) => void
  __walkDetails?: (open: boolean) => void
  __walkFlip?: (id: string) => void
  __walkSelect?: (item: string | null) => void
  __walkScene?: WalkScene
  __harness?: { current(): unknown; apply(d: unknown, t: SceneTransition): void }
}

function edited(current: WalkDesc, change: (i: WalkSceneInput) => WalkSceneInput): WalkDesc | null {
  const input = inputs.get(current)
  if (!input) return null
  revision++
  const next = change({ ...input, revision, mathRevision: revision })
  const d = deriveWalkScene(next)
  inputs.set(d, next)
  return d
}

function onPick(pick: ScenePick, current: WalkDesc): WalkDesc | null {
  const action = pick.actions[0] as { kind: string; item?: string | null } | undefined
  if (!action || action.kind !== 'select_item') return null
  return edited(current, (i) => ({ ...i, item: action.item ?? null }))
}

const harness: HarnessModule<WalkDesc> = {
  title: 'Proof lesson · vector walk',
  create: () => {
    const scene = new HarnessWalkScene()
    const w = window as W
    w.__walkScene = scene
    w.__walkStage = (s, t = 'animate') => scene.setStage(s, t)
    w.__walkDetails = (open) => scene.setPresentation({ inSceneControls: true, detailsOpen: open })
    w.__walkSelect = (item) => {
      const cur = w.__harness?.current() as WalkDesc | undefined
      const next = cur && edited(cur, (i) => ({ ...i, item }))
      if (next) w.__harness!.apply(next, 'animate')
    }
    w.__walkFlip = (id) => {
      const cur = w.__harness?.current() as WalkDesc | undefined
      const next =
        cur &&
        edited(cur, (i) => {
          const at = i.walk.vectors.findIndex((v) => v.id === id)
          return { ...i, walk: { ...i.walk, signs: i.walk.signs.map((s, k) => (k === at ? (-s as Sign) : s)) } }
        })
      if (next) w.__harness!.apply(next, 'animate')
    }
    return scene
  },
  fixtures,
  onPick,
}

export default harness
