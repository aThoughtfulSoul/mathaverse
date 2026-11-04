# Voice: Meta transcription and push-to-talk

Updated 4 November 2026.

Speech uses **Meta `muse-voice-transcribe-1.0`**. The browser records a question, the local backend converts the recording with ffmpeg, and Meta returns a transcript. The user can review that text before it reaches the same assistant request path used by typed questions. Muse reasoning and speech transcription have separate responses and status labels.

## Setup

Run `zsh scripts/muse-live.sh serve` and enter your Meta API key at the hidden prompt. The key stays on the server. Install ffmpeg for audio conversion; no speech model runs in the browser or on the headset. See [LOCAL-SUBMISSION.md](LOCAL-SUBMISSION.md) for the complete setup.

| Variable | Default | Meaning |
|---|---|---|
| `SPEECH_PROVIDER` | `auto` | `auto` enables Meta when credentials are configured; `meta` selects Meta explicitly; `off` disables voice. These are the only accepted values. |
| `META_API_KEY` / `MODEL_API_KEY` | none | Server-side credential, never logged or returned to the browser. |
| `META_TRANSCRIBE_MODEL` | `muse-voice-transcribe-1.0` | The transcription model, separate from the Muse reasoning model. |
| `META_TRANSCRIBE_ENDPOINT` | `https://api.meta.ai/v1/asr/transcribe` | HTTPS endpoint without credentials embedded in the URL. |
| `FFMPEG_BIN` | ffmpeg on PATH or a standard Homebrew path | Optional absolute path to the audio converter. |

Missing credentials or ffmpeg make voice unavailable. A failed Meta request displays its error and leaves the question unsent. Typed questions and direct mathematical controls remain available.

## What the implementation does

1. `src/voice/client.ts` records a bounded clip using `getUserMedia` and `MediaRecorder`, releases the microphone, and uploads to `POST /api/transcribe`.
2. `server/speech/config.ts` resolves Meta credentials and ffmpeg. `auto` enables speech when credentials are configured.
3. `server/speech/index.ts` validates the body and container signature, converts to a private temporary WAV, measures duration and level, and invokes the Meta adapter once.
4. `server/speech/meta.ts` sends the WAV and request metadata as multipart data. It returns a transcript or a source-labelled error.
5. The browser validates the response, displays the transcript, and submits the reviewed text through `AssistantClient.ask`. Only the separately validated assistant proposal can change the workspace.

The code comments at those boundaries describe the same division of responsibility. ffmpeg performs format conversion, Meta performs transcription, and Muse interprets the resulting text.

## Capabilities and provenance

`GET /api/capabilities` reports:

- `configured`: a Meta credential and ffmpeg are available.
- `mode`: `meta` or `unavailable`.
- `provider`, `model`: the configured Meta identifiers.
- `liveValidated`: a successful transcription in this server process with this exact configuration. Changing the endpoint, model or key invalidates that status.
- `acceptedMimeTypes`: empty when unavailable.
- `problem`: the reason voice is unavailable, without credentials.

Checking capabilities sends no audio and makes no Meta API call. The UI keeps “live call unverified” until the server reports a successful transcription. A speech transcript is labelled separately from a Muse answer.

## Recording limits, cancellation and privacy

The route accepts WebM/Opus, Ogg/Opus, MP4 and WAV, checks the declared type against the bytes, and converts to 16 kHz mono 16-bit PCM WAV. Requests are limited to 30 seconds and 1,500,000 base64 characters; the decoded duration allows a 0.5-second recorder tolerance. Silent clips, recordings shorter than 0.2 seconds, empty results, repetitive transcripts and hint echoes are rejected.

Conversion has a 10-second deadline and the Meta call has a 30-second deadline, within the 45-second application timeout. Cancellation aborts conversion or the network request and prevents the transcript from being submitted. Request-scoped temporary files are removed in a `finally` block. Audio, transcripts, keys and provider error bodies are not logged by the route.

A successful response contains only transcript provenance and timing:

```ts
{ requestId, transcript, source: 'meta', provider, model,
  timing: { audioMs, providerMs, totalMs } }
```

Authentication, permission, billing, rate-limit, timeout and network errors retain distinct messages. Meta HTTP 504 is distinguished from the application's own deadline. The client rejects stale request IDs and non-Meta success envelopes.

## Browser client (`VoiceClient`)

**States:** `idle | unavailable | recording | transcribing | transcript | submitted | error | canceled`.

Two optional additive fields record that recording stopped at the limit: `limitReached` on `transcribing` and on `transcript`. `acquiring` is true while the microphone is being requested.

**Desktop.** `start()`/`stop()`. The panel's Record button supports hold-to-talk (a press held ≥ 350 ms stops on release) and press/press again. Holding T also records until T is released (not while typing in a field). The transcript waits in an editable field. `submit(text)` sends the corrected text: Send, or Enter in the field.

**XR.** Use `toggle({ autoSubmitMs })`. One control does all of it:

- Press to start, press to stop.
- While transcribing, or inside the auto-submit window, the same press cancels.
- The transcript is sent after `autoSubmitMs` (2500 ms in XR) unless `cancel()` or `edit()` happens first.

`talkLabelFor(state, client.acquiring)` gives Talk, Stop, Cancel or No voice.

**XR controller hold-to-talk** (2 November; `HoldToTalk` in `src/runtime/input.ts`, wired in `src/app.ts`). It works only with the spatial shell, while presenting. It dispatches the Talk control's own commands, so the panel, the Talk label and the voice client stay one state.

