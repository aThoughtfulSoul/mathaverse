// Host input (RUNTIME-ADAPTER R5): controller target rays in XR, the mouse on desktop. Both become the
// same Pointer record so selection and drags use one code path. Events are queued and drained once per
// frame from the host loop, so nothing mutates state between frames.

import {
  Group, Vector3, Quaternion, Raycaster, BufferGeometry, Line, LineBasicMaterial, Mesh, RingGeometry, MeshBasicMaterial,
  Float32BufferAttribute, type PerspectiveCamera, type WebGLRenderer, type Scene,
} from 'three'
import { palette } from '../ui/palette'
import type { AssistantPanelInput, UiCommand } from '../ui/model'

export type PointerId = 'mouse' | 'left' | 'right'
/**
 * Controller buttons (xr-standard 4 = A/X, 5 = B/Y), either hand:
 * - 'buttonA': a TAP of A/X (released before HOLD_TO_TALK). Fired on RELEASE, not on press, because only the
 *   release tells a tap from a hold (until hold-to-talk it fired on press).
 * - 'buttonAHold': A/X has been held for HOLD_TO_TALK (once per press); 'buttonAHoldEnd': that held press was
 *   released; 'buttonAHoldCancel': that held press ended without a release (controller disconnected, input
 *   source gone, session ended). A held press never also produces a tap: when hold-to-talk declines a held press
 *   for lack of the spatial shell (legacy controls), the app takes its 'buttonAHoldEnd' as the old tap instead.
 * - 'buttonB': B/Y pressed (fired on press, unchanged).
 */
export type PointerEventKind = 'press' | 'release' | 'grip' | 'gripRelease' | 'buttonA' | 'buttonAHold' | 'buttonAHoldEnd' | 'buttonAHoldCancel' | 'buttonB' | 'cancel'

/** Seconds A/X must stay pressed for push-to-talk; a shorter press is a tap (play/pause). */
export const HOLD_TO_TALK = 0.3
/** Float slack on the hold threshold (host times are sums of frame deltas). */
const HOLD_EPS = 1e-6
/** What the runtime reported for a pose this frame. 'emulated' = XRPose.emulatedPosition: orientation is
 * tracked but the position is estimated. Quest 3S (Quest Browser 154) reports this - not a null pose -
 * while a controller is out of the cameras' view (device finding, R6 C2). */
export type PoseQuality = 'tracked' | 'emulated' | 'none'

/** Seconds a pose must stay tracked after any gap before it counts as valid. On Quest 3S the runtime
 * corrects a reacquired controller over its first frames: re-anchoring a drag on the first tracked frame
 * let the preview jump more than 5 units within two frames (device finding, R6 C2). */
export const POSE_SETTLE = 0.25

export interface Pointer {
  id: PointerId
  /** Usable for ray interactions this frame: connected AND a valid target-ray pose (review C2). */
  active: boolean
  /** An input source is attached to this pointer (independent of pose validity). */
  connected: boolean
  /** Target-ray / grip poses are tracked this frame (reported, position not emulated, session visible)
   * and have been for POSE_SETTLE. When false the fields below keep their last valid values and must
   * not be used to start or drive an interaction. */
  rayValid: boolean
  gripValid: boolean
  /** Why: the runtime's report for each pose (diagnostics and logs). */
  rayPose: PoseQuality
  gripPose: PoseQuality
  origin: Vector3
  direction: Vector3
  /** The controller's grip pose for grab-style moves (equal to the ray pose for the mouse). */
  gripPosition: Vector3
  gripQuaternion: Quaternion
}

export interface QueuedEvent {
  pointer: PointerId
  kind: PointerEventKind
}

interface ForcedLoss {
  ray: boolean
  grip: boolean
  rayEmulated: boolean
  gripEmulated: boolean
}

const noForcedLoss = (): ForcedLoss => ({ ray: false, grip: false, rayEmulated: false, gripEmulated: false })

interface ControllerSlot {
  ray: Group
  grip: Group
  handedness: 'left' | 'right' | null
  source: XRInputSource | null
  visual: Line
  cursor: Mesh
  prevButtons: boolean[]
  /** The A/X press in progress (null: released). */
  aPress: APress | null
  /** Host time since which each pose has been continuously tracked (null: not tracked now). */
  rayTrackedSince: number | null
  gripTrackedSince: number | null
}

