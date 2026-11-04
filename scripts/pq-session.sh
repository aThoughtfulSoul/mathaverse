#!/bin/zsh
# P-to-Q headset session, driven from the Mac (HEADSET-RUNBOOK.md, "P-to-Q session"). Runs rounds A, C
# and D in order (or $ROUNDS, e.g. ROUNDS="C D"). Each round waits until the wearer is in VR; C and D then
# wait for a wearer action, never for headset off/on alone (the proximity sensor can be pinned to "worn",
# and then the session stays visible). Controller pulses mark the start (one) and end (two) of C and D.
# Results go to $OUT/<round>/, progress lines to $OUT/progress.txt and driver errors to $OUT/errors.txt.
#
#   A  automatic while the wearer looks at the bench: session facts, a ~10 s idle profile, adapter remount
#      x10 with the XR session active (R6 follow-up F2), the Play label after automatic completion (C4) twice
#   C  the page is reloaded to round A's state and the wearer presses Enter VR; the occlusion check is the
#      wearer's (nothing is recorded for it). From the wearer's trigger on u, the wearer drags and replays
#      without stopping until two pulses: a 60 s untraced profile in six ~9.5 s slices, then a 50 s
#      Perfetto trace with the page profile read in six 9 s slices during it (54 s, independent of when
#      metavr returns) and one idle slice after it (J and H)
#   R  (follow-up, ROUNDS="R D") the axis-name recheck: from the wearer's trigger on w3 = (0, 0, 1), 20 s of
#      the z name's on-screen distance from the fiber, seen from the wearer's head
#   D  every dragged point is restored, on P with u selected (from a fresh page when Q already exists);
#      then, on the wearer's ready signal: a 60 s unedited compositor recording; an assistant request about
#      3 s and a Lean check about 7 s after the recording starts; then save, reload, and reopen once the
#      wearer has pressed Enter VR again. D_NOW=1 skips the ready wait (the wearer is already in VR).
#
# Every window is read in slices of at most ~9.5 s with both the stage profile and host.perf() reset at
# the start: the stage rings keep 900 samples (one per frame, or one per adapter apply for apply.*) and
# host.perf() at most 900 frames, which is 10 s at 90 Hz and 12.5 s at 72 Hz.
#
# Environment: PORT (page port, default 3010), DEV (adb serial of the USB headset, default the first USB
# device), METAVR (metavr binary, default `metavr`), OUT (default .local/pq-session). Needs
# `adb reverse tcp:$PORT tcp:$PORT` and `adb forward tcp:9222 localabstract:chrome_devtools_remote`.
#
# Page lists are never printed: scripts/headset.mjs errors name no tab, and only its `pages` command
# (never used here) prints URLs.
set -u
cd "${0:A:h}/.."
PORT=${PORT:-3010}
# USB serials only: not ip:port, not mDNS (adb-<serial>-<id>._adb-tls-connect._tcp).
DEV=${DEV:-$(adb devices | awk 'NR > 1 && $2 == "device" && $1 !~ /:/ && $1 !~ /\._adb/ { print $1; exit }')}
METAVR=${METAVR:-metavr}
OUT=${OUT:-.local/pq-session}
[[ -n $DEV ]] || { echo "no USB adb device found; set DEV" >&2; exit 1 }
mkdir -p $OUT/A $OUT/C $OUT/D $OUT/R
export PAGE_MATCH=localhost:$PORT

