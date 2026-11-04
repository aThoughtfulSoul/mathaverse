// Shared projection helpers for the spatial shell's layout tests. The default head pose of scripts/ui-capture.sh
// (world (0, 1.6, 0.42), level, 14 degrees down) and its two eyes (63 mm apart, src/runtime/emulator.ts), each a
// 90-degree square view (IWER's vertical field of view; a 2000 x 1000 capture gives each eye exactly this), on the
// bench where the app puts it ((0, 1.02, -0.8)). Outlines are compared on each eye's image plane (NDC): a shell
// plate's is the rounded rect CanvasPanel.plate draws (its radius plus half the stroke; the material's alphaTest
// discards the transparent corners), recorded by recordPlates(); the assistant orb's is orbOutline(); the stage
// content's is STAGE_CONTENT (measured in IWER); separation() gives two convex outlines' distance apart, or minus their
// overlap's depth.

import { vi } from 'vitest'
import { PerspectiveCamera, Vector3, type Object3D } from 'three'
import { XR_ORB } from '../../../src/ui/orb/xr'
import { CanvasPanel } from '../../../src/ui/shell/panel'

export type P2 = [number, number]

export function eye(x: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(90, 1, 0.05, 100)
  cam.position.set(x, 1.6, 0.42) // level: the eyes sit along world x
  cam.rotation.set((-14 * Math.PI) / 180, 0, 0, 'YXZ')
  cam.updateMatrixWorld(true)
  return cam
}

export const HEAD = eye(0)
export const EYES: [string, PerspectiveCamera][] = [['left eye', eye(-0.0315)], ['right eye', eye(0.0315)]]
export const CORNERS: P2[] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]

/** The scene box (bench-local): x +-0.5, y -0.24..0.32, z -0.25..0.15. */
export const SCENE_BOX = { x: [-0.5, 0.5], y: [-0.24, 0.32], z: [-0.25, 0.15] } as const

/**
 * The stage content of each demonstration as each eye of the default head pose sees it: the convex hull (NDC, rounded
 * to 0.001) of the bounding boxes of every visible mesh, line and text under the bench except the shell, the controls
 * and the passthrough backdrop, measured in IWER on 2026-11-02 (the app's first view of each experiment, the
 * assistant open; the same as measured before that day's earlier layout change). pq's reaches lowest (NDC y -0.416,
 * just above the scene box's lower edge at about -0.434); the others end at -0.38 (proof) or higher.
 */
