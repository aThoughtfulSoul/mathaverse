// BraidScene under the UI shell (setPresentation, UI-REFINEMENT-SPEC sections 5, 9): the scene's own plates
// have no hit targets once the shell provides them, crossings stay selectable, and the exact span of the
// offered rewrite is highlighted before it is applied. Same Canvas2D stub as scene.test.ts (no WebGL).
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Group, Ray, Vector3 } from 'three'

vi.mock('../../src/rendering/glyphTokens', () => ({ tokenStats: { version: 0 }, compose: () => 'missing' }))
vi.mock('../../src/rendering/tex', () => ({
  peekTex: () => null,
  claimEntry: () => undefined,
  releaseEntry: () => undefined,
  texGeometry: () => new Promise(() => undefined),
}))

beforeAll(() => {
  ;(globalThis as Record<string, unknown>).document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ font: '', textBaseline: '', fillStyle: '', measureText: (t: string) => ({ width: t.length * 20 }), fillText: () => undefined }),
    }),
  }
})

const { BraidScene } = await import('../../src/domains/braid/scene')
const { FIXTURES, braidFixture } = await import('../../src/domains/braid/harness')
const { GEOMETRY } = await import('../../src/domains/braid/constants')

const rayAt = (x: number, y: number) => new Ray(new Vector3(x, y, 1), new Vector3(0, 0, -1))

function mounted() {
  const scene = new BraidScene()
  const bench = new Group()
  scene.mount(bench)
  bench.updateMatrixWorld(true)
  return scene
}

describe('BraidScene presentation', () => {
  it('under the shell the plates have no hit targets; crossings remain selectable', () => {
    const scene = mounted()
    scene.apply(FIXTURES.relationSelected!(), 'snap')
    scene.setPresentation({ inSceneControls: false, detailsOpen: false })
    expect(scene.pick(rayAt(-0.42, 0.195))).toBeNull()
    expect(scene.pick(rayAt(0.42, 0.195))).toBeNull()
    const y0 = 0.255 - (GEOMETRY.lead + GEOMETRY.pitchMax / 2)
    expect(scene.pick(rayAt(-0.15, y0))?.id).toBe('crossing:0')
    expect(scene.report()).toMatchObject({ presentation: { inSceneControls: false, platesVisible: 0 } })
    // A later commit keeps them hidden (option plates are rebuilt per description).
    scene.apply(FIXTURES.relationSelected!(), 'snap')
    expect(scene.pick(rayAt(0.42, 0.195))).toBeNull()
    scene.setPresentation({ inSceneControls: true, detailsOpen: false })
    expect(scene.pick(rayAt(0.42, 0.195))?.actions).toEqual([{ kind: 'rewrite_braid', experimentId: 'exp-braid', rule: 'braid_relation', at: 0, generator: null }])
    scene.dispose()
  })

  it('highlights the exact span of the offered rewrite at the selected crossing, and nothing without one', () => {
    const scene = mounted()
    scene.apply(FIXTURES.relationSelected!(), 'snap')
    expect(scene.report().highlightedSpan).toEqual({ at: 0, length: 3 })
    scene.apply(FIXTURES.cancel!(), 'snap')
    expect(scene.report().highlightedSpan).toEqual({ at: 0, length: 2 })
    // [1, -1, 1] at crossing 2 (index 1): the cancellation starting there, crossings 2-3.
    scene.apply(braidFixture({ word: [1, -1, 1], item: 'crossing:1' }), 'snap')
    expect(scene.report().highlightedSpan).toEqual({ at: 1, length: 2 })
    // A crossing with only an insertion available, and no selection: no span.
    scene.apply(braidFixture({ word: [1, 1], item: 'crossing:0' }), 'snap')
    expect(scene.report().highlightedSpan).toBeNull()
    scene.apply(FIXTURES.relation!(), 'snap')
    expect(scene.report().highlightedSpan).toBeNull()
    scene.dispose()
  })
})
