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
against Node.js 22 and 24, plus the documentation-site build. The
[release checklist](https://github.com/patschmittdev/Ziggurat/blob/main/docs/release-checklist.md)
records dated CI evidence and the outstanding publication gates. No release is tagged
and the documentation site is not yet published.

## Measured development evidence

These are bounded development measurements, not production or general-purpose
quality guarantees:

- [Local model workflow](https://github.com/patschmittdev/Ziggurat/blob/main/docs/model-workflow-evaluation.md):
  the initial batch staged 79/90 proposals; a separately reported explicit-line-number
  revision staged 90/90. Neither batch has human usability ratings, and the second
  batch reused the fixtures that informed the revision.
- [Lexical retrieval](https://github.com/patschmittdev/Ziggurat/blob/main/docs/retrieval-evaluation.md):
  exact-identifier holdout top-1 improved from 4/8 to 8/8 on the small synthetic corpus.
  No-answer false positives remain 4/6; abstention is not solved.
- [Operating envelope](https://github.com/patschmittdev/Ziggurat/blob/main/docs/operating-envelope.md):
  at 1,000 Gold pages, 5,000 Bronze records, and 1,000 proposals, the explicit
  512 MiB Node old-space profile met the stated latency, RSS, and index-size targets
  on the reference Windows machine. The default-heap RSS failure is retained.
  Real ENOSPC preservation and recovery passed on an isolated Linux tmpfs;
  native Windows disk-full recovery remains unverified.
- [External signing interoperability](https://github.com/patschmittdev/Ziggurat/blob/main/docs/external-signing-interop.md):
  a separate Python implementation reproduced signing bytes and generated disposable
  signatures accepted by Node. This is not a shipped signer or evidence of human review.

## Not claimed

There are no documented users, adoption figures, known deployments, third-party audits,
or production maturity evidence to report. The development measurements above do not
establish these, human acceptance, or reliable performance on arbitrary user corpora.

## Pre-release compatibility notes

Every schema now rejects unknown fields; earlier pre-release builds tolerated them.

- Model responses must now use strict `RefinementDraft` v1. The host constructs
  stored Silver v2; model-supplied hashes and canonical citations are not accepted.
- `refine --target` is required for amend and contradict operations.
- Technical-identifier tokenization changed. Rebuild all three indexes with
  `ziggurat build`; stored Silver v2 and authorization receipt v1 are unchanged.
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

`adapters.embedding_endpoint` is no longer accepted; remove it from `config/adapters.yaml`.

## Supported versions

| Version | Security fixes |
|---|---|
| Current `main` | Supported |
| Released versions | None yet |
| Earlier commits | Unsupported |

## Related

- [Contributing](./contributing.md)
- [Support](./support.md)