- Hold A (right) or X (left) for 0.3 s or longer to start. This is the Talk control's `voiceToggle`, so the 2.5 s auto-send applies. If the assistant panel is not open, it opens first. A short haptic pulse marks the start.
- Release stops (`voiceStop`, another pulse). A release while the microphone is still being requested ends with "Released before the microphone was ready. Press Talk again to speak."
- B or Y while recording, or while the microphone is being requested, cancels (`voiceCancel`). Nothing is uploaded.
- A press released within 0.3 s is a tap: play/pause, fired on release.
- A hold is ignored during a drag, while speech or the assistant is unavailable, and while voice is busy (`holdToTalkBlocked`: a microphone request, a recording, a transcription or a pending auto-send). An ignored hold opens nothing and is not a tap. One hand holds at a time.
- The session becoming hidden, the session ending or the controller disconnecting cancels a recording a hold started.
- A recording a hold started can end another way while A or X is still held (Cancel or Close on the panel, an experiment change, the 15 s limit, a microphone error). The hold then lets go: its release stops nothing.
- Legacy UI (`?ui=legacy`, no spatial shell): no hold-to-talk; a long press is a tap.
- The app log records `voiceHoldStart`, `voiceHoldStop`, `voiceHoldCancel`, `voiceHoldIgnored` (with a reason) and `voiceHoldDropped`.

More detail is in UI-ASSISTANT.md (historical development reference; not included), "Voice behaviour". The headset check is in HEADSET-RUNBOOK.md (historical development reference; not included), "Hold-to-talk check".

**`cancel()`** works:

- while the microphone is being requested (a late grant is released at once);
- while recording (the audio is discarded and never uploaded);
- during transcription (the fetch is aborted);
- during the auto-submit window.

Every `start()` and `cancel()` bumps a sequence number, so a stale response is ignored. A response echoing another request ID is rejected.

**Limits.** Recording stops at `maxMs` (default 15 s, capped at 30 s) and says so. A tap under 0.2 s is not uploaded. Releasing before the permission prompt is answered ends with a clear message.

**Microphone.** The microphone is requested per utterance and released as soon as recording ends, so there is no always-on listening. Errors are reported as:

| Code | Cause |
|---|---|
| `mic_denied` | Denied |
| `mic_unavailable` | No device |
| `mic_busy` | Device not readable |
| `recorder_error` | The recorder failed or the track ended |

Each of these messages points to typed input. With no secure context, no `getUserMedia` or no `MediaRecorder`, the state is `unavailable`. `requestMicrophone()` asks for permission without recording (see the Quest notes).

**Format.** The client uses the first server-accepted type that `MediaRecorder.isTypeSupported` accepts. Hints are the coordinator's `hints()` (displayed labels) followed by `VOICE_VOCABULARY`, bounded to 40.

**Timing.** `lastTiming` gives `releaseToTranscriptMs` (client side, from release or the limit stop to the transcript shown), `providerMs`, `serverTotalMs`, `audioMs` and `uploadBytes`. `history` keeps the last 30 utterances.

**Input level.** `inputLevel()` gives the current recording's level, 0 to 1, from a Web Audio analyser on the recording's own stream. It is 0 when nothing records. Nothing is played back or sent. The glyph orb reads it (UI-ASSISTANT.md (historical development reference; not included), "Glyph orb").

**Captions.** `captionFor(state)` returns a `VoiceLine`. The app shows it in the scene only without the UI shell (`?ui=legacy`). With the shell, the voice lines are in the assistant panel (below).

| State | Caption |
|---|---|
| `recording` | "Listening… press Talk to stop" |
| `transcribing` | "Transcribing…", plus a note when stopped at the limit |
| `transcript` | `You said: "…" · edit or send`, or `… · sending, press Cancel to stop` |
| `submitted` | `You said: "…"` |
| `error` | `Voice: <message>` |
| `unavailable` | `Speech unavailable: <reason>` |
| `canceled` | "Canceled: nothing was sent" |
| `idle` | `null` |

**XR panel wording** (`src/ui/assistant/view.ts`, `src/ui/assistant/spatialLayout.ts`):

| When | Line |
|---|---|
| Talk reads Talk | Its hint: "Hold A or X to talk, or press Talk to start and stop". Beside it, when the row has room: "or hold A or X to talk" |
| Microphone requested | "Waiting for the microphone… (allow it in the browser prompt)" |
| Recording | "Listening… N s · press Stop or release A/X when you are done" |
| Transcribing | "Transcribing N.N s of audio…", plus " (stopped at the recording limit)" |
| Transcript, counting down | `You said: "…"`, its source line, then "Sending in N s · press Cancel to stop" |
| Too short (the client's `too_short`, or the route's `no_speech` for audio under 0.2 s) | "That recording was too short. Hold A or X while you speak, or press Talk to start and stop." The desktop keeps the client's own message, whose "Hold Talk" advice is for the desktop control. |
| Canceled | "Voice canceled · nothing was sent." |

## Verification

The automated suite uses explicitly synthetic providers, mock Meta responses and fake recording devices. Those fixtures test behavior without a key and do not establish live service access.

- Route tests cover validation, silence, cancellation, timeout, cleanup and configuration changes.
- Meta adapter and submission tests cover multipart requests, credential redaction, error propagation, one-request behavior and no fallback.
- Audio-format tests pass generated tones through real ffmpeg conversion to a mocked Meta endpoint. They test format handling, not speech-recognition accuracy.
- Client and UI tests cover editable transcripts, microphone permissions, cancellation, stale responses and Meta provenance labels.
- `zsh scripts/muse-live.sh speech` is an explicit live test upload. Its macOS-generated input is labelled synthesized audio, not a person or headset microphone.

The builder reported successful Meta transcription and worn-headset voice sessions on 1 November. Those recordings remain local. Automated tests do not establish live API or headset behavior; see [RELEASE-CHECK.md](RELEASE-CHECK.md) for current automated results and limitations.