interface APress {
  /** Host time of the frame that saw the press. */
  at: number
  hand: 'left' | 'right'
  /** 'buttonAHold' was sent for this press. */
  held: boolean
  /** The session was not visible during the press: it may not become a hold (nothing starts recording from
   * a press that spanned the system UI). */
  noHold: boolean
  /** Reached the hold time while noHold: neither a hold nor a tap. */
  abandoned: boolean
}

export class Input {
  readonly pointers = new Map<PointerId, Pointer>()
  private queue: QueuedEvent[] = []
  private readonly raycaster = new Raycaster()
  private readonly ndc = { x: 0, y: 0 }
  private mouseInside = false
  private readonly slots: ControllerSlot[] = []
  private orbit: { yaw: number; pitch: number; dist: number; dragging: boolean; lastX: number; lastY: number; moved: number }
  private readonly target = new Vector3(0, 1.0, -0.72)
  private readonly cleanup: (() => void)[] = []

  constructor(private readonly renderer: WebGLRenderer, private readonly camera: PerspectiveCamera, scene: Scene) {
    const offset = camera.position.clone().sub(this.target)
    this.orbit = {
      yaw: Math.atan2(offset.x, offset.z),
      pitch: Math.asin(offset.y / offset.length()),
      dist: offset.length(),
      dragging: false, lastX: 0, lastY: 0, moved: 0,
    }
    for (const id of ['mouse', 'left', 'right'] as const) {
      this.pointers.set(id, { id, active: false, connected: false, rayValid: false, gripValid: false, rayPose: 'none', gripPose: 'none', origin: new Vector3(), direction: new Vector3(0, 0, -1), gripPosition: new Vector3(), gripQuaternion: new Quaternion() })
    }
    for (let i = 0; i < 2; i++) this.slots.push(this.makeSlot(i, scene))
    this.bindMouse()
  }

  /** Called once per frame, before the app reads pointers. `time` is the host clock in seconds. */
  update(presenting: boolean, time: number): QueuedEvent[] {
    const mouse = this.pointers.get('mouse')!
    // While the primary button is held the canvas has pointer capture: the drag continues even if the
    // cursor is over the HUD or outside the window.
    mouse.active = !presenting && (this.mouseInside || this.primaryDown)
    mouse.connected = !presenting
    mouse.rayValid = mouse.gripValid = mouse.active
    mouse.rayPose = mouse.gripPose = mouse.active ? 'tracked' : 'none'
    if (mouse.active) {
      this.raycaster.setFromCamera(this.ndc as never, this.camera)
      mouse.origin.copy(this.raycaster.ray.origin)
      mouse.direction.copy(this.raycaster.ray.direction)
      mouse.gripPosition.copy(mouse.origin)
    }
    for (const id of ['left', 'right'] as const) {
      const p = this.pointers.get(id)!
      p.active = p.connected = p.rayValid = p.gripValid = false
      p.rayPose = p.gripPose = 'none'
    }
    // A gap in frames (a hidden session runs none) is a gap in tracking: every pose settles again.
    if (this.lastUpdate !== null && time - this.lastUpdate > POSE_SETTLE) this.resetSettle()
    this.lastUpdate = time
    // The XRFrame is only valid inside the host's animation-loop callback, which is where update() runs.
    const frame = presenting ? this.renderer.xr.getFrame?.() : null
    const space = frame ? this.renderer.xr.getReferenceSpace() : null
    for (const slot of this.slots) {
      const show = presenting && slot.source !== null && slot.source.targetRayMode === 'tracked-pointer'
      if (!show || !slot.handedness) {
        slot.visual.visible = false
        slot.rayTrackedSince = slot.gripTrackedSince = null
        this.dropPress(slot)
        continue
      }
      const p = this.pointers.get(slot.handedness)!
      p.connected = true
      // three's WebXRController hides the target-ray / grip group when its pose is unavailable (and in a
      // 'visible-blurred' session) but leaves the previous matrix in place, and it ignores
      // emulatedPosition. Only a tracked pose may start or drive an interaction.
      const forced = this.forcedLoss[slot.handedness]
      p.rayPose = this.quality(slot.ray.visible, frame, space, slot.source?.targetRaySpace, forced.ray, forced.rayEmulated)
      p.gripPose = this.quality(slot.grip.visible, frame, space, slot.source?.gripSpace, forced.grip, forced.gripEmulated)
      const rayTracked = p.rayPose === 'tracked' && !this.suspended
      const gripTracked = p.gripPose === 'tracked' && !this.suspended
      slot.rayTrackedSince = rayTracked ? (slot.rayTrackedSince ?? time) : null
      slot.gripTrackedSince = gripTracked ? (slot.gripTrackedSince ?? time) : null
      p.rayValid = slot.rayTrackedSince !== null && time - slot.rayTrackedSince >= POSE_SETTLE
      p.gripValid = slot.gripTrackedSince !== null && time - slot.gripTrackedSince >= POSE_SETTLE
      p.active = p.rayValid
      slot.visual.visible = p.rayValid
      if (!p.rayValid) slot.cursor.visible = false
      if (p.rayValid) {
        slot.ray.updateMatrixWorld()
        slot.ray.getWorldPosition(p.origin)
        p.direction.set(0, 0, -1).applyQuaternion(slot.ray.getWorldQuaternion(new Quaternion())).normalize()
      }
      if (p.gripValid) {
        slot.grip.updateMatrixWorld()
        slot.grip.getWorldPosition(p.gripPosition)
        slot.grip.getWorldQuaternion(p.gripQuaternion)
      }
      // Gamepad buttons (xr-standard mapping: 4 = A/X, 5 = B/Y), edge-detected here once per frame.
      const pads = slot.source?.gamepad?.buttons ?? []
      this.updateA(slot, slot.handedness, pads[4]?.pressed ?? false, time)
      const bDown = pads[5]?.pressed ?? false
      if (bDown && !slot.prevButtons[5]) this.queue.push({ pointer: slot.handedness, kind: 'buttonB' })
      slot.prevButtons[5] = bDown
    }
    const out = this.queue
    this.queue = []
    return out
  }

