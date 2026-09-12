# Lexical retrieval evaluation

Ziggurat uses pure BM25 (`k1=1.5`, `b=0.75`). This evaluation measures retrieval,
not answer correctness, semantic support, human review, or external signing.
There are no embeddings, synonyms, reranker, or score-based rejection threshold.
Retrieved content remains non-instructional reference data.

## Run separately from conformance

From the repository root:

```powershell
npm run build
node dist\test\manual\retrieval-evaluation.js --output retrieval-report.json
```

Without `--output`, the command prints JSON to stdout. Output files must be new;
existing files are never overwritten. `--scorer-only` omits the signed-vault
exercise and explicitly reports `authorized: null`. `--fixture` and `--baseline`
accept matched versioned JSON files within the current working directory.
The default files are [corpus.json](../fixtures/retrieval/v1/corpus.json) and
[baseline.json](../fixtures/retrieval/v1/baseline.json), resolved relative to
the compiled runner module rather than cwd. You can change to an external
artifact directory and invoke the compiled script by absolute path; defaults
still load from the repository, while `--output report.json` writes a new file
under that working directory. Explicit input paths and output paths remain
restricted to cwd. The runner creates an
ephemeral real vault beneath the working directory and removes it on completion.
It never uses a real user's vault or keys, and requires no model service.

The machine-readable output contains original and revised per-query top-five
rankings with finite scores, per-category and per-split counts, metric
denominators, fixture revisions/hash, authorized-access results, and boundary
checks. The command fails on an unambiguous identifier holdout miss or a failed
authorization assertion. It does not invent paraphrase/no-answer pass targets.
It labels human usability and external signing interoperability
`unverified-external`, irrespective of its own exit status.

## Corpus, baseline, and split

`synthetic-retrieval-v1` / `hand-labels-v1` contains 20 synthetic pages and
30 hand-labeled queries: 14 tuning, 16 holdout. Technical references cover error
codes, versions, architecture, digest algorithms, and C++/C# bindings; garden
pages cover irrigation, mulch, compost, tomatoes, soil tests, and solar pumping.

Labels name relevant page IDs, not documents containing query words.
Each exact-identifier query has one relevant page. Ambiguous queries have
multiple relevant pages. No-good-answer labels are deliberately empty, including
misleading overlaps such as utility billing, legal binding contracts, and digest
collision exploits. There is one chunk per page in this corpus; the signed
report maps stable page IDs to generated chunk IDs.

The original letters-only implementation was executed on this frozen corpus
**before** editing the scorer. Its saved ranked scores are reproduced in a
regression test. The baseline records the normalized source SHA-256
`5f41ff19856a1b9087f9b4bb736319627512c2589268af84710b3319104664fb`.
The parsed fixture JSON digest is
`3d135d86a3ff8e49e0352e99aa16246e3550de71d9f3c1cea92ee943e27ad02b`;
hashing parsed JSON avoids platform-dependent file line endings.
Fixture/revision mismatches fail, rather than silently comparing changed labels.

The splits and labels were fixed before tokenizer changes. No score parameters
were tuned against either split. A small synthetic holdout is a regression
fixture, not evidence of general performance on unseen user questions.

## Metric definitions

- **Recall@5:** mean, across answerable queries, of relevant pages retrieved in
  the first five divided by all relevant pages for that query (macro recall).
  Raw relevant-found/relevant-total counts are also reported, but their ratio
  is not the macro metric.
- **MRR@5:** mean reciprocal rank of the first relevant page, or zero when none
  appears in the first five. Only answerable queries enter this denominator.
- **Exact top-1:** correct first results divided by unambiguous identifier
  queries, separately for tuning and holdout.
- **No-answer false-positive rate:** no-good-answer queries returning **any**
  result divided by no-good-answer queries. This measures unwanted retrieval
  under the current no-threshold behavior, not hallucinated final answers.
- An empty denominator is `null`, never an automatic pass. Scores are not
  calibrated confidence or comparable relevance thresholds across corpora.

## Measured v1 results

The signed ContextAccess run produces the same category metrics as the revised
scorer. Numbers below are original baseline -> revised. No-answer cases are
excluded from Recall/MRR; dashes mean not applicable.

| Split / category | Queries | Relevant found / total | Recall@5 | MRR@5 | Exact top-1 | No-answer false positives |
| --- | ---: | --- | --- | --- | --- | --- |
| Tuning / identifier | 6 | 5/6 -> 6/6 | 0.8333 -> 1 | 0.7500 -> 1 | 4/6 -> 6/6 | - |
| Tuning / paraphrase | 3 | 2/3 -> 2/3 | 0.6667 -> 0.6667 | 0.6667 -> 0.6667 | - | - |
| Tuning / ambiguous | 2 | 6/7 -> 6/7 | 0.8750 -> 0.8750 | 1 -> 1 | - | - |
| Tuning / no answer | 3 | - | - | - | - | 2/3 -> 2/3 |
| Holdout / identifier | 8 | 7/8 -> 8/8 | 0.8750 -> 1 | 0.6875 -> 1 | 4/8 -> 8/8 | - |
| Holdout / paraphrase | 3 | 2/3 -> 2/3 | 0.6667 -> 0.6667 | 0.6667 -> 0.6667 | - | - |
| Holdout / ambiguous | 2 | 4/4 -> 4/4 | 1 -> 1 | 1 -> 1 | - | - |
| Holdout / no answer | 3 | - | - | - | - | 2/3 -> 2/3 |

