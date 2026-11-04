// DEV-only WebXR emulation with Meta's IWER (Immersive Web Emulation Runtime), Quest 3 profile,
// controllers as the primary input, stereo on. Installed only when the browser has no immersive-vr
// support; a production build never includes it (dynamic import behind import.meta.env.DEV).
// Pattern adapted from seal-duel/src/xr/emulator.ts (same owner).
//
// IWER is an emulator, not a headset: it proves the WebXR code paths (session, two eye views,
// controller rays, select events) but says nothing about Quest Browser performance, optics or
// legibility.

import type { XRDevice } from 'iwer'
import { noteWindowRaf } from './schedulerAudit'

let device: XRDevice | null = null
let installing: Promise<XRDevice | null> | null = null

export function getEmulator(): XRDevice | null {
  return device
}

async function nativeImmersiveVR(): Promise<boolean> {
  try {
    return (await navigator.xr?.isSessionSupported('immersive-vr')) ?? false
  } catch {
    return false
  }
}

export function ensureEmulator(): Promise<XRDevice | null> {
  if (!import.meta.env.DEV) return Promise.resolve(null)
  installing ??= (async () => {
    if (new URLSearchParams(location.search).get('emulator') === 'off') return null
    if (await nativeImmersiveVR()) return null
    const { XRDevice: Device, metaQuest3 } = await import('iwer')
    const dev = new Device(metaQuest3, { ipd: 0.063, stereoEnabled: true })
    dev.installRuntime({ forceInstall: true })
    dev.primaryInputMode = 'controller'
    device = dev
    return dev
  })()
  return installing
}

/**
 * DEV: a Worker-driven requestAnimationFrame for a hidden browser pane, where rAF drops to ~1 Hz.
 * IWER drives its emulated session from window.requestAnimationFrame, so this also paces XR frames.
 * It replaces the scheduler's *source of ticks*, not the scheduler: the host loop is still the only
 * callback. Adapted from seal-duel/src/dev/rafShim.ts.
 */
export function installRafShim(hz = 72): { stop(): void; start(): void } {
  const callbacks = new Map<number, FrameRequestCallback>()
  let nextId = 0
  let worker: Worker | null = null
  const tick = () => {
    const now = performance.now()
    const list = [...callbacks.values()]
    callbacks.clear()
    for (const cb of list) {
      try {
        cb(now)
      } catch (err) {
        console.error('[rafShim]', err)
      }
    }
  }
  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    noteWindowRaf(cb)
    const id = ++nextId
    callbacks.set(id, cb)
    return id
  }
  window.cancelAnimationFrame = (id: number) => void callbacks.delete(id)
  const start = () => {
    if (worker) return
    const url = URL.createObjectURL(new Blob([`setInterval(() => postMessage(0), ${1000 / hz})`], { type: 'text/javascript' }))
    worker = new Worker(url)
    URL.revokeObjectURL(url)
    worker.onmessage = tick
  }
  start()
  return {
    start,
    stop() {
      worker?.terminate()
      worker = null
    },
  }
}