  /**
   * A/X: tap or hold. The press is timed from the frame that saw it; it becomes a hold on the first frame that
   * still sees it pressed HOLD_TO_TALK later. A release seen before that is a tap (a frame gap that hides the
   * moment of release is a tap too: a hold is only reported while the button is seen held).
   */
  private updateA(slot: ControllerSlot, hand: 'left' | 'right', down: boolean, time: number): void {
    if (down && !slot.prevButtons[4]) slot.aPress = { at: time, hand, held: false, noHold: this.suspended, abandoned: false }
    slot.prevButtons[4] = down
    const a = slot.aPress
    if (!a) return
    if (down) {
      if (a.held || a.abandoned) return
      if (this.suspended) a.noHold = true
      if (time - a.at < HOLD_TO_TALK - HOLD_EPS) return
      if (a.noHold) a.abandoned = true
      else {
        a.held = true
        this.queue.push({ pointer: a.hand, kind: 'buttonAHold' })
      }
      return
    }
    slot.aPress = null
    if (a.held) this.queue.push({ pointer: a.hand, kind: 'buttonAHoldEnd' })
    else if (!a.abandoned) this.queue.push({ pointer: a.hand, kind: 'buttonA' })
  }

  /** The slot's A/X press ends without a release (source gone, not presenting): a hold is cancelled, a tap is dropped. */
  private dropPress(slot: ControllerSlot): void {
    const a = slot.aPress
    slot.aPress = null
    if (a?.held) this.queue.push({ pointer: a.hand, kind: 'buttonAHoldCancel' })
  }

  /**
   * A short haptic pulse on a controller, fire-and-forget: the promise is never awaited (Quest Browser's
   * pulse() promise may never settle). False when that controller has no haptic actuator.
   */
  pulse(id: PointerId, intensity = 0.35, ms = 30): boolean {
    const slot = this.slots.find((s) => s.handedness === id && s.source !== null)
    const pad = slot?.source?.gamepad as (Gamepad & { hapticActuators?: readonly { pulse?: (value: number, duration: number) => unknown }[] }) | undefined
    const actuator = pad?.hapticActuators?.[0]
    if (!actuator?.pulse) return false
    try {
      void Promise.resolve(actuator.pulse(Math.min(Math.max(intensity, 0), 1), Math.min(Math.max(ms, 0), 100))).catch(() => undefined)
      return true
    } catch {
      return false
    }
  }

