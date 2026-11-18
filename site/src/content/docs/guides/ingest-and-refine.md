---
title: Ingest and refine
description: Capture untrusted evidence, then stage a strict Silver proposal through a loopback model.
---

**Experimental:** model-backed refinement has no human usability scores; the revision reused the fixtures that informed it and is not held out.

This guide covers evidence capture and model-assisted refinement. `ingest` persists
Bronze evidence; the model pathway cannot invoke it. `refine` materializes and persists
a Silver proposal from a model draft. Neither command writes Gold, knowledge pages,
receipts, or trust anchors.

## Ingest: capture evidence

```bash
ziggurat ingest --root <vault> --file inbox/some-note.md
```

For a new capture, `ingest` creates and verifies a Bronze record before deleting
the inbox source. If the canonical body already exists, it returns `duplicate`
and leaves the inbox source untouched, even when the existing Bronze record uses
CRLF line endings on disk or the duplicate has a different inbox filename.

Because a new capture reads and deletes its source, an escaping path would be a combined
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
Reading, hash verification, and duplicate detection use that same normalization;
lone carriage returns are preserved and remain significant to the body hash.
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
| Canonical Bronze body bytes per source | 32 KiB |
| Combined canonical Bronze body bytes | 256 KiB |
| Request deadline | 30 seconds |
| Request and response body ceiling | 1 MiB each |

JSON encoding, metadata, prompts, and optional target context add request bytes;
they share the separate 1 MiB request ceiling.

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

The [local model protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/local-model-protocol.md) defines transport, draft fields, materialization, typed failures, setup, and evaluation. Citation integrity does not establish semantic support or truth.

## Evaluation

Initial staging was 79/90, below the 81/90 gate. See the [workflow evaluation](https://github.com/patschmittdev/Ziggurat/blob/main/docs/model-workflow-evaluation.md) for staging results and pending human acceptance.
