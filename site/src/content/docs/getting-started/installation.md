---
title: Installation
description: Build the Ziggurat CLI from a source checkout and verify that it works.
---

Ziggurat is distributed as source, not as a published npm package. Its `package.json`
keeps `"private": true`, so do not depend on the `ziggurat` package name.

## Requirements

- Node.js 22 or newer for the core package. The documentation site requires Node.js
  22.12.0 or newer. Continuous integration is configured for Node.js 22 and 24 on Linux,
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

`npm run check` cleans, rebuilds, and runs the full compiled test suite. `--help` prints
the command list. In that output, “evidence-backed” means citations are byte-validated
against stored Bronze text; it does not claim semantic or factual verification.
“Immutable” is CLI shorthand for no-overwrite creation through ingest plus detection of
later body mutation, not physical filesystem immutability.

```text
Ziggurat: Models propose. Humans decide what persists.

Usage: ziggurat <command> [options]

Commands:
  init     Initialize a vault with an empty human trust policy
  ingest   Capture immutable Bronze evidence
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

Create a vault in [Your first vault](/Ziggurat/getting-started/first-vault/).

## Build the documentation site

The site has its own dependencies and lockfile; root `npm ci` does not install them.

```bash
cd site
npm ci
npm run check
```
