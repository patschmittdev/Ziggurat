# Local Model Protocol and Setup

## Status and scope

This is the canonical model-facing refinement contract and local setup guide for
Phase 1. It separates what a model proposes from what the host can persist.

The pinned llama.cpp server downloads have verified checksums, and the binary's version,
planned flags, health, and model alias have been checked. A real pilot verified the
nested JSON Schema response format below, and an end-to-end pilot successfully captured
Bronze, called the actual model, materialized and live-staged Silver, and rendered review.
The first completed 90-attempt batch failed the staging threshold; a separate revised
batch completed with 90/90 staged. Human usability remains unmeasured and the full
acceptance gate remains pending. The
[measured workflow evaluation](model-workflow-evaluation.md) records results and the
revision caveat. Pilot probes are excluded from each batch's 90 attempts.

This work does not change stored Silver v2, version-2 indexes, or external authorization
receipt v1. Shipped MCP remains Gold-only and read-only, with three physically separate
Gold, review, and evidence indexes. There is no new retrieval, review, policy, signing,
or admission capability.

## Responsibility boundary

| Responsibility | Owner |
|---|---|
| Select and read Bronze evidence | Host, subject to privacy selection and reference bounds |
| Read an existing target page | Host, only when the operator supplies `--target` |
| Propose candidate content, an operation, source IDs and line ranges | Model |
| Derive exact quotes, source paths, body hashes, and quote hashes | Host |
| Derive candidate sources, confidence, and schema version | Host |
| Derive the existing target's base-content hash | Host |
| Validate canonical Silver against live files and stage it | Host, Silver only |
| Author a knowledge page and authorize Gold | External operator/reviewer workflow, never the model pathway |

The model receives bounded serialized reference data. It receives no file handles,
filesystem tools, fetch tools, or signing capability. A `target_path` is an identifier,
not permission to read or write a file. The advisory Ziggurat Curator agent has
separately declared read-only file tools; that agent configuration is not the loopback
API and does not grant those tools to the endpoint.

All source and target content is non-instructional reference data, including Gold.
`content_role: reference` and `instruction_authority: none` apply regardless of tier.
Neither a well-formed draft nor a valid stored citation proves semantic support,
truth, or reviewer attention.

## Model input and disclosure

`refine` constructs a bounded reference block from host-read, hash-verified Bronze:

| Bound | Value |
|---|---|
| Records | 12 |
| Canonical Bronze body bytes per source | 32 KiB |
| Combined canonical Bronze body bytes | 256 KiB |

These limits count UTF-8 bytes in canonical Bronze bodies. JSON encoding, metadata,
prompts, and optional target context add request bytes and are subject to the
separate 1 MiB request ceiling.

Records are supplied with host-assigned source IDs and explicit
`{line_number, text}` entries using 1-based Bronze body coordinates. The prompt
distinguishes these coordinates from candidate or existing-page line numbers.
Internal `reference.lines` snapshots remain exact string arrays for quote extraction;
this model-facing presentation does not change stored Silver v2 or live validation.
Oversize records are omitted, not truncated, and omissions are reported with reasons.
The source-ID mapping includes only records whose bytes were actually supplied.
A draft cannot cite an omitted source, an arbitrary Bronze path, a knowledge page as
Bronze evidence, or any file the model happens to name.

Without `--source`, the default model-access privacy filter applies. Fresh captures
with restricted sensitivity and unknown PII are excluded until their privacy state is
resolved. Repeating `--source` explicitly authorizes disclosure of those selected
Bronze records to the configured loopback endpoint, even if the default filter would
exclude them. Inspect selected records first. Explicit selection does not bypass
integrity checks, byte bounds, or live staging validation.

For an amendment or contradiction, use:

```bash
ziggurat refine --root <vault> --query "<request>" --source bronze/<path>.md --target knowledge/item.md
```

`--target` is required for `amend` and `contradict`. The host supplies existing-page
context and derives the base hash itself; the draft cannot choose or override that
hash. Target text is reference context, not additional citeable Bronze. No refinement
operation writes the target knowledge page.

