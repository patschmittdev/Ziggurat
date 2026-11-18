# Ziggurat Architecture

**Experimental:** model-backed refinement has no human usability scores; the revised model-workflow batch reused the fixtures that informed it and is not held out.

## System purpose

Ziggurat is a memory admission firewall. It preserves untrusted source material,
allows models to stage evidence-backed candidates, and requires a separately
verifiable human capability before content becomes durable Gold context.

## Assets

| Asset | Location | Security role |
|---|---|---|
| Inbox source | `inbox/` | Untrusted capture input |
| Bronze record | `bronze/` | No-overwrite, hash-verified evidence |
| Silver proposal | `.ziggurat/proposals/` | Complete but non-authoritative model candidate |
| Knowledge page | `knowledge/` | Human-authored curated content |
| Trust policy | `config/trust.yaml` | Reviewer public-key trust anchors |
| Authorization receipt | `authorizations/` | Detached signed admission decision |
| Gold index | `.ziggurat/gold-index.json` | Authorized Gold retrieval |
| Review index | `.ziggurat/review-index.json` | Policy-safe Silver plus Gold |
| Evidence index | `.ziggurat/evidence-index.json` | Policy-safe Bronze plus Gold |

## Actors and capabilities

| Actor or process | Read | Write | Cannot do |
|---|---|---|---|
| Untrusted source | none | Inbox input | Authorize persistence |
| `ingest` | Real regular files under `inbox/`, Bronze hashes | New no-overwrite Bronze | Read or delete anything outside the real `inbox/` directory |
| Loopback refine model | A bounded host-built reference block of Bronze bytes and optional target context | Strict `RefinementDraft` v1 response only | Access filesystem or tools through Ziggurat, invent available sources, or supply canonical hashes |
| `refine` host pathway | Selected Bronze, explicit target base | One materialized, validated Silver v2 proposal | Write Bronze, knowledge, receipts, trust, reviewed metadata, or indexes |
| Human reviewer | Bronze, Silver, knowledge | Manual page and external signed receipt | A signature does not grant factual certainty |
| `build` | Corpus, receipts, public keys | Generated indexes | Admit a page without valid authorization |
| General AI client | Gold citations | none | Select review/evidence through shipped MCP |
| Trusted operator | Entire local vault | Filesystem and process configuration | Use Ziggurat to constrain operator-level filesystem access |

## State transitions

1. `inbox/*.md` -> `bronze/<kind>/<date>-<slug>.md`
2. Bronze evidence and optional explicit target -> host-built bounded reference context ->
   model `RefinementDraft` v1 -> host materialization and live staging validation ->
   `.ziggurat/proposals/<proposal-id>.json` (Silver v2)
3. Silver proposal -> manual `knowledge/*.md` plus detached receipt
4. Authorized page -> Gold chunk during `build`
5. Gold chunk -> citation-scoped, read-only Gold result

Step 2 is the only place model output crosses into stored state, and it crosses
through a strict draft schema, host materialization, the strict stored proposal schema,
and the evidence validator. Draft evidence names only host-supplied source IDs and
1-based line ranges. The host derives exact quotes and hashes, candidate sources,
candidate confidence and schema version, and the base-content hash from a host-read
target. It revalidates the materialized proposal against live files before staging.
The model never holds a path it can dereference; paths in context are data, not handles.

`refine --target knowledge/item.md` supplies the existing page context required for
`amend` and `contradict`. `--source` explicitly authorizes disclosure of selected Bronze
even when the default model-access privacy filter would exclude it. Only bytes actually
supplied in the bounded reference block enter the source-ID mapping; omitted sources
cannot be cited.

There is no automated Silver-to-knowledge transition and no promote command.
Contradiction proposals are no-overwrite artifacts. A reviewer resolves one by listing its ID
in the page and signing that exact page.


## Enforcement and verification

See the [threat model](site/src/content/docs/security/threat-model.md) for controls, limits, fail-closed behavior, and operator assumptions. The [authorization protocol](docs/authorization-protocol.md) defines signed bytes; changes require a new protocol version. [Policy enforcement](docs/policy-enforcement.md) identifies runtime decision owners.

Gold live verification shares a root-bound Bronze reader within one request. Each new request loads fresh configuration and evidence; this is neither a durable cache nor an atomic filesystem snapshot. Git supplies operator-managed history and rollback; indexes are rebuilt from source artifacts.
