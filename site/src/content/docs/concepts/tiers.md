---
title: Bronze, Silver, and Gold
description: What each tier stores, who can write it, and what crossing between tiers requires.
---

Tiers have distinct writers.

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

`ziggurat refine` accepts strict `RefinementDraft` v1 JSON from a loopback endpoint.
The host materializes strict stored Silver v2, validates it against live files, adds local
audit metadata, and atomically persists it under `.ziggurat/proposals/`; the model does
not write the file.

The host supplies bounded, hash-verified reference bytes with source IDs and 1-based lines. It derives quotes, hashes, metadata, and target base state, then validates against live files. See [reference bounds and transport](../security/threat-model.md#security-boundaries-and-capabilities) and the [local protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/local-model-protocol.md). Omitted sources cannot be cited; paths confer no file capability.

Silver candidates **cannot** contain status, reviewer, receipt, or admission metadata.
Targets use lowercase top-level Markdown paths such as `knowledge/topic.md`, which keeps
proposal, contradiction, authorization, and corpus identities identical on
case-sensitive and case-insensitive filesystems.

Knowledge drafts are not Silver. Malformed proposal state fails closed.

## Gold: authorized reference admission

A page enters the Gold index only when every eligibility check passes together:

- reviewed status and retrieval eligibility
- `pii: false`, an allowed sensitivity, and `egress: approved-cloud` (absent egress defaults to `local-only`, which Gold rejects)
- current verification age
- valid, non-empty, hash-verified Bronze lineage
- no unresolved contradiction proposal
- a valid detached Ed25519 receipt from a configured key

Gold bodies are served with CRLF and lone CR normalized to LF, matching the
existing signed canonical representation. This applies to Gold in all three
indexes and never rewrites knowledge or Bronze files. Bronze still normalizes
CRLF only, preserving lone CR in its hashes and citations.

For lone-CR Gold index rebuild requirements and unchanged receipt bytes, see [index compatibility](https://github.com/patschmittdev/Ziggurat/blob/main/docs/retrieval-evaluation.md#gold-body-line-endings-and-index-compatibility).

:::caution[Gold is not a truth label]
Every retrieved chunk carries `content_role: reference` and
`instruction_authority: none`; see [Gold's limits](./provenance-and-authority.md).
:::

## Crossing between tiers

| Transition | Performed by | Requires |
|---|---|---|
| `inbox/` to Bronze | `ingest` | A real regular file physically under `inbox/` |
| Bronze to Silver | Refine host | Strict model draft, host materialization, and live validation of canonical citations against stored Bronze text |
| Silver review to a curated page | Recommended operator workflow | Independent citation review and page authoring; this is not a machine-proven admission prerequisite |
| Curated page to Gold | `build` | A valid configured-key receipt plus every eligibility check |

There is no shipped Silver-to-knowledge apply transition. A page need not originate from
Silver, and running `review` or committing to Git is not a Gold eligibility rule.
Contradiction proposals are no-overwrite artifacts; an eligible page resolves one by
listing its ID in the signed page.

See [ingest and refine](../guides/ingest-and-refine.md).
