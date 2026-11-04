#!/bin/zsh
# Second-demo headset session, driven from the Mac (HEADSET-RUNBOOK.md, "Second-demo session"). Rounds A
# (comparison), B (voice), C (labels on P) and D (the recorded Q drag), in order, or $ROUNDS. Each round
# starts on a wearer action, never on headset off/on alone; two controller pulses mark its end. Results go to
# $OUT/<round>/, progress lines to $OUT/progress.txt and driver errors to $OUT/errors.txt.
#
#   start  reload the page to a fresh document; ask for the microphone once on the 2D page
#   A  from the switch to the comparison: a 40 s compositor recording and label overlaps in both eyes,
#      seen from the wearer's head, every 0.4 s with the playback step
#   M  leave VR; the microphone answer on the 2D page (the start's request, or a Record press there)
#   B  the square back at its grid positions with e1 selected; from the first Talk press in VR: every voice
#      state with its caption and Talk label, the recorder types, utterance history and timing, assistant
#      requests, the left route before and after, a 75 s compositor recording and 70 s of label overlaps
#   C  from the wearer's P/Q demo press: 35 s of label overlaps every 0.4 s with the selection
#   D  P with u selected, fiber mode, every point at home; from the wearer's trigger on u: a 60 s unedited
#      compositor recording, labels, readout and a's input/output dots every 0.5 s; then save and reopen in place
#
# Environment: PORT (page port, default 3011), DEV (adb serial of the USB headset, default the first USB
# device), OUT (default .local/second-demo-session), WAIT (seconds a round waits for the wearer to start
# it, default 3600; the session stops rather than run on without them). Needs `adb reverse tcp:$PORT tcp:$PORT` and
# `adb forward tcp:9222 localabstract:chrome_devtools_remote`. Page lists are never printed.
set -u
cd "${0:A:h}/.."
PORT=${PORT:-3011}
DEV=${DEV:-$(adb devices | awk 'NR > 1 && $2 == "device" && $1 !~ /:/ && $1 !~ /\._adb/ { print $1; exit }')}
OUT=${OUT:-.local/second-demo-session}
WAIT=${WAIT:-3600}
[[ -n $DEV ]] || { echo "no USB adb device found; set DEV" >&2; exit 1 }
mkdir -p $OUT/start $OUT/A $OUT/M $OUT/B $OUT/C $OUT/D
export PAGE_MATCH=localhost:$PORT

H() { node --experimental-websocket scripts/headset.mjs eval "$1" 2>>$OUT/errors.txt }
log() { echo "$(date +%H:%M:%S) $*" | tee -a $OUT/progress.txt }
LIVE='(() => { const s = __mw.host.renderer.xr.getSession(); return !!s && __mw.host.renderer.xr.isPresenting && s.visibilityState === "visible" })()'
waitLive() { # $1 = true|false, $2 = seconds
  local end=$((SECONDS + $2))
  while (( SECONDS < end )); do [[ "$(H "$LIVE")" == "$1" ]] && return 0; sleep 1; done; return 1
}
waitTrue() { # $1 = JS expression, $2 = seconds
  local end=$((SECONDS + $2))
  while (( SECONDS < end )); do [[ "$(H "$1")" == true ]] && return 0; sleep 1; done; return 1
}
pageNow() {
  local t
  for k in 1 2 3 4 5; do t=$(H 'performance.now()'); [[ $t =~ '^[0-9]+(\.[0-9]+)?$' ]] && { echo $t; return 0 }; sleep 1; done
  return 1
}
reloadPage() {
  local before=$(H 'performance.timeOrigin')
  [[ "$(H '(setTimeout(() => location.reload(), 200), "reloading")')" == '"reloading"' ]] || return 1
  local end=$((SECONDS + 30)) now
  while (( SECONDS < end )); do sleep 1; now=$(H '(typeof __mw === "object" && __mw.app ? performance.timeOrigin : null)'); [[ -n $now && $now != null && $now != "$before" ]] && return 0; done
  return 1
}
U_EVENT='(e.event === "select" && e.detail === "s(1,0,1)") || (e.event === "dragStart" && e.detail?.sampleId === "s(1,0,1)")'
# Quest Browser's pulse() promise can stay pending: never awaited past 1 s (see pq-session.sh).
BUZZ='(async () => { const as = [...(__mw.host.renderer.xr.getSession()?.inputSources ?? [])].map((s) => s.gamepad?.hapticActuators?.[0]).filter((a) => a?.pulse); const played = await Promise.all(as.map((a) => Promise.race([a.pulse(0.8, 200).catch(() => false), new Promise((r) => setTimeout(() => r(false), 1000))]))); return played.filter(Boolean).length + "/" + as.length })()'
buzz() { local n all=""; for k in $(seq 1 $1); do n=$(H "$BUZZ"); all="$all ${${n//\"/}:-?}"; sleep 0.45; done; log "$2 (pulses played/asked:$all)" }
record() { # $1 = seconds, $2 = file name; runs in the background, pulled by pullRecording
  adb -s "$DEV" shell screenrecord --time-limit $1 --bit-rate 12000000 /sdcard/Download/$2 &
}
pullRecording() { # $1 = pid, $2 = file name, $3 = round dir
  wait $1; local st=$?
  if [[ $st == 0 ]] && adb -s "$DEV" pull /sdcard/Download/$2 $3/ >/dev/null 2>&1; then log "recording $2 saved"; else log "recording $2 FAILED"; fi
}

