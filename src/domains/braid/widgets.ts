// Small scene-geometry widgets of the braid scene: rounded plates (buttons and highlight lanes) and the
// TextSlot content helpers. Plates face +z in the scene root; picking is analytic (scene.ts), so a plate
// never needs to be raycast.

import { Mesh, MeshBasicMaterial, Shape, ShapeGeometry, type BufferGeometry } from 'three'
import { TextSlot, type SlotContent } from '../../rendering/textSlot'
import { palette } from '../../ui/palette'

/** A unit rounded rectangle centred at the origin (scale it to size). */
export function roundedRect(w: number, h: number, r: number): BufferGeometry {
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
  return new ShapeGeometry(s, 5)
}

export const tex = (t: string, em: number, color: number, plain: string): SlotContent => ({ kind: 'tex', parts: [{ tex: t }], em, color, plain })
export const plain = (text: string, em: number, color: number): SlotContent => ({ kind: 'plain', em, color, plain: text })

/** A pressable plate with a label. Its pick rectangle is (x, y, w, h) at depth z in the scene root. */
export class Plate {
  readonly mesh: Mesh
  readonly label: TextSlot
  hover = false
  enabled = true
  actions: unknown[] = []
  hint = ''
  private shownKey = ''

  constructor(readonly id: string, public x: number, public y: number, readonly w: number, readonly h: number, readonly z = 0) {
    this.mesh = new Mesh(roundedRect(w, h, Math.min(w, h) * 0.28), new MeshBasicMaterial({ color: palette.control, transparent: true, opacity: 0.94, depthWrite: false }))
    this.mesh.name = `plate:${id}`
    this.mesh.renderOrder = 4
    this.label = new TextSlot(`braid:${id}`)
    this.place(x, y)
  }

  place(x: number, y: number): void {
    this.x = x
    this.y = y
    this.mesh.position.set(x, y, this.z)
    // TeX glyphs sit about 1 mm behind their anchor: keep the anchor 3 mm off the plate (no z-fighting).
    this.label.anchor.position.set(x, y, this.z + 0.003)
  }

  setLabel(content: SlotContent): void {
    const key = content.kind === 'tex' ? content.parts[0]!.tex : content.plain
    if (key === this.shownKey) return
    this.shownKey = key
    this.label.set(content)
  }

  setVisible(v: boolean): void {
    this.mesh.visible = v
    this.label.setWanted(v)
  }

  get visible(): boolean {
    return this.mesh.visible
  }

  contains(px: number, py: number): boolean {
    return this.mesh.visible && Math.abs(px - this.x) <= this.w / 2 && Math.abs(py - this.y) <= this.h / 2
  }

  frame(time: number): void {
    this.label.frame(time)
    // Keep the label inside the plate.
    const maxW = this.w - 0.012
    const s = this.label.width > maxW ? maxW / this.label.width : 1
    this.label.anchor.scale.setScalar(s)
    const c = !this.enabled ? 0x1a1f2b : this.hover ? palette.controlHover : palette.control
    ;(this.mesh.material as MeshBasicMaterial).color.setHex(c)
    this.label.setOpacity(this.enabled ? 1 : 0.4)
  }

  dispose(): void {
    this.label.dispose()
    this.mesh.geometry.dispose()
    ;(this.mesh.material as MeshBasicMaterial).dispose()
    this.mesh.removeFromParent()
  }
}
