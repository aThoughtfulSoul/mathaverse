// Scripted R6 checks through the real input path (IWER emulated Quest 3 controllers -> three XR
// controller events -> App -> Workspace -> adapter). Each step is separately callable so a tool call
// stays short. These prove code paths in an EMULATOR; they are not headset evidence.

import { Vector3, Quaternion, Ray, type Matrix4 } from 'three'
import type { App } from '../app'
import type { Host } from '../runtime/host'
import { getEmulator } from '../runtime/emulator'
import { schedulerReport } from '../runtime/schedulerAudit'
import { clearTexCache, texStats, texDebug } from '../rendering/tex'
import { clearTokens, tokenStats } from '../rendering/glyphTokens'
import { slotStats } from '../rendering/textSlot'
import type { EquationDesc, LabelDesc, PlaneDesc, ViewRole } from '../rendering/viewDescription'
import { saveDocument, loadSaved, exportText, importText, storageDebug } from '../storage/persist'
import { orderDemoActions, pqDemoActions, reverseRouteActions, ORDER_IDS } from '../demo/order'
import { docToJson, findExperiment } from '../workspace/document'
import { COMPARE_TIMING } from '../rendering/comparePlayback'

type V3 = [number, number, number]
interface StepResult {
  step: string
  pass: boolean
  detail: Record<string, unknown>
}

