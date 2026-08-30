# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are AI platform engineers and security engineers who are evaluating
durable-memory authority boundaries. They arrive while deciding whether persistent
agent memory can be governed at all, usually already familiar with prompt injection
and retrieval-augmented generation, and usually skeptical of claims that a review
step makes a write surface safe. Their job on this surface is to determine, quickly
and without running anything, whether Ziggurat's boundary is real, and then either
read the threat model or run the reference implementation.

Secondary users are maintainers and contributors who need task-oriented operating
documentation for ingest, refine, review, external authorization, communion, and
integrity recovery.

## Product Purpose

Ziggurat is a human-gated memory firewall: a local TypeScript reference
implementation that treats durable AI memory as a privileged write surface. A model
may read approved content and may draft a complete, evidence-backed candidate. It
cannot admit that candidate to durable shared memory. Only a human holding an
external Ed25519 private key can.

The documentation site exists so that a qualified evaluator understands, within one
viewport, that models may propose memory but cannot authorize persistence, and can
then move directly to the threat model or to running the implementation.

Success is an evaluator who can restate the boundary accurately, including its
limits, without having been told anything untrue.

## Positioning

The human boundary is a cryptographic capability boundary, not a review convention
and not a model-accessible workflow step. Gold admission requires a detached Ed25519
receipt from a key configured in `config/trust.yaml`. There is no signer, apply,
approve, or promote command and no `--promote` flag; key custody lives outside the
vault by design. A `reviewed_by: alice` string is metadata, not authority.

A neighboring product cannot truthfully copy this claim while shipping a promote
path, because the absence of the capability is the mechanism.

## Operating Context

Evaluation happens in a browser, often alongside the repository itself, frequently
in a dark editor-adjacent environment and sometimes on a phone away from a machine.
Operation happens in a terminal against a local vault directory, with the model
endpoint restricted to HTTP loopback.

The pipeline the documentation must explain:

1. `ingest` captures untrusted `inbox/` Markdown as immutable, body-hash-verified
   Bronze evidence, preserving hostile text because Bronze is evidence, not memory.
2. `refine` sends a bounded, labeled, host-selected Bronze reference block to a
   loopback model and stages exactly one strict schema-version-2 Silver proposal.
3. `review` renders the complete candidate, exact citations, and contradictions for
   a human, marking untrusted text as non-instructional reference.
4. A human authors the knowledge page by hand and signs a detached receipt with an
   external Ed25519 key, following `docs/authorization-protocol.md`.
5. `build` rebuilds three physically separate indexes: communion (authorized Gold
   only), review (policy-safe Silver plus Gold), evidence (policy-safe Bronze plus
   Gold).
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
- Models write exactly one artifact type: strict v2 Silver under
  `.ziggurat/proposals/`. No model path writes Bronze, knowledge pages, reviewed
  metadata, trust anchors, receipts, or indexes.
- Every Silver citation is revalidated against real Bronze bytes, hashes, and line
  ranges on disk.
- Model and embedding endpoints are HTTP loopback only. The refine adapter, which is
  the only shipped caller, additionally refuses redirects and enforces a 30 second
  deadline with 1 MiB request and response ceilings.
- Retrieval bounds: 1024 query characters, 20 results per search, 200 retained
  citations per session, with eviction acting as revocation.
- Version 0.1 is a pre-release, single-operator reference implementation.
  `package.json` stays `private: true` and the project is source-distributed; the
  `ziggurat` npm package name must not be depended on.
- Named non-guarantees must remain visible: not an OS sandbox, not multi-tenant
  authorization, no key custody or revocation service, no hosted identity, no
  transport security, no GUI review system. A stolen key, a compromised reviewer, or
  an inattentive approval can authorize harmful content. Approved text can still
  contain prompt injection.

Documentation-site constraints:

- The repository is intentionally private and stays private. Nothing may deploy.
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

## Brand Commitments

- Name: Ziggurat. Thesis line: "Models propose. Humans decide what persists."
- The historical metaphor stays implicit. The stepped form and summit may be used
  visually; the copy stays technical. No faux-ancient or religious styling.
- Tier vocabulary is fixed: Bronze, Silver, Gold, communion, review, evidence.
- Reference for explanatory discipline only, never for reuse: metaharness.tools, for
  its generous pacing, integrated systems diagrams, and long-form narrative. None of
  its branding, layout, assets, code, or prose may be copied.
- Precise trust language is a brand commitment. Overclaiming is a defect, not a
  stylistic choice.

## Evidence on Hand

Real material that exists in this repository and may be shown:

- `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `docs/authorization-protocol.md`,
  `docs/release-checklist.md`, `CONTRIBUTING.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md`.
- `fixtures/garden/inbox/poisoned-memory-rule.md`, a plausible memo instructing an AI
  to skip review and remember a vendor as approved.
- `test/memory-boundary.test.ts`, which demonstrates the complete defense end to end.
- `scripts/run-garden-walkthrough.mjs`, which stops at the human signing boundary.
- `fixtures/authorization/receipt-vectors.json`, published interoperability vectors.
- Microsoft's
  [AI Memory / Context Poisoning](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/ai-memory-context-poisoning)
  catalog entry, which is the external threat description this work implements
  controls for.

Absences that must not be fabricated: no users, no deployments, no third-party
audits, no benchmarks, no testimonials, no press, no release tag.

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

## Accessibility & Inclusion

WCAG 2.2 AA is the required standard: contrast, semantic landmarks and headings, a
skip link, full keyboard operation, visible focus, adequate target sizes, no
hover-only information, and useful accessible names.

Every narrative fact must remain readable with JavaScript disabled. Motion is
progressive enhancement only; `prefers-reduced-motion` is honored and scroll-jacking
is prohibited. Light and dark themes must both be deliberate and legible.
