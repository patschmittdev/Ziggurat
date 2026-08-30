# Security

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
the trusted local operator, general communion clients, and advisory review/evidence
tooling. Advisory access does not establish human identity.

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
| Schema-bound memory | Strict Zod v4 contracts and unknown-field rejection |
| Review and diff visibility | Complete Silver candidates and evidence in `review` |
| Presentation sanitization | Candidate bodies are indented; quoted fields and control characters are escaped |
| Integrity | Receipt binding plus complete chunk, BM25, policy, and live-corpus verification |
| Isolation | Separate communion, review, and evidence indexes |
| Revalidation | Verification age and signed page metadata |
| Versioning and rollback | Source artifacts in Git; generated indexes rebuilt |
| Least privilege | Model writes Silver only; MCP reads communion only |
| Suspicious instruction handling | Preserved as evidence and always labeled non-instructional |

## Fail-closed behavior

Gold eligibility fails for missing or invalid receipt, untrusted key, signature
mismatch, page mutation, stale verification, invalid Bronze lineage, PII, restricted
sensitivity, unapproved egress, or unresolved contradiction.

Proposal corruption makes Silver and contradiction state unverifiable. Index schema,
chunk, provenance, trust-label, BM25, trust-policy, or live-corpus mismatch prevents
startup or the next search/read. Rebuilding from current authoritative artifacts is
required.

## Provenance is not instruction authority

Three different claims must not be conflated:

1. **Provenance:** these bytes match captured evidence.
2. **Persistence authorization:** a configured reviewer key approved this exact page.
3. **Instruction authority:** whether text may direct a model or tool.

Ziggurat implements the first two. It always sets the third to none. Gold is
approved reference data, not executable instruction and not guaranteed truth.

## Explicit non-guarantees and residual risks

- Arbitrary local filesystem access defeats application-level path and process
  boundaries. An attacker who replaces trust configuration and rebuilds can create a
  new trust root.
- An AI process granted arbitrary shell, filesystem, or reviewer-key access is outside
  this boundary and can act with the authority the operator delegated to it.
- Stolen or misused reviewer private keys can authorize poisoned content.
- Human reviewers can make mistakes, collude, or approve false claims.
- Signatures do not detect semantic deception that a reviewer accepts.
- Gold text can still contain prompt injection. Consumers must honor
  `instruction_authority: none`.
- Review output intentionally displays untrusted content. Terminals and downstream
  renderers must not treat it as active markup or commands.
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

The `--promote` flag does not exist and must not be added.
