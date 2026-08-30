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

Continuous integration runs the full suite on Linux, macOS, and Windows against Node.js
22 and 24.

## Not claimed

There are no users, deployments, third-party audits, benchmarks, adoption figures, or
production maturity claims to report, and none are made anywhere in this documentation.

## Pre-release compatibility notes

Unknown-field rejection is enforced everywhere the documentation claims it, which is a
deliberate break with earlier pre-release tolerance.

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

## Supported versions

| Version | Security fixes |
|---|---|
| Current `main` and 0.1.x | Supported |
| Earlier pre-release versions | Unsupported |

## Related

- [Contributing](/Ziggurat/project/contributing/)
- [Support](/Ziggurat/project/support/)
