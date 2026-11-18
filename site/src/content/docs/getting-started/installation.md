---
title: Installation
description: Build the Ziggurat CLI from a source checkout and verify that it works.
---

**Experimental:** model-backed refinement has no human usability scores; the revised model-workflow batch reused the fixtures that informed it and is not held out.

Ziggurat is distributed as source, not as a published npm package. Its `package.json`
keeps `"private": true`, so do not depend on the `ziggurat` package name.

## Requirements

- Node.js 22 or newer for the core package. The documentation site requires Node.js
  22.23.4 or newer. Continuous integration is configured for Node.js 22 and 24 on Linux,
  macOS, and Windows.
- Git, to clone the repository.

## Build from source

Clone this repository, then from the checkout root:

```bash
npm ci
npm run build
```

`npm run build` compiles TypeScript to `dist/`. The CLI entry point is
`dist/src/cli/main.js`.

## Verify the build

```bash
npm run check
node dist/src/cli/main.js --help
```

`npm run check` cleans, rebuilds, and runs the full compiled test suite. See the
[CLI reference](../reference/cli.md#commands) for command purposes.
Bronze creation prevents overwrites; body hashes detect later mutation.

```text
Ziggurat: Models propose. Humans decide what persists.

Usage: ziggurat <command> [options]

Commands:
  init     Initialize a vault with an empty human trust policy
  ingest   Capture no-overwrite Bronze evidence
  refine   Stage an evidence-backed Silver proposal
  review   Render staged Silver proposals for human review
  build    Rebuild isolated indexes; unsigned content stays out of Gold
  query    Query authorized Gold
  mcp      Start the read-only Gold MCP server
  check    Audit clean-room and key-material policy
  eval     Run conformance checks
```

## Command name

Documentation uses the shorter `ziggurat` binary name. From a source checkout, either
substitute `node dist/src/cli/main.js`, or create a development-only global link:

```bash
npm link
```

`npm link` is a local convenience for a source checkout. It does not publish anything.

## Next

Create a vault in [Your first vault](./first-vault.md).

## Build the documentation site

The site has its own dependencies and lockfile; root `npm ci` does not install them.

```bash
cd site
npm ci
npm run check
```
