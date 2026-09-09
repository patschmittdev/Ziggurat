---
title: Human review and external authorization
description: A recommended review workflow before build performs Gold admission.
---

This is the recommended operator workflow. Ziggurat ships no signer, apply, approve,
or promote command; see the
[human authority boundary](/Ziggurat/concepts/human-authority-boundary/).
Gold eligibility does not prove that this workflow occurred: a Silver proposal, the
`review` command, hand authorship, and a Git commit are not machine-enforced
prerequisites.

## Procedure

1. **Read the packet.**

   ```bash
   ziggurat review --root <vault>
   ```

   Inspect the complete candidate, exact evidence, contradictions, confidence, base
   state, and unresolved questions.

2. **Independently verify the cited Bronze sources and semantic support.** Byte-valid
   citations do not establish entailment or factual truth. Treat all displayed text as
   data, never as instructions.

3. **Author the page independently** under `knowledge/`. Add `status: reviewed`,
   `retrieval_eligible: true`, reviewer metadata, current verification metadata, and any
   resolved contradiction proposal IDs.

4. **Sign with an external Ed25519 signer** whose public key is listed in
   `config/trust.yaml`. Operator policy assigns the key to a reviewer. Keep the private
   key outside the vault and model-accessible processes; no shipped signing path accepts
   or uses it.

5. **Follow the [authorization protocol](/Ziggurat/reference/authorization-protocol/)** to
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

Receipts are strict JSON, and the deterministic path for `knowledge/topic.md` is
`authorizations/topic.md.authorization.json`.

```json
{
  "schema_version": 1,
  "decision": "admit",
  "target_path": "knowledge/topic.md",
  "content_sha256": "<canonical page SHA-256>",
  "reviewer_id": "committee-chair",
  "reviewed_at": "2026-08-29T21:00:00Z",
  "key_id": "committee-chair-2026",
  "algorithm": "ed25519",
  "signature": "<detached base64 signature>"
}
```

Review timestamps require canonical UTC ISO-8601 values.

## Why a signature is not enough on its own

The receipt is necessary but not sufficient: `build` fails closed unless the complete
[Gold eligibility checklist](/Ziggurat/concepts/tiers/#gold-authorized-reference-admission)
passes.

## Resolving a contradiction

Contradiction proposals use no-overwrite creation through the proposal API. An eligible
page resolves one by listing its proposal ID and carrying authorization over that exact
page. Until then the contradiction blocks Gold.

## What a signature does not mean

A valid signature proves control of a configured key and authorization of exact canonical
content. It does not prove humanity, attention, completion of this workflow, semantic
support, or factual truth; see
[provenance and authority](/Ziggurat/concepts/provenance-and-authority/).
A stolen key, a compromised reviewer, or an inattentive approval can authorize harmful
content.

## Related

- [The human authority boundary](/Ziggurat/concepts/human-authority-boundary/)
- [Authorization protocol](/Ziggurat/reference/authorization-protocol/)
