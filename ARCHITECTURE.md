# Ziggurat Architecture

## Authority Model

| Actor | Bronze | Silver | Gold |
|-------|--------|--------|------|
| ingest | write (immutable) | none | none |
| refine | read (evidence) | propose only | none |
| build | read | read | index |
| query | none | none | read |
| **human** | **review** | **review** | **promote** |

No automated actor may write `status: reviewed` metadata.
Gold promotion is represented by a human-authored metadata change and its Git commit.

## Profile Boundaries

Three physically separate indexes enforce profile boundaries at startup:

1. **communion** (`gold-index.json`): Gold-only, `pii: false`, non-restricted, non-stale pages.
   Normal answer-producing clients. Fingerprint verified on every search.

2. **review** (`review-index.json`): Silver + Gold pages with explicit tier labels.
   Human reviewers and review tooling only. No Bronze text included.

3. **evidence** (`evidence-index.json`): Valid Bronze records + labeled curated context.
   Evidence-tracing workflows. No PII-unknown or PII-true content included.

## Data Flow

```
Inbox -> ingestCapture -> bronze/ (immutable, hash-verified)
                                   |
                    stageProposal --+-> .ziggurat/proposals/ (validate evidence, atomic write)
                                   |
            goldEligibilityReport --+-> buildGoldIndex -> .ziggurat/gold-index.json
                                                                  |
                                              createContextAccess --+-> search_context / read_context
```

## Invariants

- Every Bronze body hash is verified on read and write.
- Every evidence citation is validated against the Bronze body before staging.
- Gold eligibility fails closed: any failed contract excludes the page.
- Profile is fixed at server creation; no tool argument can override it.
- Citation IDs are per-session UUIDs; cross-session reads are rejected.
- Index fingerprint is verified on every search call.
