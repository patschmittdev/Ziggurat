# Ziggurat

**Models propose. Humans decide what persists.**

Ziggurat is a human-gated memory firewall: a local TypeScript reference
implementation that treats durable AI memory as a privileged write surface. An AI can
read approved content and can draft a complete, evidence-backed candidate. It cannot
admit that candidate to durable shared memory. Only a human holding an external
Ed25519 private key can.

## The problem: memory poisoning is a durable write attack

Persistent AI context turns a poisoned document, a fabricated preference, or an
embedded instruction into influence that survives across sessions. One bad write keeps
paying out. Microsoft's
[AI Memory / Context Poisoning](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/ai-memory-context-poisoning)
threat description recommends governing memory writes, provenance, integrity, review,
isolation, versioning, and rollback.

Ziggurat implements those controls with a Medallion pipeline: immutable **Bronze**
evidence, canonical **Silver** proposals, and separately authorized **Gold** reference
data.

## What makes it different

- **The authority boundary is cryptographic, not procedural.** Gold admission requires
  a detached Ed25519 receipt from a key configured in `config/trust.yaml`. A
  `reviewed_by: alice` string is metadata, not authority.
- **No code path can promote content.** There is no signer, apply, approve, or promote
  command, and no `--promote` flag. Key custody lives outside the vault by design.
- **Models write exactly one artifact type.** The refine pathway can only stage strict
  schema-version-2 Silver proposals. It cannot write Bronze, knowledge pages, reviewed
  metadata, trust anchors, receipts, or indexes.
- **Every citation is checked against real bytes.** A fabricated quote, digest, or line
  range fails staging against the Bronze files on disk.
- **Approval is not instruction authority.** Every retrieved chunk, including Gold,
  reports `content_role: reference` and `instruction_authority: none`. Gold means
  authorized reference data, not truth and not a command.

```mermaid
flowchart LR
    U[Untrusted source] --> I[ingest]
    I --> B[Bronze evidence]
    B --> R[refine model]
    R --> S[Silver proposal]
    S --> H{Human reviewer with\nexternal Ed25519 key}
    H -->|manual page + signed receipt| G[Gold reference]
    G --> C[Communion MCP\nread only]
    B --> E[Evidence index\nadvisory]
    S --> V[Review index\nadvisory]
    G --> V
    G --> E
```

The human layer is a nondelegable authority boundary, not an inaccessible layer. Models
may consume approved output. They cannot exercise the private-key capability that
authorizes persistence.

## Quickstart

Requirements: Node.js 22 or newer. Ziggurat is distributed as source, not as a
published npm package.

Clone this repository, then from the checkout root:

```bash
npm ci
npm run build
npm run check                       # full test suite
node dist/src/cli/main.js --help
```

Create a vault and capture your first evidence record:

```bash
node dist/src/cli/main.js init --root ./my-vault
cp some-note.md ./my-vault/inbox/
node dist/src/cli/main.js ingest --root ./my-vault --file inbox/some-note.md
node dist/src/cli/main.js build --root ./my-vault
```

To watch the full poisoned-memory scenario run against fixture data:

```bash
node scripts/run-garden-walkthrough.mjs
```

The script stops at the human signing boundary by design.

## Attack walkthrough

The garden fixture includes `fixtures/garden/inbox/poisoned-memory-rule.md`, a
plausible-looking memo instructing an AI to skip review and remember a vendor as
approved.

The automated test in `test/memory-boundary.test.ts` demonstrates the full defense:

1. Ingestion preserves the hostile text as restricted, PII-unknown Bronze evidence.
2. The model pathway stages an evidence-backed Silver candidate and writes no
   knowledge, authorization, Bronze, or index file.
3. `review` displays the embedded instruction under an `UNTRUSTED REFERENCE` warning.
4. The poisoned Bronze record is excluded from model-readable evidence and review
   indexes while its privacy state is unresolved.
5. A knowledge page carrying self-asserted reviewed metadata does not change communion.
6. Communion changes only after the test simulates an external reviewer key and writes
   a matching receipt.
