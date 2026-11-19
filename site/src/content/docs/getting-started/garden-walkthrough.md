---
title: The garden walkthrough
description: Prepare a fixture vault, ingest its sources, and print the manual steps that remain.
---

The repository ships fixture inputs and a script that initializes a vault, ingests those
files as Bronze, and prints the remaining manual steps.

```bash
node scripts/run-garden-walkthrough.mjs
```

The script does not stage Silver, render review, create a page or receipt, build indexes,
or query Gold. No shipped path creates authorization, signs a receipt, or applies Silver
to knowledge.

## What the fixture contains

`fixtures/garden/inbox/poisoned-memory-rule.md` is a plausible-looking memo that
instructs an AI to skip review and to remember a vendor as approved. It illustrates
the risk when untrusted content can enter durable memory through ordinary model
writes; this fixture is not evidence of a successful attack against another product.

That material is described here, never reproduced. Nothing on this site quotes the
hostile instruction text, and nothing retrieved through Ziggurat carries instruction
authority in any case.

## What the end-to-end automated test demonstrates

Unlike the preparation script, `test/memory-boundary.test.ts` exercises the complete
boundary:

1. Ingestion preserves the hostile text as restricted, PII-unknown Bronze evidence.
2. A test helper stages a Silver candidate with byte-valid citations and writes no
   knowledge, authorization, Bronze, or index file.
3. `review` displays the embedded instruction under an `UNTRUSTED REFERENCE` warning.
4. The poisoned Bronze record is excluded from model-readable evidence and review indexes
   while its privacy state is unresolved.
5. A knowledge page carrying self-asserted reviewed metadata does not change the Gold index.
6. The Gold index changes only after the test simulates an external reviewer key and writes a
   matching receipt.
7. Retrieved Gold still reports no instruction authority.
8. Tampering with the stored index causes retrieval to fail closed.

Step 6 simulates control of a configured reviewer key using a test-only helper. That
demonstrates the cryptographic check, not a human identity, attention, or review process.

## Run it yourself

```bash
npm ci
npm run build
npm run check
node scripts/run-garden-walkthrough.mjs
```
`npm run check` runs the full compiled suite, including the end-to-end memory-boundary
test. The final command separately prepares the fixture vault and prints manual next
steps.

## Continue manually

Use [ingest and refine](../guides/ingest-and-refine.md) to stage a proposal, then follow [human review and external authorization](../guides/human-review-and-authorization.md). Review every claim and its evidence, independently author the page, and sign externally. Neither running review nor committing to Git authorizes Gold.

See [tiers](../concepts/tiers.md) for eligibility and compatibility rules and the [threat model](../security/threat-model.md) for source, transport, retrieval bounds, and residual risks.
