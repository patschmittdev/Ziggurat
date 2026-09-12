import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import {
  evaluateRetrievalBaseline, evaluateRetrievalQuality, evaluateRetrievalRankings,
  RetrievalBaselineSchema, RetrievalFixtureSchema,
} from '../src/eval/retrieval-quality.js';
import type { RetrievalFixture } from '../src/eval/retrieval-quality.js';
import { buildBm25, bm25Search } from '../src/retrieval/bm25.js';
import { evaluateAuthorizedRetrieval } from './manual/retrieval-evaluation.js';

const fixtures = join(process.cwd(), 'fixtures', 'retrieval', 'v1');
const fixture = RetrievalFixtureSchema.parse(JSON.parse(await readFile(join(fixtures, 'corpus.json'), 'utf8')));
const baseline = RetrievalBaselineSchema.parse(JSON.parse(await readFile(join(fixtures, 'baseline.json'), 'utf8')));

function assertBaselineRankings(actual: typeof baseline.rankings, expected: typeof baseline.rankings): void {
  const identities = (rows: typeof baseline.rankings) => rows.map(row => ({
    query_id: row.query_id, hits: row.hits.map(hit => hit.id),
  }));
  assert.deepEqual(identities(actual), identities(expected));
  actual.forEach((row, rowIndex) => row.hits.forEach((hit, hitIndex) => {
    const expectedScore = expected[rowIndex]!.hits[hitIndex]!.score;
    // Math.log can differ by a few floating-point units across platforms.
    const tolerance = 8 * Number.EPSILON * Math.max(1, Math.abs(expectedScore));
    assert(Number.isFinite(hit.score) && Number.isFinite(expectedScore)
      && Math.abs(hit.score - expectedScore) <= tolerance,
    `${row.query_id}/${hit.id}: score ${hit.score} differs from baseline ${expectedScore}`);
  }));
}

