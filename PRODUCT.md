# Product

> Maintainer material: the product schema the documentation site is written against.
> Evaluators should read README.md, SECURITY.md, and ARCHITECTURE.md instead.

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are AI-platform and security engineers evaluating whether durable agent
memory can be governed. Secondary users are contributors who need operating documentation.

## Product Purpose

Ziggurat is a human-gated memory firewall: a local TypeScript reference
implementation that treats durable AI memory as a privileged write surface. A model
may read authorized content and return a strict version-1 refinement draft with source
IDs and line ranges. The refine host derives canonical citations and version-2 Silver,
then validates and persists only that Silver artifact. Gold admission
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
in `config/trust.yaml`. Ziggurat ships no signer, apply, approve, or promote
command; see the
[human authority boundary](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/concepts/human-authority-boundary.md).
A `reviewed_by: alice` string is self-asserted metadata and is insufficient by
itself.

Comparisons describe capabilities, not unmeasured superiority. Mem0 supports automatic
memory extraction, Letta supports agent-editable memory blocks, and Zep extracts facts
into a context graph. Ziggurat does not offer hosted, multi-tenant retrieval; its
differentiator is separately configured key authorization before admission. Link
vendor capability statements to the primary documentation listed in the overview.
Do not claim comparative quality or historical verification without evidence, and
never present these products as integrations.

## Operating Context

Evaluation happens in a browser, often alongside the repository itself, frequently
in a dark editor-adjacent environment and sometimes on a phone away from a machine.
Operation happens in a terminal against a local vault directory, with the model
endpoint restricted to HTTP loopback.

The pipeline the documentation must explain:

1. `ingest` captures untrusted `inbox/` Markdown as canonical UTF-8 Bronze evidence
   after CRLF-to-LF normalization. Its API uses atomic no-overwrite creation, and
   SHA-256 verification detects later body mutation.
2. `refine` sends a bounded, labeled, host-selected Bronze reference block and optional
   host-read `--target` context to a loopback model. The model returns a strict
   `RefinementDraft` v1. The host derives canonical citations, hashes, lineage, and target
   base state, then validates and persists one strict schema-version-2 Silver proposal.
3. `review` renders the complete candidate, exact citations, and contradictions for
   a human, marking untrusted text as non-instructional reference.
4. In the recommended workflow, a reviewer independently checks the citations, authors
   the knowledge page, and uses an external Ed25519 signer following
   `docs/authorization-protocol.md`. Ziggurat does not enforce that workflow as proof
   of human attention.
5. `build` rebuilds three physically separate indexes: gold (eligible,
   externally key-authorized Gold only), review (Silver with candidate `pii: false`
   and every Bronze source PII-false, non-restricted, and hash-verified, plus Gold),
   and evidence (Bronze that
   passes integrity and model-access privacy filters, plus Gold).
   The Silver addition has no candidate-sensitivity or egress gate.
6. `mcp` serves Gold only, read only, exposing `search_context` and
   `read_context`.

## Capabilities and Constraints

Confirmed product facts the site must preserve exactly; the
[guarantees page](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/security/guarantees.md)
owns their explanation:

