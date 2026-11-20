---
title: Guarantees
description: What Ziggurat enforces in code, with links to the risks it explicitly does not remove.
---

## Enforced boundaries

- `ingest` is the only Bronze writer. It stores canonical UTF-8 text after CRLF-to-LF
  normalization with no-overwrite creation; body-hash verification detects later
  mutation.
- `ingest` refuses unsafe source paths before any read, copy, or deletion; see the
  [ingest path rules](../guides/ingest-and-refine.md#ingest-capture-evidence).
- `refine` can write only strict version-2 artifacts under `.ziggurat/proposals/`.
- The model returns a strict version-1 draft. Only the host derives exact citation
  bytes and hashes, materializes stored Silver v2, and invokes live staging validation.
- The refine model receives canonical Bronze text the host selected, in a bounded,
  labelled reference block, plus optional host-read target context. Only supplied source
  IDs and line ranges may be cited. The shipped interface gives it no path it can fetch
  and no filesystem capability.
- Silver candidates cannot contain status, reviewer, receipt, or admission metadata.
- Every Silver citation must match stored Bronze text, hashes, and line ranges. This is
  citation integrity, not semantic or factual verification.
- No function in `src/` writes knowledge pages, reviewed metadata, trusted reviewer keys,
  or authorization receipts.
- The CLI and MCP server have no signing, apply, approve, or promote path; see the
  [human authority boundary](../concepts/human-authority-boundary.md).
- Gold requires a detached Ed25519 receipt from a configured key, as defined in the
  [authorization protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md#unsigned-receipt).
  Operator policy assigns keys to reviewers; verification does not prove humanity,
  attention, semantic support, factual verification, or review.
- `reviewed_by` text is self-asserted and insufficient by itself.
- Unresolved contradiction proposals block Gold until their proposal IDs appear in the
  signed page.
- gold, review, and evidence are physically separate version-2 indexes.
- Stored chunks, labels, lineage, proposal provenance, authorization provenance, BM25
  data, trust policy, and the live corpus are verified at startup and before both search
  and citation reads.
- Shipped MCP startup is Gold-only and exposes exactly `search_context` and
  `read_context`.
- Retrieval is bounded: at most 1,024 query UTF-16 code units, 20 results per search, and
  200 citations retained per session. Older citation IDs become invalid when evicted.
- Every retrieved chunk carries `content_role: reference` and
  `instruction_authority: none`; see [provenance and authority](../concepts/provenance-and-authority.md).
- The model endpoint is limited to HTTP loopback addresses. The adapter never
  follows redirects, bounds every request with a 30 second timeout, and refuses request or
  response bodies over 1 MiB.
- Bronze records, configuration files, proposals, receipts, and indexes all reject
  unknown fields, including unknown fields inside nested configuration objects.
- A present but malformed or unreadable `config/clean-room.yaml` fails the release audit
  instead of falling back to defaults.

Corpus rejection diagnostics are described in
[integrity and recovery](../guides/integrity-and-recovery.md).

## Residual risks and incident handling

The [threat model](./threat-model.md) lists the
[non-guarantees and residual risks](./threat-model.md#explicit-non-guarantees-and-residual-risks)
and [key and incident handling](./threat-model.md#key-and-incident-handling).
If this page and the threat model differ, the threat model wins.
