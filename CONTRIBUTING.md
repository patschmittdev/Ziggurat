# Contributing

Discuss substantial changes through issue forms first. Follow the [Code of Conduct](CODE_OF_CONDUCT.md), use [SUPPORT.md](SUPPORT.md) for questions, and report vulnerabilities through [SECURITY.md](SECURITY.md).

## Development

Use Git and Node.js 22 or newer. Ziggurat is not published to npm; install it from source.

```bash
npm ci
npm run check
node dist/src/cli/main.js check --root . --audit-clean-room
git diff --check
```

Write failing tests for behavior changes, implement the smallest complete boundary, and use real temporary files rather than mocked filesystems. Run targeted compiled tests while iterating. Changes must work on Windows, macOS, and Linux.

`--audit-clean-room` names the only current `check` audit; omitting it gives the same report. Other commands reject it. Inspect diffs for private data, generated artifacts, unrelated edits, compatibility breaks, and overstated claims.

## Boundary rules

Preserve the [threat model](site/src/content/docs/security/threat-model.md) and [guarantees](site/src/content/docs/security/guarantees.md). Model output stays strict draft v1, materialized and live-validated as Silver v2. Knowledge drafts are not Silver; invalid proposal state fails closed. Keep MCP Gold-only and read-only, endpoints HTTP loopback-only, and indexes separate.

Generate ephemeral test keys at runtime. Keep private keys outside the repository. Synchronize canonicalization changes with the [authorization protocol](docs/authorization-protocol.md); never reinterpret signed version-1 bytes in place. Cover every trust or retrieval field with integrity verification at startup, search, and citation read.

Use strict NodeNext ESM TypeScript without `any`, strict Zod v4 schemas, `node:util.parseArgs`, and the MCP v2 SDK with Standard Schema-compatible inputs. Share canonicalization and verification functions.

Exclude contributor paths, email addresses, credentials, private project names, personal remote URLs, and generated indexes. Public keys and fictional fixtures are allowed. Configure audit terms in `config/clean-room.yaml`; binary/non-UTF-8 exclusions require exact paths and manual inspection.

## Documentation

The standalone `site/` project requires Node.js 22.23.4 or newer and separate dependencies. Build with `cd site`, `npm ci`, then `npm run build`. Run `npm run dev` there for local reading and `npm run check` for type, build, link, anchor, asset, and base-path validation. Root aliases are `site:dev`, `site:check`, and `site:build`.

Use relative `.md` page links; route URLs must include `/Ziggurat/`. Keep topics in canonical homes and link to them. Qualify measured evidence; never invent users, deployments, audits, or maturity, or describe Gold as truth or instruction authority.

Optional local visual/accessibility check: with Playwright Chromium installed, run `npm run visual` from `site/`. Screenshots go to `site/.artifacts/`. This is not a release gate.

## Releasing (maintainers)

Update CHANGELOG.md, confirm CI is green on every leg, then tag `vX.Y.Z` for the version being released.