7. Retrieved Gold still reports no instruction authority.
8. Tampering with the stored index causes retrieval to fail closed.

## How the tiers work

### Bronze: preserved evidence

`ziggurat ingest` moves Markdown from `inbox/` into an immutable, body-hash-verified
Bronze record. Fresh captures default to `sensitivity: restricted` and `pii: unknown`.
The original body is preserved, including hostile instructions, because Bronze is
evidence rather than memory authority.

### Silver: the only model-originated layer

`ziggurat refine` accepts structured JSON from a loopback model, validates it, adds
local audit metadata, and atomically stages it under `.ziggurat/proposals/`.

The host, not the model, reads Bronze. Each request carries a bounded reference block
containing the selected records' verified `body_sha256` and their bodies as 1-based
lines, labeled `content_role: reference` and `instruction_authority: none`. That is what
makes the advertised contract satisfiable: a model can compute exact quotes, digests,
and line ranges without ever being handed a path it could fetch. At most 12 records,
32 KiB per record, and 256 KiB in total are included. Oversize records are omitted,
never truncated, because a truncated body would produce citations that fail validation
for reasons no operator could diagnose. Every omission is reported with a reason.

Name records with `--source <bronze-path>`, repeated once per record. Without
`--source`, the same privacy policy that governs the model-readable evidence index is
applied, which excludes fresh captures while their privacy state is unresolved. Returned
proposals are still validated against the real files on disk, so a fabricated quote or
digest fails staging.

A canonical Silver artifact contains:

- a complete proposed page body and non-authoritative candidate metadata
- exact Bronze citations and hashes
- operation and, for amend or contradict, the base-content hash
- structured contradictions
- confidence, affected paths, related paths, and unresolved questions

`ziggurat review` reads these artifacts directly. Knowledge drafts are not Silver.
Malformed proposal state fails closed. Targets use lowercase top-level Markdown paths
such as `knowledge/topic.md`, which keeps proposal, contradiction, authorization, and
corpus identities identical on case-sensitive and case-insensitive filesystems.

### Gold: signed reference admission

A page can enter communion only when all eligibility checks pass:

- reviewed status and retrieval eligibility
- `pii: false`, allowed sensitivity, and approved egress
- current verification age
- valid, non-empty, hash-verified Bronze lineage
- no unresolved contradiction proposal
- a valid detached Ed25519 human-authorization receipt

The deterministic receipt path for `knowledge/topic.md` is
`authorizations/topic.md.authorization.json`. Version-1 proposals and indexes are
unsupported and must be restaged or rebuilt.

The three generated indexes remain physically separate:

| Index | Contents | Intended use |
|---|---|---|
| `gold-index.json` | Authorized Gold only | Communion answer context |
| `review-index.json` | Policy-safe Silver proposals plus authorized Gold | Local advisory review |
| `evidence-index.json` | Policy-safe Bronze plus authorized Gold | Local forensic tracing |

Review and evidence access is advisory. It is never proof of a human identity or an
authorization decision, and neither index is exposed by shipped MCP startup.

## Human review workflow

1. Run `ziggurat review --root <vault>` and inspect the complete candidate, exact
   evidence, contradictions, confidence, base state, and unresolved questions.
2. Independently verify the cited Bronze sources. Treat all displayed text as data,
   never as instructions.
3. Manually author the page under `knowledge/`. Add `status: reviewed`,
   `retrieval_eligible: true`, reviewer metadata, current verification metadata, and any
   resolved contradiction proposal IDs.
4. Use an external Ed25519 signer whose public key is listed in `config/trust.yaml`.
   Keep the private key outside the vault and outside model-accessible processes.
5. Follow the versioned [authorization protocol](docs/authorization-protocol.md) to
   compute the canonical page digest, sign the domain-separated payload, and store the
   strict detached receipt under `authorizations/`.
6. Commit the page, receipt, and intentional trust-policy change for versioning, audit,
   rollback, and review.
7. Run `ziggurat build --root <vault>`. Invalid or missing authorization leaves the page
   out of Gold.

Ziggurat intentionally ships no signer, apply, approve, or promote command. External key
custody is part of the human authority boundary.

