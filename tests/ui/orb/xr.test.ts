// The XR orb: one InstancedMesh (one draw call) of 122 camera-facing quads (backing, core glow, 120 glyphs from
// a glyph atlas), its own depth settings, stable uniforms (no per-frame objects), disposal of every GPU resource,
// and its place in the spatial shell: ONE fixed place in front of the viewer (SPATIAL_LAYOUT.orb: centred, below the
// scene box, in the hidden context panel's room, 25 cm across idle; a child of the shell's root, nothing left above
// the inspector's corner), shown only with the assistant inspector, animated from the shell's frame step. setPose
// takes the place at once; no phase, reduced motion or showing again ever moves it (the rest/stage glide is gone);
// bounds grow with the pose's scale.
// Node has no canvas: fake 2D contexts; TextSlot (MathJax) is replaced by an inert stand-in.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Box3, Group, InstancedMesh, Mesh, ShaderMaterial, Vector3, type InstancedBufferAttribute, type Object3D } from 'three'

vi.mock('../../../src/rendering/textSlot', () => ({
  TextSlot: class {
    anchor = new Group()
    width = 0
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
import { SpatialShell, SPATIAL_LAYOUT } from '../../../src/ui/shell/spatial'
import { FIXTURES } from '../../../src/ui/shell/fixtures'
import { createStubSpatialContent } from '../../../src/ui/shell/stubAssistant'
import {
  ORB_MESH_NAME, ORB_ROOT_NAME, XR_ORB, XR_ORB_EXTENT, XR_ORB_GLIDE_S, XR_ORB_RENDER_ORDER, XrOrb, setOrbCanvasFactory, type XrOrbPose,
} from '../../../src/ui/orb/xr'
import { PANEL_ORDER } from '../../../src/ui/shell/panel'
import { BLOOM_START_RADIUS, ORB_LOOKS } from '../../../src/ui/orb/motion'
import type { OrbSource } from '../../../src/ui/orb/source'
import type { OrbPhase } from '../../../src/ui/orb/state'
import type { FrameContext } from '../../../src/runtime/host'

let atlasText = 0
function fakeCanvas(): HTMLCanvasElement {
  let font = '10px sans-serif'
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop) {
      if (prop === 'measureText') return (t: string) => ({ width: t.length * Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) * 0.52 })
      if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => ({ addColorStop() {} })
      if (prop === 'font') return font
      if (prop === 'fillText') return () => void atlasText++
      if (prop in target) return target[prop as string]
      return () => undefined
    },
    set(target, prop, value) {
      if (prop === 'font') font = String(value)
      else target[prop as string] = value
      return true
    },
  })
  return { width: 300, height: 150, getContext: () => ctx } as unknown as HTMLCanvasElement
}

beforeAll(() => {
  setCanvasFactory(fakeCanvas)
  setOrbCanvasFactory(fakeCanvas)
})

const frame = (dt = 1 / 72): FrameContext => ({ time: 1, dt, frame: 1, presenting: true, xrFrame: null, head: new Vector3(0, 1.6, 0) })

function drawables(root: Object3D): Mesh[] {
  const out: Mesh[] = []
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh)
  })
  return out
}

/** Dispose events of the orb's GPU resources. */
function watchDisposal(orb: XrOrb) {
  const seen: string[] = []
  const mat = orb.mesh.material as ShaderMaterial
  orb.mesh.geometry.addEventListener('dispose', () => seen.push('geometry'))
  mat.addEventListener('dispose', () => seen.push('material'))
  ;(mat.uniforms.uAtlas!.value as { addEventListener(t: string, f: () => void): void }).addEventListener('dispose', () => seen.push('texture'))
  orb.mesh.addEventListener('dispose', () => seen.push('mesh'))
  return seen
}

