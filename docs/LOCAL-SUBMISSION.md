# Run the Mathaverse locally

Public source release · 4 November 2026

The browser renders the workspace. A local Vite backend serves the application and its assistant, transcription and Lean routes from the same origin. Meta models run on Meta's API; Lean and ffmpeg run on your computer. There is no hosted version and no API key in the repository.

## Prerequisites

- **Node.js 20.19 or later and npm.** The existing development environment uses Node 20.19.5 on Apple silicon macOS. Other platforms have not been verified by this project.
- **Meta API access, optional:** your account must have access to `muse-spark-1.3` for the assistant and `muse-voice-transcribe-1.0` for voice. See [Meta's model documentation](https://dev.meta.ai/docs/models). The configured models may require hackathon access.
- **ffmpeg, optional:** required for speech; place it on PATH or set `FFMPEG_BIN`. On macOS, `brew install ffmpeg` is one installation option.
- **Lean 4.26.0, optional:** required for formal checks. The scenes and exact mathematical computations work without it.
- **A WebXR-capable headset, optional:** a Quest 3S was used during development. Desktop use does not require a headset.

## Install and explore without credentials

```sh
git clone https://github.com/aThoughtfulSoul/mathaverse.git
cd mathaverse
npm ci
npm run dev:local
```

Open **http://localhost:3010**. The local command binds to 127.0.0.1. Do not run a second server on port 3010 while the first is active.

Without a key, all seven experiments, mathematical operations, Undo and workspace storage remain available. Assistant replies are labelled synthetic fixtures. Voice requires a configured Meta API key and ffmpeg. Without those, type your questions. To disable voice explicitly even when a key is present:

```sh
SPEECH_PROVIDER=off npm run dev:local
```

Without Lean, the UI reports checker unavailability; exact computation is not presented as a Lean proof.

## Live Meta assistant and speech

Stop the earlier dev server, then run in a terminal with zsh:

```sh
zsh scripts/muse-live.sh serve
```

The script prompts for your key without echoing it. It selects live Muse and Meta transcription, starts `npm run dev:local`, and clears its environment key on exit. The key never belongs in a browser field, Git commit or recording. The server reads credentials from its environment; simply creating a `.env` file does not configure these routes.

Use **Ask Meta Muse AI** to type or choose a suggested question. For speech, grant microphone access and use the app's microphone/Talk controls. Typed and suggested requests work without ffmpeg or microphone access. Meta speech errors stay visible; there is no silent provider fallback.

For bash, an alternative start is:

```bash
read -r -s -p 'Meta API key: ' META_API_KEY
printf '\n'
export META_API_KEY
SPEECH_PROVIDER=meta MUSE_MODE=auto npm run dev:local
unset META_API_KEY
```

Read the current provider status at **http://localhost:3010/api/capabilities**. `liveValidated` becomes true only after a real call succeeds in that server process. A configured key alone is not a successful live call.

Both model identifiers and endpoints can be overridden in the server environment; see [MUSE.md](MUSE.md) and [VOICE.md](VOICE.md). Model availability depends on Meta access. This project does not provide credentials or an inference service.

## Optional Lean checks

Install elan using the [upstream instructions](https://github.com/leanprover/elan), then:

```sh
elan toolchain install leanprover/lean4:v4.26.0
"${ELAN_HOME:-$HOME/.elan}/toolchains/leanprover--lean4---v4.26.0/bin/lean" --githash
```

Expected commit: `d8204c9fd894f91bbb2cdfec5912ec8196fd8562`.

The backend runs this pinned binary directly. It does not install a toolchain during a request. `ELAN_HOME` defaults to `~/.elan`. No Mathlib download or Lake project is needed. Use **Check in Lean** for a supported claim, then inspect its receipt in **Show mathematics**. The proof lesson's receipt covers the current finite example. [Checker details](LEAN.md).

## Headset workflow

The development workflow uses the same local server with USB port forwarding to Quest Browser. Start with Meta's [immersive web debugging documentation](https://developers.meta.com/vr/documentation/web/browser-remote-debugging) to configure developer access and port forwarding for your device (verified against the official documentation on 4 November 2026). Forward the headset's localhost port **3010** to this computer's port **3010**, then open **http://localhost:3010** in Quest Browser and use the app's **Enter VR** control (under **More**).

For voice, grant microphone permission on the flat browser page before entering VR. Text replies and suggested questions do not require speech. Keep the local server running. Editing the application source can reload the page and interrupt a session.

This release does not require public hosting, a domain, a tunnel or a cloud deployment.

## Build and test

```sh
npm run patch:check
npm run typecheck
npm test
npm run build
```

The install script applies the pinned manim-web nested-SVG patch. `npm ci` may warn that a transitive tooling package requests a newer Node version. The existing development setup uses Node 20.19.5. Keep the lockfile and review [DEPENDENCIES.md](DEPENDENCIES.md) before upgrading.

The ordinary tests use mocked provider calls. Live smoke checks are opt-in and can incur API usage; they are not required for judging the local scenes. Optional-tool tests may skip when their prerequisites are absent.

## Release contents and scope

The repository includes the application, backend, tests, recipes, developer documentation and third-party notices. Local API credentials, raw captures, video editing files, device logs and private work-session reports are excluded. Historical references to `docs/evidence/` describe local artifacts; they are not distributed as proof of fresh verification.

Original project code is MIT-licensed. Dependencies and the proof source keep their upstream licences; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The selected proof source is pinned in [its attribution notice](../third_party/openai-math-steinitz/NOTICE.md).