H() { node --experimental-websocket scripts/headset.mjs eval "$1" 2>>$OUT/errors.txt }
# The same, one JSON value per line (for .jsonl files).
H1() { RAW=1 node --experimental-websocket scripts/headset.mjs eval "$1" 2>>$OUT/errors.txt }
log() { echo "$(date +%H:%M:%S) $*" | tee -a $OUT/progress.txt }
LIVE='(() => { const s = __mw.host.renderer.xr.getSession(); return !!s && __mw.host.renderer.xr.isPresenting && s.visibilityState === "visible" })()'
# Waits are bounded by wall-clock seconds (each poll is also one CDP round trip).
waitLive() { # $1 = true|false, $2 = seconds
  local end=$((SECONDS + $2))
  while (( SECONDS < end )); do [[ "$(H "$LIVE")" == "$1" ]] && return 0; sleep 1; done; return 1
}
# Page time (ms), retried; fails rather than fall back to 0, which would match round C's old log entries.
pageNow() {
  local t
  for k in 1 2 3 4 5; do t=$(H 'performance.now()'); [[ $t =~ '^[0-9]+(\.[0-9]+)?$' ]] && { echo $t; return 0 }; sleep 1; done
  return 1
}
pageOrigin() { H 'performance.timeOrigin' }
# Reload the page and confirm it: the page's time origin must change within 30 s.
reloadPage() {
  local before=$(pageOrigin)
  [[ "$(H '(setTimeout(() => location.reload(), 200), "reloading")')" == '"reloading"' ]] || return 1
  local end=$((SECONDS + 30)) now
  while (( SECONDS < end )); do sleep 1; now=$(H '(typeof __mw === "object" && __mw.app ? performance.timeOrigin : null)'); [[ -n $now && $now != null && $now != "$before" ]] && return 0; done
  return 1
}
# The wearer's trigger on u: a select, or a drag start when u is already selected.
U_EVENT='(e.event === "select" && e.detail === "s(1,0,1)") || (e.event === "dragStart" && e.detail?.sampleId === "s(1,0,1)")'
waitEvent() { # $1 = page time, $2 = JS predicate over the log entry e, $3 = seconds
  local end=$((SECONDS + $3))
  while (( SECONDS < end )); do [[ "$(H "__mw.device.logSince($1).some((e) => $2)")" == true ]] && return 0; sleep 1; done; return 1
}
# Round D's ready signal after page time $1, read when D started (before its reset): Enter VR when the
# session was not live then ($2 = false); otherwise the session turning visible again (headset on, when
# the sensor is not pinned) or a trigger on u. A headset put on before D started is not seen: use D_NOW=1.
waitReady() { # $1 = page time, $2 = live at that time (true/false), $3 = seconds
  [[ $2 == true ]] || { waitLive true $3; return }
  waitEvent $1 '(e.event === "sessionVisibility" && e.detail?.visible === true) || '"$U_EVENT" $3
}
INPUTS='[...(__mw.host.renderer.xr.getSession()?.inputSources ?? [])].map((s) => s.handedness + (s.hand ? ":hand" : s.gamepad ? ":controller" : ":other")).join(" ") || "none"'
# Controller pulses tell the wearer a window started (1) or ended (2). Logged per pulse: controllers whose
# pulse() resolved true within 1 s / controllers asked. Quest Browser's pulse() promise can stay pending,
# so it is never awaited past that second (an unbounded await stalled the follow-up's recheck for 2 min).
BUZZ='(async () => { const as = [...(__mw.host.renderer.xr.getSession()?.inputSources ?? [])].map((s) => s.gamepad?.hapticActuators?.[0]).filter((a) => a?.pulse); const played = await Promise.all(as.map((a) => Promise.race([a.pulse(0.8, 200).catch(() => false), new Promise((r) => setTimeout(() => r(false), 1000))]))); return played.filter(Boolean).length + "/" + as.length })()'
buzz() { local n all=""; for k in $(seq 1 $1); do n=$(H "$BUZZ"); all="$all ${${n//\"/}:-?}"; sleep 0.45; done; log "$2 (pulses played/asked:$all)" }
bootClock() { adb -s "$DEV" shell cat /proc/uptime | cut -d' ' -f1 }
RESET='(__mw.profile.reset(), __mw.host.perfReset(), "reset")'
# One slice: the window since the last reset, then a new window.
SLICE='(() => { const r = { t: performance.now(), profile: __mw.profile.report(), perf: __mw.host.perf() }; __mw.profile.reset(); __mw.host.perfReset(); return r })()'

