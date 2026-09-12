---
title: Attack-control mapping
description: Selected Microsoft memory-poisoning recommendations and the Ziggurat mechanisms related to them.
---

[ARCHITECTURE.md](https://github.com/patschmittdev/Ziggurat/blob/main/ARCHITECTURE.md#enforcement-points)
enumerates the enforcement points; this page relates selected Microsoft recommendations
to those mechanisms.

The primary scenario is Microsoft's AI memory and context poisoning technique. The same
failure can begin as indirect prompt injection, become persistent data poisoning, and
exploit weak retrieval-store integrity. The linked Microsoft catalog maps those stages to
OWASP LLM01, LLM04, and LLM08 and to MITRE ATLAS context and RAG poisoning techniques.

## Operational control summary

The normative mapping is in
[SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md#attack-controls).

This is a partial mapping, not full implementation of Microsoft's controls.
Ziggurat uses strict record schemas but retains free-text bodies, preserves hostile
instructions as evidence, and does not provide automatic purges, semantic
sanitization, or drift monitoring.

| Memory-poisoning control | Enforcement point or workflow |
|---|---|
| Source approval | Inbox boundary, Bronze store, Gold eligibility |
| Provenance | Evidence validator, index verifier |
| Memory write governance | Receipt verifier, external signing workflow |
| Strict record and proposal schemas | Proposal contract, corpus collector, index verifier |
| Review and diff transparency | Human review packets |
| Presentation sanitization | Human review packet rendering |
| Integrity | Page canonicalizer, receipt verifier, index verifier |
| Isolation | Profile builders |
| Revalidation | Gold eligibility, index verifier |
| Versioning and rollback | Operator-managed Git history and index rebuilds |
| Least privilege | Proposal store, refine reference builder, MCP server |
| Suspicious instruction handling | Refine reference builder, index verifier |
| Resource bounds | Adapter transport, refine reference builder, MCP server |

## Fail-closed behaviour

Gold admission fails closed unless every check in the
[Gold eligibility checklist](../concepts/tiers.md#gold-authorized-reference-admission)
passes.

Proposal corruption and index mismatches fail closed as specified in
[SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md#fail-closed-behavior).

## What this mapping does not claim

These controls do not establish semantic support, factual truth, humanity, review
quality, or process or tenant isolation; see the
[residual risks](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md#explicit-non-guarantees-and-residual-risks).