test('retrieval CLI: bundled defaults work from another cwd without weakening explicit path/output restrictions', async () => {
  const root = await mkdtemp(join(process.cwd(), '.retrieval-cli-'));
  const execute = promisify(execFile);
  const runner = fileURLToPath(new URL('./manual/retrieval-evaluation.js', import.meta.url));
  try {
    await execute(process.execPath, [runner, '--scorer-only', '--output', 'report.json'], { cwd: root });
    const report = JSON.parse(await readFile(join(root, 'report.json'), 'utf8'));
    assert.equal(report.revised.corpus_revision, fixture.corpus_revision);
    assert.equal(report.revised.exact_identifier_holdout_pass, true);
    assert.equal(report.authorized, null);
    await assert.rejects(execute(process.execPath, [
      runner, '--scorer-only', '--output', 'report.json',
    ], { cwd: root }), /EEXIST/u);
    await assert.rejects(execute(process.execPath, [
      runner, '--scorer-only', '--fixture', join(fixtures, 'corpus.json'),
    ], { cwd: root }), /must stay within the current working directory/u);
    await assert.rejects(execute(process.execPath, [
      runner, '--scorer-only', '--output', join('..', 'outside-report.json'),
    ], { cwd: root }), /must stay within the current working directory/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('retrieval labels: fixed tuning/holdout cover all categories and exact identifiers are unambiguous', () => {
  for (const split of ['tuning', 'holdout']) {
    for (const category of ['exact-identifier', 'paraphrase', 'ambiguous', 'no-good-answer']) {
      assert(fixture.queries.some(query => query.split === split && query.category === category));
    }
  }
  assert.equal(new Set(fixture.queries.map(query => query.query)).size, fixture.queries.length);
});

test('retrieval baseline: captured original rankings reproduce letters-only BM25 on the frozen corpus', () => {
  const letters = (text: string) => [...text.matchAll(/\p{L}+/gu)].map(m => m[0]).join(' ');
  const snapshot = buildBm25(fixture.documents.map(doc => ({
    id: doc.id, text: letters(`${doc.title} ${doc.body}`),
  })));
  const rankings = fixture.queries.map(query => ({
    query_id: query.id, hits: bm25Search(letters(query.query), snapshot).slice(0, 5),
  }));
  assertBaselineRankings(rankings, baseline.rankings);
  assert.equal(evaluateRetrievalBaseline(fixture, baseline).exact_identifier_holdout_pass, false);
});

test('retrieval baseline comparison tolerates platform rounding but preserves exact ranks and meaningful scores', () => {
  const expected = [{ query_id: 'platform', hits: [
    { id: 'first', score: 2.74806096358101 }, { id: 'second', score: 1 },
  ] }];
  assertBaselineRankings([{ query_id: 'platform', hits: [
    { id: 'first', score: 2.7480609635810103 }, { id: 'second', score: 1 },
  ] }], expected);
  assert.throws(() => assertBaselineRankings([{ ...expected[0]!, hits: [...expected[0]!.hits].reverse() }], expected));
  for (const score of [2.748061, NaN, Infinity]) {
    assert.throws(() => assertBaselineRankings([{ query_id: 'platform', hits: [
      { id: 'first', score }, expected[0]!.hits[1]!,
    ] }], expected));
  }
});

test('retrieval quality: every unambiguous holdout identifier is top one, without pretending semantics are solved', () => {
  const report = evaluateRetrievalQuality(fixture);
  assert.equal(report.exact_identifier_holdout_pass, true);
  assert.equal(report.by_split.tuning.by_category['exact-identifier'].exact_top1_accuracy, 1);
  assert.equal(report.by_split.holdout.by_category['exact-identifier'].exact_identifier_queries, 8);
  assert.equal(report.queries.length, fixture.queries.length);
  assert(report.summary.no_answer_false_positives > 0);
  assert(report.by_split.holdout.by_category.paraphrase.recall_at_5! < 1);
  assert.equal(report.rejection_threshold, null);
  assert.deepEqual(report, evaluateRetrievalQuality(fixture));
});

test('retrieval metrics: macro recall, reciprocal rank, exact accuracy and false positives use separate denominators', () => {
  const small: RetrievalFixture = {
    schema_version: 1, corpus_revision: 'metric-test', query_revision: 'metric-test',
    description: 'Metric arithmetic only',
    documents: ['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, title: id, body: id })),
    queries: [
      { id: 'exact', split: 'holdout', category: 'exact-identifier', query: 'a', relevant_ids: ['a'] },
      { id: 'para', split: 'holdout', category: 'paraphrase', query: 'b', relevant_ids: ['b'] },
      { id: 'multi', split: 'holdout', category: 'ambiguous', query: 'd', relevant_ids: ['a', 'b', 'd'] },
      { id: 'none', split: 'holdout', category: 'no-good-answer', query: 'unknown', relevant_ids: [] },
    ],
  };
  const hits = (ids: string[]) => ids.map((id, index) => ({ id, score: 5 - index }));
  const report = evaluateRetrievalRankings(small, [
    { query_id: 'exact', hits: hits(['a']) },
    { query_id: 'para', hits: hits(['c', 'b']) },
    { query_id: 'multi', hits: hits(['a', 'c', 'd']) },
    { query_id: 'none', hits: hits(['c']) },
  ], 'metric-test');
  assert.equal(report.summary.recall_at_5, (1 + 1 + 2 / 3) / 3);
  assert.equal(report.summary.mrr_at_5, (1 + 1 / 2 + 1) / 3);
  assert.equal(report.summary.relevant_found_at_5, 4);
  assert.equal(report.summary.relevant_total, 5);
  assert.equal(report.summary.queries_with_relevant_at_5, 3);
  assert.equal(report.summary.exact_top1_accuracy, 1);
  assert.equal(report.summary.no_answer_false_positive_rate, 1);
  assert.equal(report.by_split.tuning.summary.recall_at_5, null);
  assert.equal(report.by_split.holdout.by_category['no-good-answer'].mrr_at_5, null);
  const empty = evaluateRetrievalRankings(small,
    small.queries.map(query => ({ query_id: query.id, hits: [] })), 'empty');
  assert.equal(empty.summary.mrr_at_5, 0);
  assert.equal(empty.summary.recall_at_5, 0);
  assert.equal(empty.summary.no_answer_false_positive_rate, 0);
});

test('retrieval metrics: only the first five are measured and missing categories never pass a gate', () => {
  const onlyQuery = fixture.queries[0]!;
  const limited = { ...fixture, queries: [{ ...onlyQuery, split: 'tuning' as const }] };
  const report = evaluateRetrievalRankings(limited, [{
    query_id: onlyQuery.id,
    hits: fixture.documents.slice(0, 5).map((doc, i) => ({ id: doc.id, score: 5 - i })),
  }], 'cutoff');
  assert.equal(report.exact_identifier_holdout_pass, null);
  assert.equal(report.summary.mrr_at_5, 1 / 5);
  assert.equal(report.summary.exact_top1_accuracy, 0);
  assert.throws(() => evaluateRetrievalRankings(limited, [{
    query_id: onlyQuery.id,
    hits: fixture.documents.slice(0, 6).map(doc => ({ id: doc.id, score: 1 })),
  }], 'too-many'));
});

test('retrieval evaluator: rejects invalid labels, missing queries, nonfinite scores and stale baselines', () => {
  const doc = fixture.documents[0]!;
  assert.equal(RetrievalFixtureSchema.safeParse({ ...fixture, documents: [doc, doc] }).success, false);
  const invalidQueries = [
    { ...fixture.queries[0]!, relevant_ids: ['missing'] },
    { ...fixture.queries[0]!, relevant_ids: [] },
    { ...fixture.queries[0]!, relevant_ids: [doc.id, doc.id] },
    { ...fixture.queries[0]!, category: 'no-good-answer', relevant_ids: [doc.id] },
  ];
  for (const query of invalidQueries) {
    assert.equal(RetrievalFixtureSchema.safeParse({ ...fixture, queries: [query] }).success, false);
  }
  assert.throws(() => evaluateRetrievalRankings(fixture, [], 'incomplete'), /every fixture query/u);
  assert.throws(() => evaluateRetrievalBaseline({ ...fixture, query_revision: 'different' }, baseline), /mismatch/u);
  assert.throws(() => evaluateRetrievalBaseline({
    ...fixture, documents: fixture.documents.map(d => ({ ...d, body: `${d.body} changed` })),
  }, baseline), /mismatch/u);
  for (const score of [NaN, Infinity, -1]) {
    assert.throws(() => evaluateRetrievalRankings(fixture, [{
      query_id: fixture.queries[0]!.id, hits: [{ id: doc.id, score }],
    }], 'invalid'));
  }
  const rankings = baseline.rankings.map(row => ({ ...row, hits: [...row.hits] }));
  rankings[0] = { query_id: fixture.queries[0]!.id, hits: [{ id: 'unknown', score: 1 }] };
  assert.throws(() => evaluateRetrievalRankings(fixture, rankings, 'unknown'), /Unknown or duplicate/u);
  rankings[0] = {
    query_id: fixture.queries[0]!.id, hits: [{ id: doc.id, score: 1 }, { id: doc.id, score: 1 }],
  };
  assert.throws(() => evaluateRetrievalRankings(fixture, rankings, 'duplicate'), /Unknown or duplicate/u);
});

test('retrieval quality: real signed CLI-built vault preserves relevance and excludes high-overlap unauthorized material', async () => {
  const result = await evaluateAuthorizedRetrieval(fixture);
  assert.equal(result.quality.exact_identifier_holdout_pass, true);
  assert.equal(result.quality.queries.length, fixture.queries.length);
  assert.deepEqual(result.quality.by_split, evaluateRetrievalQuality(fixture).by_split);
  assert.equal(Object.keys(result.boundary_checks).length, 7);
  assert(Object.values(result.boundary_checks).every(Boolean));
  assert.equal(Object.keys(result.page_chunk_ids).length, fixture.documents.length);
});
