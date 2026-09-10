---
title: Project status
description: Where Ziggurat actually is, what may change, and what is deliberately not claimed.
---

Version 0.1 is a pre-release, single-operator reference implementation.

- The package is private and source-distributed. Do not depend on the `ziggurat` npm
  package name.
- Contracts, index formats, and CLI behaviour may change before 1.0.
- It is not a hosted service, not an OS sandbox, and not a substitute for external key
  custody.

Continuous integration is configured to run the full suite on Linux, macOS, and Windows
against Node.js 22 and 24.

## Not claimed

There are no documented users, adoption figures, known deployments, third-party audits,
benchmarks, or production maturity evidence to report. This documentation makes no claim
for them.

## Pre-release compatibility notes

Every schema now rejects unknown fields; earlier pre-release builds tolerated them.

- A Bronze record carrying frontmatter fields outside the documented set no longer
  validates. It is reported by `build` as a rejected corpus entry and is treated as
  restricted, PII-unknown, and hash-unverified, so it stays out of every index. Remove
  the extra fields to restore it.
- A configuration file carrying an unknown key, including an unknown key inside
  `lifecycle`, `domain`, `privacy`, `adapters`, or `trust`, now fails to load rather than
  being silently ignored.
- A `config/clean-room.yaml` that exists but is malformed, unreadable, not a mapping, or
  carries unknown keys now fails `ziggurat check`. Delete the file to use documented
  defaults.

## Migrating an older pre-release vault

For a vault created before the authorization boundary landed, rerun `ziggurat init` to
add an empty `config/trust.yaml` and `authorizations/`. Previously reviewed pages remain
outside Gold until they receive a valid receipt. Knowledge drafts are not migrated into
Silver.

Indexes built by earlier pre-release builds use a different profile value and fail validation; rebuild with `ziggurat build`.

adapters.embedding_endpoint is no longer accepted; remove it from config/adapters.yaml.

## Supported versions

| Version | Security fixes |
|---|---|
| Current `main` | Supported |
| Released versions | None yet |
| Earlier commits | Unsupported |

## Related

- [Contributing](./contributing.md)
- [Support](./support.md)
