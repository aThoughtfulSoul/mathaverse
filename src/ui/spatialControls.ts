// Spatial controls: scene-geometry buttons and a mode line on the workbench (stereo-compatible; no DOM
// overlay in XR). Labels are TextSlots: typeset text when ready, plain-text pending/error otherwise, and
// never a label belonging to a previous state (review C1/C4). Desktop mouse and XR controller rays pick
// them through the same Raycaster path as the mathematical objects.

import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, type Ray } from 'three'
import { TextSlot } from '../rendering/textSlot'
import type { Space } from '../rendering/glyphTokens'
import { palette } from './palette'
import { buttonTex } from './phrases'

/** `rebind` is "Use on Q" / "Show P" in the P-to-Q demo and "Reverse left" in the comparison; `demo` switches
 * demonstrations; `talk` is push-to-talk (press to record, press to stop, press to cancel while sending). */
export type ControlCommand = 'toggle' | 'replay' | 'mode' | 'undo' | 'rebind' | 'demo' | 'talk'

interface Button {
  command: ControlCommand
  plate: Mesh
  label: TextSlot
  text: string
  hover: boolean
  pressed: number
}

const W = 0.112
const H = 0.038
const GAP = 0.012
const LABEL_EM = 0.016
const STATUS_EM = 0.0145

export class SpatialControls {
  readonly group = new Group()
  private readonly buttons: Button[] = []
  private readonly raycaster = new Raycaster()
  private readonly status = new TextSlot('status')
  private statusText = ''
  /** Label/status content changes actually applied (review C4: must not grow per frame). */
  readonly stats = { labelChanges: 0, statusChanges: 0 }

  constructor() {
    this.group.name = 'controls'
    // Below the views, tilted toward a seated user; reachable with one controller.
    this.group.position.set(0, -0.36, 0.17)
    this.group.rotation.x = -0.6
    // Two rows keep the panel about as wide as the five-button row was: playback and editing on top,
    // demonstration, scene and voice controls below.
    const rows: ControlCommand[][] = [['toggle', 'replay', 'mode', 'undo'], ['rebind', 'demo', 'talk']]
    rows.forEach((cmds, row) => {
      const total = cmds.length * W + (cmds.length - 1) * GAP
      cmds.forEach((command, i) => {
        const plate = new Mesh(new PlaneGeometry(W, H), new MeshBasicMaterial({ color: palette.control }))
        plate.name = `button:${command}`
        plate.position.set(-total / 2 + W / 2 + i * (W + GAP), -row * (H + GAP), 0)
        const label = new TextSlot(`btn:${command}`)
        label.anchor.position.set(plate.position.x, plate.position.y, 0.0015)
        this.group.add(plate, label.anchor)
        this.buttons.push({ command, plate, label, text: '', hover: false, pressed: 0 })
      })
    })
    this.status.anchor.position.set(0, H / 2 + 0.026, 0)
    this.group.add(this.status.anchor)
  }

  /** Desired labels. A label whose text did not change costs nothing. */
  setLabels(labels: Record<ControlCommand, string>): void {
    for (const b of this.buttons) {
      const text = labels[b.command]
      if (text === b.text) continue
      b.text = text
      this.stats.labelChanges++
      // Prebuilt glyph token (review C1): switching Play/Pause/Cancel never typesets.
      b.label.set({ kind: 'tokens', tokens: [{ tex: buttonTex(text), color: palette.text }], em: LABEL_EM, color: palette.text, plain: text })
    }
  }

  setStatus(tokens: { tex: string; space?: Space }[], plain: string): void {
    const key = JSON.stringify(tokens)
    if (key === this.statusText) return
    this.statusText = key
    this.stats.statusChanges++
    this.status.set({ kind: 'tokens', tokens: tokens.map((t) => ({ tex: t.tex, color: palette.textDim, space: t.space })), em: STATUS_EM, color: palette.textDim, plain })
  }

  /** A plain-text status line (the four algebra demonstrations write their own words; canvas text, no typesetting). */
  setStatusPlain(plain: string): void {
    const key = `plain:${plain}`
    if (key === this.statusText) return
    this.statusText = key
    this.stats.statusChanges++
    this.status.set({ kind: 'plain', plain: plain.slice(0, 160), em: STATUS_EM, color: palette.textDim })
  }

  label(cmd: ControlCommand): string {
    return this.buttons.find((b) => b.command === cmd)!.text
  }

  /** Freshness of every control label (verification). */
  report() {
    return [...this.buttons.map((b) => ({ ...b.label.report(), text: b.text })), { ...this.status.report(), text: this.statusText }]
  }

  pick(ray: Ray): { command: ControlCommand; distance: number } | null {
    this.raycaster.ray.copy(ray)
    const hits = this.raycaster.intersectObjects(this.buttons.map((b) => b.plate), false)
    const hit = hits[0]
    return hit ? { command: this.buttons.find((b) => b.plate === hit.object)!.command, distance: hit.distance } : null
  }

  /** Every control currently under any pointer (set once per frame). */
  setHover(cmds: ControlCommand[]): void {
    for (const b of this.buttons) b.hover = cmds.includes(b.command)
  }

  flash(cmd: ControlCommand): void {
    const b = this.buttons.find((x) => x.command === cmd)
    if (b) b.pressed = 0.18
  }

  step(time: number, dt: number): void {
    for (const b of this.buttons) {
      b.label.frame(time)
      b.pressed = Math.max(0, b.pressed - dt)
      const color = b.pressed > 0 ? palette.controlActive : b.hover ? palette.controlHover : palette.control
      ;(b.plate.material as MeshBasicMaterial).color.setHex(color)
    }
    this.status.frame(time)
  }

  dispose(): void {
    this.status.dispose()
    for (const b of this.buttons) {
      b.label.dispose()
      b.plate.geometry.dispose()
      ;(b.plate.material as MeshBasicMaterial).dispose()
    }
    this.group.removeFromParent()
  }
}