## Strict model output: `RefinementDraft` v1

The model returns one JSON object conforming to `RefinementDraftSchema`. Unknown
fields are rejected at every object boundary. All listed fields are required; arrays
may be empty only where the schema permits them.

| Field | Contract |
|---|---|
| `schema_version` | Literal `1` |
| `operation` | `create`, `amend`, or `contradict` |
| `target_path` | Non-empty target identifier, subject to host path and operation validation |
| `candidate` | Exactly `title`, `type`, `retrieval_eligible`, `pii`, `sensitivity`, `visibility`, `egress`, `body` |
| `evidence` | Non-empty array of draft evidence entries |
| `contradictions` | Array of objects with `summary` and non-empty draft `evidence` |
| `confidence` | `high`, `medium`, or `low` |
| `affected_paths` | Array of non-empty path strings |
| `related_paths` | Array of non-empty path strings |
| `unresolved_questions` | Array of non-empty strings |

Every draft evidence entry contains exactly:

```json
{
  "source_id": "<host-supplied-id>",
  "line_start": 1,
  "line_end": 3
}
```

Line numbers are positive integers and ranges are inclusive. Host semantic checks
require valid supplied IDs and valid ranges within the supplied canonical text.

Candidate strings are non-empty, `retrieval_eligible` is boolean, and `pii` and
`sensitivity` use the shared contract enums. `egress` is `local-only` or
`approved-cloud`. Domain, path, cross-field, and evidence semantics remain host checks,
not guarantees of grammar-constrained generation.

The model does not return stored Silver v2. It supplies no quote text, citation path,
body hash, quote hash, base hash, candidate sources, candidate confidence, candidate
schema version, local audit metadata, or admission fields. In particular, candidate
status, reviewer identities, review timestamps, receipts, and authorization are not
part of this schema.

The source of truth is
[`src/contracts/refinement-draft.ts`](../src/contracts/refinement-draft.ts).
Its Zod-derived JSON Schema is sent to the model; the host also validates returned JSON
with the strict Zod schema. A constrained response is not trusted merely because the
server claims it followed the schema.

## Host materialization and staging

For a valid draft, the host:

1. Resolves every main and contradiction evidence entry through the supplied source-ID
   mapping and validates its inclusive line range.
2. Derives exact quote text and hashes from those supplied canonical bytes, using the
   host-verified Bronze path and body hash.
3. Constructs canonical candidate metadata, including sources, confidence, and schema
   version, and supplies the base-content hash from the host-read target when required.
4. Validates the complete stored Silver v2 proposal through the existing strict staging
   path against live Bronze and target state.
5. Atomically stages only the Silver proposal under `.ziggurat/proposals/`.

Unknown IDs, invalid ranges, invalid targets, malformed drafts, and stale source or
target state fail closed. Materialization does not relax the stored v2 contract.
The pathway cannot write Bronze, knowledge pages, reviewed metadata, trust anchors,
authorization receipts, or indexes.

## Supported llama.cpp request

Only non-streaming chat completions are supported:

```text
POST /v1/chat/completions
Content-Type: application/json
```

The shipped refine request contains the host-built messages and these generation
settings:

```javascript
{
  model: modelName, // adapters.model_name, default "ziggurat-refine"
  messages: hostBuiltMessages,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "ziggurat_refinement_draft",
      strict: true,
      schema: RefinementDraftJsonSchema
    }
  },
  max_tokens: 2048,
  temperature: 0,
  stream: false
}
```

