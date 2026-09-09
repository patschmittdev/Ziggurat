# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are AI platform engineers and security engineers who are evaluating
durable-memory authority boundaries. They arrive deciding whether persistent agent
memory can be governed at all. Most already know prompt injection and RAG, and are
skeptical that a review step makes a write surface safe. Their job on this surface is
to determine, quickly and without running anything, whether Ziggurat's boundary is
real, and then either read the threat model or run the reference implementation.

Secondary users are maintainers and contributors who need task-oriented operating
documentation for ingest, refine, review, external authorization, communion (the
Gold-only retrieval index), and integrity recovery.

## Product Purpose

Ziggurat is a human-gated memory firewall: a local TypeScript reference
implementation that treats durable AI memory as a privileged write surface. A model
may read authorized content and return a candidate with byte-validated citations. The
refine host may persist that model-originated JSON only as Silver. Gold admission
requires a valid receipt from a configured Ed25519 key that operator policy assigns to
a reviewer. Ziggurat verifies key control and exact-content authorization; it does not
prove humanity, attention, review quality, semantic support, or factual truth.

The documentation site exists so that a qualified evaluator understands, within one
viewport, that models may propose memory but cannot authorize persistence, and can
then move directly to the threat model or to running the implementation.

Success is an evaluator who can restate the boundary accurately, including its
limits, without having been told anything untrue.

## Positioning

The authorization boundary is a cryptographic capability boundary, not a review
convention. Gold admission requires a detached Ed25519 receipt from a key configured
in `config/trust.yaml`. No shipped path creates authorization, signs receipts, or
applies Silver to knowledge. There is no signer, apply, approve, or promote command
and no `--promote` flag. A `reviewed_by: alice` string is self-asserted metadata and is
insufficient by itself.

Comparators, stated once and honestly: mem0, Letta, and Zep persist model-originated
memory automatically (LLM-decided writes, agent-edited memory blocks, automatic fact
extraction respectively) and are stronger than Ziggurat at hosted, multi-tenant
retrieval. Ziggurat's single differentiating claim is the human authorization gate as a
cryptographic capability. Documentation may name these comparators only with that
framing, dated to when their behaviour was checked, and never as integrations.

## Operating Context

Evaluation happens in a browser, often alongside the repository itself, frequently
in a dark editor-adjacent environment and sometimes on a phone away from a machine.
Operation happens in a terminal against a local vault directory, with the model
endpoint restricted to HTTP loopback.

The pipeline the documentation must explain:

1. `ingest` captures untrusted `inbox/` Markdown as canonical UTF-8 Bronze evidence
   after CRLF-to-LF normalization. Its API uses atomic no-overwrite creation, and
   SHA-256 verification detects later body mutation.
2. `refine` sends a bounded, labeled, host-selected Bronze reference block to a
   loopback model. The host validates and persists one model-originated strict
   schema-version-2 Silver proposal.
3. `review` renders the complete candidate, exact citations, and contradictions for
   a human, marking untrusted text as non-instructional reference.
4. In the recommended workflow, a reviewer independently checks the citations, authors
   the knowledge page, and uses an external Ed25519 signer following
   `docs/authorization-protocol.md`. Ziggurat does not enforce that workflow as proof
   of human attention.
5. `build` rebuilds three physically separate indexes: communion (eligible,
   externally key-authorized Gold only), review (Silver whose candidate and every
   source pass model-access privacy filters, plus Gold), and evidence (Bronze that
   passes integrity and model-access privacy filters, plus Gold).
6. `mcp` serves communion only, read only, exposing `search_context` and
   `read_context`.

## Capabilities and Constraints

Confirmed product facts the site must preserve exactly:

- Gold means authorized reference data. It never means factual truth, divine
  authority, or instruction authority. Every retrieved chunk, Gold included, reports
  `content_role: reference` and `instruction_authority: none`.
