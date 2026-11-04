#!/bin/zsh
# The voice chain in the real app (handoff 2026-11-01 section 1): browser recorder → /api/transcribe → Meta
# speech-to-text → visible transcript → Send → live Muse → validated scene update, for one proof request (then a
# real Lean check of that finite example) and one non-proof request.
# It needs the app already running with a key: `zsh scripts/muse-live.sh serve` (live Muse, SPEECH_PROVIDER=meta).
# INPUT IS NOT A MICROPHONE: headless Chrome's fake capture device plays a WAV synthesized with macOS `say`
# (--use-file-for-fake-audio-capture). The page records it with the real MediaRecorder path and its track label
# (VoiceTiming.inputDevice) is recorded, so these runs are never presented as microphone evidence. A person
# speaking into a real microphone is a separate check (docs/FILMING-NOTES.md).
#   PORT=3010 zsh scripts/voice-chain.sh [proof|nonproof ...]
# This integration check requires both Meta services. Keyless unit tests use injected fixtures instead.
set -u
cd "${0:A:h}/.."
PORT=${PORT:-3010}
URL="http://localhost:$PORT/"
OUT=${OUT:-docs/evidence/voice-chain/$(date +%Y-%m-%d-%H%M%S)}
caps=$(curl -s "$URL"api/capabilities) || { echo "The app is not running on $URL; start it with zsh scripts/muse-live.sh serve."; exit 1; }
print -r -- "$caps" | python3 -c "
import json,sys
c=json.load(sys.stdin); a=c['assistant']; s=c.get('speech') or {}
ok = a.get('mode')=='meta' and s.get('mode')=='meta'
print('assistant:', a.get('mode'), a.get('model'), '| speech:', s.get('mode'), s.get('model'), '| proof:', c.get('proof',{}).get('toolchain'))
sys.exit(0 if ok else 3)" || { echo "Live Muse and Meta speech-to-text must both be configured (assistant mode meta, speech mode meta); nothing was sent."; exit 1; }
mkdir -p $OUT
print -r -- "$caps" > $OUT/capabilities.json

# One WAV per request: half a second of silence, the sentence, then a second of silence (16-bit mono 48 kHz).
wav() {
  local name=$1 text=$2 work=$(mktemp -d "${TMPDIR:-/tmp}/mw-voice.XXXXXX")
  say -o "$work/s.aiff" "$text" && ffmpeg -nostdin -hide_banner -loglevel error -y -f lavfi -t 0.5 -i anullsrc=r=48000:cl=mono -i "$work/s.aiff" -f lavfi -t 1 -i anullsrc=r=48000:cl=mono \
    -filter_complex '[1:a]aresample=48000,aformat=channel_layouts=mono[s];[0:a][s][2:a]concat=n=3:v=0:a=1' -c:a pcm_s16le "$OUT/$name.wav" || return 1
  rm -rf -- "$work"
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/$name.wav"
}

