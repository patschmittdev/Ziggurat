---
title: CLI reference
description: Every Ziggurat command, its options, and what it is allowed to write.
---

Documentation uses the shorter `ziggurat` binary name. From a source checkout, either
substitute `node dist/src/cli/main.js` or run `npm link` to create a development-only
global link.

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

## Common options

| Option | Meaning |
|---|---|
| `--root <path>` | The vault directory, or for `check` the repository root |
| `--json` | Machine-readable reports for ingest, refine, review, build, query, check, and eval. `init` retains its text message; MCP uses its stdio protocol rather than a CLI JSON report. |
| `--help` | Usage for the CLI or for a single command |

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

The starter files created by `init` are `ziggurat.yaml`, `domain.yaml`,
`privacy.yaml`, `adapters.yaml`, and an empty `trust.yaml`, all under `config/`.

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
ranges, then validates against live files before staging. These checks do not establish
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

`npm run eval:model` runs a local real-model gate separately from `ziggurat eval`, which
remains the built-in conformance command. The model gate uses 30 cases across create,
amend, and contradict, with three runs each and no retries. Acceptance requires at least
81 staged proposals and 72 human-scored usable proposals out of 90 attempts. Missing
actual human scores leave the quality gate pending. Passing also requires at least one
human-scored usable example of each of the three operations.

See the [local model guide](https://github.com/patschmittdev/Ziggurat/blob/main/docs/local-model-protocol.md)
for pinned setup status and the runner interface:

```text
npm run eval:model -- --endpoint URL --output NEWDIR --manifest PINNED.json [--model alias] [--seed N] [--max-tokens N]
npm run eval:model -- --score RUNDIR
```

The required manifest records server, model, runtime, and probe provenance, including
both pinned model shards and their hashes. Human scoring is separate from generation.
Manifest pins are operator-supplied provenance, not endpoint identity attestation.
Defaults are seed `123`, `max_tokens: 2048`, temperature `0`, and a 30 second timeout.
An explicit `--model` must match the manifest alias.
`--output` must be a new directory beneath the current working directory. Existing
outputs are refused, and partial runs cannot be resumed or scored. The directory passed
to `--score` must also be beneath the current working directory.

The human edits only `ratings.json`, giving all 90 attempts a true/false usability
assessment and a non-empty reason without changing identity fields or digests.
`COMPLETE.json` verifies immutable run artifacts and rating-to-artifact hash bindings
before scoring. Generation exits
`2` if fewer than 81 proposals stage, otherwise `3` pending human scores.
`--score` exits `0` for a model-gate pass, `2` for failure, `3` for pending scores, or
`1` for invalid input/evidence.

Confirm runner readiness before starting the frozen run; pilot probes do not count
toward its 90 attempts. Deterministic negative-case tests remain a separate requirement
for the full Phase 1 gate.

## check

`check` is a heuristic working-tree publication gate rather than a vault command. It
scans regular UTF-8 text files for Windows and macOS-style user paths, email addresses,
GitHub token prefixes, PEM private-key markers, personal Git remote syntax, configured
project names, and generated retrieval state. It reports unscannable binary or non-UTF-8
files unless explicitly excluded. Directory entries that are symlinks are skipped.
Point it at the repository root.

```bash
ziggurat check --root . --audit-clean-room
```

Generated indexes are reported unconditionally and cannot be suppressed by
`config/clean-room.yaml`, so a working vault that has already been built reports those
files until they are removed.

A PASS does not prove that the tree contains no credentials or private data, and the
command does not inspect Git history. Use a general secret scanner and review reachable
history separately before publication.

`--audit-clean-room` names the audit that `check` runs. `check` performs exactly one
audit today, so passing the flag and omitting it produce the same report. The flag lets
release automation state which gate it invoked, and reserves a selector for a future
second audit. It is scoped to `check`, and every other command rejects it, so a script
that misplaces the flag fails loudly instead of exiting zero without auditing anything.

## Commands that do not exist

Ziggurat ships no signer, apply, approve, or promote command; see the
[human authority boundary](../concepts/human-authority-boundary.md).

## Related

- [Configuration](./configuration.md)
- [Authorization protocol](./authorization-protocol.md)