export function makeVerifier(app: App, host: Host, waitFrames: (n: number) => Promise<void>, rafShim?: { stop(): void; start(): void } | null) {
  const dev = () => {
    const d = getEmulator()
    if (!d) throw new Error('IWER emulator not installed (native WebXR present or production build)')
    return d
  }
  const HAND_FROM: V3 = [0.2, 0.95, -0.25]
  const aim = (from: V3, at: V3) => {
    const c = dev().controllers.right!
    const dir = new Vector3(...at).sub(new Vector3(...from)).normalize()
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), dir)
    c.position.set(...from)
    c.quaternion.set(quat.x, quat.y, quat.z, quat.w)
  }
  const button = async (id: 'trigger' | 'squeeze' | 'a-button', v: 0 | 1, frames = 3, hand: 'left' | 'right' = 'right') => {
    dev().controllers[hand]!.updateButtonValue(id, v)
    await waitFrames(frames)
  }
  const aimHand = (hand: 'left' | 'right', from: V3, at: V3) => {
    const c = dev().controllers[hand]!
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(...at).sub(new Vector3(...from)).normalize())
    c.position.set(...from)
    c.quaternion.set(quat.x, quat.y, quat.z, quat.w)
  }
  /** Largest distance (m) between presented output dots and the committed targets P v. */
  const outputDeviation = () => {
    const g = app.adapter.viewMathGroup('output')
    g.updateMatrixWorld()
    const desc = app.describeCurrent()
    const dots = (app.adapter as unknown as { dots: { output: Map<string, { mob: { getThreeObject(): { position: Vector3 } } }> } }).dots.output
    let worst = 0
    for (const p of desc.primitives) {
      if (p.kind !== 'point' || p.view !== 'output') continue
      const want = g.localToWorld(new Vector3(...p.at))
      const got = g.localToWorld(dots.get(p.sourceId)!.mob.getThreeObject().position.clone())
      worst = Math.max(worst, want.distanceTo(got))
    }
    return worst
  }
  const sampleWorld = (id: string): V3 => {
    const g = app.adapter.viewMathGroup('input')
    g.updateMatrixWorld()
    const s = app.activeSamples().find((x) => x.id === id)!
    return g.localToWorld(new Vector3(...s.coords.map((c) => Number(c.n) / Number(c.d)))).toArray() as V3
  }
  const outputWorld = (id: string): V3 => {
    const g = app.adapter.viewMathGroup('output')
    g.updateMatrixWorld()
    const rec = (app.adapter as unknown as { dots: { output: Map<string, { mob: { getThreeObject(): { position: Vector3 } } }> } }).dots.output.get(id)!
    return g.localToWorld(rec.mob.getThreeObject().position.clone()).toArray() as V3
  }
  const buttonWorld = (cmd: string): V3 => {
    const b = (app.controls as unknown as { buttons: { command: string; plate: { getWorldPosition(v: Vector3): Vector3 } }[] }).buttons.find((x) => x.command === cmd)!
    return b.plate.getWorldPosition(new Vector3()).toArray() as V3
  }
  /**
   * Review C1 audit of what is RENDERED (not what a slot was asked to show): no typeset geometry under a
   * pending/error state, the drawn plain text equals the current content, and every equation/caption of
   * the current description is visible with exactly that content.
   */
  const renderedAudit = (where: string, problems: string[], seen?: { pending: number; error: number }) => {
    const desc = app.currentDescription()!
    const reports = new Map([...app.adapter.slotReport(), ...app.controls.report()].map((r) => [r.id, r]))
    for (const r of reports.values()) {
      if (!r.visible) continue
      if (r.state === 'fresh' && r.shownKey !== r.wantedKey) problems.push(`${where}: ${r.id} shows content of another key`)
      if (r.state !== 'fresh' && r.typesetAttached > 0) problems.push(`${where}: ${r.id} keeps typeset geometry while ${r.state}`)
      if ((r.state === 'pending' || r.state === 'error') && r.drawnPlain !== r.plain) problems.push(`${where}: ${r.id} draws "${r.drawnPlain}" but represents "${r.plain}"`)
      if (seen && r.state === 'pending') seen.pending++
      if (seen && r.state === 'error') seen.error++
    }
    for (const e of desc.primitives.filter((p): p is EquationDesc => p.kind === 'equation')) {
      const r = reports.get(e.id)
      const shown = r && (r.state === 'fresh' ? r.plain : r.drawnPlain)
      if (!r || !r.visible) problems.push(`${where}: ${e.id} not visible`)
      else if (shown !== e.plain) problems.push(`${where}: ${e.id} shows "${shown}" but the description says "${e.plain}"`)
      const c = reports.get(e.id.replace('eq:', 'caption:'))
      const cs = c && (c.state === 'fresh' ? c.plain : c.drawnPlain)
      if (e.captionPlain && (!c || !c.visible || cs !== e.captionPlain)) problems.push(`${where}: caption of ${e.id} shows "${cs}" (visible ${c?.visible}) but should be "${e.captionPlain}"`)
    }
  }
  /** Frames until the right ray (or grip) is valid again, sampling `read` on every frame before that. */
  const sampleUntilValid = async <T>(read: () => T, which: 'rayValid' | 'gripValid' = 'rayValid') => {
    const samples: T[] = []
    for (let i = 0; i < 200 && !app.input.pointers.get('right')![which]; i++) {
      samples.push(read())
      await waitFrames(1)
    }
    return samples
  }
  /** After a forced loss or a visibility change, poses count again only once they have settled. */
  const waitValid = async (hands: ('left' | 'right')[] = ['right']) => {
    for (let i = 0; i < 200 && !hands.every((h) => { const p = app.input.pointers.get(h)!; return !p.connected || (p.rayValid && p.gripValid) }); i++) await waitFrames(1)
  }
  /** Step preconditions (test isolation): u selected at (1, 0, 1), fiber mode, head/workbench reset,
   *  the full prebuilt token set ready (as after a normal start). */
  const prep = async () => {
    texDebug.delayMs = 0
    texDebug.failPattern = null
    dev().position.set(0, 1.22, 0)
    dev().quaternion.set(0, 0, 0, 1)
    app.input.debugPoseLoss('right', {})
    app.input.debugPoseLoss('left', {})
    app.adapter.bench.position.set(0, 1.02, -0.8)
    app.adapter.bench.rotation.set(0, 0, 0)
    // The suite runs on the P experiment of the demo document (u at (1, 0, 1), selected).
    const ws = app.workspace
    const u = app.activeSamples().find((x) => x.id === U)!
    const isOrigin = u.coords.map((c) => `${c.n}/${c.d}`).join() === '1/1,0/1,1/1'
    const actions: unknown[] = []
    if (!isOrigin) actions.push({ kind: 'update_sample', sampleSetId: app.activeSet().id, sampleId: U, coords: [{ n: '1', d: '1' }, { n: '0', d: '1' }, { n: '1', d: '1' }] })
    if (ws.current.selection.experimentId !== 'exp-p' || ws.current.selection.sampleId !== U) actions.push({ kind: 'select', experimentId: 'exp-p', sampleId: U })
    if (actions.length) ws.commit({ baseRevision: ws.current.revision, actions })
    if (app.mode !== 'fiber') app.command('mode')
    if (app.snapshot().playback.active) app.adapter.setPlayback('finish')
    await app.adapter.prepare(app.describeCurrent())
    for (let i = 0; i < 300 && (texStats.queued > 0 || slotsPending()); i++) await waitFrames(2)
    await waitValid(['right', 'left'])
    await waitFrames(3)
  }
  const slotsPending = () => [...app.adapter.slotReport(), ...app.controls.report()].some((r) => r.visible && r.state === 'pending')
  const near = (a: V3, b: V3, eps = 1e-6) => a.every((v, i) => Math.abs(v - b[i]!) <= eps)
  const groupOf = (id: string) => app.snapshot().collisions.find((g) => g.includes(id)) ?? [id]
  const labelSlots = () => (app.adapter as unknown as { slots: Map<string, { width: number; height: number; anchor: { visible: boolean; matrixWorld: Matrix4 } }> }).slots
  /** Label policy checks (labelOverlap, comparison): wait for layout fades, then project every shown floating
   *  label and fixed scene text into both eye cameras and list overlaps that involve a floating label. */
  const settleLabels = async () => {
    await waitFrames(4)
    for (let i = 0; i < 90 && app.adapter.labelLayoutReport().some((x) => x.alpha !== (x.shown ? 1 : 0)); i++) await waitFrames(1)
    await waitFrames(2)
  }
  const eyeRects = (ids: string[]) => host.renderer.xr.getCamera().cameras.map((cam) => {
    cam.updateMatrixWorld()
    const out: { id: string; x0: number; x1: number; y0: number; y1: number }[] = []
    for (const id of ids) {
      const s = labelSlots().get(id)
      if (!s || !s.anchor.visible || !s.width) continue
      const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new Vector3(sx! * s.width / 2, sy! * s.height / 2, 0).applyMatrix4(s.anchor.matrixWorld).project(cam))
      out.push({ id, x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) })
    }
    return out
  })
  const measureLabels = (name: string) => {
    const report = app.adapter.labelLayoutReport()
    const floating = report.filter((x) => x.shown && x.alpha === 1).map((x) => x.id)
    const fixed = [...labelSlots().keys()].filter((id) => /^(eq:|caption:|title:|axis:)/.test(id) || id === 'lbl:plane' || id === 'lbl:fiber')
    const overlaps: string[] = []
    eyeRects([...floating, ...fixed]).forEach((rects, eye) => {
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!
        const b = rects[j]!
        if (!floating.includes(a.id) && !floating.includes(b.id)) continue
        const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
        const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
        if (w > 1e-4 && h > 1e-4) overlaps.push(`eye${eye}: ${a.id} x ${b.id}`)
      }
    })
    const must = report.filter((x) => x.mustShow)
    return { name, mustShown: must.length > 0 && must.every((x) => x.shown && x.alpha === 1), hidden: report.filter((x) => !x.shown).map((x) => x.id), leaders: report.filter((x) => x.leader).map((x) => x.id), overlaps, readout: app.adapter.slotReport().find((r) => r.id === 'eq:out' && r.visible)?.plain ?? null }
  }
  const U = 's(1,0,1)'
  const V = 's(1,0,-1)'
  const A = 's(1,1,0)'
  const B = 's(-1,1,0)'

  const steps: Record<string, () => Promise<StepResult>> = {
    async session() {
      if (!host.presenting) await host.enterXR()
      dev().position.set(0, 1.22, 0)
      // The scheduler audit buckets per second: wait for a bucket that is entirely inside the session.
      await new Promise((r) => setTimeout(r, 2200))
      await waitFrames(2)
      const xr = host.renderer.xr
      const eyes = xr.getCamera().cameras.map((c) => c.viewport.toArray())
      const sched = schedulerReport().lastSecond
      const sess = xr.getSession() as XRSession & { enabledFeatures?: string[] }
      return {
        step: 'session',
        pass: host.presenting && eyes.length === 2 && sched.xrRaf.distinctCallbacks === 1 && schedulerReport().manimWebTimers.length === 0,
        detail: { eyes, sched, enabledFeatures: sess?.enabledFeatures, manimWebTimers: schedulerReport().manimWebTimers.length, perf: host.perf() },
      }
    },

    /** R6.4: grab the handle, slide along the fiber, release once; the output must not move. */
    async fiberDrag() {
      if (app.mode !== 'fiber') app.command('mode')
      const before = app.snapshot()
      const out0 = outputWorld(U)
      const grp0 = groupOf(U)
      const H = sampleWorld(U)
      aim(HAND_FROM, H)
      await waitFrames(3)
      await button('trigger', 1)
      const started = app.snapshot().dragging
      for (const dz of [0.4, 0.9, 1.375]) {
        aim(HAND_FROM, [H[0], H[1] + dz * 0.085, H[2]])
        await waitFrames(3)
      }
      const preview = app.snapshot().dragging?.preview ?? null
      const outDuring = outputWorld(U)
      await button('trigger', 0)
      const after = app.snapshot()
      const out1 = outputWorld(U)
      return {
        step: 'fiberDrag',
        pass: !!started && started.mode === 'fiber' && after.mathRevision === before.mathRevision + 1 && after.revision === before.revision + 1 &&
          near(out0, outDuring) && near(out0, out1) && JSON.stringify(groupOf(U)) === JSON.stringify(grp0),
        detail: { started, preview, before: before.selected, after: after.selected, revisions: [before.revision, after.revision], mathRevisions: [before.mathRevision, after.mathRevision], outputWorld: { before: out0, during: outDuring, after: out1 }, group: groupOf(U) },
      }
    },

    /** R6.3 / A2: pause mid-transition, move the head; eyes follow, playback frozen. */
    async pauseHead() {
      dev().position.set(0, 1.22, 0)
      app.command('replay')
      await waitFrames(80)
      app.command('pause')
      await waitFrames(2)
      const t0 = app.snapshot().playback
      const xr = host.renderer.xr
      const eyes = () => xr.getCamera().cameras.map((c) => {
        c.updateMatrixWorld()
        return [c.matrixWorld.elements[12], c.matrixWorld.elements[13], c.matrixWorld.elements[14]].map((v) => +v!.toFixed(4))
      })
      const e0 = eyes()
      const frames0 = host.perf().frames
      dev().position.set(0.3, 1.26, 0.05)
      dev().quaternion.set(0, Math.sin(0.25), 0, Math.cos(0.25))
      await waitFrames(30)
      const e1 = eyes()
      const t1 = app.snapshot().playback
      dev().position.set(0, 1.22, 0)
      dev().quaternion.set(0, 0, 0, 1)
      await waitFrames(5)
      return {
        step: 'pauseHead',
        pass: t0.active && !t0.playing && t1.time === t0.time && t1.phase === t0.phase && !near(e0[0] as V3, e1[0] as V3, 0.01) && host.perf().frames >= Math.min(frames0, 900),
        detail: { pausedAt: t0, after30Frames: t1, eyesBefore: e0, eyesAfter: e1 },
      }
    },

    /** R5 / M7: grabbing during playback shows the committed target first; release without motion commits nothing. */
    async interrupt() {
      app.command('replay')
      await waitFrames(60)
      const during = app.snapshot().playback
      const before = app.snapshot()
      const canceled0 = app.adapter.stats.canceled
      aim(HAND_FROM, sampleWorld(U))
      await waitFrames(3)
      await button('trigger', 1)
      const pressed = app.snapshot()
      await button('trigger', 0)
      const after = app.snapshot()
      return {
        step: 'interrupt',
        pass: during.active && during.playing && !pressed.playback.active && !!pressed.dragging && app.adapter.stats.canceled === canceled0 + 1 && after.revision === before.revision,
        detail: { during, afterPress: { playback: pressed.playback, dragging: pressed.dragging }, revisions: [before.revision, after.revision] },
      }
    },

    /** Spatial control by controller ray, then a free move that splits the exact group; Undo restores it. */
    async freeMoveUndo() {
      dev().position.set(0, 1.22, 0)
      if (app.mode !== 'fiber') app.command('mode')
      const btn = buttonWorld('mode')
      aim(HAND_FROM, btn)
      await waitFrames(3)
      await button('trigger', 1)
      await button('trigger', 0)
      const modeAfterClick = app.mode
      const before = app.snapshot()
      const grp0 = groupOf(U)
      const H = sampleWorld(U)
      aim(HAND_FROM, H)
      await waitFrames(3)
      await button('trigger', 1)
      aim(HAND_FROM, [H[0] - 0.5 * 0.085 * Math.cos(0.22), H[1], H[2] - 0.5 * 0.085 * Math.sin(0.22)])
      await waitFrames(4)
      await button('trigger', 0)
      const moved = app.snapshot()
      const grp1 = groupOf(U)
      aim(HAND_FROM, buttonWorld('undo'))
      await waitFrames(3)
      await button('trigger', 1)
      await button('trigger', 0)
      const undone = app.snapshot()
      if (app.mode !== 'fiber') app.command('mode')
      return {
        step: 'freeMoveUndo',
        pass: modeAfterClick === 'free' && moved.mathRevision === before.mathRevision + 1 && !grp1.includes(V) && undone.selected === before.selected && JSON.stringify(groupOf(U)) === JSON.stringify(grp0),
        detail: { modeAfterClick, before: before.selected, moved: moved.selected, groupBefore: grp0, groupAfterMove: grp1, undone: undone.selected, revisions: [before.revision, moved.revision, undone.revision] },
      }
    },

    /** Selecting an output point selects its sample (linked identity), seen through the controller ray. */
    async selectOutput() {
      const target = outputWorld(V)
      aim(HAND_FROM, target)
      await waitFrames(3)
      await button('trigger', 1)
      await button('trigger', 0)
      const s = app.snapshot()
      // restore the demonstration selection
      aim(HAND_FROM, sampleWorld(U))
      await waitFrames(3)
      await button('trigger', 1)
      await button('trigger', 0)
      return { step: 'selectOutput', pass: s.selection === V || groupOf(U).includes(s.selection ?? ''), detail: { selectedAfterOutputClick: s.selection, note: 'coincident outputs: the nearest proxy wins; the legend/group keeps every identity', restored: app.snapshot().selection } }
    },

    /** M2 / A2: moving the workbench is presentation; mathematics and revisions do not change. */
    async bench() {
      const before = app.snapshot()
      const p0 = app.adapter.bench.position.clone()
      aim(HAND_FROM, [0, 1.0, -0.8])
      await waitFrames(3)
      await button('squeeze', 1)
      const c = dev().controllers.right!
      c.position.set(HAND_FROM[0] + 0.12, HAND_FROM[1] + 0.03, HAND_FROM[2])
      await waitFrames(6)
      await button('squeeze', 0)
      const after = app.snapshot()
      const moved = app.adapter.bench.position.distanceTo(p0)
      app.adapter.bench.position.copy(p0)
      app.adapter.bench.rotation.set(0, 0, 0)
      await waitFrames(2)
      return { step: 'bench', pass: moved > 0.05 && after.mathRevision === before.mathRevision && after.revision === before.revision, detail: { movedMetres: +moved.toFixed(3), revisions: [before.revision, after.revision], mathRevisions: [before.mathRevision, after.mathRevision] } }
    },

    /** R6.6: replace/dispose the visual adapter 10 times; resource counts must stabilise. */
    async cycle() {
      await waitFrames(5)
      const info = () => ({ ...host.perf().info, objects: app.adapter.census().objects })
      const before = info()
      const per: unknown[] = []
      const built0 = texStats.built
      const disposed0 = texStats.disposed
      for (let i = 0; i < 10; i++) {
        clearTexCache() // force every equation to be re-typeset and the old geometry disposed
        await app.remount()
        // Measure only once the text has settled (pending fallbacks hold canvas textures meanwhile).
        for (let k = 0; k < 200 && (texStats.queued > 0 || app.textPending()); k++) await waitFrames(2)
        await waitFrames(6)
        per.push(info())
      }
      const after = info()
      return {
        step: 'cycle',
        // Stable after warm-up: every cycle leaves identical counts, and nothing grows past the first mount.
        pass: per.every((x) => JSON.stringify(x) === JSON.stringify(per[0])) && after.geometries <= before.geometries && after.textures <= before.textures,
        detail: { before, after, perCycle: per, equationsTypeset: texStats.built - built0, equationsDisposed: texStats.disposed - disposed0 },
      }
    },

    /** Review F1: a press slightly off the handle centre, released without motion, commits nothing. */
    async zeroMotionClick() {
      const before = app.snapshot()
      const H = sampleWorld(U)
      for (const off of [[0.006, 0], [-0.009, 0.004], [0, 0.008]] as const) {
        aim(HAND_FROM, [H[0] + off[0], H[1] + off[1], H[2]])
        await waitFrames(3)
        await button('trigger', 1)
        await waitFrames(4)
        await button('trigger', 0)
      }
      const after = app.snapshot()
      return { step: 'zeroMotionClick', pass: after.revision === before.revision && after.selected === before.selected, detail: { before: before.selected, after: after.selected, revisions: [before.revision, after.revision] } }
    },

    /** Review F2: finishing a transition during 'introduce' shows every output at its committed target. */
    async finishEarly() {
      app.command('replay')
      await waitFrames(12)
      const t = app.snapshot().playback
      aim(HAND_FROM, sampleWorld(U))
      await waitFrames(2)
      await button('trigger', 1)
      await button('trigger', 0)
      await waitFrames(3)
      const dev = outputDeviation()
      return { step: 'finishEarly', pass: t.active && t.phase === 'introduce' && !app.snapshot().playback.active && dev < 1e-6, detail: { interruptedAt: t, maxOutputDeviationM: dev } }
    },

    /** Review F3: A (play) during a drag cancels the drag and replays the COMMITTED state. */
    async replayDuringDrag() {
      if (app.mode !== 'fiber') app.command('mode')
      const before = app.snapshot()
      const H = sampleWorld(U)
      aim(HAND_FROM, H)
      await waitFrames(3)
      await button('trigger', 1)
      aim(HAND_FROM, [H[0], H[1] + 0.12, H[2]])
      await waitFrames(4)
      const preview = app.snapshot().dragging?.preview
      await button('a-button', 1, 2)
      await button('a-button', 0, 2)
      const mid = app.snapshot()
      await button('trigger', 0)
      for (let i = 0; i < 60 && app.snapshot().playback.active; i++) await new Promise((r) => setTimeout(r, 100))
      await waitFrames(3)
      const dev = outputDeviation()
      const after = app.snapshot()
      return {
        step: 'replayDuringDrag',
        pass: !!preview && preview !== before.selected && !mid.dragging && after.revision === before.revision && dev < 1e-6,
        detail: { preview, draggingAfterA: mid.dragging, playbackAfterA: mid.playback.phase, revisions: [before.revision, after.revision], maxOutputDeviationM: dev },
      }
    },

    /** Review F4: while the right hand drags, a left-hand press on another point changes nothing; release commits. */
    async twoPointers() {
      const before = app.snapshot()
      const H = sampleWorld(U)
      aim(HAND_FROM, H)
      await waitFrames(3)
      await button('trigger', 1)
      aim(HAND_FROM, [H[0], H[1] + 0.06, H[2]])
      await waitFrames(4)
      aimHand('left', [-0.2, 0.95, -0.25], sampleWorld('s(-1,0,1)'))
      await waitFrames(3)
      await button('trigger', 1, 3, 'left')
      await button('trigger', 0, 3, 'left')
      const during = app.snapshot()
      await button('trigger', 0)
      const after = app.snapshot()
      app.workspace.undo()
      await waitFrames(3)
      return {
        step: 'twoPointers',
        pass: during.selection === U && after.mathRevision === before.mathRevision + 1 && app.lastError === null,
        detail: { selectionDuringLeftPress: during.selection, committed: after.selected, mathRevisions: [before.mathRevision, after.mathRevision], lastError: app.lastError },
      }
    },

    /** R6.5: pick and select from an oblique head pose (0.3 m right, yawed), then restore. */
    async obliquePick() {
      dev().position.set(0.3, 1.24, 0.05)
      dev().quaternion.set(0, Math.sin(0.25), 0, Math.cos(0.25))
      await waitFrames(5)
      const from: V3 = [0.42, 0.98, -0.2]
      aim(from, sampleWorld(V))
      await waitFrames(3)
      await button('trigger', 1)
      await button('trigger', 0)
      const picked = app.snapshot().selection
      aim(from, sampleWorld(U))
      await waitFrames(3)
      await button('trigger', 1)
      await button('trigger', 0)
      const restored = app.snapshot().selection
      dev().position.set(0, 1.22, 0)
      dev().quaternion.set(0, 0, 0, 1)
      await waitFrames(3)
      return { step: 'obliquePick', pass: picked === V && restored === U, detail: { picked, restored } }
    },

    /**
     * Review C1: no equation or equality label may look current when it belongs to an older state.
     * Builds are delayed (and later forced to fail) through the texDebug seam while the selection, a
     * preview/commit, a group split, a cancel and an undo change the readouts.
     */
    async freshness() {
      await prep()
      const problems: string[] = []
      const seen = { pending: 0, error: 0, tokenPending: 0 }
      const audit = (where: string) => renderedAudit(where, problems, seen)
      const press = async (at: V3) => {
        aim(HAND_FROM, at)
        await waitFrames(2)
        await button('trigger', 1, 2)
        await button('trigger', 0, 2)
      }
      dev().position.set(0, 1.22, 0)
      dev().quaternion.set(0, 0, 0, 1)
      if (app.mode !== 'fiber') app.command('mode')
      texDebug.delayMs = 700
      // 1. rapid selection changes (each through the controller), audited every frame between them
      for (const id of [V, 's(1,0,0)', 's(-1,1,1)', U]) {
        await press(sampleWorld(id))
        audit(`select ${id}`)
      }
      // 2. preview then commit along the fiber
      const H = sampleWorld(U)
      aim(HAND_FROM, H)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H[0], H[1] + 0.07, H[2]])
      await waitFrames(4)
      audit('fiber preview')
      await button('trigger', 0)
      audit('fiber commit')
      // 3. free move that splits the exact group: the "3 samples share" caption must not survive
      if (app.mode !== 'free') app.command('mode')
      const H2 = sampleWorld(U)
      aim(HAND_FROM, H2)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H2[0] - 0.045, H2[1], H2[2] - 0.01])
      await waitFrames(4)
      await button('trigger', 0)
      const afterSplit = app.adapter.slotReport().find((r) => r.id === 'caption:out')!
      audit('group split')
      // 4. cancel a preview with B
      const H3 = sampleWorld(U)
      aim(HAND_FROM, H3)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H3[0] + 0.05, H3[1] + 0.02, H3[2]])
      await waitFrames(4)
      dev().controllers.right!.updateButtonValue('b-button', 1)
      await waitFrames(2)
      dev().controllers.right!.updateButtonValue('b-button', 0)
      await waitFrames(2)
      await button('trigger', 0)
      audit('cancel')
      // 5. undo (Undo button) twice: back to the shared group
      for (let i = 0; i < 2; i++) {
        aim(HAND_FROM, buttonWorld('undo'))
        await waitFrames(2)
        await button('trigger', 1, 2)
        await button('trigger', 0, 2)
        audit(`undo ${i + 1}`)
      }
      for (let i = 0; i < 60 && slotsPending(); i++) await waitFrames(3)
      audit('settled')
      // 6. forced failure: the split caption cannot be typeset -> explicit error state, scene still works
      texDebug.delayMs = 0
      texDebug.failPattern = /no other sample/
      clearTokens() // the caption phrase is a prebuilt token: drop it so its rebuild fails
      if (app.mode !== 'free') app.command('mode')
      const H4 = sampleWorld(U)
      aim(HAND_FROM, H4)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H4[0] - 0.045, H4[1], H4[2] - 0.01])
      await waitFrames(4)
      await button('trigger', 0)
      for (let i = 0; i < 40 && app.adapter.slotReport().find((r) => r.id === 'caption:out')!.state !== 'error'; i++) await waitFrames(2)
      const failed = app.adapter.slotReport().find((r) => r.id === 'caption:out')!
      audit('forced failure')
      app.workspace.undo()
      await waitFrames(3)
      audit('undo after failure')
      texDebug.failPattern = null
      clearTokens() // forget the recorded failure
      if (app.mode !== 'fiber') app.command('mode')
      // 7. readouts pending THROUGH a group split: tokens cleared and their rebuilds delayed while a free
      //    drag crosses several preview values; audited every frame (review C1-a/C1-d)
      clearTokens()
      texDebug.delayMs = 400
      if (app.mode !== 'free') app.command('mode')
      const H5 = sampleWorld(U)
      aim(HAND_FROM, H5)
      await waitFrames(2)
      await button('trigger', 1)
      for (let i = 1; i <= 12; i++) {
        aim(HAND_FROM, [H5[0] - 0.006 * i, H5[1], H5[2] - 0.0015 * i])
        await waitFrames(1)
        audit(`pending split frame ${i}`)
        if (app.adapter.slotReport().find((r) => r.id === 'eq:out')?.state === 'pending') seen.tokenPending++
      }
      await button('trigger', 0)
      audit('pending split commit')
      app.workspace.undo()
      await waitFrames(2)
      audit('pending split undo')
      if (app.mode !== 'fiber') app.command('mode')
      texDebug.delayMs = 0
      for (let i = 0; i < 200 && slotsPending(); i++) await waitFrames(3)
      // 8. a glyph token that fails to build: the readout needing it shows an explicit error, the rest works
      await prep() // u back at (1, 0, 1), fiber mode, tokens ready
      texDebug.failPattern = /tfrac\{5\}\{8\}/
      clearTokens()
      const H6 = sampleWorld(U)
      aim(HAND_FROM, H6)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H6[0], H6[1] - 0.085 * (3 / 8), H6[2]]) // u_z: 1 -> 5/8
      for (let i = 0; i < 120 && app.adapter.slotReport().find((r) => r.id === 'eq:sel')?.state !== 'error'; i++) await waitFrames(2)
      const tokenFailure = app.adapter.slotReport().find((r) => r.id === 'eq:sel')!
      audit('token failure')
      await button('trigger', 0)
      app.workspace.undo()
      texDebug.failPattern = null
      clearTokens() // drop the recorded failure so the token can be built again
      await press(sampleWorld(V))
      const tokenSlot = app.adapter.slotReport().find((r) => r.id === 'eq:sel')!
      audit('tokens rebuilding')
      for (let i = 0; i < 200 && app.adapter.slotReport().find((r) => r.id === 'eq:sel')!.state !== 'fresh'; i++) await waitFrames(3)
      await press(sampleWorld(U))
      for (let i = 0; i < 60 && slotsPending(); i++) await waitFrames(3)
      audit('final')
      return {
        step: 'freshness',
        pass: problems.length === 0 && seen.pending > 0 && failed.state === 'error' && seen.tokenPending > 0 && afterSplit.plain === 'no other sample shares this output' && tokenFailure.state === 'error' && tokenFailure.drawnPlain === tokenFailure.plain && host.errors.count === 0,
        detail: { problems: problems.slice(0, 12), problemCount: problems.length, seen, captionAfterSplit: { state: afterSplit.state, plain: afterSplit.plain, drawn: afterSplit.drawnPlain }, forcedFailure: { state: failed.state, plain: failed.plain, drawn: failed.drawnPlain, error: failed.error }, tokenFailure: { state: tokenFailure.state, drawn: tokenFailure.drawnPlain, error: tokenFailure.error }, tokenSlotWhileRebuilding: { state: tokenSlot.state, plain: tokenSlot.plain, drawn: tokenSlot.drawnPlain }, slotStats: { ...slotStats }, tokenStats: { ...tokenStats } },
      }
    },

    /** Review C3: paused in 'move' for 40+ frames while the head moves: no geometry work; billboards still update. */
    async pausedEfficiency() {
      dev().position.set(0, 1.22, 0)
      dev().quaternion.set(0, 0, 0, 1)
      app.command('replay')
      // Warm-up: sweep the head along the same path while playback runs, so objects first seen from the
      // moved viewpoint get their one-time GPU upload now (renderer.info counts geometries at first render,
      // not at creation); the paused window below then measures only per-frame work.
      for (let i = 0; i < 45; i++) {
        const k = Math.sin((i / 45) * Math.PI)
        dev().position.set(0.3 * k, 1.22 + 0.03 * k, 0.05 * k)
        dev().quaternion.set(0, Math.sin(0.25 * k), 0, Math.cos(0.25 * k))
        await waitFrames(1)
      }
      dev().position.set(0, 1.22, 0)
      dev().quaternion.set(0, 0, 0, 1)
      await waitFrames(35)
      app.command('pause')
      await waitFrames(3)
      const pb0 = app.snapshot().playback
      const st = app.adapter.stats
      const snap = () => ({ evaluations: st.evaluations, arrowRebuilds: st.arrowRebuilds, dotMoves: st.dotMoves, policyPasses: st.policyPasses, geometries: host.renderer.info.memory.geometries, billboards: st.billboards })
      const label = (app.adapter as unknown as { slots: Map<string, { anchor: { quaternion: { toArray(): number[] } } }> }).slots.get(`lbl:mov:${U}`)
      const eyes = () => host.renderer.xr.getCamera().cameras.map((c) => c.matrixWorld.elements.slice(12, 15).map((v) => +v.toFixed(4)))
      const a = snap()
      const q0 = label?.anchor.quaternion.toArray().map((v) => +v.toFixed(4))
      const e0 = eyes()
      for (let i = 0; i < 45; i++) {
        const k = Math.sin((i / 45) * Math.PI)
        dev().position.set(0.3 * k, 1.22 + 0.03 * k, 0.05 * k)
        dev().quaternion.set(0, Math.sin(0.25 * k), 0, Math.cos(0.25 * k))
        await waitFrames(1)
      }
      const b = snap()
      const q1 = label?.anchor.quaternion.toArray().map((v) => +v.toFixed(4))
      const e1 = eyes()
      const pb1 = app.snapshot().playback
      // seek and interruption still land on the committed target
      app.adapter.setPlayback({ seek: 2.0 })
      await waitFrames(2)
      const afterSeek = snap()
      app.command('play')
      for (let i = 0; i < 40 && app.snapshot().playback.active; i++) await new Promise((r) => setTimeout(r, 100))
      await waitFrames(3)
      const devAfter = outputDeviation()
      dev().position.set(0, 1.22, 0)
      dev().quaternion.set(0, 0, 0, 1)
      return {
        step: 'pausedEfficiency',
        pass: pb0.phase === 'move' && !pb0.playing && pb1.time === pb0.time && a.evaluations === b.evaluations && a.arrowRebuilds === b.arrowRebuilds && a.dotMoves === b.dotMoves && a.geometries === b.geometries && a.policyPasses === b.policyPasses && b.billboards - a.billboards >= 45 && JSON.stringify(q0) !== JSON.stringify(q1) && JSON.stringify(e0) !== JSON.stringify(e1) && afterSeek.evaluations > b.evaluations && devAfter < 1e-6,
        detail: { pausedAt: pb0, after45Frames: { time: pb1.time }, countersBefore: a, countersAfter: b, movingLabelQuaternion: { before: q0, after: q1 }, eyes: { before: e0, after: e1 }, evaluationsAfterSeek: afterSeek.evaluations, outputDeviationAfterPlayM: devAfter },
      }
    },

    /** Review C4: the toggle label follows automatic completion, and idle frames rebuild no text. */
    async playbackLabels() {
      const L = () => app.controls.label('toggle')
      const idle0 = L()
      const r0 = app.stats.refreshes
      app.command('replay')
      await waitFrames(2)
      const playing = L()
      for (let i = 0; i < 50 && app.snapshot().playback.active; i++) await new Promise((r) => setTimeout(r, 100))
      await waitFrames(2)
      const done = L()
      const refreshesForReplay = app.stats.refreshes - r0
      const c0 = { ...app.controls.stats }
      const s0 = slotStats.sets
      const r1 = app.stats.refreshes
      await waitFrames(60)
      const c1 = { ...app.controls.stats }
      const s1 = slotStats.sets
      const refreshesIdle = app.stats.refreshes - r1
      return {
        step: 'playbackLabels',
        // refreshControls is driven by playback-state flips, not frames: about two for a whole replay, none idle.
        pass: idle0 === 'Play' && playing === 'Pause' && done === 'Play' && refreshesForReplay <= 3 && refreshesIdle === 0 && c0.labelChanges === c1.labelChanges && c0.statusChanges === c1.statusChanges && s0 === s1,
        detail: { beforeReplay: idle0, whilePlaying: playing, afterAutoCompletion: done, refreshesForReplay, refreshesOver60IdleFrames: refreshesIdle, controlChangesOver60IdleFrames: c1.labelChanges - c0.labelChanges + c1.statusChanges - c0.statusChanges, slotSetsOver60IdleFrames: s1 - s0 },
      }
    },

    /** Review C2: lose the ray pose mid-drag, move, reacquire elsewhere: no use of stale poses, no jump. */
    async rayLossDrag() {
      await prep()
      if (app.mode !== 'fiber') app.command('mode')
      const before = app.snapshot()
      const H = sampleWorld(U)
      aim(HAND_FROM, H)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H[0], H[1] + 0.0425, H[2]]) // +1/2 unit
      await waitFrames(4)
      const p1 = app.snapshot().dragging?.preview
      app.input.debugPoseLoss('right', { ray: true })
      await waitFrames(3)
      aim(HAND_FROM, [H[0], H[1] + 0.17, H[2]]) // would be +2 units if the stale/hidden pose were used
      await waitFrames(10)
      const whileLost = app.snapshot()
      app.input.debugPoseLoss('right', {})
      await waitFrames(3)
      const whileSettling = app.snapshot().dragging?.preview
      await waitValid()
      await waitFrames(1)
      const afterReacquire = app.snapshot().dragging?.preview
      aim(HAND_FROM, [H[0], H[1] + 0.17 + 0.0213, H[2]]) // +1/4 unit relative to the reacquired pose
      await waitFrames(4)
      const relative = app.snapshot().dragging?.preview
      await button('trigger', 0)
      const committed = app.snapshot()
      app.workspace.undo()
      await waitFrames(3)
      // released while lost => cancelled, nothing committed
      const H2 = sampleWorld(U)
      aim(HAND_FROM, H2)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H2[0], H2[1] + 0.06, H2[2]])
      await waitFrames(4)
      app.input.debugPoseLoss('right', { ray: true })
      await waitFrames(2)
      await button('trigger', 0)
      app.input.debugPoseLoss('right', {})
      await waitValid()
      await waitFrames(1)
      const afterLostRelease = app.snapshot()
      // lost for longer than the timeout => cancelled
      aim(HAND_FROM, H2)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H2[0], H2[1] + 0.06, H2[2]])
      await waitFrames(4)
      app.input.debugPoseLoss('right', { ray: true })
      await new Promise((r) => setTimeout(r, app.trackingTimeout * 1000 + 400))
      await waitFrames(3)
      const afterTimeout = app.snapshot()
      app.input.debugPoseLoss('right', {})
      await button('trigger', 0)
      await waitFrames(2)
      return {
        step: 'rayLossDrag',
        pass: !!p1 && whileLost.dragging?.preview === p1 && whileLost.revision === before.revision && whileSettling === p1 && afterReacquire === p1 && relative !== p1 && committed.revision === before.revision + 1 && committed.selected === relative &&
          afterLostRelease.revision === before.revision + 2 && afterLostRelease.selected === before.selected && !afterLostRelease.dragging && !afterTimeout.dragging && afterTimeout.revision === afterLostRelease.revision,
        detail: { previewBeforeLoss: p1, previewWhileLost: whileLost.dragging?.preview, previewWhileSettling: whileSettling, previewRightAfterReacquire: afterReacquire, previewAfterRelativeMove: relative, committed: committed.selected, releasedWhileLost: { selected: afterLostRelease.selected, revision: afterLostRelease.revision }, timeout: { dragging: afterTimeout.dragging, revision: afterTimeout.revision }, log: app.log.slice(-8).map((l) => l.event) },
      }
    },

    /** Review C2: lose the grip pose while moving the workbench: it holds still, re-anchors on return. */
    async gripLossBench() {
      await prep()
      const before = app.snapshot()
      const p0 = app.adapter.bench.position.clone()
      const c = dev().controllers.right!
      aim(HAND_FROM, [0, 1.0, -0.8])
      await waitFrames(2)
      await button('squeeze', 1)
      c.position.set(HAND_FROM[0] + 0.1, HAND_FROM[1], HAND_FROM[2])
      await waitFrames(4)
      const moved = app.adapter.bench.position.clone()
      app.input.debugPoseLoss('right', { grip: true })
      await waitFrames(2)
      c.position.set(HAND_FROM[0] + 0.4, HAND_FROM[1] + 0.2, HAND_FROM[2])
      await waitFrames(8)
      const whileLost = app.adapter.bench.position.clone()
      app.input.debugPoseLoss('right', {})
      // what Quest reported after reacquisition: uncorrected positions first, then the corrected pose
      // (two uncorrected frames, inside the settle window)
      c.position.set(HAND_FROM[0] + 0.9, HAND_FROM[1] + 0.6, HAND_FROM[2])
      const settling: number[] = []
      for (let i = 0; i < 2; i++) {
        await waitFrames(1)
        settling.push(app.adapter.bench.position.distanceTo(moved))
      }
      c.position.set(HAND_FROM[0] + 0.4, HAND_FROM[1] + 0.2, HAND_FROM[2])
      settling.push(...(await sampleUntilValid(() => app.adapter.bench.position.distanceTo(moved), 'gripValid')))
      await waitFrames(1)
      const afterReacquire = app.adapter.bench.position.clone()
      c.position.set(HAND_FROM[0] + 0.45, HAND_FROM[1] + 0.2, HAND_FROM[2])
      await waitFrames(4)
      const relative = app.adapter.bench.position.clone()
      await button('squeeze', 0)
      const after = app.snapshot()
      app.adapter.bench.position.copy(p0)
      app.adapter.bench.rotation.set(0, 0, 0)
      await waitFrames(2)
      return {
        step: 'gripLossBench',
        pass: moved.distanceTo(p0) > 0.05 && whileLost.distanceTo(moved) < 1e-9 && settling.length > 1 && Math.max(...settling) < 1e-9 && afterReacquire.distanceTo(moved) < 1e-9 && Math.abs(relative.distanceTo(afterReacquire) - 0.05) < 0.005 && after.mathRevision === before.mathRevision,
        detail: { movedM: +moved.distanceTo(p0).toFixed(4), driftWhileLostM: +whileLost.distanceTo(moved).toFixed(6), settlingFrames: settling.length, maxDriftWhileSettlingM: +Math.max(...settling).toFixed(6), jumpOnReacquireM: +afterReacquire.distanceTo(moved).toFixed(6), relativeMoveM: +relative.distanceTo(afterReacquire).toFixed(4), mathRevisions: [before.mathRevision, after.mathRevision] },
      }
    },

    /** Review C2: without a valid pose, a press starts no selection or drag and a squeeze no workbench move. */
    async staleNoStart() {
      await prep()
      const before = app.snapshot()
      const s0 = { ...app.stats }
      app.input.debugPoseLoss('right', { ray: true, grip: true })
      aim(HAND_FROM, sampleWorld(V))
      await waitFrames(2)
      await button('trigger', 1)
      await button('trigger', 0)
      aim(HAND_FROM, sampleWorld(U))
      await waitFrames(2)
      await button('trigger', 1)
      const dragging = app.snapshot().dragging
      await button('trigger', 0)
      await button('squeeze', 1)
      const bench = app.snapshot().benchMoving
      await button('squeeze', 0)
      app.input.debugPoseLoss('right', {})
      await waitFrames(2)
      const after = app.snapshot()
      return {
        step: 'staleNoStart',
        pass: after.selection === before.selection && after.revision === before.revision && !dragging && !bench && app.stats.ignoredPresses >= s0.ignoredPresses + 2 && app.stats.ignoredGrips >= s0.ignoredGrips + 1,
        detail: { selection: after.selection, dragging, benchMoving: bench, ignoredPresses: app.stats.ignoredPresses - s0.ignoredPresses, ignoredGrips: app.stats.ignoredGrips - s0.ignoredGrips },
      }
    },

    /**
     * Device findings (Quest 3S): out of camera view the runtime reports poses with emulatedPosition = true,
     * not null, and a reacquired controller is reported at an uncorrected position for its first frames.
     * An emulated pose counts as lost: it freezes a drag, holds the workbench and starts nothing. After
     * return nothing moves until the pose has settled; then the drag re-anchors (no jump).
     */
    async emulatedPose() {
      await prep()
      if (app.mode !== 'fiber') app.command('mode')
      const before = app.snapshot()
      const s0 = { ...app.stats }
      const H = sampleWorld(U)
      aim(HAND_FROM, H)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H[0], H[1] + 0.0425, H[2]])
      await waitFrames(4)
      const p1 = app.snapshot().dragging?.preview
      app.input.debugPoseLoss('right', { rayEmulated: true, gripEmulated: true })
      aim(HAND_FROM, [H[0], H[1] + 0.17, H[2]])
      await waitFrames(8)
      const whileEmulated = app.snapshot().dragging?.preview
      const rayPose = app.input.pointers.get('right')!.rayPose
      app.input.debugPoseLoss('right', {})
      // two uncorrected frames far from the hand (what the device reported), then the corrected pose
      aim(HAND_FROM, [H[0], H[1] + 0.4, H[2]])
      await waitFrames(2)
      aim(HAND_FROM, [H[0], H[1] + 0.17, H[2]])
      const settling = new Set<string | null | undefined>()
      for (let i = 0; i < 200 && !app.input.pointers.get('right')!.rayValid; i++) {
        settling.add(app.snapshot().dragging?.preview)
        await waitFrames(1)
      }
      await waitFrames(1)
      const afterReturn = app.snapshot().dragging?.preview
      aim(HAND_FROM, [H[0], H[1] + 0.17 + 0.0213, H[2]]) // +1/4 unit relative to the corrected pose
      await waitFrames(4)
      const relative = app.snapshot().dragging?.preview
      await button('trigger', 0)
      const committed = app.snapshot()
      app.workspace.undo()
      await waitFrames(2)
      // an emulated grip starts no workbench move
      app.input.debugPoseLoss('right', { gripEmulated: true })
      aim(HAND_FROM, [0, 1.0, -0.8])
      await waitFrames(2)
      await button('squeeze', 1)
      const benchStarted = app.snapshot().benchMoving
      await button('squeeze', 0)
      app.input.debugPoseLoss('right', {})
      await waitFrames(2)
      const ignored = app.log.filter((l) => l.event === 'gripIgnored').slice(-1)[0]?.detail as { gripPose?: string } | undefined
      return {
        step: 'emulatedPose',
        pass: !!p1 && rayPose === 'emulated' && whileEmulated === p1 && settling.size === 1 && settling.has(p1) && afterReturn === p1 && !!relative && relative !== p1 && committed.revision === before.revision + 1 && committed.selected === relative && !benchStarted && app.stats.ignoredGrips === s0.ignoredGrips + 1 && ignored?.gripPose === 'emulated',
        detail: { previewBefore: p1, rayPose, previewWhileEmulated: whileEmulated, previewsWhileSettling: [...settling], previewAfterReturn: afterReturn, previewAfterRelativeMove: relative, committed: committed.selected, benchStartedOnEmulatedGrip: benchStarted, gripIgnored: ignored },
      }
    },

    /**
     * Review finding: in free mode a reacquired ray that points away from the drag plane (more than 90
     * degrees from the drag-start direction) cannot re-anchor. Tracking counts as back (no "lost" status,
     * no timeout while tracked); the preview stays frozen and re-anchors once the ray reaches the plane.
     */
    async reacquireAway() {
      await prep()
      if (app.mode !== 'free') app.command('mode')
      const before = app.snapshot()
      const H = sampleWorld(U)
      aim(HAND_FROM, H)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H[0] + 0.0425, H[1], H[2]])
      await waitFrames(4)
      const p1 = app.snapshot().dragging?.preview
      app.input.debugPoseLoss('right', { rayEmulated: true })
      await waitFrames(3)
      // back, but pointing behind the user (away from the drag plane)
      aim(HAND_FROM, [HAND_FROM[0], HAND_FROM[1] + 0.2, HAND_FROM[2] + 1])
      app.input.debugPoseLoss('right', {})
      await waitValid()
      await waitFrames(2)
      const statusTracked = !app.controls.report().some((r) => r.id === 'status' && /tracking lost/.test(String(r.plain)))
      await new Promise((r) => setTimeout(r, app.trackingTimeout * 1000 + 400)) // longer than the timeout, tracked
      await waitFrames(2)
      const stillDragging = app.snapshot().dragging?.preview
      aim(HAND_FROM, [H[0] + 0.0425, H[1], H[2]]) // back onto the plane: re-anchor, no jump
      await waitFrames(3)
      const afterAimBack = app.snapshot().dragging?.preview
      aim(HAND_FROM, [H[0] + 0.0425 + 0.0425, H[1], H[2]])
      await waitFrames(4)
      const relative = app.snapshot().dragging?.preview
      await button('trigger', 0)
      const committed = app.snapshot()
      app.workspace.undo()
      if (app.mode !== 'fiber') app.command('mode')
      await waitFrames(2)
      return {
        step: 'reacquireAway',
        pass: !!p1 && statusTracked && stillDragging === p1 && afterAimBack === p1 && !!relative && relative !== p1 && committed.revision === before.revision + 1 && committed.selected === relative,
        detail: { previewBefore: p1, statusShowsTracked: statusTracked, previewAfterTimeoutWhileTrackedAway: stillDragging, previewAfterAimBack: afterAimBack, previewAfterRelativeMove: relative, committed: committed.selected },
      }
    },

    /** Review C2: session visibility loss (system UI) suspends a drag; return resumes without a jump. */
    async visibilityLoss() {
      await prep()
      if (app.mode !== 'fiber') app.command('mode')
      const before = app.snapshot()
      const H = sampleWorld(U)
      aim(HAND_FROM, H)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H[0], H[1] + 0.0425, H[2]])
      await waitFrames(4)
      const p1 = app.snapshot().dragging?.preview
      host.debugVisibility(false)
      const invalidAtOnce = !app.input.pointers.get('right')!.rayValid && app.input.isSuspended
      const hidden = new Set<string | null | undefined>()
      for (const dy of [0.15, 0.3, 0.45]) {
        await waitFrames(2) // the controller keeps moving while the session is not visible
        aim(HAND_FROM, [H[0], H[1] + dy, H[2]])
        hidden.add(app.snapshot().dragging?.preview)
      }
      await waitFrames(2)
      hidden.add(app.snapshot().dragging?.preview)
      const whileHidden = app.snapshot().dragging?.preview
      host.debugVisibility(true)
      aim(HAND_FROM, [H[0], H[1] + 0.6, H[2]]) // two uncorrected first frames, inside the settle window
      const settling = new Set<string | null | undefined>()
      for (let i = 0; i < 2; i++) {
        await waitFrames(1)
        settling.add(app.snapshot().dragging?.preview)
      }
      aim(HAND_FROM, [H[0], H[1] + 0.45, H[2]])
      for (const x of await sampleUntilValid(() => app.snapshot().dragging?.preview)) settling.add(x)
      const whileSettling = [...settling].join(' | ')
      await waitFrames(1)
      const afterReturn = app.snapshot().dragging?.preview
      await button('trigger', 0)
      const committed = app.snapshot()
      app.workspace.undo()
      await waitFrames(2)
      return {
        step: 'visibilityLoss',
        pass: !!p1 && invalidAtOnce && hidden.size === 1 && whileHidden === p1 && settling.size === 1 && settling.has(p1) && afterReturn === p1 && committed.revision === before.revision + 1 && committed.selected === p1,
        detail: { previewBefore: p1, invalidAtOnce, previewsWhileHidden: [...hidden], previewsWhileSettling: whileSettling, previewAfterReturn: afterReturn, committed: committed.selected },
      }
    },

    /** Review C4: on a fresh page, the initial autoplay ends with the toggle reading "Play" (run first). */
    async autoplayLabel() {
      for (let i = 0; i < 80 && app.snapshot().playback.active; i++) await new Promise((r) => setTimeout(r, 100))
      await waitFrames(2)
      const started = app.log.some((l) => l.event === 'start')
      const commands = app.log.filter((l) => l.event === 'command').length
      return {
        step: 'autoplayLabel',
        pass: started && commands === 0 && !app.snapshot().playback.active && app.controls.label('toggle') === 'Play' && app.adapter.stats.transitionsStarted >= 1,
        detail: { transitionsStarted: app.adapter.stats.transitionsStarted, commandsBefore: commands, label: app.controls.label('toggle'), refreshes: app.stats.refreshes },
      }
    },

    /** Review C1 (hitch half): previews, captions, status and button labels change during drags without
     *  any MathJax build or glyph-token build (everything needed is prebuilt). */
    async noTypesetDuringDrag() {
      await prep()
      for (let i = 0; i < 200 && texStats.queued > 0; i++) await waitFrames(2)
      const t0 = texStats.built
      const k0 = tokenStats.built
      const c0 = tokenStats.composed
      if (app.mode !== 'fiber') app.command('mode')
      const H = sampleWorld(U)
      aim(HAND_FROM, H)
      await waitFrames(2)
      await button('trigger', 1)
      for (let i = 0; i <= 40; i++) {
        aim(HAND_FROM, [H[0], H[1] + Math.sin((i / 40) * Math.PI) * 0.15, H[2]])
        await waitFrames(1)
      }
      await button('trigger', 0)
      app.command('mode')
      const H2 = sampleWorld(U)
      aim(HAND_FROM, H2)
      await waitFrames(2)
      await button('trigger', 1)
      for (let i = 1; i <= 20; i++) {
        aim(HAND_FROM, [H2[0] - 0.004 * i, H2[1] + 0.002 * i, H2[2]])
        await waitFrames(1)
      }
      dev().controllers.right!.updateButtonValue('b-button', 1)
      await waitFrames(2)
      dev().controllers.right!.updateButtonValue('b-button', 0)
      await button('trigger', 0)
      app.command('mode')
      await waitFrames(4)
      const built = texStats.built - t0
      const tokens = tokenStats.built - k0
      app.workspace.undo()
      await waitFrames(3)
      return { step: 'noTypesetDuringDrag', pass: built === 0 && tokens === 0 && tokenStats.composed > c0, detail: { mathJaxBuilds: built, tokenBuilds: tokens, compositions: tokenStats.composed - c0 } }
    },

    /** Review C2-1: a hidden session that runs NO frames (rAF shim stopped) - short gap resumes without a
     *  jump; a gap longer than the timeout cancels the drag / ends the workbench move without commits. */
    async hiddenNoFrames() {
      await prep()
      if (!rafShim) return { step: 'hiddenNoFrames', pass: false, detail: { reason: 'needs ?rafshim=1 (frames must be stoppable)' } }
      if (app.mode !== 'fiber') app.command('mode')
      const before = app.snapshot()
      const H = sampleWorld(U)
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
      // short hide: resume, no jump
      aim(HAND_FROM, H)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H[0], H[1] + 0.0425, H[2]])
      await waitFrames(4)
      const p1 = app.snapshot().dragging?.preview
      rafShim.stop()
      host.debugVisibility(false)
      aim(HAND_FROM, [H[0], H[1] + 0.2, H[2]])
      await sleep(300)
      host.debugVisibility(true)
      const validAtReturn = app.input.pointers.get('right')!.rayValid // must not survive the gap
      rafShim.start()
      // uncorrected first frames after the gap, then the corrected pose: nothing may move while settling
      aim(HAND_FROM, [H[0], H[1] + 0.5, H[2]])
      const settling = new Set<string | null | undefined>()
      for (let i = 0; i < 2; i++) {
        await waitFrames(1)
        settling.add(app.snapshot().dragging?.preview)
      }
      aim(HAND_FROM, [H[0], H[1] + 0.2, H[2]])
      for (const x of await sampleUntilValid(() => app.snapshot().dragging?.preview)) settling.add(x)
      await waitFrames(1)
      const afterShort = app.snapshot().dragging?.preview
      await button('trigger', 0)
      const committed = app.snapshot()
      app.workspace.undo()
      await waitFrames(2)
      // long hide: cancelled, nothing committed
      const H2 = sampleWorld(U)
      aim(HAND_FROM, H2)
      await waitFrames(2)
      await button('trigger', 1)
      aim(HAND_FROM, [H2[0], H2[1] + 0.0425, H2[2]])
      await waitFrames(4)
      rafShim.stop()
      host.debugVisibility(false)
      aim(HAND_FROM, [H2[0], H2[1] + 0.2, H2[2]])
      await sleep(app.trackingTimeout * 1000 + 500)
      host.debugVisibility(true)
      rafShim.start()
      await waitFrames(4)
      const afterLong = app.snapshot()
      await button('trigger', 0)
      await waitFrames(2)
      // workbench: long hide ends the move where it was. The poses are still settling after the hide
      // above, so wait for a valid grip first, and require that the move really started and moved.
      const b0 = app.adapter.bench.position.clone()
      const c = dev().controllers.right!
      aim(HAND_FROM, [0, 1.0, -0.8])
      await waitValid()
      await waitFrames(2)
      await button('squeeze', 1)
      const benchStarted = app.snapshot().benchMoving
      c.position.set(HAND_FROM[0] + 0.08, HAND_FROM[1], HAND_FROM[2])
      await waitFrames(4)
      const benchBefore = app.adapter.bench.position.clone()
      const benchMovedM = benchBefore.distanceTo(b0)
      rafShim.stop()
      host.debugVisibility(false)
      c.position.set(HAND_FROM[0] + 0.4, HAND_FROM[1] + 0.2, HAND_FROM[2])
      await sleep(app.trackingTimeout * 1000 + 500)
      host.debugVisibility(true)
      rafShim.start()
      await waitFrames(4)
      const benchAfter = app.adapter.bench.position.clone()
      const benchStillMoving = app.snapshot().benchMoving
      await button('squeeze', 0)
      app.adapter.bench.position.copy(b0)
      app.adapter.bench.rotation.set(0, 0, 0)
      await waitFrames(2)
      return {
        step: 'hiddenNoFrames',
        pass: !!p1 && !validAtReturn && settling.size === 1 && settling.has(p1) && afterShort === p1 && committed.revision === before.revision + 1 && committed.selected === p1 && !afterLong.dragging && afterLong.revision === before.revision + 2 && afterLong.selected === before.selected && benchStarted && benchMovedM > 0.01 && !benchStillMoving && benchAfter.distanceTo(benchBefore) < 1e-9,
        detail: { previewBefore: p1, rayValidAtReturn: validAtReturn, previewsWhileSettling: [...settling], previewAfterShortHide: afterShort, committedAfterShort: committed.selected, longHide: { dragging: afterLong.dragging, selected: afterLong.selected }, bench: { started: benchStarted, movedBeforeHideM: +benchMovedM.toFixed(4), endedByTimeout: !benchStillMoving, jumpM: +benchAfter.distanceTo(benchBefore).toFixed(6) }, log: app.log.slice(-10).map((l) => l.event) },
      }
    },

    /**
     * Milestone (A3, W2): the recipe bound to P is used on Q through the spatial control. The shared
     * interpreter recomputes groups, fiber direction, plane, labels and readouts; the old pair is shown
     * apart before the learner explicitly selects the new collision (a) with the controller; Undo returns.
     */
    async rebindQ() {
      await prep()
      // Presentation the binding derives: the image plane (description and the label actually shown), the
      // output labels, and the output view's yaw once its easing has settled (radians, view-local).
      const yaw = () => (app.adapter as unknown as { outputYaw: { now: number; target: number } }).outputYaw
      const settledYaw = async () => {
        for (let i = 0; i < 240 && Math.abs(yaw().now - yaw().target) > 1e-4; i++) await waitFrames(1)
        return +yaw().now.toFixed(4)
      }
      const planeOf = () => {
        const pl = app.currentDescription()!.primitives.find((x): x is PlaneDesc => x.kind === 'plane')
        const slot = app.adapter.slotReport().find((r) => r.id === 'lbl:plane')
        return { normalAxis: pl?.normalAxis ?? null, label: pl?.label ?? null, shown: slot?.visible && slot.state === 'fresh' ? slot.plain : null }
      }
      const labelsOf = () => app.currentDescription()!.primitives.filter((x): x is LabelDesc => x.kind === 'label').map((x) => x.plain)
      const pYaw = await settledYaw()
      await waitFrames(3)
      const pPlane = planeOf()
      const pLabels = labelsOf()
      const p = app.snapshot()
      const pGroup = groupOf(U)
      const pAxis = app.currentDescription()!.fiberAxis
      aim(HAND_FROM, buttonWorld('rebind'))
      await waitFrames(3)
      await button('trigger', 1)
      await button('trigger', 0)
      await waitFrames(3)
      const q = app.snapshot()
      const qDesc = app.currentDescription()!
      const plainOf = (d: typeof qDesc, id: string) => (d.primitives.find((x) => x.id === id) as EquationDesc | undefined)?.plain ?? null
      const labels = qDesc.primitives.filter((x): x is LabelDesc => x.kind === 'label').map((x) => x.plain)
      const uvApart = !groupOf(U).includes(V)
      const revealed = q.playback.active
      if (q.playback.active) app.adapter.setPlayback('finish')
      await waitFrames(3)
      const qYaw = await settledYaw()
      await waitFrames(3)
      const qPlane = planeOf()
      aim(HAND_FROM, sampleWorld(A))
      await waitFrames(3)
      await button('trigger', 1)
      await button('trigger', 0)
      await waitFrames(3)
      const qa = app.snapshot()
      const aDesc = app.currentDescription()!
      const aGroup = groupOf(A)
      // The same fiber gesture under Q: a slides along its x-fiber (fiberAxis 0 from the binding) and Qa
      // stays put. The hand aims at points on that line, mapped to world by the input view's placement.
      // Qa is compared in the output view's own frame: after the rebind that view is still easing its
      // presentation-only turn towards the x = 0 image plane, which moves every output in world space.
      const inputGroup = app.adapter.viewMathGroup('input')
      inputGroup.updateMatrixWorld()
      const onFiber = (x: number): V3 => inputGroup.localToWorld(new Vector3(x, 1, 0)).toArray() as V3
      const outputLocal = (id: string): V3 => {
        const rec = (app.adapter as unknown as { dots: { output: Map<string, { mob: { getThreeObject(): { position: Vector3 } } }> } }).dots.output.get(id)!
        return rec.mob.getThreeObject().position.toArray() as V3
      }
      const qOut0 = outputLocal(A)
      aim(HAND_FROM, sampleWorld(A))
      await waitFrames(3)
      await button('trigger', 1)
      const qDragStart = app.snapshot().dragging
      for (const x of [0.75, 0.25, -0.25]) {
        aim(HAND_FROM, onFiber(x))
        await waitFrames(3)
      }
      const qPreview = app.snapshot().dragging?.preview ?? null
      const qOutDuring = outputLocal(A)
      await button('trigger', 0)
      await waitFrames(3)
      const qDragged = app.snapshot()
      const qOut1 = outputLocal(A)
      const qGroupAfterDrag = groupOf(A)
      const keptYZ = (s: string | null) => !!s && /^\(-?[\d/]+, 1, 0\)$/.test(s) && s !== '(1, 1, 0)'
      app.command('undo')
      app.command('undo')
      app.command('undo')
      await waitFrames(3)
      const back = app.snapshot()
      return {
        step: 'rebindQ',
        pass: p.experimentId === 'exp-p' && pGroup.includes(V) && pAxis === 2
          && pPlane.normalAxis === 2 && pPlane.shown === 'image of P: z = 0' && Math.abs(pYaw + 0.22) < 1e-3
          // Since the label policy (2026-10-29) every named location is described ("Pa" too); which labels
          // read where is the adapter's projected layout, checked by labelOverlap.
          && pLabels.includes('Pu = Pv = Pw') && pLabels.includes('Pb') && pLabels.includes('Pa')
          && qPlane.normalAxis === 0 && qPlane.shown === 'image of Q: x = 0' && Math.abs(qYaw + 0.95) < 1e-3
          && q.experimentId === 'exp-q' && q.mapSymbol === 'Q' && qDesc.fiberAxis === 0 && uvApart && revealed
          && plainOf(qDesc, 'eq:out')?.startsWith('Qu ') === true && labels.includes('Qv')
          && qa.selection === A && aGroup.includes(B) && plainOf(aDesc, 'eq:out')?.startsWith('Qa = Qb') === true
          && qDragStart?.mode === 'fiber' && keptYZ(qPreview) && keptYZ(qDragged.selected) && qDragged.mathRevision === qa.mathRevision + 1
          && near(qOut0, qOutDuring) && near(qOut0, qOut1) && JSON.stringify(qGroupAfterDrag) === JSON.stringify(aGroup)
          && back.experimentId === 'exp-p' && back.selection === U && JSON.stringify(groupOf(U)) === JSON.stringify(pGroup),
        detail: {
          underP: { group: pGroup, fiberAxis: pAxis, eqOut: plainOf(app.describeCurrent(), 'eq:out'), labels: pLabels, plane: pPlane, outputYaw: pYaw },
          afterRebind: { experiment: q.experimentId, symbol: q.mapSymbol, fiberAxis: qDesc.fiberAxis, map: qDesc.mapName, eqOut: plainOf(qDesc, 'eq:out'), labels, uvApart, revealPlayed: revealed, plane: qPlane, outputYaw: qYaw },
          afterSelectingA: { selection: qa.selection, group: aGroup, eqOut: plainOf(aDesc, 'eq:out') },
          fiberDragUnderQ: { started: qDragStart, preview: qPreview, committed: qDragged.selected, mathRevisions: [qa.mathRevision, qDragged.mathRevision], qaInOutputView: { before: qOut0, during: qOutDuring, after: qOut1 }, groupAfter: qGroupAfterDrag },
          afterUndo: { experiment: back.experimentId, selection: back.selection, revision: back.revision, group: groupOf(U) },
        },
      }
    },

    /** A3: save to IndexedDB, change, reopen; export/import round trip; storage failure keeps the session. */
    async saveReopen() {
      await prep()
      app.command('rebind')
      if (app.snapshot().playback.active) app.adapter.setPlayback('finish')
      app.workspace.commit({ baseRevision: app.workspace.current.revision, actions: [{ kind: 'select', experimentId: app.workspace.current.selection.experimentId, sampleId: A }] })
      await waitFrames(3)
      const savedText = exportText(app.workspace.current)
      const savedEq = (app.currentDescription()!.primitives.find((x) => x.id === 'eq:out') as EquationDesc).plain
      const saved = await saveDocument(app.workspace.current)
      app.command('undo')
      app.command('undo')
      await waitFrames(2)
      const changed = exportText(app.workspace.current) !== savedText
      const re = await loadSaved()
      if (re) app.openDocument(re.doc, 'reopen')
      if (app.snapshot().playback.active) app.adapter.setPlayback('finish')
      await waitFrames(3)
      const reopenedText = exportText(app.workspace.current)
      const reopenedEq = (app.currentDescription()!.primitives.find((x) => x.id === 'eq:out') as EquationDesc).plain
      const imported = exportText(importText(savedText))
      let tamperRefused = false
      try {
        importText(savedText.replace('"keep"', '"keepx"'))
      } catch {
        tamperRefused = true
      }
      storageDebug.failNextSave = true
      const before = exportText(app.workspace.current)
      const failed = await saveDocument(app.workspace.current)
      const unchanged = exportText(app.workspace.current) === before
      return {
        step: 'saveReopen',
        pass: saved.kind === 'saved' && changed && reopenedText === savedText && reopenedEq === savedEq && !app.workspace.canUndo && imported === savedText && tamperRefused && failed.kind === 'failed' && unchanged,
        detail: { saved: saved.kind, changedBeforeReopen: changed, reopenedIdentical: reopenedText === savedText, readout: reopenedEq, historyAfterReopen: app.workspace.canUndo, importIdentical: imported === savedText, tamperRefused, storageFailure: failed, workspaceKept: unchanged, bytes: savedText.length },
      }
    },

    /**
     * Device review (round C) and its audit: the selected fiber, longer than the axes, crossed an axis name.
     * Measured on screen from this frame's head, as the wearer sees it: the z name clears the fiber with w₃
     * on the z axis and with w₃ an eighth of a unit in front of it (apart in 3D, crossing on screen); it is
     * back at rest with no fiber; under Q the x name clears the x-fiber through the origin from below, and
     * the output z name clears the top border of the upright image plane x = 0. Distances in metres at the
     * name's depth.
     */
    async axisLabelFiber() {
      await prep()
      const ws = app.workspace
      const adapter = app.adapter as unknown as { slots: Map<string, { anchor: { getWorldPosition(v: Vector3): Vector3 } }>; headAt: Vector3; outputYaw: { now: number; target: number } }
      const nameAt = (id: string) => adapter.slots.get(id)!.anchor.getWorldPosition(new Vector3())
      const onScreen = (name: Vector3, view: 'input' | 'output', from: V3, to: V3) => {
        const g = app.adapter.viewMathGroup(view)
        g.updateMatrixWorld()
        const h = adapter.headAt.clone()
        const d = name.clone().sub(h)
        const nd = d.length()
        d.normalize()
        const r = new Vector3().crossVectors(d, new Vector3(0, 1, 0)).normalize()
        const u = new Vector3().crossVectors(r, d)
        const flat = (m: V3) => {
          const p = g.localToWorld(new Vector3(...m)).sub(h)
          const q = p.multiplyScalar(nd / p.dot(d)).add(h).sub(name)
          return [q.dot(r), q.dot(u)] as const
        }
        const [ax, ay] = flat(from)
        const [bx, by] = flat(to)
        const dx = bx - ax
        const dy = by - ay
        const l2 = dx * dx + dy * dy
        const t = l2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / l2)) : 0
        return { dist: +Math.hypot(ax + t * dx, ay + t * dy).toFixed(4), below: ay + t * dy > 0 }
      }
      // The clearance the adapter aims for (half the name's width plus 12 mm), less 0.5 mm of tolerance.
      const clearOf = (name: 'x' | 'z') => ((app.adapter as unknown as { slots: Map<string, { width: number }> }).slots.get(`axis:input:${name}`)!.width || 0.012) / 2 + 0.0115
      const fiber = () => app.currentDescription()!.primitives.find((x) => x.id === 'fiber') as { from: V3; to: V3 } | undefined
      const measure = (name: 'x' | 'z', rest: Vector3) => {
        const p = nameAt(`axis:input:${name}`)
        const f = fiber()
        const s = f ? onScreen(p, 'input', f.from, f.to) : null
        return { fiber: f ? `${f.from} to ${f.to}` : null, toFiber: s?.dist ?? null, below: s?.below ?? null, moved: +p.distanceTo(rest).toFixed(4) }
      }
      const select = async (experimentId: string, sampleId: string | null) => {
        ws.commit({ baseRevision: ws.current.revision, actions: [{ kind: 'select', experimentId, sampleId }] })
        if (app.snapshot().playback.active) app.adapter.setPlayback('finish')
        await waitFrames(3)
      }
      // At rest: u is selected under P and its fiber, at x = 1, crosses neither name.
      const restZ = nameAt('axis:input:z')
      const restX = nameAt('axis:input:x')
      const zU = measure('z', restZ)
      await select('exp-p', 's(0,0,1)')
      const zOn = measure('z', restZ)
      ws.commit({ baseRevision: ws.current.revision, actions: [{ kind: 'update_sample', sampleSetId: app.activeSet().id, sampleId: 's(0,0,1)', coords: [{ n: '0', d: '1' }, { n: '-1', d: '8' }, { n: '1', d: '1' }] }] })
      await waitFrames(3)
      const zDepth = measure('z', restZ)
      app.command('undo')
      await waitFrames(2)
      await select('exp-p', null)
      const zHidden = measure('z', restZ)
      if (!ws.current.experiments.some((e) => e.id === 'exp-q')) {
        app.command('rebind')
        if (app.snapshot().playback.active) app.adapter.setPlayback('finish')
      }
      await select('exp-q', 's(0,0,0)')
      for (let i = 0; i < 240 && Math.abs(adapter.outputYaw.now - adapter.outputYaw.target) > 1e-4; i++) await waitFrames(1)
      await waitFrames(2)
      const xOn = measure('x', restX)
      const outZ = onScreen(nameAt('axis:output:z'), 'output', [0, -1.6, 1.6], [0, 1.6, 1.6])
      await select('exp-q', U)
      const xOff = measure('x', restX)
      await select('exp-p', U)
      return {
        step: 'axisLabelFiber',
        pass: zU.toFiber! > 0.03 && zOn.toFiber! >= clearOf('z') && zOn.moved >= 0.01 && zDepth.toFiber! >= clearOf('z')
          && zHidden.fiber === null && zHidden.moved < 0.001
          && xOn.toFiber! >= clearOf('x') && xOn.below === true && outZ.dist >= 0.012
          && xOff.toFiber! > 0.03 && xOff.moved < 0.001,
        detail: { zUnderPWithU: zU, zUnderPWithW3: zOn, zUnderPWithW3InFront: zDepth, zWithNoSelection: zHidden, xUnderQAtOrigin: xOn, outputZToPlaneBorderUnderQ: outZ, xUnderQWithU: xOff },
      }
    },

    /**
     * Second demonstration: the operation-order comparison created by the prepared validated actions, played
     * step by step. Every step boundary shows the exact stage positions in both route views; mid-step, the
     * rotation keeps |e1| = 1 (true angular path) while the reflection moves a straight down x = 1; step text
     * appears as steps are reached; Replay picks compare_steps; a point in the right view picks as output2;
     * reversing the left route (set_branch) makes both views agree and Undo restores; a commit during
     * playback finishes it on the committed target; the P-to-Q views come back unchanged.
     */
    async comparison() {
      await prep()
      const adapter = app.adapter as unknown as {
        dots: Record<ViewRole, Map<string, { mob: { getThreeObject(): { position: Vector3 } } }>>
        views: Record<ViewRole, { root: { visible: boolean; position: Vector3; scale: Vector3 } }>
        slots: Map<string, { anchor: { visible: boolean } }>
        lastStepDuration: number
      }
      const local = (view: ViewRole, id: string): V3 => adapter.dots[view].get(id)!.mob.getThreeObject().position.toArray() as V3
      const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, (a[2] ?? 0) - (b[2] ?? 0))
      const shown = (id: string) => !!adapter.slots.get(id)?.anchor.visible
      const slotPlain = (id: string) => app.adapter.slotReport().find((r) => r.id === id)?.plain ?? null
      const E1 = ORDER_IDS.witness
      const A = 's(1,1,0)'
      const B = 's(-1,1,0)'
      const start = app.snapshot()
      app.transact(orderDemoActions(app.workspace.current), 'verify')
      const opened = app.snapshot()
      const desc = app.currentDescription()!
      const c = desc.comparison!
      const sd = adapter.lastStepDuration
      // Exact stage positions at every step boundary (seek into each step's hold).
      const boundaries: { step: number; label: string | null; worstM: number }[] = []
      for (const k of [0, 1, 2]) {
        app.adapter.setPlayback({ seek: k === 0 ? 0.05 : sd * (COMPARE_TIMING.inputHold + k) - 0.05 })
        await waitFrames(2)
        let worst = 0
        for (const r of [c.left, c.right]) {
          for (const p of desc.primitives) {
            if (p.kind !== 'point' || p.view !== 'input') continue
            const want = k === 0 ? p.at : r.stages[k - 1]!.at[p.sourceId]!
            worst = Math.max(worst, dist(local(r.view, p.sourceId), want))
          }
        }
        boundaries.push({ step: k, label: app.snapshot().playback.step?.label ?? null, worstM: worst })
      }
      // Step text at step 1's result: line 1 shown, line 2 not yet; the motion caption of step 1 shown.
      app.adapter.setPlayback({ seek: sd * (COMPARE_TIMING.inputHold + 1) - 0.05 })
      await waitFrames(2)
      const text1 = { line1: shown('eq:step:output:1'), line2: shown('eq:step:output:2'), motion1: shown('caption:step:output:1'), fixedLine: slotPlain('eq:step:output2:1'), indicator: slotPlain('lbl:step') }
      // Mid-motion of step 1 (linear alpha 0.5 -> eased 0.5): left R turns e1 on the unit circle; right S moves a straight.
      app.adapter.setPlayback({ seek: sd * (COMPARE_TIMING.inputHold + COMPARE_TIMING.motion / 2) })
      await waitFrames(2)
      const e1Mid = local('output', E1)
      const aMid = local('output2', A)
      const motion = { e1Left: e1Mid.map((v) => +v.toFixed(4)), e1Norm: +Math.hypot(...e1Mid).toFixed(6), aRight: aMid.map((v) => +v.toFixed(4)) }
      app.adapter.setPlayback('finish')
      await settleLabels()
      const labels = measureLabels('comparison at rest')
      const rest = { steps: ['eq:step:output:1', 'eq:step:output:2', 'eq:step:output2:1', 'eq:step:output2:2'].map((id) => [shown(id), slotPlain(id)]), verdict: slotPlain('eq:verdict'), indicator: shown('lbl:step') }
      app.command('replay')
      const replayed = app.snapshot().playback
      app.adapter.setPlayback('finish')
      await waitFrames(3)
      // Picking in the right route's view selects through the ordinary select path.
      const g2 = app.adapter.viewMathGroup('output2')
      g2.updateMatrixWorld()
      aim(HAND_FROM, g2.localToWorld(new Vector3(...local('output2', B))).toArray() as V3)
      await waitFrames(3)
      const hit = app.adapter.pick(new Ray(app.input.pointers.get('right')!.origin, app.input.pointers.get('right')!.direction))
      await button('trigger', 1)
      await button('trigger', 0)
      const picked = { hit: hit ? { view: hit.view, sourceId: hit.sourceId } : null, selection: app.snapshot().selection }
      app.workspace.commit({ baseRevision: app.workspace.current.revision, actions: [{ kind: 'select', experimentId: ORDER_IDS.experiment, sampleId: E1 }] })
      await waitFrames(2)
      // Reverse the left route through the validated path: both routes and views agree; Undo restores.
      app.transact(reverseRouteActions(findExperiment(app.workspace.current, ORDER_IDS.experiment), 'left'), 'verify')
      app.adapter.setPlayback('finish')
      await waitFrames(3)
      const rd = app.currentDescription()!
      let reversedWorst = 0
      for (const p of rd.primitives) if (p.kind === 'point' && p.view === 'output') reversedWorst = Math.max(reversedWorst, dist(local('output', p.sourceId), local('output2', p.sourceId)))
      const reversed = { order: rd.comparison!.left.order, mapsEqual: rd.comparison!.mapsEqual, verdict: (rd.primitives.find((p) => p.id === 'eq:verdict') as EquationDesc).plain, viewsAgreeM: reversedWorst }
      app.command('undo')
      await waitFrames(3)
      const undone = app.currentDescription()!.comparison!.left.order
      // Edit during playback: a new mathematical revision finishes the playback on the committed target.
      app.command('replay')
      app.adapter.setPlayback({ seek: sd * 1.0 })
      app.adapter.setPlayback('play')
      await waitFrames(2)
      const midPlay = app.snapshot().playback.active
      app.workspace.commit({ baseRevision: app.workspace.current.revision, actions: reverseRouteActions(findExperiment(app.workspace.current, ORDER_IDS.experiment), 'right') })
      await waitFrames(3)
      const ed = app.currentDescription()!
      let editWorst = 0
      for (const p of ed.primitives) if (p.kind === 'point' && p.view !== 'input') editWorst = Math.max(editWorst, dist(local(p.view, p.sourceId), p.at))
      const interrupted = { wasPlaying: midPlay, activeAfter: app.snapshot().playback.active, rightOrder: ed.comparison!.right.order, worstM: editWorst }
      app.command('undo')
      await waitFrames(2)
      // Back to P: linked layout, no second route view, apply_map playback unchanged.
      app.transact(pqDemoActions(app.workspace.current, 'exp-p', U), 'verify')
      const pqPlay = app.snapshot().playback
      app.adapter.setPlayback('finish')
      await waitFrames(3)
      const back = app.snapshot()
      const pqLayout = { output2Visible: adapter.views.output2.root.visible, input: adapter.views.input.root.position.toArray(), output: adapter.views.output.root.position.toArray(), deviation: outputDeviation() }
      const okBoundary = boundaries.every((b) => b.worstM < 1e-9) && boundaries[1]!.label === 'Step 1 of 2: left R, right S' && boundaries[0]!.label === 'Input'
      return {
        step: 'comparison',
        pass: opened.experimentId === ORDER_IDS.experiment && opened.selection === E1 && c.left.symbol === 'SR' && c.right.symbol === 'RS' && !c.mapsEqual
          && okBoundary && text1.line1 && !text1.line2 && text1.motion1 && text1.fixedLine === 'first S: Se1 = e1 (fixed)' && text1.indicator === 'Step 1 of 2: left R, right S'
          && Math.abs(motion.e1Norm - 1) < 1e-6 && e1Mid[0] > 0.1 && e1Mid[1] > 0.1 && Math.abs(aMid[0] - 1) < 1e-9 && Math.abs(aMid[1]) < 0.9
          && rest.steps.every(([v]) => v === true) && rest.verdict === 'SRe1 ≠ RSe1' && !rest.indicator && labels.mustShown && labels.overlaps.length === 0
          && replayed.active && replayed.step?.count === 2
          && picked.hit?.view === 'output2' && picked.selection === B
          && reversed.order === 'S then R' && reversed.mapsEqual && reversed.viewsAgreeM < 1e-9 && reversed.verdict === 'RS = RS' && undone === 'R then S'
          && interrupted.wasPlaying && !interrupted.activeAfter && interrupted.worstM < 1e-9 && interrupted.rightOrder === 'R then S'
          && back.experimentId === 'exp-p' && back.selection === U && pqPlay.active && pqPlay.step === null && pqLayout.deviation < 1e-6 && !pqLayout.output2Visible
          && JSON.stringify(pqLayout.input) === JSON.stringify([-0.3, 0, 0]) && JSON.stringify(pqLayout.output) === JSON.stringify([0.3, 0, 0]),
        detail: { revisions: [start.revision, opened.revision, back.revision], routes: { left: [c.left.order, c.left.symbol], right: [c.right.order, c.right.symbol] }, stepDuration: sd, boundaries, text1, motion, rest, labels, replayed, picked, reversed, undone, interrupted, pqPlay, pqLayout },
      }
    },

    /**
     * Label policy (selected relationship first): with the label layout on, no two shown floating labels
     * overlap in either eye's projection, and none overlaps fixed scene text; the selected relationship is
     * shown in every case. Cases: P with u (u/v), P with w3 (origin group), Q with (-1, 0, 0) (origin group),
     * Q with a (a/b), the same Q case from an oblique head pose, and a selection change. Small head jitter
     * changes no decision; head movement changes nothing in the document (values, selection, saves, undo).
     */
    async labelOverlap() {
      await prep()
      const select = async (experimentId: string, sampleId: string) => {
        app.workspace.commit({ baseRevision: app.workspace.current.revision, actions: [{ kind: 'select', experimentId, sampleId }] })
        await settleLabels()
      }
      const cases = []
      await settleLabels()
      cases.push(measureLabels('P, u selected (u/v)'))
      await select('exp-p', 's(0,0,1)')
      cases.push(measureLabels('P, w3 selected (origin group)'))
      // Hysteresis: millimetre head jitter for 40 frames changes no layout decision.
      const changes0 = app.adapter.stats.layoutChanges
      const docJson = () => JSON.stringify(docToJson(app.workspace.current))
      const jitterDoc = docJson()
      for (let i = 0; i < 40; i++) {
        dev().position.set((i % 2 ? 1 : -1) * 0.004, 1.22 + (i % 3 - 1) * 0.003, 0)
        await waitFrames(1)
      }
      dev().position.set(0, 1.22, 0)
      await waitFrames(3)
      const jitterChanges = app.adapter.stats.layoutChanges - changes0
      const unchangedByJitter = docJson() === jitterDoc
      if (!app.workspace.current.experiments.some((e) => e.id === 'exp-q')) {
        app.command('rebind')
        app.adapter.setPlayback('finish')
      }
      await select('exp-q', 's(-1,0,0)')
      cases.push(measureLabels('Q, (-1,0,0) selected (origin group)'))
      // Modest head movement and an oblique view of the same scene (presentation only: the document is unchanged).
      const obliqueDoc = docJson()
      dev().position.set(0.32, 1.27, 0.04)
      dev().quaternion.set(0, Math.sin(0.2 / 2), 0, Math.cos(0.2 / 2))
      await settleLabels()
      cases.push(measureLabels('Q, (-1,0,0), oblique head (0.32 m right, yaw 11 deg)'))
      dev().position.set(0, 1.22, 0)
      dev().quaternion.set(0, 0, 0, 1)
      await settleLabels()
      const unchangedByOblique = docJson() === obliqueDoc
      await select('exp-q', 's(1,1,0)')
      cases.push(measureLabels('Q, a selected (a/b)'))
      await select('exp-q', 's(1,0,1)')
      cases.push(measureLabels('Q, u selected (selection change)'))
      // Undo walks back through the selections (and the rebind, if this step made it) to P with w3.
      let undos = 0
      for (; undos < 8 && app.snapshot().experimentId !== 'exp-p'; undos++) app.command('undo')
      await waitFrames(3)
      const afterUndo = app.snapshot()
      await select('exp-p', U)
      const back = app.snapshot()
      return {
        step: 'labelOverlap',
        pass: cases.every((x) => x.mustShown && x.overlaps.length === 0) && jitterChanges === 0 && unchangedByJitter && unchangedByOblique
          && cases[1]!.readout?.startsWith('Pw3 = ') === true && cases[2]!.readout?.startsWith('Qw = ') === true && cases[4]!.readout?.startsWith('Qa = Qb') === true
          && afterUndo.experimentId === 'exp-p' && afterUndo.selection === 's(0,0,1)' && back.selection === U,
        detail: { cases, jitterChanges, unchangedByJitter, unchangedByOblique, undos, afterUndo: { experiment: afterUndo.experimentId, selection: afterUndo.selection }, layoutRuns: app.adapter.stats.layoutRuns, sharedDecision: 'one layout per frame from the head (centre-eye) pose, measured in both eye cameras' },
      }
    },

    async exit() {
      await host.exitXR()
      await new Promise((r) => setTimeout(r, 2200))
      await waitFrames(2)
      const sched = schedulerReport().lastSecond
      return { step: 'exit', pass: !host.presenting && sched.windowRaf.distinctCallbacks === 1 && sched.xrRaf.calls === 0, detail: { sched, workspace: app.snapshot().selected, revision: app.snapshot().revision } }
    },
  }

  // Suite order for one fresh page (docs/VERIFICATION.md). autoplayLabel must come first: it checks the
  // page's own autoplay before any command; cycle and exit come last.
  const order = [
    'autoplayLabel', 'session', 'fiberDrag', 'pauseHead', 'interrupt', 'freeMoveUndo', 'selectOutput', 'bench',
    'zeroMotionClick', 'finishEarly', 'replayDuringDrag', 'twoPointers', 'obliquePick', 'freshness',
    'noTypesetDuringDrag', 'pausedEfficiency', 'playbackLabels', 'rayLossDrag', 'gripLossBench', 'staleNoStart',
    'emulatedPose', 'reacquireAway', 'visibilityLoss', 'hiddenNoFrames', 'rebindQ', 'saveReopen', 'axisLabelFiber', 'comparison', 'labelOverlap', 'cycle', 'exit',
  ]
  const missing = Object.keys(steps).filter((s) => !order.includes(s))
  if (missing.length || order.some((s) => !steps[s])) throw new Error(`verify order out of date: ${missing.join(', ')}`)

  return {
    steps: order,
    step: (name: string) => steps[name]!(),
  }
}
