// XR content depth inside the real spatial shell: the backing and the button plates write depth and keep it
// (userData.ownDepth, which the adapter's per-frame depth policy skips), everything is depth-tested so a shell
// popover in front covers it, and the layers sit in front of the shell's inspector frame plate in order
// (frame, backing, plates). Node has no canvas: shell panels get a fake 2D context; TextSlot is an inert stand-in.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Group, Mesh, type MeshBasicMaterial, Vector3 } from 'three'

vi.mock('../../../src/rendering/textSlot', () => ({
  TextSlot: class {
    anchor = new Group()
    width = 0
    wantedKey = null
    set() {}
    frame() {}
    setWanted() {}
    dispose() {}
    report() {
      return {}
    }
  },
}))

import { setCanvasFactory } from '../../../src/ui/shell/panel'
import { SpatialShell } from '../../../src/ui/shell/spatial'
import { FIXTURES } from '../../../src/ui/shell/fixtures'
import { createAssistantSpatialContent } from '../../../src/ui/assistant/spatial'

function fakeCanvas(): HTMLCanvasElement {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 10 * 0.52 })
      if (prop === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (prop in target) return target[prop as string]
      return () => undefined
    },
    set(target, prop, value) {
      target[prop as string] = value
      return true
    },
  })
  return { width: 300, height: 150, getContext: () => ctx } as unknown as HTMLCanvasElement
}

beforeAll(() => setCanvasFactory(fakeCanvas))

function mounted(fixture: string) {
  const shell = new SpatialShell({ dispatch: () => undefined, assistant: createAssistantSpatialContent(() => undefined) })
  const bench = new Group()
  bench.position.set(0, 1.02, -0.8)
  shell.mount(bench)
  shell.setVisible(true)
  shell.render(FIXTURES[fixture]!.view('xr'))
  bench.updateMatrixWorld(true)
  const meshes: Mesh[] = []
  bench.traverse((o) => {
    if (o instanceof Mesh && o.visible) meshes.push(o)
  })
  const named = (n: string) => meshes.find((m) => m.name === n)!
  const plates = meshes.filter((m) => m.name.startsWith('assistant:') && m.name !== 'assistant:backing')
  return { frame: named('shell:inspector:plate'), backing: named('assistant:backing'), plates }
}

describe('assistant XR content depth', () => {
  it('the backing and the button plates write depth and keep it; all of it is depth-tested', () => {
    const { backing, plates } = mounted('picker')
    expect(plates.length).toBeGreaterThan(0)
    for (const m of [backing, ...plates]) {
      const mat = m.material as MeshBasicMaterial
      expect(mat.depthTest, m.name).toBe(true)
      expect(mat.depthWrite, m.name).toBe(true)
      expect(mat.userData.ownDepth, m.name).toBe(true)
    }
  })

  it('layers in front of the inspector frame plate: frame, then backing, then button plates', () => {
    const { frame, backing, plates } = mounted('sculpture')
    const normal = new Vector3(0, 0, 1).transformDirection(frame.matrixWorld)
    const at = (m: Mesh) => m.getWorldPosition(new Vector3()).sub(frame.getWorldPosition(new Vector3())).dot(normal)
    expect(at(backing)).toBeGreaterThan(0.0005)
    for (const p of plates) expect(at(p) - at(backing), p.name).toBeGreaterThan(0.0005)
  })
})
