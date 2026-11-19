---
title: Overview
description: What Ziggurat is, what it enforces, and what it deliberately does not do.
---

Ziggurat is a human-gated memory firewall: a local TypeScript reference implementation
that treats durable AI memory as a privileged write surface.

## The boundary in one paragraph

A model can read authorized content and return a strict version-1 refinement draft with
source IDs and line ranges. The refine host derives canonical citations and version-2
Silver, then validates and persists only that artifact. Gold requires a
valid receipt from a configured Ed25519 key that operator policy assigns to a reviewer.
Ziggurat verifies key control and exact-content authorization, not humanity, attention,
semantic support, or factual truth. See [Bronze, Silver, and Gold](../concepts/tiers.md),
the [human authority boundary](../concepts/human-authority-boundary.md), and the
[enforced boundaries](../security/guarantees.md#enforced-boundaries).

## What this is for

Use Ziggurat when you want persistent retrieval context for an AI system and you are not
willing to let the AI system decide what enters it. It addresses agent memory and
context poisoning, described by
[OWASP ASI06 - Memory & Context Poisoning](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/),
[MITRE ATLAS AML.T0080 - AI Agent Context Poisoning, Memory](https://d3fend.mitre.org/offensive-technique/attack/AML.T0080/),
and [Microsoft Learn - AI Memory / Context Poisoning](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/ai-memory-context-poisoning):
untrusted content enters a durable store and silently influences later model behaviour.

## How it differs from other agent-memory systems

[Mem0's add pipeline](https://docs.mem0.ai/core-concepts/memory-operations/add)
supports automatic memory extraction.
[Letta agents](https://docs.letta.com/v1-sdk/concepts/stateful-agents) can edit
their memory blocks through tools, and
[Zep](https://help.getzep.com/adding-messages.md) extracts facts into a context
graph from conversation messages.

These systems support automatic extraction or agent-managed memory. Ziggurat does
not offer hosted, multi-tenant retrieval and instead requires detached
configured-key authorization before model-originated content can enter Gold.
This is a design trade-off, not a measured superiority claim. Ziggurat does not
integrate with these products.

## What it is not

- Not an OS sandbox, and not a multi-tenant authorization service.
- Not a key custody, revocation, or hosted identity service.

See all [non-guarantees and residual risks](../security/threat-model.md#explicit-non-guarantees-and-residual-risks).

:::caution[Gold is authorization, not truth]
Gold carries no truth or safety guarantee; see
[provenance and authority](../concepts/provenance-and-authority.md).
:::

## Where to go next

- [Installation](./installation.md) builds the CLI from source and verifies
  it.
- [Your first vault](./first-vault.md) creates a vault and captures
  evidence.
- [The garden walkthrough](./garden-walkthrough.md) prepares the poisoned-memory
  fixture vault and explains the separate end-to-end automated test and remaining
  manual steps.
- [The human authority boundary](../concepts/human-authority-boundary.md) explains why the
  boundary is a capability rather than a convention.
- [Threat model](../security/threat-model.md) covers assets, actors, assumptions, and
  residual risk.

## Canonical specifications

- [ARCHITECTURE.md](https://github.com/patschmittdev/Ziggurat/blob/main/ARCHITECTURE.md)
- [Threat model](../security/threat-model.md)
- [docs/authorization-protocol.md](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md)
- [docs/local-model-protocol.md](https://github.com/patschmittdev/Ziggurat/blob/main/docs/local-model-protocol.md)
