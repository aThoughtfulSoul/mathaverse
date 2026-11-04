#!/bin/zsh
# Integrated desktop captures of the four algebra demonstrations in the real app (headless Chrome, real WebGL),
# following each filming sequence through the same validated actions the controls and the assistant use.
#   PORT=3012 zsh scripts/four-demos-capture.sh [sculpture|cube|quotient|braid ...]
# Use a dev server without hot reload (see docs/MILESTONE-FOUR-DEMOS.md), so concurrent edits never reload a run.
set -u
cd "${0:A:h}/.."
PORT=${PORT:-3012}
OUT=${OUT:-docs/evidence/four-demos/integrated}
mkdir -p $OUT
URL="http://localhost:$PORT/?capture=1"
SHOT=(node --experimental-websocket scripts/shot.mjs --url $URL --size 1600x1000 --wait 'window.__mw && __mw.app && __mw.sceneProblems' --sleep 2500)
args=()
show() { args+=(--eval "(__mw.app.showDemo('$1', 'capture'), __mw.app.snapshot().scene)") }
tx() { args+=(--eval "(__mw.app.transact($1, 'capture'), __mw.app.snapshot().scene)") }
cmd() { args+=(--eval "(__mw.app.command('$1'), __mw.app.snapshot().scene)") }
wait_ms() { args+=(--sleep $1) }
shot() { args+=(--shot $OUT/$1.png) }
finish() { args+=(--eval '__mw.app.snapshot()' --eval '({frameErrors: __mw.frameErrors ? __mw.frameErrors() : null, sceneProblems: __mw.sceneProblems})'); "${SHOT[@]}" "${args[@]}"; args=() }
apply() { tx "[{kind:'apply_element',experimentId:'$1',element:'$2'}]" }

for d in ${@:-sculpture cube quotient braid}; do
  case $d in
  sculpture)
    show sculpture; wait_ms 2000; shot sculpture-1-c4-home
    apply exp-c4 c1; wait_ms 800; shot sculpture-2-c4-generator-mid; wait_ms 1800
    apply exp-c4 c1; wait_ms 2400; apply exp-c4 c1; wait_ms 2400
    apply exp-c4 c1; wait_ms 2600; shot sculpture-3-c4-home-after-four
    cmd rebind; wait_ms 1800; shot sculpture-4-same-recipe-v4
    apply exp-v4 v10; wait_ms 800; shot sculpture-5-v4-exchange-mid; wait_ms 1800
    apply exp-v4 v10; wait_ms 2600; shot sculpture-6-v4-home-after-two
    finish ;;
  cube)
    # After Rz the objects 0 and 1 lie on lines phi(Rz)[0] = 1 and phi(Rz)[1] = 3: swapping them is the transposition (1 3).
    show cube; wait_ms 2000; shot cube-1-home
    apply exp-cube 'r(y,-x,z)'; wait_ms 650; shot cube-2-rz-mid; wait_ms 1600; shot cube-3-rz-after
    tx "[{kind:'apply_permutation',experimentId:'exp-cube',representation:'diagonal_lines',permutation:[0,3,2,1]}]"; wait_ms 700; shot cube-4-swap-from-objects-mid; wait_ms 1600; shot cube-5-swap-after
    cmd rebind; wait_ms 2200; shot cube-6-return-home
    finish ;;
  quotient)
    show quotient; wait_ms 2000; shot quotient-1-all-24
    cmd rebind; wait_ms 1100; shot quotient-2-regroup-mid; wait_ms 2200; shot quotient-3-six-classes
    tx "[{kind:'select_item',experimentId:'exp-quotient',item:'class:102'}]"; wait_ms 1500; shot quotient-4-expanded-rz-class
    tx "[{kind:'set_operands',experimentId:'exp-quotient',operands:['r(y,-x,z)','r(-x,z,y)']}]"; wait_ms 1500; shot quotient-5-compose
    tx "[{kind:'set_operands',experimentId:'exp-quotient',operands:['r(-y,x,z)','r(-x,z,y)']}]"; wait_ms 1500; shot quotient-6-another-representative
    finish ;;
  braid)
    show braid; wait_ms 2000; shot braid-1-relation
    tx "[{kind:'rewrite_braid',experimentId:'exp-braid',rule:'braid_relation',at:0,generator:null}]"; wait_ms 2600; shot braid-2-deform-mid; wait_ms 5000; shot braid-3-equal-by-rewrite
    cmd rebind; wait_ms 2000; shot braid-4-double-crossing-vs-identity
    cmd rebind; wait_ms 2000; shot braid-5-inverse-pair
    tx "[{kind:'rewrite_braid',experimentId:'exp-braid',rule:'cancel_pair',at:0,generator:null}]"; wait_ms 1800; shot braid-6-cancel-mid; wait_ms 5000; shot braid-7-cancelled
    finish ;;
  esac
done
