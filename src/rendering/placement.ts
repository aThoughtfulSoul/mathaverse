// Display embedding and view placement (MATHEMATICAL-CONTRACT M2). Mathematics is z-up; the runtime is
// y-up. A view shows v at t + s R E_d(v): the view root Group carries t, R and s, and children sit at
// E_d(v) in the root's local frame. Placement never touches the matrix or the committed coordinates.

import { Group, Vector3, Quaternion, type Object3D } from 'three'

/** E_3(x, y, z) = (x, z, -y): right-handed z-up -> y-up. E_2(x, y) = (x, y, 0). */
export function embed(v: readonly number[], out = new Vector3()): Vector3 {
  if (v.length === 2) return out.set(v[0]!, v[1]!, 0)
  return out.set(v[0]!, v[2]!, -v[1]!)
}

/** Inverse of E_d for pointer input in a view's local frame. Display-precision floats only. */
export function unembed(p: Vector3, d: 2 | 3): number[] {
  return d === 2 ? [p.x, p.y] : [p.x, -p.z, p.y]
}

export interface ViewPlacement {
  position: Vector3
  quaternion: Quaternion
  /** Uniform positive scale, metres per mathematical unit. */
  scale: number
}

export function createViewRoot(name: string, placement: ViewPlacement): Group {
  if (!(placement.scale > 0)) throw new Error('view scale must be positive')
  const g = new Group()
  g.name = name
  g.position.copy(placement.position)
  g.quaternion.copy(placement.quaternion)
  g.scale.setScalar(placement.scale)
  return g
}

/** World point -> mathematical preview coordinates of the view whose root is `root`. */
export function worldToMath(root: Object3D, world: Vector3, d: 2 | 3): number[] {
  return unembed(root.worldToLocal(world.clone()), d)
}
