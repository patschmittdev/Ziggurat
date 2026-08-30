---
title: Authorization protocol
description: Orientation to the byte-level signing contract, with the canonical specification linked.
---

:::caution[The specification is canonical, this page is not]
The byte-exact contract lives in
[docs/authorization-protocol.md](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md).
Implement a signer against that document, never against this summary. Nothing here
redefines a byte.
:::

## What the protocol covers

| Section | What it defines |
|---|---|
| Status | The protocol version and its stability posture |
| Trust model | What a signature proves, and what it does not |
| Trusted reviewer configuration | The `config/trust.yaml` entry shape |
| Canonical page digest | The exact bytes hashed to identify a page |
| Receipt path | The deterministic location of a receipt |
| Unsigned receipt | The receipt fields before a signature is applied |
| Signing payload | The domain-separated bytes actually signed |
| Verification | The order and strictness of verification steps |
| Interoperability test vectors | Fixtures an independent signer can check against |
| Rotation and revocation | How key changes are handled |
| External signer checklist | What an implementer must get right |

## The shape of a receipt

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

The deterministic receipt path for `knowledge/topic.md` is
`authorizations/topic.md.authorization.json`.

## Why canonicalization exists

The canonical page representation uses parsed fields in a fixed order and an
LF-normalized body, so the same page produces the same digest on Windows, macOS, and
Linux. Review timestamps require canonical UTC ISO-8601 values. The signing payload is
domain separated so a signature over one kind of object cannot be replayed as another.

Changes to signed bytes require a new protocol version rather than an in-place
reinterpretation.

## Test vectors

`fixtures/authorization/receipt-vectors.json` publishes interoperability vectors. An
independent signer should reproduce them before being trusted with a real key. The
TypeScript implementation remains the authoritative verifier.

## Related

- [Human review and external authorization](/Ziggurat/guides/human-review-and-authorization/)
- [The human authority boundary](/Ziggurat/concepts/human-authority-boundary/)
