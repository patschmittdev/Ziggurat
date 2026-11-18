# Local model workflow evaluation

**Experimental:** model-backed refinement has no human usability scores; the revision reused the fixtures that informed it and is not held out.

This records development measurements, not a production reliability claim.
The real model proposes content and source ranges. The host constructs and
validates strict Silver v2; a human must still judge semantic support and usability.
No model output was repaired, retried within an attempt, or admitted to Gold.

## Reproduction

Use the pinned server, model files, and nested structured-output protocol in
[the local model protocol](local-model-protocol.md). These measurements used
llama.cpp b10809, Qwen2.5-7B-Instruct Q4_K_M, an RTX 4080 with 16 GiB VRAM,
approximately 32 GiB system RAM, Windows, and Node.js 24.16.0.

The server used one slot, an 8,192-token context, GPU offload, no context shift,
and the embedded Qwen chat template. Requests used temperature zero, initial
seed 123, 2,048 output tokens, and the unchanged 30-second/1 MiB adapter limits.
The observed chat-template SHA-256 was
`4e9918361c284a93880606d182d64da6a9fe97cdc1f5c5a78c1c8840444246fc`.

Each batch uses the same [30 fixture scenarios](../fixtures/refine-model/scenarios.json),
with three attempts per scenario: 30 create, 30 amend, and 30 contradict attempts.
The committed LF fixture SHA-256 is
`4273f3e9c200d9e56da0c961f4d625583838d4e23c5ac301289c9afc181544f6`.
The measurement recorded SHA-256
`2eac70cd965f3ffc0b707ce20046e807afa901eb95de97ff40a0fbfa0447da55`;
converting the committed LF bytes to CRLF reproduces that hash exactly.
Pilot requests are excluded. Per-attempt inputs, raw bounded responses, token
observations, errors, staged artifacts, and review packets are retained locally
with an immutable completion inventory.
Those artifacts are not published in this repository, so the totals and timings cannot be recounted from it.

Run artifacts are not repository source. Prefer an external working directory
and an absolute path to the built evaluator. The documented `.model-runs/`
directory is also ignored by Git, but Git ignore rules are not clean-room audit
exclusions.

## Setup and pilot verification

Verification recorded on 2026-09-11 with the pinned setup:

- Server-download checksums match the pins in the local model protocol.
- `--version` reports `0.4.0-dev`, build `10809`, commit `5266f24da`, built for Windows
  with clang `20.1.8`.
- `--help` confirms the planned command's flags, including `--no-context-shift`,
  `--offline`, `--ctx-size`, `--parallel`, and `--alias`.
- Server health and the `ziggurat-refine` model alias are verified.
- The nested JSON Schema request produced a valid pilot draft.
- An end-to-end pilot captured Bronze, called the actual model, materialized and
  live-staged Silver with an exact multiline citation and hash, and rendered review.

These checks establish server and pilot-protocol evidence, not a completed pinned-model
acceptance gate or human-assessed quality.


The [preserved callback pilot](../fixtures/refine-model/pilots/callback-observation-3810eed0-617a-48d6-a11b-47f29b3629bc.json) returned a valid draft with 187 completion tokens in 1.89 seconds.
This is protocol-probe evidence, not a model-quality or acceptance result. Pilot probes
are excluded from the frozen 90-attempt evaluation.

An end-to-end pilot also completed `ingestCapture` -> actual llama.cpp response ->
`executeRefinement` materialization and live staging -> `runReview`. The staged
proposal contained the host-derived exact multiline quote and hash. This verifies
that the real workflow ran successfully for that pilot; it does not establish
human usability or a passed 90-attempt gate. This pilot is also excluded from the
frozen evaluation.


Preserved pilot observations are in [fixtures/refine-model/pilots/](../fixtures/refine-model/pilots/).

## First batch: implicit array positions

The first frozen batch completed on 2026-09-12 with the source body represented
as an array of strings and a declared line count.

| Operation | Staged / attempts |
| --- | --- |
| Create | 27 / 30 |
| Amend | 25 / 30 |
| Contradict | 27 / 30 |
| Total | 79 / 90 (87.8%) |

This failed the required 81/90 first-attempt staging gate. All 11 rejections were
`refinement:line-range`: the model returned a range ending beyond the supplied
source's line count. For example, it cited lines 2-4 in a three-line retention
record, or lines 3-6 in a four-line timeout record. The host refused these
responses rather than clipping, substituting, or repairing their citations.

There were no reported transport, schema, or omission failures in this batch.
All 90 bounded responses were retained. Observed refinement latency was
p50 3.245 seconds, p95 4.253 seconds, and maximum 5.032 seconds. The server reported
58,146 prompt tokens and 29,594 completion tokens; these are server observations,
not an independent token meter. Peak evaluator-process RSS was approximately
98.4 MiB, excluding the model server.

The original batch remains sealed, including its failures. Missing human
ratings mean usability is **unmeasured**, not zero percent.

## Measured revision: explicit source coordinates

The host now renders model-facing lines as `{line_number, text}` entries and
explicitly distinguishes Bronze coordinates from candidate or existing-page
line numbers. Internal source snapshots remain exact string arrays for quote
extraction. This changes the input presentation, not the stored Silver schema
or the live evidence validator.

A separately named second batch uses the unchanged fixture set, server/model,
generation settings, limits, and per-batch denominator. It does not replace the
first batch or retry its failed attempts in place.

| Operation | Staged / attempts |
| --- | --- |
| Create | 30 / 30 |
| Amend | 30 / 30 |
| Contradict | 30 / 30 |
| Total | 90 / 90 (100%) |

The second batch completed on 2026-09-12 and passed the 81/90 staging threshold.
There were no transport, schema, range, or omission failures. All 90 bounded
responses were retained. Observed refinement latency was p50 2.780 seconds,
p95 3.931 seconds, and maximum 4.359 seconds. The server reported 64,803 prompt
tokens and 27,205 completion tokens. Peak evaluator-process RSS was approximately
98.3 MiB, excluding the model server.

The scorer successfully verified both batches' completion inventories. With
90 human ratings still missing in each batch, it correctly left human acceptance
pending. These measurements do not establish the later retrieval operating
envelope: they time refinement, not verified Gold queries.

Because the revision was informed by the first batch's failures, a subsequent
pass on these fixtures is not an independent held-out quality result. Both batches
remain separately reported; the initial 11 failures have not been erased.

## Human acceptance remains separate

The required human-usable rate is at least 72/90 without substantive claim or
evidence repair, with a usable ingest-to-review example for each operation.
No human ratings have been supplied. Schema validity and byte-exact citations
cannot substitute for them: an unsupported claim can still have valid citations.

Only a human should edit the generated `ratings.json` judgments and reasons.
The separate `--score` command checks completion and artifact identities before
writing an appended score report. It does not prove human authorship, attention,
or correctness of those judgments.

Human acceptance remains pending independently of the subsequent retrieval,
policy, review, and operating-envelope engineering. Those changes do not supply
human judgments or authorization. There is no new runtime signer, automatic Gold
authoring, embeddings, or cross-request authorization cache in this work.
