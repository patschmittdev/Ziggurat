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
instructs an AI to skip review and to remember a vendor as approved. It is exactly the
kind of document that succeeds against a system where writing memory is an ordinary model
action.

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

## Follow a poisoned memo up the structure

### An untrusted document arrives

Nothing in the capture path treats an inbox file as trustworthy, and nothing about its wording gives it standing.

- `trust level: none`

### Capture preserves it without believing it

ingest is the only writer of Bronze. The source must resolve to a real regular file physically under inbox/; absolute paths, traversal, symlinks, junctions, other reparse points, hard links, and directories are refused before the file is opened, copied, or deleted. The record is no-overwrite and body-hash verified; later mutation is detectable, not prevented.

- `body_sha256 verified`

### A model may draft, and may write nothing else

The host reads Bronze on the model's behalf. Each refine request carries a bounded
reference block of host-selected records: at most 12 records, 32 KiB per record, and
256 KiB in total. Each record is labelled as non-instructional reference, with oversize
records omitted rather than truncated. The model has no filesystem or fetch capability.
It returns a strict `RefinementDraft` v1 with supplied source IDs and line ranges, not
quotes or hashes. The host derives canonical Silver v2 and stages it only after every
citation is revalidated against the real Bronze bytes, hashes, and line ranges.

- `.ziggurat/proposals/<id>.json`
- `no status, reviewer, or receipt fields`
- `unknown source IDs or invalid line ranges fail staging`

### A page that reviews itself changes nothing

A curated page can carry status: reviewed and any reviewer name its author likes. There is no signer, apply, approve, or promote command and no --promote flag, so there is no capability behind the string.

- `reviewed_by is self-asserted metadata`

### An external key crosses the gap

A human reads the review packet, independently verifies the cited Bronze, authors the page by hand, and signs a detached receipt using an Ed25519 private key kept outside the vault and outside model-accessible processes. The receipt binds the decision, the normalized target path, the canonical page digest, the reviewer, the review timestamp, and the trusted key.

- `authorizations/<page>.authorization.json`
- `public key listed in config/trust.yaml`
- `the private key never enters the vault`

### Admission requires every check, not just a signature

build admits a page to Gold only when every check holds: reviewed status, retrieval eligibility, pii: false, an allowed sensitivity, approved egress, current verification age, valid Bronze lineage, no unresolved contradiction, and a valid receipt. Missing or invalid authorization leaves the page out.

- `.ziggurat/gold-index.json`
- `any unmet check fails closed`

### Authorized is still not instruction authority

Shipped MCP startup is Gold-only and read-only, exposing exactly search_context and read_context. Retrieval is bounded to 1024 query characters, 20 results per search, and 200 retained citations per session; reaching the ceiling evicts the oldest citation IDs, which revokes them. Every returned chunk, Gold included, reports content_role: reference and instruction_authority: none.

- `search_context, read_context`
- `instruction_authority: none`

## Next

- [The human authority boundary](../concepts/human-authority-boundary.md) explains what the
  script stops at.
- [Attack-control mapping](../security/attack-controls.md) maps this scenario to the
  memory-poisoning controls it implements.
