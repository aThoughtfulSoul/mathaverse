#!/bin/zsh
# Captures of the refined UI in the real app (headless Chrome, real WebGL; docs/MILESTONE-UI-REFINEMENT.md).
# Every step goes through the product UI: DOM clicks on the shell's own buttons (the same handlers a mouse
# click runs), or, in the WebXR emulator (IWER), the spatial shell's command path. Assistant answers are the
# server's synthetic fixtures, labelled as such in the panel; no Meta request is made.
#   PORT=3012 zsh scripts/ui-capture.sh [desktop|assistant|math|layout|xr ...]
# Use the no-hot-reload server (.local/vite.verify.config.ts), so concurrent edits never reload a run.
set -u
cd "${0:A:h}/.."
PORT=${PORT:-3012}
OUT=${OUT:-docs/evidence/ui/integrated}
mkdir -p $OUT
READY='window.__mw && __mw.ui && __mw.ui.active()'
# Helpers in the page: click a shell button by its visible text (exact first, then containing), wait for a
# condition, and summarise the current view.
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
  async until(f, ms = 15000) {
    const t0 = performance.now()
    while (!f()) {
      if (performance.now() - t0 > ms) throw new Error("timed out")
      await new Promise((r) => setTimeout(r, 100))
    }
    return true
  },
  view() {
    const v = __mw.ui.view(), p = (l) => (l && l.plain) || l
    return { demo: v.experiment.kind, question: v.experiment.question, subtitle: p(v.experiment.subtitle), status: v.presentation.status.text,
      inspector: v.inspector, assistant: __mw.assistant.state.kind, rev: __mw.app.workspace.current.revision, frameErrors: __mw.frameErrors().count }
  },
}, "helpers ready")'
SHOT=(node --experimental-websocket scripts/shot.mjs)
run() { "${SHOT[@]}" --url "$1" --size "$2" --wait "$READY" --eval "$HELP" --sleep 1500 "${@:3}" --eval '__cap.view()' --eval '({frameErrors: __mw.frameErrors(), uiProblems: __mw.ui.problems, errors: document.getElementById("errors").textContent})'; }
ev() { args+=(--eval "$1") }
wait_ms() { args+=(--sleep $1) }
shot() { args+=(--shot $OUT/$1.png) }
# Choose an experiment through the picker (toolbar Experiments, then the experiment's card).
pick() { ev "(__cap.click('Experiments'), __cap.view().demo)"; wait_ms 500; [[ ${2:-} == shot ]] && shot picker-open; ev "(__cap.click('$1', '.mw-pop'), __cap.view())"; }

Q_pq='What gets lost when we flatten space?'
Q_order='Does the order change the result?'
Q_sculpture='How many moves bring every bead home?'
Q_cube='Can a rotation be a rearrangement?'
Q_quotient='When do 24 rotations become six?'
Q_braid='Can different moves make the same braid?'

