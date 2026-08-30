---
title: The human authority boundary
description: Why Ziggurat's review step is a cryptographic capability rather than a workflow convention.
---

Most review steps are conventions. Someone is supposed to look, someone is supposed to
approve, and the system records that they said they did. A convention fails silently: it
holds exactly as long as everybody follows it, and nothing detects the moment they stop.

Ziggurat's boundary is a capability. Gold admission requires a detached Ed25519 receipt
produced by a private key that no shipped code path can reach.

## What does not exist

The boundary is defined as much by absence as by enforcement:

- No `signer` command.
- No `apply`, `approve`, or `promote` command.
- No `--promote` flag on any command.
- No function in the shipped codebase that writes knowledge pages, reviewed metadata,
  trusted reviewer keys, or authorization receipts.

`init` can create an *empty* trust policy, but it never adds or replaces a key. `build`
can write generated indexes, but Gold construction requires a valid receipt, so running
`build` is not an admission capability.

## Why a string is not authority

A curated page can carry `status: reviewed` and `reviewed_by: alice`. Anything that can
write the page can write those fields, so they record a claim rather than establishing
one. Ziggurat treats them as uninterpreted metadata.

A receipt is different in kind. It is a detached signature over a canonical
representation of the exact page, verified against a public key that a human placed in
`config/trust.yaml`. Producing one requires the corresponding private key.

## What the key holder is actually asserting

A valid signature proves two things and no more:

1. Someone controlling a configured private key made a decision.
2. That decision was about *this exact content*, because the page digest is inside the
   signed payload.

It does not prove the content is true, safe, complete, or well-judged. See
[Provenance, authorization, and instruction authority](/Ziggurat/concepts/provenance-and-authority/).

## Where the key lives

Outside the vault, and outside model-accessible processes. Key custody is deliberately
not a feature: the reference implementation provides no signer, no hardware key storage,
no revocation service, and no hosted identity. Those are the operator's responsibility,
and keeping them outside the tool is what makes the boundary non-delegable.

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
