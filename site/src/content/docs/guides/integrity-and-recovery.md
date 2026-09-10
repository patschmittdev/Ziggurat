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
| Silver and contradiction state is unverifiable | Proposal corruption | Restage the proposal |
| A corpus entry is reported as rejected | It is unreadable, lacks frontmatter, has invalid YAML, or fails its schema | Repair the named file |
| `ziggurat check` fails on `config/clean-room.yaml` | The file exists but is unreadable, invalid, not a mapping, or carries unknown keys | Fix or delete the file |

Rejection diagnostics deliberately carry no file content and no parsed values. For schema
failures they name field paths and issue codes only, so a restricted page is never quoted
back through build output or logs.

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

`eval` runs the built-in conformance cases against a vault.

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
