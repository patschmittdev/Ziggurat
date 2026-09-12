# Contributing

Ziggurat welcomes focused bug fixes, tests, documentation improvements, and
well-scoped proposals that preserve its human authority boundary. Participation is
governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

Use the repository issue forms before substantial work so the threat model,
compatibility impact, and intended scope can be discussed. Follow
[SECURITY.md](SECURITY.md) instead of opening a public issue for vulnerabilities.
General setup and usage guidance is in [SUPPORT.md](SUPPORT.md).

## Development setup

Requirements: Git and Node.js 22 or newer.

```bash
npm ci
npm run build
node dist/src/cli/main.js --help
```

The package is private and source-distributed during the pre-release phase. Do not
depend on the `ziggurat` npm package name.

## Development workflow

1. Write failing tests first for every behavior change.
2. Implement the smallest complete security boundary that passes them.
3. Use real temporary files. Do not mock the filesystem.
4. Run targeted compiled tests while iterating.
5. Run `npm run check`.
6. Run `node dist/src/cli/main.js check --root . --audit-clean-room`.

`--audit-clean-room` names the clean-room release audit and is accepted only by
`check`. Every other command rejects it, so a misplaced flag fails loudly rather than
exiting zero without auditing anything. `check` performs exactly one audit today, so the
report is the same with or without the flag; keep passing it so the invoked gate is
explicit in scripts and transcripts.

All changes must work on Windows, macOS, and Linux with Node.js 22 or newer.

Before opening a pull request, review the complete diff for generated artifacts,
private data, unrelated formatting changes, undocumented compatibility breaks, and
trust claims stronger than the implementation.

Maintainers preparing a published build follow the
[release checklist](docs/release-checklist.md).

## External key-holder authority

- Models return strict `RefinementDraft` v1 only. The host materializes,
  live-validates, and stages strict stored Silver v2.
- Model and refine pathways must never write Bronze, knowledge pages, reviewed
  metadata, trusted reviewer keys, authorization receipts, or indexes.
- Ziggurat ships no signer, apply, approve, or promote command; preserve the
  [human authority boundary](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/concepts/human-authority-boundary.md).
- A `reviewed_by` string is not authority. Gold requires a verified detached
  Ed25519 receipt from `config/trust.yaml`.
- Review and evidence indexes are advisory or forensic. They never prove human
  identity.
- Shipped MCP startup serves the Gold index only and exposes
  two read-only tools.
- Every retrieved chunk carries `content_role: reference` and
  `instruction_authority: none`; see
  [provenance and authority](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/concepts/provenance-and-authority.md).

## Silver proposal changes

Canonical Silver artifacts are strict schema-version-2 JSON under
`.ziggurat/proposals/`. They contain complete candidate content, exact Bronze
evidence, contradictions, confidence, and unresolved questions. Candidate schemas
must reject human admission fields.

Knowledge drafts are not Silver. Do not restore status-based Silver indexing.
Invalid proposal state must fail closed.

## Authorization and index changes

- Keep reviewer private keys outside the repository and tests. Tests must generate
  ephemeral keys at runtime.
- Bind authorization to canonical semantic page content, target, identity, time, and
  key.
- Any field used to establish trust or retrieval behavior must be covered by index
  integrity.
- Preserve physical separation: the Gold index holds authorization-valid Gold only, review is Silver plus Gold,
  and evidence is Bronze plus curated Gold.
- Verify stored index state against both its own contents and the live corpus at
  startup, search, and citation read.
- Keep the byte-level contract in
  [docs/authorization-protocol.md](docs/authorization-protocol.md) synchronized with
  canonicalization and receipt changes. Introduce a new protocol version rather than
  silently changing signed version-1 bytes.

## Clean-room requirements

The repository must not contain:

- absolute contributor-machine paths
- email addresses, tokens, credentials, or private keys
- personal Git remote URLs or private project names
- generated index artifacts under `.ziggurat/`

Public reviewer keys and fictional fixtures are allowed. Configure project-name
terms in `config/clean-room.yaml`; do not hard-code private names.
Non-UTF-8 and binary files fail the audit unless their exact paths are explicitly
excluded there after manual inspection.

## TypeScript and SDK

- Use strict NodeNext ESM TypeScript with no `any`.
- Validate every untrusted input with strict Zod v4 schemas.
- Use `node:util.parseArgs` for CLI arguments.
- Preserve `@modelcontextprotocol/server` v2 and Standard Schema-compatible tool
  inputs.
- Prefer shared canonicalization and verification functions over duplicated trust
  logic.
