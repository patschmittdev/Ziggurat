---
title: Isolated indexes
description: Why communion, review, and evidence are three physical files rather than one store with filters.
---

`ziggurat build` writes three separate version-2 indexes. They are physically separate
files, not views over a shared store, because a filter is a runtime decision and a
separate file is a structural one.

| Index | Contents | Intended use |
|---|---|---|
| `.ziggurat/gold-index.json` | Authorized Gold only | Communion answer context |
| `.ziggurat/review-index.json` | Policy-safe Silver proposals plus authorized Gold | Local advisory review |
| `.ziggurat/evidence-index.json` | Policy-safe Bronze plus authorized Gold | Local forensic tracing |

## What each index carries

Each index has a profile literal, deterministic chunk IDs, a trust-policy fingerprint,
and a corpus fingerprint over complete chunk integrity. Stored chunks, labels, lineage,
proposal provenance, authorization provenance, BM25 data, trust policy, and the live
corpus are verified at startup and again before both search and citation reads.

## What the separation buys

Communion is the only index that produces answer context for a general AI client. If
review and evidence were profiles over one store, then a bug, a mis-set flag, or a
crafted query would be the only thing standing between advisory Silver content and an
answer. Making them different files removes that class of mistake.

Shipped MCP startup opens communion only. Review and evidence are not exposed by it at
all.

:::caution[Advisory is not identity]
Review and evidence access is advisory context for a local operator. It is never proof of
a human identity and never an authorization decision. Reading a Silver proposal through
the review index does not approve it.
:::

## Failure behaviour

An index schema, chunk, provenance, trust-label, BM25, trust-policy, or live-corpus
mismatch prevents startup, or prevents the next search or read. Recovery is a rebuild
from the current authoritative artifacts, not a repair of the index file.

Generated indexes are ignored by version control and rebuilt from source artifacts. They
are outputs, never inputs.

## Related

- [Integrity verification and recovery](/Ziggurat/guides/integrity-and-recovery/)
- [MCP communion](/Ziggurat/guides/mcp-communion/)