# Label overlaps as the emulator's measureLabels (verifyXR.ts), from the device's own eye cameras: every
# shown floating label (alpha 1) and fixed scene text, projected into each eye; a pair overlaps when it
# involves a floating label. $1 = duration ms, $2 = interval ms, $3 = sample ids whose input/output dots to track.
labels() {
  echo "(async (ms, every, track) => {
    const ad = __mw.app.adapter
    const xr = __mw.host.renderer.xr
    const V = ad.headAt.constructor
    const fixedRe = /^(eq:|caption:|title:|axis:)/
    const dotWorld = (view, id) => { try { const rec = ad.dots?.[view]?.get(id); if (!rec) return null; const g = ad.viewMathGroup(view); g.updateMatrixWorld(); return g.localToWorld(rec.mob.getThreeObject().position.clone()).toArray().map((v) => +v.toFixed(4)) } catch { return null } }
    const out = []
    const t0 = performance.now()
    while (performance.now() - t0 < ms) {
      const report = ad.labelLayoutReport()
      const floating = report.filter((x) => x.shown && x.alpha === 1).map((x) => x.id)
      const fixed = [...ad.slots.keys()].filter((id) => fixedRe.test(id) || id === 'lbl:plane' || id === 'lbl:fiber')
      const cams = xr.isPresenting ? xr.getCamera().cameras : []
      const overlaps = []
      cams.forEach((cam, eye) => {
        const rects = []
        for (const id of [...floating, ...fixed]) {
          const s = ad.slots.get(id)
          if (!s || !s.anchor.visible || !s.width) continue
          const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new V(sx * s.width / 2, sy * s.height / 2, 0).applyMatrix4(s.anchor.matrixWorld).project(cam))
          rects.push({ id, x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) })
        }
        for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j]
          if (!floating.includes(a.id) && !floating.includes(b.id)) continue
          const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
          if (w > 1e-4 && h > 1e-4) overlaps.push('eye' + eye + ': ' + a.id + ' x ' + b.id)
        }
      })
      const must = report.filter((x) => x.mustShow)
      const snap = __mw.app.snapshot()
      const h = ad.headAt
      const dots = {}
      for (const id of track) dots[id] = { input: dotWorld('input', id), output: dotWorld('output', id) }
      out.push({ t: Math.round(performance.now()), experiment: snap.experimentId, selection: snap.selection, step: snap.playback?.step?.label ?? null, playing: !!snap.playback?.active, eyes: cams.length, head: [h.x, h.y, h.z].map((v) => +v.toFixed(3)), mustShown: must.length > 0 && must.every((x) => x.shown && x.alpha === 1), must: must.map((x) => x.id), hidden: report.filter((x) => !x.shown).map((x) => x.id), overlaps, readout: ad.slotReport().find((r) => r.id === 'eq:out' && r.visible)?.plain ?? null, dots })
      await new Promise((r) => setTimeout(r, every))
    }
    const pairs = {}
    for (const s of out) for (const o of s.overlaps) { const k = s.experiment + ' / ' + s.selection + (s.playing ? ' / ' + s.step + ' (playing)' : '') + ': ' + o.replace(/^eye[0-9]+: /, ''); pairs[k] = (pairs[k] ?? 0) + 1 }
    const live = out.filter((s) => s.eyes === 2)
    return { samples: out.length, inXR: live.length, withOverlap: live.filter((s) => s.overlaps.length).length, withOverlapAtRest: live.filter((s) => s.overlaps.length && !s.playing).length, mustAlwaysShown: live.every((s) => s.mustShown), pairs, audit: __mw.device.audit(), frameErrors: __mw.host.errors, series: out }
  })($1, $2, $3)"
}