  private quality(visible: boolean, frame: XRFrame | null | undefined, space: XRReferenceSpace | null, poseSpace: XRSpace | undefined, forcedNone: boolean, forcedEmulated: boolean): PoseQuality {
    if (!visible || forcedNone) return 'none'
    if (forcedEmulated) return 'emulated'
    if (!frame || !space || !poseSpace) return 'tracked'
    const pose = frame.getPose(poseSpace, space)
    if (pose === null || pose === undefined) return 'none'
    // IWER marks every space emulated, so under the emulator the flag carries no tracking information
    // (emulator tests force emulated poses through debugPoseLoss instead).
    return pose.emulatedPosition && !this.emulatorRuntime() ? 'emulated' : 'tracked'
  }

  /** Set by the page when IWER is the WebXR runtime (development only). */
  emulatorRuntime: () => boolean = () => false

  private suspended = false
  private lastUpdate: number | null = null
  private readonly forcedLoss: Record<'left' | 'right', ForcedLoss> = { left: noForcedLoss(), right: noForcedLoss() }

  /** Session not 'visible' (system UI, blurred, hidden): every controller pose counts as unavailable at
   * once (a hidden session may run no frame before it returns), and settles again afterwards. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended
    if (!suspended) return
    this.resetSettle()
    // A hidden session may run no frame before it returns: an A/X press in progress may no longer become a hold.
    for (const slot of this.slots) if (slot.aPress) slot.aPress.noHold = true
    for (const id of ['left', 'right'] as const) {
      const p = this.pointers.get(id)!
      p.active = p.rayValid = p.gripValid = false
    }
  }

  private resetSettle(): void {
    for (const slot of this.slots) slot.rayTrackedSince = slot.gripTrackedSince = null
  }

  get isSuspended(): boolean {
    return this.suspended
  }

  /** Test seam (verification only): treat a controller's ray and/or grip pose as unavailable, or as
   * reported with an emulated (estimated) position. */
  debugPoseLoss(hand: 'left' | 'right', loss: Partial<ForcedLoss>): void {
    this.forcedLoss[hand] = { ...noForcedLoss(), ...loss }
  }

  /** Show where a pointer's ray lands (or its default length). Display only. */
  setRayLength(id: PointerId, length: number | null, hover: boolean): void {
    const slot = this.slots.find((s) => s.handedness === id)
    if (!slot) return
    const len = length ?? 1.2
    slot.visual.scale.z = len
    slot.cursor.visible = length !== null
    // The cursor is parented to the ray group (not the z-scaled line), so this is metres along the ray.
    slot.cursor.position.set(0, 0, -len + 0.002)
    ;(slot.cursor.material as MeshBasicMaterial).color.setHex(hover ? palette.selected : palette.textDim)
  }

  /** Desktop orbit: left-drag on empty space or right-drag anywhere orbits; the wheel zooms. */
  setOrbitAllowed(allowed: boolean): void {
    this.orbitAllowed = allowed
  }

  private orbitAllowed = true

  dispose(): void {
    this.cleanup.forEach((fn) => fn())
    for (const s of this.slots) {
      s.ray.removeFromParent()
      s.grip.removeFromParent()
      s.visual.geometry.dispose()
      ;(s.visual.material as LineBasicMaterial).dispose()
      s.cursor.removeFromParent()
      s.cursor.geometry.dispose()
      ;(s.cursor.material as MeshBasicMaterial).dispose()
    }
  }

