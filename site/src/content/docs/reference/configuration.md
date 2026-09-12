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
at `20`. The configured value limits entries per rendered `review` page, not the
backlog, validation scan, contradiction enforcement, or proposal retention.
Packets report the render limit separately from total/displayed/remaining counts,
page positions, and the whole backlog's oldest age. Use `review --order oldest` for
global oldest-first ordering and `review --cursor <next_cursor>` to continue.
Changing this limit invalidates existing cursors; restart without a cursor.
See [review navigation](./cli.md#review-navigation). Nothing is automatically
dismissed, expired, archived, deleted, or resolved.

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
| `adapters.model_endpoint` | URL, optional | Complete HTTP loopback chat-completions URL |
| `adapters.model_name` | string, 1-128 characters, optional | Model alias sent in chat completions; defaults to `ziggurat-refine` |

Retrieval is lexical (BM25) over the Gold index. No embeddings are computed and no vector index exists.

Only `http:` on `localhost`, `127.0.0.1`, or `[::1]` is accepted. Any other scheme or
host fails configuration loading.

The supported protocol is llama.cpp non-streaming `POST /v1/chat/completions`.
For example:

```yaml
adapters:
  model_endpoint: http://127.0.0.1:18080/v1/chat/completions
  model_name: ziggurat-refine
```

The adapter uses the complete URL as configured; it does not append the API path.
The adapter sends a Zod-derived draft schema in the verified b10809 nested format:

```javascript
response_format: {
  type: "json_schema",
  json_schema: {
    name: "ziggurat_refinement_draft",
    strict: true,
    schema: RefinementDraftJsonSchema
  }
}
```

A bare sibling `schema` field is not supported; a real b10809 probe silently ignored
it and returned an invalid draft. Requests use `max_tokens: 2048`, `temperature: 0`,
and `stream: false`. There is no protocol fallback, JSON repair,
retry, or tool-call path. See the
[local model protocol and setup guide](https://github.com/patschmittdev/Ziggurat/blob/main/docs/local-model-protocol.md).

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
| Response body ceiling | 1 MiB, enforced while reading response bytes | `refine` model endpoint |
| Completion token limit | 2,048 | llama.cpp refinement request |
| Query length | 1,024 UTF-16 code units | `query`, `search_context` |
| Results per search | 20 | `query`, `search_context` |
| Retained citations per session | 200 | MCP session |
| Search excerpt length | 500 UTF-16 code units | `search_context` |
| CLI JSON excerpt length | 300 UTF-16 code units | `query --json` |
| Gold verification age | 90 days | `build`, `query`, MCP |

The loopback restriction applies to the configured model endpoint. The deadline, redirect
refusal, and byte ceilings are enforced by the refine adapter, which is the only shipped
code that issues a request.
Reading response bytes incrementally enforces the byte ceiling; it does not enable
streaming chat completions.

Oversize refine records are omitted rather than truncated, and every omission is reported
with a reason. Over-long queries are refused rather than truncated. Reaching the citation
ceiling evicts the oldest IDs, which then become invalid.

## Related

- [CLI reference](./cli.md)
- [Gold MCP](../guides/mcp-gold.md)
