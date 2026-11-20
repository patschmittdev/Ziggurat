---
title: Run Ziggurat with models and agents
description: Separate proposal, reading, operation, and signing capabilities.
---

A trusted key's signature controls Gold admission. A model, a reading agent, and
an operating agent have different capabilities. Keep signing separate from all
three. A receipt does not prove who used the key or what they read.

## The proposing model

`refine` calls only a loopback, non-streaming llama.cpp-style endpoint. Configure
the complete endpoint URL and optional model alias in `config/adapters.yaml`:

```yaml
adapters:
  model_endpoint: http://127.0.0.1:18080/v1/chat/completions
  model_name: ziggurat-refine
```

The model receives serialized reference data. It gets no tools, file access, or
signing capability through this pathway. The host validates returned proposals
and writes only Silver. The
[local model protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/local-model-protocol.md)
documents the pinned setup, transport limits, and pending model qualification.

## A reading agent

Any MCP client that supports stdio servers can start `node <checkout>/dist/src/cli/main.js mcp --root <vault>`. The server is read-only and
Gold-only. It exposes exactly two tools: `search_context` and `read_context`.
This JSON is one client's shape; key names vary by client. Replace paths with absolute paths:

```json
{
  "servers": {
    "ziggurat-gold": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/path/to/checkout/dist/src/cli/main.js",
        "mcp",
        "--root",
        "/path/to/vault"
      ]
    }
  }
}
```

Results carry `instruction_authority: none`. Gold can still contain prompt
injection; clients must treat it as reference data. The [Gold MCP guide](./mcp-gold.md)
explains session bounds and live verification before search and citation reads.

## An operating agent

An operator can let an agent run `ingest`, `refine`, `review`, `build`, `check`,
and `query`. These commands do not grant signing capability. The critical question
is what else that agent can reach.

It must never reach:

- The private key or a signing environment that holds it. The signer source alone grants nothing.
- Write access to `config/trust.yaml`. An attacker who replaces trust configuration
  and rebuilds can create a new trust root.

It should not reach write access to `authorizations/` or `knowledge/`. Without a
trusted key it cannot create valid authorization for changed page content, but it
can delete receipts, alter pages, and force exclusion. It can also restore an earlier
signed page with its earlier receipt, re-admitting superseded text without the key,
bounded by the 90-day `last_verified` age rule and `review_after`. Corruption and policy changes
can cause fail-closed denial of service. Existing Gold may still contain hostile
instructions. A signature does not detect semantic deception.

Tool-permission rules inside an agent harness are not an OS boundary. Use OS-level
separation, such as a separate user, a container, or read-only mounts. Apply those
restrictions to every process and shell the agent can invoke. A separate directory
alone is insufficient. The [threat model](../security/threat-model.md) describes
these operator assumptions and residual tampering and availability risks.

## Receipts or signed commits?

If agents never have write access to the vault and every merge is reviewed by a
person, signed commits plus branch protection may be enough for the operator's
workflow. Receipts do not prove attention or improve semantic review.

Receipts add a per-page admission check when agents or automation can write the
vault, when admission must be checked at build and read time, or when Gold is
consumed outside the Git host. Ziggurat verifies the exact current page against a
configured key without using Git as the admission signal. It does not verify
branch protection or commit signatures. Receipts add no OS isolation and do not
protect against an agent that can replace the trust root or use the signing key.

The standalone reference signer displays every signed field, including defaults,
then the target path, key ID, full digest and numbered body before confirmation.
