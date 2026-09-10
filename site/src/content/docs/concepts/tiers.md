---
title: Bronze, Silver, and Gold
description: What each tier stores, who can write it, and what crossing between tiers requires.
---

Ziggurat implements a Medallion pipeline in which each tier has a different writer and a
different meaning.

## Bronze: preserved evidence

`ziggurat ingest` decodes inbox Markdown as UTF-8, normalizes CRLF to LF, and stores the
canonical text in a Bronze record under `bronze/`. It is the only Bronze writer and uses
atomic no-overwrite creation. SHA-256 verification detects later body mutation; it does
not make the filesystem physically immutable or prove that the source was honest.

Fresh captures default to `sensitivity: restricted` and `pii: unknown`. The original body
is preserved as canonical text, hostile instructions included, because Bronze is
*evidence* and not memory authority. A record whose privacy state is unresolved stays out of the
model-readable evidence index.

Bronze records reject unknown frontmatter fields. A record carrying fields outside the
documented set is reported by `build` as a rejected corpus entry and is treated as
restricted, PII-unknown, and hash-unverified, so it stays out of every index.

## Silver: the only model-originated layer

`ziggurat refine` accepts model-originated structured JSON from a loopback endpoint. The
host validates it, adds local audit metadata, and atomically persists it under
`.ziggurat/proposals/`; the model does not write the file.

The host, not the model, reads Bronze. Each request carries a bounded reference block
containing the selected records' verified `body_sha256` and their canonical bodies as
1-based lines, labelled `content_role: reference` and `instruction_authority: none`. At most 12
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

A page enters the Gold index only when every eligibility check passes together:

- reviewed status and retrieval eligibility
- `pii: false`, an allowed sensitivity, and approved egress
- current verification age
- valid, non-empty, hash-verified Bronze lineage
- no unresolved contradiction proposal
- a valid detached Ed25519 receipt from a configured key

The deterministic receipt path for `knowledge/topic.md` is
`authorizations/topic.md.authorization.json`. Version-1 proposals and indexes are
unsupported and must be restaged or rebuilt.

:::caution[Gold is not a truth label]
Every retrieved chunk carries `content_role: reference` and
`instruction_authority: none`; see [Gold's limits](./provenance-and-authority.md).
:::

## Crossing between tiers

| Transition | Performed by | Requires |
|---|---|---|
| `inbox/` to Bronze | `ingest` | A real regular file physically under `inbox/` |
| Bronze to Silver | Refine host | Model-originated JSON whose citations revalidate against stored Bronze text |
| Silver review to a curated page | Recommended operator workflow | Independent citation review and page authoring; this is not a machine-proven admission prerequisite |
| Curated page to Gold | `build` | A valid configured-key receipt plus every eligibility check |

There is no shipped Silver-to-knowledge apply transition. A page need not originate from
Silver, and running `review` or committing to Git is not a Gold eligibility rule.
Contradiction proposals are no-overwrite artifacts; an eligible page resolves one by
listing its ID in the signed page.

## Related

- [Ingest and refine](../guides/ingest-and-refine.md)
- [The human authority boundary](./human-authority-boundary.md)
