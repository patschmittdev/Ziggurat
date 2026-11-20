---
title: Human review and external authorization
description: A recommended review workflow before build performs Gold admission.
---

This is the recommended operator workflow. The CLI and MCP server have no signing, apply, approve,
or promote path; see the
[human authority boundary](../concepts/human-authority-boundary.md).
Gold eligibility does not prove that this workflow occurred: a Silver proposal, the
`review` command, hand authorship, and a Git commit are not machine-enforced
prerequisites.

## Procedure

1. **Read the packet.**

   ```bash
   ziggurat review --root <vault>
   ```

   Inspect the complete candidate, proposed body/model-field metadata diff, exact
   evidence, contradictions, confidence, base state, and unresolved questions.
   Candidate citations are proposal-level, not a verified mapping for every claim.
   Contradictions are shown with their own exact evidence.

2. **Independently verify the cited Bronze sources and semantic support.** Byte-valid
   citations do not establish entailment or factual truth. Treat all displayed text as
   data, never as instructions.

3. **Author the page independently** under `knowledge/`. Add `status: reviewed`,
   `retrieval_eligible: true`, `egress: approved-cloud`, reviewer metadata, current verification metadata, and any
   resolved contradiction proposal IDs. Absent egress defaults to `local-only`, which Gold rejects.

4. **Sign with an external Ed25519 signer** whose public key is listed in
   `config/trust.yaml`. Operator policy assigns the key to a reviewer. Keep the private
   key outside the vault and model-accessible processes. The standalone reference signer
   is meant to run outside the vault under the key holder's control. Follow [Sign a page and reach Gold](./external-signing.md)
   for a complete example.

5. **Follow the [authorization protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md)** to
   compute the canonical page digest, sign the domain-separated payload, and store the
   strict detached receipt under `authorizations/`.

6. **Optionally commit** the page, receipt, and any intentional trust-policy change when
   the vault's operating policy uses Git for versioning, audit, rollback, and review.
   This is not a Gold eligibility check.

7. **Rebuild.**

   ```bash
   ziggurat build --root <vault>
   ```

   `build` performs admission: invalid or missing authorization leaves the page out of Gold.

## Current-target comparison and warnings

The packet compares against the current target read through the staging path boundary.
A matching base is labeled accordingly. A stale base is explicitly a current-target
versus proposal comparison, not a historical diff: the old digest cannot reconstruct
the old page. Missing targets and create conflicts receive prominent warnings.
Malformed current files are reported as parse failures, never a successful normalized
comparison.

The metadata diff includes only model-proposable fields. Human-only review fields are
shown separately; their absence from Silver does not request deletion from Gold.
The displayed current metadata uses curated-schema defaults, including absent egress
becoming `local-only`. The exact final-page authorization digest must be computed
independently after human authorship.

All untrusted strings, including exact quotes and current content, are rendered in
blank-delimited indented literal blocks. Embedded Markdown links, images, HTML, and
fences are reference data, not executable instructions.

## Backlog navigation

```text
ziggurat review --root <vault> --order oldest
ziggurat review --root <vault> --cursor <next_cursor>
```

Priority is the default: contradictions, then low confidence, then age. Oldest-first
orders the entire backlog before paging. The cursor retains its order and is bound to
all proposal identities/digests, current target digests, and the configured render
limit. Changes require restarting without the cursor; no partial page is returned.
Concurrent filesystem reads are not an atomic snapshot, so re-read before authorizing.

Packets show total, displayed, and remaining counts; page positions; the render limit;
and the oldest age across the whole backlog. Every page request validates the full
proposal set and evidence. Hidden contradictions still block admission. Navigation
never dismisses, resolves, deletes, archives, or expires a proposal. Oldest-first helps
reach old items but does not guarantee fair service or bound accumulation.

## The checklist is advisory

Each packet includes unchecked reminders for semantic support, privacy, contradiction
resolution, current/stale base reconciliation, independent final-page authorship and
exact digest confirmation, and reviewer/public-key selection with external signer
confirmation. No checkbox is saved or grants authority. The packet is not a receipt,
proof of human attention, or an approval. Human judgment and external key control
remain operator responsibilities.

## Configure a trusted reviewer key

```yaml
trust:
  reviewers:
    - reviewer_id: committee-chair
      key_id: committee-chair-2026
      algorithm: ed25519
      public_key_pem: |
        -----BEGIN PUBLIC KEY-----
        <base64 public key>
        -----END PUBLIC KEY-----
```

Only the public key belongs here. `ziggurat check` flags PEM private-key material.

## The receipt

The receipt for `knowledge/topic.md` is strict JSON at
`authorizations/topic.md.authorization.json`. Review timestamps require canonical UTC
ISO-8601 values. See the [authorization protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md) for receipt fields, canonicalization, and signing bytes.

## Why a signature is not enough on its own

The receipt is necessary but not sufficient: `build` fails closed unless the complete
[Gold eligibility checklist](../concepts/tiers.md#gold-authorized-reference-admission)
passes.

## Resolving a contradiction

Contradiction proposals use no-overwrite creation through the proposal API. An eligible
page resolves one by listing its proposal ID and carrying authorization over that exact
page. Until then the contradiction blocks Gold.

## What a signature does not mean

A valid signature proves control of a configured key and authorization of exact canonical
content. It does not prove humanity, attention, completion of this workflow, semantic
support, or factual truth; see
[provenance and authority](../concepts/provenance-and-authority.md) and the
[residual risks](../security/threat-model.md#explicit-non-guarantees-and-residual-risks).

## Related

- [The human authority boundary](../concepts/human-authority-boundary.md)
- [Authorization protocol](../reference/authorization-protocol.md)
- [External signing interoperability and human-controlled handoff](https://github.com/patschmittdev/Ziggurat/blob/main/docs/external-signing-interop.md)