describe('XR orb object', () => {
  it('is one instanced mesh of 122 quads: backing, core glow and 120 glyphs on the unit sphere', () => {
    atlasText = 0
    const orb = new XrOrb()
    expect(orb.root.name).toBe(ORB_ROOT_NAME)
    const meshes = drawables(orb.root)
    expect(meshes).toHaveLength(1) // one draw call
    const mesh = meshes[0]!
    expect(mesh).toBeInstanceOf(InstancedMesh)
    expect(mesh.name).toBe(ORB_MESH_NAME)
    expect((mesh as InstancedMesh).count).toBe(122)
    const info = mesh.geometry.getAttribute('aInfo') as InstancedBufferAttribute
    const base = mesh.geometry.getAttribute('aBase') as InstancedBufferAttribute
    expect(info.count).toBe(122)
    expect(base.count).toBe(122)
    const kinds = Array.from({ length: 122 }, (_, i) => info.getW(i))
    expect(kinds[0]).toBe(1) // backing first (drawn first)
    expect(kinds[1]).toBe(2) // core glow
    expect(kinds.filter((k) => k === 0)).toHaveLength(120)
    for (let i = 2; i < 122; i++) {
      expect(Math.hypot(base.getX(i), base.getY(i), base.getZ(i))).toBeCloseTo(1, 5)
      expect(info.getX(i)).toBeGreaterThanOrEqual(0)
      expect(info.getX(i)).toBeLessThan(40)
    }
    expect(atlasText).toBe(40) // the atlas holds the 40 glyphs once
    orb.dispose()
  })

  it('keeps its own depth settings: depth-tested, never depth-writing, transparent', () => {
    const orb = new XrOrb()
    const mat = orb.mesh.material as ShaderMaterial
    expect(mat).toBeInstanceOf(ShaderMaterial)
    expect(mat.userData.ownDepth).toBe(true)
    expect(mat.transparent).toBe(true)
    expect(mat.depthTest).toBe(true)
    expect(mat.depthWrite).toBe(false)
    expect(mat.fragmentShader).toContain('colorspace_fragment')
    orb.dispose()
  })

  it('bounds cover everything the shader draws (about 9-12 cm across)', () => {
    const orb = new XrOrb()
    const box = orb.mesh.geometry.boundingBox!
    expect(box.max.x).toBeGreaterThanOrEqual(XR_ORB.radius * BLOOM_START_RADIUS * 1.25 - 1e-9)
    expect(box.max.x).toBeLessThan(0.1)
    expect(2 * XR_ORB.radius).toBeGreaterThanOrEqual(0.09)
    expect(2 * XR_ORB.radius * 1.22 + XR_ORB.glyph).toBeLessThanOrEqual(0.12)
    orb.dispose()
  })

  it('a frame only writes numbers into the same uniform objects', () => {
    const orb = new XrOrb()
    const u = (orb.mesh.material as ShaderMaterial).uniforms
    const refs = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v]))
    const tint = u.uTint!.value
    const before = u.uAngle!.value as number
    for (let i = 0; i < 10; i++) orb.step(1 / 72, 'transcribing', 0)
    expect(u.uAngle!.value).not.toBe(before)
    expect(u.uTint!.value).toBe(tint)
    for (const [k, v] of Object.entries(u)) expect(v, k).toBe(refs[k])
    expect(orb.phase).toBe('transcribing')
    orb.dispose()
  })

  it('review finding: shown again (visible false to true) it snaps to the current phase on its first step', () => {
    const orb = new XrOrb()
    const u = (orb.mesh.material as ShaderMaterial).uniforms
    for (let i = 0; i < 144; i++) orb.step(1 / 72, 'thinking', 0)
    expect(u.uWave!.value).toBeGreaterThan(0.9)
    orb.setVisible(false)
    // Hidden: no steps while the request ended. Shown again in idle.
    orb.setVisible(true)
    orb.step(1 / 72, 'idle', 0)
    expect(u.uWave!.value).toBe(0)
    expect(u.uRadius!.value).toBe(ORB_LOOKS.idle.radius)
    const tint = u.uTint!.value as Vector3
    expect([tint.x, tint.y, tint.z].map((c) => Math.round(c * 255))).toEqual([...ORB_LOOKS.idle.tint])
    // Staying visible: no snap, it eases.
    orb.step(1 / 72, 'thinking', 0)
    expect(u.uWave!.value).toBeGreaterThan(0)
    expect(u.uWave!.value).toBeLessThan(0.2)
    orb.setVisible(true) // visible to visible is not a show
    orb.step(1 / 72, 'thinking', 0)
    expect(u.uWave!.value).toBeLessThan(0.3)
    orb.dispose()
  })

  it('shown again during a bloom: the applied look without the overshoot; setVisible with the phase snaps at once', () => {
    const orb = new XrOrb()
    const u = (orb.mesh.material as ShaderMaterial).uniforms
    for (let i = 0; i < 72; i++) orb.step(1 / 72, 'thinking', 0)
    orb.setVisible(false)
    orb.setVisible(true)
    orb.step(1 / 72, 'applied', 0)
    expect(u.uRadius!.value).toBe(ORB_LOOKS.applied.radius)
    orb.setVisible(false)
    orb.setVisible(true, 'error')
    expect(u.uBright!.value).toBe(ORB_LOOKS.error.bright)
    expect(u.uRadius!.value).toBe(ORB_LOOKS.error.radius)
    expect(orb.phase).toBe('error')
    orb.step(1 / 72, 'error', 0) // already snapped: the next step only eases (here: nothing to ease)
    expect(u.uBright!.value).toBe(ORB_LOOKS.error.bright)
    orb.dispose()
  })

  it('the first step snaps too (nothing was shown yet), and a bloom while shown still overshoots', () => {
    const orb = new XrOrb()
    const u = (orb.mesh.material as ShaderMaterial).uniforms
    orb.step(1 / 72, 'thinking', 0)
    expect(u.uWave!.value).toBe(ORB_LOOKS.thinking.wave)
    orb.step(1 / 72, 'applied', 0)
    expect(u.uRadius!.value).toBeGreaterThan(ORB_LOOKS.applied.radius + 0.1)
    orb.dispose()
  })

  it('disposes its geometry, material, atlas texture and mesh', () => {
    const parent = new Group()
    const orb = new XrOrb()
    parent.add(orb.root)
    const seen = watchDisposal(orb)
    orb.dispose()
    expect(seen.sort()).toEqual(['geometry', 'material', 'mesh', 'texture'])
    expect(orb.root.parent).toBeNull()
    orb.dispose() // idempotent
    expect(seen).toHaveLength(4)
  })
})