export const STAGE_CONTENT: Record<string, { L: P2[]; R: P2[] }> = {
  sculpture: {
    L: [[-0.18, -0.111], [-0.18, -0.122], [-0.176, -0.15], [-0.157, -0.233], [-0.132, -0.308], [0.05, -0.308], [0.078, -0.233], [0.101, -0.149], [0.103, -0.121], [0.103, -0.111], [0.101, -0.085], [0.073, -0.007], [-0.007, 0.018], [-0.033, 0.024], [-0.04, 0.024], [-0.068, 0.018], [-0.147, -0.007], [-0.179, -0.086]],
    R: [[-0.226, -0.111], [-0.226, -0.122], [-0.222, -0.15], [-0.203, -0.233], [-0.18, -0.308], [0.001, -0.308], [0.031, -0.233], [0.055, -0.149], [0.057, -0.121], [0.057, -0.111], [0.056, -0.085], [0.029, -0.007], [-0.051, 0.018], [-0.078, 0.024], [-0.084, 0.024], [-0.112, 0.018], [-0.191, -0.007], [-0.199, -0.023], [-0.224, -0.086]],
  },
  pq: {
    L: [[-0.35, 0.076], [-0.349, 0.06], [-0.284, -0.326], [-0.13, -0.416], [0.3, -0.351], [0.444, -0.302], [0.446, -0.287], [0.39, -0.178], [0.317, -0.124], [0.263, -0.087], [-0.16, 0.085]],
    R: [[-0.402, 0.076], [-0.401, 0.06], [-0.335, -0.326], [-0.174, -0.416], [0.251, -0.351], [0.389, -0.302], [0.391, -0.287], [0.34, -0.178], [0.271, -0.124], [0.213, -0.087], [-0.209, 0.085]],
  },
  order: {
    L: [[-0.336, -0.215], [-0.323, -0.293], [0.37, -0.297], [0.415, -0.225], [0.416, -0.217], [0.345, -0.028], [0.093, 0.047], [-0.041, 0.047], [-0.295, -0.028], [-0.331, -0.132]],
    R: [[-0.385, -0.215], [-0.372, -0.293], [0.321, -0.297], [0.366, -0.225], [0.367, -0.217], [0.295, -0.028], [0.041, 0.047], [-0.093, 0.047], [-0.346, -0.028], [-0.379, -0.132]],
  },
  cube: {
    L: [[-0.237, -0.067], [-0.225, -0.223], [-0.212, -0.286], [-0.201, -0.306], [-0.044, -0.306], [0.321, -0.212], [0.332, -0.187], [0.332, -0.184], [0.328, -0.146], [0.317, -0.125], [-0.048, -0.018], [-0.073, -0.018], [-0.236, -0.052]],
    R: [[-0.284, -0.067], [-0.271, -0.223], [-0.259, -0.286], [-0.249, -0.306], [-0.092, -0.306], [0.273, -0.212], [0.284, -0.187], [0.284, -0.184], [0.28, -0.146], [0.268, -0.125], [-0.093, -0.018], [-0.118, -0.018], [-0.283, -0.052]],
  },
  quotient: {
    L: [[-0.368, -0.057], [-0.329, -0.219], [0.077, -0.219], [0.212, -0.009], [0.212, 0.003], [-0.162, 0.003], [-0.345, -0.004], [-0.367, -0.051]],
    R: [[-0.419, -0.057], [-0.377, -0.219], [0.029, -0.219], [0.162, -0.009], [0.162, 0.003], [-0.212, 0.003], [-0.396, -0.004], [-0.418, -0.051]],
  },
  braid: {
    L: [[-0.159, -0.071], [-0.159, -0.352], [0.204, -0.352], [0.199, -0.012], [0.186, 0.01], [0.169, 0.025], [0.121, 0.026], [-0.084, 0.026], [-0.106, 0.025], [-0.136, 0.01], [-0.148, -0.011], [-0.149, -0.012]],
    R: [[-0.208, -0.071], [-0.204, -0.352], [0.159, -0.352], [0.149, -0.012], [0.148, -0.011], [0.136, 0.01], [0.119, 0.025], [0.071, 0.026], [-0.135, 0.026], [-0.156, 0.025], [-0.186, 0.01], [-0.199, -0.012]],
  },
  proof: {
    L: [[-0.319, -0.016], [-0.318, -0.038], [-0.269, -0.376], [0.129, -0.352], [0.153, -0.048], [0.153, -0.029], [0.107, 0.03], [-0.268, 0.022]],
    R: [[-0.368, -0.016], [-0.366, -0.038], [-0.317, -0.376], [0.083, -0.352], [0.107, -0.048], [0.107, -0.029], [0.064, 0.03], [-0.313, 0.022]],
  },
}

/**
 * The assistant orb's drawn outline on an eye's image plane (NDC) at `radius` x XR_ORB.radius (a look's sphere
 * radius, scaled by the orb root's world scale): the glyph sphere's exact silhouette (the rim of the eye's tangent
 * cone) grown by view-aligned glyph quads of the shader's front-facing size (1.1 x XR_ORB.glyph) centred on the rim;
 * the larger quads nearer the eye and the dark backing lie inside it.
 */
export function orbOutline(cam: PerspectiveCamera, root: Object3D, radius: number): P2[] {
  const scale = root.getWorldScale(new Vector3()).x
  const R = XR_ORB.radius * radius * scale
  const c = root.getWorldPosition(new Vector3()).applyMatrix4(cam.matrixWorldInverse)
  // The rim: a circle square to the line of sight through the centre, a little nearer the eye.
  const k = 1 - (R * R) / c.lengthSq()
  const m = c.clone().multiplyScalar(k)
  const rim = R * Math.sqrt(k)
  const u = new Vector3(0, 1, 0).cross(c).normalize()
  const w = c.clone().cross(u).normalize()
  const q = XR_ORB.glyph * 1.1 * scale
  const pts: P2[] = []
  const p = new Vector3()
  for (let i = 0; i < 180; i++) {
    const a = (i * Math.PI) / 90
    for (const [x, y] of CORNERS) {
      p.copy(m).addScaledVector(u, rim * Math.cos(a)).addScaledVector(w, rim * Math.sin(a))
      p.x += x * q
      p.y += y * q
      p.applyMatrix4(cam.projectionMatrix)
      pts.push([p.x, p.y])
    }
  }
  return hull(pts)
}

/** Convex hull, counter-clockwise (monotone chain). */
export function hull(pts: P2[]): P2[] {
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const chain = (seq: P2[]) => {
    const out: P2[] = []
    for (const p of seq) {
      while (out.length > 1) {
        const [ox, oy] = out[out.length - 2]!
        const [ax, ay] = out[out.length - 1]!
        if ((ax - ox) * (p[1] - oy) - (ay - oy) * (p[0] - ox) > 0) break
        out.pop()
      }
      out.push(p)
    }
    return out.slice(0, -1)
  }
  return [...chain(sorted), ...chain([...sorted].reverse())]
}

export const area = (P: P2[]) => Math.abs(P.reduce((a, [x, y], i) => a + x * P[(i + 1) % P.length]![1] - P[(i + 1) % P.length]![0] * y, 0)) / 2

