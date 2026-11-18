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

## Request-local reuse and limits

Build uses one configuration and decision time across all three indexes. Gold collection and live verification share verified Bronze reads within one root-bound request only. Every new request reloads configuration, receipts, proposals, required evidence, and time. This is neither a durable cache nor an atomic filesystem snapshot.

Collections permit at most 32 active reads/checks; separately orchestrated collections may have separate pools. Discovery stays sequential. Failures stop scheduling and drain pending work; results are deterministic. Every staged proposal and citation still validates, including create and amend proposals with no contradictions. Unrelated Bronze need not be scanned for Gold. Reuse never substitutes generation counters or TTL for current bytes, receipt reads, signatures, or evidence checks.

See the [operating envelope](operating-envelope.md) for performance evidence and the [threat model](../site/src/content/docs/security/threat-model.md) for remaining limits. Automated policy, authorization-vector, index-boundary, and corpus-diagnostic tests do not establish human review or external-key operational acceptance.
