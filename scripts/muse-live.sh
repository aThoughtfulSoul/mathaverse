#!/bin/zsh
# Live Meta calls for the local submission (docs/MUSE.md "Live smoke test", docs/VOICE.md), with the key typed
# at a hidden prompt. The key lives only in this script's environment: it is never echoed, written to a file or
# to shell history, and it is unset when the script exits.
# Speech is Meta speech-to-text on every path (SPEECH_PROVIDER=meta, muse-voice-transcribe-1.0, push-to-talk):
# ffmpeg converts the audio and Meta transcribes it.
# Errors preserve the Meta HTTP status and are displayed before any question is submitted.
#   zsh scripts/muse-live.sh rehearse   # no key: every live case against a mocked provider (synthetic answers)
#   zsh scripts/muse-live.sh test       # real calls: one preflight call, then the live smoke test; records in
#                                       # docs/evidence/muse-live/<time>/; then offers to start the app
#   zsh scripts/muse-live.sh serve      # real calls from the app: npm run dev (port 3010) with the key, live Muse
#                                       # for Ask Meta Muse AI and Meta speech-to-text for Talk/Record
#   zsh scripts/muse-live.sh again '<case name part>' [n]   # real calls: that case n times (default 3), with the
#                                       # model's output recorded when it is rejected; then offers to start the app
#   zsh scripts/muse-live.sh speech ['<sentence>']   # ONE real Meta speech-to-text call: macOS `say` speaks the
#                                       # sentence into a temporary file, ffmpeg makes it 16 kHz mono 16-bit WAV
#                                       # and the app's own /api/transcribe route code sends it (in process).
#                                       # It is a test-uploaded recording (synthesized speech), not a browser
#                                       # microphone. Record: docs/evidence/speech-live/<time>/stt.json; then
#                                       # offers to start the app
set -u
cd "${0:A:h}/.."
mode=${1:-test}
pattern=${2:-}
times=${3:-3}
export SPEECH_PROVIDER=meta
export MUSE_MODE=auto
unset MUSE_LIVE MUSE_REHEARSAL MUSE_LIVE_DIR SPEECH_LIVE SPEECH_LIVE_DIR SPEECH_LIVE_WAV SPEECH_LIVE_TEXT
work=''
default_sentence='Show me what this transformation loses.'

case $mode in
  rehearse) npx vitest run tests/muse/live.test.ts; exit $? ;;
  test|serve) ;;
  again)
    [[ -n $pattern ]] || { echo "usage: zsh scripts/muse-live.sh again '<case name part>' [n]"; exit 2; }
    [[ $times == <1-50> ]] || { echo "usage: zsh scripts/muse-live.sh again '<case name part>' [n] (n is 1 to 50)"; exit 2; } ;;
  speech)
    sentence=${pattern:-$default_sentence}
    if ! [[ $sentence =~ '^[A-Za-z][A-Za-z0-9 ,.?!'"'"'-]{0,159}$' ]]; then
      echo "usage: zsh scripts/muse-live.sh speech ['<sentence>'] (letters, digits, spaces and , . ? ! ' - only; at most 160 characters)"
      exit 2
    fi
    for tool in say ffmpeg; do
      command -v $tool > /dev/null || { echo "$tool was not found (the speech check needs macOS say and ffmpeg); nothing was sent."; exit 1; }
    done ;;
  *) echo "usage: zsh scripts/muse-live.sh [rehearse|test|serve|again '<case name part>' [n]|speech ['<sentence>']]"; exit 2 ;;
esac

if [[ -z ${META_API_KEY:-} ]]; then
  print -n "Paste the Meta API key (nothing is shown), then press Return: "
  read -rs META_API_KEY
  print
fi
[[ -n ${META_API_KEY:-} ]] || { echo "No key entered; nothing was sent."; exit 1; }
export META_API_KEY
cleanup() {
  unset META_API_KEY
  # Only the speech check's own two temporary files and its mktemp directory.
  if [[ -n $work && -d $work ]]; then rm -f -- "$work/request.aiff" "$work/request.wav"; rmdir -- "$work" 2> /dev/null; fi
  return 0
}
trap cleanup EXIT
[[ $META_API_KEY == LLM_* ]] || echo "Note: the key does not start with LLM_ as Meta's examples do; continuing."

