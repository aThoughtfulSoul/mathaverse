# Muse service track: POST /api/assistant

Owner: Muse track (`server/muse/**`, `tests/muse/**`, this file). Contract: `docs/INTERFACES.md`,
WORKSPACE-AND-AI W3–W8. Written 2026-10-28; updated 2026-10-29 for W5 and the operation-order
comparison.

## Status

| Item | State |
|---|---|
| Route, validation, envelope, failure handling | Implemented; tested with a mocked `fetch` (synthetic replies) and synthetic fixtures |
| W5 server-resolved evidence | Implemented (`server/lean/evidence.ts`, used by the live path before the model input); boundary tests in `tests/lean/evidence.test.ts`, route tests in `tests/muse/evidence.test.ts` |
| Operation-order requests (both demonstrations) | Prompt, schema (`play_comparison`, `branch_comparison`, `sample_outline`), server-computed prepared templates and synthetic fixtures; `tests/muse/order.test.ts` |
| Meta Responses adapter | **Live-verified 2026-11-01** with `muse-spark-1.3`: authentication, the strict schema (no 400 on any request), the output shape and the invalid-key path (see "Live results") |
| Live smoke test | 45 requests over every experiment and every section 7 suggestion (`tests/muse/live.test.ts`, `tests/muse/liveCases/`), plus an invalid-key check. **45 of 45 live on 2026-11-01** (second run). Rehearsed in every normal test run against a mocked provider; real calls only through `scripts/muse-live.sh` |
| Synthetic mode | Implemented; the default when no key is configured |
| Live latency, output quality, schema acceptance by the real API | Measured 2026-11-01: provider time median 2.1 s, 90th percentile 2.9 s, max 4.5 s; every explanation reviewed against the exact facts (42 of 45 fully accurate, 3 minor squared-length wordings) |

Live calls were first made on 2026-11-01 (see "Live results"). Every provider reply in `tests/muse` itself is synthetic. A
synthetic response is labelled `source: "synthetic"` and `model: "synthetic:<fixture-name>"`. It is never
presented as Muse output. `source: "meta"` is set only after a real provider response validated; every
provider failure is an error with no proposal and no `source`, never a synthetic fallback (tested).

## Files

| File | Purpose |
|---|---|
| `server/muse/index.ts` | `assistantRoute`, `museCapabilities` (the INTERFACES.md exports), `createAssistantRoute(deps)` for tests, `capabilitiesFor(env, status)` |
| `server/muse/config.ts` | Environment configuration and per-process provider status |
| `server/muse/provider.ts` | Responses request body, `fetch` call, bounded body read, status mapping, output extraction |
| `server/muse/schema.ts` | Strict structured-output schema built from the action types |
| `server/muse/prompt.ts` | Developer instructions, context block and the single repair turn |
| `server/muse/validate.ts` | Closed request validation; proposal validation (`parseProposal`, then `planTransaction`) |
| `server/muse/synthetic.ts` | Labelled fixtures |
| `server/muse/order.ts` | Server-computed, validated templates for the operation-order requests (shared by the prompt and the fixtures) |
| `server/muse/sampleRequest.ts` | Prints a sample request body for the demo document (or, with `order`, the comparison document) |
| `tests/muse/*.test.ts` | Schema, adapter (mocked fetch), end-to-end route, order-request and W5 evidence tests |
| `tests/muse/live.test.ts` | The live smoke test (real calls; skipped unless `MUSE_LIVE=1` and a key are set) |

## Environment variables (server side only)

