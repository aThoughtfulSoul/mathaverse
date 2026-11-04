# Release checks

4 November 2026 · Apple silicon macOS, Node 20.19.5

## Scrolling update

The mathematics inspector now scrolls long claims and receipts with a controller thumbstick while its ray points at the panel. The content window, hit targets, hover highlights and scrollbar move together; oversized sections keep their heading on the same page. The README describes the controls.

- `npm run typecheck`: passed.
- `npm test -- tests/ui/shell tests/runtime tests/ui/assistant tests/ui/orb`: 398 tests passed across 25 files, including six scrolling tests and the heading-pagination regression.
- `npm run build`: passed with the existing MathJax chunk-size warning.
- `git diff --check`: passed.

These are automated checks of this update; no new headset session or live API call was performed. The complete-suite results below describe the initial release checks.

## Automated verification

| Check | Result |
|---|---|
| Fresh `npm ci`, separate empty npm cache | Passed; the guarded manim-web patch applied |
| `npm run patch:check` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed; the MathJax chunk-size warning remains |
| `npm test` | 1,378 passed, 1 failed, 1 skipped across 83 files |
| Browser audio-format conversion | All 4 tests passed: WebM/Opus, Ogg/Opus, MP4/AAC and WAV through real ffmpeg to a mocked Meta endpoint |
| Speech request handling | Tests cover configuration, credentials, cancellation, error propagation, response validation and transcript provenance |
| Local Markdown links | Checked in the release copy |
| Credential scan | No real credentials identified; test fixtures use synthetic values |

Audio-format tests use deterministic generated tones and a mocked Meta endpoint. They verify conversion and request handling, not recognition accuracy. Speech and assistant tests use explicitly synthetic fixtures unless live testing is enabled.

## Audio-test limitation

`tests/voice/metaPipeline.e2e.test.ts` fails in this environment: macOS `say` produces silent audio, so the route returns `no_speech` before reaching the mocked endpoint. The cause of the silent fixture has not been established. The test remains enabled. This result does not measure live Meta service behavior.

## Scope

These checks do not establish new live API or headset verification. Earlier live and headset results described in development notes are historical builder evidence. Each user's account must have access to the configured Meta models.

The npm install warns that the transitive `commander@15` tooling package requests Node 22.12 or newer. Installation, typecheck and build completed on Node 20.19.5. Verification did not include a clean-operating-system installation, dependency security audit or full headset readiness certification.