  private makeSlot(i: number, scene: Scene): ControllerSlot {
    const ray = this.renderer.xr.getController(i)
    const grip = this.renderer.xr.getControllerGrip(i)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3))
    geo.setAttribute('color', new Float32BufferAttribute([0.85, 0.9, 1, 0.1, 0.12, 0.16], 3))
    const visual = new Line(geo, new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }))
    visual.name = `ray-${i}`
    visual.renderOrder = 20
    const cursor = new Mesh(new RingGeometry(0.004, 0.0065, 24), new MeshBasicMaterial({ color: palette.textDim, depthTest: false, transparent: true }))
    cursor.renderOrder = 21
    cursor.visible = false
    ray.add(visual, cursor)
    scene.add(ray, grip)
    const slot: ControllerSlot = { ray, grip, handedness: null, source: null, visual, cursor, prevButtons: [], aPress: null, rayTrackedSince: null, gripTrackedSince: null }
    const on = (type: string, fn: (e: { data?: XRInputSource }) => void) => {
      ray.addEventListener(type as never, fn as never)
      this.cleanup.push(() => ray.removeEventListener(type as never, fn as never))
    }
    on('connected', (e) => {
      // A new source in this slot (three may disconnect and connect within one inputsourceschange, with
      // no frame between): its poses settle from scratch and its buttons start released.
      slot.rayTrackedSince = slot.gripTrackedSince = null
      this.dropPress(slot)
      slot.prevButtons = []
      slot.source = e.data ?? null
      slot.handedness = e.data?.handedness === 'left' ? 'left' : e.data?.handedness === 'right' ? 'right' : null
    })
    on('disconnected', () => {
      // A held A/X ends with the controller (session end disconnects every source, too).
      this.dropPress(slot)
      if (slot.handedness) this.queue.push({ pointer: slot.handedness, kind: 'cancel' })
      slot.rayTrackedSince = slot.gripTrackedSince = null
      slot.prevButtons = []
      slot.source = null
      slot.handedness = null
    })
    const push = (kind: PointerEventKind) => () => slot.handedness && this.queue.push({ pointer: slot.handedness, kind })
    on('selectstart', push('press'))
    on('selectend', push('release'))
    on('squeezestart', push('grip'))
    on('squeezeend', push('gripRelease'))
    return slot
  }

  private bindMouse(): void {
    const el = this.renderer.domElement
    const setNdc = (e: PointerEvent | WheelEvent) => {
      const r = el.getBoundingClientRect()
      this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1
      this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1
    }
    const listen = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, opts)
      this.cleanup.push(() => el.removeEventListener(type, fn))
    }
    listen('contextmenu', (e) => e.preventDefault())
    listen('pointerenter', () => (this.mouseInside = true))
    listen('pointerleave', () => (this.mouseInside = false))
    listen('pointermove', (e) => {
      this.mouseInside = true
      setNdc(e)
      if (this.primaryDown && (e.buttons & 1) === 0) {
        this.primaryDown = false
        this.queue.push({ pointer: 'mouse', kind: 'release' })
      }
      const o = this.orbit
      if (o.dragging) {
        const dx = e.clientX - o.lastX
        const dy = e.clientY - o.lastY
        o.moved += Math.abs(dx) + Math.abs(dy)
        o.yaw -= dx * 0.005
        o.pitch = Math.max(-0.4, Math.min(1.1, o.pitch + dy * 0.004))
        o.lastX = e.clientX
        o.lastY = e.clientY
        this.applyOrbit()
      }
    })
    listen('pointerdown', (e) => {
      setNdc(e)
      el.setPointerCapture(e.pointerId)
      if (e.button === 2) this.startOrbit(e)
      else if (e.button === 0) {
        this.primaryDown = true
        this.queue.push({ pointer: 'mouse', kind: 'press' })
        this.pendingOrbit = e
      }
    })
    listen('pointerup', (e) => {
      setNdc(e)
      // Primary release: when the primary button is no longer held, whichever button ended the chord.
      if (this.primaryDown && (e.buttons & 1) === 0) {
        this.primaryDown = false
        this.queue.push({ pointer: 'mouse', kind: 'release' })
      }
      this.orbit.dragging = false
      this.pendingOrbit = null
    })
    const lost = () => {
      if (this.primaryDown) this.queue.push({ pointer: 'mouse', kind: 'cancel' })
      this.primaryDown = false
      this.orbit.dragging = false
      this.pendingOrbit = null
    }
    listen('pointercancel', lost)
    listen('lostpointercapture', lost)
    listen('wheel', (e) => {
      e.preventDefault()
      this.orbit.dist = Math.max(0.35, Math.min(3, this.orbit.dist * Math.exp(e.deltaY * 0.001)))
      this.applyOrbit()
    }, { passive: false })
  }

  private pendingOrbit: PointerEvent | null = null
  private primaryDown = false

  /** After XR: three wrote the head pose into the desktop camera; put the orbit view back. */
  restoreDesktopCamera(): void {
    this.applyOrbit()
  }

  /** The app calls this after a press that hit nothing interactive: that left-drag orbits. */
  beginOrbitFromPendingPress(): void {
    if (this.pendingOrbit && this.orbitAllowed) this.startOrbit(this.pendingOrbit)
    this.pendingOrbit = null
  }

  private startOrbit(e: PointerEvent): void {
    this.orbit.dragging = true
    this.orbit.lastX = e.clientX
    this.orbit.lastY = e.clientY
    this.orbit.moved = 0
  }

  private applyOrbit(): void {
    const { yaw, pitch, dist } = this.orbit
    this.camera.position.set(
      this.target.x + dist * Math.cos(pitch) * Math.sin(yaw),
      this.target.y + dist * Math.sin(pitch),
      this.target.z + dist * Math.cos(pitch) * Math.cos(yaw),
    )
    this.camera.lookAt(this.target)
  }
}

