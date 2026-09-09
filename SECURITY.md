# Security

## Reporting a vulnerability

Do not open a public issue for suspected vulnerabilities. Use GitHub's private
vulnerability reporting for this repository: **Security**, **Advisories**,
**Report a vulnerability**, or the direct form at
<https://github.com/patschmittdev/Ziggurat/security/advisories/new>.

Include the affected commit or version, threat scenario, reproduction using
fictional data, security impact, and any suggested mitigation. Do not submit private
vault content, credentials, tokens, or reviewer private keys.

The maintainers will coordinate disclosure after the issue is understood and a fix
or mitigation is available. This project is pre-release and does not promise a
response-time service level.

## Supported versions

Only `main` receives security fixes; no versioned release exists yet.

## Threat model

Ziggurat addresses persistent AI memory and context poisoning: untrusted content
enters a durable retrieval store and silently influences later model behavior.
Microsoft describes this attack and recommended controls in
[AI Memory / Context Poisoning](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/ai-memory-context-poisoning).

Relevant attack inputs include poisoned documents, fabricated facts, embedded
instructions, tampered retrieval indexes, compromised agents, and stale
approved content.

## Assets and actors

Protected assets are Bronze integrity, Silver review context, Gold admission state,
reviewer trust anchors, detached authorization receipts, isolated indexes, and
retrieved citations.

Actors are untrusted source authors, the loopback refinement model, human reviewers,
the trusted local operator, general Gold retrieval clients,
and advisory review/evidence tooling. Advisory access does not establish human identity.

## Trust assumptions

- The operator controls vault permissions, local processes, Git history, and
  `config/trust.yaml`.
- Reviewer Ed25519 private keys remain outside the vault and model-accessible
  processes.
- The configured public keys identify reviewers acceptable to the operator.
- Model endpoints use HTTP loopback only.
- The local machine is a single trusted-operator environment, not a hostile
  multi-tenant host.

## Security boundaries and capabilities

The model endpoint receives messages and returns structured JSON. Ziggurat does not
give that endpoint filesystem or tool capabilities. The refine pathway owns only a
root-constrained Silver writer.

The host reads Bronze and places the selected bytes into the request as an explicit,
bounded, labeled reference block: at most 12 records, 32 KiB per record, 256 KiB in
total, each carrying its verified body digest and 1-based lines. The model receives
data, never a path, handle, or fetch capability, and the proposal it returns is still
revalidated against the real Bronze files before staging. Oversize records are
omitted rather than truncated so a citation can never be computed against bytes that
differ from the stored record.

The adapter reaches only HTTP loopback endpoints. It never follows redirects, so a
loopback endpoint answering with an off-machine `Location` cannot turn the adapter
into a server-side request forgery primitive. Every request carries a 30 second
deadline, and request and response bodies are capped at 1 MiB, with the response
ceiling enforced while streaming rather than after buffering.

`ingest` reads and deletes its source, so its source path is a combined arbitrary-read
and arbitrary-delete primitive if it escapes. A source must resolve to a real regular
file physically under `inbox/`. The following are all refused before the file is opened:

- Absolute paths
- `..` traversal
- empty segments
- control characters
- directories
- symlinks
- junctions
- other reparse points
- hard links
- real-parent escapes

A refused source is never read, copied, or unlinked.

Retrieval is bounded per session: 1024 query characters, 20 results per search, and
200 retained citations. Over-long queries are refused rather than truncated. When the
citation ceiling is reached the oldest IDs are evicted, which revokes them: a read
against an evicted ID fails closed with the same error as a forged ID.

No production module writes knowledge pages, reviewed metadata, trusted reviewer
keys, or authorization receipts. `init` can create an empty trust policy but never
adds or replaces keys. `build` can write generated indexes, but Gold construction
requires a valid receipt. Running `build` is not an admission capability.

The human admission capability is an external Ed25519 private key. A receipt binds:

- `decision: admit`
- normalized knowledge target path
- SHA-256 of canonical semantic page content
- reviewer ID and review timestamp
- trusted key ID and Ed25519 algorithm

