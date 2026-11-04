// CubeScene under the UI shell (setPresentation): the rotation cards have no hit targets once the shell
// provides them, the diagonal objects stay pickable, formal readouts move to the inspector, and with one
// diagonal selected the hovered swap partner is highlighted too (both identities). Canvas2D stub, no WebGL.
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
  const ctx = { font: '', textBaseline: '', fillStyle: '', measureText: (t: string) => ({ width: t.length * 20 }), fillText: () => undefined, fillRect: () => undefined }
  ;(globalThis as Record<string, unknown>).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
})

const { CubeScene } = await import('../../src/domains/cube/scene')
const harness = (await import('../../src/domains/cube/harness')).default

const toward = (x: number, y: number, z: number) => new Ray(new Vector3(x, y, z + 1), new Vector3(0, 0, -1))

describe('CubeScene presentation', () => {
  it('cards lose their hit targets under the shell; objects stay pickable; readouts leave the stage', () => {
    const scene = new CubeScene()
    const bench = new Group()
    scene.mount(bench)
    bench.updateMatrixWorld(true)
    scene.apply(harness.fixtures.rz!(), 'snap')
    // The first card (R_x) sits at (-0.25, -0.205, 0.06) in the scene frame.
    expect(scene.pick(toward(-0.25, -0.205, 0.06))?.id).toBe('card:rx')
    scene.setPresentation({ inSceneControls: false, detailsOpen: false })
    expect(scene.pick(toward(-0.25, -0.205, 0.06))).toBeNull()
    expect(scene.report().readoutsVisible).toMatchObject({ state: false, phi: false, word: false })
    // The formal readouts live in the mathematics inspector under the shell, open or not.
    scene.setPresentation({ inSceneControls: false, detailsOpen: true })
    expect(scene.report().readoutsVisible).toMatchObject({ state: false, phi: false, word: false })
    scene.setPresentation({ inSceneControls: true, detailsOpen: false })
    expect(scene.report().readoutsVisible).toMatchObject({ state: true, phi: true, word: true })
    scene.setPresentation({ inSceneControls: false, detailsOpen: false })
    // Object 0's token on the rail is still pickable (its slot is phi(Rz)[0] = 1).
    const r = scene.report() as { tokens: number[][] }
    const t0 = r.tokens[0]!
    expect(scene.pick(toward(t0[0]!, t0[1]!, t0[2]!))?.id).toBe('token:0')
    scene.dispose()
  })

  it('with a first diagonal selected, hovering a second highlights both identities', () => {
    const scene = new CubeScene()
    scene.mount(new Group())
    scene.apply(harness.fixtures.rz_select0!(), 'snap')
    scene.setPresentation({ inSceneControls: false, detailsOpen: false })
    expect(scene.report().highlighted).toEqual([0])
    scene.setHover('token:2')
    expect(scene.report().highlighted).toEqual([0, 2])
    scene.setHover(null)
    expect(scene.report().highlighted).toEqual([0])
    scene.dispose()
  })
})
