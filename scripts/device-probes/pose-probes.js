(() => {
  // DEBUG PROBES (device diagnosis only; extra XR rAF chains, not part of the app):
  //  __probe      controller pose class per frame (null / emulated / tracked) + Input validity
  //  __benchProbe workbench position per frame while a move is active (drift while lost, step on return)
  //  __dragProbe  drag preview at loss, while lost, and on the first frames after return
  const xr = __mw.host.renderer.xr, session = xr.getSession()
  const P = (window.__probe = { t0: performance.now(), stop: false, frames: 0, transitions: [], counts: {} })
  const last = {}
  const cls = (pose) => (pose === null ? 'null' : pose.emulatedPosition ? 'emulated' : 'tracked')
  const B = (window.__benchProbe = { stop: false, frames: 0, maxStepM: 0, reacquireSteps: [], lostFrames: 0, lostDriftM: 0 })
  const D = (window.__dragProbe = { stop: false, episodes: [] })
  D.dump = () => D.episodes.map((e) => ({ ...e, whileLost: [...e.whileLost] }))
  let bPrev = null, bPrevValid = true, bLostAt = null, dPrevValid = true, ep = null, after = 0
  const tick = (t, frame) => {
    if (P.stop || !xr.isPresenting) return
    P.frames++
    const ref = xr.getReferenceSpace()
    const right = __mw.app.input.pointers.get('right')
    for (const src of session.inputSources) {
      if (!src.handedness || src.hand) continue
      const ray = cls(frame.getPose(src.targetRaySpace, ref))
      const grip = src.gripSpace ? cls(frame.getPose(src.gripSpace, ref)) : 'none'
      const ptr = __mw.app.input.pointers.get(src.handedness)
      const key = `${ray}/${grip}/${ptr ? (ptr.rayValid ? 'R' : 'r') + (ptr.gripValid ? 'G' : 'g') : '?'}`
      P.counts[src.handedness + ':' + key] = (P.counts[src.handedness + ':' + key] ?? 0) + 1
      // reacquisition trace: per-frame ray origin step (m) and rotation step (deg) for 45 frames after a
      // non-tracked -> tracked transition, to measure how long the runtime takes to correct the pose
      const rp = frame.getPose(src.targetRaySpace, ref)
      const rec = (P.reacq ??= {})[src.handedness] ??= { prev: null, wasTracked: true, cur: null, list: [] }
      if (rp) {
        const o = rp.transform.position, q = rp.transform.orientation
        if (ray === 'tracked' && !rec.wasTracked) { rec.cur = { ms: Math.round(performance.now() - P.t0), steps: [] }; rec.list.push(rec.cur) }
        if (rec.cur && rec.prev) {
          const dp = Math.hypot(o.x - rec.prev.x, o.y - rec.prev.y, o.z - rec.prev.z)
          const dot = Math.min(1, Math.abs(q.x * rec.prev.qx + q.y * rec.prev.qy + q.z * rec.prev.qz + q.w * rec.prev.qw))
          rec.cur.steps.push([+dp.toFixed(4), +((2 * Math.acos(dot) * 180) / Math.PI).toFixed(2), ray[0], right.rayValid ? 1 : 0])
          if (rec.cur.steps.length >= 45) rec.cur = null
        }
        rec.prev = { x: o.x, y: o.y, z: o.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w }
      }
      rec.wasTracked = ray === 'tracked'
      if (last[src.handedness] !== key) {
        P.transitions.push({ ms: Math.round(performance.now() - P.t0), hand: src.handedness, ray, grip, input: key.split('/')[2] })
        last[src.handedness] = key
        if (P.transitions.length > 400) P.transitions.shift()
      }
    }
    const snap = __mw.app.snapshot()
    // bench
    const bench = __mw.app.adapter.bench, gv = right.gripValid, bp = bench.position.clone()
    if (snap.benchMoving && bPrev) {
      B.frames++
      const step = bp.distanceTo(bPrev)
      B.maxStepM = Math.max(B.maxStepM, step)
      if (!gv) { B.lostFrames++; if (!bLostAt) bLostAt = bPrev.clone(); B.lostDriftM = Math.max(B.lostDriftM, bp.distanceTo(bLostAt)) }
      if (gv && !bPrevValid) { B.reacquireSteps.push(+step.toFixed(5)); bLostAt = null }
    }
    bPrev = snap.benchMoving ? bp : null
    bPrevValid = gv
    // drag
    const rv = right.rayValid, preview = snap.dragging ? snap.dragging.preview : null
    if (snap.dragging && !rv && dPrevValid) { ep = { t: Math.round(performance.now()), atLoss: preview, whileLost: new Set(), afterReturn: [] }; D.episodes.push(ep) }
    if (ep && !rv && snap.dragging) ep.whileLost.add(preview)
    if (ep && rv && !dPrevValid) after = 3
    if (ep && after > 0) { ep.afterReturn.push(snap.dragging ? preview : '(drag ended)'); after-- }
    if (ep && !snap.dragging && !ep.ended) ep.ended = Math.round(performance.now())
    dPrevValid = rv
    session.requestAnimationFrame(tick)
  }
  session.requestAnimationFrame(tick)
  return { installed: true, t0: P.t0, sources: [...session.inputSources].map((s) => s.handedness) }
})()