The signature payload is domain separated. The canonical page representation uses
parsed fields in fixed order and an LF-normalized body, so verification is stable on
Windows, macOS, and Linux. Review timestamps require canonical UTC ISO-8601 values.
The exact field and signing contract lives in the
[authorization protocol](docs/authorization-protocol.md#unsigned-receipt).

## Attack mapping

The primary scenario is Microsoft's AI memory/context poisoning technique. The same
failure can begin as indirect prompt injection, become persistent data poisoning,
and exploit weak retrieval-store integrity. The linked Microsoft catalog maps those
stages to OWASP LLM01, LLM04, and LLM08 and to MITRE ATLAS context and RAG poisoning
techniques. Ziggurat addresses admission and retrieval integrity; it does not claim
to prevent every prompt-injection or model-behavior failure.

## Attack controls

| Memory-poisoning control | Ziggurat enforcement |
|---|---|
| Source approval | Sources remain isolated Bronze; extracted claims require separate admission |
| Provenance | Exact Bronze citations, body hashes, quote hashes, and Gold lineage |
| Memory write governance | External human signing capability required for Gold |
| Schema-bound memory | Strict Zod v4 contracts reject unknown fields on Bronze records, configuration and its nested objects, proposals, receipts, and indexes |
| Review and diff transparency | Complete Silver candidates and evidence in `review` |
| Presentation sanitization | Candidate bodies are indented; quoted fields and control characters are escaped |
| Integrity | Receipt binding plus complete chunk, BM25, policy, and live-corpus verification |
| Isolation | Separate gold, review, and evidence indexes |
| Revalidation | Verification age and signed page metadata |
| Versioning and rollback | Source artifacts in Git; generated indexes rebuilt |
| Least privilege | Model writes Silver only; MCP reads Gold only; refine payloads are host-selected and bounded |
| Suspicious instruction handling | Preserved as evidence and always labeled non-instructional |
| Resource bounds | Adapter timeout and 1 MiB body caps; bounded refine reference; bounded query, result, and citation counts |

## Fail-closed behavior

Gold eligibility fails for:

- missing or invalid receipt
- untrusted key
- signature mismatch
- page mutation
- stale verification
- invalid Bronze lineage
- PII
- restricted sensitivity
- unapproved egress
- unresolved contradiction

Proposal corruption makes Silver and contradiction state unverifiable. Index schema,
chunk, provenance, trust-label, BM25, trust-policy, or live-corpus mismatch prevents
startup or the next search/read. Rebuilding from current authoritative artifacts is
required.

A corpus entry that is unreadable, lacks frontmatter, has invalid YAML, or fails its
schema is never admitted. It is reported by path with a category and structural
detail so an operator can repair it. Rejection diagnostics deliberately carry no file
content and no parsed values: for schema failures they name field paths and issue
codes only, so a restricted page is never quoted back through build output or logs.

A `config/clean-room.yaml` that exists but is unreadable, is not valid YAML, is not a
mapping, carries an unknown key, or carries a malformed list fails `ziggurat check`
with an actionable diagnostic. A release gate that silently defaults when its own
configuration is broken would report "clean" while ignoring every exclusion and
project name a human configured. An absent file still uses documented defaults.

## Provenance is not instruction authority

Every retrieved chunk carries `content_role: reference` and
`instruction_authority: none`; see
[provenance and authority](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/concepts/provenance-and-authority.md).

## Explicit non-guarantees and residual risks

- Ziggurat is not an OS sandbox or a multi-tenant authorization service.
- Arbitrary local filesystem access defeats application-level path and process
  boundaries. An attacker who replaces trust configuration and rebuilds can create a
  new trust root.
- The `visibility` field on a curated page is uninterpreted operator metadata. It is
  bound by the signature so a reviewer approves the exact label, but Ziggurat enforces
  no access control from it and it grants or denies nothing. Retrieval eligibility
  comes from status, `retrieval_eligible`, privacy, sensitivity, egress, verification
  age, lineage, contradictions, and the receipt.
- Path validation resolves real paths before use, but application-level checks cannot
  fully close time-of-check to time-of-use windows. An attacker able to swap vault
  directories concurrently with a command is inside the operator trust assumption,
  not outside it.
- `ingest` refuses a source with more than one hard link, because a hard link makes
  the deletion step ambiguous. On filesystems that report a link count above one for
  ordinary files, move the file into `inbox/` as a fresh copy.
- An AI process granted arbitrary shell, filesystem, or reviewer-key access is outside
  this boundary and can act with the authority the operator delegated to it.
- Stolen or misused reviewer private keys can authorize poisoned content.
- Human reviewers can make mistakes, collude, or approve false claims.
- Signatures do not detect semantic deception that a reviewer accepts.
- Gold text can still contain prompt injection; see
  [instruction authority](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/concepts/provenance-and-authority.md#3-instruction-authority).
- Review output intentionally displays untrusted content. Terminals and downstream
  renderers must not treat it as active markup or commands.
- No GUI review system is provided; review is a terminal rendering plus an external
  signing step.
- The implementation does not provide hardware key storage, revocation services,
  threshold approval, remote attestation, hosted identity, tenant isolation, or
  transport security.
- Git history can be rewritten by an operator with repository authority. Git is used
  for audit and rollback, not as the cryptographic admission signal.
- Availability attacks remain possible. Corrupt proposals or policy changes can
  intentionally force fail-closed denial of service.

## Key and incident handling

- Never store a reviewer private key in the vault. `ziggurat check` flags PEM private
  key material.
- Remove a compromised public key from `config/trust.yaml`, rebuild, and inspect all
  receipts issued by that key.
- Revoke poisoned memory by removing or correcting the page and receipt, committing
  the change, and rebuilding all indexes.
- Treat any unexpected proposal, receipt, trust-policy, or index change as a
  potential memory-poisoning incident.

Ziggurat ships no signer, apply, approve, or promote command; see the
[human authority boundary](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/concepts/human-authority-boundary.md).
