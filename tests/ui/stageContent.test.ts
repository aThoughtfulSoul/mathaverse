// Desktop framing measures what the workbench draws: instanced meshes by their instances, hidden and excluded
// subtrees not at all.

import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera } from 'three'
import { measureStageContent } from '../../src/runtime/stageContent'

function camera(): PerspectiveCamera {
  const c = new PerspectiveCamera(40, 1.6, 0.01, 100)
  c.position.set(0, 0, 1)
  c.lookAt(0, 0, 0)
  return c
}

describe('stage content extent', () => {
  it('measures an instanced mesh by its instances, not its unit-scale geometry', () => {
    const root = new Group()
    // A 1 m cube geometry drawn as two 4 cm instances at x = -0.1 and x = +0.1.
    const cubes = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2)
    cubes.setMatrixAt(0, new Matrix4().makeScale(0.04, 0.04, 0.04).setPosition(-0.1, 0, 0))
    cubes.setMatrixAt(1, new Matrix4().makeScale(0.04, 0.04, 0.04).setPosition(0.1, 0, 0))
    root.add(cubes)
    const c = measureStageContent(root, camera())!
    // Half-width 0.12 m at about 1 m: tangents near ±0.12, far from the ±0.5 a unit cube would give.
    expect(c.x1).toBeGreaterThan(0.11)
    expect(c.x1).toBeLessThan(0.14)
    expect(c.x0).toBeCloseTo(-c.x1, 6)
    expect(c.y1).toBeLessThan(0.03)
  })

  it('leaves out hidden and excluded subtrees', () => {
    const root = new Group()
    const mesh = (x: number, name = '') => {
      const m = new Mesh(new BoxGeometry(0.02, 0.02, 0.02), new MeshBasicMaterial())
      m.position.x = x
      m.name = name
      return m
    }
    root.add(mesh(0))
    const hidden = mesh(0.5)
    hidden.visible = false
    root.add(hidden, mesh(-0.5, 'shell'))
    const c = measureStageContent(root, camera(), new Set(['shell']))!
    expect(c.x1).toBeLessThan(0.02)
    expect(c.x0).toBeGreaterThan(-0.02)
    expect(measureStageContent(new Group(), camera())).toBeNull()
  })
})
