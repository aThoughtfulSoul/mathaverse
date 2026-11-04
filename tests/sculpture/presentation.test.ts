// SculptureScene selection vs execution (UI-REFINEMENT-SPEC section 5) and its presentation hook: a card press
// only ever selects (the selected card applies nothing), and under the UI shell the scene's own cards and
// plates have no hit targets. Canvas2D stub as in tests/braid/scene.test.ts (no WebGL).
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Group, Ray, Vector3, type Mesh } from 'three'

vi.mock('../../src/rendering/glyphTokens', () => ({ tokenStats: { version: 0 }, compose: () => 'missing' }))
vi.mock('../../src/rendering/tex', () => ({
  peekTex: () => null,
  claimEntry: () => undefined,
  releaseEntry: () => undefined,
  texGeometry: () => new Promise(() => undefined),
}))

beforeAll(() => {
  const ctx = {
    font: '', textBaseline: '', fillStyle: '',
    measureText: (t: string) => ({ width: t.length * 20 }),
    fillText: () => undefined,
    fillRect: () => undefined,
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  }
  ;(globalThis as Record<string, unknown>).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
})

const { SculptureScene } = await import('../../src/domains/sculpture/scene')
const harness = (await import('../../src/domains/sculpture/harness')).default

type Scene = InstanceType<typeof SculptureScene>

function mounted(): Scene {
  const scene = new SculptureScene()
  const bench = new Group()
  scene.mount(bench)
  bench.updateMatrixWorld(true)
  return scene
}

/** A ray from the viewer straight at the hit target of card `element`. */
function rayAtCard(scene: Scene, element: string): Ray {
  const built = (scene as unknown as { built: { cards: { element: string; hit: Mesh }[] } }).built
  const hit = built.cards.find((c) => c.element === element)!.hit
  hit.updateWorldMatrix(true, false)
  const at = hit.getWorldPosition(new Vector3())
  const from = at.clone().add(new Vector3(0, 0, 1))
  return new Ray(from, at.clone().sub(from).normalize())
}

describe('SculptureScene cards', () => {
  it('a card press selects; pressing the selected card applies nothing', () => {
    const scene = mounted()
    scene.apply(harness.fixtures['c4-selected']!(), 'snap')
    const other = scene.pick(rayAtCard(scene, 'c2'))!
    expect(other.actions).toEqual([{ kind: 'select_item', experimentId: 'exp-c4', item: 'c2' }])
    const same = scene.pick(rayAtCard(scene, 'c1'))!
    expect(same.id).toBe('card:c1')
    expect(same.actions).toEqual([])
    scene.dispose()
  })

  it('under the shell the cards and plates have no hit targets; the status never calls moving beads home', () => {
    const scene = mounted()
    scene.apply(harness.fixtures['c4-selected']!(), 'snap')
    const ray = rayAtCard(scene, 'c2')
    scene.setPresentation({ inSceneControls: false, detailsOpen: false })
    expect(scene.pick(ray)).toBeNull()
    expect((scene.report().presentation as { pickables: number }).pickables).toBe(0)
    // A rebuild (another group) keeps them hidden.
    scene.apply(harness.fixtures['v4-selected']!(), 'snap')
    expect((scene.report().presentation as { pickables: number }).pickables).toBe(0)
    // Four applications of 1 return home; while the last move is shown the status names the target.
    scene.apply(harness.fixtures['c4-3']!(), 'snap')
    scene.apply(harness.fixtures['c4-4']!(), 'animate')
    scene.step({ time: 0.2, dt: 0.2, frame: 1, presenting: false, xrFrame: null, head: new Vector3(0, 0.2, 1.2) })
    expect(scene.playback().active).toBe(true)
    expect(scene.status()).not.toMatch(/is home/)
    expect(scene.status()).toContain('showing the move to k = 0')
    scene.setPlayback('finish')
    scene.step({ time: 0.3, dt: 0.1, frame: 2, presenting: false, xrFrame: null, head: new Vector3(0, 0.2, 1.2) })
    expect(scene.status()).toMatch(/home/)
    scene.setPresentation({ inSceneControls: true, detailsOpen: false })
    expect((scene.report().presentation as { pickables: number }).pickables).toBeGreaterThan(0)
    scene.dispose()
  })
})
