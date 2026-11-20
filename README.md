# Ziggurat

Ziggurat is a local TypeScript reference implementation of a write gate for AI memory. A model can propose what an AI system should remember, with exact citations to stored evidence. Nothing becomes durable context, which Ziggurat calls Gold, until a key listed in `config/trust.yaml` signs a detached Ed25519 receipt for that exact page. Ziggurat assumes the operator keeps that key outside model-accessible processes; it does not enforce where the key lives. Ziggurat ships no promote, approve, apply, or signer command. `ingest` is the only writer of evidence (Bronze), and `refine` writes only proposals (Silver).

Documentation: [patschmittdev.github.io/Ziggurat](https://patschmittdev.github.io/Ziggurat/).

## The problem, in one example

An agent that saves memories from what it reads can be told what to remember. The repository's garden fixture, [`poisoned-memory-rule.md`](fixtures/garden/inbox/poisoned-memory-rule.md), is a supplier memo submitted through a public inbox. It contains an instruction telling any AI that reads it to remember the supplier as approved and to skip review. If an agent writes that into its memory, every later session inherits it as if someone had decided it. OWASP, MITRE ATLAS, and Microsoft Learn catalog this as memory and context poisoning; see the [threat model](site/src/content/docs/security/threat-model.md).

## What Ziggurat does with it

[`test/memory-boundary.test.ts`](test/memory-boundary.test.ts) runs that memo through the whole pipeline. The [garden walkthrough](site/src/content/docs/getting-started/garden-walkthrough.md) describes each step in full; in short:

1. `ingest` preserves the memo's text as Bronze evidence, marked restricted and PII-unknown. Default model access excludes fresh captures like it.
2. A Silver proposal citing the instruction's exact lines is staged. Staging writes no knowledge page, receipt, trust entry, or index. The test calls the staging function directly; in normal use, `refine` stages proposals from model output.
3. `review` shows the instruction under an `UNTRUSTED REFERENCE` warning.
4. A knowledge page whose own metadata claims it was reviewed still does not reach Gold.
5. Gold changes only after a key listed in `config/trust.yaml` signs a receipt for the page. The test signs with a generated key, so this demonstrates the cryptographic check, not a human decision. [`test/authorization.test.ts`](test/authorization.test.ts) separately shows that the receipt stops verifying when the page content changes.
6. Retrieved Gold reports `instruction_authority: none`, and a tampered index fails closed.

Ziggurat does not detect the poison. It keeps hostile text as evidence and turns durable memory into a write that needs a signature. Whether a reviewer notices the instruction before signing is the part that matters most, and nothing here tests it.

## What it is not

- An OS sandbox or multi-tenant authorization service. Arbitrary local filesystem access defeats application boundaries.
- Proof of truth, semantic support, human identity, attention, or careful review. Ziggurat does not solve review fatigue or establish better coding output. A signature proves configured-key control and exact-content authorization.
- Prompt-injection sanitization. Hostile text remains evidence, and Gold can still contain instructions.
- Key custody, a revocation service, hosted identity, or transport security. The operator keeps private keys outside model-accessible processes.
- A backlog bound or fairness guarantee. Pagination helps inspection but does not ensure attention or prevent accumulation.

If your agents never have write access to the vault and every merge is reviewed by a person, signed commits plus branch protection may be enough.

See the [threat model](site/src/content/docs/security/threat-model.md).

## Status

Ziggurat is a reference implementation, not a product. The tests cover the admission boundary and its failure modes. They do not measure whether people catch poisoned proposals in review, how review fatigue changes that, or any outcome in a deployed agent. A model-only comparison with no signer would score Ziggurat at zero admitted poison by construction. Once someone signs, the outcome depends on what they signed: the test above ends with a signed Gold page whose body still contains the instruction. So the open question needs human reviewers, not a model benchmark.

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