- Three claims stay distinct: provenance (bytes match captured evidence),
  persistence authorization (a configured key approved this exact page), and
  instruction authority (always none).
- The refine host persists exactly one model-originated artifact type: strict v2
  Silver JSON under `.ziggurat/proposals/`. It does not write Bronze, knowledge pages,
  reviewed metadata, trust anchors, receipts, or indexes.
- Every Silver citation is revalidated against stored Bronze text, hashes, and line
  ranges on disk. This establishes citation integrity, not semantic entailment or
  factual truth.
- Model and embedding endpoints are HTTP loopback only. The refine adapter, which is
  the only shipped caller, additionally refuses redirects and enforces a 30 second
  deadline with 1 MiB request and response ceilings.
- Retrieval bounds: 1,024 query UTF-16 code units, 20 results per search, and 200
  retained citations per session; evicted IDs become invalid.
- Version 0.1 is a pre-release, single-operator reference implementation.
  `package.json` stays `private: true` and the project is source-distributed; the
  `ziggurat` npm package name must not be depended on.
- Named non-guarantees must remain visible: not an OS sandbox, not multi-tenant
  authorization, no key custody or revocation service, no hosted identity, no
  transport security, no GUI review system. A stolen key, a compromised reviewer, or
  an inattentive approval can authorize harmful content. Approved text can still
  contain prompt injection.

Documentation-site constraints:

- At this commit the repository is private, and the Pages workflow remains inert. A
  later public release may deploy only after visibility is explicitly public and the
  publication checklist passes.
- `SECURITY.md`, `ARCHITECTURE.md`, and `docs/authorization-protocol.md` remain
  canonical repository specifications at their existing paths. Site pages explain and
  link to them rather than copying their full text.
- The eventual public target is `https://patschmittdev.github.io/Ziggurat/` with base
  `/Ziggurat/`.
- Static output only. No analytics, cookies, backend, CMS, hosted signer, custom
  domain, or third-party runtime scripts, fonts, or assets.
- No editable simulator in v1.
- Documentation dependencies live in a standalone project under `site/` so the core
  runtime package is unaffected.

Undecided and deliberately not invented: adoption numbers, users, benchmarks,
funding, roadmap dates, and any production-maturity claim.

## Design and brand

Visual, brand, and accessibility rules live in DESIGN.md.

## Evidence on Hand

DESIGN.md is a design-token specification for the site, not evaluator reading.

Real material that exists in this repository and may be shown:

- `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `docs/authorization-protocol.md`,
  `docs/release-checklist.md`, `CONTRIBUTING.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`.
- `fixtures/garden/inbox/poisoned-memory-rule.md`, a plausible memo instructing an AI
  to skip review and remember a vendor as approved.
- `test/memory-boundary.test.ts`, which demonstrates the complete defense end to end.
- `scripts/run-garden-walkthrough.mjs`, which prepares and ingests the fixture vault,
  then prints the remaining manual steps.
- `fixtures/authorization/receipt-vectors.json`, published interoperability vectors.
- Microsoft's
  [AI Memory / Context Poisoning](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/ai-memory-context-poisoning)
  catalog entry, which is the external threat description this work implements
  controls for.

Absences that must not be fabricated: no documented users or adoption figures, no known
deployment, no third-party audit, no benchmark, no testimonial, no press, and no release
tag.

## Product Principles

1. **The boundary is a capability, not a policy.** Anything the site says about
   authority must reduce to a key the software cannot reach.
2. **Never launder authorization into truth.** Gold is authorized reference data.
   Saying more than that would break the product's central claim.
3. **Show the mechanism, do not assert it.** Preference goes to the real fixture, the
   real receipt, the real failure, over adjectives.
4. **Name the limits beside the guarantees.** Residual risk is part of the pitch,
   because the audience discounts anything that hides it.
5. **The reader must be able to verify.** Every claim on the site traces to a file,
   a command, or a test in this repository.