// ------------------------------------------------------------------ controller hold-to-talk

/** The assistant part of the published UI view that hold-to-talk reads (the same input the XR Talk control is derived
 * from, and whether the assistant inspector is open). */
export type VoiceGateInput = Pick<AssistantPanelInput, 'open' | 'voice' | 'voiceAcquiring' | 'capability'>

/** What hold-to-talk reads and does; the app supplies it (tests fake it). */
export interface HoldToTalkHost {
  /** The spatial UI shell's command dispatch (null without the shell: then A/X holds do nothing). */
  dispatch(): ((c: UiCommand) => void) | null
  /** Voice state from the last published UI view; null before the first view or while it is out of date. */
  voice(): VoiceGateInput | null
  /** A mathematical drag preview is active. */
  dragging(): boolean
  /** An XR session is presenting. */
  presenting(): boolean
  /** Optional haptic acknowledgement (fire-and-forget). */
  pulse?(pointer: PointerId): void
  note?(event: string, detail?: unknown): void
}

/**
 * Why an A/X hold may not start push-to-talk now (null: it may). It starts only when the XR Talk control would
 * show "Talk" and a press of it would start a recording: speech and the assistant are available, and no
 * recording, microphone request, transcription or pending auto-send is in progress.
 */
export function holdToTalkBlocked(v: VoiceGateInput | null): string | null {
  if (!v) return 'voice-state-unknown'
  const s = v.voice
  if (s.kind === 'unavailable' || v.capability?.speech?.mode === 'unavailable') return 'speech-unavailable'
  if (v.capability?.assistant?.mode === 'unavailable') return 'assistant-unavailable'
  if (v.voiceAcquiring || s.kind === 'recording') return 'already-recording'
  if (s.kind === 'transcribing' || (s.kind === 'transcript' && s.autoSubmitAt !== null)) return 'voice-busy'
  return null
}

/** Recording, or waiting for the microphone (what B/Y cancels). */
function capturing(v: VoiceGateInput | null): boolean {
  return !!v && (v.voiceAcquiring || v.voice.kind === 'recording')
}

const VOICE = {
  // The toolbar's Ask Meta Muse AI command (it toggles: sent only while the assistant inspector is not open).
  open: { kind: 'inspector', which: 'assistant' },
  // The XR Talk control's own command. With the gate above it always starts a recording, and in XR the controller
  // gives it the Talk control's auto-send (the transcript is sent after a short delay unless canceled).
  start: { kind: 'assistant', action: { kind: 'voiceToggle' } },
  stop: { kind: 'assistant', action: { kind: 'voiceStop' } },
  cancel: { kind: 'assistant', action: { kind: 'voiceCancel' } },
} as const satisfies Record<string, UiCommand>

/**
 * Controller push-to-talk over the UI command path (the XR Talk control's commands, so the panel, the Talk
 * label and the voice client stay one state):
 * - A/X held for HOLD_TO_TALK starts a recording (either hand; one at a time). When the assistant inspector is not
 *   open (closed, or the mathematics inspector shows) it is opened first, with the toolbar's command, so the wearer
 *   sees the panel and its listening state: nothing records out of sight. Ignored outside a session, during a drag,
 *   while speech is unavailable, or while voice is already busy (an ignored hold opens nothing and is not a tap).
 * - Without the spatial shell (legacy controls) there is no push-to-talk: a held press is declined, and its release
 *   ('buttonAHoldEnd', handle() returns false) is the app's old A/X tap.
 * - Releasing that A/X stops the recording; the transcript then follows the XR Talk flow (auto-send after a delay
 *   unless canceled).
 * - B/Y while recording or waiting for the microphone cancels it (nothing is uploaded or sent).
 * - The controller disconnecting, the session becoming hidden (system UI; the app calls end()) or the session
 *   ending mid-hold cancels the recording, once.
 * - A recording a hold started can also end while A/X is still held (the panel's Cancel or Close, an experiment change,
 *   the recording limit, a microphone error). The app passes every published view to viewed(): once a view has shown
 *   this hold's capture (the microphone request or the recording) and a later one shows no capture, the hold lets go
 *   of it. Its release then stops nothing (it would stop whatever records by then, such as a recording started with
 *   Talk) and is no tap, the other hand may hold, and B/Y keeps its meaning.
 * Taps of A/X ('buttonA') and B/Y outside a recording are not handled here: the app keeps their old meaning.
 */
