#!/bin/zsh
# Captures of the proof lesson in the real app (headless Chrome, real WebGL; docs/MILESTONE-PROOF-EXPLORER.md).
# Every step goes through the product UI: DOM clicks on the shell's own buttons (the handlers a mouse click
# runs), the assistant's real client and route (synthetic fixtures, labelled as such in the panel, while no
# Meta key is configured) and the real /api/check Lean route. Desktop evidence (D) unless the part says XR,
# which is the IWER WebXR emulator (E), never a headset.
#   PORT=3013 zsh scripts/proof-capture.sh [stills|record|xr ...]
# Use the no-hot-reload verification server (.local/vite.verify-3013.config.ts).
set -u
cd "${0:A:h}/.."
PORT=${PORT:-3013}
OUT=${OUT:-docs/evidence/proof-explorer}
mkdir -p $OUT/app
URL="http://localhost:$PORT/"
READY='window.__mw && __mw.ui && __mw.ui.active()'
HELP='(window.__cap = {
  btn(text, scope = "#shell") {
    const all = [...document.querySelectorAll(`${scope} button, ${scope} [role=button], ${scope} [role=menuitem], ${scope} [role=option]`)].filter((b) => b.offsetParent !== null)
    const name = (b) => b.textContent.trim() || b.getAttribute("aria-label") || ""
    return all.find((b) => name(b) === text) ?? all.find((b) => name(b).includes(text)) ?? null
  },
  click(text, scope) {
    const b = this.btn(text, scope)
    if (!b) throw new Error(`no visible button "${text}"`)
    if (b.disabled || b.getAttribute("aria-disabled") === "true") throw new Error(`button "${text}" is disabled`)
    b.click()
    return b.textContent.trim().slice(0, 60)
  },
  async until(f, ms = 20000) {
    const t0 = performance.now()
    while (!f()) {
      if (performance.now() - t0 > ms) throw new Error("timed out")
      await new Promise((r) => setTimeout(r, 100))
    }
    return true
  },
  async settled(ms = 20000) { await this.until(() => !__mw.app.playback.active, ms); await __mw.waitFrames(10); return this.view() },
  async ask(text) {
    __mw.ui.dispatch({ kind: "assistant", action: { kind: "ask", text } })
    await this.until(() => ["applied", "answered", "rejected", "error", "stale"].includes(__mw.assistant.state.kind), 30000)
    return { assistant: __mw.assistant.state.kind, view: this.view() }
  },
  view() {
    const v = __mw.ui.view(), p = (l) => (l && l.plain) || l
    const doc = __mw.app.workspace.current
    return { demo: v.experiment.kind, subtitle: p(v.experiment.subtitle), context: v.presentation.context.title, status: v.presentation.status.text,
      stage: __mw.app.walkStage, item: doc.selection.item, rev: doc.revision, assistant: __mw.assistant.state.kind, frameErrors: __mw.frameErrors().count }
  },
}, "helpers ready")'
Q_proof='How does rearranging these steps keep us closer to home?'
args=()
ev() { args+=(--eval "$1") }
wait_ms() { args+=(--sleep $1) }
shot() { args+=(--shot $OUT/app/$1.png) }
mark() { args+=(--mark "$1") }
open_lesson() { ev "(__cap.click('Experiments'), 'picker')"; wait_ms 700; ev "(__cap.click('$Q_proof', '.mw-pop'), __cap.view())"; wait_ms 1500; }
finish() { ev '__cap.view()'; ev '({frameErrors: __mw.frameErrors(), uiProblems: __mw.ui.problems, errors: document.getElementById("errors").textContent})'; }

