// Presentation helpers shared by the cube and quotient scenes (worker B). Only three.js math and geometry:
// no text, no document access, importable by the Node tests. Nothing here carries algebraic meaning; the
// exact elements come from src/algebra and arrive in the scene descriptions.

import {
  BufferGeometry, Color, Float32BufferAttribute, Matrix4, Path, Quaternion, Shape, ShapeGeometry, Vector3, type Object3D, type Ray,
} from 'three'

/** Rows of a 3x3 matrix with entries -1, 0, 1 (an exact cube rotation). */
export type Mat3 = readonly (readonly number[])[]

/**
 * D = E M E^T, the display-frame matrix of a mathematical rotation M under E3(x, y, z) = (x, z, -y).
 * E is itself a rotation (det +1), so D is a rotation by the same angle about E3(axis).
 */
export function displayMatrix(m: Mat3): number[][] {
  // (E v) = (v0, v2, -v1); E^T w = (w0, -w2, w1).
  const E = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
  const mul = (a: Mat3, b: Mat3) => a.map((row) => [0, 1, 2].map((j) => row[0]! * b[0]![j]! + row[1]! * b[1]![j]! + row[2]! * b[2]![j]!))
  const ET = [0, 1, 2].map((i) => [0, 1, 2].map((j) => E[j]![i]!))
  return mul(mul(E, m), ET).map((r) => r.map((v) => (Object.is(v, -0) ? 0 : v)))
}

const m4 = new Matrix4()

/** The display quaternion of an exact rotation matrix (used for committed endpoints only). */
export function displayQuaternion(m: Mat3, out = new Quaternion()): Quaternion {
  const d = displayMatrix(m)
  m4.set(d[0]![0]!, d[0]![1]!, d[0]![2]!, 0, d[1]![0]!, d[1]![1]!, d[1]![2]!, 0, d[2]![0]!, d[2]![1]!, d[2]![2]!, 0, 0, 0, 0, 1)
  return out.setFromRotationMatrix(m4)
}

/** E3 of a mathematical vector (display coordinates). */
export function displayVector(v: readonly number[], scale = 1, out = new Vector3()): Vector3 {
  return out.set(v[0]! * scale, v[2]! * scale, -v[1]! * scale)
}

/** Rodrigues: the rotation matrix about a unit axis by an angle (mathematical frame, floats). */
export function axisAngleMatrix(axis: readonly number[], angle: number): number[][] {
  const [x, y, z] = axis as [number, number, number]
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ]
}

/** Smooth ease in/out (quintic smootherstep): zero velocity and acceleration at both ends. */
export function ease(t: number): number {
  const u = t <= 0 ? 0 : t >= 1 ? 1 : t
  return u * u * u * (u * (u * 6 - 15) + 10)
}

export const clamp01 = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t)

/** A unit rounded rectangle (1 x 1, corner radius r in the same units), centred, facing +z. */
export function roundedRect(w: number, h: number, r: number, segments = 6): BufferGeometry {
  const s = new Shape()
  const x = -w / 2
  const y = -h / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return new ShapeGeometry(s, segments)
}

/** A rounded-rectangle outline band of width `band` (a frame), centred, facing +z. */
export function roundedFrame(w: number, h: number, r: number, band: number, segments = 6): BufferGeometry {
  const trace = (p: Path, W: number, H: number, R: number) => {
    const x = -W / 2
    const y = -H / 2
    p.moveTo(x + R, y)
    p.lineTo(x + W - R, y)
    p.quadraticCurveTo(x + W, y, x + W, y + R)
    p.lineTo(x + W, y + H - R)
    p.quadraticCurveTo(x + W, y + H, x + W - R, y + H)
    p.lineTo(x + R, y + H)
    p.quadraticCurveTo(x, y + H, x, y + H - R)
    p.lineTo(x, y + R)
    p.quadraticCurveTo(x, y, x + R, y)
  }
  const outer = new Shape()
  trace(outer, w, h, r)
  const hole = new Path()
  trace(hole, w - 2 * band, h - 2 * band, Math.max(0.0001, r - band))
  outer.holes.push(hole)
  return new ShapeGeometry(outer, segments)
}

/** Paint every vertex of a geometry one sRGB colour (converted to the linear working space, as three does
 * for material colours), for merged, vertex-coloured meshes. */