parts=("$@")
(( $#parts )) || parts=(desktop assistant math layout xr)
for part in $parts; do
  args=()
  case $part in
  desktop)
    # The six default views, each reached through the picker; the assistant panel is open on first visit.
    pick "$Q_sculpture" shot; wait_ms 3500; shot default-sculpture
    for d in pq order cube quotient braid; do pick "${(P)${:-Q_$d}}"; wait_ms 4000; shot default-$d; done
    ev "(__cap.click('More'), 'more')"; wait_ms 500; shot more-menu
    run "http://localhost:$PORT/?capture=1" 1600x1000 "${args[@]}" ;;
  assistant)
    # A suggested question, sent from the panel: the synthetic fixture's proposal is validated and applied
    # (C4 -> V4 recipe reuse, "Use this representation on V₄"), with its source label and the Undo route visible.
    pick "$Q_sculpture"; wait_ms 3000; shot assistant-1-suggestions
    ev "(__cap.click('Use this representation on V'), __cap.view())"
    ev "__cap.until(() => ['applied','answered','rejected','error','stale'].includes(__mw.assistant.state.kind)).then(() => __cap.view())"
    wait_ms 2500; shot assistant-2-synthetic-applied
    # Typed question that the synthetic server has no fixture for: the honest "no prepared reply" state.
    ev "(__mw.ui.dispatch({kind:'assistant', action:{kind:'ask', text:'Explain the first isomorphism theorem in one line'}}), 'asked')"
    ev "__cap.until(() => __mw.assistant.state.kind !== 'pending').then(() => __cap.view())"
    wait_ms 800; shot assistant-3-no-fixture
    # Closing the panel: Ask Meta Muse AI reopens it from the toolbar.
    ev "(__cap.click('Close Ask Meta Muse AI', '.mw-inspector'), __cap.view())"; wait_ms 600; shot assistant-4-closed
    run "http://localhost:$PORT/?capture=1" 1600x1000 "${args[@]}" ;;
  math)
    # Show mathematics on three experiments, after real interactions (Apply twice on C4; braid relation preset;
    # P -> Q with a Lean or exact check where the detail offers one).
    pick "$Q_sculpture"; wait_ms 2500
    ev "(__cap.click('Apply'), __cap.view())"; wait_ms 2600; ev "(__cap.click('Apply'), __cap.view())"; wait_ms 2600
    ev "(__cap.click('Show mathematics'), __cap.view())"; wait_ms 1200; shot math-sculpture
    pick "$Q_braid"; wait_ms 3000; shot math-braid
    pick "$Q_cube"; wait_ms 3000; ev "(__cap.click('Rz'), __cap.view())"; wait_ms 2600; shot math-cube-after-rz
    pick "$Q_pq"; wait_ms 3500; shot math-pq
    run "http://localhost:$PORT/?capture=1" 1600x1000 "${args[@]}" ;;
  layout)
    # Narrow window (stacked layout) and the clean-stage filming view (all 2D chrome hidden, the answer too).
    pick "$Q_sculpture"; wait_ms 3500; shot narrow-sculpture
    run "http://localhost:$PORT/?capture=1" 820x1100 "${args[@]}"
    # Clean stage: no chrome to click, so the experiment is chosen through the same UiCommand the picker sends.
    args=(); ev "(__mw.ui.dispatch({kind:'experiment', demo:'order'}), __cap.view())"; wait_ms 4000; shot clean-order
    run "http://localhost:$PORT/?clean=1" 1600x1000 "${args[@]}" ;;
  xr)
    # The spatial shell in the WebXR emulator (IWER, both eyes): each experiment, then the spatial picker,
    # the mathematics inspector and More, all opened through the spatial shell's commands.
    ev "(async () => { await __mw.xr.enter(); await __mw.waitFrames(30); __mw.xr.head([0, 1.6, 0.42], 0, -14); await __mw.waitFrames(20); return __mw.ui.view().surface })()"
    for d in sculpture pq order cube quotient braid; do ev "(__mw.ui.dispatch({kind:'experiment', demo:'$d'}), __cap.view())"; wait_ms 3500; shot xr-$d; done
    ev "(__mw.ui.dispatch({kind:'experiment', demo:'sculpture'}), __mw.ui.dispatch({kind:'popover', which:'experiments'}), 'picker')"; wait_ms 2500; shot xr-picker
    ev "(__mw.ui.dispatch({kind:'popover', which:null}), __mw.ui.dispatch({kind:'inspector', which:'math'}), __cap.view())"; wait_ms 1500; shot xr-math
    ev "(__mw.ui.dispatch({kind:'popover', which:'more'}), 'more')"; wait_ms 1200; shot xr-more
    ev "(async () => { __mw.ui.dispatch({kind:'popover', which:null}); __mw.ui.dispatch({kind:'inspector', which:'assistant'}); await __mw.xr.exit(); await __mw.waitFrames(10); return __mw.ui.view().surface })()"
    run "http://localhost:$PORT/?capture=1" 1600x1000 "${args[@]}" ;;
  esac
done