The nested `response_format.json_schema` form is verified with b10809. The bare
`{type: "json_schema", schema: <schema>}` form described in upstream prose was silently
ignored in a real probe and produced an invalid draft. It is not supported by this
adapter contract; do not replace the nested form with it.
The [pinned b10809 parser](https://github.com/ggml-org/llama.cpp/blob/5266f24da75dc449bd56cbed7addb9c8e4a6a73e/tools/server/server-common.cpp#L1168-L1181)
confirms that `type: "json_schema"` reads the nested `json_schema.schema` field.

The corrected pilot returned a valid draft with 201 completion tokens in 2.65 seconds.
This is protocol-probe evidence, not a model-quality or acceptance result. Pilot probes
are excluded from the frozen 90-attempt evaluation.

An end-to-end pilot also completed `ingestCapture` -> actual llama.cpp response ->
`executeRefinement` materialization and live staging -> `runReview`. The staged
proposal contained the host-derived exact multiline quote and hash. This verifies
that the real workflow ran successfully for that pilot; it does not establish
human usability or a passed 90-attempt gate. This pilot is also excluded from the
frozen evaluation.

This contract is not a promise of support for every OpenAI-compatible server. The adapter
accepts one finished assistant text response from `choices[0].message.content`,
with exactly one choice, role `assistant`, and `finish_reason: "stop"`, then parses
that text as the strict draft. It does not accept tool calls, stream
completion events, repair JSON, retry a failed completion, or fall back to another
endpoint or protocol.

The endpoint must use `http:` with `localhost`, `127.0.0.1`, or `[::1]`; embedded
credentials are rejected. Redirects are never followed. The whole-request deadline is
30 seconds, including reading the response body, with separate 1 MiB request and
response body ceilings. Per-instance resource options may lower these ceilings, never
raise them; vault configuration exposes no timeout override. Response bytes are bounded
while being read; that is not streaming chat completion support.

Transport, response-envelope, draft, and materialization failures remain failures,
not empty successes or synthetic proposals. CLI JSON mode writes typed failures to
stderr in this shape:

```json
{"error":{"code":"<failure-code>","message":"<diagnostic>"}}
```

Adapter failure codes distinguish the following conditions:

| Codes | Meaning |
|---|---|
| `malformed_envelope`, `invalid_json` | Invalid completion envelope, assistant content, or JSON encoding |
| `refusal`, `truncation`, `tool_calls` | Refused, unfinished, or tool-producing response |
| `context_overflow`, `http_error` | Server-reported context overflow or another HTTP failure |
| `timeout`, `request_limit`, `response_limit` | Deadline or byte ceiling exceeded |
| `redirect`, `transport_error` | Redirect refused or transport failed |
| `invalid_options`, `invalid_endpoint` | Invalid adapter settings or nonconforming endpoint |

Host failures include `draft-schema`, `no-evidence`, `unknown-source`, `line-range`,
`target-path`, `target-context`, `target-changed`, `evidence-changed`, and
`canonical-schema`. These distinguish draft validation and materialization failures
from transport failures. Human-readable messages are diagnostics, not model output to
execute.

No failure creates authority or permits a retry to be silently counted as the original
attempt.

## Intended pinned Windows setup

The operator owns local tooling and model downloads outside the repository and vault.
Ziggurat does not download a server, a model, or signing keys. Keep reviewer private
keys outside the vault and model-accessible processes regardless of tool location.

### llama.cpp

Use the official
[llama.cpp b10809 release](https://github.com/ggml-org/llama.cpp/releases/tag/b10809),
commit `5266f24da75dc449bd56cbed7addb9c8e4a6a73e`.

| Artifact | SHA-256 |
|---|---|
| Official Windows CUDA 12.4 ZIP | `c77bfcd9ed8d91e8721a2d6a290b907fddd4fa5412a47b21c6fa1709116b85f9` |
| Matching CUDA runtime ZIP | `8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6` |

Download manually from the official release, verify both archives, and extract the
server and matching runtime into an operator-managed tool directory. Do not use an
unversioned latest download or assume that a differently built CUDA archive has the
same digest.

Verification recorded on 2026-09-11:

- Server-download checksums match the pins above.
- `--version` reports `0.4.0-dev`, build `10809`, commit `5266f24da`, built for Windows
  with clang `20.1.8`.
- `--help` confirms the planned command's flags, including `--no-context-shift`,
  `--offline`, `--ctx-size`, `--parallel`, and `--alias`.
- Server health and the `ziggurat-refine` model alias are verified.
- The nested JSON Schema request produced a valid pilot draft as recorded above.
- An end-to-end pilot captured Bronze, called the actual model, materialized and
  live-staged Silver with an exact multiline citation and hash, and rendered review.

These checks establish server and pilot-protocol evidence, not a completed pinned-model
acceptance gate or human-assessed quality.

### Qwen model

Use [Qwen/Qwen2.5-7B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/tree/bb5d59e06d9551d752d08b292a50eb208b07ab1f)
at revision `bb5d59e06d9551d752d08b292a50eb208b07ab1f`, Apache-2.0 licensed.
Retain the upstream license and notices. Download both Q4_K_M shards into the same
operator-managed model directory, keeping their names unchanged:

| File | SHA-256 |
|---|---|
| `qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf` | `dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db` |
| `qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf` | `539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a` |

For each downloaded archive and shard, compare the complete SHA-256:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '<downloaded-file>'
```

These pins identify intended artifacts. They do not establish local GPU compatibility,
memory capacity, server startup, schema support, deadline compliance, or model quality.
Final local checksum verification for both pinned model shards has not yet been
recorded. Do not treat a successful server pilot as a substitute for that verification.

### Candidate server command

The pinned binary's version and planned flags have been verified as recorded above.
For a reproducible pinned-model run, first download and verify both shards, then start
from an operator-managed tool directory, substituting the actual model path:

```powershell
.\llama-server.exe -m '<model-directory>\qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf' --host 127.0.0.1 --port 18080 --alias ziggurat-refine --ctx-size 8192 --n-gpu-layers 99 --parallel 1 --no-context-shift --offline
```

Load the first shard; the second must be present beside it. The command intends one
local slot, an explicit model alias, an 8,192-token context, GPU offload, and no context
shifting or automatic downloads. Its flags, server health, alias, nested-schema pilot,
and real end-to-end pilot are verified; the full pinned-model acceptance gate remains
pending.
Keep the process bound to loopback; `--offline` and loopback binding are not an OS
sandbox or a key-custody boundary.

The byte ceilings are not a promise that every allowed reference block fits this
model's token context or finishes within 30 seconds. An overlong or slow request must
fail, not be silently truncated, repaired, retried, or routed elsewhere.

To reproduce the pilot, retain the binary and flag verification above, verify both model
shards, confirm the loopback server is ready, and exercise the actual schema-constrained
chat request through `refine` and `review`. A health response alone does not verify the
draft/materialization protocol, and the successful end-to-end pilot above does not
replace the frozen evaluation.

### Configure the vault

Set the complete chat-completions URL in the vault's `config/adapters.yaml`. The
adapter posts to that URL as configured; it does not append the API path:

```yaml
adapters:
  model_endpoint: http://127.0.0.1:18080/v1/chat/completions
  model_name: ziggurat-refine
```

`model_name` is optional, accepts 1 through 128 characters, and defaults to
`ziggurat-refine`. Match it to the server's loaded alias. Do not add credentials or a
remote host to the endpoint.

With a vault and ingested evidence ready, run a create request, selecting only records
you intend to disclose:

```bash
ziggurat refine --root <vault> --query "Create a concise evidence-backed reference page." --source bronze/<path>.md --json
ziggurat review --root <vault>
```

The first command should stage only Silver; the second renders its untrusted review
packet. Neither grants Gold eligibility. Use the source-checkout command
`node dist/src/cli/main.js` in place of `ziggurat` if no development link is installed.

## Opt-in real-model acceptance gate

`npm run eval:model` is separate from ordinary tests and from the CLI's built-in
`ziggurat eval` conformance cases. It requires an operator-started local endpoint and
must not launch, download, or silently replace the model.

The frozen [`fixtures/refine-model/scenarios.json`](../fixtures/refine-model/scenarios.json)
contains 30 cases covering create, amend, and contradict, each attempted three times,
for 90 attempts total. There are no retries. Model-gate acceptance requires:

- At least 81 of 90 attempts successfully staged by the real host path.
- At least 72 of 90 attempts judged usable by actual human review.
- At least one human-scored usable example of each operation: create, amend, and
  contradict.

Setup, health, and protocol pilot probes are outside the frozen 90 attempts. Do not
count a successful pilot toward either threshold or replace a failed evaluation attempt
with a pilot or retry.
The first sealed 90-attempt batch staged 79 proposals, below the required 81. A separate
second batch completed with 90/90 staged using the same 30 fixtures and generation
settings after the explicit-coordinate presentation change, without individual retries
or repairs. Both seals were validated; all 90 human ratings in each batch remain missing.
The second batch does not replace the first batch or establish a full-gate pass.
See the [evaluation report](model-workflow-evaluation.md) for measured results and why
the informed revision is not an independent held-out result.

Machine staging demonstrates schema, materialization, and staging acceptance only.
A human must assess whether the proposed content and evidence are usable, including
semantic support and handling of contradictions. Missing human scores leave the
quality gate pending, not passed. The configured model, endpoint, setup pins, run
artifacts, and actual scores must be retained when reporting a result.

Passing this model gate does not by itself pass the full Phase 1 gate. Deterministic
negative-case tests must pass separately; the model report does not establish that
requirement.

### Runner invocation

Confirm runner and transport readiness before starting the frozen run. The operator
prepares the pinned manifest and starts the server separately.

```text
npm run eval:model -- --endpoint URL --output NEWDIR --manifest PINNED.json [--model alias] [--seed N] [--max-tokens N]
```

For the pinned local alias and the shipped 2,048-token completion budget:

```powershell
npm run eval:model -- --endpoint 'http://127.0.0.1:18080/v1/chat/completions' --output '<new-run-directory>' --manifest '<pinned-manifest.json>' --model ziggurat-refine --seed 123 --max-tokens 2048
```

| Option | Meaning |
|---|---|
| `--endpoint URL` | Required complete HTTP loopback chat-completions URL |
| `--output NEWDIR` | Required new directory beneath the current working directory; an existing output is refused |
| `--manifest PINNED.json` | Required operator-prepared setup provenance |
| `--model alias` | Optional loaded model alias; must match `manifest.model.alias` |
| `--seed N` | Optional unsigned 32-bit sampling seed; defaults to `123` |
| `--max-tokens N` | Optional completion limit, 1-4,096; defaults to `2,048` |

Freeze the setup and generation settings before the 90 attempts. Changing settings or
running pilots does not permit replacing failed attempts in that run. Temperature is
`0` and the request timeout remains 30 seconds.

### Pinned manifest

The standard pinned manifest records this shape:

| Field | Contents |
|---|---|
| `schema_version` | Literal `1` |
| `server` | `repository`, `commit`, `build` |
| `model` | `repository`, `revision`, `files`, `license`, `alias` |
| `model.files` | Array of `{name, sha256, bytes?}` entries for the model files |
| `runtime` | `chat_template`, `context_size`, `gpu_offload`, optional `parallel` and `context_shift` |
| `machine` | Optional object with `cpu`, `ram_gib`, `gpu`, `vram_gib` |
| `probe` | `response_format`, `verified_at` |

For this split-model setup, `model.files` must contain both official Q4_K_M shards and
their individual verified SHA-256 values. File sizes are optional in this standard
shape. Keep the first shard loaded through `-m` first in the array and use unique
filenames. Do not add `model.file`, a combined `model.sha256`, or `model.shards`; those
are not standard-manifest fields. Use `server.build: "b10809 CUDA12.4"` for the pinned build.
Record `runtime.parallel: 1` and `runtime.context_shift: false` for the planned command,
and actual machine details if supplying the optional `machine` object.

Record actual server and model identities, the verified chat template, context size,
GPU-offload settings, and the nested JSON Schema probe with its actual verification
time. `probe.verified_at` is an ISO timestamp with timezone; do not invent it. The pins
above supply expected identities and hashes; do not claim a downloaded artifact has
been verified before comparing its bytes.
Manifest identities and pins are operator-supplied provenance, not an attestation of
what the endpoint actually loaded.

The runner also accepts a separate detailed runtime-manifest shape with `server`,
`model.files`, `hardware`, and `generation`, as defined by
[`PinnedManifestSchema`](../test/manual/model-report.ts). Its `model.files` entries
contain `name`, `sha256`, and optional `bytes`, with the loaded shard first. Do not mix
that shape with the standard manifest above. The runtime shape has no probe timestamp;
the report preserves that absence as `probe: null` with a note rather than inventing
verification evidence. Preserve the actual pilot record separately.

### Preserved artifacts

The run directory includes `fixtures.json`, exact `pinned-manifest.json` bytes,
`run.json` settings/system prompt/schema, `summary.json`, `COMPLETE.json`, and
`ratings.json`. Each `attempts/<scenario>-trial-N/` directory retains its real vault,
`input.json`, `messages.json`, available `draft.json`, `reference.json`, `lifecycle.json`,
available `response.json`, `protected-files.json`, `review.md`, and `attempt.json`.
Failures preserve available
inputs and draft data, typed diagnostics, latency, and omissions rather than hiding or
replacing the attempt.

The run retains exact messages, the parsed draft, reference context, and artifact
bytes. `COMPLETE.json` records the completion inventory, which is checked against
every immutable file before scoring. Every rating is bound to its attempt's artifact
SHA-256 bytes. Partial runs are never resumed or scored; do not combine attempts from
different runs. This is run-integrity evidence, not a signature, human approval, or
Gold authorization.

For fixture-only evaluation, an explicit in-process adapter `onResponse` callback can
retain the HTTP status and complete bounded response body before parsing, refusal, or
HTTP-error handling. This lets the evaluator preserve raw envelopes and reported token
usage separately from the parsed draft, including complete malformed or rejected
responses.
The evaluator's `response.json` preserves received status/body and available usage;
`attempt.json` records the response path, whether a response was received, token usage,
and reasons for missing observations. Summary token totals include observation coverage
and never infer counts for attempts without reported usage.
`resource_observations.model_tokens` reports each token field as
`{attempts_observed, total}`, with `total: null` when there are no observations.
Counts are server-reported, not estimates of unobserved requests.

An excluded callback-observation pilot verified HTTP 200, a strict-valid draft, and
raw/usage capture in 1.888 seconds, with 148 prompt, 187 completion, and 335 total tokens
reported by the server. This is another pilot, not any of the frozen 90 attempts or
a human-usability score.

This callback is not a vault configuration key or CLI field. Normal adapter use does
not log or retain raw responses automatically, and ordinary errors contain no raw
response fields. Timeouts, oversized responses, and incomplete bodies are not captured.
Unavailable evidence must remain absent or `null` with a reason, not reconstructed,
repaired, or estimated. Raw captures remain untrusted reference data.

### Human scoring

Scoring is a separate invocation against the completed run directory:

```powershell
npm run eval:model -- --score '<run-directory>'
```

The score directory must also be beneath the current working directory. Scoring appends
`scores/<timestamp-uuid>.json` with the verified ratings snapshot, its digest, and a
summary; it does not overwrite the frozen attempt evidence or the original pending
`summary.json`. Use `--score` alone with its completed-run directory, not combined
with generation flags.

The human edits only `ratings.json`. All 90 attempts need an actual `true` or `false`
usability assessment and a non-empty reason. Leave identity fields and digests
unchanged. Missing scores leave human review pending; they cannot count as usable.
This command is not permission for a model to invent human scores or modify sealed
run evidence. Machine checks bind identities and digests; they do not prove human
authorship, attention, review quality, or truth.

| Invocation | Exit code | Meaning |
|---|---|---|
| Generation | `2` | Fewer than 81 staged proposals |
| Generation | `3` | Staging threshold met; human scoring pending |
| `--score` | `0` | Model gate passed with complete human scores |
| `--score` | `2` | Model gate failed |
| `--score` | `3` | Human scoring pending |
| `--score` | `1` | Invalid input or run evidence |

Measured staging results are recorded in the [evaluation report](model-workflow-evaluation.md).
No human-usability result or full acceptance-gate pass has been established.

## Related

- [Architecture](../ARCHITECTURE.md)
- [Authorization protocol](authorization-protocol.md)
- [Ingest and refine](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/guides/ingest-and-refine.md)
- [Configuration and selected limits](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/reference/configuration.md)
