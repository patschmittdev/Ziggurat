# Runtime policy enforcement

`goldEligibilityReport` in `src/review/eligibility.ts` owns the complete Gold
decision. A receipt verifier proves authorization; it does not independently
admit a page. Profile builders consume the same Gold decision and add only their
own advisory artifacts. Gold remains non-instructional reference data.

## Enforcement map

| Rule | Runtime owner | Stable reason codes |
| --- | --- | --- |
| Reviewed status and retrieval flag | `goldEligibilityReport` | `gold.status`, `gold.retrieval-eligible` |
| PII false, sensitivity not restricted, approved-cloud egress | `goldEligibilityReport` | `gold.pii`, `gold.sensitivity`, `gold.egress` |
| Reviewer identity metadata present | `goldEligibilityReport` | `gold.reviewer-required` |
| Review timestamp present, valid, not future | `goldEligibilityReport` | `gold.reviewed-at-required`, `gold.reviewed-at-invalid`, `gold.reviewed-at-future` |
| Verification timestamp present, valid, not future, no older than 90 days | `goldEligibilityReport` | `gold.last-verified-required`, `gold.last-verified-invalid`, `gold.last-verified-future`, `gold.last-verified-stale` |
| Optional re-review timestamp valid and strictly after request time | `goldEligibilityReport` | `gold.review-after-invalid`, `gold.review-after-due` |
| Nonempty Bronze lineage | `goldEligibilityReport` | `gold.sources-required` |
| Normalized source paths, readable within Bronze, strict frontmatter and matching declared body hash | Lineage verification inside `goldEligibilityReport` | `lineage.path-invalid`, `lineage.unreadable`, `lineage.missing-frontmatter`, `lineage.invalid-yaml`, `lineage.schema-invalid`, `lineage.hash-mismatch` |
| Detached strict receipt, target/content/reviewer/timestamp binding | `verifyPageAuthorization` | `authorization.receipt-unreadable`, `authorization.receipt-schema-invalid`, `authorization.target-mismatch`, `authorization.content-mismatch`, `authorization.reviewer-mismatch`, `authorization.reviewed-at-mismatch` |
| Configured trusted Ed25519 public key and canonical valid signature | `verifyPageAuthorization` | `authorization.key-untrusted`, `authorization.key-invalid`, `authorization.key-algorithm`, `authorization.signature-encoding`, `authorization.signature-invalid` |
| No unresolved contradiction; signed resolution only; unknown state fails closed | `goldEligibilityReport`, using the contradiction index | `gold.contradictions-unresolved`, `gold.contradictions-unverifiable` |
| Default model sources: PII false, not restricted, verified hash | `src/policy/model-source.ts` | `model-source.pii`, `model-source.sensitivity`, `model-source.hash-unverified` |

The previous `canTransition`, `classifyTier`, `goldExclusionReasons`, and
`contextExclusionReasons` policy abstractions had no runtime callers. They and
their competing incomplete Gold/lifecycle rules were removed. Tests now exercise
the real eligibility path and the three builders, not a parallel policy model.

## Profiles and explicit source selection

The physically separate indexes remain:

* **Gold:** only currently eligible, receipt-authorized curated pages.
* **Review:** the same Gold subset plus policy-safe staged Silver. The candidate
  must have PII false and all its Bronze sources must pass the shared source rule.
* **Evidence:** the same Gold subset plus Bronze passing the shared source rule.

Default refinement uses that source rule through the existing thin re-export
from `profile-index.ts`. Explicit operator `--source` selection still bypasses
the default privacy filter, but does not bypass provenance verification or
reference size/count bounds. No new override or authority is introduced.

Gold lineage verifies provenance, not Bronze privacy suitability for direct
model access. A signed Gold page referencing restricted Bronze is not newly
excluded: Gold's own privacy and authorization rules remain authoritative. Nor
does the advisory Silver policy acquire a new candidate-sensitivity or egress
gate. These are preservation statements, not endorsements to relax defaults.

Shipped MCP stays Gold-only and read-only. None of these helpers writes review
metadata, receipts, trust configuration, Bronze, or knowledge. A configured
external human key and detached receipt remain mandatory for admission.

## Diagnostics and compatibility

Reports retain lexically sorted `reasons: string[]` and add `reason_details`,
containing typed `code`, safe `message`, and optional schema `field` and artifact
`path`. Authorization details flow unchanged into the Gold decision. The build
JSON adds `gold_decisions`, one entry per successfully parsed curated page,
including accepted pages with empty reason arrays. Parse failures remain in
`rejected_corpus_entries`. Human build output shows exclusion codes and reasons.

