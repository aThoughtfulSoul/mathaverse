#!/bin/zsh
# Passthrough headset check (docs/HEADSET-RUNBOOK.md, "Passthrough check"). Passive: it waits for the wearer to
# enter a passthrough session, then logs the session kind, the blend mode, the demonstration shown and frame
# errors every 2 s until the session ends. It takes NO screenshots or recordings: passthrough frames show the
# wearer's room.
#   PORT=3011 zsh scripts/passthrough-check.sh
set -u
cd "${0:A:h}/.."
PORT=${PORT:-3011}
OUT=${OUT:-.local/passthrough-check}
WAIT=${WAIT:-3600}
mkdir -p $OUT
H() { PAGE_MATCH=localhost:$PORT RAW=1 node --experimental-websocket scripts/headset.mjs eval "$1" 2>>$OUT/errors.txt }
log() { print -r -- "$(date +%H:%M:%S) $*" | tee -a $OUT/progress.txt }
STATE='({ t: Math.round(performance.now()), mode: __mw.host.sessionMode, presenting: __mw.host.presenting, blend: __mw.host.renderer.xr.getSession()?.environmentBlendMode ?? null, visibility: __mw.host.renderer.xr.getSession()?.visibilityState ?? null, backdrop: __mw.app.passthroughBackdropVisible, demo: __mw.app.demo, status: __mw.app.snapshot().scene?.status ?? null, frameErrors: __mw.host.errors.count })'

log "passthrough check: waiting up to $WAIT s for Enter passthrough"
t0=$SECONDS
until [[ "$(H '__mw.host.sessionMode')" == '"passthrough"' ]]; do
  (( SECONDS - t0 > WAIT )) && { log "no passthrough session started"; exit 1 }
  sleep 1
done
log "passthrough session started"
H "$STATE" | tee -a $OUT/states.jsonl >/dev/null
seen=''
while [[ "$(H '__mw.host.presenting')" == true ]]; do
  s=$(H "$STATE")
  print -r -- "$s" >> $OUT/states.jsonl
  d=$(print -r -- "$s" | python3 -c 'import json,sys; print(json.load(sys.stdin)["demo"])' 2>/dev/null)
  [[ -n $d && $d != $seen ]] && { log "showing $d"; seen=$d }
  sleep 2
done
log "session ended"
python3 - "$OUT/states.jsonl" <<'EOF' | tee -a $OUT/progress.txt
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip().startswith('{')]
demos = []
for r in rows:
    if r.get('demo') and (not demos or demos[-1] != r['demo']): demos.append(r['demo'])
print('summary:', json.dumps({'samples': len(rows), 'modes': sorted({str(r.get('mode')) for r in rows}), 'blend': sorted({str(r.get('blend')) for r in rows}), 'backdrop': sorted({str(r.get('backdrop')) for r in rows if r.get('presenting')}), 'demos': demos, 'frameErrors': max((r.get('frameErrors', 0) for r in rows), default=0)}))
EOF
