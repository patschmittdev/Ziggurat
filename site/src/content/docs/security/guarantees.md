---
title: Guarantees and residual risks
description: What Ziggurat enforces in code, and the risks it explicitly does not remove.
---

Read both lists. A boundary whose edges you cannot describe is a boundary you cannot rely
on.

This page is an operational summary. [SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md)
owns the normative threat model, exact controls, and residual risks.

## Enforced boundaries

- `ingest` is the only Bronze writer. It stores canonical UTF-8 text after CRLF-to-LF
  normalization with no-overwrite creation; body-hash verification detects later
  mutation.
- An `ingest` source must resolve to a real regular file physically under `inbox/`.
  Absolute paths, `..` traversal, symlinks, junctions, other reparse points, hard links,
  directories, and anything outside `inbox/` are refused before the file is read, copied,
  or deleted.
- `refine` can write only strict version-2 artifacts under `.ziggurat/proposals/`.
- The refine model receives canonical Bronze text the host selected, in a bounded,
  labelled reference block. The shipped interface gives it no path it can fetch and no
  filesystem capability.
- Silver candidates cannot contain status, reviewer, receipt, or admission metadata.
- Every Silver citation must match stored Bronze text, hashes, and line ranges. This is
  citation integrity, not semantic or factual verification.
- No shipped function writes knowledge pages, reviewed metadata, trusted reviewer keys,
  or authorization receipts.
- Gold requires a detached Ed25519 receipt from a configured key. The receipt binds the
  claimed reviewer, timestamp, target path, and canonical page digest. Operator policy
  assigns keys to reviewers; verification does not prove humanity, attention, or review.
- `reviewed_by` text is self-asserted and insufficient by itself.
- Unresolved contradiction proposals block Gold until their proposal IDs appear in the
  signed page.
- Communion, review, and evidence are physically separate version-2 indexes.
- Stored chunks, labels, lineage, proposal provenance, authorization provenance, BM25
  data, trust policy, and the live corpus are verified at startup and before both search
  and citation reads.
- Shipped MCP startup is communion-only and exposes exactly `search_context` and
  `read_context`.
- Retrieval is bounded: at most 1,024 query UTF-16 code units, 20 results per search, and
  200 citations retained per session. Older citation IDs become invalid when evicted.
- Every returned chunk says `content_role: reference` and `instruction_authority: none`.
- Model and embedding endpoints are limited to HTTP loopback addresses. The adapter never
  follows redirects, bounds every request with a 30 second timeout, and refuses request or
  response bodies over 1 MiB.
- Bronze records, configuration files, proposals, receipts, and indexes all reject
  unknown fields, including unknown fields inside nested configuration objects.
- A present but malformed or unreadable `config/clean-room.yaml` fails the release audit
  instead of falling back to defaults.

## Operationally important non-guarantees

- Ziggurat is not an OS sandbox or a multi-tenant authorization service.
- Arbitrary local filesystem access defeats application-level path and process
  boundaries. An attacker who replaces trust configuration and rebuilds can create a new
  trust root.
- The `visibility` field on a curated page is uninterpreted operator metadata. It is bound
  by the signature so a reviewer approves the exact label, but Ziggurat enforces no access
  control from it and it grants or denies nothing.
- Path validation resolves real paths before use, but application-level checks cannot
  fully close time-of-check to time-of-use windows. An attacker able to swap vault
  directories concurrently with a command is inside the operator trust assumption.
- `ingest` refuses a source with more than one hard link, because a hard link makes the
  deletion step ambiguous.
- An AI process granted arbitrary shell, filesystem, or reviewer-key access is outside
  this boundary and can act with the authority the operator delegated to it.
- Stolen or misused reviewer private keys can authorize poisoned content.
- Human reviewers can make mistakes, collude, or approve false claims.
- Signatures do not detect semantic deception that a reviewer accepts.
- Gold text can still contain prompt injection. Consumers must honour
  `instruction_authority: none`.
- Review output intentionally displays untrusted content. Terminals and downstream
  renderers must not treat it as active markup or commands.
- The implementation does not provide hardware key storage, revocation services,
  threshold approval, remote attestation, hosted identity, tenant isolation, or transport
  security.
- Git history can be rewritten by an operator with repository authority. Git is used for
  audit and rollback, not as the cryptographic admission signal.
- Availability attacks remain possible. Corrupt proposals or policy changes can
  intentionally force fail-closed denial of service.

## Key and incident handling

- Never store a reviewer private key in the vault. `ziggurat check` flags PEM private-key
  material.
- Remove a compromised public key from `config/trust.yaml`, rebuild, and inspect all
  receipts issued by that key.
- Revoke poisoned memory by removing or correcting the page and receipt, committing the
  change, and rebuilding all indexes.
- Treat any unexpected proposal, receipt, trust-policy, or index change as a potential
  memory-poisoning incident.

The `--promote` flag does not exist and must not be added.

## Canonical source

If this summary and
[SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md) differ,
SECURITY.md wins. Update this page rather than treating it as a second specification.
