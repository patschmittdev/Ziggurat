# Authorization Protocol

## Status

This document specifies authorization receipt version 1 for Ziggurat 0.1.x. The
project is pre-release, so future versions may introduce a new receipt or
canonicalization version rather than changing version 1 in place.

The protocol lets an external human-controlled signer authorize one exact knowledge
page for Gold admission. Ziggurat verifies signatures but intentionally ships no
signing, approval, apply, or promotion command.

## Trust model

- Reviewer private keys stay outside the vault and model-accessible processes.
- `config/trust.yaml` contains only Ed25519 public keys.
- A valid receipt proves that a configured key signed the exact canonical page.
- A valid receipt does not prove factual truth or reviewer attention; see
  [provenance and authority](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/concepts/provenance-and-authority.md).
- Every retrieved chunk carries `content_role: reference` and
  `instruction_authority: none`.

## Trusted reviewer configuration

Each reviewer entry is strict and must have a unique reviewer ID and key ID:

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

The PEM must encode an Ed25519 public key and end with a newline.

## Canonical page digest

For target path `knowledge/topic.md`, parse the page frontmatter with
`CuratedPageSchema`, normalize the body from CRLF or CR to LF, and serialize the
following object as compact UTF-8 JSON:

```json
{
  "domain": "ziggurat-curated-page-v1",
  "target_path": "knowledge/topic.md",
  "page": {
    "schema_version": 1,
    "title": "<title>",
    "type": "<type>",
    "sources": ["<ordered source paths>"],
    "confidence": "<high|medium|low>",
    "status": "<status>",
    "retrieval_eligible": true,
    "pii": "<state>",
    "sensitivity": "<state>",
    "visibility": "<visibility>",
    "egress": "<local-only|approved-cloud>",
    "reviewed_by": "<reviewer ID or null>",
    "reviewed_at": "<UTC timestamp or null>",
    "last_verified": "<UTC timestamp or null>",
    "review_after": "<UTC timestamp or null>",
    "resolved_proposals": ["<ordered proposal IDs>"]
  },
  "body": "<LF-normalized body>"
}
```

Property order is exactly the order shown. Preserve array order. Use `null` for
absent optional scalar fields and `[]` for absent `resolved_proposals`. Do not append
a newline to the compact JSON. The receipt's `content_sha256` is the lowercase
hexadecimal SHA-256 digest of these UTF-8 bytes.

`visibility` is uninterpreted operator metadata. It is included in the signed bytes
so a reviewer approves the exact label a page carries, but Ziggurat enforces no
access control from it. Retrieval eligibility is decided by `status`,
`retrieval_eligible`, `pii`, `sensitivity`, `egress`, verification age, lineage,
contradictions, and the receipt. Do not treat `visibility` as a permission.

The authoritative implementation is
[`canonicalPageContent`](../src/authorization/canonical.ts).

## Receipt path

The receipt path is deterministic:

```text
knowledge/topic.md
authorizations/topic.md.authorization.json
```

Only lowercase, top-level Markdown paths under `knowledge/` are accepted.

## Unsigned receipt

Construct this strict object:

```json
{
  "schema_version": 1,
  "decision": "admit",
  "target_path": "knowledge/topic.md",
  "content_sha256": "<canonical page digest>",
  "reviewer_id": "committee-chair",
  "reviewed_at": "2026-08-29T21:00:00Z",
  "key_id": "committee-chair-2026",
  "algorithm": "ed25519"
}
```

`reviewer_id` and `reviewed_at` must exactly match the knowledge page. The reviewer
and key pair must exist in `config/trust.yaml`.

## Signing payload

Serialize the following object as compact UTF-8 JSON with properties in this exact
order and no trailing newline:

```json
{
  "domain": "ziggurat-authorization-receipt-v1",
  "schema_version": 1,
  "decision": "admit",
  "target_path": "knowledge/topic.md",
  "content_sha256": "<canonical page digest>",
  "reviewer_id": "committee-chair",
  "reviewed_at": "2026-08-29T21:00:00Z",
  "key_id": "committee-chair-2026",
  "algorithm": "ed25519"
}
```

Sign these bytes directly with Ed25519. Encode the 64-byte signature as canonical
base64. Add it as the final `signature` field in the persisted receipt. The
authoritative implementation is
[`authorizationSigningPayload`](../src/authorization/canonical.ts).

## Verification

Gold admission verifies all of the following:

1. The receipt exists at the deterministic path and passes the strict schema.
2. Its target path matches the knowledge page.
3. Its content digest matches the current canonical page.
4. Its reviewer identity and timestamp match the page metadata.
5. Its reviewer and key IDs select a configured Ed25519 public key.
6. Its signature is canonical base64 containing exactly 64 bytes.
7. Its Ed25519 signature verifies over the domain-separated signing payload.
8. Every other Gold eligibility rule also passes.

Any failure leaves the page out of Gold. Trust-policy, receipt, page, or corpus
changes also invalidate existing indexes until they are rebuilt.

## Interoperability test vectors

[`fixtures/authorization/receipt-vectors.json`](../fixtures/authorization/receipt-vectors.json)
is a deterministic vector file for independent signer implementations. It contains:

- `page.frontmatter` and `page.body`, plus the exact `page.canonical_page_content`
  string and its `page.canonical_page_content_sha256` digest
- `page.receipt_path`, the deterministic receipt location
- `signing.unsigned_receipt`, the exact `signing.signing_payload` string, and its
  base64 encoding
- `trusted_reviewer.public_key_pem` and the detached `signing.signature`
- `cases[]`, each with a page body, a receipt, the trust policy to load, and the
  expected `{ valid, reasons }` verification result

No private key material is published. Verification, which is the only operation
Ziggurat performs, needs only the public key. A signer implementation is conformant
when it reproduces `canonical_page_content`, `content_sha256`, and `signing_payload`
byte for byte from the frontmatter and body alone, and when its own signature over
that payload verifies against the published public key.

`test/authorization-vectors.test.ts` runs every case against the shipped verifier, so
the vectors and the implementation cannot drift apart silently.

## Rotation and revocation

To rotate a key, add a new unique key ID, sign future receipts with it, and retain the
old public key only while old receipts should remain valid. Removing a key revokes
all receipts that depend on it after the next verification or rebuild.

To revoke one page, remove or replace its receipt or change the page so the receipt
no longer matches, then commit the change and rebuild. To correct a page, update its
review metadata, create a new receipt over the new canonical content, commit both,
and rebuild.

## External signer checklist

- Keep private key generation, storage, and signing outside the vault.
- Present the exact page digest, target path, reviewer ID, and timestamp to the human.
- Require an explicit human confirmation before signing.
- Never expose the signer as an MCP tool or model-callable command.
- Write only the strict detached receipt, then let Ziggurat verify it independently.
- Test LF and CRLF inputs and reject unknown fields or unsupported algorithms.
