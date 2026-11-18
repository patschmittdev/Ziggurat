# CLI-first Silver review

`review` is read-only. It does not author a page, sign, approve, apply,
or admit content. Candidate, target, and evidence text is untrusted
reference data, including Gold. A checklist is not a
receipt and does not prove that a human completed any review.

## Read a packet

```text
ziggurat review --root <vault>
ziggurat review --root <vault> --json
```

Each packet includes the proposed body and model-owned metadata, exact
Bronze citations with line ranges and body/quote digests, contradictions with their
own evidence, related/affected paths, confidence, and unresolved questions.
Candidate evidence is proposal-level: Silver does not store a claim-to-citation
mapping. Verify support for each claim yourself; byte-valid evidence is not proof
of entailment or truth.

Body/model-field diffs compare the current target through the staging path boundary: `-` current, `+` proposed, two spaces unchanged. Multiple edits may form one replacement; the complete candidate stays visible.

- A matching base is labeled **Matching-base current target versus proposal**.
- A stale base is labeled **Current target versus proposal**, never a historical
  diff. Only the old digest is stored, not the old page.
- Missing amend/contradict targets and existing create targets get prominent
  warnings. Absence is shown as additions, not permission to create or overwrite.
- Unparseable current files have an explicit parse-failure warning and no body or
  metadata comparison. The unparsed content is shown as literal reference data,
  not silently accepted as a normalized page.

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

The [CLI reference](../site/src/content/docs/reference/cli.md#review-navigation) defines JSON pagination fields and cursor encoding.

A changed proposal, target, order, or page size invalidates continuation. Restart
without `--cursor`; the command refuses to return a partial page rather than
silently skipping or duplicating work. Reads are not an atomic filesystem snapshot: concurrent
mutation during collection, or changes made and reverted between reads, cannot be
promised detectable. Re-read the current target before external authorization.

Every call validates the **entire** staged set and its evidence before returning a
page. An invalid hidden proposal fails the command. Contradictions outside the
rendered page continue to block Gold admission. Navigation and disposition do not resolve them.
Oldest-first navigation helps attend to old work but does not guarantee fair
service, bound the backlog, or provide an automatic retention policy.

## Advisory authorization checklist

Verify each claim against evidence; assess privacy, PII, sensitivity, visibility, retrieval eligibility, and egress. Resolve contradictions across the whole backlog. Re-read the target and reconcile stale, missing, conflicting, or invalid state. Independently author the final page and confirm its target and canonical digest; packet proposal/base digests are not the final-page digest.

Confirm reviewer, configured key, payload, and detached receipt with an independently controlled external signer. Run `build` for all eligibility checks. The checklist saves nothing and attests neither attention nor acceptance.

Follow the [authorization protocol](authorization-protocol.md) and [external signing interoperability](external-signing-interop.md). Disposable-key interoperability is not real-page authorization or proof of human review; installed OpenSSL 1.1.1u was not a working receipt signer.
