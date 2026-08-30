---
title: Attack-control mapping
description: Each recommended memory-poisoning control and the specific Ziggurat enforcement that implements it.
---

The primary scenario is Microsoft's AI memory and context poisoning technique. The same
failure can begin as indirect prompt injection, become persistent data poisoning, and
exploit weak retrieval-store integrity. The linked Microsoft catalog maps those stages to
OWASP LLM01, LLM04, and LLM08 and to MITRE ATLAS context and RAG poisoning techniques.

## Operational control summary

The normative mapping and exact enforcement points live in
[SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md) and
[ARCHITECTURE.md](https://github.com/patschmittdev/Ziggurat/blob/main/ARCHITECTURE.md).
Operationally, inspect these boundaries:

- **Capture:** inbox real-path checks precede reads and deletion; ingest creates canonical
  Bronze text without overwriting and records its body SHA-256.
- **Proposal staging:** the host bounds and labels selected Bronze text, validates strict
  model-originated v2 JSON, and checks citation path, hash, range, and quote integrity.
  Those checks do not establish semantic support or factual truth.
- **Authorization and admission:** no shipped path creates authorization or applies Silver
  to knowledge. `build` verifies a configured-key receipt and every other Gold eligibility
  rule before admission. A signature proves key control, not humanity or review quality.
- **Retrieval:** communion, review, and evidence are separate files; shipped MCP opens only
  communion. This reduces accidental cross-profile selection but is not process or tenant
  isolation.
- **Resource and integrity checks:** loopback transport, request/response bounds, retrieval
  limits, policy fingerprints, BM25 data, chunk integrity, and live corpus state fail
  closed as specified in the canonical documents.

## Fail-closed behaviour

Gold eligibility fails for a missing or invalid receipt, an untrusted key, a signature
mismatch, page mutation, stale verification, invalid Bronze lineage, PII, restricted
sensitivity, unapproved egress, or an unresolved contradiction.

Proposal corruption makes Silver and contradiction state unverifiable. An index schema,
chunk, provenance, trust-label, BM25, trust-policy, or live-corpus mismatch prevents
startup or the next search or read.

## What this mapping does not claim

Implementing a control is not the same as eliminating a risk. See
[Guarantees and residual risks](/Ziggurat/security/guarantees/) for what remains.
