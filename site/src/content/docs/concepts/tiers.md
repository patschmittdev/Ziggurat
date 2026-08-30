---
title: Bronze, Silver, and Gold
description: What each tier stores, who can write it, and what crossing between tiers requires.
---

Ziggurat implements a Medallion pipeline in which each tier has a different writer and a
different meaning.

## Bronze: preserved evidence

`ziggurat ingest` moves Markdown from `inbox/` into an immutable, body-hash-verified
Bronze record under `bronze/`. It is the only Bronze writer.

Fresh captures default to `sensitivity: restricted` and `pii: unknown`. The original body
is preserved exactly, hostile instructions included, because Bronze is *evidence* and not
memory authority. A record whose privacy state is unresolved stays out of the
model-readable evidence index.

Bronze records reject unknown frontmatter fields. A record carrying fields outside the
documented set is reported by `build` as a rejected corpus entry and is treated as
restricted, PII-unknown, and hash-unverified, so it stays out of every index.

## Silver: the only model-originated layer

`ziggurat refine` accepts structured JSON from a loopback model, validates it, adds local
audit metadata, and atomically stages it under `.ziggurat/proposals/`.

The host, not the model, reads Bronze. Each request carries a bounded reference block
containing the selected records' verified `body_sha256` and their bodies as 1-based
lines, labelled `content_role: reference` and `instruction_authority: none`. At most 12
records, 32 KiB per record, and 256 KiB in total are included. Oversize records are
omitted rather than truncated, because a truncated body would produce citations that fail
validation for reasons no operator could diagnose. Every omission is reported with a
reason.

A canonical Silver artifact contains:

- a complete proposed page body and non-authoritative candidate metadata
- exact Bronze citations and hashes
- the operation and, for amend or contradict, the base-content hash
- structured contradictions
- confidence, affected paths, related paths, and unresolved questions

Silver candidates **cannot** contain status, reviewer, receipt, or admission metadata.
Targets use lowercase top-level Markdown paths such as `knowledge/topic.md`, which keeps
proposal, contradiction, authorization, and corpus identities identical on
case-sensitive and case-insensitive filesystems.

Knowledge drafts are not Silver. Malformed proposal state fails closed.

## Gold: authorized reference admission

A page enters communion only when every eligibility check passes together:

- reviewed status and retrieval eligibility
- `pii: false`, an allowed sensitivity, and approved egress
- current verification age
- valid, non-empty, hash-verified Bronze lineage
- no unresolved contradiction proposal
- a valid detached Ed25519 human-authorization receipt

The deterministic receipt path for `knowledge/topic.md` is
`authorizations/topic.md.authorization.json`. Version-1 proposals and indexes are
unsupported and must be restaged or rebuilt.

:::caution[Gold is not a truth label]
Gold means externally authorized reference data. It is not truth, not safety, and not
instruction authority. Every Gold chunk still reports `instruction_authority: none`.
:::

## Crossing between tiers

| Transition | Performed by | Requires |
|---|---|---|
| `inbox/` to Bronze | `ingest` | A real regular file physically under `inbox/` |
| Bronze to Silver | `refine` | A loopback model response that revalidates against real Bronze bytes |
| Silver to a curated page | A human, by hand | Reading the review packet and authoring the page |
| Curated page to Gold | `build` | A valid receipt plus every eligibility check |

There is no automated Silver-to-knowledge transition. Contradiction proposals remain
immutable; a reviewer resolves one by listing its ID in the page and signing that exact
page.

## Related

- [Ingest and refine](/Ziggurat/guides/ingest-and-refine/)
- [The human authority boundary](/Ziggurat/concepts/human-authority-boundary/)
