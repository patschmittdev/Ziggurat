---
title: Your first vault
description: Create a vault, capture one piece of evidence, and build the three isolated indexes.
---

A vault is an ordinary directory. Everything in it except the generated indexes is
intended for Git versioning.

## Create the vault

```bash
node dist/src/cli/main.js init --root ./my-vault
```

`init` creates the vault directories and an empty trust policy. It never adds or replaces
reviewer keys.

## Vault layout

| Path | Contents | Who writes it |
|---|---|---|
| `inbox/` | Untrusted capture input | You, by copying files in |
| `bronze/` | Immutable, hash-verified evidence | `ingest`, and nothing else |
| `.ziggurat/proposals/` | Strict version-2 Silver proposals | `refine`, and nothing else |
| `knowledge/` | Human-authored curated pages | A human, by hand |
| `config/trust.yaml` | Reviewer public-key trust anchors | A human, by hand |
| `authorizations/` | Detached signed admission receipts | An external signer |
| `.ziggurat/*-index.json` | Generated indexes | `build` |

## Capture evidence

Copy a Markdown file into `inbox/`, then capture it:

```bash
cp some-note.md ./my-vault/inbox/
node dist/src/cli/main.js ingest --root ./my-vault --file inbox/some-note.md
```

`ingest` reads and deletes its source, so the source path is validated hard before the
file is opened. It must resolve to a real regular file physically under `inbox/`.
Absolute paths, `..` traversal, empty segments, control characters, directories,
symlinks, junctions, other reparse points, hard links, and real-parent escapes are all
refused before any read, copy, or unlink happens.

Fresh captures default to `sensitivity: restricted` and `pii: unknown`, which keeps them
out of the model-readable evidence index until a human resolves their privacy state.

## Build the indexes

```bash
node dist/src/cli/main.js build --root ./my-vault
```

`build` rebuilds all three isolated indexes from the current artifacts. At this point Gold
is empty: nothing has been authorized, and running `build` is not an admission capability.

## Query communion

```bash
node dist/src/cli/main.js query --root ./my-vault --query "some question"
```

Communion contains authorized Gold only, so a vault with no receipts returns nothing.
That is the expected result, not a failure.

## Next

- [The garden walkthrough](/Ziggurat/getting-started/garden-walkthrough/) shows the full
  poisoned-memory scenario.
- [Ingest and refine](/Ziggurat/guides/ingest-and-refine/) covers staging a Silver proposal.
- [Human review and external authorization](/Ziggurat/guides/human-review-and-authorization/)
  covers what it takes to reach Gold.