Paths are reference data; terminal consumers must render them inertly.
Diagnostics do not contain document text, rejected values, arbitrary YAML
messages, raw exception messages, key material, or signatures. Unknown YAML
field names can themselves contain private data, so strict-schema diagnostics
report schema-owned field paths or `<root>`, not unknown input keys.

Receipt schema v1, signing payload, canonical receipt/page bytes, hashes, and
published interop vectors are unchanged. Display strings remain compatible
except that unverifiable contradiction errors no longer interpolate raw
exceptions. Machine consumers should switch on codes rather than message text.

Corpus collection, evidence verification, and lineage share their actual frontmatter parsing:
CRLF normalization, closed frontmatter blocks, YAML parsing, and strict schema
validation. Duplicate YAML keys still fail. Schema-invalid Bronze stays
restricted/unknown and hash-unverified; it is never admitted by the fallback.

## Request-local reuse and limits

Build owns one configuration and `asOf` timestamp, collects Bronze and proposals,
and calls `collectEligibleGoldChunks` once. That returns Gold chunks, per-page
decisions, configuration, and time. Build reuses this collection across all three
index writes. `built_at` is the same decision time for all profiles.

`BuildGoldIndexOptions.bronze` and `bronzeRejections` accept freshly collected
Bronze records and diagnostics. A single `createGoldEligibilityContext` builds
path lookups for that operation. Verified source digests are returned in the
eligibility report so chunk construction no longer rereads/reparses lineage.
Sources not enumerated by the normal Markdown collector still use the existing
real-path resolver and parser; valid non-Markdown or in-Bronze symbolic-link
sources do not silently change eligibility. Repeated fallback source checks are
memoized only inside that collection operation.

These are internal request inputs, not an authorization boundary or durable
cache. Never reuse a Gold collection or eligibility context across requests or
roots. Every next request must load current configuration, pages, receipts,
proposals, and required Bronze evidence and choose a new request time. Do not
substitute filesystem generation counters or old index chunks for verification.
This does not create an atomic filesystem snapshot; concurrent external edits
can still span reads. Nor does it eliminate receipt reads, signature checks,
proposal evidence validation, or all filesystem I/O. Performance acceptance must
be measured separately on the supported operating envelope.

Corpus file reads and independent Gold eligibility/receipt checks use
`mapCorpusReads`, with at most 32 active tasks per collection. Directory discovery
remains bounded and sequential; Bronze file reads are then pooled across the
discovered paths, not through recursively multiplied pools. Results and
rejections are sorted deterministically. Unexpected failures stop scheduling
new work and drain in-flight reads before rejecting. These are concurrent
asynchronous reads, not worker-thread YAML parsing or relaxed verification.
Separately orchestrated collections may run their own pools concurrently.

For live verification, create `createVerifiedBronzeReader(root)` from
`src/refine/evidence.ts` once per request and pass it as `{ bronzeReader }` to
`collectStagedProposals` and the Gold/profile collectors. Gold collection does
this itself when it also owns proposal collection. Every default public call
creates fresh state; separately orchestrated steps must explicitly pass the same
reader to share reads.

The reader lazily resolves each unique source within the actual Bronze root,
reads strict frontmatter and body bytes, verifies the declared digest, and
retains immutable record/body/line data only for that request. It rejects use
with a different vault root and exposes no cache insertion or arbitrary-byte
seeding method. A supplied reader takes precedence over collected record
shortcuts for Gold lineage. Its independent limiter permits at most 32 active
unique source reads even when proposal and Gold checks overlap.

All staged Silver is still schema- and evidence-validated, including create and
amend proposals with no contradictions. Cached verified bodies do not cache
citation decisions: each citation still checks its own body digest, inclusive
integer line range, exact quote, and quote digest. Proposal output remains
lexically ordered, and failed scans drain pending work before rejection. Gold
need not scan unrelated Bronze records; the reader loads cited evidence only.
No reader may survive into the next request, and no filesystem generation or
TTL substitutes for current bytes.

The table-driven tests in `test/policy.test.ts` cover actual Gold and profile
outcomes, typed denials, source access and explicit privacy override, and
between-request mutations. Authorization vector tests protect signed-byte
compatibility; index-boundary and corpus-diagnostics tests protect build output
and safe strict parsing. These automated checks do not mark human review or
external-key-boundary operational acceptance as passed.