Across 24 answerable queries, macro Recall@5 improves from 0.822917 to 0.906250;
MRR@5 improves from 0.750000 to 0.916667. Exact top-1 improves from 8/14 to 14/14.
The candidate's unambiguous identifier holdout requirement is 8/8.
Across six no-good-answer queries, false positives remain **4/6 (66.67%)**.

Failures remain meaningful:

- “recycle kitchen waste into fertilizer” misses compost because none of those
  words occur in the relevant page.
- “determine whether earth is sour” misses soil acidity and retrieves unrelated
  pages through incidental lexical overlap.
- “garden water” misses tomato watering and also returns the garden path;
  BM25 neither stems words nor reasons about the request.
- Lexical overlap returns material for all four misleading no-answer cases.
  Even a relatively large positive score can be irrelevant to the requested
  task. Abstention is **not solved**.

No paraphrase, ambiguity, or no-answer success target is claimed. Agree
corpus-specific targets from this baseline before proposing threshold changes.
These measurements do not authorize semantic systems or default rejection
behavior. Pure-letter garden relevance and deterministic lexical tie ordering
remain covered by regression tests.

## Tokenization, safe keys, and compatibility

Build and query share one tokenizer: normalize to NFC, lowercase, retain Unicode
letters/numbers/combining marks, and preserve underscores inside identifiers.
`ERR_CONN`, `E123`, `v2`, `1.2.3`, `v1.2.3`, `x86`, `sha256`, `C++`, and `C#`
remain distinct meaningful tokens. Hyphens split words (`garden-drip` becomes
`garden`, `drip`); underscores do not (`err_conn` is not `err`, `conn`).
Periods join numeric version components; terminal sentence punctuation does not.
There is no compatibility folding, accent removal, or language-specific word
segmentation: full-width `Ａ` is different from `A`, and contiguous CJK text is
one token. Standalone digits now survive. Query repetition retains its existing
additive BM25 weighting.

Maps accumulate document lengths, postings, and scores. Serialization uses
ordinary objects with deliberate own properties, so `constructor`, `toString`,
`__proto__`, empty/numeric IDs, and inherited names cannot read object prototype
members or disappear from JSON. The schema validates entry arrays before
reconstructing records because `z.record` drops `__proto__`. Plain prototypes
are intentional: JSON/schema reload and in-memory snapshots must satisfy
`isDeepStrictEqual`. Duplicate document IDs now fail rather than creating
inconsistent document frequencies.

**Rebuild all three indexes after updating:**

```powershell
node dist\src\cli\main.js build --root YOUR_VAULT
```

The serialized record shape remains index v2; no Silver or receipt version
changes are needed. Existing verification recomputes BM25 with the new
tokenizer, rejects changed search payloads, and directs the operator to rebuild.
An old snapshot with identical derived search data can still verify; this is
data compatibility, not silent acceptance of different tokenization.
Regression tests cover rejection of legacy technical postings and fresh
signed-index round trips. Profile chunk schema field order also matches its
constructor, preserving the existing JSON-derived integrity fingerprint on
reload instead of invalidating every nonempty advisory index.

## Gold body line endings and index compatibility

Gold chunk construction uses the existing authorization canonicalization: CRLF
and lone CR in a curated body become LF before computing its chunk ID, BM25 data,
and citation body hash. Review and evidence profiles inherit this same Gold body.
No source file is rewritten, no JSON value is double-escaped, and receipt v1
canonical bytes, digests, signing payloads, and signatures are unchanged.
Bronze keeps its separate CRLF-only normalization: lone CR remains part of its
body, body hash, and line-range citations.

For curated bodies containing lone CR, cache provenance additionally records
`source_body_sha256`, the hash of the body after CRLF-only corpus normalization.
Gold stores it on the chunk; review/evidence store it in authorization provenance.
This optional index-v2 field is not a signed receipt field or admission authority.
It keeps live fingerprints sensitive to lone-CR representation changes even
though served text and chunk IDs are canonical. Such a post-build mutation still
refuses search and citation reads as stale until a legitimate rebuild; a
canonical-equivalent receipt does not bypass that refusal.

**After this update, rebuild all three indexes if any indexed Gold body contains
lone CR**, using `node dist\src\cli\main.js build --root YOUR_VAULT`. Old snapshots
for those pages fail live verification. Their Gold chunk IDs (including Gold in
review/evidence), citation body hashes, and corpus fingerprints change; issue new
citations after rebuilding. Existing LF/CRLF-only Gold chunks and fingerprints
are unchanged by this fix. The index format remains v2 and does not require new
receipts or restaging Silver. Older binaries reject the new optional provenance
field when present, so rolling back also requires rebuilding affected indexes.

The dedicated `test/gold-body-normalization.test.ts` regression uses disposable
signing keys and real temporary vaults to cover LF, CRLF, lone CR, mixed endings,
unchanged source bytes, all three profiles, live staleness/rebuild, and unchanged
Bronze hashes and lossless citations.

## Authorization evidence and limits

The opt-in runner uses test-only Ed25519 keys and real files. `runBuild` produces
all three indexes; `createContextAccess` searches every query and reads returned
citations through live verification. High-overlap unsigned, revoked-key,
expired, and contradicted pages are excluded. Silver-only and Bronze-only
markers are found in their proper advisory profiles and never in Gold.
Removing the configured key revokes subsequent search and already-issued
citation reads. Test receipts prove software boundary behavior, not human
approval or external signing interoperability.

The scorer/evaluator owns no admission or production signing code. It does not
change policy decisions, conformance semantics, or the shipped Gold-only MCP
tools. The fixture directly exercises the CLI build implementation and the
ContextAccess boundary shared by CLI/MCP; it is not an MCP wire transport or
human-user acceptance test.
