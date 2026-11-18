---
title: Isolated indexes
description: Why gold, review, and evidence are three physical files rather than one store with filters.
---

`ziggurat build` writes three separate version-2 indexes. They are physically separate
files, not views over a shared store, because a filter is a runtime decision and a
separate file is a structural one.

The Gold index holds eligible knowledge chunks externally
authorized by a configured key.

Retrieval is lexical (BM25) over the Gold index. No embeddings are computed and no vector index exists.

| Index | Contents | Intended use |
|---|---|---|
| `.ziggurat/gold-index.json` | Authorized Gold only | Answer context |
| `.ziggurat/review-index.json` | Silver with candidate `pii: false` whose every Bronze source is PII-false, non-restricted, and hash-verified, plus eligible Gold | Local advisory review |
| `.ziggurat/evidence-index.json` | Integrity-verified Bronze that passes model-access privacy filters, plus eligible Gold | Local forensic tracing |

The Silver addition has no candidate-sensitivity or egress gate. It is advisory
context, not Gold admission; see the
[policy decisions](https://github.com/patschmittdev/Ziggurat/blob/main/docs/policy-enforcement.md).

## What each index carries

Each index has a profile literal, deterministic chunk IDs, a trust-policy fingerprint,
and a corpus fingerprint over complete chunk integrity. Stored chunks, labels, lineage,
proposal provenance, authorization provenance, BM25 data, trust policy, and the live
corpus are verified at startup and again before both search and citation reads.

## What the separation buys

The Gold index is the only index that produces answer context for a general AI client.
Separate files reduce accidental cross-profile selection compared with views over one
store. They do not eliminate implementation bugs or provide process, operating-system,
or tenant isolation.

Shipped MCP startup opens the Gold index only. Review and evidence are not exposed by it at
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

Generated indexes are derived build outputs and verified runtime inputs to retrieval.
`init` does not create a vault `.gitignore`; operators using Git must add vault-local
ignore rules before committing them.

## Related

- [Integrity verification and recovery](../guides/integrity-and-recovery.md)
- [Gold MCP](../guides/mcp-gold.md)