# ---------------------------------------------------------------- start
start() {
  waitTrue '(typeof __mw === "object" && !!__mw.app)' 300 || { log "start: no page at localhost:$PORT"; return 1 }
  reloadPage && log "start: page reloaded to a fresh document" || { log "start: reload FAILED"; return 1 }
  # Fire and forget: the prompt waits on the 2D page for the wearer; the answer is read in rounds A and B.
  local asked=$(H '(window.__mic = { askedAt: Math.round(performance.now()) }, navigator.permissions?.query({ name: "microphone" }).then((p) => (__mic.before = p.state), () => (__mic.before = "unsupported")), __mw.voice.requestMicrophone().then((ok) => (__mic.granted = ok, __mic.answeredAt = Math.round(performance.now()))), "asked")')
  [[ $asked == '"asked"' ]] && log "start: microphone requested on the 2D page" || log "start: microphone request FAILED"
  H '(async () => ({ capabilities: await fetch("/api/capabilities").then((r) => r.json()), experiments: __mw.app.workspace.current.experiments.map((e) => e.id), selection: __mw.app.workspace.current.selection, timeOrigin: performance.timeOrigin, ua: navigator.userAgent }))()' > $OUT/start/page.json
}

# ---------------------------------------------------------------- A
roundA() {
  log "A: waiting for Enter VR, then Order demo"
  waitLive true $WAIT || { log "A: never live"; return 1 }
  H '({ info: __mw.device.info(), mic: window.__mic ?? null })' > $OUT/A/info.json
  waitTrue '__mw.app.workspace.current.selection.experimentId === "exp-order"' $WAIT || { log "A: Order demo never pressed"; return 1 }
  local T0=$(H 'performance.now()')
  record 40 mw_order_readability.mp4; local REC=$!
  log "A: comparison shown; recording 40 s"
  H "$(labels 39000 400 '[]')" > $OUT/A/labels.json
  H "({ T0: ${T0:-null}, snapshot: __mw.app.snapshot(), log: __mw.device.logSince(${T0:-0}).map((e) => [Math.round(e.t), e.event, e.detail]), controls: __mw.app.controls.report().map((c) => [c.id, c.plain, c.state]), mic: window.__mic ?? null })" > $OUT/A/session.json
  buzz 2 "A: done"
  pullRecording $REC mw_order_readability.mp4 $OUT/A
}