# ---------------------------------------------------------------- A
roundA() {
  waitLive true 900 || { log "A: never live"; return }
  log "A: live"; sleep 6
  H '({ info: __mw.device.info(), loadMs: __mw.loadMs, tokens: { ...__mw.tokenStats }, audit: __mw.device.audit() })' > $OUT/A/info.json
  log "A: idle profile ~9.5 s"
  H '(async () => { __mw.profile.reset(); __mw.host.perfReset(); await new Promise((r) => setTimeout(r, 9500)); return { profile: __mw.profile.report(), perf: __mw.host.perf(), scheduler: __mw.schedulerReport().lastSecond } })()' > $OUT/A/idleProfile.json
  log "A: remount x10"
  H '(async () => {
    const snap = () => ({ census: __mw.census(), memory: { ...__mw.host.renderer.info.memory }, programs: __mw.host.renderer.info.programs?.length ?? null, frameErrors: { ...__mw.host.errors }, presenting: __mw.host.renderer.xr.isPresenting, scheduler: __mw.schedulerReport().lastSecond })
    const before = snap()
    const t0 = performance.now()
    const cyc = await __mw.cycle(10)
    const ms = Math.round(performance.now() - t0)
    await new Promise((r) => setTimeout(r, 3000))
    const after = snap()
    return { before, cycleReport: cyc, after, ms, audit: __mw.device.audit(), log: __mw.app.log.slice(-5) }
  })()' > $OUT/A/remount.json
  log "A: play label x2"
  H '(async () => {
    const runs = []
    for (let i = 0; i < 2; i++) {
      __mw.app.command("replay")
      const t0 = performance.now()
      const during = __mw.app.controls.label("toggle")
      while (__mw.app.snapshot().playback.active && performance.now() - t0 < 8000) await new Promise((r) => setTimeout(r, 100))
      await new Promise((r) => setTimeout(r, 300))
      const slot = __mw.app.controls.report().find((x) => x.id === "btn:toggle")
      runs.push({ during, after: __mw.app.controls.label("toggle"), slotState: slot?.state, slotPlain: slot?.plain, completedMs: Math.round(performance.now() - t0), refreshes: __mw.app.stats.refreshes })
      await new Promise((r) => setTimeout(r, 1500))
    }
    return { runs, audit: __mw.device.audit() }
  })()' > $OUT/A/playLabel.json
  log "A: done"
}

# ---------------------------------------------------------------- C
roundC() {
  # A clean document (round A's state) for the measured use; the wearer presses Enter VR again.
  if [[ ${C_RELOAD:-1} == 1 ]]; then reloadPage && log "C: page reloaded" || { log "C: reload FAILED"; return }; fi
  waitLive true 900 || { log "C: never live"; return }
  local TG; TG=$(pageNow) || { log "C: page time unreadable"; return }
  log "C: in VR; waiting for a trigger on u"
  waitEvent $TG "$U_EVENT" 900 || { log "C: u never selected"; return }
  buzz 1 "C: started"
  local T0=$(H 'performance.now()')
  log "C: untraced window (6 slices)"
  H '(async () => { const out = []; for (let k = 0; k < 6; k++) { __mw.profile.reset(); __mw.host.perfReset(); await new Promise((r) => setTimeout(r, 9500)); out.push({ t: performance.now(), profile: __mw.profile.report(), perf: __mw.host.perf() }) } return { slices: out, adapterStats: { ...__mw.adapterStats() } } })()' > $OUT/C/untraced.json
  # Page clock against the headset's boot clock, bracketed: offset = (U0 + U1) / 2 - T1 / 1000, error <= (U1 - U0) / 2.
  local U0=$(bootClock)
  local T1=$(H 'performance.now()')
  local U1=$(bootClock)
  log "C: trace start (T1=${T1:-?} uptime ${U0:-?}..${U1:-?})"
  H "$RESET" >/dev/null
  # metavr prints progress text before its JSON on stdout: keep the raw output, extract the JSON after.
  "$METAVR" perf capture -d "$DEV" -m vr --duration 50000 --app com.oculus.browser -o pq_use_50s --json > $OUT/C/trace.log 2>&1 &
  local CAP=$!
  : > $OUT/C/traced-slices.jsonl
  # Six 9 s slices cover the 50 s capture and its start-up, whenever metavr returns.
  for k in 1 2 3 4 5 6; do sleep 9; H1 "$SLICE" >> $OUT/C/traced-slices.jsonl; done
  wait $CAP || log "C: metavr capture exited with an error (see trace.log)"
  sed -n '/^{/,$p' $OUT/C/trace.log > $OUT/C/trace.json
  node -e 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))' $OUT/C/trace.json 2>/dev/null || log "C: trace summary is not JSON (see trace.log)"
  H "$SLICE" > $OUT/C/after-trace-slice.json # idle after the trace (and metavr's pull of it)
  local T2=$(H 'performance.now()')
  H "({ T0: ${T0:-null}, T1: ${T1:-null}, T2: ${T2:-null}, uptimeBeforeT1: ${U0:-null}, uptimeAfterT1: ${U1:-null}, log: __mw.device.logSince(${T0:-0}).map((e) => [Math.round(e.t), e.event, e.detail]), audit: __mw.device.audit(), frameErrors: __mw.host.errors })" > $OUT/C/traced.json
  buzz 2 "C: done"
}

