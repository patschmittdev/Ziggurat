# Ziggurat

Ziggurat is a local TypeScript reference implementation for separating AI memory proposals from durable reference admission. It preserves source evidence, stages model drafts for review, and requires a detached Ed25519 receipt from a configured external key before admitting Gold. It ships no promote, approve, apply, or signer command. `ingest` is the only Bronze writer; `refine` writes only Silver.

## What it is not

- An OS sandbox or multi-tenant authorization service. Arbitrary local filesystem access defeats application boundaries.
- Proof of truth, semantic support, human identity, attention, or careful review. Ziggurat does not solve review fatigue or establish better coding output. A signature proves configured-key control and exact-content authorization.
- Prompt-injection sanitization. Hostile text remains evidence, and Gold can still contain instructions.
- Key custody, a revocation service, hosted identity, or transport security. The operator keeps private keys outside model-accessible processes.
- A backlog bound or fairness guarantee. Pagination helps inspection but does not ensure attention or prevent accumulation.

If your agents never have write access to the vault and every merge is reviewed by a person, signed commits plus branch protection may be enough.

See the [threat model](site/src/content/docs/security/threat-model.md).

## Status

Pre-release 0.1.0, source-only, with no tagged releases. Contracts, index formats, and CLI behavior may change before 1.0.

**Experimental:** model refinement has no human usability scores. Initial staging was 79/90, below the 81/90 gate. A revision staged 90/90 on the same fixtures that informed it, so it is not a held-out result; human acceptance remains pending. See [model evidence](docs/model-workflow-evaluation.md).

See [project status](site/src/content/docs/project/status.md) for bounded evidence and remaining gaps.

## Requirements and installation

Use Git and Node.js 22 or newer (22.23.4 or newer for the documentation site). Clone this repository and install root dependencies with `npm ci`. The quickstart assumes dependencies are installed and starts in the checkout root. On PowerShell, use `npm.cmd` if execution policy blocks `npm`.

## Quickstart

```bash
npm run build
node dist/src/cli/main.js init --root ./my-vault
node -e "require('node:fs').writeFileSync('my-vault/inbox/note.md', 'A fictional garden note.\n')"
node dist/src/cli/main.js ingest --root ./my-vault --file inbox/note.md
node dist/src/cli/main.js build --root ./my-vault
node dist/src/cli/main.js query --root ./my-vault --query garden
```

Gold is empty because no page has external authorization. Ingest creates and verifies a new Bronze record before deleting the inbox source; a duplicate leaves its source untouched. Fresh captures are restricted and PII-unknown, so default model access excludes them.

Continue with [your first vault](site/src/content/docs/getting-started/first-vault.md) and [ingest and refine](site/src/content/docs/guides/ingest-and-refine.md).

## How it works

[Bronze](site/src/content/docs/concepts/tiers.md) stores canonical UTF-8 evidence with CRLF normalized to LF. Atomic no-overwrite creation prevents ingest from replacing an existing record; body hashes detect later mutation rather than making files immutable.

The refine host reads selected Bronze and optional target context, sends bounded reference data to a loopback model, and receives a strict version-1 draft. It derives exact citations and hashes, validates against live files, and stages strict version-2 Silver. Explicit source selection authorizes disclosure and bypasses the default privacy filter; evidence validation and bounds still apply.

A reviewer independently authors a knowledge page and obtains an external receipt. `build` admits Gold only after receipt verification and every eligibility check. Gold, review, and evidence indexes remain separate; shipped MCP exposes only read-only Gold. Retrieved chunks have reference status and no instruction authority. See the [authorization boundary](site/src/content/docs/concepts/human-authority-boundary.md), [isolated indexes](site/src/content/docs/concepts/isolated-indexes.md), and [provenance](site/src/content/docs/concepts/provenance-and-authority.md).

## Documentation

Documentation source is in `site/`. Build locally with `cd site`, `npm ci`, then `npm run build`; use `npm run dev` to read it locally. Start with [overview](site/src/content/docs/getting-started/overview.md), [installation](site/src/content/docs/getting-started/installation.md), [CLI](site/src/content/docs/reference/cli.md), [configuration](site/src/content/docs/reference/configuration.md), and [architecture](ARCHITECTURE.md).

## Contributing

Follow [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Ask questions through [SUPPORT.md](SUPPORT.md).

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
