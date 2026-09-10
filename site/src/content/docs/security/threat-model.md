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
local operator, general Gold retrieval clients, and advisory review or evidence tooling.
Advisory access does not establish human identity.

## Trust assumptions

The guarantees assume a trusted local operator and external reviewer-key custody, not
a hostile multi-tenant host; the full conditions are assumptions, not enforced claims,
in
[SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md#trust-assumptions).

## Capability boundaries

The model endpoint receives messages and returns structured JSON. Ziggurat gives it no
filesystem or tool capability. The refine pathway owns only a root-constrained Silver
writer.

The host places selected Bronze bytes into the request as an explicit, bounded, labelled
reference block, and revalidates the returned proposal against the real files. The model
receives data, never a path, handle, or fetch capability.

`ingest` reads and deletes its source, so an escaping source path would be a combined arbitrary-read and arbitrary-delete primitive.

No production module writes knowledge pages, reviewed metadata, trusted reviewer keys, or
authorization receipts.

## What a receipt binds

A receipt binds an admission decision to exact content and a configured reviewer key;
the [authorization protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md#unsigned-receipt)
defines the fields and signing payload.

Verification proves control of a configured key and authorization of exact canonical
content. Operator policy maps keys to reviewers; Ziggurat does not prove that the signer
was human, attended to the content, or completed a particular review workflow.

## Reporting a vulnerability

Report suspected vulnerabilities privately under
[SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md#reporting-a-vulnerability),
which specifies safe report contents and promises no response-time service level.

## Related

- [Attack-control mapping](./attack-controls.md)
- [Guarantees and residual risks](./guarantees.md)
