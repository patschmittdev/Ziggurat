---
title: Configuration and selected limits
description: Configuration files, their allowed keys, and security-relevant shipped CLI limits.
---

Configuration lives in `config/` and is validated strictly. Unknown keys are rejected at
the top level **and** inside every nested object, so a typo such as `default_sensitvity`
fails to load rather than being silently ignored.

YAML anchors, aliases, explicit type tags, and tab characters are rejected outright.

## `config/ziggurat.yaml`

```yaml
schema_version: 1
lifecycle:
  review_queue_limit: 50
```

| Key | Type | Notes |
|---|---|---|
| `schema_version` | literal `1` | Required |
| `lifecycle.review_queue_limit` | integer, minimum 1 | Required |

The repository configuration uses `50`. A fresh vault created by `ziggurat init` starts
at `20`. The configured value limits how many entries `review` renders.

## `config/domain.yaml`

```yaml
domain:
  page_types:
    - entity
    - concept
    - comparison
    - query
    - decision
    - reference
  tags:
    - ai
    - architecture
    - infrastructure
    - product
    - personal
    - workflow
    - security
    - performance
```

`page_types` and `tags` are non-empty lists of non-empty strings.

## `config/privacy.yaml`

```yaml
privacy:
  default_sensitivity: restricted
  default_pii: unknown
```

Both values are literals. Fresh captures are restricted and PII-unknown, and stay out of
the model-readable evidence index until a human resolves them.

## `config/adapters.yaml`

```yaml
adapters: {}
```

| Key | Type | Notes |
|---|---|---|
| `adapters.model_endpoint` | URL, optional | HTTP loopback only |

Retrieval is lexical (BM25) over the Gold index. No embeddings are computed and no vector index exists.

Only `http:` on `localhost`, `127.0.0.1`, or `[::1]` is accepted. Any other scheme or
host fails configuration loading.

## `config/trust.yaml`

```yaml
trust:
  reviewers: []
```

Each reviewer entry carries `reviewer_id`, `key_id`, `algorithm: ed25519`, and
`public_key_pem`. Only public keys belong here.

## `config/clean-room.yaml`

Only `project_names` and `exclude_paths` are allowed, and both must be lists of non-empty
strings.

A file that exists but is unreadable, is not valid YAML, is not a mapping, carries an
unknown key, or carries a malformed list **fails** `ziggurat check`. Deleting the file is
the supported way to use documented defaults. A gate that silently defaulted when its own
configuration was broken would report "clean" while ignoring every exclusion a human
configured.

Because the scan covers this file too, a configured project name is also a finding in it.
Add `config/clean-room.yaml` to `exclude_paths` when you configure names, and re-read the
file by hand before every release.

## Enforced limits

| Limit | Value | Applies to |
|---|---|---|
| Records per refine reference block | 12 | `refine` |
| Bytes per referenced record | 32 KiB | `refine` |
| Total reference bytes | 256 KiB | `refine` |
| Adapter request deadline | 30 seconds | `refine` model endpoint |
| Request body ceiling | 1 MiB | `refine` model endpoint |
| Response body ceiling | 1 MiB, enforced while streaming | `refine` model endpoint |
| Query length | 1,024 UTF-16 code units | `query`, `search_context` |
| Results per search | 20 | `query`, `search_context` |
| Retained citations per session | 200 | MCP session |
| Search excerpt length | 500 UTF-16 code units | `search_context` |
| CLI JSON excerpt length | 300 UTF-16 code units | `query --json` |
| Gold verification age | 90 days | `build`, `query`, MCP |

The loopback restriction applies to the configured model endpoint. The deadline, redirect
refusal, and byte ceilings are enforced by the refine adapter, which is the only shipped
code that issues a request.

Oversize refine records are omitted rather than truncated, and every omission is reported
with a reason. Over-long queries are refused rather than truncated. Reaching the citation
ceiling evicts the oldest IDs, which then become invalid.

## Related

- [CLI reference](./cli.md)
- [Gold MCP](../guides/mcp-gold.md)
