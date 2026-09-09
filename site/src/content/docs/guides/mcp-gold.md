---
title: Gold MCP
description: Serve authorized Gold to an AI client over a read-only, Gold-only MCP server.
---

```bash
ziggurat mcp --root <vault>
```

Shipped MCP startup is Gold-only and read-only. There is no selectable profile, so
review and evidence cannot be reached through it.

## Tools

The server exposes exactly two tools:

| Tool | Purpose |
|---|---|
| `search_context` | Search authorized Gold and return citation-scoped results |
| `read_context` | Read a previously returned citation by ID |

Tool inputs are strict.

## Bounds

| Bound | Value |
|---|---|
| Query length | 1,024 UTF-16 code units |
| Results per search | 20 |
| Retained citations per session | 200 |

Over-long queries are refused rather than truncated. When the citation ceiling is
reached, the oldest citation IDs are evicted and become invalid: a read against an
evicted ID fails closed with the same error as a forged ID.

## What every result says

Every retrieved chunk carries `content_role: reference` and
`instruction_authority: none`.

:::caution[Consumers must honour the label]
Approved text can still contain prompt injection; see
[provenance and authority](/Ziggurat/concepts/provenance-and-authority/).
:::

## Verification before every read

Stored chunks, labels, lineage, proposal provenance, authorization provenance, BM25 data,
trust policy, and the live corpus are verified at startup and again before both search
and citation reads. A mismatch prevents startup or the next operation rather than
returning a degraded answer.

## Editor binding

The VS Code binding in `.vscode/mcp.json` starts the Gold MCP server without a selectable profile.
Configure model and embedding endpoints only in `config/adapters.yaml`, and only as HTTP
loopback addresses.

## Command-line equivalent

```bash
ziggurat query --root <vault> --query "<text>"
```

`query` reads the same Gold index from the terminal.

## Related

- [Isolated indexes](/Ziggurat/concepts/isolated-indexes/)
- [Configuration](/Ziggurat/reference/configuration/)