- Every retrieved chunk carries `content_role: reference` and
  `instruction_authority: none`; see
  [Gold's limits](https://github.com/patschmittdev/Ziggurat/blob/main/site/src/content/docs/concepts/provenance-and-authority.md).
- Distinct claims: provenance, persistence authorization, and instruction authority.
- Model output: strict `RefinementDraft` v1 with source IDs and line ranges, not complete
  Silver or model-calculated hashes. Only supplied reference bytes may be cited.
- Refine storage: one model-originated artifact type, host-materialized strict v2 Silver
  JSON under `.ziggurat/proposals/`; no writes to Bronze, knowledge pages, reviewed
  metadata, trust anchors, receipts, or indexes.
- `--target` supplies host-read existing page context and is required for amend and
  contradict. Explicit `--source` remains an operator-authorized privacy disclosure.
- Every Silver citation is revalidated against stored Bronze text, hashes, and line
  ranges on disk; no semantic entailment or factual truth guarantee.
- Model endpoint: HTTP loopback only; refine is the only shipped
  caller, with no redirects, a 30 second deadline, and 1 MiB request and response
  ceilings.
- Supported adapter: llama.cpp non-streaming `POST /v1/chat/completions`, a Zod-derived
  schema nested under `response_format.json_schema` with name
  `ziggurat_refinement_draft` and `strict: true`, `max_tokens: 2048`, `temperature: 0`, and one finished
  assistant text response. No repair, fallback, retries, or tool calls. Optional
  `adapters.model_name` defaults to `ziggurat-refine`.
- Draft v1 is not a storage migration: stored Silver and indexes remain v2, external
  authorization receipts remain v1, and shipped MCP remains Gold-only and read-only.
- Retrieval bounds: 1,024 query UTF-16 code units, 20 results per search, and 200
  retained citations per session; evicted IDs become invalid.
- Version 0.1: pre-release, single-operator, source-distributed;
  `package.json` stays `private: true`; the
  `ziggurat` npm package name must not be depended on.
- Named non-guarantees must remain visible: not an OS sandbox, not multi-tenant
  authorization, no key custody or revocation service, no hosted identity, no
  transport security, no GUI review system. A stolen key, a compromised reviewer, or
  an inattentive approval can authorize harmful content. Approved text can still
  contain prompt injection.

Documentation-site constraints:

- The repository and Pages documentation are public. The Pages workflow still
  refuses deployment unless repository visibility is explicitly public.
  No tagged prerelease is authorized in the current source/docs-only publication.
- `SECURITY.md`, `ARCHITECTURE.md`, `docs/authorization-protocol.md`, and
  `docs/local-model-protocol.md` remain
  canonical repository specifications at their existing paths. Site pages explain and
  link to them rather than copying their full text.
- The eventual public target is `https://patschmittdev.github.io/Ziggurat/` with base
  `/Ziggurat/`.
- Static output only. No analytics, cookies, backend, CMS, hosted signer, custom
  domain, or third-party runtime scripts, fonts, or assets.
- No editable simulator in v1.
- Documentation dependencies live in a standalone project under `site/` so the core
  runtime package is unaffected.

Undecided and deliberately not invented: adoption numbers, users,
funding, roadmap dates, and any production-maturity claim.

## Design and brand

Visual, brand, and accessibility rules live in DESIGN.md.

## Evidence on Hand

DESIGN.md is a design-token specification for the site, not evaluator reading.

Real material that exists in this repository and may be shown:

- `README.md`, `ARCHITECTURE.md`, `SECURITY.md`, `docs/authorization-protocol.md`,
  `docs/local-model-protocol.md`, `docs/release-checklist.md`, `CONTRIBUTING.md`,
  `SUPPORT.md`, `CODE_OF_CONDUCT.md`.
- `fixtures/garden/inbox/poisoned-memory-rule.md`, a plausible memo instructing an AI
  to skip review and remember a vendor as approved.
- `test/memory-boundary.test.ts`, which demonstrates the complete defense end to end.
- `scripts/run-garden-walkthrough.mjs`, which prepares and ingests the fixture vault,
  then prints the remaining manual steps.
- `fixtures/authorization/receipt-vectors.json`, published interoperability vectors.
- `docs/model-workflow-evaluation.md`, `docs/retrieval-evaluation.md`,
  `docs/operating-envelope.md`, and `docs/external-signing-interop.md`, which record
  bounded development measurements, failures, and unverified acceptance criteria.
- Microsoft's
  [AI Memory / Context Poisoning](https://learn.microsoft.com/en-us/security/zero-trust/catalog-ai-attack-techniques/ai-memory-context-poisoning)
  catalog entry, which is the external threat description this work implements
  controls for.

Absences that must not be fabricated: no documented users or adoption figures, no known
deployment, no third-party audit, no production benchmark, no testimonial, no press,
and no release tag. Development measurements are not production or adoption evidence.

The opt-in `npm run eval:model` gate targets 30 cases across create, amend, and
contradict, three runs each: 90 attempts without retries. Acceptance requires at least
81 staged proposals, 72 human-scored usable proposals, and at least one usable example
of each operation. A pinned setup candidate or machine staging result is not a passed
quality gate. Missing actual human scores leave
the gate pending; do not present intended versions, thresholds, or fixtures as measured
model performance. Setup and protocol pilot probes are excluded from the frozen 90
attempts and cannot replace failed evaluation attempts.

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
