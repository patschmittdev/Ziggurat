---
title: Integrity verification and recovery
description: What fails closed, what it means, and how to rebuild from authoritative artifacts.
---

Ziggurat fails closed. When state cannot be verified it refuses to serve, rather than
serving something it cannot vouch for.

## What is verified

Stored chunks, labels, lineage, proposal provenance, authorization provenance, BM25 data,
trust policy, and the live corpus are verified at startup and again before both search
and citation reads.

Each index also carries a profile literal, deterministic chunk IDs, a trust-policy
fingerprint, and a corpus fingerprint over complete chunk integrity.

## Failure modes and what they mean

| Symptom | Meaning | Action |
|---|---|---|
| Startup, search, or read refuses after an index mismatch | The stored index no longer matches the live corpus, trust policy, or its own integrity data | Rebuild with `ziggurat build` |
| A page will not enter Gold | One or more eligibility checks failed | Check status, retrieval eligibility, privacy, sensitivity, egress, verification age, Bronze lineage, contradictions, and the receipt |
| Silver and contradiction state is unverifiable | Proposal corruption | Inspect the named artifact; see [Corrupt proposals](#corrupt-proposals) before restaging |
| `build` cannot list the knowledge directory | Curated state is unknown, for example because `knowledge` is a regular file (`ENOTDIR`) or listing is denied (`EACCES` or `EPERM`) | Restore the directory or its permissions, then rebuild; no index files are replaced by this failed build |
| A corpus entry is reported as rejected | It is unreadable, lacks frontmatter, has invalid YAML, or fails its schema | Repair the named file |
| `ziggurat check` fails on `config/clean-room.yaml` | Unreadable or malformed YAML, unknown keys, invalid list entries, or a non-null non-mapping document | Fix the reported problem; absent, empty, comments-only, or YAML-null documents use defaults |

Rejection diagnostics deliberately carry no file content and no parsed values. For schema
failures they name field paths and issue codes only, so a restricted page is never quoted
back through build output or logs.

An absent `knowledge` directory (`ENOENT`) still represents an empty curated
collection, so rebuilding may replace Gold with an empty index while retaining
eligible advisory content. Other listing failures exit unsuccessfully before any
index publication and report a filesystem error code without corpus contents.
Live verification also refuses an index when the knowledge directory cannot be
listed.

## Corrupt proposals

Inspect the named artifact and its cited evidence. Restore a valid artifact from
trusted history where possible. If it is irrecoverable, preserve that specific
artifact outside the active proposal store and reconcile its identity and
contradictions before restaging.

Restaging alone does not remove corrupt active JSON. Quarantine is not signed
contradiction resolution, and it must not be used to discard a valid blocking
contradiction.

## Rebuild

```bash
ziggurat build --root <vault>
```

Rebuilding is the supported recovery for any index problem. Generated indexes are derived
outputs reconstructed from current source artifacts, then used as runtime inputs only
after verification. `init` does not create a vault `.gitignore`; add vault-local ignore
rules if the vault uses Git.

Version-1 proposals and indexes are unsupported and must be restaged or rebuilt.

## Conformance checks

```bash
ziggurat eval --root <vault>
```

`eval` runs four built-in self-checks using synthetic page inputs and the supplied
root. It is not a complete audit of the vault, a real-model evaluation, or proof
that all stored artifacts are valid.

## Key and incident handling

Keep private keys outside the vault and follow
[SECURITY.md](https://github.com/patschmittdev/Ziggurat/blob/main/SECURITY.md#key-and-incident-handling)
for compromised keys, poisoned memory, and unexpected state changes.

## A note on availability

Failing closed has a cost. Corrupt proposals or policy changes can intentionally force
denial of service. That trade is deliberate: an unverifiable memory store that answers
anyway is the failure this project exists to prevent.

## Related

- [Isolated indexes](../concepts/isolated-indexes.md)
- [Security guarantees and residual risks](../security/guarantees.md)
