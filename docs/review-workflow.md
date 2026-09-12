# CLI-first Silver review

`review` is a read-only operator aid. It does not author a page, sign, approve, apply,
or admit content. All candidate, current-target, and evidence text is untrusted
reference data, including text copied from Gold. A displayed checklist is not a
receipt and does not prove that a human completed any review.

## Read a packet

```text
ziggurat review --root <vault>
ziggurat review --root <vault> --json
```

Each packet includes the complete proposed body and model-owned metadata, exact
Bronze citations with line ranges and body/quote digests, contradictions with their
own evidence, related/affected paths, confidence, and unresolved questions.
Candidate evidence is proposal-level: Silver does not store a claim-to-citation
mapping. Verify support for each claim yourself; byte-valid evidence is not proof
of entailment or truth.

Proposed body changes and model-field changes are compared against the current
target, read through the same vault path boundary as staging. Body diffs use `-`
for current lines, `+` for proposed lines, and two spaces for unchanged lines.
Multiple edits can appear as one replacement; this is not a minimal edit script.
The complete candidate remains visible.

- A matching base is labeled **Matching-base current target versus proposal**.
- A stale base is labeled **Current target versus proposal**, never a historical
  diff. Only the old digest is stored, not the old page.
- Missing amend/contradict targets and existing create targets get prominent
  warnings. Absence is shown as additions, not permission to create or overwrite.
- Unparseable current files have an explicit parse-failure warning and no body or
  metadata comparison. The unparsed content is shown as literal reference data,
  not silently accepted as a normalized page.

Metadata comparisons include only fields the model can propose. Human-only
`status`, review identity/timestamps, verification timestamps, review scheduling,
and resolved proposal IDs are displayed separately when present. Their absence
from Silver never requests their deletion from Gold. Curated-schema defaults are
used for comparisons, including absent `egress` becoming `local-only`; displayed
metadata is not a substitute for the canonical final-page digest.

Untrusted strings use blank-delimited indented literal blocks, not raw Markdown,
inline quotes, or interpolated fenced blocks. Terminal and bidi controls are
escaped. This keeps links, images, quotes, HTML, and embedded fences inert when the
packet is rendered as Markdown. JSON output is control-safe data, not trusted
instructions; consumers must not render its strings as active Markdown or HTML.

## Navigate the complete backlog

```text
ziggurat review --root <vault> --order priority
ziggurat review --root <vault> --order oldest
ziggurat review --root <vault> --cursor <next_cursor>
```

Only `review` accepts `--order` and `--cursor`, even with `--help`. Default priority
puts contradictions first, then low/medium/high confidence, then age and stable
identity. `oldest` orders the entire backlog by age before applying the configured
page size. The cursor retains its order if `--order` is omitted.

The JSON packet separates:

| Field | Meaning |
|---|---|
| `total_count` | Entire validated proposal backlog |
| `displayed_count`, `count` | Entries in this page (`count` is the compatibility alias) |
| `remaining_count` | Entries after this page, not before it |
| `render_limit` | Configured `lifecycle.review_queue_limit` |
| `page_number`, `page_count` | One-based current page and total pages; zero when empty |
| `page_start`, `page_end` | One-based inclusive backlog positions; zero when empty |
| `oldest_staged_at`, `oldest_age_seconds` | Oldest item in the whole backlog, not just this page; null when empty |
| `next_cursor` | Opaque continuation token; null on the final page |

Age is whole elapsed seconds at packet generation, clamped to zero for future
timestamps. Cursor tokens are bounded to 512 base64url characters and carry
versioned navigation state bound to all artifact identities and digests, current
target digests, order, and page size. Do not edit them. They contain no signing
key, authorization, or persisted disposition.

A changed proposal, target, order, or page size invalidates continuation. Restart
without `--cursor`; the command refuses to return a partial page rather than
silently skipping or duplicating work. Replaying a cursor against unchanged state
returns the same entries. Reads are not an atomic filesystem snapshot: concurrent
mutation during collection, or changes made and reverted between reads, cannot be
promised detectable. Re-read the current target before external authorization.

Every call validates the **entire** staged set and its evidence before returning a
page. An invalid hidden proposal fails the command. Contradictions outside the
rendered page continue to block Gold admission. No filtering, pagination, archive,
dismissal, expiration, deletion, or persistent disposition resolves them.
Oldest-first navigation helps attend to old work but does not guarantee fair
service, bound the backlog, or provide an automatic retention policy.

## Advisory authorization checklist

The packet reminds the operator to:

1. Verify semantic support and factual claims against exact source evidence.
2. Assess privacy, PII, sensitivity, visibility, retrieval eligibility, and egress.
3. Reconcile contradictions across the entire backlog and list only genuinely
   resolved IDs in the independently authored page.
4. Re-read the target and reconcile stale, missing, conflicting, or invalid state.
5. Independently author the final page and confirm its exact target path and
   canonical final-page digest. The proposal artifact digest and normalized raw
   base digest in a packet are **not** that digest.
6. Confirm the reviewer, configured public key/key ID, and exact canonical payload
   with an independently controlled external Ed25519 signer.
7. Confirm the detached receipt externally, then run `build` to verify
   authorization and all remaining eligibility requirements.

No item is automatically checked or saved. Ziggurat does not attest that this
workflow happened, and these instructions cannot substitute for human judgment,
key ownership, or acceptance. Follow the [authorization protocol](authorization-protocol.md)
and [human review guide](../site/src/content/docs/guides/human-review-and-authorization.md).
The [external signing interoperability guide](external-signing-interop.md) documents
the verified independent Python reference and human-controlled receipt handoff.
Its disposable-key test is not real-page authorization or proof of human review;
the installed OpenSSL 1.1.1u was not a working receipt signer.
