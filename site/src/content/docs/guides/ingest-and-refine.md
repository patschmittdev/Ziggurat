---
title: Ingest and refine
description: Capture untrusted evidence, then stage a strict Silver proposal through a loopback model.
---

This guide covers evidence capture and model-assisted refinement. `ingest` persists
Bronze evidence; the model pathway cannot invoke it. `refine` materializes and persists
a Silver proposal from a model draft. Neither command writes Gold, knowledge pages,
receipts, or trust anchors.

## Ingest: capture evidence

```bash
ziggurat ingest --root <vault> --file inbox/some-note.md
```

`ingest` reads and deletes its source, so an escaping source path would be a combined
arbitrary-read and arbitrary-delete primitive. It is validated hard: the source must
resolve to a real regular file physically under `inbox/`.

Refused before the file is opened, copied, or unlinked:

- absolute paths and `..` traversal
- empty path segments and control characters
- directories
- symlinks, junctions, and other reparse points
- hard links, because a hard link makes the deletion step ambiguous
- any real-parent escape out of `inbox/`

:::note[Hard links]
On a filesystem that reports a link count above one for ordinary files, move the file
into `inbox/` as a fresh copy rather than linking it.
:::

The result is canonical UTF-8 text after CRLF-to-LF normalization in a Bronze record.
Ingest creates it atomically without overwriting; SHA-256 verification detects later body
mutation. Fresh captures default to `sensitivity: restricted` and `pii: unknown`.

## Refine: stage a Silver proposal

```bash
ziggurat refine --root <vault> --query "<request>" --source bronze/<path>.md
```

Repeat `--source` once per record to name the Bronze records the host should include.
Without `--source`, the same privacy policy that governs the model-readable evidence
index is applied, which excludes fresh captures while their privacy state is unresolved.

:::caution[Explicit sources widen disclosure]
`--source` is an operator-authorized disclosure to the configured loopback model
endpoint. Explicit selection bypasses the default model-access privacy filter and can
include restricted or PII-unknown Bronze. Inspect each selected record first.
:::

For an amendment or contradiction, explicitly supply the existing knowledge page:

```bash
ziggurat refine --root <vault> --query "<request>" --source bronze/<path>.md --target knowledge/item.md
```

`--target` tells the host to read that page and provide its current content as reference.
It is required for `amend` and `contradict`, and does not authorize overwriting the page.
The host, not the model, derives its base-content hash.

### What the model receives

The host reads Bronze on the model's behalf and builds a bounded reference block:

| Bound | Value |
|---|---|
| Records per request | 12 |
| Bytes per record | 32 KiB |
| Total reference bytes | 256 KiB |
| Request deadline | 30 seconds |
| Request and response body ceiling | 1 MiB each |

The host verifies each record and supplies its body as explicit `{line_number, text}`
entries with a source ID, using 1-based Bronze body coordinates rather than candidate
or existing-page line numbers. Internal source snapshots remain exact string arrays
for quote extraction; stored Silver v2 and live validation are unchanged. Content is labelled
`content_role: reference` and `instruction_authority: none`; see
[provenance and authority](../concepts/provenance-and-authority.md).
Oversize records are omitted rather than truncated, and every omission is reported
with a reason. Only records actually supplied enter the source-ID mapping. The model
cannot cite a record that was selected but omitted, or any other file it names.
Optional target context is also reference data, not an instruction source or a Bronze
evidence substitute.

The model endpoint must be an HTTP loopback address. The supported adapter sends one
non-streaming llama.cpp `POST /v1/chat/completions` request with
`max_tokens: 2048`, `temperature: 0`, `stream: false`, and this response format:

```javascript
response_format: {
  type: "json_schema",
  json_schema: {
    name: "ziggurat_refinement_draft",
    strict: true,
    schema: RefinementDraftJsonSchema
  }
}
```

`RefinementDraftJsonSchema` is generated from the strict Zod draft schema. The nested
form is verified with b10809; a bare sibling `schema` field was silently ignored in a
pilot and is not supported. Optional
`adapters.model_name` defaults to `ziggurat-refine`.

The adapter never follows redirects, so a loopback endpoint answering with an
off-machine `Location` cannot be turned into a server-side request forgery primitive.
The [canonical local model guide](https://github.com/patschmittdev/Ziggurat/blob/main/docs/local-model-protocol.md)
covers the pinned setup candidate and its verification status.

### What the model may return

Exactly one strict `RefinementDraft` with `schema_version: 1`, not stored Silver:

- `operation`: `create`, `amend`, or `contradict`, and `target_path`
- `candidate`: `title`, `type`, `retrieval_eligible`, `pii`, `sensitivity`, `visibility`,
  `egress`, and `body`
- `evidence`: entries containing `source_id`, `line_start`, and `line_end`
- `contradictions`: entries containing `summary` and draft `evidence`
- `confidence`, `affected_paths`, `related_paths`, and `unresolved_questions`

The host resolves the IDs and ranges against supplied bytes, derives exact quotes and
hashes, fills candidate sources/confidence/schema version and target base state, and
validates the resulting strict version-2 Silver proposal against live files before
atomically persisting it under `.ziggurat/proposals/`. The model supplies no hashes,
quotes, or source paths as evidence, and does not write the file. The pathway cannot
write Bronze, knowledge pages, reviewed metadata, trust anchors, receipts, or indexes.

Every materialized citation must match the stored Bronze path, body hash, line range,
quote, and quote hash. Invalid ranges, unknown source IDs, and changed source or target
state fail closed. These checks establish citation integrity, not semantic entailment
or factual truth; reviewers remain responsible for those judgments.

Silver candidates cannot carry status, reviewer, receipt, or admission metadata. The
schema has no field for them.

The adapter reads one finished assistant text response at
`choices[0].message.content`. It does not repair output, retry, fall back to another
protocol, or execute tool calls. In CLI JSON mode, typed failures are written to stderr
as `{"error":{"code":"...","message":"..."}}`; a failure is not a staged proposal.

## Optional real-model evaluation

`npm run eval:model` is an opt-in local model gate, separate from `ziggurat eval` and
ordinary tests. It targets 30 cases across the three operations, each run three times
without retries. Passing requires at least 81 of 90 attempts to stage, 72 to be
human-scored usable, and at least one usable example of each operation. Missing actual
human scores leave the quality gate pending.
Setup and protocol pilot probes are excluded from the frozen 90 attempts.
See the [local model guide](https://github.com/patschmittdev/Ziggurat/blob/main/docs/local-model-protocol.md)
for setup and invocation details; intended pins and thresholds are not measured results.
The [measured workflow report](https://github.com/patschmittdev/Ziggurat/blob/main/docs/model-workflow-evaluation.md)
separately records 79/90 staged in the initial batch and 90/90 after an input-presentation
revision on the same fixtures. Human acceptance remains pending for both batches.

## Review the result

```bash
ziggurat review --root <vault>
```

`review` reads staged proposals directly and renders complete human review packets:
candidate body, exact evidence, contradictions, confidence, base state, and unresolved
questions. Candidate bodies are indented, and quoted fields and control characters are
escaped.

:::caution[Review output is untrusted by construction]
`review` deliberately displays hostile content, marked `UNTRUSTED REFERENCE`. Treat every
displayed byte as data. Terminals and downstream renderers must not treat it as active
markup or commands.
:::

## Next

[Human review and external authorization](./human-review-and-authorization.md)
covers what happens after the packet is on screen.
