// Registers the four algebra demonstrations' and the proof lesson's derivations and scenes with the registry (src/domains/registry.ts).
// Each track exports derive<Name> and <Name>Scene from src/domains/<track>/index.ts (docs/INTERFACES.md).
// Tracks load independently: a track that is missing or fails to load is reported, and the app then says that
// scene is not in this build instead of showing anything invented; the other demonstrations keep working.

import { registerLayout, type LayoutModule } from './registry'
import type { BraidSceneInput, GroupSceneInput, SceneLayout, WalkSceneInput } from './inputs'
import type { DomainScene } from './scene'

const TRACKS: { layout: SceneLayout; file: string; derive: string; scene: string }[] = [
  { layout: 'sculpture', file: './sculpture/index.ts', derive: 'deriveSculpture', scene: 'SculptureScene' },
  { layout: 'cube', file: './cube/index.ts', derive: 'deriveCube', scene: 'CubeScene' },
  { layout: 'quotient', file: './quotient/index.ts', derive: 'deriveQuotient', scene: 'QuotientScene' },
  { layout: 'braid', file: './braid/index.ts', derive: 'deriveBraid', scene: 'BraidScene' },
  { layout: 'walk', file: './walk/index.ts', derive: 'deriveWalkScene', scene: 'WalkScene' },
]

const loaders = import.meta.glob<Record<string, unknown>>('./*/index.ts')

/** Load and register every available track. Returns one problem line per track that is not registered. */
export async function registerAll(): Promise<string[]> {
  const problems: string[] = []
  await Promise.all(TRACKS.map(async (t) => {
    const load = loaders[t.file]
    if (!load) return void problems.push(`${t.layout}: not in this build`)
    try {
      const m = await load()
      const derive = m[t.derive]
      const Scene = m[t.scene]
      if (typeof derive !== 'function' || typeof Scene !== 'function') return void problems.push(`${t.layout}: ${t.file} does not export ${t.derive} and ${t.scene}`)
      const mod = { derive: derive as (i: never) => unknown, create: () => new (Scene as new () => DomainScene<unknown>)() }
      if (t.layout === 'braid') registerLayout('braid', mod as LayoutModule<BraidSceneInput, unknown>)
      else if (t.layout === 'walk') registerLayout('walk', mod as LayoutModule<WalkSceneInput, unknown>)
      else registerLayout(t.layout, mod as LayoutModule<GroupSceneInput, unknown>)
    } catch (e) {
      problems.push(`${t.layout}: failed to load (${(e as Error).message.slice(0, 160)})`)
    }
  }))
  return problems
}
