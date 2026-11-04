// Desktop framing (host.setStageContent): the extent of what a workbench draws, as tangents of the angles from a
// camera's axis (x right, y up). Every visible mesh, line and point set counts, by the corners of its geometry's
// bounding box where it is drawn; an instanced mesh by each instance. Named subtrees can be left out.

import { Matrix4, Vector3, type BufferGeometry, type Camera, type Object3D } from 'three'
import type { StageContent } from './host'

export function measureStageContent(root: Object3D, camera: Camera, exclude: ReadonlySet<string> = new Set()): StageContent | null {
  camera.updateMatrixWorld()
  root.updateMatrixWorld(true)
  const view = camera.matrixWorldInverse
  const m = new Matrix4()
  const mi = new Matrix4()
  const ma = new Matrix4()
  const p = new Vector3()
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  const visit = (o: Object3D) => {
    if (!o.visible || exclude.has(o.name)) return
    const g = (o as { geometry?: BufferGeometry }).geometry
    const drawable = o as { isMesh?: boolean; isLine?: boolean; isPoints?: boolean }
    if (g && (drawable.isMesh || drawable.isLine || drawable.isPoints)) {
      if (!g.boundingBox) g.computeBoundingBox()
      const b = g.boundingBox!
      const corners = (mm: Matrix4) => {
        for (let i = 0; i < 8; i++) {
          p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(mm)
          if (p.z > -0.05) continue // behind or at the camera: not part of the framed view
          const tx = p.x / -p.z
          const ty = p.y / -p.z
          x0 = Math.min(x0, tx)
          x1 = Math.max(x1, tx)
          y0 = Math.min(y0, ty)
          y1 = Math.max(y1, ty)
        }
      }
      if (!b.isEmpty()) {
        m.multiplyMatrices(view, o.matrixWorld)
        // An instanced mesh's geometry is one instance at unit scale: measure each instance where it is drawn.
        const inst = o as { isInstancedMesh?: boolean; count?: number; getMatrixAt?(i: number, out: Matrix4): Matrix4 }
        if (inst.isInstancedMesh && inst.getMatrixAt) {
          for (let k = 0; k < (inst.count ?? 0); k++) corners(mi.multiplyMatrices(m, inst.getMatrixAt(k, ma)))
        } else corners(m)
      }
    }
    for (const c of o.children) visit(c)
  }
  visit(root)
  return x0 < x1 && y0 < y1 ? { x0, x1, y0, y1 } : null
}
