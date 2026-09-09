---
title: The human authority boundary
description: Why Ziggurat's review step is a cryptographic capability rather than a workflow convention.
---

Most review steps are conventions. Someone is supposed to look, someone is supposed to
approve, and the system records that they said they did. A convention fails silently: it
holds exactly as long as everybody follows it, and nothing detects the moment they stop.

Ziggurat's authorization boundary is a capability. Gold admission requires a detached
Ed25519 receipt produced by a key configured in the operator's trust policy. No shipped
signing path accepts or uses a private key.

A receipt is different in kind. It is a detached signature over a canonical
representation of the exact page, verified against a public key in `config/trust.yaml`.
Operator policy assigns that key to a reviewer. Producing a receipt requires control of
the corresponding private key.

## What does not exist

The boundary is defined as much by absence as by enforcement:

- No `signer` command.
- No `apply`, `approve`, or `promote` command.
- No `--promote` flag on any command; it must remain rejected and must not be added.
- No function in the shipped codebase that writes knowledge pages, reviewed metadata,
  trusted reviewer keys, or authorization receipts.

`init` can create an *empty* trust policy, but it never adds or replaces a key. `build`
performs admission by writing eligible chunks to generated indexes, but it cannot create
the prerequisite external authorization. Running `build` alone cannot authorize a page.

## Why a string is not authority

A curated page can carry `status: reviewed` and `reviewed_by: alice`. Anything that can
write the page can write those fields, so they record a self-asserted claim rather than
establishing one. Ziggurat validates and binds them to the receipt, but they remain
insufficient without valid external authorization.

## What the key holder is actually asserting

A valid signature proves two things and no more:

1. The signer controlled the private key corresponding to a configured public key.
2. The signed decision was about *this exact content*, because the page digest is inside the
   signed payload.

It does not prove that the signer was human, attended to the page, followed the recommended
review workflow, or judged semantic support correctly. It also does not prove the content
is true, safe, complete, or well-judged. See
[Provenance, authorization, and instruction authority](/Ziggurat/concepts/provenance-and-authority/).

## Where the key lives

Operator policy requires private keys to remain outside the vault and model-accessible
processes. Key custody is deliberately not a feature: the reference implementation
provides no signer, hardware key storage, revocation service, or hosted identity. The
signing capability is not delegated through shipped refine or MCP interfaces.

:::caution[The boundary has an inside]
An AI process granted arbitrary shell, filesystem, or reviewer-key access is inside the
operator trust assumption. It can act with whatever authority the operator delegated to
it. Ziggurat bounds what its own code paths can do; it cannot bound what you hand to
something else.
:::

## Related

- [Human review and external authorization](/Ziggurat/guides/human-review-and-authorization/)
- [Authorization protocol](/Ziggurat/reference/authorization-protocol/)
- [ARCHITECTURE.md](https://github.com/patschmittdev/Ziggurat/blob/main/ARCHITECTURE.md)
