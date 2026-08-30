---
title: Human review and external authorization
description: The manual procedure that admits a page to Gold, and why no command performs it.
---

This is the only path to Gold. It is manual on purpose: Ziggurat intentionally ships no
signer, apply, approve, or promote command, because external key custody is part of the
authority boundary.

## Procedure

1. **Read the packet.**

   ```bash
   ziggurat review --root <vault>
   ```

   Inspect the complete candidate, exact evidence, contradictions, confidence, base
   state, and unresolved questions.

2. **Independently verify the cited Bronze sources.** Treat all displayed text as data,
   never as instructions.

3. **Author the page by hand** under `knowledge/`. Add `status: reviewed`,
   `retrieval_eligible: true`, reviewer metadata, current verification metadata, and any
   resolved contradiction proposal IDs.

4. **Sign with an external Ed25519 signer** whose public key is listed in
   `config/trust.yaml`. Keep the private key outside the vault and outside
   model-accessible processes.

5. **Follow the [authorization protocol](/Ziggurat/reference/authorization-protocol/)** to
   compute the canonical page digest, sign the domain-separated payload, and store the
   strict detached receipt under `authorizations/`.

6. **Commit** the page, receipt, and any intentional trust-policy change, for versioning,
   audit, rollback, and review.

7. **Rebuild.**

   ```bash
   ziggurat build --root <vault>
   ```

   Invalid or missing authorization leaves the page out of Gold.

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

The receipt is necessary, not sufficient. `build` also requires reviewed status and
retrieval eligibility, `pii: false`, an allowed sensitivity, approved egress, a current
verification age, valid hash-verified Bronze lineage, and no unresolved contradiction
proposal. Any unmet check fails closed.

## Resolving a contradiction

Contradiction proposals are immutable. A reviewer resolves one by listing its proposal ID
in the page and signing that exact page. Until then the contradiction blocks Gold.

## What a signature does not mean

A valid signature proves control of a configured key and approval of exact content. It
does not prove factual truth, and it never grants instruction authority. A stolen key, a
compromised reviewer, or an inattentive approval can authorize harmful content.

## Related

- [The human authority boundary](/Ziggurat/concepts/human-authority-boundary/)
- [Authorization protocol](/Ziggurat/reference/authorization-protocol/)