describe('XR orb pose (one fixed place)', () => {
  const FRONT: XrOrbPose = SPATIAL_LAYOUT.orb
  const DT = 1 / 72
  const PHASES: OrbPhase[] = ['idle', 'listening', 'transcribing', 'thinking', 'applied', 'error']

  const at = (orb: XrOrb, p: XrOrbPose) => {
    expect(orb.root.position.toArray()).toEqual([p.x, p.y, p.z])
    expect(orb.root.scale.toArray()).toEqual([p.scale, p.scale, p.scale])
  }

  it('the front place is about 25 cm across idle (9 cm at scale 1), 35 cm at the bloom start', () => {
    expect(2 * XR_ORB.radius * FRONT.scale).toBeGreaterThanOrEqual(0.245)
    expect(2 * XR_ORB.radius * FRONT.scale).toBeLessThanOrEqual(0.255)
    expect(2 * XR_ORB.radius * BLOOM_START_RADIUS * FRONT.scale).toBeGreaterThanOrEqual(0.34)
    expect(2 * XR_ORB.radius * BLOOM_START_RADIUS * FRONT.scale).toBeLessThanOrEqual(0.36)
  })

  it('setPose takes the place at once, and no phase, bloom or reduced motion ever moves it (no glide)', () => {
    const orb = new XrOrb()
    orb.setPose(FRONT)
    at(orb, FRONT)
    for (const reduced of [false, true]) {
      for (const phase of PHASES) {
        for (let i = 0; i < 60; i++) {
          orb.step(DT, phase, 0.4, reduced, phase === 'applied' ? 'r1' : null)
          at(orb, FRONT)
        }
      }
    }
    expect(XR_ORB_GLIDE_S).toBe(0) // deprecated: nothing glides
    expect('place' in orb).toBe(false)
    expect('moving' in orb).toBe(false)
    orb.dispose()
  })

  it('shown again it keeps its place (only the look snaps)', () => {
    const orb = new XrOrb()
    orb.setPose(FRONT)
    for (let i = 0; i < 72; i++) orb.step(DT, 'thinking', 0)
    orb.setVisible(false)
    orb.setVisible(true, 'idle', null)
    at(orb, FRONT)
    orb.step(DT, 'listening', 0.5)
    at(orb, FRONT)
    orb.dispose()
  })

  it("bounds grow with the pose's scale: the measured box covers everything drawn at the front size", () => {
    const parent = new Group()
    parent.position.set(0.3, 1.1, -0.6)
    const orb = new XrOrb()
    parent.add(orb.root)
    orb.setPose(FRONT)
    orb.step(DT, 'applied', 0, false, null)
    parent.updateMatrixWorld(true)
    const c = orb.root.getWorldPosition(new Vector3())
    // The farthest thing drawn: the core glow at the bloom's start, at the front scale.
    const drawn = XR_ORB.radius * BLOOM_START_RADIUS * 1.25 * FRONT.scale
    const box = new Box3().setFromObject(orb.root)
    for (const k of ['x', 'y', 'z'] as const) {
      expect(c[k] - box.min[k]).toBeGreaterThanOrEqual(drawn - 1e-9)
      expect(box.max[k] - c[k]).toBeGreaterThanOrEqual(drawn - 1e-9)
      expect(box.max[k] - c[k]).toBeCloseTo(XR_ORB_EXTENT * FRONT.scale, 9)
    }
    orb.mesh.computeBoundingSphere()
    const sphere = orb.mesh.boundingSphere!.clone().applyMatrix4(orb.mesh.matrixWorld)
    expect(sphere.center.distanceTo(c)).toBeLessThan(1e-9)
    expect(sphere.radius).toBeGreaterThanOrEqual(drawn)
    orb.dispose()
  })

  it('draws after the panels and their content, before the controller rays (a nearer panel hides it by depth)', () => {
    const orb = new XrOrb()
    expect(orb.mesh.renderOrder).toBe(XR_ORB_RENDER_ORDER)
    expect(XR_ORB_RENDER_ORDER).toBeGreaterThan(PANEL_ORDER + 1) // panel plates and hover overlay
    expect(XR_ORB_RENDER_ORDER).toBeGreaterThan(7) // assistant backing 4, words 5, text slots up to 7
    expect(XR_ORB_RENDER_ORDER).toBeLessThan(20) // controller rays and cursors (src/runtime/input.ts)
    orb.dispose()
  })
})

