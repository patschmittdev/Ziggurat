---
title: Contributing
description: Development workflow, the boundary rules a change must not break, and how to work on the docs site.
---

The canonical contributor guide is
[CONTRIBUTING.md](https://github.com/patschmittdev/Ziggurat/blob/main/CONTRIBUTING.md).
This page is a working summary.

## Core development loop

```bash
npm ci
npm run check
node dist/src/cli/main.js check --root . --audit-clean-room
git diff --check
```

`npm run check` cleans, builds, and runs the full compiled suite. The `check` command
audits the tree for clean-room and key-material violations before publication.

Tests use real temporary files. Do not mock the filesystem.

## Boundary rules a change must not break

These are not style preferences. A change that violates one of them is wrong regardless
of how well it is written.

- The refine host may persist model-originated content only as strict Silver JSON. No
  model pathway may write Bronze, knowledge pages, reviewed metadata, trust
  configuration, authorization receipts, or indexes.
- Ziggurat ships no signer, apply, approve, or promote command; preserve the
  [human authority boundary](../concepts/human-authority-boundary.md).
- Gold admission must continue to require a detached Ed25519 receipt from a configured
  key. Operator policy maps keys to reviewers; signatures do not prove human attention.
- Every retrieved chunk carries `content_role: reference` and
  `instruction_authority: none`; preserve the
  [label contract](../concepts/provenance-and-authority.md).
- The model endpoint must remain HTTP loopback only.
- Shipped MCP must remain Gold-only and read-only.
- The gold, review, and evidence indexes must remain physically separate.

## Documentation site

The site is a standalone project under `site/` with its own `package.json` and lockfile,
so documentation dependencies never affect the core runtime package.

The site requires Node.js 22.12.0 or newer.

```bash
cd site
npm ci
npm run dev        # local development server
npm run check      # type check, production build, and built-output validation
```

From the repository root, `npm run site:dev`, `npm run site:check`, and
`npm run site:build` do the same without changing directory.

`npm run check` inside `site/` runs `astro check`, then a production build, then
`scripts/validate-build.mjs`, which verifies every internal link, heading anchor, and
asset reference in the built output and fails on any root-relative URL that escapes the
`/Ziggurat/` base path.

### Site content rules

- `SECURITY.md`, `ARCHITECTURE.md`, and `docs/authorization-protocol.md` stay canonical at
  their repository paths. Site pages explain and link to them; they never copy the full
  normative text.
- Authored Markdown links must include the base path, as in
  `/Ziggurat/concepts/tiers/`. Starlight prefixes its own navigation but not hand-written
  links, and the validator enforces this.
- Never invent users, deployments, audits, benchmarks, or production maturity.
  Cite measured development reports with their workload, failures, and limitations;
  do not present them as human acceptance or production evidence.
- Never describe Gold as truth, safety, or instruction authority.

## Related

- [Project status](./status.md)
- [Repository policies](./policies.md)
