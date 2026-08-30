---
title: Provenance, authorization, and instruction authority
description: Three claims that look similar, must never be conflated, and are handled separately.
---

Most memory-poisoning incidents depend on one of three claims quietly standing in for
another. Ziggurat keeps them apart by name.

## 1. Provenance

**Claim:** these bytes match captured evidence.

Established by Bronze body hashes, exact citation paths, line ranges, quotes, and quote
hashes, plus Gold lineage back to the Bronze records a page was built from. A fabricated
quote, digest, or line range fails staging against the real files on disk.

Provenance says nothing about whether the captured source was honest. A perfectly
preserved lie is still a lie, and Bronze is designed to preserve it exactly.

## 2. Persistence authorization

**Claim:** a configured reviewer key approved this exact page.

Established by a detached Ed25519 receipt verified against a public key in
`config/trust.yaml`. The receipt binds the decision, the normalized target path, the
SHA-256 of the canonical semantic page content, the reviewer ID, the review timestamp,
and the trusted key ID.

Authorization says nothing about factual truth. It records that a specific key holder
accepted specific bytes at a specific time.

## 3. Instruction authority

**Claim:** this text may direct a model or a tool.

Ziggurat always sets this to **none**. Every stored chunk and every retrieved result,
Gold included, reports:

```text
content_role: reference
instruction_authority: none
```

Consumers must honour that label. Approved text can still contain prompt injection, and
approval never converts reference data into a command.

## Why the separation matters

| If you conflate | You get |
|---|---|
| Provenance with truth | A faithfully preserved falsehood treated as fact |
| Authorization with truth | A signature read as a correctness guarantee |
| Authorization with instruction authority | A reviewed page that can direct an agent |

Ziggurat implements the first two claims and refuses the third. The refusal is not a
default that a configuration flag can relax.

## Related

- [Security guarantees and residual risks](/Ziggurat/security/guarantees/)
- [SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md)