export class HoldToTalk {
  /** The hand whose held A/X started the current recording. */
  private hand: PointerId | null = null
  /** A published view has shown that recording's capture (acquiring or recording) since the hold began. */
  private captureSeen = false
  /** Held presses declined for lack of the spatial shell: their release is a tap (legacy controls). */
  private readonly tapOnRelease = new Set<PointerId>()

  constructor(private readonly host: HoldToTalkHost) {}

  get holding(): PointerId | null {
    return this.hand
  }

  /**
   * Each published UI view's voice state, in order (the app calls this from renderSpatialShell). A hold whose capture a
   * view has shown, and which a later view shows ended some other way, is dropped: nothing is dispatched (whatever
   * ended it already did), and its release, cancel or B/Y is then handled as if no hold were in progress.
   */
  viewed(v: VoiceGateInput | null): void {
    if (this.hand === null || !v) return
    if (capturing(v)) {
      this.captureSeen = true
      return
    }
    if (!this.captureSeen) return
    const pointer = this.hand
    this.hand = null
    this.captureSeen = false
    this.host.note?.('voiceHoldDropped', { pointer, reason: 'capture-ended', voice: v.voice.kind })
  }

  /** True when the event was handled here (the caller does nothing else with it). */
  handle(pointer: PointerId, kind: PointerEventKind): boolean {
    switch (kind) {
      case 'buttonAHold':
        this.begin(pointer)
        return true // a hold is never a tap, even when it is ignored (legacy controls: its release is)
      case 'buttonAHoldEnd':
        if (this.tapOnRelease.delete(pointer)) return false // legacy controls: the old play/pause tap
        if (this.hand === pointer) this.finish('stop', 'release')
        return true
      case 'buttonAHoldCancel':
        this.tapOnRelease.delete(pointer)
        if (this.hand === pointer) this.finish('cancel', 'controller-lost')
        return true
      case 'buttonB': {
        if (this.hand === null && !capturing(this.host.voice())) return false
        const d = this.host.dispatch()
        if (!d) return false
        this.hand = null
        this.captureSeen = false
        d(VOICE.cancel)
        this.host.note?.('voiceHoldCancel', { pointer, reason: 'buttonB' })
        return true
      }
      default:
        return false
    }
  }

  /** The session was hidden (system UI) or ended, or the app stops listening: a recording started by a hold is
   * cancelled now (its release, if one is ever seen, then does nothing). */
  end(reason: string): void {
    if (this.hand !== null) this.finish('cancel', reason)
  }

  private begin(pointer: PointerId): void {
    const d = this.host.dispatch()
    const v = this.host.voice()
    const why = this.hand !== null ? 'already-holding'
      : !d ? 'no-ui-shell'
      : !this.host.presenting() ? 'not-presenting'
      : this.host.dragging() ? 'dragging'
      : holdToTalkBlocked(v)
    if (why || !d || !v) {
      if (why === 'no-ui-shell') this.tapOnRelease.add(pointer)
      this.host.note?.('voiceHoldIgnored', { pointer, reason: why })
      return
    }
    this.hand = pointer
    this.captureSeen = false
    // What records must be visible: show the assistant inspector first (the controller applies both commands at
    // once, in order; switching from the mathematics inspector to the assistant cancels nothing).
    if (!v.open) d(VOICE.open)
    d(VOICE.start)
    this.host.pulse?.(pointer)
    this.host.note?.('voiceHoldStart', { pointer, openedPanel: !v.open })
  }

  private finish(how: 'stop' | 'cancel', reason: string): void {
    const pointer = this.hand!
    this.hand = null
    this.captureSeen = false
    const d = this.host.dispatch()
    if (!d) return
    d(how === 'stop' ? VOICE.stop : VOICE.cancel)
    if (how === 'stop') this.host.pulse?.(pointer)
    this.host.note?.(how === 'stop' ? 'voiceHoldStop' : 'voiceHoldCancel', { pointer, reason })
  }
}
