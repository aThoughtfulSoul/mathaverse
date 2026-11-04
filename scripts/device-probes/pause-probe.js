(() => {
  // DEBUG PROBE (device diagnosis only; an extra XR rAF chain, not part of the app).
  // C3 on a worn headset, driven by the wearer: B replays, A pauses mid-transformation, A resumes.
  // For each paused episode: did any geometry work run (adapter counters, geometry count, playback time),
  // did frames keep coming, did the head move, and did the billboarded labels keep turning to face it.
  const xr = __mw.host.renderer.xr, session = xr.getSession(), app = __mw.app, st = app.adapter.stats
  const R = (window.__pauseProbe = { stop: false, episodes: [] })
  const counters = () => ({ evaluations: st.evaluations, arrowRebuilds: st.arrowRebuilds, dotMoves: st.dotMoves, policyPasses: st.policyPasses, geometries: __mw.host.renderer.info.memory.geometries, billboards: st.billboards })
  const label = () => {
    const s = [...app.adapter.slots.entries()].find(([id, v]) => id.startsWith('lbl:mov:') && v.anchor.visible) ?? [...app.adapter.slots.entries()].find(([id, v]) => id.startsWith('lbl:input:') && v.anchor.visible)
    return s ? { id: s[0], q: s[1].anchor.quaternion.toArray() } : null
  }
  const eye = () => xr.getCamera().cameras[0].matrixWorld.elements.slice(12, 15)
  const deg = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))) * 180) / Math.PI
  let ep = null, prevT = null
  const tick = (t) => {
    if (R.stop || !xr.isPresenting) return
    const pb = app.snapshot().playback
    const paused = pb.active && !pb.playing
    if (paused && !ep) {
      ep = { startMs: Math.round(performance.now()), time: pb.time, a: counters(), frames: 0, intervals: [], changedFrames: 0, headTravelM: 0, label0: label(), labelMaxDeg: 0, lastEye: eye(), timeChanged: false }
      R.episodes.push(ep)
    }
    if (ep && paused) {
      ep.frames++
      if (prevT !== null) ep.intervals.push(t - prevT)
      const c = counters()
      if (c.evaluations !== ep.a.evaluations || c.arrowRebuilds !== ep.a.arrowRebuilds || c.dotMoves !== ep.a.dotMoves || c.policyPasses !== ep.a.policyPasses || c.geometries !== ep.a.geometries) ep.changedFrames++
      if (pb.time !== ep.time) ep.timeChanged = true
      const e = eye()
      ep.headTravelM += Math.hypot(e[0] - ep.lastEye[0], e[1] - ep.lastEye[1], e[2] - ep.lastEye[2])
      ep.lastEye = e
      const l = label()
      if (l && ep.label0 && l.id === ep.label0.id) ep.labelMaxDeg = Math.max(ep.labelMaxDeg, deg(l.q, ep.label0.q))
    }
    if (ep && !paused) {
      const iv = ep.intervals.slice().sort((x, y) => x - y)
      Object.assign(ep, { endMs: Math.round(performance.now()), b: counters(), endedBy: pb.playing ? 'resumed' : 'playback-ended' })
      ep.durationS = +((ep.endMs - ep.startMs) / 1000).toFixed(2)
      ep.intervalMeanMs = iv.length ? +(iv.reduce((s, x) => s + x, 0) / iv.length).toFixed(2) : null
      ep.intervalP99Ms = iv.length ? +iv[Math.floor(iv.length * 0.99)].toFixed(2) : null
      ep.intervalMaxMs = iv.length ? +iv[iv.length - 1].toFixed(2) : null
      ep.headTravelM = +ep.headTravelM.toFixed(3)
      ep.labelMaxDeg = +ep.labelMaxDeg.toFixed(1)
      ep.billboardUpdates = ep.b.billboards - ep.a.billboards
      ep.geometryWorkWhilePaused = ep.changedFrames > 0 || ep.timeChanged
      delete ep.intervals; delete ep.lastEye; ep.label0 = ep.label0?.id ?? null
      ep = null
    }
    prevT = t
    session.requestAnimationFrame(tick)
  }
  session.requestAnimationFrame(tick)
  return { installed: true, stats: counters(), label: label()?.id ?? null }
})()