/** Separation of two convex polygons: their distance apart, or minus their overlap's depth (separating axes). */
export function separation(A: P2[], B: P2[]): number {
  let depth = -Infinity
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (let i = 0; i < P.length; i++) {
      const [ax, ay] = P[i]!
      const [bx, by] = P[(i + 1) % P.length]!
      const l = Math.hypot(bx - ax, by - ay)
      if (l === 0) continue
      const span = (S: P2[]) => {
        let lo = Infinity
        let hi = -Infinity
        for (const [x, y] of S) {
          const d = (x * (by - ay) + y * (ax - bx)) / l
          lo = Math.min(lo, d)
          hi = Math.max(hi, d)
        }
        return [lo, hi] as const
      }
      const [p0, p1] = span(P)
      const [q0, q1] = span(Q)
      depth = Math.max(depth, q0 - p1, p0 - q1)
    }
  }
  if (depth <= 0) return depth
  // Apart: the nearest points are a vertex of one and an edge of the other.
  let gap = Infinity
  for (const [P, Q] of [[A, B], [B, A]]) {
    for (const [px, py] of P) {
      for (let i = 0; i < Q.length; i++) {
        const [ax, ay] = Q[i]!
        const [bx, by] = Q[(i + 1) % Q.length]!
        const ex = bx - ax
        const ey = by - ay
        const k = ex || ey ? Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey))) : 0
        gap = Math.min(gap, Math.hypot(px - ax - k * ex, py - ay - k * ey))
      }
    }
  }
  return gap
}

type Drawn = { x: number; y: number; w: number; h: number; r: number; line: number; width: number; height: number }

/** What CanvasPanel.plate drew on each plate mesh (its rounded rect, panel metres, y down, and stroke width).
 * Call from beforeAll; restore() in afterAll. */
export function recordPlates(): { drawn: Map<Object3D, Drawn>; restore(): void } {
  const drawn = new Map<Object3D, Drawn>()
  const plate = CanvasPanel.prototype.plate
  const spy = vi.spyOn(CanvasPanel.prototype, 'plate').mockImplementation(function (this: CanvasPanel, p, opts) {
    const rrect = vi.spyOn(p, 'rrect')
    plate.call(this, p, opts)
    const [x, y, w, h, r, , , line = 0.0012] = rrect.mock.calls[0]!
    rrect.mockRestore()
    drawn.set(this.mesh, { x, y, w, h, r: Math.min(r, w / 2, h / 2), line, width: this.width, height: this.height })
  })
  return { drawn, restore: () => spy.mockRestore() }
}

/** A plate's drawn outline in its mesh's plane (the unit quad, centred): the rounded rect plus half its stroke. */
export function plateOutline(drawn: Map<Object3D, Drawn>, o: Object3D): Vector3[] {
  const d = drawn.get(o)
  if (!d) throw new Error(`${o.name} was not drawn by CanvasPanel.plate`)
  const R = d.r + d.line / 2
  const centres = [[d.x + d.w - d.r, d.y + d.r], [d.x + d.w - d.r, d.y + d.h - d.r], [d.x + d.r, d.y + d.h - d.r], [d.x + d.r, d.y + d.r]] as const
  const out: Vector3[] = []
  centres.forEach(([cx, cy], i) => {
    for (let k = 0; k <= 8; k++) {
      const a = ((i - 1 + k / 8) * Math.PI) / 2
      out.push(new Vector3((cx + R * Math.cos(a)) / d.width - 0.5, 0.5 - (cy + R * Math.sin(a)) / d.height, 0))
    }
  })
  return out
}

/** Local points of an object, projected to an eye's NDC. */
export function project(o: Object3D, local: Vector3[], cam: PerspectiveCamera): P2[] {
  return local.map((pt): P2 => {
    const q = o.localToWorld(pt.clone()).project(cam)
    return [q.x, q.y]
  })
}

/** The scene box's outline on an eye's image plane (the hull of its eight projected corners). */
export function sceneBoxOutline(bench: Object3D, cam: PerspectiveCamera): P2[] {
  const pts: P2[] = []
  for (const x of SCENE_BOX.x) for (const y of SCENE_BOX.y) for (const z of SCENE_BOX.z) pts.push(project(bench, [new Vector3(x, y, z)], cam)[0]!)
  return hull(pts)
}

/** The visible plate mesh `${name}:plate` under root (null when it or an ancestor is hidden). */
export function shownPlate(root: Object3D, name: string): Object3D | null {
  let out: Object3D | null = null
  root.traverse((o) => {
    if (o.name !== `${name}:plate`) return
    for (let p: Object3D | null = o; p; p = p.parent) if (!p.visible) return
    out = o
  })
  return out
}