function source(phase: OrbPhase = 'idle') {
  let calls = 0
  const s: OrbSource & { set(p: OrbPhase): void; readonly calls: number } = {
    phase: () => {
      calls++
      return phase
    },
    level: () => 0.5,
    set: (p) => void (phase = p),
    get calls() {
      return calls
    },
  }
  return s
}

function find(root: Object3D, name: string): Object3D {
  let out: Object3D | undefined
  root.traverse((o) => {
    if (o.name === name) out = o
  })
  return out!
}

function mounted(fixture: string, src: OrbSource | null = source()) {
  const shell = new SpatialShell({ dispatch: () => undefined, assistant: createStubSpatialContent(), orb: src })
  const bench = new Group()
  bench.position.set(0, 1.02, -0.8)
  shell.mount(bench)
  shell.setVisible(true)
  shell.render(FIXTURES[fixture]!.view('xr'))
  bench.updateMatrixWorld(true)
  let orbRoot: Object3D | undefined
  bench.traverse((o) => {
    if (o.name === ORB_ROOT_NAME) orbRoot = o
  })
  return { shell, bench, orbRoot }
}

describe('XR orb in the spatial shell', () => {
  it('sits at its one front place: centred, below the scene box, toward the viewer; nothing above the inspector', () => {
    const { bench, orbRoot, shell } = mounted('sculpture')
    expect(orbRoot).toBeDefined()
    expect(orbRoot!.parent).toBe(shell.root) // bench-local, not in the inspector area
    expect(orbRoot!.visible).toBe(true)
    let inInspector = 0
    find(bench, 'shell:inspector-area').traverse((o) => void (o.name.startsWith('shell:orb') && inInspector++))
    expect(inInspector).toBe(0) // the small orb above the side panel's corner is gone
    // Bench coordinates: centred, its whole extent below the scene box (x +-0.5, y -0.24..0.32, z -0.25..0.15),
    // nearer the viewer than the box's middle.
    const c = bench.worldToLocal(orbRoot!.getWorldPosition(new Vector3()))
    expect(c.x).toBeCloseTo(0, 9)
    expect(c.y + XR_ORB_EXTENT * SPATIAL_LAYOUT.orb.scale).toBeLessThan(-0.24)
    expect(c.z).toBeGreaterThan(-0.05)
    expect(shell.report().orb).toMatchObject({ place: 'front', scale: SPATIAL_LAYOUT.orb.scale })
    expect(shell.report().orb!.across.idle).toBeCloseTo(2 * XR_ORB.radius * SPATIAL_LAYOUT.orb.scale, 4)
    // With it shown the context panel is hidden (its room) and the toolbar sits at its place for the assistant.
    expect(shell.report().context).toMatchObject({ opacity: 0, pickable: false })
    expect(shell.report().lowered).toMatchObject({ at: 1, to: 1 })
  })

  it('is shown only with the assistant inspector, and only while the shell is visible', () => {
    expect(mounted('sculpture').orbRoot!.visible).toBe(true)
    expect(mounted('sculpture-closed').orbRoot!.visible).toBe(false)
    expect(mounted('sculpture-math').orbRoot!.visible).toBe(false)
    const { shell, orbRoot } = mounted('sculpture')
    shell.setVisible(false)
    expect(orbRoot!.visible).toBe(false)
    shell.setVisible(true)
    expect(orbRoot!.visible).toBe(true)
    expect(shell.report().orb).toMatchObject({ visible: true, phase: 'idle', place: 'front', scale: SPATIAL_LAYOUT.orb.scale })
  })

  it('animates from the shell frame step with the real phase, and reads nothing while hidden', () => {
    const src = source('thinking')
    const { shell } = mounted('sculpture', src)
    expect(src.calls).toBe(1) // shown by render(): the current phase, read once to snap to it
    expect(shell.report().orb!.phase).toBe('thinking')
    shell.step(frame())
    expect(src.calls).toBe(2)
    shell.render(FIXTURES['sculpture-closed']!.view('xr'))
    shell.step(frame())
    expect(src.calls).toBe(2)
  })

  it('review finding: closing the inspector mid-thinking and reopening it later shows the current phase at once', () => {
    const src = source('thinking')
    const { shell, bench } = mounted('sculpture', src)
    let mesh: InstancedMesh | undefined
    bench.traverse((o) => {
      if (o.name === ORB_MESH_NAME) mesh = o as InstancedMesh
    })
    const u = (mesh!.material as ShaderMaterial).uniforms
    for (let i = 0; i < 144; i++) shell.step(frame())
    expect(u.uWave!.value).toBeGreaterThan(0.9)
    shell.render(FIXTURES['sculpture-closed']!.view('xr')) // the inspector closed: hidden, not stepped
    src.set('idle') // the request ended meanwhile
    shell.render(FIXTURES['sculpture']!.view('xr'))
    shell.step(frame())
    expect(u.uWave!.value).toBe(0)
    expect(shell.report().orb).toMatchObject({ visible: true, phase: 'idle', place: 'front' })
    // The same through the shell's own visibility (leaving and re-entering XR).
    src.set('thinking')
    for (let i = 0; i < 144; i++) shell.step(frame())
    shell.setVisible(false)
    src.set('error')
    shell.setVisible(true)
    shell.step(frame())
    expect(u.uWave!.value).toBe(0)
    expect(u.uBright!.value).toBe(ORB_LOOKS.error.bright)
    shell.dispose()
  })

  it('no orb without a source (the existing shell is unchanged)', () => {
    const { orbRoot, shell } = mounted('sculpture', null)
    expect(orbRoot).toBeUndefined()
    expect(shell.report().orb).toBeNull()
  })

  it('is disposed with the shell', () => {
    const { shell, bench } = mounted('sculpture')
    let orb: InstancedMesh | undefined
    bench.traverse((o) => {
      if (o.name === ORB_MESH_NAME) orb = o as InstancedMesh
    })
    const seen: string[] = []
    orb!.geometry.addEventListener('dispose', () => seen.push('geometry'))
    ;(orb!.material as ShaderMaterial).addEventListener('dispose', () => seen.push('material'))
    shell.dispose()
    expect(seen.sort()).toEqual(['geometry', 'material'])
  })
})
