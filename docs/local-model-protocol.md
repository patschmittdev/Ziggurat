# Local Model Protocol and Setup

**EXPERIMENTAL:** human usability is unscored; the revision reused the fixtures that informed it and is not held out. Human acceptance remains pending. See [measured workflow evaluation](model-workflow-evaluation.md) for run history and negative results, and [setup and pilot verification](model-workflow-evaluation.md#setup-and-pilot-verification) for pilot evidence and its qualifiers. Initial staging was 79/90, below the 81/90 gate.

## Responsibility boundary

The host reads selected Bronze and optional explicit target context. The model proposes a strict draft; the host derives quotes, hashes, sources, confidence, schema version, and target base hash, then live-validates and atomically stages Silver v2 only. No model pathway writes Bronze, knowledge, reviewed metadata, trust, receipts, or indexes. Draft v1 does not change stored Silver v2, index v2, or receipt v1.

Models receive serialized reference data, no file handles, tools, fetch, or signing capability. Paths are identifiers. All source and target text, including Gold, has `content_role: reference` and `instruction_authority: none`. Byte-valid citations establish neither semantic support nor truth or attention.

## Model input and disclosure

The host supplies at most 12 hash-verified records, 32 KiB canonical UTF-8 Bronze body bytes per source, and 256 KiB combined body bytes. JSON, metadata, prompts, and target context add bytes under the separate 1 MiB request ceiling. Oversize records are omitted rather than truncated, with reasons. Only supplied IDs can be cited. Explicit `{line_number, text}` entries use 1-based Bronze coordinates; internal exact string arrays remain unchanged.

Default selection excludes restricted or PII-unknown records. Repeated `--source` authorizes disclosure even when that privacy filter would exclude the record; inspect sources first. It bypasses neither integrity nor bounds. `--target` is required for amend/contradict, supplies host-read context and base hash, grants no write permission, and supplies no additional citeable Bronze.

```bash
ziggurat refine --root <vault> --query "<request>" --source bronze/<path>.md --target knowledge/item.md
ziggurat review --root <vault>
```

From source, substitute `node dist/src/cli/main.js` for `ziggurat`.

## Strict model output: `RefinementDraft` v1

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

Unknown fields fail at every object boundary. All fields are required; arrays may be empty only where allowed. Evidence entries contain exactly `source_id`, `line_start`, and `line_end`; ranges are positive, inclusive integers within supplied text. Candidate strings are non-empty, retrieval eligibility is boolean, PII/sensitivity use shared enums, and egress is `local-only` or `approved-cloud`. Domain, path, cross-field, and evidence semantics remain host checks.

The model supplies no quotes, paths as evidence, hashes, candidate sources/confidence/schema version, audit or admission fields. The [strict Zod schema](../src/contracts/refinement-draft.ts) generates the request JSON Schema and validates returned JSON. Constrained generation alone is not trusted.

## Host materialization and staging

The host resolves all main and contradiction evidence IDs/ranges, derives exact citations, constructs metadata/base state, and validates against live Bronze and targets before staging. Unknown IDs, bad ranges/targets, malformed drafts, and changed source/target state fail closed.

## Supported llama.cpp request

This contract is not a promise of support for every OpenAI-compatible server.

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

Accept one finished assistant text at `choices[0].message.content`, with exactly one choice, role `assistant`, and `finish_reason: "stop"`; reject tool calls, completion streaming, malformed JSON, refusal, truncation, and missing content. Never repair, retry, or fall back. The nested schema form works with b10809; the bare sibling schema was silently ignored in a pilot and is unsupported.

Use HTTP loopback (`localhost`, `127.0.0.1`, `[::1]`) without credentials or redirects. Whole-request deadline: 30 seconds including response reading. Request and response ceilings: 1 MiB each; enforce response bounds during reads. Instance options may lower ceilings, never raise them; vault configuration has no timeout override. Byte bounds do not promise token-context fit or deadline compliance.

CLI JSON failures go to stderr as `{"error":{"code":"...","message":"..."}}`.

| Codes | Meaning |
|---|---|
| `malformed_envelope`, `invalid_json` | Invalid completion envelope, assistant content, or JSON encoding |
| `refusal`, `truncation`, `tool_calls` | Refused, unfinished, or tool-producing response |
| `context_overflow`, `http_error` | Server-reported context overflow or another HTTP failure |
| `timeout`, `request_limit`, `response_limit` | Deadline or byte ceiling exceeded |
| `redirect`, `transport_error` | Redirect refused or transport failed |
| `invalid_options`, `invalid_endpoint` | Invalid adapter settings or nonconforming endpoint |

Host codes: `draft-schema`, `no-evidence`, `unknown-source`, `line-range`, `target-path`, `target-context`, `target-changed`, `evidence-changed`, `canonical-schema`. Failures are not empty successes and do not create authority.

## Intended pinned Windows setup

The operator obtains tooling/models outside the vault; Ziggurat downloads neither. Keep keys outside model-accessible processes. Use official [llama.cpp b10809](https://github.com/ggml-org/llama.cpp/releases/tag/b10809), commit `5266f24da75dc449bd56cbed7addb9c8e4a6a73e`.

| Artifact | SHA-256 |
|---|---|
| Official Windows CUDA 12.4 ZIP | `c77bfcd9ed8d91e8721a2d6a290b907fddd4fa5412a47b21c6fa1709116b85f9` |
| Matching CUDA runtime ZIP | `8c79a9b226de4b3cacfd1f83d24f962d0773be79f1e7b75c6af4ded7e32ae1d6` |

Manually download, compare complete SHA-256 values, and extract server plus matching runtime. Never substitute unversioned or differently built archives.

Use [Qwen2.5-7B-Instruct-GGUF](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct-GGUF/tree/bb5d59e06d9551d752d08b292a50eb208b07ab1f), revision `bb5d59e06d9551d752d08b292a50eb208b07ab1f`, Apache-2.0. Retain license/notices and unchanged shard names together.

| File | SHA-256 |
|---|---|
| `qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf` | `dfce12e3862a5283ccfb88221b48480e58745165de856439950d0f22590580db` |
| `qwen2.5-7b-instruct-q4_k_m-00002-of-00002.gguf` | `539cf93f78e887edea1c04e2d7d8cdaca9d01dae9c9025bcb8accbe29df3d72a` |

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '<downloaded-file>'
.\llama-server.exe -m '<model-directory>\qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf' --host 127.0.0.1 --port 18080 --alias ziggurat-refine --ctx-size 8192 --n-gpu-layers 99 --parallel 1 --no-context-shift --offline
```

Load the first shard with the second beside it. This intends one slot, 8,192-token context, GPU offload, no context shifting/downloads. Loopback and offline are not a sandbox or key-custody boundary. Pins establish intended artifacts, not GPU compatibility, capacity, startup, schema support, deadlines, or quality. Final checksum verification of both local model shards remains unrecorded. Verify both, confirm readiness, then exercise actual refine/review; health alone is insufficient. See [setup and pilot verification](model-workflow-evaluation.md#setup-and-pilot-verification) for server/pilot history and the [evaluation report](model-workflow-evaluation.md#human-acceptance-remains-separate) for pending acceptance.

Set the complete URL; the adapter appends no path:

```yaml
adapters:
  model_endpoint: http://127.0.0.1:18080/v1/chat/completions
  model_name: ziggurat-refine
```

Model name is optional, 1-128 characters, default `ziggurat-refine`; match the loaded alias. No credentials or remote host.

## Opt-in real-model acceptance gate

`npm run eval:model` is separate from tests and `ziggurat eval`; start the endpoint yourself. Freeze settings before the [30 scenarios](../fixtures/refine-model/scenarios.json), three attempts each, with no retries. Require 81/90 staged, 72/90 human-usable, and one human-usable create, amend, and contradict. Pilots never count or replace attempts. Missing human scores remain pending. Deterministic negative tests are a separate full-gate requirement.

```text
npm run eval:model -- --endpoint URL --output NEWDIR --manifest PINNED.json [--model alias] [--seed N] [--max-tokens N]
npm run eval:model -- --score RUNDIR
```

| Option | Meaning |
|---|---|
| `--endpoint URL` | Required complete HTTP loopback chat-completions URL |
| `--output NEWDIR` | Required new directory beneath the current working directory; an existing output is refused |
| `--manifest PINNED.json` | Required operator-prepared setup provenance |
| `--model alias` | Optional loaded model alias; must match `manifest.model.alias` |
| `--seed N` | Optional unsigned 32-bit sampling seed; defaults to `123` |
| `--max-tokens N` | Optional completion limit, 1-4,096; defaults to `2,048` |

Temperature is 0; timeout 30 seconds. Model alias must match manifest. Output and score directories must be beneath current working directory; output must be new. Partial runs cannot resume or score.

### Pinned manifest

| Field | Contents |
|---|---|
| `schema_version` | Literal `1` |
| `server` | `repository`, `commit`, `build` |
| `model` | `repository`, `revision`, `files`, `license`, `alias` |
| `model.files` | Array of `{name, sha256, bytes?}` entries for the model files |
| `runtime` | `chat_template`, `context_size`, `gpu_offload`, optional `parallel` and `context_shift` |
| `machine` | Optional object with `cpu`, `ram_gib`, `gpu`, `vram_gib` |
| `probe` | `response_format`, `verified_at` |

List both shards with unique names and individual hashes, loaded shard first; sizes optional. No `model.file`, combined hash, or `model.shards`. Record actual identities, template, context, offload, and probe timestamp, never invented verification. Planned values: build `b10809 CUDA12.4`, parallel 1, context_shift false. Pins are operator provenance, not endpoint attestation.

The alternative [runtime manifest](../test/manual/model-report.ts) uses server, model.files, hardware, generation; do not mix shapes. Its absent probe stays null with a reason; preserve pilot evidence separately.

### Preserved artifacts and human scoring

Retain fixtures, exact manifest, run settings/prompt/schema, summary, COMPLETE inventory, ratings, and each attempt's vault, input/messages, available draft/response, reference, lifecycle, protected files, review, and attempt diagnostics. Preserve failures and omissions. COMPLETE verifies every immutable file and rating-to-artifact SHA-256 binding. Never combine runs. This proves neither signature nor human review.

An explicit in-process `onResponse` callback can retain complete bounded status/body and reported usage; normal use does not log raw responses. Timeout, oversized, or incomplete bodies remain absent/null with reasons. Token observations report coverage and null totals without observations, never estimates. Raw captures remain untrusted.

Humans edit only ratings: all 90 need true/false usability plus non-empty reason; retain identities/digests. `--score` alone appends a timestamp/UUID score snapshot and digest without overwriting sealed evidence. Machine checks do not prove human authorship or truth.

| Invocation | Exit code | Meaning |
|---|---|---|
| Generation | `2` | Fewer than 81 staged proposals |
| Generation | `3` | Staging threshold met; human scoring pending |
| `--score` | `0` | Model gate passed with complete human scores |
| `--score` | `2` | Model gate failed |
| `--score` | `3` | Human scoring pending |
| `--score` | `1` | Invalid input or run evidence |
