---
title: Overview
description: What Ziggurat is, what it enforces, and what it deliberately does not do.
---

Ziggurat is a human-gated memory firewall: a local TypeScript reference implementation
that treats durable AI memory as a privileged write surface.

A model can read authorized content and return a candidate with byte-validated citations.
The refine host may persist that model-originated JSON only as Silver. Gold requires a
valid receipt from a configured Ed25519 key that operator policy assigns to a reviewer.
Ziggurat verifies key control and exact-content authorization, not humanity, attention,
semantic support, or factual truth.

## The boundary in one paragraph

Content moves through three tiers. **Bronze** is canonical UTF-8 text captured from
untrusted sources after CRLF-to-LF normalization; ingest creates it without overwriting,
and its body hash detects later mutation. **Silver** is model-originated strict JSON that
the refine host validates and persists; every citation is revalidated against stored
Bronze text. **Gold** is eligible knowledge content admitted by `build` after a detached
Ed25519 receipt from a configured key and every other eligibility check pass.

Ziggurat ships no signer, apply, approve, or promote command; see the
[human authority boundary](../concepts/human-authority-boundary.md).

## What this is for

Use Ziggurat when you want persistent retrieval context for an AI system and you are not
willing to let the AI system decide what enters it. It addresses the failure Microsoft
describes as
[AI Memory / Context Poisoning](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/ai-memory-context-poisoning):
untrusted content enters a durable store and silently influences later model behaviour.

## How it differs from other agent-memory systems

mem0, Letta, and Zep persist model-originated memory automatically. mem0's `add`
pipeline lets an LLM decide what to store, Letta agents edit their own memory blocks
through tools, and Zep extracts facts into its context graph as conversations arrive.
Those are reasonable defaults for recall quality, and each is better than Ziggurat at
hosted, multi-tenant retrieval. Ziggurat makes the opposite trade: nothing
model-originated becomes authorized reference data without a detached Ed25519 receipt
from a key that operator policy assigns to a human. That is a capability boundary, not a
review convention, and it is the only thing Ziggurat claims to do better. Vendor
behaviour is as documented on 2026-09-09; Ziggurat does not integrate with any of them.

## What it is not

- Not an OS sandbox, and not a multi-tenant authorization service.
- Not a key custody, revocation, or hosted identity service.
- Not a claim about truth. A valid signature proves that a configured key approved exact
  content. It does not make that content correct.
- Every retrieved chunk carries `content_role: reference` and
  `instruction_authority: none`.

:::caution[Gold is authorization, not truth]
Gold carries no truth or safety guarantee; see
[provenance and authority](../concepts/provenance-and-authority.md).
:::

## Where to go next

- [Installation](./installation.md) builds the CLI from source and verifies
  it.
- [Your first vault](./first-vault.md) creates a vault and captures
  evidence.
- [The garden walkthrough](./garden-walkthrough.md) runs the poisoned-memory
  scenario end to end.
- [The human authority boundary](../concepts/human-authority-boundary.md) explains why the
  boundary is a capability rather than a convention.
- [Threat model](../security/threat-model.md) covers assets, actors, assumptions, and
  residual risk.

## Canonical specifications

This site is task-oriented documentation. The normative specifications live in the
repository and remain authoritative:

- [ARCHITECTURE.md](https://github.com/patschmittdev/Ziggurat/blob/main/ARCHITECTURE.md)
- [SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md)
- [docs/authorization-protocol.md](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md)
