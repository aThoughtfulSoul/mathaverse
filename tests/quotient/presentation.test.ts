// QuotientScene under the UI shell (setPresentation): its plates (observation, Choose as A / B, Another A / B)
// are hidden and have no hit targets once the shell provides them; the scene title gives way to the shell's
// question while the legend (the observation key) and the composition panel stay. Canvas2D stub, no WebGL.
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

const { QuotientScene } = await import('../../src/domains/quotient/scene')
const { QLAYOUT } = await import('../../src/domains/quotient/derive')
const harness = (await import('../../src/domains/quotient/harness')).default

const plateRay = (i: number) => new Ray(new Vector3(QLAYOUT.platesX[i]!, QLAYOUT.platesY, 1.05), new Vector3(0, 0, -1))
const wanted = (scene: InstanceType<typeof QuotientScene>, id: string) => (scene.report().slots as { id: string; wanted?: boolean; visible?: boolean }[]).find((s) => s.id === id)

describe('QuotientScene presentation', () => {
  it('plates have no hit targets under the shell; the composition panel stays', () => {
    const scene = new QuotientScene()
    const bench = new Group()
    scene.mount(bench)
    bench.updateMatrixWorld(true)
    scene.apply(harness.fixtures.compose!(), 'snap')
    expect(scene.pick(plateRay(0))?.id).toBe('plate:observe')
    scene.setPresentation({ inSceneControls: false, detailsOpen: false })
    for (let i = 0; i < 5; i++) expect(scene.pick(plateRay(i))?.id ?? '').not.toMatch(/^plate:/)
    expect(scene.report().presentation).toMatchObject({ inSceneControls: false, plates: 0 })
    expect(wanted(scene, 'q:title')).toMatchObject({ visible: false })
    expect(wanted(scene, 'q:detail')).toMatchObject({ visible: true })
    scene.setPresentation({ inSceneControls: true, detailsOpen: false })
    expect(scene.pick(plateRay(0))?.id).toBe('plate:observe')
    scene.dispose()
  })
})