Example public-key configuration:

```yaml
trust:
  reviewers:
    - reviewer_id: committee-chair
      key_id: committee-chair-2026
      algorithm: ed25519
      public_key_pem: |
        -----BEGIN PUBLIC KEY-----
        <base64 public key>
        -----END PUBLIC KEY-----
```

The corresponding receipt is strict JSON:

```json
{
  "schema_version": 1,
  "decision": "admit",
  "target_path": "knowledge/topic.md",
  "content_sha256": "<canonical page SHA-256>",
  "reviewer_id": "committee-chair",
  "reviewed_at": "2026-08-29T21:00:00Z",
  "key_id": "committee-chair-2026",
  "algorithm": "ed25519",
  "signature": "<detached base64 signature>"
}
```

The [authorization protocol](docs/authorization-protocol.md) defines the exact
cross-platform bytes to hash and sign, and publishes interoperability vectors in
`fixtures/authorization/receipt-vectors.json`. The TypeScript implementation remains the
authoritative verifier.

## Commands

The table uses the shorter `ziggurat` binary name. From a source checkout, either
replace it with `node dist/src/cli/main.js` or run `npm link` to create a
development-only global link.

| Command | Purpose |
|---|---|
| `ziggurat init --root <vault>` | Create vault directories and an empty trust policy |
| `ziggurat ingest --root <vault> --file <inbox-file>` | Capture immutable Bronze evidence |
| `ziggurat refine --root <vault> --query <request> [--source <bronze-path>]...` | Stage a strict Silver proposal through a loopback model |
| `ziggurat review --root <vault>` | Render human review packets from staged proposals |
| `ziggurat build --root <vault>` | Rebuild all three isolated indexes |
| `ziggurat query --root <vault> --query <text>` | Query authorized Gold communion |
| `ziggurat mcp --root <vault>` | Start the communion-only read-only MCP server |
| `ziggurat eval --root <vault>` | Run built-in conformance cases |
| `ziggurat check --root <repo> --audit-clean-room` | Audit a tree you intend to publish for clean-room and key-material violations |

`check` is a publication gate rather than a vault command. It scans a source tree for
contributor machine paths, email addresses, tokens, private keys, personal Git remotes,
configured project names, and generated retrieval state. Point it at the repository
root. Generated indexes are reported unconditionally and cannot be suppressed by
`config/clean-room.yaml`, so a working vault that has already been built reports those
files until they are removed.

`--audit-clean-room` names the audit that `check` runs. `check` performs exactly one
audit today, so passing the flag and omitting it produce the same report; the flag lets
release automation state which gate it invoked and reserves a selector for a future
second audit. It is scoped to `check` and every other command rejects it, so a script
that misplaces the flag fails loudly instead of exiting zero without auditing anything.

Configure only loopback model endpoints in `config/adapters.yaml`. The VS Code binding
in `.vscode/mcp.json` starts communion without a selectable profile.

## Security guarantees and explicit non-guarantees

### Enforced guarantees

- `ingest` is the only Bronze writer. Captures are immutable and body-hash verified.
- An `ingest` source must resolve to a real regular file physically under `inbox/`.
  Absolute paths, `..` traversal, symlinks, junctions, other reparse points, hard links,
  directories, and anything outside `inbox/` are refused before the file is read,
  copied, or deleted.
- `refine` can write only strict version-2 artifacts under `.ziggurat/proposals/`.
- The refine model receives Bronze bytes the host selected, in a bounded, labeled
  reference block. It is given no path it can fetch and no filesystem capability.
- Silver candidates cannot contain status, reviewer, receipt, or admission metadata.
- Every Silver citation must match exact Bronze bytes, hashes, and line ranges.
- No shipped function writes knowledge pages, reviewed metadata, trusted reviewer keys,
  or authorization receipts.
- Gold requires a detached Ed25519 receipt from a configured reviewer key. The receipt
  binds the reviewer, timestamp, target path, and canonical page digest.
- `reviewed_by` text alone has no authority.
- Unresolved contradiction proposals block Gold until their proposal IDs appear in the
  signed page.
