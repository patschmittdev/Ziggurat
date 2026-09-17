import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { normalizeText } from '../../src/authorization/canonical.js';
import { canonicalBronzeBody } from '../../src/bronze/canonical.js';
import {
  verifyAbstentionFixture,
  type AbstentionManifest,
} from '../../src/eval/retrieval-abstention-fixture.js';
import {
  evaluateAbstentionExperiment,
  type AbstentionExperiment,
} from '../../src/eval/retrieval-abstention.js';
import {
  evaluateRetrievalBaseline,
  evaluateRetrievalQuality,
  type RetrievalFixture,
  type RetrievalQualityReport,
  type RetrievalRanking,
} from '../../src/eval/retrieval-quality.js';
import { chunkId } from '../../src/retrieval/chunks.js';
import { buildBm25, bm25Search } from '../../src/retrieval/bm25.js';
import { cwdPath, evaluateAuthorizedRetrieval } from './retrieval-evaluation.js';

const DEFAULT_FIXTURE = fileURLToPath(
  new URL('../../../fixtures/retrieval/abstention-v1/corpus.json', import.meta.url),
);
const DEFAULT_MANIFEST = fileURLToPath(
  new URL('../../../fixtures/retrieval/abstention-v1/manifest.json', import.meta.url),
);
const DEFAULT_LEGACY_FIXTURE = fileURLToPath(
  new URL('../../../fixtures/retrieval/v1/corpus.json', import.meta.url),
);
const DEFAULT_LEGACY_BASELINE = fileURLToPath(
  new URL('../../../fixtures/retrieval/v1/baseline.json', import.meta.url),
);

interface AuthorizedReport {
  experiment: AbstentionExperiment;
  boundary_checks: Record<string, boolean>;
  page_chunk_ids: Record<string, string>;
  parity_pass: true;
  fixture_kind: 'synthetic-test-keys-not-human-authorization';
}

interface AbstentionReport {
  schema_version: 1;
  ranking_identity: 'gold-chunk-id';
  manifest: AbstentionManifest;
  experiment: AbstentionExperiment;
  legacy: {
    baseline: RetrievalQualityReport;
    revised: RetrievalQualityReport;
  };
  authorized: AuthorizedReport | null;
  human_usability_gate: 'unverified-external';
  interpretation: string;
}