serve() {
  echo "Starting the app on http://localhost:3010 with live Muse and Meta speech-to-text (SPEECH_PROVIDER=meta)."
  echo "Ctrl+C stops it; the key is cleared on exit."
  # Bound to this computer only: with the key loaded, the LAN must not reach /api/*. adb reverse still reaches it.
  npm run dev:local
}

if [[ $mode == serve ]]; then serve; exit $?; fi

mkdir -p .local
log=.local/muse-live-last.log

if [[ $mode == speech ]]; then
  log=.local/speech-live-last.log
  work=$(mktemp -d "${TMPDIR:-/tmp}/mw-stt-live.XXXXXX") || { echo "Could not create a temporary directory; nothing was sent."; exit 1; }
  if ! say -o "$work/request.aiff" "$sentence" 2> /dev/null || [[ ! -s $work/request.aiff ]]; then
    echo "say could not synthesize the sentence; nothing was sent."
    exit 1
  fi
  if ! ffmpeg -nostdin -hide_banner -loglevel error -y -i "$work/request.aiff" -ac 1 -ar 16000 -c:a pcm_s16le "$work/request.wav" || [[ ! -s $work/request.wav ]]; then
    echo "ffmpeg could not convert the synthesized speech to 16 kHz mono 16-bit WAV; nothing was sent."
    exit 1
  fi
  out=docs/evidence/speech-live/$(date +%Y-%m-%d-%H%M%S)
  echo "One real Meta speech-to-text call (SPEECH_PROVIDER=meta) through the app's /api/transcribe route code."
  echo "Input: test-uploaded recording (synthesized speech), not a browser microphone. Sentence: \"$sentence\""
  SPEECH_LIVE=1 SPEECH_LIVE_WAV=$work/request.wav SPEECH_LIVE_TEXT=$sentence SPEECH_LIVE_DIR=$out npx vitest run tests/voice/sttLive.test.ts > $log 2>&1
  run_status=$?
  grep -E '\[speech-live\]' $log | head -3 | cut -c1-700
  if (( run_status == 0 )); then
    echo "Meta speech-to-text answered. Record: $out/stt.json. Full log: $log."
  else
    grep -E '×|AssertionError|Error:' $log | head -6 | cut -c1-300
    echo "The speech check failed (details above and in $log; the record, when one was written, is $out/stt.json)."
  fi
  print -n "Start the app with live Muse and Meta speech-to-text now? [y/N] "
  read -r answer
  [[ $answer == [yY]* ]] && serve
  exit $run_status
fi

if [[ $mode == again ]]; then
  out=docs/evidence/muse-live/$(date +%Y-%m-%d-%H%M)-again
  passed=0
  for i in $(seq 1 $times); do
    if MUSE_LIVE=1 MUSE_LIVE_DIR=$out/run-$i npx vitest run tests/muse/live.test.ts -t "$pattern" > $log.$i 2>&1; then
      passed=$((passed + 1)); echo "Run $i: passed."
    else
      echo "Run $i: failed."; grep -E '"error"' $log.$i | head -2 | cut -c1-300
    fi
  done
  echo "$passed of $times runs passed. Records: $out/run-*/live.json."
  print -n "Start the app with live Muse and Meta speech-to-text now? [y/N] "
  read -r answer
  [[ $answer == [yY]* ]] && serve
  exit 0
fi
echo "Preflight: one real request (P: what this transformation loses)."
if ! MUSE_LIVE=1 npx vitest run tests/muse/live.test.ts -t 'shows a sample and its fiber on P' > $log 2>&1; then
  grep -E '\[muse-live\]|×|→|AssertionError' $log | head -20
  echo "The preflight call failed (details above and in $log). Stopping before the full run."
  exit 1
fi
grep -E '\[muse-live\]' $log | head -3

out=docs/evidence/muse-live/$(date +%Y-%m-%d-%H%M)
echo "Full live run; records go to $out/live.json."
MUSE_LIVE=1 MUSE_LIVE_DIR=$out npx vitest run tests/muse/live.test.ts > $log 2>&1
run_status=$?
grep -E '^ *(✓|×)|Tests ' $log
echo "Full log: $log. Records: $out/live.json."

print -n "Start the app with live Muse and Meta speech-to-text now? [y/N] "
read -r answer
[[ $answer == [yY]* ]] && serve
exit $run_status