export function paint(g: BufferGeometry, color: number): BufferGeometry {
  const n = g.getAttribute('position').count
  const c = new Color().setHex(color)
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r
    a[i * 3 + 1] = c.g
    a[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new Float32BufferAttribute(a, 3))
  return g
}

// ------------------------------------------------------------------ picking (no allocation per call)

const inv = new Matrix4()
const local = new Vector3()
const dir = new Vector3()
const hit = new Vector3()
const tmpA = new Vector3()

/** Distance along a (world) ray to a sphere, or null. */
export function raySphere(ray: Ray, center: Vector3, radius: number): number | null {
  tmpA.subVectors(center, ray.origin)
  const tca = tmpA.dot(ray.direction)
  const d2 = tmpA.lengthSq() - tca * tca
  const r2 = radius * radius
  if (d2 > r2) return null
  const thc = Math.sqrt(r2 - d2)
  const t0 = tca - thc
  const t1 = tca + thc
  if (t1 < 0) return null
  return t0 >= 0 ? t0 : t1
}

/** Distance along a (world) ray to an object's local z = 0 rectangle |x| <= hw, |y| <= hh, or null. */
export function rayPlate(ray: Ray, obj: Object3D, hw: number, hh: number): number | null {
  inv.copy(obj.matrixWorld).invert()
  local.copy(ray.origin).applyMatrix4(inv)
  dir.copy(ray.direction).transformDirection(inv)
  if (Math.abs(dir.z) < 1e-9) return null
  // transformDirection normalises; recover the parameter through the world hit point.
  const t = -local.z / dir.z
  if (t < 0) return null
  const x = local.x + dir.x * t
  const y = local.y + dir.y * t
  if (Math.abs(x) > hw || Math.abs(y) > hh) return null
  hit.set(x, y, 0).applyMatrix4(obj.matrixWorld)
  return hit.distanceTo(ray.origin)
}

/** Closest approach of a world ray to the world segment a-b: the distance along the ray, or null if the
 * ray passes farther than `radius` from the segment. */
export function raySegment(ray: Ray, a: Vector3, b: Vector3, radius: number): number | null {
  const d2 = ray.distanceSqToSegment(a, b, hit, undefined)
  if (d2 > radius * radius) return null
  const t = hit.sub(ray.origin).dot(ray.direction)
  return t >= 0 ? t : null
}

/** Mix two 0xRRGGBB colours (t = 0 gives a). */
export function mixHex(a: number, b: number, t: number): number {
  const ch = (c: number, s: number) => (c >> s) & 255
  const m = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t)
  return (m(16) << 16) | (m(8) << 8) | m(0)
}

/** The presentation pose of a 3D view (yaw about display up, then pitch toward the viewer). A whole-view
 * viewing angle like the adapter's yawed views; it carries no algebraic meaning. */
export function viewPose(yaw: number, pitch: number, out = new Quaternion()): Quaternion {
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch)
  return out.copy(qx).multiply(qy)
}

/** Orient `target` parallel to the plane facing the head from `origin` (both world space): a row of plates
 * stays a flat row instead of each one turning on its own (which skews wide plates at the view's edges). */
export function faceToward(target: Object3D, origin: Object3D, head: Vector3, pivot: Object3D): void {
  origin.getWorldPosition(tmpA)
  pivot.position.copy(tmpA)
  pivot.lookAt(head)
  target.quaternion.copy(pivot.quaternion)
  if (target.parent) {
    target.parent.getWorldQuaternion(pq).invert()
    target.quaternion.premultiply(pq)
  }
}
const pq = new Quaternion()

/**
 * One shared billboard orientation for a set of labels under `parent`: the orientation facing the head from
 * `parent`'s origin, in `parent`'s local frame. Labels sharing it stay parallel (long lines do not slant at
 * the edges of a perspective view); both eyes use the same orientation (stereo-safe). No allocation.
 */
export function sharedFacing(parent: Object3D, head: Vector3, pivot: Object3D, out: Quaternion): Quaternion {
  parent.getWorldPosition(tmpA)
  pivot.position.copy(tmpA)
  pivot.lookAt(head)
  parent.getWorldQuaternion(pq).invert()
  return out.copy(pq).multiply(pivot.quaternion)
}
