// In-page checks for a PHYSICAL headset session (no IWER: the person wearing the headset moves and
// presses; these functions only observe, via CDP from the Mac: scripts/headset.mjs). Every result is
// JavaScript-side evidence (callback timing, scene state); compositor/GPU frame timing comes from a
// Perfetto trace captured separately.

import type { App } from '../app'
import type { Host } from '../runtime/host'
import { schedulerReport } from '../runtime/schedulerAudit'
import type { EquationDesc } from '../rendering/viewDescription'

export function makeDeviceChecks(app: App, host: Host, waitFrames: (n: number) => Promise<void>) {
  /** Session, display and browser facts as WebXR reports them. */
  const info = () => {
    const xr = host.renderer.xr
    const session = xr.getSession() as (XRSession & { frameRate?: number; supportedFrameRates?: Float32Array; enabledFeatures?: string[] }) | null
    const layer = session?.renderState.baseLayer as (XRWebGLLayer & { framebufferWidth?: number; framebufferHeight?: number }) | undefined
    const cams = xr.getCamera().cameras
    return {
      userAgent: navigator.userAgent,
      presenting: host.presenting,
      frameRate: session?.frameRate ?? null,
      supportedFrameRates: session?.supportedFrameRates ? [...session.supportedFrameRates] : null,
      visibilityState: session?.visibilityState ?? null,
      enabledFeatures: session?.enabledFeatures ?? null,
      layer: layer ? { kind: 'XRWebGLLayer', framebuffer: [layer.framebufferWidth, layer.framebufferHeight] } : session ? ((session.renderState as { layers?: object[] }).layers ?? []).map((l) => l.constructor.name) : null,
      eyeViewports: cams.map((c) => c.viewport.toArray()),
      devicePixelRatio: devicePixelRatio,
      perf: host.perf(),
      scheduler: schedulerReport().lastSecond,
      frameErrors: host.errors,
    }
  }

  /** Request a refresh rate the session supports (records what was actually granted). */
  const setFrameRate = async (hz: number) => {
    const session = host.renderer.xr.getSession() as (XRSession & { updateTargetFrameRate?: (r: number) => Promise<void>; frameRate?: number }) | null
    if (!session?.updateTargetFrameRate) return { ok: false, reason: 'updateTargetFrameRate not available' }
    await session.updateTargetFrameRate(hz)
    await waitFrames(30)
    return { ok: true, frameRate: session.frameRate }
  }

  /** C1 audit of whatever is on screen now: every equation slot represents the current description. */
  const audit = () => {
    const desc = app.currentDescription()
    const problems: string[] = []
    const reports = new Map([...app.adapter.slotReport(), ...app.controls.report()].map((r) => [r.id, r]))
    for (const r of reports.values()) if (r.visible && r.state === 'fresh' && r.shownKey !== r.wantedKey) problems.push(`${r.id} shows another key`)
    for (const e of desc?.primitives.filter((p): p is EquationDesc => p.kind === 'equation') ?? []) {
      const r = reports.get(e.id)
      if (!r?.visible || r.plain !== e.plain) problems.push(`${e.id}: "${r?.plain}" vs "${e.plain}"`)
    }
    const states: Record<string, number> = {}
    for (const r of reports.values()) if (r.visible) states[r.state] = (states[r.state] ?? 0) + 1
    return { problems, states, selected: app.snapshot().selected, revision: app.snapshot().revision }
  }

  /**
   * C3 on device: pause the transformation in its move phase, then sample for `ms` while the wearer moves
   * their head. Geometry work must stay flat while eye poses and billboards keep changing.
   */
  const pausedHeadCheck = async (ms = 4000) => {
    app.command('replay')
    // reach the move phase (0.5 s .. 2.3 s of presentation time)
    for (let i = 0; i < 400 && app.snapshot().playback.time < 1.0; i++) await waitFrames(1)
    app.command('pause')
    await waitFrames(3)
    const st = app.adapter.stats
    // Head-facing evidence: the orientation of a billboarded label (not a frame counter - review C3 check gap).
    const label = () => {
      const slots = (app.adapter as unknown as { slots: Map<string, { anchor: { visible: boolean; quaternion: { toArray(): number[] } } }> }).slots
      const s = [...slots.entries()].find(([id, v]) => id.startsWith('lbl:mov:') && v.anchor.visible) ?? [...slots.entries()].find(([id, v]) => id.startsWith('lbl:input:') && v.anchor.visible)
      return s ? s[1].anchor.quaternion.toArray().map((v) => +v.toFixed(4)) : null
    }
    const eyes = () => host.renderer.xr.getCamera().cameras.map((c) => c.matrixWorld.elements.slice(12, 15).map((v) => +v.toFixed(4)))
    const a = { evaluations: st.evaluations, arrowRebuilds: st.arrowRebuilds, dotMoves: st.dotMoves, policyPasses: st.policyPasses, geometries: host.renderer.info.memory.geometries, billboards: st.billboards, frames: host.perf().frames, eyes: eyes(), time: app.snapshot().playback.time, label: label() }
    const eyeTrack: number[][][] = []
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      await waitFrames(10)
      eyeTrack.push(eyes())
    }
    const b = { evaluations: st.evaluations, arrowRebuilds: st.arrowRebuilds, dotMoves: st.dotMoves, policyPasses: st.policyPasses, geometries: host.renderer.info.memory.geometries, billboards: st.billboards, eyes: eyes(), time: app.snapshot().playback.time, label: label() }
    const headTravelM = eyeTrack.reduce((acc, e, i) => (i === 0 ? 0 : acc + Math.hypot(e[0]![0]! - eyeTrack[i - 1]![0]![0]!, e[0]![1]! - eyeTrack[i - 1]![0]![1]!, e[0]![2]! - eyeTrack[i - 1]![0]![2]!)), 0)
    return {
      pass: a.evaluations === b.evaluations && a.arrowRebuilds === b.arrowRebuilds && a.dotMoves === b.dotMoves && a.policyPasses === b.policyPasses && a.geometries === b.geometries && a.time === b.time && headTravelM > 0.02 && !!a.label && JSON.stringify(a.label) !== JSON.stringify(b.label),
      pausedAt: a.time,
      before: { ...a, eyes: undefined },
      after: { ...b, eyes: undefined },
      headTravelM: +headTravelM.toFixed(3),
      billboardFrames: b.billboards - a.billboards,
      labelQuaternion: { before: a.label, after: b.label },
      note: 'resume with A or the Play button; the transformation should land on the committed target',
    }
  }

  /** Interaction log since a host timestamp (drag/commit/suspension/visibility events). */
  const logSince = (t: number) => app.log.filter((l) => l.t >= t)

  /**
   * C2 on device: what happened on the 30 frames after each re-anchor (drag preview values, or the
   * workbench's per-frame movement in metres). A jump shows up here, not just as an event order.
   */
  const resumeTraces = () => app.resumeTraces

  return { info, setFrameRate, audit, pausedHeadCheck, logSince, resumeTraces, now: () => performance.now() }
}