READY='window.__mw && __mw.ui && __mw.ui.active()'
HELP='(window.__cap = {
  btn(name) {
    const all = [...document.querySelectorAll("#shell button, #shell [role=button], #shell [role=option]")].filter((b) => b.offsetParent !== null)
    const label = (b) => (b.getAttribute("aria-label") || "") + " " + b.textContent.trim()
    return all.find((b) => b.getAttribute("aria-label") === name || b.textContent.trim() === name) ?? all.find((b) => label(b).includes(name)) ?? null
  },
  click(name) {
    const b = this.btn(name)
    if (!b) throw new Error(`no visible button "${name}"`)
    if (b.disabled || b.getAttribute("aria-disabled") === "true") throw new Error(`button "${name}" is disabled`)
    b.click()
    return name
  },
  async until(f, ms = 45000) {
    const t0 = performance.now()
    while (!f()) {
      if (performance.now() - t0 > ms) throw new Error("timed out")
      await new Promise((r) => setTimeout(r, 100))
    }
    return true
  },
  voice() {
    const v = __mw.voice, s = v.state
    return { state: s.kind, transcript: s.kind === "transcript" ? s.text : null, transcriptSource: s.kind === "transcript" ? { source: s.response.source, provider: s.response.provider, model: s.response.model } : null,
      error: s.kind === "error" ? { code: s.code, message: s.message } : null, timing: v.lastTiming }
  },
  answer() {
    const s = __mw.assistant.state, r = s.response
    return { state: s.kind, prompt: s.prompt ?? null, source: r?.source ?? null, model: r?.model ?? null, timing: r?.timing ?? null, title: r?.proposal?.title ?? null,
      explanation: r?.proposal?.explanation ?? null, actions: r?.proposal?.actions?.map((a) => a.kind) ?? null, summary: s.summary ?? null, sceneChangeMs: s.sceneChangeMs ?? null,
      error: s.kind === "error" ? s.error : null, selection: __mw.app.workspace.current.selection, facts: [...document.querySelectorAll("[data-assistant=facts]")].map((e) => e.innerText) }
  },
}, "helpers ready")'
SPEAK='(__cap.click("Record a question for Meta Muse AI"), "recording")'
STOP='(__cap.click("Stop recording"), "stopped")'
TRANSCRIPT='__cap.until(() => ["transcript", "error"].includes(__mw.voice.state.kind)).then(() => ({ chainVoice: __cap.voice() }))'
SEND='(__cap.click("Send the transcript to Meta Muse AI"), "sent")'
ANSWER='__cap.until(() => ["applied", "answered", "rejected", "stale", "error"].includes(__mw.assistant.state.kind)).then(() => ({ chainAnswer: __cap.answer() }))'
PICK_PROOF='(__cap.click("Experiments"), "picker")'
OPEN_PROOF='(__cap.click("How does rearranging these steps keep us closer to home?"), "proof lesson")'

run() {
  local name=$1 text=$2; shift 2
  local secs=$(wav $name "$text") || { echo "Could not synthesize $name; nothing was sent."; return 1; }
  local hold=$(python3 -c "print(int(float('$secs')*1000)+300)")
  echo "== $name: \"$text\" (${secs}s of audio, fake capture device)"
  # The audio service sandbox stops Chrome reading the WAV (the fake device then records silence).
  CHROME_EXTRA_ARGS="--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --disable-features=AudioServiceSandbox --use-file-for-fake-audio-capture=$PWD/$OUT/$name.wav" \
    node --experimental-websocket scripts/proof-record.mjs --url "$URL" --size 1600x1000 --wait "$READY" --eval "$HELP" --sleep 2000 "$@" \
    --eval "$SPEAK" --sleep $hold --eval "$STOP" --eval "$TRANSCRIPT" --sleep 600 --shot $OUT/$name-1-transcript.png \
    --eval "$SEND" --eval "$ANSWER" --sleep 3000 --shot $OUT/$name-2-answer.png --eval '({ chainAfter: __cap.answer() })' \
    "${post[@]}" > $OUT/$name.log 2>&1
  grep -E '"chain(Voice|Answer|Lean)"' $OUT/$name.log | cut -c1-600
}
post=()

parts=("$@")
(( $#parts )) || parts=(proof nonproof)
for part in $parts; do
  case $part in
  proof)
    # The proof lesson, then the spoken question, then a real Lean check of the finite example shown.
    post=(--eval '(__cap.click("Check in Lean"), "check")'
      --eval '__cap.until(() => __mw.evidence.entries.some((e) => ["checked", "not_established", "error"].includes(e.status)), 60000).then(() => ({ chainLean: __mw.evidence.entries.map((e) => ({ status: e.status, current: e.current, receipt: e.response?.receipt ?? null })) }))'
      --eval '(__cap.click("Show mathematics"), "math")' --sleep 900
      --eval '([...document.querySelectorAll("#shell *")].find((el) => el.children.length === 0 && el.textContent.trim() === "Lean check of this finite example")?.scrollIntoView({ block: "start" }), "receipt")'
      --sleep 800 --shot $OUT/proof-3-lean-receipt.png)
    run proof 'Why is this point inside the bound?' --eval "$PICK_PROOF" --sleep 700 --eval "$OPEN_PROOF" --sleep 2500
    post=()
    ;;
  nonproof)
    run nonproof 'Use this representation on Q.'
    ;;
  *) echo "unknown part $part"; continue ;;
  esac
done
echo "Logs, screenshots and the WAV inputs: $OUT"
