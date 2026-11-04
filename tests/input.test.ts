// Review C2 regression: controller pose validity in the real Input class (node; no WebGL needed).
// three's WebXRController hides the target-ray / grip group when its pose is unavailable and leaves the
// previous matrix in place; Input must treat that as "no pose", not as an active pointer. On Quest 3S an
// out-of-view controller is reported with an emulated position, and a reacquired one is corrected over
// its first frames: neither may drive an interaction.
import { describe, expect, it } from 'vitest'
import { Group, PerspectiveCamera, Scene } from 'three'
import { Input, POSE_SETTLE } from '../src/runtime/input'

function rig() {
  const rays = [new Group(), new Group()]
  const grips = [new Group(), new Group()]
  const domElement = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setPointerCapture: () => undefined,
  })
  // What the runtime reports for each space this frame (XRFrame.getPose); default: tracked.
  const reported = new Map<object, { emulatedPosition: boolean } | null>()
  const targetRaySpace = {}
  const gripSpace = {}
  const frame = { getPose: (space: object) => (reported.has(space) ? reported.get(space)! : { emulatedPosition: false }) }
  const renderer = { xr: { getController: (i: number) => rays[i]!, getControllerGrip: (i: number) => grips[i]!, getFrame: () => frame, getReferenceSpace: () => ({}) }, domElement }
  const camera = new PerspectiveCamera()
  camera.position.set(0, 1.2, 0.4)
  const input = new Input(renderer as never, camera, new Scene())
  const source = { handedness: 'right', targetRayMode: 'tracked-pointer', gamepad: { buttons: [] }, targetRaySpace, gripSpace }
  rays[0]!.dispatchEvent({ type: 'connected', data: source } as never)
  // Host clock: `step(dt)` advances it and runs one frame; `run(s)` runs 90 Hz frames for s seconds.
  let time = 0
  const step = (dt = 1 / 90, presenting = true) => input.update(presenting, (time += dt))
  const run = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 90) step()
  }
  /** Run frames until a continuously tracked pose has settled. */
  const settle = () => {
    step()
    run(POSE_SETTLE + 1 / 90)
  }
  return { input, ray: rays[0]!, grip: grips[0]!, rays, domElement, reported, targetRaySpace, gripSpace, source, step, run, settle }
}

function pointer(type: string, init: { button?: number; buttons?: number } = {}) {
  const e = new Event(type) as Event & Record<string, unknown>
  Object.assign(e, { clientX: 50, clientY: 50, pointerId: 1, button: init.button ?? 0, buttons: init.buttons ?? 0 })
  return e
}

