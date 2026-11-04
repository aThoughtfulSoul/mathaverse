// Tube meshes along sampled strand centerlines, rebuilt in place (fixed-capacity buffers, no allocation per
// update). The ring frame uses the reference axis +z: N = normalize(T x z), B = T x N. A strand's tangent
// always has a longitudinal component (y), so T is never parallel to z and the frame never degenerates or
// twists.

import { BackSide, BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Sphere, Vector3, type Material } from 'three'

export class Tube {
  readonly mesh: Mesh
  readonly geometry = new BufferGeometry()
  private readonly pos: Float32Array
  private readonly nrm: Float32Array
  private readonly cos: Float32Array
  private readonly sin: Float32Array

  constructor(readonly capacity: number, readonly radial: number, material: Material, bounds: Sphere) {
    this.pos = new Float32Array(capacity * radial * 3)
    this.nrm = new Float32Array(capacity * radial * 3)
    this.cos = new Float32Array(radial)
    this.sin = new Float32Array(radial)
    for (let k = 0; k < radial; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / radial)
      this.sin[k] = Math.sin((2 * Math.PI * k) / radial)
    }
    const idx = new Uint16Array((capacity - 1) * radial * 6)
    let w = 0
    for (let m = 0; m < capacity - 1; m++) {
      for (let k = 0; k < radial; k++) {
        const a = m * radial + k
        const b = m * radial + ((k + 1) % radial)
        const c = a + radial
        const d = b + radial
        // Outward-facing: (b - a) x (c - a) = B x T = N at angle 0.
        idx[w++] = a
        idx[w++] = b
        idx[w++] = c
        idx[w++] = b
        idx[w++] = d
        idx[w++] = c
      }
    }
    const posAttr = new BufferAttribute(this.pos, 3)
    const nrmAttr = new BufferAttribute(this.nrm, 3)
    posAttr.setUsage(35048) // DynamicDrawUsage
    nrmAttr.setUsage(35048)
    this.geometry.setAttribute('position', posAttr)
    this.geometry.setAttribute('normal', nrmAttr)
    this.geometry.setIndex(new BufferAttribute(idx, 1))
    this.geometry.boundingSphere = bounds
    this.mesh = new Mesh(this.geometry, material)
  }

  /**
   * Rebuild the first `count` rings from centers[offset + 3m ..] (m = 0..count-1) with radius r. A count
   * below 2 hides the tube.
   */
  update(centers: Float32Array, offset: number, count: number, r: number): void {
    const R = this.radial
    const n = Math.min(count, this.capacity)
    this.mesh.visible = n >= 2
    if (n < 2) return
    const P = this.pos
    const N = this.nrm
    for (let m = 0; m < n; m++) {
      const i0 = offset + Math.max(0, m - 1) * 3
      const i1 = offset + Math.min(n - 1, m + 1) * 3
      let tx = centers[i1]! - centers[i0]!
      let ty = centers[i1 + 1]! - centers[i0 + 1]!
      let tz = centers[i1 + 2]! - centers[i0 + 2]!
      let l = Math.hypot(tx, ty, tz) || 1
      tx /= l
      ty /= l
      tz /= l
      // N = T x (0, 0, 1) = (ty, -tx, 0)
      let nx = ty
      let ny = -tx
      l = Math.hypot(nx, ny) || 1
      nx /= l
      ny /= l
      // B = T x N
      const bx = -tz * ny
      const by = tz * nx
      const bz = tx * ny - ty * nx
      const c = offset + m * 3
      const cx = centers[c]!
      const cy = centers[c + 1]!
      const cz = centers[c + 2]!
      for (let k = 0; k < R; k++) {
        const co = this.cos[k]!
        const si = this.sin[k]!
        const dx = co * nx + si * bx
        const dy = co * ny + si * by
        const dz = si * bz
        const v = (m * R + k) * 3
        N[v] = dx
        N[v + 1] = dy
        N[v + 2] = dz
        P[v] = cx + r * dx
        P[v + 1] = cy + r * dy
        P[v + 2] = cz + r * dz
      }
    }
    const pa = this.geometry.getAttribute('position') as BufferAttribute
    const na = this.geometry.getAttribute('normal') as BufferAttribute
    pa.clearUpdateRanges()
    na.clearUpdateRanges()
    pa.addUpdateRange(0, n * R * 3)
    na.addUpdateRange(0, n * R * 3)
    pa.needsUpdate = true
    na.needsUpdate = true
    this.geometry.setDrawRange(0, (n - 1) * R * 6)
  }

  /** A dark back-face hull sharing this tube's geometry (see gapMaterial). */
  outline(material: Material): Mesh {
    const m = new Mesh(this.geometry, material)
    m.name = `${this.mesh.name}:gap`
    return m
  }

  dispose(): void {
    this.geometry.dispose()
    this.mesh.removeFromParent()
  }
}

/**
 * The knot-diagram "gap": back faces of a hull `width` larger than the tube, in the background colour. The
 * over strand's hull lies between it and the under strand (width < depth gap - 2r), so the under strand
 * shows a clean break where it passes behind; elsewhere the hull is a faint rim. The vertex shader pushes
 * each vertex along its (unit, radial) normal; the geometry is shared, so it costs one draw call per tube.
 */
export function gapMaterial(color: number, width: number): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ color, side: BackSide })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.gapWidth = { value: width }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float gapWidth;')
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3( position ) + normal * gapWidth;')
  }
  m.customProgramCacheKey = () => `braid-gap-${width}`
  return m
}

/** Bounds of a braid's tubes in braid-local coordinates (fixed: no per-frame bounding computation). */
export function braidBounds(length: number): Sphere {
  return new Sphere(new Vector3(0, -length / 2, 0), length / 2 + 0.1)
}
