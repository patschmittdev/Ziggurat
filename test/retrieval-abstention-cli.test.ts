import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { normalizeText } from '../src/authorization/canonical.js';
import { canonicalBronzeBody } from '../src/bronze/canonical.js';
import {
  AbstentionManifestSchema,
  type AbstentionManifest,
} from '../src/eval/retrieval-abstention-fixture.js';
import type { AbstentionExperiment } from '../src/eval/retrieval-abstention.js';
import {
  retrievalFixtureDigest,
  RetrievalFixtureSchema,
} from '../src/eval/retrieval-quality.js';
import type {
  RetrievalFixture,
  RetrievalQualityReport,
  RetrievalRanking,
} from '../src/eval/retrieval-quality.js';
import { buildBm25, bm25Search } from '../src/retrieval/bm25.js';
import { evaluateAuthorizedRetrieval } from './manual/retrieval-evaluation.js';

interface AuthorizedAbstentionReport {
  experiment: AbstentionExperiment;
  boundary_checks: Record<string, boolean>;
  page_chunk_ids: Record<string, string>;
  parity_pass: true;
  fixture_kind: 'synthetic-test-keys-not-human-authorization';
}

interface AbstentionCliReport {
  schema_version: 1;
  ranking_identity: 'gold-chunk-id';
  manifest: AbstentionManifest;
  experiment: AbstentionExperiment;
  legacy: {
    baseline: RetrievalQualityReport;
    revised: RetrievalQualityReport;
  };
  authorized: AuthorizedAbstentionReport | null;
  human_usability_gate: 'unverified-external';
  interpretation: string;
}

interface RunnerModule {
  goldFixtureRankings(fixture: RetrievalFixture): RetrievalRanking[];
}

interface ChunksModule {
  chunkId(profile: string, path: string, body: string): string;
}

const execute = promisify(execFile);
const runner = fileURLToPath(new URL('./manual/retrieval-abstention.js', import.meta.url));
const runnerModuleUrl = new URL('./manual/retrieval-abstention.js', import.meta.url).href;
const chunksModuleUrl = new URL('../src/retrieval/chunks.js', import.meta.url).href;
const abstentionFixturePath = join(
  process.cwd(), 'fixtures', 'retrieval', 'abstention-v1', 'corpus.json',
);
const legacyFixturePath = join(process.cwd(), 'fixtures', 'retrieval', 'v1', 'corpus.json');