parts=("$@")
(( $#parts )) || parts=(stills record xr)
for part in $parts; do
  args=()
  case $part in
  stills)
    open_lesson; shot app-1-walk
    # Mid-trace: the settled frame is identical to app-1, so this still is taken while the walk is being drawn.
    ev "(__cap.click('Replay'), 'replay')"; wait_ms 2200; ev '__cap.view()'; shot app-2-walk-tracing; ev '__cap.settled()'
    ev "(__cap.click('Signs'), 'signs')"; ev '__cap.settled()'; shot app-3-signs
    ev "(__cap.click('Reorder'), 'reorder')"; ev '__cap.settled()'; ev "(__cap.click('Show the rearrangement'), 'transport')"; wait_ms 900; shot app-4-reorder-moving
    ev '__cap.settled()'; shot app-5-reorder-settled
    ev "(__cap.click('Next: why'), 'why')"; ev '__cap.settled()'; shot app-6-why-k3-positive
    ev "(__cap.click('Show mathematics'), 'math')"; wait_ms 1200; shot app-7-why-k3-mathematics
    ev "(__cap.click('− part'), 'k9')"; ev '__cap.settled()'; shot app-8-why-k9-negative
    ev "(__cap.click('Signs'), 'signs')"; ev '__cap.settled()'; ev "(__cap.click('Every sign +'), 'all +')"; ev '__cap.settled()'; ev "(__cap.click('Reorder'), 'reorder')"; ev '__cap.settled()'; shot app-9-all-positive-no-improvement
    ev "(__cap.click('Undo'), 'undo')"; ev '__cap.settled()'
    ev "(__cap.click('Assumptions'), 'assumptions')"; ev '__cap.settled()'; shot app-10-assumptions-hold
    ev "(__cap.click('Why must it return home?'), 'counterexample')"; ev '__cap.settled()'; shot app-11-counterexample
    ev "(__cap.click('Restore example'), 'restore')"; ev '__cap.settled()'
    ev "(__cap.click('Check in Lean'), 'check')"; ev "__cap.until(() => __mw.evidence.entries.some((e) => e.status === 'checked' || e.status === 'not_established' || e.status === 'error'), 30000).then(() => __mw.evidence.entries.map((e) => ({ status: e.status, current: e.current, receipt: e.response && e.response.receipt })))"
    wait_ms 600; ev "([...document.querySelectorAll('#shell *')].find((el) => el.children.length === 0 && el.textContent.trim() === 'Lean check of this finite example')?.scrollIntoView({ block: 'start' }), 'scrolled to the receipt')"; wait_ms 600; shot app-12-lean-receipt
    ev "(__cap.click('Ask Meta Muse AI'), 'assistant')"; wait_ms 800
    ev "__cap.ask('Why is this point inside the bound?')"; wait_ms 2500; shot app-13-assistant-why
    finish
    ;;
  record)
    # One continuous take (no cuts): question -> response -> state change included, waits kept as recorded.
    open_lesson
    args+=(--record-start $OUT/proof-explorer-interaction.mp4); mark 'lesson open: Walk'
    ev "(__cap.click('Replay'), 'replay')"; wait_ms 5500; mark 'walk traced'
    ev "(__cap.click('Signs'), 'signs')"; wait_ms 3500; mark 'signs'
    ev "(__cap.click('Reorder'), 'reorder')"; wait_ms 1200; ev "(__cap.click('Show the rearrangement'), 'transport')"; wait_ms 6000; mark 'reordered'
    ev "(__cap.click('Next: why'), 'why')"; wait_ms 4500; mark 'why k=3 (positive)'
    ev "__cap.ask('Show the other half of the argument')"; wait_ms 4500; mark 'assistant: other half -> k=9 (negative)'
    ev "(__cap.click('Next point'), 'k10')"; wait_ms 2500; mark 'learner selects k=10'
    ev "(__cap.click('Assumptions'), 'assumptions')"; wait_ms 2000
    ev "(__cap.click('Why must it return home?'), 'counterexample')"; wait_ms 5000; mark 'counterexample'
    ev "(__cap.click('Restore example'), 'restore')"; wait_ms 2500; mark 'restored'
    ev "(__cap.click('Check in Lean'), 'check')"; ev "__cap.until(() => __mw.evidence.entries.some((e) => e.status === 'checked' || e.status === 'not_established' || e.status === 'error'), 30000).then(() => __mw.evidence.entries.map((e) => e.status))"
    ev "(__cap.click('Show mathematics'), 'math')"; wait_ms 900; ev "([...document.querySelectorAll('#shell *')].find((el) => el.children.length === 0 && el.textContent.trim() === 'Lean check of this finite example')?.scrollIntoView({ block: 'start' }), 'scrolled to the receipt')"; wait_ms 3000; mark 'Lean receipt shown'
    args+=(--record-stop)
    finish
    ;;
  xr)
    # IWER emulator (E): the same lesson in the spatial shell, both eyes; not a headset run.
    open_lesson
    ev "(async () => { await __mw.xr.enter(); await __mw.waitFrames(30); __mw.xr.head([0, 1.6, 0.42], 0, -14); await __mw.waitFrames(20); return __mw.ui.view().surface })()"
    ev "(__mw.ui.dispatch({kind:'context', id:'stage:walk'}), __cap.settled())"; shot xr-1-walk
    ev "(__mw.ui.dispatch({kind:'context', id:'stage:reorder'}), __cap.settled())"; shot xr-2-reorder
    ev "(__mw.ui.dispatch({kind:'context', id:'stage:why'}), __mw.ui.dispatch({kind:'context', id:'positive'}), __cap.settled())"; shot xr-3-why-k3
    ev "(__mw.ui.dispatch({kind:'context', id:'stage:assumptions'}), __mw.ui.dispatch({kind:'context', id:'open'}), __cap.settled())"; shot xr-4-counterexample
    ev "(__mw.ui.dispatch({kind:'context', id:'restore'}), __cap.settled())"
    ev "(async () => { await __mw.xr.exit(); await __mw.waitFrames(10); return __mw.ui.view().surface })()"
    finish
    ;;
  *) echo "unknown part $part"; continue ;;
  esac
  node --experimental-websocket scripts/proof-record.mjs --url "$URL" --size 1600x1000 --wait "$READY" --eval "$HELP" --sleep 1500 "${args[@]}"
done
