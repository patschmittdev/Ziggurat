---
title: Threat model
description: Assumptions, controls, and residual risks.
---

Ziggurat addresses persistent AI memory and context poisoning: untrusted content
enters a durable retrieval store and silently influences later model behavior.
This attack class is described by
[OWASP ASI06 - Memory & Context Poisoning](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/),
[MITRE ATLAS AML.T0080 - AI Agent Context Poisoning, Memory](https://d3fend.mitre.org/offensive-technique/attack/AML.T0080/),
and [Microsoft Learn - AI Memory / Context Poisoning](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/ai-memory-context-poisoning).

Relevant attack inputs include poisoned documents, fabricated facts, embedded
instructions, tampered retrieval indexes, compromised agents, and stale
approved content.

## Assets and actors

Protected assets are Bronze integrity, Silver review context, Gold admission state,
reviewer trust anchors, detached authorization receipts, isolated indexes, and
retrieved citations.

Actors are untrusted source authors, the loopback refinement model, human reviewers,
the trusted local operator, general Gold retrieval clients,
and advisory review/evidence tooling. Advisory access does not establish human identity.

## Trust assumptions

- The operator controls vault permissions, local processes, Git history, and
  `config/trust.yaml`.
- Reviewer Ed25519 private keys remain outside the vault and model-accessible
  processes.
- The configured public keys identify reviewers acceptable to the operator.
- Model endpoints use HTTP loopback only.
- The local machine is a single trusted-operator environment, not a hostile
  multi-tenant host.

## Security boundaries and capabilities

The model endpoint receives host-selected, bounded data and returns structured JSON.
It receives no path, handle, fetch, filesystem, or tool capability, and the refine
pathway can write only Silver. `ingest` refuses any source that does not resolve to a
real regular file physically under `inbox/`, before reading, copying, or deleting it.
No production module writes knowledge pages, reviewed metadata, trusted reviewer keys,
or authorization receipts. The human admission capability is an external Ed25519
private key.

Details: [enforced boundaries](./guarantees.md#enforced-boundaries),
[ingest and refine](../guides/ingest-and-refine.md),
[model transport and configuration](../reference/configuration.md),
[retrieval session bounds](../guides/mcp-gold.md#bounds), and the
[authorization protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md).

## Attack mapping

The primary scenario is the memory and context poisoning described above. The same
failure can begin as indirect prompt injection, become persistent data poisoning,
and exploit weak retrieval-store integrity. Ziggurat addresses admission and
retrieval integrity; it does not claim to prevent every prompt-injection or
model-behavior failure.

## Attack controls

Most row names follow the recommended controls in the Microsoft Learn entry above.
This is a partial mapping, not a claim of coverage for any cited framework's
mitigations. Ziggurat retains free-text bodies and hostile instructions as
evidence. It does not provide automatic purges, semantic sanitization,
or drift monitoring.

| Memory-poisoning control | Ziggurat enforcement |
|---|---|
| Source approval | Sources remain isolated Bronze; extracted claims require separate admission |
| Provenance | Exact Bronze citations, body hashes, quote hashes, and Gold lineage |
| Memory write governance | External signing capability required for Gold |
| Strict record and proposal schemas | Strict Zod v4 contracts reject unknown fields on Bronze records, main vault configuration and its nested objects, proposals, receipts, and indexes; clean-room configuration is validated separately |
| Review and diff transparency | Complete Silver candidates and evidence in `review` |
| Presentation sanitization | Candidate bodies are indented; quoted fields and control characters are escaped |
| Integrity | Receipt binding plus complete chunk, BM25, policy, and live-corpus verification |
| Isolation | Separate gold, review, and evidence indexes |
| Revalidation | Verification age and signed page metadata |
| Versioning and rollback | Source artifacts in Git; generated indexes rebuilt |
| Least privilege | Model writes Silver only; MCP reads Gold only; refine payloads are host-selected and bounded |
| Suspicious instruction handling | Preserved as evidence and always labeled non-instructional |
| Resource bounds | Adapter timeout and 1 MiB body caps; bounded refine reference; bounded query, result, and citation counts |

## Fail-closed behavior

Gold eligibility fails for:

- missing or invalid receipt
- untrusted key
- signature mismatch
- page mutation
- stale verification
- invalid Bronze lineage
- PII
- restricted sensitivity
- unapproved egress
- unresolved contradiction

Proposal corruption makes Silver and contradiction state unverifiable. Index schema,
chunk, provenance, trust-label, BM25, trust-policy, or live-corpus mismatch prevents
startup or the next search/read. Rebuilding from current authoritative artifacts is
required.

## Provenance is not instruction authority

Every retrieved chunk carries `content_role: reference` and
`instruction_authority: none`; see
[provenance and authority](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/concepts/provenance-and-authority.md).

## Explicit non-guarantees and residual risks

- Ziggurat is not an OS sandbox or a multi-tenant authorization service.
- Arbitrary local filesystem access defeats application-level path and process
  boundaries. An attacker who replaces trust configuration and rebuilds can create a
  new trust root.
- The `visibility` field on a curated page is uninterpreted operator metadata. It is
  bound by the signature so a reviewer approves the exact label, but Ziggurat enforces
  no access control from it and it grants or denies nothing. Retrieval eligibility
  comes from status, `retrieval_eligible`, privacy, sensitivity, egress, verification
  age, lineage, contradictions, and the receipt.
- Path validation resolves real paths before use, but application-level checks cannot
  fully close time-of-check to time-of-use windows. An attacker able to swap vault
  directories concurrently with a command is inside the operator trust assumption,
  not outside it.
- `ingest` refuses a source with more than one hard link, because a hard link makes
  the deletion step ambiguous. On filesystems that report a link count above one for
  ordinary files, move the file into `inbox/` as a fresh copy.
- An AI process granted arbitrary shell, filesystem, or reviewer-key access is outside
  this boundary and can act with the authority the operator delegated to it.
- Stolen or misused reviewer private keys can authorize poisoned content.
- Human reviewers can make mistakes, collude, or approve false claims.
- Signatures do not detect semantic deception that a reviewer accepts.
- Gold text can still contain prompt injection; see
  [instruction authority](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/concepts/provenance-and-authority.md#3-instruction-authority).
- Review output intentionally displays untrusted content. Terminals and downstream
  renderers must not treat it as active markup or commands.
- No GUI review system is provided; review is a terminal rendering plus an external
  signing step.
- The implementation does not provide hardware key storage, revocation services,
  threshold approval, remote attestation, hosted identity, tenant isolation, or
  transport security.
- Git history can be rewritten by an operator with repository authority. Git is used
  for audit and rollback, not as the cryptographic admission signal.
- Availability attacks remain possible. Corrupt proposals or policy changes can
  intentionally force fail-closed denial of service.

- A writer can restore an earlier signed page with its earlier receipt and re-admit
  superseded text without the key. Receipt v1 has no supersession counter. This
  rollback risk is bounded by the 90-day `last_verified` age rule and `review_after`.

## Key and incident handling

- Never store a reviewer private key in the vault. `ziggurat check` flags PEM private
  key material.
- Remove a compromised public key from `config/trust.yaml`, rebuild, and inspect all
  receipts issued by that key.
- Revoke poisoned memory by removing or correcting the page and receipt, committing
  the change, and rebuilding all indexes.
- Treat any unexpected proposal, receipt, trust-policy, or index change as a
  potential memory-poisoning incident.



Report vulnerabilities through [SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md). See [guarantees](./guarantees.md).