# ---------------------------------------------------------------- M
# The start's request got no answer in the first run (the permission stayed "prompt" through round A), so
# the permission is decided on the 2D page: VR is exited, and the wearer answers the waiting prompt or
# presses Record in the page's Voice box (a user gesture) and answers that one.
PERMISSION='(async () => navigator.permissions?.query({ name: "microphone" }).then((p) => p.state, () => "unsupported"))()'
roundM() {
  # M_RELOAD=1: a fresh page (which also ends VR) drops a microphone request left pending since the start;
  # in the first run a Record press on the page then showed no prompt either, as if queued behind it.
  if [[ ${M_RELOAD:-0} == 1 ]]; then reloadPage && log "M: page reloaded" || { log "M: reload FAILED"; return 1 }
  elif [[ "$(H '__mw.host.renderer.xr.isPresenting')" == true ]]; then H '(__mw.xr.exit(), "exiting")' >/dev/null; sleep 2; fi
  local TM; TM=$(pageNow) || { log "M: page time unreadable"; return 1 }
  H "(async () => ({ TM: $TM, mic: window.__mic ?? null, permission: await $PERMISSION, presenting: __mw.host.renderer.xr.isPresenting, voice: __mw.voice.state }))()" > $OUT/M/before.json
  log "M: VR exited; waiting for the microphone answer on the 2D page"
  waitTrue "(async () => [\"granted\", \"denied\"].includes(await $PERMISSION))()" $WAIT || { log "M: no microphone answer"; return 1 }
  log "M: microphone $(H "$PERMISSION")"
  waitTrue '!__mw.voice.busy' 60 # a Record press on the page: let its recording and transcription end
  H "(async () => ({ TM: $TM, mic: window.__mic ?? null, permission: await $PERMISSION, presenting: __mw.host.renderer.xr.isPresenting, voice: __mw.voice.state, history: __mw.voice.history, lastTiming: __mw.voice.lastTiming, log: __mw.device.logSince($TM).map((e) => [Math.round(e.t), e.event, e.detail]) }))()" > $OUT/M/after.json
  log "M: done"
}