# ---------------------------------------------------------------- R
# The axis-name recheck (follow-up to round C's occlusion defect): once the wearer selects w3 = (0, 0, 1),
# whose fiber runs along the z axis, sample for 20 s, every 250 ms, how far the input view's z name sits
# from the fiber on screen, seen from the wearer's head (the same measure as the emulator's axisLabelFiber).
RECHECK='(async () => {
  const ad = __mw.app.adapter
  const V = ad.headAt.constructor
  const g = ad.viewMathGroup("input")
  const samples = []
  const t0 = performance.now()
  while (performance.now() - t0 < 20000) {
    const f = __mw.app.currentDescription()?.primitives.find((p) => p.id === "fiber")
    const slot = ad.slots.get("axis:input:z")
    if (f && slot) {
      g.updateMatrixWorld()
      const h = ad.headAt.clone()
      const n = slot.anchor.getWorldPosition(new V())
      const d = n.clone().sub(h); const nd = d.length(); d.normalize()
      const r = new V().crossVectors(d, new V(0, 1, 0)).normalize()
      const u = new V().crossVectors(r, d)
      const flat = (m) => { const p = g.localToWorld(new V(...m)).sub(h); const q = p.multiplyScalar(nd / p.dot(d)).add(h).sub(n); return [q.dot(r), q.dot(u)] }
      const [ax, ay] = flat(f.from), [bx, by] = flat(f.to)
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
      const t = l2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / l2)) : 0
      samples.push({ t: Math.round(performance.now()), fiber: f.from.join() + " to " + f.to.join(), toFiber: +Math.hypot(ax + t * dx, ay + t * dy).toFixed(4), headX: +h.x.toFixed(3), headY: +h.y.toFixed(3), width: slot.width })
    }
    await new Promise((res) => setTimeout(res, 250))
  }
  const onAxis = samples.filter((s) => s.fiber === "0,0,-4 to 0,0,4")
  const ds = onAxis.map((s) => s.toFiber).sort((a, b) => a - b)
  const hx = onAxis.map((s) => s.headX)
  return { samples: samples.length, onAxis: onAxis.length, toFiber: ds.length ? { min: ds[0], p05: ds[Math.floor(0.05 * ds.length)], median: ds[Math.floor(ds.length / 2)], max: ds[ds.length - 1] } : null, under12mm: ds.filter((v) => v < 0.012).length, headXRange: hx.length ? [Math.min(...hx), Math.max(...hx)] : null, audit: __mw.device.audit(), frameErrors: __mw.host.errors, series: samples }
})()'
roundR() {
  waitLive true 900 || { log "R: never live"; return }
  local TG; TG=$(pageNow) || { log "R: page time unreadable"; return }
  log "R: in VR; waiting for a trigger on w3 (0, 0, 1)"
  waitEvent $TG '(e.event === "select" && e.detail === "s(0,0,1)") || (e.event === "dragStart" && e.detail?.sampleId === "s(0,0,1)")' 900 || { log "R: w3 never selected"; return }
  buzz 1 "R: started (20 s)"
  H "$RECHECK" > $OUT/R/recheck.json
  buzz 2 "R: done"
}

