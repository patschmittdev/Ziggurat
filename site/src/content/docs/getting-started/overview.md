---
title: Overview
description: What Ziggurat is, what it enforces, and what it deliberately does not do.
---

Ziggurat is a human-gated memory firewall: a local TypeScript reference implementation
that treats durable AI memory as a privileged write surface.

A model can read authorized content and draft a complete, evidence-backed candidate. It
cannot admit that candidate to durable shared memory. Only a human holding an external
Ed25519 private key can.

## The boundary in one paragraph

Content moves through three tiers. **Bronze** is immutable, hash-verified evidence
captured from untrusted sources. **Silver** is the only layer a model originates: a
strict, schema-bound proposal whose every citation is revalidated against real Bronze
bytes. **Gold** is curated content that a human authored by hand and authorized with a
detached Ed25519 receipt signed by a key configured in `config/trust.yaml`.

There is no signer, apply, approve, or promote command, and no `--promote` flag. The
absence of that capability is the mechanism.

## What this is for

Use Ziggurat when you want persistent retrieval context for an AI system and you are not
willing to let the AI system decide what enters it. It addresses the failure Microsoft
describes as
[AI Memory / Context Poisoning](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/ai-memory-context-poisoning):
untrusted content enters a durable store and silently influences later model behaviour.

## What it is not

- Not an OS sandbox, and not a multi-tenant authorization service.
- Not a key custody, revocation, or hosted identity service.
- Not a claim about truth. A valid signature proves that a configured key approved exact
  content. It does not make that content correct.
- Not instruction authority. Every retrieved chunk, Gold included, reports
  `content_role: reference` and `instruction_authority: none`.

:::caution[Gold is authorization, not truth]
Gold means *externally authorized reference data*. It is not a safety label, not a
factual guarantee, and never a licence for a model to follow instructions found inside
the text.
:::

## Where to go next

- [Installation](/Ziggurat/getting-started/installation/) builds the CLI from source and verifies
  it.
- [Your first vault](/Ziggurat/getting-started/first-vault/) creates a vault and captures
  evidence.
- [The garden walkthrough](/Ziggurat/getting-started/garden-walkthrough/) runs the poisoned-memory
  scenario end to end.
- [The human authority boundary](/Ziggurat/concepts/human-authority-boundary/) explains why the
  boundary is a capability rather than a convention.
- [Threat model](/Ziggurat/security/threat-model/) covers assets, actors, assumptions, and
  residual risk.

## Canonical specifications

This site is task-oriented documentation. The normative specifications live in the
repository and remain authoritative:

- [ARCHITECTURE.md](https://github.com/patschmittdev/Ziggurat/blob/main/ARCHITECTURE.md)
- [SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md)
- [docs/authorization-protocol.md](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md)