# ---------------------------------------------------------------- B
# Each voice state with whether the session was presenting: the round counts only attempts made in VR.
VOICE_ARM='(window.__voff?.(), window.__vlog = [], window.__voff = __mw.voice.subscribe((st) => __vlog.push({ t: Math.round(performance.now()), xr: __mw.host.renderer.xr.isPresenting, kind: st.kind, text: st.text ?? null, code: st.code ?? null, message: st.message ?? null, autoSubmitAt: st.autoSubmitAt ?? null, limitReached: st.limitReached ?? null, acquiring: __mw.voice.acquiring, talk: __mw.app.controls.label("talk"), caption: __mw.app.adapter.slotReport().find((r) => r.id === "lbl:voice")?.plain ?? null })), "armed")'
# The comparison as the demo prepares it: the square's samples at the coordinates in their ids, e1 selected.
RESET_B='(async () => {
  // A reloaded page has no comparison yet: open it as the Order demo control does.
  if (!__mw.app.workspace.current.experiments.some((e) => e.id === "exp-order")) __mw.app.showDemo("order", "second-demo-session")
  const home = (s) => s.id.slice(2, -1).split(",")
  const moved = (d) => d.sampleSets.find((x) => x.id === "set-square").samples.filter((s) => s.coords.map((c) => c.n + "/" + c.d).join() !== home(s).map((v) => v + "/1").join())
  const updates = moved(__mw.app.workspace.current).map((s) => ({ kind: "update_sample", sampleSetId: "set-square", sampleId: s.id, coords: home(s).map((v) => ({ n: v, d: "1" })) }))
  if (updates.length) __mw.app.transact(updates, "second-demo-session")
  let d = __mw.app.workspace.current
  if (d.selection.experimentId !== "exp-order" || d.selection.sampleId !== "s(1,0,0)") __mw.app.transact([{ kind: "select", experimentId: "exp-order", sampleId: "s(1,0,0)" }], "second-demo-session")
  if (__mw.app.snapshot().playback?.active) __mw.app.adapter.setPlayback("finish")
  d = __mw.app.workspace.current
  const left = moved(d).map((s) => s.id)
  return { updates: updates.length, stillMoved: left, selection: d.selection, comparison: __mw.app.snapshot().comparison, ok: left.length === 0 && d.selection.experimentId === "exp-order" && d.selection.sampleId === "s(1,0,0)" }
})()'
roundB() {
  local BD=${B_DIR:-B} BN=${B_ATTEMPTS:-3} BREC=${B_REC:-mw_voice_comparison.mp4}
  mkdir -p $OUT/$BD
  H "$RESET_B" > $OUT/$BD/start.json
  grep -q '"ok": true' $OUT/$BD/start.json || { log "$BD: reset FAILED (see start.json)"; return 1 }
  [[ "$(H "$VOICE_ARM")" == '"armed"' ]] || { log "$BD: voice log not armed"; return 1 }
  H '(async () => ({ secure: isSecureContext, getUserMedia: !!navigator.mediaDevices?.getUserMedia, recorder: typeof MediaRecorder, types: ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4", "audio/wav"].map((m) => [m, typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)]), picked: __mw.voice.pickMime(), permission: await navigator.permissions?.query({ name: "microphone" }).then((p) => p.state, () => "unsupported"), mic: window.__mic ?? null, speech: __mw.voice.speechCapability, comparison: __mw.app.snapshot().comparison, assistantBefore: __mw.assistant.history.length, revision: __mw.app.workspace.current.revision }))()' > $OUT/$BD/before.json
  local TB=$(H 'performance.now()')
  log "$BD: square reset; waiting for the first Talk press in VR"
  waitTrue '(__vlog.some((e) => e.xr && e.kind === "recording") || (__mw.voice.acquiring && __mw.host.renderer.xr.isPresenting))' $WAIT || { log "$BD: Talk never pressed"; return 1 }
  record 75 $BREC; local REC=$!
  H "$(labels 70000 400 '[]')" > $OUT/$BD/labels.json &
  local LAB=$!
  log "$BD: voice in use; recording 75 s; waiting for $BN attempts (up to 4 min)"
  # An attempt ends on a change into submitted/canceled/error: the client re-emits its current state (for
  # example when the microphone request starts), and a repeated "submitted" ended the first run early.
  waitTrue '(__vlog.filter((e, i) => e.xr && ["submitted", "canceled", "error"].includes(e.kind) && __vlog[i - 1]?.kind !== e.kind).length >= '$BN' && !__mw.voice.busy)' 240 || log "$BD: fewer than $BN attempts ended"
  sleep 4 # the submitted request's scene change
  H "({ TB: ${TB:-null}, states: __vlog, history: __mw.voice.history, lastTiming: __mw.voice.lastTiming, state: __mw.voice.state, assistant: __mw.assistant.history.slice(-4), comparison: __mw.app.snapshot().comparison, revision: __mw.app.workspace.current.revision, log: __mw.device.logSince(${TB:-0}).map((e) => [Math.round(e.t), e.event, e.detail]), audit: __mw.device.audit(), frameErrors: __mw.host.errors })" > $OUT/$BD/session.json
  wait $LAB
  buzz 2 "B: done"
  pullRecording $REC $BREC $OUT/$BD
}

# Round V: the short voice re-run after the no_speech fix (one spoken request, one silent attempt).
roundV() { local B_DIR=B2 B_ATTEMPTS=2 B_REC=mw_voice_rerun.mp4; roundB }

# ---------------------------------------------------------------- C
roundC() {
  local TC; TC=$(pageNow) || { log "C: page time unreadable"; return 1 }
  log "C: waiting for P/Q demo"
  # The wearer's press, after this round began (the selection alone may already be on P).
  waitTrue "(__mw.device.logSince($TC).some((e) => e.event === \"command\" && e.detail === \"demo\") && __mw.app.workspace.current.selection.experimentId === \"exp-p\")" $WAIT || { log "C: P/Q demo never pressed"; return 1 }
  log "C: on P; sampling labels 35 s"
  H "$(labels 35000 400 '[]')" > $OUT/C/labels.json
  buzz 2 "C: done"
}

