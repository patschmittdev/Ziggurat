---
title: Provenance, authorization, and instruction authority
description: Three claims that look similar, must never be conflated, and are handled separately.
---

Most memory-poisoning incidents depend on one of three claims quietly standing in for
another. Ziggurat keeps them apart by name.

## 1. Provenance

**Claim:** these citation bytes match canonical text stored in Bronze.

Established by Bronze body hashes, exact citation paths, line ranges, quotes, and quote
hashes, plus Gold lineage to listed Bronze records. Ingest decodes UTF-8 and normalizes
CRLF to LF before hashing; this is not raw source-byte identity. A fabricated quote,
digest, or line range fails staging against the stored files.

Provenance says nothing about whether the captured source was honest, whether a citation
semantically supports a candidate, or whether a claim is factual. Canonically preserving
a lie does not make it true.

## 2. Persistence authorization

**Claim:** a signer controlling a configured key authorized this exact page.

Established by a detached Ed25519 receipt verified against a public key in
`config/trust.yaml`, with the fields defined in the
[authorization protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/authorization-protocol.md#unsigned-receipt).

Authorization says nothing about factual truth, humanity, attention, or review quality.
It records that a configured key signed a decision about specific canonical content at a
specific time; operator policy maps that key to a reviewer.

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

Gold is externally authorized reference data, not a truth or safety label, divine
authority, or proof of human review. A client that treats retrieved content as
instructions steps outside the boundary Ziggurat maintains.

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
