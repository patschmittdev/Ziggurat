---
title: Ingest and refine
description: Capture untrusted evidence, then stage a strict Silver proposal through a loopback model.
---

This guide covers the two commands a model pathway touches. Neither of them can produce
durable memory.

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

The result is an immutable, body-hash-verified Bronze record. Fresh captures default to
`sensitivity: restricted` and `pii: unknown`.

## Refine: stage a Silver proposal

```bash
ziggurat refine --root <vault> --query "<request>" --source bronze/<path>.md
```

Repeat `--source` once per record to name the Bronze records the host should include.
Without `--source`, the same privacy policy that governs the model-readable evidence
index is applied, which excludes fresh captures while their privacy state is unresolved.

### What the model receives

The host reads Bronze on the model's behalf and builds a bounded reference block:

| Bound | Value |
|---|---|
| Records per request | 12 |
| Bytes per record | 32 KiB |
| Total reference bytes | 256 KiB |
| Request deadline | 30 seconds |
| Request and response body ceiling | 1 MiB each |

Each record carries its verified `body_sha256` and its body as 1-based lines, labelled
`content_role: reference` and `instruction_authority: none`. That is what makes exact
citation possible without ever handing the model a path it could fetch. Oversize records
are omitted rather than truncated, and every omission is reported with a reason.

The model endpoint must be an HTTP loopback address. The adapter never follows redirects,
so a loopback endpoint answering with an off-machine `Location` cannot be turned into a
server-side request forgery primitive.

### What the model may return

Exactly one strict schema-version-2 Silver proposal, staged atomically under
`.ziggurat/proposals/`. The refine pathway cannot write Bronze, knowledge pages, reviewed
metadata, trust anchors, receipts, or indexes.

Every returned citation is revalidated against the real Bronze files on disk: exact path,
body hash, line range, quote, and quote hash. A fabricated quote or digest fails staging.

Silver candidates cannot carry status, reviewer, receipt, or admission metadata. The
schema has no field for them.

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

[Human review and external authorization](/Ziggurat/guides/human-review-and-authorization/)
covers what happens after the packet is on screen.