| Name | Default | Meaning |
|---|---|---|
| `META_API_KEY` | none | Meta Model API key. `MODEL_API_KEY` (the name in Meta's examples) is accepted as a fallback. With no key, the route runs in synthetic mode. |
| `META_MODEL` | `muse-spark-1.3` | Model identifier sent to the API and reported in the envelope and capabilities. |
| `META_ENDPOINT` | `https://api.meta.ai/v1/responses` | Must be `https:` with no embedded credentials. |
| `META_REASONING_EFFORT` | `low` | One of `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. The Responses page lists `minimal` to `xhigh`; the Models page adds `max` for `muse-spark-1.3` but not for its `-contributor` variant. `none` returns HTTP 400 on Muse Spark. |
| `MUSE_MODE` | `auto` | `synthetic` forces labelled fixtures even when a key is present (for demos). Any other value makes the assistant `unavailable`. |

Vite does not put `.env` values into `process.env` for server code. The submission start is
`zsh scripts/muse-live.sh serve`:
- it reads the key at a hidden prompt;
- it sets `MUSE_MODE=auto` and `SPEECH_PROVIDER=meta`, so Talk/Record uses Meta speech-to-text
  (`muse-voice-transcribe-1.0`; [VOICE.md](VOICE.md));
- it starts `npm run dev` on port 3010.

Otherwise export the variables in the shell that starts `npm run dev` / `npm run preview`, never on a
command line or in a project file. The key needs access to both `muse-spark-1.3` and
`muse-voice-transcribe-1.0`; a judge supplies their own ([LOCAL-SUBMISSION.md](LOCAL-SUBMISSION.md)). The
dev server also listens on the local network (`host: true`), so with a key loaded use a trusted network or
the loopback-only start in LOCAL-SUBMISSION.md. The key is read on each request and is used only
in the `Authorization: Bearer` header. It is never logged, returned, put in a URL or request body, or
written to disk. A malformed configuration makes `mode: "unavailable"` and a 503
`assistant_misconfigured` whose message names the variable, never its value.

## Capabilities (`GET /api/capabilities` → `assistant`)

- `configured`: a key is present and the model and endpoint are valid.
- `authenticated`: a real provider call returned 2xx in this process with the current configuration. A
  later 401/403 clears it.
- `liveValidated`: a real call produced a proposal that passed `parseProposal` and `planTransaction` in
  this process with the current configuration.
- `model`: the configured model, or `null` when not configured.
- `mode`: `meta`, `synthetic` or `unavailable`.

Without a key, all three statuses are `false`, `model` is `null` and `mode` is `synthetic`. Status
earned with one key, model or endpoint is not reported for another; a one-way SHA-256 fingerprint is
kept in memory. Only the default route, which uses the real `fetch` and `process.env`, writes the
process status. Tests use their own status objects.

## Request lifecycle

1. Reject non-POST requests (405) and a configuration that is `unavailable` (503).
2. Validate the request envelope: closed fields `requestId`, `workspaceId`, `baseRevision`, `prompt`
   and `context`. A client `contextHash` is rejected as an unknown field.
   - The body must be at most 256 KiB (413).
   - The prompt must be non-empty and at most 2,000 characters.
   - IDs must match the document ID pattern, and `baseRevision` must be a non-negative integer.
   - `context` has the closed fields `contextVersion: 1`, `document` and `evidence`: at most 8 W5
     references `{claim, claimHash, receiptId}`, each validated closed by `parseEvidenceRefs`
     (`claim` is a typed `ClaimRequest` locator; the hash and receipt ID are lookup keys only).
3. Rebuild the document with `docFromJson` and compute `computeFacts`. An invalid document returns 400
   `invalid_document`. The request's `workspaceId` and `baseRevision` must equal the document's,
   otherwise 400 `context_mismatch`.
4. Recompute `contextHash = assistantContextHash({contextVersion: 1, document: docToJson(doc), evidence})`
   from the validated, normalized document. For a client that sends `docToJson` of its committed
   document, this equals the client's own hash (tested).
5. Choose the answer path:
   - **Synthetic:** match a fixture, build its proposal on the document, then run the validation in
     step 7.
   - **Live:** first resolve every evidence reference on the server (W5, below), then send one Responses
     request with strict structured output, under a combined signal: the request's `AbortSignal` plus a
     40 s provider deadline inside the 45 s application timeout.
6. For a live answer, extract the text from `output[]` items of type `message`, in their `output_text`
   parts. A Markdown code fence is tolerated; anything else must be bare JSON.
7. Validate the proposal with `parseProposal`, then `planTransaction` on the rebuilt document.
8. If the output is invalid (not JSON, structurally invalid, incomplete, or fails `planTransaction`),
   make **one** repair attempt inside the same deadline. It runs only if at least 5 s remain. It replays
   the rejected output (if at most 16 KiB) and the validator's reason. No third attempt is made.
9. Before answering, recheck cancellation. A request aborted at any point returns no proposal.
10. Return the `AssistantResponse`: `requestId`, `source`, `model`, `baseRevision` (the document
    revision), `contextHash` (recomputed), `timing.providerMs` (the sum over attempts; `null` for
    synthetic) and `timing.totalMs`. A proposal is present only after it validated.

The route never mutates state. The client compares request ID, base revision and context hash, and
commits through `Workspace.commit`.

## Errors (`{ code, message, retryable }`)

| HTTP | code | retryable | When |
|---|---|---|---|
| 400 | `invalid_request`, `prompt_too_long` | no | Envelope or field invalid |
| 400 | `invalid_document` | no | `docFromJson` or fact computation failed |
| 400 | `context_mismatch` | no | Workspace ID or base revision differs from the document |
| 405 | `method_not_allowed` | no | Not POST |
| 413 | `request_too_large` | no | Body above 256 KiB |
| 422 | `synthetic_no_fixture` | no | Synthetic mode, unrecognised prompt (the message lists the prepared prompts) |
| 422 | `proposal_rejected` | live: yes; synthetic: no | The proposal fails `planTransaction` (after the repair, for live) |
| 422 | `model_refused` | no | The provider returned a `refusal` content part |
| 429 | `provider_rate_limited` | yes | Provider 429; the message includes `Retry-After` seconds when present |
| 499 | `cancelled` | no | The client disconnected; no response is used |
| 502 | `invalid_output` | yes | Not JSON or schema-invalid after the repair attempt |
| 502 | `provider_unavailable` | yes | Provider 5xx (except 504) |
| 502 | `provider_network` | yes | `fetch` failed, or the body could not be read |
| 502 | `provider_malformed`, `provider_failed` | yes | The provider body is not JSON or has an unexpected shape, or `status: "failed"` |
| 502 | `provider_rejected`, `provider_not_found`, `provider_response_too_large` | no | Provider 400/413/other 4xx, 404, or a body above 512 KiB |
| 503 | `provider_auth`, `provider_billing` | no | Provider 401/403 or 402 |
| 503 | `assistant_misconfigured` | no | Invalid environment configuration |
| 504 | `provider_gateway_timeout` | no | Meta returned 504 `gateway_timeout` (or 408). Nothing changed; the panel offers Edit for a smaller or simpler request, not Retry of the same text (Meta's error guide: do not simply retry) |
| 504 | `provider_timeout` | yes | This application's 40 s provider deadline passed |
| 504 | `timeout` | yes | The mount's 45 s application timeout aborted the request |
| 500 | `synthetic_fixture_invalid` | no | A fixture is structurally invalid (a bug in this track) |

Provider error bodies are discarded unread. Messages are fixed text plus the application validators'
own reasons, which are clipped to 300 characters.

## W5: server-resolved evidence

The live path resolves the request's evidence references before it builds the model input
(`defaultResolveEvidence` loads `server/lean/index.ts` lazily and calls its `resolveEvidence(doc, refs)`
over the session receipt registry; `docs/LEAN.md` "W5" has the steps). The model sees, per reference:
`status` (`verified` or `unavailable`), `reason`, a fixed `note`, the locator, the claim in current names,
the exact evaluation now (`computed`, "computed exactly", not Lean) and, **only when verified**, the
canonical Lean statement, the recomputed claim hash and the audited provenance (receipt ID, issue time,
template version, toolchain, theorem, axioms). Unavailable reasons: `unresolved_reference`,
`historical`, `hash_mismatch`, `no_receipt`, `provenance_rejected`, `checker_unavailable`.

- If the proof module cannot be loaded or the resolver throws, every reference is `unavailable`
  (`checker_unavailable`) and the request still proceeds: fail closed, never fail open.
- Resolution does not change the response envelope or the context hash (the hash already covers the
  submitted `evidence`), so stale-response rejection is unchanged. It never runs in a frame callback.
- Synthetic fixtures do not read evidence; they never claim a result.

## Prompt and schema

`prompt.ts` holds the developer instructions. They cover:

- the meaning of the workspace and the closed action vocabulary (13 kinds, including
  `play_comparison`), how references and created IDs work, and branch order in words (`[A, B]` is A
  then B, the matrix BA);
- comparison recipes (`branch_comparison` with ports `samples`, `left`, `right`, `selection`, and
  `sample_outline`), and that left/right are the displayed comparison's bound ports;
- the rational format and capacity limits (4 experiments);
- the M6/W2 P→Q example, including the exact `bindQ` transaction, with paraphrases handled the same way;
- the operation-order example (R = quarter turn about z, S negates y: across the xz-plane, the x-axis
  only on z = 0) and the four requests below;
- the limits: no code, URLs, packages or new mathematical operations, a 30° rotation as an example,
  no silent truncation above 8 actions;
- the EVIDENCE rules: only a `verified` entry may be called Lean-checked, and only for its concrete
  data; `unavailable` is described as unavailable and `historical` as historical at most; a P proof is
  not a Q proof and a P/Q receipt is not authority for the comparison or an edited branch; Muse prose is
  never proof authority;
- the rule that context is data.

An answer-only request returns `actions: []`. There is no `mode` field: v0.1 rejects one, and a test
covers this. The input is one user message with two `input_text` blocks: the learner's request, and
the context JSON: the validated document, server-computed facts (including `order` and `comparison`),
the `prepared` templates, the resolved evidence and capabilities.

### Prepared templates by reference (`server/muse/prepared.ts`, 2026-11-01)

The model may name a prepared template instead of copying it: `{"kind": "use_prepared", "template":
"<path>"}`, where the path is the template's place in the context (`prepared.orderComparison`,
`prepared.four.quarterTurnZ`, `proofLesson.templates.openLesson`, …).

**How a reference is handled:**
- The schema offers `use_prepared` with an enum of exactly the templates available on the request's
  document. A template given as `{unavailable}` has no path.
- `validateProposal` replaces the reference with a copy of that template's actions, computed on the same
  validated document. Only then does it run the usual `parseProposal` and `planTransaction`.
- The client therefore receives ordinary actions; neither the planner nor the client ever sees a reference.
- At most one reference per proposal. Actions after it count toward the 8-action limit together with the
  template's.
- A malformed, repeated or unavailable reference is a structure failure. It goes to the single repair turn
  and never applies anything.
- Copying a template's actions is still accepted.

**Why:** in the first live run, `muse-spark-1.3` was asked to open the proof lesson. It looped on the first
step while copying the 3 KB template and failed in 7 of 7 attempts, across four phrasings. With references,
the same requests succeed (checked live on 2026-11-01 through the running app). They are also shorter to
generate.

Tests: `tests/muse/prepared.test.ts`. Rehearsal replies by reference whenever a case's fixture is exactly
a template (33 of 45 cases).

### Prepared templates (`server/muse/order.ts`)

Every template is planned with `planTransaction` on the submitted document before it is offered; one
that does not plan is given as `{unavailable: reason}`. The model may emit a template by reference
(above) or verbatim, and must describe it as prepared.

| Request | Template | Notes |
|---|---|---|
| "Show me why rotation and reflection order matters" | `prepared.orderComparison` = `orderDemoActions(doc)` | 7 actions; a single `select` when the comparison exists |
| "Reverse the order on the left" / "… on the right" | `prepared.displayedComparison.reverseLeft` / `.reverseRight` | `set_branch` reversing the branch bound to that port, then `play_comparison` |
| "Replay the comparison" | `prepared.replayComparison` | `play_comparison` (1.6 s per step) on the displayed comparison; `select` first when another experiment is shown |
| "Check that these two maps differ" | `prepared.displayedComparison.checkDifference` | `map_difference_witness` on the bound left/right branches at the first differing basis index (exact); `null` when the routes are equal, with `checkEquality` offered instead |

`displayedComparison` also carries `left`/`right` (`port`, `branchId`, chronological `order`, `symbol`),
`mapsEqual` and `firstDifferingBasisIndex`, all exact. It is `null` when the displayed experiment is
not a comparison, and then left/right requests are answered with `actions: []`.

`schema.ts` builds the strict schema from the action types. It has a plain object root and one closed
`anyOf` variant per W4 action kind. Every object is closed with every property required. Tests assert
that the variants match `ACTION_KINDS`, `OPERATION_KINDS` and `CLAIM_KINDS`. The schema uses only
`type`, `properties`, `required`, `additionalProperties`, `items`, `anyOf`, `enum` and `description`.
The strict subset documents no other keywords, so none are used. Where strict mode cannot express the
types exactly, the server validators stay authoritative:

- **Bounds stated only in descriptions:** title ≤ 80, explanation ≤ 700, ≤ 8 actions, the rational
  string format and coprimality, matrix shape and the authored range, the `play` duration range
  0.2–5 s, the `play_comparison` step range 0.5–5 s and 2–8 distinct `sample_outline` vertices.
- **`bind_recipe.bindings`** is an open record in the type. The schema has one closed object per
  distinct port set of the document's recipes, plus the W2 ports and the comparison ports (so the
  prepared template can bind the comparison recipe it saves). A recipe saved with other new port names
  cannot be bound in the same proposal.
- **`save_recipe.recipe.inputs`** is an open record in the type. The schema restricts it to the W2
  port names (`samples`, `map`, optionally `selection`) or the comparison port names (`samples`,
  `left`, `right`, optionally `selection`). The linked-view operations reference `map`;
  `branch_comparison` references `left` and `right`.
- **Preset definitions** are flattened from `{preset: anyOf[...]}` into the outer `anyOf`. This accepts
  the same instances with less nesting.
- **Nesting depth:** object/array nesting is at most 9 (tested against the documented limit of 10).
  If every `anyOf` wrapper also counts as a level, the deepest path is 11. That path is
  `create_samples.source.samples[].coords[].n`. Meta does not document how depth is counted, so check
  this on the first live call.

## Synthetic mode

Synthetic mode is used when no key is configured, when `MUSE_MODE=synthetic`, or in tests. Prompts
are normalized (lowercase, collapsed spaces, no trailing punctuation) and matched against the fixture
table. Fixture output goes through the same `parseProposal` and `planTransaction` path as live
output. Explanations are composed from exact facts of the planned document, so they stay true for any
document.

| Fixture (`model`) | Example prompt | Actions |
|---|---|---|
| `synthetic:what-gets-lost` | Show me what this transformation loses | `select` u on the displayed experiment |
| `synthetic:use-on-q` | Use this representation on Q | `create_map` Q = diag(0,1,1), `create_experiment`, `bind_recipe` with the selection port set to u (exactly `bindQ` in `tests/workspace.test.ts`) |
| `synthetic:check-same-image` | Check that u and v have the same image | `request_check` `same_image_witness` on the displayed experiment's bound branch |
| `synthetic:answer-map` | What does this map do | `[]` (exact facts only) |
| `synthetic:order-demo` | Show me why rotation and reflection order matters (also "Why does order matter?", "Does the order of the operations matter", …) | `prepared.orderComparison`, described as prepared |
| `synthetic:reverse-left` / `synthetic:reverse-right` | Reverse the order on the left / right (also "Swap the order on the left", "reverse the left route", …) | the reverse template for that bound port; `[]` with no displayed comparison |
| `synthetic:replay-comparison` | Replay the comparison (also "Play the comparison again", "replay both routes") | the replay template; `[]` when there is no comparison |
| `synthetic:check-maps-differ` | Check that these two maps differ (also "Verify that the two routes are different", …) | the difference check; `[]` with a truthful "the two maps are equal" when they are |
| `synthetic:check-maps-equal` | Check that these two maps are equal | `map_equality` on the displayed routes; `[]` with the exact witness when they differ |
| `synthetic:unsupported-rotation` | Rotate by 30 degrees | `[]` (explains quarter turns) |
| `synthetic:unsupported-code` | Run this Python | `[]` (explains that code cannot run) |

While the comparison is displayed, the three P-to-Q fixtures answer with `actions: []` and say to
switch demonstrations, instead of guessing u, v or a single map.

Any other prompt returns 422 `synthetic_no_fixture`: "Synthetic mode has no fixture for this prompt…"

### Calling the route

```sh
npx vite-node server/muse/sampleRequest.ts "Use this representation on Q" > req.json
npx vite-node server/muse/sampleRequest.ts "Reverse the order on the left" order > req.json   # comparison document
curl -s -X POST http://localhost:3010/api/assistant -H 'content-type: application/json' --data @req.json
```

The body shape, with the document abbreviated:

```json
{
  "requestId": "req-1",
  "workspaceId": "ws-demo",
  "baseRevision": 0,
  "prompt": "Use this representation on Q",
  "context": { "contextVersion": 1, "document": { "schemaVersion": 1, "workspaceId": "ws-demo", "revision": 0, "...": "docToJson(demoDocument())" }, "evidence": [] }
}
```

Without a key, the answer is `200` with `source: "synthetic"` and `model: "synthetic:use-on-q"`. This
was checked against the running dev server on port 3010 on 2026-10-28, still without a key.

## Provider facts (from documentation; the live runs of 2026-11-01 confirmed the endpoint, authentication, strict `json_schema` acceptance and the `output[]` message shape)

Source pages were retrieved on 2026-10-28 as Markdown (`<url>.md`):

- [Responses](https://dev.meta.ai/docs/protocols/responses)
- [Create response](https://dev.meta.ai/docs/api-reference/responses/create-response)
- [Responses schemas](https://dev.meta.ai/docs/api-reference/responses/schemas)
- [Structured output](https://dev.meta.ai/docs/structured-output)
- [Tool calling](https://dev.meta.ai/docs/tool-calling)
- [Models](https://dev.meta.ai/docs/models)
- [Error handling](https://dev.meta.ai/docs/error-handling)
- [Pricing and rate limits](https://dev.meta.ai/docs/pricing-rate-limits)

Every item below is from documentation and has not been verified against a live call:

- **Endpoint and authentication:** `POST https://api.meta.ai/v1/responses` with
  `Authorization: Bearer <key>`. The keys in the examples have the format `LLM_{id}_{secret}`.
  (Responses; Error handling, 401.)
- **Request fields used:**
  - `model`, `instructions` (developer-level, per request) and `input` (messages `{role, content: [...]}`
    with `input_text`; replayed assistant turns use `output_text`);
  - `text.format = {type: "json_schema", name, schema, strict}`, where `name` is `[A-Za-z0-9_-]`, at
    most 64 characters;
  - `store` (default `true`; this adapter sends `false`);
  - `max_output_tokens` (minimum 16; counts reasoning tokens; above the model maximum returns 400);
  - `reasoning.effort`.

  (Create Response schema; Responses.)
- **Structured output on Responses** is `text.format`, not `response_format`; a Chat Completions
  parameter "does not configure structured output". `strict` defaults to `false`. Output is always
  schema-constrained; `strict: true` also validates the schema against the strict subset.
  (Structured output.)
- **Strict subset and limits:**
  - plain object root (no top-level `anyOf`/`oneOf`/`allOf`/`enum`/`not`);
  - `oneOf`/`allOf` unsupported anywhere, `anyOf` allowed below the root;
  - every object `additionalProperties: false`, and `required` lists every property;
  - recursive schemas rejected;
  - limits: depth 10, 5,000 properties, 120,000 characters, 1,000 enum values, 200,000 expanded nodes.

  (Structured output.)
- **Response:**
  - `status` is one of `completed`, `failed`, `in_progress`, `cancelled`, `queued` or `incomplete`;
  - `incomplete_details` explains an incomplete response;
  - `output[]` includes items of type `message` (role `assistant`) whose `content[]` has `output_text`
    `{text}` or `refusal` `{refusal}` parts;
  - top-level `output_text` is an SDK-only helper, not part of the raw JSON;
  - the Response echoes `instructions` and `text`. That is why the provider body limit here is 512 KiB.

  (Responses schemas.)
- **Errors** have the body `{error: {message, type, param, code}}`:
  - 400 `invalid_request_error`;
  - 401 `authentication_error`, code `invalid_api_key`;
  - 402 billing; 403 permission;
  - 404 not found (`model_not_found`; an unknown path has an empty body);
  - 413 `payload_too_large`;
  - 429 `rate_limit_error` with a `Retry-After` header;
  - 500 (safe to retry);
  - 503 `server_shutting_down`/`service_overloaded`/`backend_unavailable` with `Retry-After`;
  - 504 `gateway_timeout` (non-streaming time limit; "do not simply retry").

  (Error handling.)
- **Rate limits** are per team, not per key. `muse-spark-1.3` has 3,000 RPM and 4,000,000 TPM;
  `-contributor` variants have 150 RPM. Successful responses carry `x-ratelimit-*` headers. On 429,
  use backoff with jitter and wait at least `Retry-After`. (Pricing and rate limits.) This adapter does
  not retry automatically; it reports `retryable` and leaves retries to the learner.
- **Tool calling:** only `tool_choice: "auto"` is supported. This adapter uses no tools. (Tool calling.)
- **Models:** `muse-spark-1.3` is "Recommended for new work". It supports structured output, tool
  calling, Responses and every reasoning effort level including `max`; `-contributor` does not support
  `max`. (Models.)
- **Refusals** in structured output are not described on the structured-output page. The `refusal`
  part type comes from the schema reference.

**Still to verify live:**

- the key works for `muse-spark-1.3`;
- the strict schema is accepted (no 400), including the depth question above;
- reasoning `low` with `max_output_tokens: 8000` fits typical proposals;
- the latency of a real request against the 40 s deadline;
- the real output shape (`output_text` location, presence of reasoning items);
- the 401, 429 and timeout paths against the real service;
- proposal quality on the fixture prompts.

## Live results (2026-11-01, `muse-spark-1.3`, reasoning effort `low`)

Records: `docs/evidence/muse-live/<run>/live.json` (every request, answer and validated action) and
`accuracy-review.json` (an independent check of every explanation against the exact facts, each claimed error
verified by a second reviewer).

| Run | Result | Provider time (median / p90 / max) | Notes |
|---|---|---|---|
| `2026-11-01-1354` (first) | 44 of 45 cases; invalid key correct | 2.5 s / 3.7 s / 8.3 s | Opening the proof lesson failed (below). Explanations: no mathematical errors; 4 wording slips |
| `2026-11-01-1612-again` | 0 of 3 (open lesson only) | | Captured the model's output: placeholder proposals of the template's first step repeated 4–8 times |
| `2026-11-01-1655` (after the fix) | **45 of 45**; invalid key correct | 2.1 s / 2.9 s / 4.5 s | 36 of 45 answers used `use_prepared`; no review flags; the 4 earlier slips gone; 3 minor squared-length wordings in the proof lesson |

**What was found and fixed:**
- **Opening the proof lesson** (7 of 7 attempts, four phrasings) failed with "local recipe name walk used twice".
  The model looped on the first step while copying the 3 KB template. The schema did allow the template, and
  "Why must the arrows return home?" (the same steps plus one) worked from the same document. Fix: prepared
  templates by reference (above); both phrasings then succeeded live.
- **Braid positions:** the prompt and schema now state that `at` and `crossing:<k>` count from 0 while the panel
  counts from 1. Every braid rewrite case passed on both runs.
- **Wording:** four slips in the first run (a pre-answer state called "displayed"; braid equality "is checked"
  before any rewrite; the lemma credited to "the lesson authors"; a "Check fails" title with no check) led to
  four instruction lines. None recurred.

**Open:**
- The second run has 3 proof-lesson explanations that mix up a squared length and a length. One compares
  |W₉|² = 147/25 with R = 3 instead of R² = 9; two give the length's decimal for a squared value. The
  conclusions are right.
  - The facts already separate the two ("|U_6|² = 588/25 (|U_6| ≈4.850)"), so an instruction line was added:
    compare squared with squared and length with bound, and a decimal belongs to a length.
  - A live spot check of the three affected questions, 3 times each (9 requests through the running app),
    gave 8 clean answers ("|W_9|² = 147/25 <= 9, about 2.425 in length") and 1 borderline phrase ("whose
    length squared is 588/25, about 4.850").
  - Accepted as a known minor wording risk. Explanations are never proof authority, and every number the
    panel and the mathematics view show comes from the application.
- Live answers name arrows by ID (`v0 v2 v4`), as the context does, while the scene shows a₁ … −c₂. This is
  decision 5 in `docs/ARCHITECT-PROMPT-UPDATE-2026-10-31.md`.
- Observed: the model returns JSON keys in alphabetical order (`actions` first).

## Live smoke test (prepared 2026-11-01)

**Run it** from a terminal.
- The key is typed at a hidden prompt. It lives only in that script's environment, is never echoed, written
  or logged, and is unset on exit.
- The script sets `SPEECH_PROVIDER=meta` on every path. Meta transcribes the recorded question.
  A speech failure is displayed with its error status.

```sh
zsh scripts/muse-live.sh rehearse   # no key: every case against the mocked provider (also part of npm test)
zsh scripts/muse-live.sh test       # one preflight call, then all cases; offers to start the app afterwards
zsh scripts/muse-live.sh serve      # the app on port 3010 with live Muse and Meta speech-to-text
zsh scripts/muse-live.sh speech     # one real Meta speech-to-text call on a synthesized (macOS `say`) clip
```

`speech` sends a test-uploaded recording through the app's own `/api/transcribe` route code, not a browser
microphone. Its record goes to `docs/evidence/speech-live/<time>/stt.json`. The header of
`scripts/muse-live.sh` is authoritative. The `meta` setting and `speech` were added in this milestone and
had not been run when this section was written.

`test` stops after the preflight if the first real request fails (a wrong key, a schema rejection). The
full run writes `docs/evidence/muse-live/<date-time>/live.json` and the log `.local/muse-live-last.log`.
About 47 real requests: the preflight, 45 cases and the invalid-key check (a repair turn can add one per
case). `META_MODEL` and `META_REASONING_EFFORT` (default `low`) can be exported before the script runs.

**How a case works** (`tests/muse/liveKit.ts`). Each case (`tests/muse/liveCases/*.ts`) is a request, the
document it is made on, and a check of the answer's MEANING: the proposal is validated, committed through
`Workspace.commit` as the client does, checked, then undone (Undo must restore the content). A live model
may reach the same result with different valid actions (an extra select, a replay, a stage change), so no
check compares exact actions or wording. Wording is never a pass/fail condition: negation-aware guards
FLAG explanations that may call equal braids different, overclaim a check, answer "yes" to "does this
prove the whole theorem", report a vacuous success or substitute a point, and the flags are recorded for a
person to read (two independent reviews showed pattern matching cannot judge prose reliably).

**Rehearsal** runs the same cases on the live path with a mocked provider whose reply is the case's
synthetic fixture (a known-correct answer), and confirms each check rejects a valid but wrong answer (the
case's negative control). It needs no key and runs in every normal test run (`MUSE_REHEARSAL=0` skips it).
Rehearsal records are marked `mode: "rehearsal"` and are never written as evidence.

**Records.** Each request logs one `[muse-live]` JSON line: mode, case, prompt, HTTP status, `source`,
actual `model`, `timing.providerMs`/`totalMs`, wall time, the answer's title and explanation, the validated
actions, the planner's summary and effects, any error, and the review flags. When a request fails, the
record also keeps the model's output text from each attempt (`modelOutputs`: the JSON it proposed, so a
rejection can be diagnosed). No key, header or other provider body is recorded. `zsh scripts/muse-live.sh
again '<case name part>' [n]` reruns one case n times (default 3) with these records.

**Coverage** (45 cases; each name in the files states the expected meaning):
- P → Q and the order comparison (11): the original checklist (what P loses, Use on Q, the Q paraphrase
  with no fixture, the order comparison, reverse left, replay, the difference check) plus the section 7
  suggestions Use on P, Explain the selected fiber, Reverse the left branch and Explain why the results
  differ.
- Sculpture, cube and quotient (14): Apply +1 again, Apply +2, Apply (1,0) again on V₄, Use on V₄, Use on
  C₄, Explain this cycle; Rotate the cube 90 degrees about z, Explain the diagonals, Swap objects 0 and 1;
  Group rotations by their action on the unoriented axes, Compose these two, Why six classes, Expand this
  class, Choose another representative.
- Braids (4): the other side of the relation, the relation at a named span, cancelling a named inverse
  pair, Explain this comparison. Crossing positions in actions count from 0 while the panel counts from 1
  (`server/muse/prompt.ts` and the schema state this); check it first if a rewrite case fails.
- The proof lesson (16): opening the lesson, Why is this point inside the bound (nothing selected, W₉),
  the other half (nothing selected, W₃), Why must the arrows return home, Flip this sign, Check this example
  (closed walk with W₉; the open walk, where no check may be requested), Why does the bound fail here,
  Restore the closed walk, Does this prove the whole theorem, Make all signs positive, the sign trick,
  Rearrange the same arrows, and Why returning home does not keep it close.
- An invalid key: an error whose code starts with `provider_`, with no `proposal` and no `source`.
- After the first answer, `museCapabilities()` must report `configured`, `authenticated` and
  `liveValidated`.

**After the run:** read every recorded explanation (flagged or not) for mathematical accuracy; record any
400 schema rejection and the depth question above; then, in the app (`serve`), confirm
`GET /api/capabilities` reports `configured: true` and `mode: "meta"`, that the panel shows answers as live
Meta output with Undo, and that a few suggestions work by click. Update the Status table with the date,
model and latencies.

**Documentation re-check (2026-11-01).** All eight provider pages still say what the adapter assumes; no
code change was needed. Notes: the Responses page lists reasoning efforts `none`…`xhigh`, while the Models
and Reasoning pages add `max` for `muse-spark-1.3` (not its `-contributor` variant); a `refusal` output
part is not documented as an output content part (only refusal stream events are), so the adapter's
refusal handling is defensive; for 504 `gateway_timeout` the docs say not to simply retry (use streaming
or background requests, or reduce the work): since 2026-11-01 this adapter reports it as `provider_gateway_timeout`, not retryable, and the panel offers a smaller request instead; reasoning tokens count
against `max_output_tokens`, so a long reasoning pass can truncate the JSON (`invalid_output`); no page
says whether an `anyOf` wrapper counts toward the depth limit of 10.

## Requests to the coordinator (shared files; not changed by this track)

1. **Keep keys out of git (recommended).** `.gitignore` has no `.env` entry. If anyone stores a key
   in a dotenv file, it could be committed:

   ```diff
   --- a/.gitignore
   +++ b/.gitignore
    node_modules
    dist
    .local
   +.env
   +.env.*
   ```

2. **Abort reasons (optional robustness).** The route distinguishes the mount's application timeout
   from a client disconnect by the abort reason: a `TimeoutError` name, or "timeout" in the message.
   `vite.config.ts` uses `new Error('application timeout')` and `new Error('client disconnected')`.
   A shared constant would make this explicit:

   ```diff
   --- a/server/types.ts
   +++ b/server/types.ts
   @@
    export type RouteHandler = (req: ApiRequest) => Promise<ApiResult>
   +
   +/** Abort reasons used by the API mount (vite.config.ts) so handlers can report them truthfully. */
   +export const ABORT_REASON = { disconnect: 'client disconnected', timeout: 'application timeout' } as const
   ```

   ```diff
   --- a/vite.config.ts
   +++ b/vite.config.ts
   @@
   -    res.on('close', () => { if (!res.writableEnded) abort.abort(new Error('client disconnected')) })
   -    const timer = setTimeout(() => abort.abort(new Error('application timeout')), 45_000)
   +    res.on('close', () => { if (!res.writableEnded) abort.abort(new Error(ABORT_REASON.disconnect)) })
   +    const timer = setTimeout(() => abort.abort(new Error(ABORT_REASON.timeout)), 45_000)
   ```

   This needs `import { ABORT_REASON } from './server/types'` in `vite.config.ts`. The current
   behaviour already works without it.
3. **Evidence for the assistant: done (2026-10-29).** Implemented in the tracks' own files as
   `resolveEvidence(doc, refs)` in `server/lean/index.ts`; no shared-file change was needed.
4. **Client display.** Show `source: "synthetic"` responses with a visible "Synthetic example" label,
   as INTERFACES.md already requires. Treat HTTP 499 `cancelled` as "no response".
5. **Optional contract change: per-reference resolution in the response.** The client cannot see what
   Muse was told about each evidence reference. If wanted, add to `AssistantResponse`
   (`src/workspace/actions.ts`): `evidence: { index: number; claimHash: string; receiptId: string;
   status: 'verified' | 'unavailable'; reason: string | null }[]` (live only; `[]` for synthetic). Until
   approved the envelope is unchanged and the route does not send it.

## Proof lesson (2026-10-31)

Ask Meta Muse AI in the proof explorer (PROOF-EXPLORER-SPEC section 6): one reordering lemma,
`OAI.EuclideanSteinitzBergstrom.signedOrder_prefix_bound`, from OpenAI's released formalization of
*The Euclidean Steinitz–Bergström theorem* (commit `4eaee875`). The lesson is a prepared interactive
explanation; the proof belongs to its authors, the prepared signs and cases are application data, and
nothing here searches for a signing.

| File | Purpose |
|---|---|
| `src/workspace/context.ts` | Exact vector-walk facts in `computeFacts`: kinds `walk`, `walk_bounds`, `walk_order`, `walk_lemma`, `walk_endpoints`, `walk_selection` |
| `server/muse/walk.ts` | Curated lesson context (from `src/lessons/steinitz/source.ts` and `copy.ts`, not upstream text), the `proofLesson` block and the planned templates |
| `server/muse/walkSynthetic.ts` | The labelled synthetic fixtures below |
| `tests/muse/walk.test.ts`, `tests/muse/walkLive.test.ts` | Facts, fixtures, schema, route, staleness, suggestions; the live path with a mocked fetch |

**Facts.** For every vector-walk experiment: its arrows in source order with signs, the total and
whether the walk is closed; the whole-number bounds B, D and R = (B + D)/2 (always called bounds, never
distances) beside the exact squared actual peaks and where they occur (lengths marked ≈ when not exact);
the new order; whether the lemma applies (for an open walk, the first failing k with exact squared
values and the residual T); the representative endpoint of each branch (hero: W3 and W9). For the
selected item: `walk:reordered:k` gives its witness j, branch, identity (positive W_k = (U_j + S_j)/2;
negative W_k = T + (S_j − U_j)/2, with T dropped only for a closed walk), the vectors and the squared-norm
chain; source, signed and arrow selections have their own facts.

**Live input.** The context block gains `proofLesson`: with a walk displayed, `{displayed, experimentId,
case, lesson, templates}` (the curated context and every template, each planned on the request's
document or given as `{unavailable: reason}`); otherwise only provenance and the `openLesson` and
`counterexample` templates (about 4 KB; about 8 KB with the lesson displayed). `INSTRUCTIONS` has a
"THE PROOF LESSON" paragraph. `prepared` is unchanged.

Templates: `openLesson`, `showSourceWalk`, `showSigns`, `showReorder`, `whyThisPoint` (only with a
selected `walk:reordered:k`), `whyRepresentative`, `otherHalf`, `flipSelectedSign` (only with a selected
`walk:vector:<id>`), `allSignsPositive`, `restorePreparedSigns`, `counterexample`, `restoreClosedWalk`,
`explainFailure`, `checkExample` (only for a closed walk), `showSimplerExample`.

**Synthetic fixtures** (prepared examples, not Muse output; `model: "synthetic:<name>"`). Explanations
are composed from the exact derivation of the planned document and fit 700 characters by dropping
whole trailing sentences. The patterns tolerate spoken transcripts ("W3", "W 3", "w three", "the
arrows" / "these arrows", missing punctuation, a leading "okay," or "can you").

| Fixture (`model`) | Example prompt | Actions |
|---|---|---|
| `synthetic:proof-open` | Show me a step from an AI-produced proof | open the lesson (create and bind, or select) and show the Walk step; provenance in the explanation |
| `synthetic:proof-why-not-close` | Why does returning home not keep it close? | select the farthest source point (hero U6), Walk step |
| `synthetic:proof-sign-trick` | Show the sign trick | Signs step |
| `synthetic:proof-rearrange` | Rearrange the same arrows | Reorder step |
| `synthetic:proof-why-point` | Why is this point inside the bound? (also "Why is W3 inside the bound") | the persisted `walk:reordered:k`; with nothing selected, the representative endpoint (hero W3), said explicitly; with an arrow selected, a clarifying question and `[]`; a named "W k" is selected |
| `synthetic:proof-other-half` | Show the other half of the argument | the representative endpoint of the other branch (hero W9; line-six W5); `[]` and an honest answer with no − arrows |
| `synthetic:proof-flip-sign` | Flip this sign (also "Flip the sign of v4") | `set_walk_signs` on the selected or named arrow; `[]` with "Which arrow?" otherwise |
| `synthetic:proof-all-positive` | Make all signs positive | `set_walk_signs` (all +), Reorder step; states the actual new bound (hero: no improvement) |
| `synthetic:proof-restore-signs` | Restore the prepared signs | `set_walk_signs` back to the prepared signs (hero arrows only) |
| `synthetic:proof-return-home` | Why must the arrows return home? | `set_vector_walk` to the two-arrow counterexample, Assumptions step; "2 exceeds 1.5" |
| `synthetic:proof-restore` | Restore the closed walk | `set_vector_walk` to the hero, Reorder step (open walk only) |
| `synthetic:proof-why-fails` | Why does the bound fail here? | select the first failing endpoint (W2), Why step; `[]` on a closed walk |
| `synthetic:proof-check` | Check this example | `request_check` `walk_reorder_instance` on a closed walk; on an open walk `[]` with the missing hypothesis and the exact failure (never a check, never a vacuous success) |
| `synthetic:proof-whole-theorem` | Does this prove the whole theorem? | `[]`: one reordering lemma; the signing bound is outside the lesson; the minimality bridge |
| `synthetic:proof-simpler` | Show the simpler example | `set_vector_walk` to the collinear six-step case, Reorder step |

Requests that need the displayed lesson (why this point, other half, flip, all positive, restore, why
fails, check) answer `[]` with "open it first" on other demonstrations. A proposal planned for the hero
is refused on the counterexample by the planner, and the client keeps it as a stale suggestion when the
case changed during the request (tested with the real synthetic route).

**Limitations.** Live behaviour was verified on 2026-11-01 (16 proof-lesson cases in the live runs; see "Live results"); the 2026-11-01 notation and arrow-label instruction lines are covered by mocked tests and the voice-chain check only. A free-form question outside the table above has
no synthetic answer (422 `synthetic_no_fixture`). The fixtures explain the lemma's argument for the
current finite data; they do not explain the signing theorem, compute an optimal order, or report a
Lean result (only the checker's receipt can).
