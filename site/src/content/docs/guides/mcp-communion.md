---
title: MCP communion
description: Serve authorized Gold to an AI client over a read-only, communion-only MCP server.
---

```bash
ziggurat mcp --root <vault>
```

Shipped MCP startup is communion-only and read-only. There is no selectable profile, so
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

```text
content_role: reference
instruction_authority: none
```

This is true of every chunk, Gold included.

:::caution[Consumers must honour the label]
Gold approval never grants instruction authority. Approved text can still contain prompt
injection, so a client that treats retrieved content as instructions has stepped outside
the boundary Ziggurat maintains.
:::

## Verification before every read

Stored chunks, labels, lineage, proposal provenance, authorization provenance, BM25 data,
trust policy, and the live corpus are verified at startup and again before both search
and citation reads. A mismatch prevents startup or the next operation rather than
returning a degraded answer.

## Editor binding

The VS Code binding in `.vscode/mcp.json` starts communion without a selectable profile.
Configure model and embedding endpoints only in `config/adapters.yaml`, and only as HTTP
loopback addresses.

## Command-line equivalent

```bash
ziggurat query --root <vault> --query "<text>"
```

`query` reads the same communion index from the terminal.

## Related

- [Isolated indexes](/Ziggurat/concepts/isolated-indexes/)
- [Configuration](/Ziggurat/reference/configuration/)
