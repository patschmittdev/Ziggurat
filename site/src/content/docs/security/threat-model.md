---
title: Threat model overview
description: Assets, actors, trust assumptions, and the capability boundaries Ziggurat enforces.
---

The canonical threat model is
[SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md). This page
is an orientation to it.

## The attack being addressed

Persistent AI memory and context poisoning: untrusted content enters a durable retrieval
store and silently influences later model behaviour. Microsoft describes the technique
and its recommended controls in
[AI Memory / Context Poisoning](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/ai-memory-context-poisoning).

Relevant attack inputs include poisoned documents, fabricated facts, embedded
instructions, tampered retrieval indexes, compromised agents, and stale approved content.

Ziggurat addresses admission and retrieval integrity. It does not claim to prevent every
prompt-injection or model-behaviour failure.

## Protected assets

Bronze integrity, Silver review context, Gold admission state, reviewer trust anchors,
detached authorization receipts, isolated indexes, and retrieved citations.

## Actors

Untrusted source authors, the loopback refinement model, human reviewers, the trusted
local operator, general communion clients, and advisory review or evidence tooling.
Advisory access does not establish human identity.

## Trust assumptions

These are the conditions under which the guarantees hold. They are assumptions, not
claims:

- The operator controls vault permissions, local processes, Git history, and
  `config/trust.yaml`.
- Reviewer Ed25519 private keys remain outside the vault and outside model-accessible
  processes.
- The configured public keys identify reviewers acceptable to the operator.
- Model endpoints use HTTP loopback only.
- The local machine is a single trusted-operator environment, not a hostile multi-tenant
  host.

## Capability boundaries

The model endpoint receives messages and returns structured JSON. Ziggurat gives it no
filesystem or tool capability. The refine pathway owns only a root-constrained Silver
writer.

The host places selected Bronze bytes into the request as an explicit, bounded, labelled
reference block, and revalidates the returned proposal against the real files. The model
receives data, never a path, handle, or fetch capability.

`ingest` reads and deletes its source, so its source path is validated as a combined
arbitrary-read and arbitrary-delete primitive would be.

No production module writes knowledge pages, reviewed metadata, trusted reviewer keys, or
authorization receipts.

## What a receipt binds

- `decision: admit`
- the normalized knowledge target path
- SHA-256 of canonical semantic page content
- reviewer ID and review timestamp
- trusted key ID and the Ed25519 algorithm

The signature payload is domain separated, and the canonical page representation uses
parsed fields in fixed order with an LF-normalized body, so verification is stable on
Windows, macOS, and Linux.

Verification proves control of a configured key and authorization of exact canonical
content. Operator policy maps keys to reviewers; Ziggurat does not prove that the signer
was human, attended to the content, or completed a particular review workflow.

## Reporting a vulnerability

Do not open a public issue. Private vulnerability reporting is not enabled while the
repository remains private. If you already have private repository access, use its
Security Advisories area; otherwise use an established private channel to the maintainer
and do not disclose details publicly. The public-reporting link will become available
only after the release checklist activates it. Do not submit private vault content,
credentials, tokens, or reviewer private keys.

This project is pre-release and does not promise a response-time service level.

## Related

- [Attack-control mapping](/Ziggurat/security/attack-controls/)
- [Guarantees and residual risks](/Ziggurat/security/guarantees/)