# ---------------------------------------------------------------- D
RESET_D='(async () => {
  const home = (s) => s.id.slice(2, -1).split(",")
  const moved = (d) => d.sampleSets.find((x) => x.id === "grid3").samples.filter((s) => s.coords.map((c) => c.n + "/" + c.d).join() !== home(s).map((v) => v + "/1").join())
  const updates = moved(__mw.app.workspace.current).map((s) => ({ kind: "update_sample", sampleSetId: "grid3", sampleId: s.id, coords: home(s).map((v) => ({ n: v, d: "1" })) }))
  for (let i = 0; i < updates.length; i += 16) __mw.app.transact(updates.slice(i, i + 16), "second-demo-session")
  let d = __mw.app.workspace.current
  if (d.selection.experimentId !== "exp-p" || d.selection.sampleId !== "s(1,0,1)") __mw.app.transact([{ kind: "select", experimentId: "exp-p", sampleId: "s(1,0,1)" }], "second-demo-session")
  if (__mw.app.mode !== "fiber") __mw.app.command("mode")
  d = __mw.app.workspace.current
  const left = moved(d).map((s) => s.id)
  return { updates: updates.length, stillMoved: left, selection: d.selection, experiments: d.experiments.map((e) => e.id), mode: __mw.app.mode, rebindLabel: __mw.rebind().label, timeOrigin: performance.timeOrigin, ok: left.length === 0 && d.selection.experimentId === "exp-p" && d.selection.sampleId === "s(1,0,1)" && __mw.app.mode === "fiber" && __mw.rebind().label === "Use on Q" }
})()'
roundD() {
  sleep 3 # a drag in hand from round C commits first
  if [[ "$(H '__mw.app.workspace.current.experiments.some((e) => e.id === "exp-q")')" == true ]]; then
    reloadPage && log "D: page reloaded (Q already existed); the wearer must press Enter VR" || { log "D: reload FAILED"; return 1 }
  fi
  H "$RESET_D" > $OUT/D/start.json
  grep -q '"ok": true' $OUT/D/start.json || { log "D: reset FAILED (see start.json)"; return 1 }
  local TD; TD=$(pageNow) || { log "D: page time unreadable"; return 1 }
  log "D: start state set; waiting for a trigger on u"
  waitTrue "__mw.device.logSince($TD).some((e) => $U_EVENT)" $WAIT || { log "D: u never triggered"; return 1 }
  buzz 1 "D: started"
  local T0=$(H 'performance.now()')
  record 60 mw_q_drag_capture.mp4; local REC=$!
  log "D: recording 60 s"
  H "$(labels 58000 500 '["s(1,1,0)", "s(-1,1,0)"]')" > $OUT/D/labels.json
  wait $REC; local recStatus=$?
  H "({ T0: ${T0:-null}, log: __mw.device.logSince(${T0:-0}).map((e) => [Math.round(e.t), e.event, e.detail]), snapshot: __mw.app.snapshot(), experiments: __mw.app.workspace.current.experiments.map((e) => e.id), audit: __mw.device.audit(), frameErrors: __mw.host.errors })" > $OUT/D/session.json
  H '(async () => { const before = __mw.storage.exportText(__mw.app.workspace.current); const status = await __mw.storage.saveDocument(__mw.app.workspace.current); const re = await __mw.storage.loadSaved(); if (!re) return { status, reopened: false }; __mw.app.openDocument(re.doc, "reopen"); await new Promise((r) => setTimeout(r, 3000)); const after = __mw.storage.exportText(__mw.app.workspace.current); return { status, reopened: true, identical: before === after, bytes: before.length, snapshot: __mw.app.snapshot(), readout: __mw.app.adapter.slotReport().find((r) => r.id === "eq:out" && r.visible)?.plain ?? null, audit: __mw.device.audit(), text: after } })()' > $OUT/D/reopened.json
  buzz 2 "D: done"
  if [[ $recStatus == 0 ]] && adb -s "$DEV" pull /sdcard/Download/mw_q_drag_capture.mp4 $OUT/D/ >/dev/null 2>&1; then log "recording mw_q_drag_capture.mp4 saved"; else log "recording mw_q_drag_capture.mp4 FAILED"; fi
}

ROUNDS=${ROUNDS:-start A M B C D}
log "session start (device $DEV, page port $PORT, rounds $ROUNDS)"
for r in ${=ROUNDS}; do
  if [[ $r == start ]]; then start; else round$r; fi || { log "session stopped at $r"; exit 1 }
done
log "session end"