async function readFixture(path: string): Promise<RetrievalFixture> {
  return RetrievalFixtureSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

function readReport(text: string): AbstentionCliReport {
  return JSON.parse(text) as AbstentionCliReport;
}

function assertReportContract(report: AbstentionCliReport): void {
  assert.deepEqual(Object.keys(report).sort(), [
    'authorized',
    'experiment',
    'human_usability_gate',
    'interpretation',
    'legacy',
    'manifest',
    'ranking_identity',
    'schema_version',
  ]);
  assert.equal(report.schema_version, 1);
  assert.equal(report.ranking_identity, 'gold-chunk-id');
  assert.equal(report.manifest.label_provenance, 'ai-authored-synthetic');
  assert.equal(report.manifest.human_review, 'unverified');
  assert.equal(report.manifest.query_rationales.length, 48);
  assert.deepEqual(report.experiment.policy, {
    id: 'top-result-query-token-coverage',
    thresholds: [0.25, 0.5, 0.75, 1],
    selection_split: 'tuning',
  });
  assert.deepEqual(Object.keys(report.legacy).sort(), ['baseline', 'revised']);
  assert.equal(report.legacy.baseline.implementation, 'unmodified-letters-only-bm25');
  assert.equal(report.legacy.revised.exact_identifier_holdout_pass, true);
  assert.equal(report.human_usability_gate, 'unverified-external');
  assert.equal(typeof report.interpretation, 'string');
  assert(report.interpretation.length > 0);
}

function rankingIdentities(rankings: readonly RetrievalRanking[]): Array<{
  query_id: string;
  hits: string[];
}> {
  return rankings.map(ranking => ({
    query_id: ranking.query_id,
    hits: ranking.hits.map(hit => hit.id),
  }));
}

function assertRankingParity(
  expected: readonly RetrievalRanking[],
  actual: readonly RetrievalRanking[],
): void {
  assert.deepEqual(rankingIdentities(actual), rankingIdentities(expected));
  for (const [queryIndex, expectedQuery] of expected.entries()) {
    const actualQuery = actual[queryIndex]!;
    for (const [hitIndex, expectedHit] of expectedQuery.hits.entries()) {
      const actualHit = actualQuery.hits[hitIndex]!;
      assert(Number.isFinite(expectedHit.score) && Number.isFinite(actualHit.score));
      const tolerance = 8 * Number.EPSILON * Math.max(
        1,
        Math.abs(expectedHit.score),
        Math.abs(actualHit.score),
      );
      assert(
        Math.abs(expectedHit.score - actualHit.score) <= tolerance,
        `${expectedQuery.query_id}/${expectedHit.id}: score ${actualHit.score}`
          + ` differs from expected ${expectedHit.score}`,
      );
    }
  }
}

function reportMetrics(report: RetrievalQualityReport): Omit<
  RetrievalQualityReport,
  'implementation' | 'queries'
> {
  const { implementation, queries, ...metrics } = report;
  void implementation;
  void queries;
  return metrics;
}

function assertExperimentParity(
  expected: AbstentionExperiment,
  actual: AbstentionExperiment,
): void {
  assert.deepEqual(reportMetrics(actual.baseline), reportMetrics(expected.baseline));
  assertRankingParity(
    expected.baseline.queries.map(query => ({ query_id: query.query_id, hits: query.hits })),
    actual.baseline.queries.map(query => ({ query_id: query.query_id, hits: query.hits })),
  );
  assert.deepEqual(actual.tuning_trials, expected.tuning_trials);
  assert.deepEqual(actual.selection, expected.selection);
  assert.deepEqual(actual.decisions, expected.decisions);
  assert.deepEqual(actual.holdout_acceptance, expected.holdout_acceptance);
  if (expected.candidate === null || actual.candidate === null) {
    assert.equal(actual.candidate, expected.candidate);
    return;
  }
  assert.deepEqual(reportMetrics(actual.candidate), reportMetrics(expected.candidate));
  assertRankingParity(
    expected.candidate.queries.map(query => ({ query_id: query.query_id, hits: query.hits })),
    actual.candidate.queries.map(query => ({ query_id: query.query_id, hits: query.hits })),
  );
}

async function goldPageChunkIds(fixture: RetrievalFixture): Promise<Record<string, string>> {
  const { chunkId } = await import(chunksModuleUrl) as ChunksModule;
  return Object.fromEntries(fixture.documents.map(document => {
    const path = `knowledge/${document.id}.md`;
    const body = normalizeText(canonicalBronzeBody(`${document.body}\n`));
    return [document.id, chunkId('gold', path, body)];
  }));
}

async function createCompiledExperimentCopy(): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.abstention-cli-copy-'));
  try {
    await cp(join(process.cwd(), 'dist'), join(root, 'dist'), { recursive: true });
    await cp(join(process.cwd(), 'fixtures'), join(root, 'fixtures'), { recursive: true });
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function loadRunnerModule(): Promise<RunnerModule> {
  return await import(runnerModuleUrl) as RunnerModule;
}

test('abstention CLI: bundled defaults work from an external cwd', async () => {
  const root = await mkdtemp(join(process.cwd(), '.abstention-cli-'));
  try {
    await execute(process.execPath, [
      runner, '--scorer-only', '--output', 'report.json',
    ], { cwd: root });
    const report = readReport(await readFile(join(root, 'report.json'), 'utf8'));
    assertReportContract(report);
    assert.equal(report.authorized, null);

    const stdout = await execute(process.execPath, [runner, '--scorer-only'], { cwd: root });
    const stdoutReport = readReport(stdout.stdout);
    assertReportContract(stdoutReport);
    assert.equal(stdoutReport.authorized, null);

    await assert.rejects(execute(process.execPath, [
      runner, '--scorer-only', '--output', 'report.json',
    ], { cwd: root }), /EEXIST/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('abstention CLI: authorized rankings preserve decisions and all boundary checks', async () => {
  const fixture = await readFixture(abstentionFixturePath);
  const root = await mkdtemp(join(process.cwd(), '.abstention-cli-'));
  try {
    await execute(process.execPath, [
      runner, '--scorer-only', '--output', 'scorer.json',
    ], { cwd: root });
    await execute(process.execPath, [runner, '--output', 'signed.json'], { cwd: root });
    const scorer = readReport(await readFile(join(root, 'scorer.json'), 'utf8'));
    const signed = readReport(await readFile(join(root, 'signed.json'), 'utf8'));
    assertReportContract(scorer);
    assertReportContract(signed);
    assert.equal(scorer.authorized, null);
    assert(signed.authorized !== null);
    assert.equal(signed.authorized.fixture_kind, 'synthetic-test-keys-not-human-authorization');
    assert.equal(signed.authorized.parity_pass, true);
    assert.equal(Object.keys(signed.authorized.boundary_checks).length, 7);
    assert(Object.values(signed.authorized.boundary_checks).every(Boolean));
    assert.deepEqual(signed.authorized.page_chunk_ids, await goldPageChunkIds(fixture));
    assertExperimentParity(scorer.experiment, signed.experiment);
    assertExperimentParity(signed.experiment, signed.authorized.experiment);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('abstention CLI: Gold identities reproduce signed tie ordering', async () => {
  const fixture = await readFixture(legacyFixturePath);
  const { goldFixtureRankings } = await loadRunnerModule();
  const goldRankings = goldFixtureRankings(fixture);
  const signed = await evaluateAuthorizedRetrieval(fixture);
  const signedRankings = signed.quality.queries.map(query => ({
    query_id: query.query_id,
    hits: query.hits.map(hit => ({ id: hit.id, score: hit.score })),
  }));
  const pageChunkIds = await goldPageChunkIds(fixture);
  assert.deepEqual(signed.page_chunk_ids, pageChunkIds);
  assertRankingParity(goldRankings, signedRankings);

  const pageIdSnapshot = buildBm25(fixture.documents.map(document => ({
    id: document.id,
    text: `${document.title} ${document.body}`,
  })));
  const pageIdsByChunk = new Map(
    Object.entries(pageChunkIds).map(([pageId, id]) => [id, pageId]),
  );
  const goldSnapshot = buildBm25(fixture.documents.map(document => {
    const id = pageChunkIds[document.id];
    assert(id !== undefined, `Missing Gold chunk ID for ${document.id}`);
    const body = normalizeText(canonicalBronzeBody(`${document.body}\n`));
    return { id, text: `${document.title} ${body}` };
  }));
  const expectedGoldRankings = fixture.queries.map(query => ({
    query_id: query.id,
    hits: bm25Search(query.query, goldSnapshot).slice(0, 5).map(hit => {
      const pageId = pageIdsByChunk.get(hit.id);
      assert(pageId !== undefined, `Missing page ID for Gold chunk ${hit.id}`);
      return { id: pageId, score: hit.score };
    }),
  }));
  assertRankingParity(expectedGoldRankings, goldRankings);

  let hasDifferentTopFiveCutoffTie = false;
  for (const query of fixture.queries) {
    const pageIdHits = bm25Search(query.query, pageIdSnapshot);
    const goldHits = bm25Search(query.query, goldSnapshot);
    const fifth = goldHits[4];
    const sixth = goldHits[5];
    if (fifth === undefined || sixth === undefined || fifth.score !== sixth.score) continue;
    const pageIdsFromGold = goldHits.slice(0, 5).map(hit => {
      const pageId = pageIdsByChunk.get(hit.id);
      assert(pageId !== undefined, `Missing page ID for Gold chunk ${hit.id}`);
      return pageId;
    });
    const pageIds = pageIdHits.slice(0, 5).map(hit => hit.id);
    if (JSON.stringify(pageIdsFromGold) !== JSON.stringify(pageIds)) {
      hasDifferentTopFiveCutoffTie = true;
      break;
    }
  }
  assert(hasDifferentTopFiveCutoffTie,
    'Expected a legacy top-five cutoff tie whose page-ID order differs from Gold-ID order');
});

test('abstention CLI: valid negative results remain successful report data', async () => {
  const root = await createCompiledExperimentCopy();
  try {
    const fixturePath = join(root, 'fixtures', 'retrieval', 'abstention-v1', 'corpus.json');
    const manifestPath = join(root, 'fixtures', 'retrieval', 'abstention-v1', 'manifest.json');
    const fixture = await readFixture(fixturePath);
    const manifest = AbstentionManifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
    const changedFixture = RetrievalFixtureSchema.parse({
      ...fixture,
      queries: fixture.queries.map((query, index) => query.category === 'no-good-answer'
        ? { ...query, query: `absent_abstention_${query.split.slice(0, 1)}_${index + 1}` }
        : query),
    });
    const queries = new Map(changedFixture.queries.map(query => [query.id, query]));
    const changedManifest = {
      ...manifest,
      fixture_sha256: retrievalFixtureDigest(changedFixture),
      query_rationales: manifest.query_rationales.map(rationale => {
        const query = queries.get(rationale.query_id);
        assert(query !== undefined);
        return query.category === 'no-good-answer'
          ? { ...rationale, rationale: `Test-only absent marker: ${query.query}.` }
          : rationale;
      }),
    };
    await writeJson(fixturePath, changedFixture);
    await writeJson(manifestPath, changedManifest);

    await execute(process.execPath, [
      join(root, 'dist', 'test', 'manual', 'retrieval-abstention.js'),
      '--scorer-only', '--output', 'negative.json',
    ], { cwd: root });
    const report = readReport(await readFile(join(root, 'negative.json'), 'utf8'));
    assert.equal(
      report.experiment.baseline.by_split.tuning.by_category['no-good-answer']
        .no_answer_false_positives,
      0,
    );
    assert.deepEqual(report.experiment.selection, {
      status: 'no_eligible_candidate',
      threshold: null,
    });
    assert.equal(report.experiment.candidate, null);
    assert.equal(report.experiment.decisions, null);
    assert.equal(report.experiment.holdout_acceptance.status, 'not_run');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('abstention CLI: output boundaries and operational failures are explicit', async () => {
  const root = await mkdtemp(join(process.cwd(), '.abstention-cli-'));
  try {
    const help = await execute(process.execPath, [runner, '--help'], { cwd: root });
    assert.match(help.stdout, /--scorer-only/u);
    assert.match(help.stdout, /--output/u);
    await assert.rejects(execute(process.execPath, [
      runner, '--fixture', 'other.json',
    ], { cwd: root }), /Unknown option/u);
    await assert.rejects(execute(process.execPath, [
      runner, '--threshold', '0.5',
    ], { cwd: root }), /Unknown option/u);
    await assert.rejects(execute(process.execPath, [
      runner, '--unknown',
    ], { cwd: root }), /Unknown option/u);
    await assert.rejects(execute(process.execPath, [
      runner, '--scorer-only', '--output', join('..', 'outside-report.json'),
    ], { cwd: root }), /must stay within the current working directory/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const malformedRoot = await createCompiledExperimentCopy();
  try {
    const fixturePath = join(
      malformedRoot, 'fixtures', 'retrieval', 'abstention-v1', 'corpus.json',
    );
    const fixture = await readFixture(fixturePath);
    await writeJson(fixturePath, {
      ...fixture,
      description: `${fixture.description} Changed only in this disposable copy.`,
    });
    await assert.rejects(execute(process.execPath, [
      join(malformedRoot, 'dist', 'test', 'manual', 'retrieval-abstention.js'),
      '--scorer-only', '--output', 'invalid.json',
    ], { cwd: malformedRoot }), /Fixture digest mismatch/u);
  } finally {
    await rm(malformedRoot, { recursive: true, force: true });
  }
});
