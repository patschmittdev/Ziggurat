---
title: Your first vault
description: Create a vault, capture one piece of evidence, and build the three isolated indexes.
---

A vault is an ordinary directory. `init` does not create a Git repository or a vault
`.gitignore`. Before committing one, add vault-local ignore rules for generated indexes
and decide whether inbox and Bronze evidence are safe to place in version control.

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
| `bronze/` | Canonical captured text with a verified body hash | `ingest`, using no-overwrite creation |
| `.ziggurat/proposals/` | Strict version-2, model-originated Silver JSON | The refine host |
| `knowledge/` | Operator-managed curated pages | The operator's authoring workflow |
| `config/trust.yaml` | Reviewer public-key trust anchors | The trusted operator |
| `authorizations/` | Detached signed admission receipts | An external signer |
| `.ziggurat/*-index.json` | Generated indexes | `build` |

## Capture evidence

Copy a Markdown file into `inbox/`, then capture it:

```bash
cp some-note.md ./my-vault/inbox/
node dist/src/cli/main.js ingest --root ./my-vault --file inbox/some-note.md
```

`ingest` refuses unsafe source paths before any read, copy, or unlink; see the
[ingest path rules](../guides/ingest-and-refine.md#ingest-capture-evidence).

Fresh captures default to `sensitivity: restricted` and `pii: unknown`, which keeps them
out of the model-readable evidence index until a human resolves their privacy state.

## Build the indexes

```bash
node dist/src/cli/main.js build --root ./my-vault
```

`build` rebuilds all three isolated indexes from the current artifacts. These files are
derived outputs and verified runtime inputs to `query` and MCP. At this point Gold is
empty because nothing has been authorized; `build` admits only pages that already have
valid external authorization and pass every other eligibility check.

Add these patterns to the vault's own `.gitignore` if you use Git:

```text
.ziggurat/gold-index.json
.ziggurat/review-index.json
.ziggurat/evidence-index.json
```

## Query Gold

```bash
node dist/src/cli/main.js query --root ./my-vault --query "some question"
```

The Gold index contains authorized Gold only, so a vault with no receipts returns nothing.
That is the expected result, not a failure.

## Next

- [The garden walkthrough](./garden-walkthrough.md) shows the full
  poisoned-memory scenario.
- [Ingest and refine](../guides/ingest-and-refine.md) covers staging a Silver proposal.
- [Human review and external authorization](../guides/human-review-and-authorization.md)
  covers what it takes to reach Gold.
