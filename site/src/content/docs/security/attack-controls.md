---
title: Attack-control mapping
description: Each recommended memory-poisoning control and the specific Ziggurat enforcement that implements it.
---

The primary scenario is Microsoft's AI memory and context poisoning technique. The same
failure can begin as indirect prompt injection, become persistent data poisoning, and
exploit weak retrieval-store integrity. The linked Microsoft catalog maps those stages to
OWASP LLM01, LLM04, and LLM08 and to MITRE ATLAS context and RAG poisoning techniques.

## Control mapping

| Memory-poisoning control | Ziggurat enforcement |
|---|---|
| Source approval | Sources remain isolated Bronze; extracted claims require separate admission |
| Provenance | Exact Bronze citations, body hashes, quote hashes, and Gold lineage |
| Memory write governance | External human signing capability required for Gold |
| Schema-bound memory | Strict Zod v4 contracts reject unknown fields on Bronze records, configuration and its nested objects, proposals, receipts, and indexes |
| Review and diff transparency | Complete Silver candidates and evidence in `review` |
| Presentation sanitization | Candidate bodies are indented; quoted fields and control characters are escaped |
| Integrity | Receipt binding plus complete chunk, BM25, policy, and live-corpus verification |
| Isolation | Separate communion, review, and evidence indexes |
| Revalidation | Verification age and signed page metadata |
| Versioning and rollback | Source artifacts in Git; generated indexes rebuilt |
| Least privilege | Model writes Silver only; MCP reads communion only; refine payloads are host-selected and bounded |
| Suspicious instruction handling | Preserved as evidence and always labelled non-instructional |
| Resource bounds | Adapter timeout and 1 MiB body caps; bounded refine reference; bounded query, result, and citation counts |

## Enforcement points

| Enforcement point | Control |
|---|---|
| Inbox boundary | Real-path resolution to a regular file under `inbox/`; symlink, reparse, hard-link, traversal, and escape refusal before any read or delete |
| Bronze store | Atomic no-overwrite write and body SHA-256 |
| Refine reference builder | Host-selected sources, hash-verified, bounded per record and in total, omitted rather than truncated, labelled non-instructional |
| Adapter transport | Loopback-only URL, redirects disabled, request deadline, bounded request and streamed response bytes |
| Proposal contract | Strict v2 schema excludes admission fields |
| Evidence validator | Exact Bronze path, body hash, line range, quote, and quote hash |
| Proposal store | Atomic, root-constrained write; strict fail-closed reads |
| Corpus collector | Unreadable, unparsable, or schema-invalid entries rejected and reported by path without content |
| Page canonicalizer | Stable semantic JSON and LF-normalized body |
| Receipt verifier | Trusted Ed25519 key, strict schema, exact page, path, identity, and time binding |
| Gold eligibility | Status, retrieval, privacy, sensitivity, egress, age, lineage, contradiction, authorization |
| Profile builders | Physical separation and policy-safe source selection |
| Index verifier | Chunk labels, content, provenance, BM25, trust policy, and live corpus |
| MCP server | Communion-only startup, two read-only tools, strict tool inputs, bounded query, result, and session citation counts |
| Clean-room audit | Present-but-invalid configuration fails the audit instead of defaulting |

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