describe('controller pose validity (review C2)', () => {
  it('a tracked ray is active and copied once it has settled', () => {
    const { input, ray, grip, settle } = rig()
    ray.position.set(1, 2, 3)
    grip.position.set(1, 2, 3)
    settle()
    const p = input.pointers.get('right')!
    expect(p.active).toBe(true)
    expect(p.rayValid).toBe(true)
    expect(p.gripValid).toBe(true)
    expect(p.origin.toArray()).toEqual([1, 2, 3])
  })

  it('an unavailable ray pose (group hidden by three) is not active and the stale transform is not copied', () => {
    const { input, ray, settle, step } = rig()
    ray.position.set(1, 2, 3)
    settle()
    ray.visible = false // what WebXRController.update does when getPose(targetRaySpace) is null
    ray.position.set(9, 9, 9) // whatever is left in the group must not be read
    step()
    const p = input.pointers.get('right')!
    expect(p.connected).toBe(true)
    expect(p.active).toBe(false)
    expect(p.rayValid).toBe(false)
    expect(p.origin.toArray()).toEqual([1, 2, 3])
  })

  it('ray and grip validity are tracked separately', () => {
    const { input, ray, grip, settle } = rig()
    grip.visible = false
    ray.visible = true
    settle()
    const p = input.pointers.get('right')!
    expect(p.rayValid).toBe(true)
    expect(p.gripValid).toBe(false)
  })

  it('an emulated pose (out of camera view on Quest 3S) is not valid and is not copied', () => {
    const { input, ray, reported, targetRaySpace, gripSpace, settle, step } = rig()
    ray.position.set(1, 2, 3)
    settle()
    reported.set(targetRaySpace, { emulatedPosition: true })
    reported.set(gripSpace, { emulatedPosition: true })
    ray.position.set(9, 9, 9) // three still updates the group from the estimated pose
    step()
    const p = input.pointers.get('right')!
    expect(ray.visible).toBe(true)
    expect(p.rayPose).toBe('emulated')
    expect(p.gripPose).toBe('emulated')
    expect(p.rayValid).toBe(false)
    expect(p.gripValid).toBe(false)
    expect(p.active).toBe(false)
    expect(p.origin.toArray()).toEqual([1, 2, 3])
    reported.clear()
    settle()
    expect(input.pointers.get('right')!.rayValid).toBe(true)
    expect(input.pointers.get('right')!.origin.toArray()).toEqual([9, 9, 9])
  })

  it('an emulated grip with a tracked ray: the ray stays usable, the grip does not', () => {
    const { input, reported, gripSpace, settle } = rig()
    reported.set(gripSpace, { emulatedPosition: true })
    settle()
    const p = input.pointers.get('right')!
    expect(p.rayValid).toBe(true)
    expect(p.gripValid).toBe(false)
    expect(p.gripPose).toBe('emulated')
  })

  it('a reacquired pose stays invalid while the runtime corrects it, and is read only after POSE_SETTLE', () => {
    const { input, ray, reported, targetRaySpace, settle, step, run } = rig()
    ray.position.set(1, 2, 3)
    settle()
    reported.set(targetRaySpace, { emulatedPosition: true })
    step()
    reported.clear()
    // the first frames after reacquisition report a still-uncorrected position (the device jump)
    ray.position.set(9, 9, 9)
    step()
    const p = input.pointers.get('right')!
    expect(p.rayPose).toBe('tracked')
    expect(p.rayValid).toBe(false)
    ray.position.set(1.1, 2, 3) // corrected
    run(POSE_SETTLE / 2)
    expect(p.rayValid).toBe(false)
    expect(p.origin.toArray()).toEqual([1, 2, 3])
    run(POSE_SETTLE / 2)
    expect(p.rayValid).toBe(true)
    expect(p.origin.x).toBeCloseTo(1.1)
  })

  it('any gap restarts the settle time', () => {
    const { input, reported, targetRaySpace, settle, step, run } = rig()
    settle()
    reported.set(targetRaySpace, null)
    step()
    reported.clear()
    step() // tracked again: settling starts here
    run(POSE_SETTLE * 0.9)
    reported.set(targetRaySpace, { emulatedPosition: true }) // flicker during settling
    step()
    reported.clear()
    step() // settling restarts here, although the first reacquisition is now more than POSE_SETTLE ago
    run(POSE_SETTLE * 0.9)
    expect(input.pointers.get('right')!.rayValid).toBe(false)
    run(POSE_SETTLE * 0.2)
    expect(input.pointers.get('right')!.rayValid).toBe(true)
  })

  it('a non-visible session suspends every pose; on return they settle again', () => {
    const { input, settle, step, run } = rig()
    settle()
    input.setSuspended(true)
    step()
    const p = input.pointers.get('right')!
    expect(p.rayValid).toBe(false)
    expect(p.gripValid).toBe(false)
    expect(p.active).toBe(false)
    input.setSuspended(false)
    step()
    expect(p.rayValid).toBe(false)
    run(POSE_SETTLE)
    expect(p.rayValid).toBe(true)
  })

  it('a hidden session that runs no frame: validity drops at once and the poses settle again on return (review)', () => {
    const { input, settle, step, run } = rig()
    settle()
    const p = input.pointers.get('right')!
    input.setSuspended(true)
    expect(p.rayValid).toBe(false) // without waiting for a frame
    expect(p.gripValid).toBe(false)
    input.setSuspended(false) // returns before any frame ran
    step()
    expect(p.rayValid).toBe(false)
    run(POSE_SETTLE)
    expect(p.rayValid).toBe(true)
    expect(p.gripValid).toBe(true)
  })

  it('a gap in frames longer than POSE_SETTLE restarts settling even without a visibility event', () => {
    const { input, settle, step, run } = rig()
    settle()
    step(1.2) // no frames for 1.2 s
    expect(input.pointers.get('right')!.rayValid).toBe(false)
    run(POSE_SETTLE)
    expect(input.pointers.get('right')!.rayValid).toBe(true)
  })

  it('a source swap in one inputsourceschange (disconnect then connect, no frame between) settles from scratch', () => {
    const { input, rays, source, settle, step, run } = rig()
    settle()
    rays[0]!.dispatchEvent({ type: 'disconnected', data: source } as never)
    rays[0]!.dispatchEvent({ type: 'connected', data: { ...source } } as never)
    const events = step()
    expect(events.map((e) => e.kind)).toEqual(['cancel'])
    expect(input.pointers.get('right')!.rayValid).toBe(false)
    run(POSE_SETTLE)
    expect(input.pointers.get('right')!.rayValid).toBe(true)
  })

  it('desktop mouse: leaving the canvas mid-drag (HUD, outside the window) keeps the drag and still delivers the release (review C2-2)', () => {
    const { input, domElement, step } = rig()
    domElement.dispatchEvent(pointer('pointerenter'))
    domElement.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1 }))
    expect(step(1 / 60, false).map((e) => e.kind)).toEqual(['press'])
    domElement.dispatchEvent(pointer('pointerleave'))
    step(1 / 60, false)
    const m = input.pointers.get('mouse')!
    expect(m.active).toBe(true)
    expect(m.rayValid).toBe(true)
    domElement.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0 }))
    expect(step(1 / 60, false).map((e) => e.kind)).toEqual(['release'])
  })
})