export function goldFixtureRankings(input: RetrievalFixture): RetrievalRanking[] {
  const pageIds = new Map<string, string>();
  const snapshot = buildBm25(input.documents.map(document => {
    const path = `knowledge/${document.id}.md`;
    const body = normalizeText(canonicalBronzeBody(`${document.body}\n`));
    const id = chunkId('gold', path, body);
    pageIds.set(id, document.id);
    return { id, text: `${document.title} ${body}` };
  }));
  return input.queries.map(query => ({
    query_id: query.id,
    hits: bm25Search(query.query, snapshot).slice(0, 5).map(hit => {
      const id = pageIds.get(hit.id);
      if (id === undefined) throw new Error(`Missing fixture page for Gold chunk ${hit.id}`);
      return { id, score: hit.score };
    }),
  }));
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
  scorer: readonly RetrievalRanking[],
  authorized: readonly RetrievalRanking[],
): void {
  assert.deepEqual(rankingIdentities(authorized), rankingIdentities(scorer));
  for (const [queryIndex, scorerQuery] of scorer.entries()) {
    const authorizedQuery = authorized[queryIndex]!;
    for (const [hitIndex, scorerHit] of scorerQuery.hits.entries()) {
      const authorizedHit = authorizedQuery.hits[hitIndex]!;
      assert(Number.isFinite(scorerHit.score) && Number.isFinite(authorizedHit.score));
      const tolerance = 8 * Number.EPSILON * Math.max(
        1,
        Math.abs(scorerHit.score),
        Math.abs(authorizedHit.score),
      );
      assert(
        Math.abs(scorerHit.score - authorizedHit.score) <= tolerance,
        `${scorerQuery.query_id}/${scorerHit.id}: authorized score ${authorizedHit.score}`
          + ` differs from scorer score ${scorerHit.score}`,
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
  scorer: AbstentionExperiment,
  authorized: AbstentionExperiment,
): void {
  assert.deepEqual(authorized.policy, scorer.policy);
  assert.deepEqual(reportMetrics(authorized.baseline), reportMetrics(scorer.baseline));
  assertRankingParity(
    scorer.baseline.queries.map(query => ({ query_id: query.query_id, hits: query.hits })),
    authorized.baseline.queries.map(query => ({ query_id: query.query_id, hits: query.hits })),
  );
  assert.deepEqual(authorized.tuning_trials, scorer.tuning_trials);
  assert.deepEqual(authorized.selection, scorer.selection);
  assert.deepEqual(authorized.decisions, scorer.decisions);
  assert.deepEqual(authorized.holdout_acceptance, scorer.holdout_acceptance);
  if (scorer.candidate === null || authorized.candidate === null) {
    assert.equal(authorized.candidate, scorer.candidate);
    return;
  }
  assert.deepEqual(reportMetrics(authorized.candidate), reportMetrics(scorer.candidate));
  assertRankingParity(
    scorer.candidate.queries.map(query => ({ query_id: query.query_id, hits: query.hits })),
    authorized.candidate.queries.map(query => ({ query_id: query.query_id, hits: query.hits })),
  );
}

function assertBoundaryChecks(checks: Record<string, boolean>): void {
  assert.equal(Object.keys(checks).length, 7, 'Expected all seven authorization boundary checks');
  assert(Object.values(checks).every(Boolean), 'An authorization boundary check failed');
}

async function buildReport(scorerOnly: boolean): Promise<AbstentionReport> {
  const [fixtureInput, manifestInput, legacyInput, legacyBaseline] = await Promise.all([
    readFile(DEFAULT_FIXTURE, 'utf8'),
    readFile(DEFAULT_MANIFEST, 'utf8'),
    readFile(DEFAULT_LEGACY_FIXTURE, 'utf8'),
    readFile(DEFAULT_LEGACY_BASELINE, 'utf8'),
  ]);
  const { fixture, manifest } = verifyAbstentionFixture(
    JSON.parse(fixtureInput),
    JSON.parse(manifestInput),
    JSON.parse(legacyInput),
  );
  const legacy = JSON.parse(legacyInput);
  const legacyReport = {
    baseline: evaluateRetrievalBaseline(legacy, JSON.parse(legacyBaseline)),
    revised: evaluateRetrievalQuality(legacy),
  };
  assert.equal(
    legacyReport.revised.exact_identifier_holdout_pass,
    true,
    'The frozen legacy revised identifier holdout must remain passing',
  );

  const rankings = goldFixtureRankings(fixture);
  const experiment = evaluateAbstentionExperiment(fixture, rankings);
  let authorized: AuthorizedReport | null = null;
  if (!scorerOnly) {
    const signed = await evaluateAuthorizedRetrieval(fixture);
    const signedRankings = signed.quality.queries.map(({ query_id, hits }) => ({
      query_id,
      hits,
    }));
    const signedExperiment = evaluateAbstentionExperiment(fixture, signedRankings);
    assertRankingParity(rankings, signedRankings);
    assertExperimentParity(experiment, signedExperiment);
    assertBoundaryChecks(signed.boundary_checks);
    authorized = {
      experiment: signedExperiment,
      boundary_checks: signed.boundary_checks,
      page_chunk_ids: signed.page_chunk_ids,
      parity_pass: true,
      fixture_kind: signed.fixture_kind,
    };
  }

  return {
    schema_version: 1,
    ranking_identity: 'gold-chunk-id',
    manifest,
    experiment,
    legacy: legacyReport,
    authorized,
    human_usability_gate: 'unverified-external',
    interpretation: 'Synthetic lexical evidence only. Coverage is not confidence, semantic support, or human validation.',
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    strict: true,
    allowPositionals: false,
    options: {
      'scorer-only': { type: 'boolean', default: false },
      output: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Retrieval abstention evaluation (synthetic fixture; no human validation claim).\n'
      + '[--scorer-only] [--output NEW_JSON_FILE]\n'
      + 'Defaults are bundled relative to the compiled module. Without --output, prints JSON to stdout.'
      + ' Output files must be new and stay within the current working directory.');
    return;
  }

  const report = await buildReport(values['scorer-only']);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output === undefined) process.stdout.write(text);
  else await writeFile(cwdPath(values.output), text, { encoding: 'utf8', flag: 'wx' });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