# ---------------------------------------------------------------- D
# The demo state: every grid3 point at the coordinates in its id, P, u selected, fiber mode. Committed in
# transactions of at most 16 actions (the planner's limit), then re-read; ok only if nothing is left.
RESET_D='(async () => {
  const home = (s) => s.id.slice(2, -1).split(",")
  const moved = (d) => d.sampleSets.find((x) => x.id === "grid3").samples.filter((s) => s.coords.map((c) => c.n + "/" + c.d).join() !== home(s).map((v) => v + "/1").join())
  const updates = moved(__mw.app.workspace.current).map((s) => ({ kind: "update_sample", sampleSetId: "grid3", sampleId: s.id, coords: home(s).map((v) => ({ n: v, d: "1" })) }))
  for (let i = 0; i < updates.length; i += 16) __mw.app.transact(updates.slice(i, i + 16), "pq-session")
  let d = __mw.app.workspace.current
  if (d.selection.experimentId !== "exp-p" || d.selection.sampleId !== "s(1,0,1)") __mw.app.transact([{ kind: "select", experimentId: "exp-p", sampleId: "s(1,0,1)" }], "pq-session")
  if (__mw.app.mode !== "fiber") __mw.app.command("mode")
  d = __mw.app.workspace.current
  const left = moved(d).map((s) => s.id)
  return { updates: updates.length, stillMoved: left, selection: d.selection, experiments: d.experiments.map((e) => e.id), mode: __mw.app.mode, rebindLabel: __mw.rebind().label, timeOrigin: performance.timeOrigin, ok: left.length === 0 && d.selection.experimentId === "exp-p" && d.selection.sampleId === "s(1,0,1)" && __mw.app.mode === "fiber" }
})()'
roundD() {
  # The ready signal must come after this moment, read before the pause and the reset.
  local TD; TD=$(pageNow) || { log "D: page time unreadable"; return }
  local wasLive=$(H "$LIVE")
  [[ ${D_NOW:-0} == 1 ]] || sleep 5 # the wearer stops at C's end pulses; let a drag in hand commit before the reset
  # Q already in the document: its button reads "Show Q" and only selects, so start from a fresh page.
  if [[ "$(H '__mw.app.workspace.current.experiments.some((e) => e.id === "exp-q")')" == true ]]; then
    reloadPage && log "D: page reloaded for a fresh document" || { log "D: reload FAILED"; return }
    TD=$(pageNow) || { log "D: page time unreadable"; return }
    wasLive=false
  fi
  H "$RESET_D" > $OUT/D/start.json
  grep -q '"ok": true' $OUT/D/start.json || { log "D: reset FAILED (see start.json)"; return }
  H 'fetch("/api/capabilities").then((r) => r.json()).then((c) => c.assistant)' > $OUT/D/assistant-capability.json
  log "D: start state set; waiting for the wearer (Enter VR, headset on, or a trigger on u)"
  [[ ${D_NOW:-0} == 1 ]] || waitReady $TD $wasLive 1800 || { log "D: no ready signal"; return }
  sleep 3 # let the wearer settle before the capture starts
  buzz 1 "D: started; inputs $(H "$INPUTS")"
  local T0=$(H 'performance.now()')
  adb -s "$DEV" shell screenrecord --time-limit 60 --bit-rate 20000000 /sdcard/Download/mw_pq_capture.mp4 &
  local REC=$!
  log "D: live; recording"
  sleep 3
  [[ "$(H '(__mw.assistant.ask("Show me what this transformation loses"), "sent")')" == '"sent"' ]] && log "D: assistant request sent (assistant-capability.json says synthetic or live)" || log "D: assistant request FAILED"
  sleep 4
  [[ "$(H '(__mw.evidence.check({ kind: "same_image_witness", branch: { experimentId: "exp-p", branchId: "main" }, u: "s(1,0,1)", v: "s(1,0,-1)" }), "sent")')" == '"sent"' ]] && log "D: Lean check requested" || log "D: Lean check request FAILED"
  wait $REC; local recStatus=$?
  H "({ T0: ${T0:-null}, timeOrigin: performance.timeOrigin, log: __mw.device.logSince(${T0:-0}).map((e) => [Math.round(e.t), e.event, e.detail]), snapshot: __mw.app.snapshot(), assistant: __mw.assistant.history, evidence: __mw.evidence.entries.map((e) => ({ status: e.status, current: e.current, label: e.label, claimHash: e.claimHash, receipt: e.response?.receipt ?? null, provenance: e.response?.provenance ?? null })), audit: __mw.device.audit(), frameErrors: __mw.host.errors, perf: __mw.host.perf() })" > $OUT/D/session.json
  H '(async () => { const s = await __mw.storage.saveDocument(__mw.app.workspace.current); return { status: s, text: __mw.storage.exportText(__mw.app.workspace.current) } })()' > $OUT/D/saved.json
  if reloadPage; then log "D: recording ended; page reloaded; waiting for Enter VR"; else log "D: reload FAILED; the reopen below is on the same page"; fi
  if [[ $recStatus == 0 ]] && adb -s "$DEV" pull /sdcard/Download/mw_pq_capture.mp4 $OUT/D/ >/dev/null 2>&1; then log "D: recording saved"; else log "D: recording FAILED"; fi
  waitLive true 600 || { log "D: no re-entry"; return }
  sleep 4
  H '(async () => { const re = await __mw.storage.loadSaved(); if (!re) return { reopened: false }; __mw.app.openDocument(re.doc, "reopen"); await new Promise((r) => setTimeout(r, 4000)); return { reopened: true, timeOrigin: performance.timeOrigin, savedAt: re.savedAt, text: __mw.storage.exportText(__mw.app.workspace.current), snapshot: __mw.app.snapshot(), eqOut: __mw.app.currentDescription()?.primitives.find((p) => p.id === "eq:out")?.plain ?? null, audit: __mw.device.audit(), canUndo: __mw.app.workspace.canUndo } })()' > $OUT/D/reopened.json
  buzz 2 "D: reopened"
}

ROUNDS=${ROUNDS:-A C D}
log "session start (device $DEV, page port $PORT, rounds $ROUNDS)"
for r in ${=ROUNDS}; do round$r; done
log "session end"
