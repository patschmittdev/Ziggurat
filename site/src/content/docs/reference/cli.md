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
| `ziggurat refine --root <vault> --query <request> [--source <bronze-path>]...` | Stage a strict Silver proposal through a loopback model |
| `ziggurat review --root <vault>` | Render human review packets from staged proposals |
| `ziggurat build --root <vault>` | Rebuild all three isolated indexes |
| `ziggurat query --root <vault> --query <text>` | Query authorized Gold |
| `ziggurat mcp --root <vault>` | Start the read-only Gold MCP server |
| `ziggurat eval --root <vault>` | Run built-in conformance cases |
| `ziggurat check --root <repo> [--audit-clean-room]` | Audit a tree you intend to publish |

## Common options

| Option | Meaning |
|---|---|
| `--root <path>` | The vault directory, or for `check` the repository root |
| `--json` | Machine-readable output |
| `--help` | Usage for the CLI or for a single command |

## What each command may write

| Command | Writes | Cannot write |
|---|---|---|
| `init` | Vault directories, an empty `config/trust.yaml` | Reviewer keys |
| `ingest` | One no-overwrite Bronze record, then deletion of the captured inbox source | Other vault state |
| `refine` | One model-originated strict v2 proposal under `.ziggurat/proposals/` | Bronze, knowledge, receipts, trust, reviewed metadata, indexes |
| `review` | Nothing | Anything |
| `build` | Generated indexes, including admitted Gold chunks for eligible pages | Knowledge pages, authorization receipts, or trust keys |
| `query`, `mcp`, `eval` | Nothing | Anything |
| `check` | Nothing | Anything |

## refine and repeated `--source`

`--source <bronze-path>` names one Bronze record for the host to include, and is repeated
once per record. Without `--source`, the privacy policy that governs the model-readable
evidence index is applied instead, which excludes fresh captures while their privacy
state is unresolved.

Explicit `--source` is an operator-authorized disclosure to the configured loopback model
endpoint. It bypasses the default model-access privacy filter and can include restricted
or PII-unknown Bronze. Returned proposals are validated against stored files either way,
so a fabricated quote or digest fails staging; the checks do not establish semantic
support or factual truth.

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
