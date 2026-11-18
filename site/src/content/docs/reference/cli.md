---
title: CLI reference
description: Every Ziggurat command, its options, and what it is allowed to write.
---

**Experimental:** model-backed refinement has no human usability scores; the revised model-workflow batch reused the fixtures that informed it and is not held out.

After `npm run build`, from source, replace `ziggurat` with `node dist/src/cli/main.js`, or use `npm link`.

## Commands

| Command | Purpose |
|---|---|
| `ziggurat init --root <vault>` | Create vault directories and an empty trust policy |
| `ziggurat ingest --root <vault> --file <inbox-file>` | Capture no-overwrite, body-hash-verified Bronze evidence |
| `ziggurat refine --root <vault> --query <request> [--source <bronze-path>]... [--target knowledge/item.md]` | Materialize and stage strict Silver from a loopback model draft |
| `ziggurat review --root <vault> [--order priority\|oldest] [--cursor <token>]` | Render read-only, state-bound pages of human review packets |
| `ziggurat build --root <vault>` | Rebuild all three isolated indexes |
| `ziggurat query --root <vault> --query <text>` | Query authorized Gold |
| `ziggurat mcp --root <vault>` | Start the read-only Gold MCP server |
| `ziggurat eval --root <vault>` | Run built-in conformance cases |
| `ziggurat check --root <repo> [--audit-clean-room]` | Audit a tree you intend to publish |

## Options

| Option | Meaning |
|---|---|
| `--root <path>` | The vault directory, or for `check` the repository root |
| `--json` | Machine-readable reports for ingest, refine, review, build, query, check, and eval. `init` retains its text message; MCP uses its stdio protocol rather than a CLI JSON report. |
| `--help` | Usage for the CLI or for a single command |

Human text escapes terminal, bidi, C1, and line-separator controls. JSON preserves decoded values; render them inertly. This is display hardening, not Markdown sanitization or admission.

## What each command may write

| Command | Writes | Cannot write |
|---|---|---|
| `init` | Vault directories and missing starter configuration files; existing configuration is never overwritten | Reviewer keys |
| `ingest` | New capture: one no-overwrite Bronze record, then deletion of the captured inbox source. Duplicate: no write or deletion. | Other vault state |
| `refine` | One strict v2 proposal materialized from a model draft under `.ziggurat/proposals/` | Bronze, knowledge, receipts, trust, reviewed metadata, indexes |
| `review` | Nothing | Anything |
| `build` | Generated indexes, including admitted Gold chunks for eligible pages | Knowledge pages, authorization receipts, or trust keys |
| `query`, `mcp`, `eval` | Nothing | Anything |
| `check` | Nothing | Anything |

See [configuration](./configuration.md) for starter files.

## refine, repeated `--source`, and `--target`

`--source <bronze-path>` names one Bronze record for the host to include, and is repeated
once per record. Without `--source`, the privacy policy that governs the model-readable
evidence index is applied instead, which excludes fresh captures while their privacy
state is unresolved.

Explicit `--source` is an operator-authorized disclosure to the configured loopback model
endpoint. It bypasses the default model-access privacy filter and can include restricted
or PII-unknown Bronze. It does not bypass bounds or evidence validation. Only records
actually supplied to the model can be cited through their host-assigned source IDs.

`--target knowledge/item.md` supplies host-read existing page context, and is required
for `amend` and `contradict`. It grants no write permission for that page. The host derives
the base hash; the model cannot provide or override it.

The endpoint returns strict `RefinementDraft` v1. The host materializes canonical
stored Silver v2, deriving exact evidence quotes and hashes from supplied IDs and line
ranges, then validates against live files before staging. Checks do not establish
semantic support or factual truth.

In CLI JSON mode, typed failures are emitted on stderr as:

```json
{"error":{"code":"<failure-code>","message":"<diagnostic>"}}
```

The adapter accepts one finished assistant text response with no repair, retry, fallback,
or tool calls. See the
[local model protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/local-model-protocol.md)
for the exact request and failure contract.

## review navigation

`--order priority|oldest` and `--cursor <token>` apply only to `review`; other commands
reject them, including with `--help`. The default priority order puts contradictions
first, then low/medium/high confidence, then age and stable identity. Oldest-first is
global, not merely a sort of the first page. The cursor retains its order when omitted.

`--json` returns `total_count`, `displayed_count` (also `count` for compatibility),
`remaining_count` after the current page, configured `render_limit`, `order`,
one-based `page_number`/`page_count`, inclusive `page_start`/`page_end`,
`oldest_staged_at` and `oldest_age_seconds` for the whole backlog, and `next_cursor`.
Empty queues have zero page positions/counts and null oldest/continuation values.
The final page has `next_cursor: null`. Age is elapsed whole seconds, clamped to zero
for future staged timestamps.

Cursors are opaque, versioned base64url tokens bounded to 512 characters. They bind
all artifact identities/digests, current target digests, order, and render limit.
Reuse the returned token without editing it. A changed queue fails with no partial
page; restart without `--cursor`. Cursors are navigation data, not authorization.
Collection is not an atomic snapshot against concurrent filesystem mutation.

The render limit is not a validation or retention limit. The entire proposal set and
its exact evidence are validated on every request. Hidden contradictions remain
admission-blocking. Oldest-first navigation offers reachability, not guaranteed fair
service or a bound on accumulation. Review writes no disposition or acknowledgment.

See the [human review guide](../guides/human-review-and-authorization.md) for current
target/body/metadata comparisons, explicit stale/missing/conflict/parse warnings,
inert evidence rendering, and the advisory external-authorization checklist.

## Opt-in model evaluation

```text
npm run eval:model -- --endpoint URL --output NEWDIR --manifest PINNED.json [--model alias] [--seed N] [--max-tokens N]
npm run eval:model -- --score RUNDIR
```

Generation exits `2` below 81 staged proposals, otherwise `3` pending human scores. Scoring exits `0` for pass, `2` for failure, `3` pending, or `1` for invalid input/evidence. See the [local model protocol](https://github.com/patschmittdev/Ziggurat/blob/main/docs/local-model-protocol.md) for manifest, defaults, output constraints, sealed evidence, and scoring requirements.

## check

`check` is a heuristic working-tree publication gate rather than a vault command. It
scans regular UTF-8 text files for Windows and macOS-style user paths, email addresses,
GitHub token prefixes, PEM private-key markers, personal Git remote syntax, configured
project names, and generated retrieval state. It reports unscannable binary or non-UTF-8
files unless explicitly excluded. Directory entries that are symlinks are skipped.
Use the repository root.

```bash
ziggurat check --root . --audit-clean-room
```

Generated indexes are reported unconditionally and cannot be suppressed by
`config/clean-room.yaml`, so a working vault that has already been built reports those
files until they are removed.

A PASS does not prove that the tree contains no credentials or private data, and the
command does not inspect Git history. Use a general secret scanner and review reachable
history separately before publication.

`--audit-clean-room` names the only current audit; omitting it produces the same report. Other commands reject it, including with `--help`.

## Index verification errors

- `index_integrity`: Index integrity verification failed.
- `trust_policy_changed`: Trust policy changed after the index was built.
- `index_stale`: Corpus fingerprint mismatch: the index is stale.

## Unavailable commands

Ziggurat ships no signer, apply, approve, or promote command; see the
[human authority boundary](../concepts/human-authority-boundary.md).