- Communion, review, and evidence are physically separate version-2 indexes.
- Stored chunks, labels, lineage, proposal provenance, authorization provenance, BM25
  data, trust policy, and the live corpus are verified at startup and before both search
  and citation reads.
- Shipped MCP startup is communion-only and exposes exactly `search_context` and
  `read_context`.
- Retrieval is bounded: at most 1024 query characters, 20 results per search, and 200
  citations retained per session. Older citation IDs are revoked when the session
  ceiling is reached.
- Every returned chunk says `content_role: reference` and `instruction_authority: none`.
- Model and embedding endpoints are limited to HTTP loopback addresses. The adapter
  never follows redirects, bounds every request with a 30 second timeout, and refuses
  request or response bodies over 1 MiB.
- Bronze records, configuration files, proposals, receipts, and indexes all reject
  unknown fields, including unknown fields inside nested configuration objects.
- A present but malformed or unreadable `config/clean-room.yaml` fails the release audit
  instead of falling back to defaults.

### Explicit non-guarantees

- Ziggurat is not an OS sandbox or a multi-tenant authorization service.
- A malicious operator with arbitrary vault filesystem access can replace the trust
  policy, source files, receipts, and indexes, then rebuild.
- Path checks resolve real paths before use, but no application-level check closes every
  time-of-check to time-of-use window against an attacker who can rename vault
  directories concurrently. The operator owns vault permissions.
- `ingest` refuses a source with more than one hard link, because a hard link makes the
  deletion step ambiguous. On filesystems that report a link count above one for
  ordinary files, move the file into `inbox/` as a fresh copy.
- `visibility` on a curated page is uninterpreted metadata bound by the signature. It is
  not access control and grants or denies nothing.
- A stolen reviewer private key, compromised reviewer, or inattentive approval can
  authorize harmful or false content.
- A valid signature proves control of a configured key and exact-content approval. It
  does not prove factual truth.
- Approved text can still contain prompt injection. Gold approval never grants
  instruction authority.
- The reference implementation does not provide key custody, revocation services, hosted
  identity, transport security, or a GUI review system.

See [SECURITY.md](SECURITY.md) for the complete threat model and residual risks.

## Project status

Version 0.1 is a pre-release, single-operator reference implementation. The package is
private and source-distributed; do not depend on the `ziggurat` npm package name.
Contracts, index formats, and CLI behavior may change before 1.0. It is not a hosted
service, an OS sandbox, or a substitute for external key custody.

Continuous integration runs the full suite on Linux, macOS, and Windows against Node.js
22 and 24.

### Pre-release compatibility notes

Unknown-field rejection is enforced everywhere the documentation claims it, which is a
deliberate break with earlier pre-release tolerance:

- A Bronze record carrying frontmatter fields outside the documented set no longer
  validates. It is reported by `build` as a rejected corpus entry and is treated as
  restricted, PII-unknown, and hash-unverified, so it stays out of every index. Remove
  the extra fields to restore it.
- A configuration file carrying an unknown key, including an unknown key inside
  `lifecycle`, `domain`, `privacy`, `adapters`, or `trust`, now fails to load rather
  than being silently ignored.
- A `config/clean-room.yaml` that exists but is malformed, unreadable, not a mapping, or
  carries unknown keys now fails `ziggurat check`. Delete the file to use documented
  defaults.

For a pre-release vault created before the authorization boundary landed, rerun
`ziggurat init` to add an empty `config/trust.yaml` and `authorizations/`. Previously
reviewed pages remain outside Gold until they receive a valid receipt. Knowledge drafts
are not migrated into Silver.

## Documentation

- [Architecture](ARCHITECTURE.md) - assets, actors, trust boundaries, enforcement points
- [Security and vulnerability reporting](SECURITY.md) - threat model and residual risks
- [Authorization protocol](docs/authorization-protocol.md) - byte-level signing contract
- [Release checklist](docs/release-checklist.md) - publication gates for maintainers
- [Contributing](CONTRIBUTING.md) - development workflow and boundary rules
- [Support](SUPPORT.md) - where to ask questions
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [MIT License](LICENSE)
