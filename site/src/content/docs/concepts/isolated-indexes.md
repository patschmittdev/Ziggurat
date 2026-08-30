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
| `.ziggurat/review-index.json` | Silver whose candidate and every source pass model-access privacy filters, plus eligible Gold | Local advisory review |
| `.ziggurat/evidence-index.json` | Integrity-verified Bronze that passes model-access privacy filters, plus eligible Gold | Local forensic tracing |

## What each index carries

Each index has a profile literal, deterministic chunk IDs, a trust-policy fingerprint,
and a corpus fingerprint over complete chunk integrity. Stored chunks, labels, lineage,
proposal provenance, authorization provenance, BM25 data, trust policy, and the live
corpus are verified at startup and again before both search and citation reads.

## What the separation buys

Communion is the only index that produces answer context for a general AI client.
Separate files reduce accidental cross-profile selection compared with views over one
store. They do not eliminate implementation bugs or provide process, operating-system,
or tenant isolation.

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

Generated indexes are derived build outputs and verified runtime inputs to retrieval.
`init` does not create a vault `.gitignore`; operators using Git must add vault-local
ignore rules before committing them.

## Related

- [Integrity verification and recovery](/Ziggurat/guides/integrity-and-recovery/)
- [MCP communion](/Ziggurat/guides/mcp-communion/)
