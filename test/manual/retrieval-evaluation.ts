import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import * as YAML from 'yaml';
import { normalizeText } from '../../src/authorization/canonical.js';
import { sha256Text } from '../../src/bronze/canonical.js';
import { serializeBronzeFile } from '../../src/bronze/store.js';
import { runBuild } from '../../src/cli/commands/build.js';
import { runInit } from '../../src/cli/commands/init.js';
import type { CuratedPage } from '../../src/contracts/index.js';
import {
  evaluateRetrievalBaseline, evaluateRetrievalQuality, evaluateRetrievalRankings,
  RetrievalFixtureSchema,
} from '../../src/eval/retrieval-quality.js';
import type { RetrievalFixture, RetrievalRanking } from '../../src/eval/retrieval-quality.js';
import { createContextAccess } from '../../src/mcp/access.js';
import { stageProposal } from '../../src/refine/proposal.js';
import { buildBm25, bm25Search } from '../../src/retrieval/bm25.js';
import { loadGoldIndex } from '../../src/retrieval/gold-index.js';
import { authorizeTestPage, createTestReviewer } from '../helpers/authorization.js';
import type { TestReviewer } from '../helpers/authorization.js';

const io = { stdout() {}, stderr(text: string) { throw new Error(text); } };
const DEFAULT_FIXTURE = fileURLToPath(new URL('../../../fixtures/retrieval/v1/corpus.json', import.meta.url));
const DEFAULT_BASELINE = fileURLToPath(new URL('../../../fixtures/retrieval/v1/baseline.json', import.meta.url));

/**
 * Test-only admission fixture, never a production signer. All keys are ephemeral.
 * Real files and receipts exercise the same CLI build and live access boundary.
 */
export async function evaluateAuthorizedRetrieval(input: RetrievalFixture) {
  const fixture = RetrievalFixtureSchema.parse(input);
  const root = await mkdtemp(join(process.cwd(), '.retrieval-evaluation-'));
  const reviewer = createTestReviewer('retrieval-eval', 'retrieval-eval-key');
  const revoked = createTestReviewer('retrieval-revoked', 'retrieval-revoked-key');
  const asOf = new Date(Date.now() - 60_000).toISOString();
  const checks: Record<string, boolean> = {};
  try {
    assert.equal(await runInit(root, io), 0);
    const reviewerEntry = (key: TestReviewer) => ({
      reviewer_id: key.reviewerId, key_id: key.keyId, algorithm: 'ed25519',
      public_key_pem: key.publicKeyPem,
    });
    const setTrust = async (keys: TestReviewer[]) => writeFile(join(root, 'config', 'trust.yaml'),
      YAML.stringify({ trust: { reviewers: keys.map(reviewerEntry) } }));
    await setTrust([reviewer, revoked]);

    async function bronze(id: string, body: string): Promise<string> {
      const path = `bronze/${id}.md`;
      await writeFile(join(root, path), serializeBronzeFile({
        schema_version: 1, source_id: id, source_kind: 'article', captured_at: asOf,
        sha256: sha256Text(body), sensitivity: 'public', pii: 'false',
      }, body));
      return path;
    }

    async function page(
      id: string, title: string, body: string, key: TestReviewer | null = reviewer,
      overrides: Partial<CuratedPage> = {},
    ) {
      const source = await bronze(id, body);
      const metadata: CuratedPage = {
        schema_version: 1, title, type: 'concept', sources: [source],
        confidence: 'high', status: 'reviewed', retrieval_eligible: true,
        pii: 'false', sensitivity: 'public', visibility: 'internal', egress: 'approved-cloud',
        reviewed_by: (key ?? reviewer).reviewerId, reviewed_at: asOf,
        last_verified: asOf, resolved_proposals: [], ...overrides,
      };
      const path = `knowledge/${id}.md`;
      await writeFile(join(root, path), `---\n${YAML.stringify(metadata)}---\n${body}`);
      if (key !== null) await authorizeTestPage(root, path, metadata, body, key);
      return path;
    }

    for (const doc of fixture.documents) {
      await page(doc.id, doc.title, `${doc.body}\n`);
    }
    const identifiers = fixture.queries.filter(query => query.category === 'exact-identifier')
      .map(query => query.query).join(' ');
    const decoyBody = `${`${identifiers} `.repeat(30)}BOUNDARY_DECOY\n`;
    const excluded = [
      await page('boundary-unsigned', 'Unsigned lexical decoy', decoyBody, null),
      await page('boundary-revoked', 'Revoked lexical decoy', decoyBody, revoked),
      await page('boundary-expired', 'Expired lexical decoy', decoyBody, reviewer,
        { review_after: new Date(Date.now() - 86_400_000).toISOString() }),
      await page('boundary-contradicted', 'Contradicted lexical decoy', decoyBody),
    ];
    const conflictBody = 'A synthetic conflict disputes the lexical decoy.\n';
    const conflictSource = await bronze('boundary-conflict', conflictBody);
    const quote = conflictBody.trimEnd();
    const evidence = [{
      source_path: conflictSource, body_sha256: sha256Text(conflictBody),
      line_start: 1, line_end: 1, quote, quote_sha256: sha256Text(quote),
    }];
    const candidate = {
      schema_version: 1, title: 'Boundary proposal', type: 'concept', sources: [conflictSource],
      confidence: 'medium', retrieval_eligible: false, pii: 'false', sensitivity: 'public',
      visibility: 'internal', egress: 'local-only', body: 'SILVER_ONLY_MARKER\n',
    };
    const target = 'knowledge/boundary-contradicted.md';
    await stageProposal(root, {
      schema_version: 2, operation: 'contradict', target_path: target,
      base_content_sha256: sha256Text(normalizeText(await readFile(join(root, target), 'utf8'))),
      candidate, evidence, contradictions: [{ summary: quote, evidence }],
      confidence: 'medium', affected_paths: [], related_paths: [], unresolved_questions: [],
    });
    await bronze('boundary-only', 'BRONZE_ONLY_MARKER\n');
    await setTrust([reviewer]);
    const buildDiagnostics: string[] = [];
    assert.equal(await runBuild(root, true, {
      stdout() {}, stderr(text) { buildDiagnostics.push(text); },
    }), 0);
    const index = await loadGoldIndex(root);
    assert.deepEqual(index.chunks.map(chunk => chunk.path).sort(),
      fixture.documents.map(doc => `knowledge/${doc.id}.md`).sort());
    for (const path of excluded) {
      assert(!index.chunks.some(chunk => chunk.path === path));
      checks[path] = true;
    }
    const access = await createContextAccess(root, 'gold');
    const pageIds = new Map(fixture.documents.map(doc => [`knowledge/${doc.id}.md`, doc.id]));
    const rankings: RetrievalRanking[] = [];
    for (const query of fixture.queries) {
      const hits = (await access.search(query.query)).slice(0, 5);
      rankings.push({
        query_id: query.id,
        hits: hits.map(hit => {
          assert.equal(hit.profile, 'gold');
          assert.equal(hit.tier, 'gold');
          assert.equal(hit.content_role, 'reference');
          assert.equal(hit.instruction_authority, 'none');
          const id = pageIds.get(hit.path);
          assert(id !== undefined, `Unauthorized ranked page: ${hit.path}`);
          return { id, score: hit.score };
        }),
      });
      if (hits[0] !== undefined) {
        const citation = await access.read(hits[0].citation_id);
        assert.equal(citation.path, hits[0].path);
        assert.equal(citation.instruction_authority, 'none');
      }
    }
    checks['gold-search-and-citation-authority'] = true;
    assert.deepEqual(await access.search('SILVER_ONLY_MARKER BRONZE_ONLY_MARKER BOUNDARY_DECOY'), []);
    const review = await createContextAccess(root, 'review');
    const evidenceAccess = await createContextAccess(root, 'evidence');
    assert((await review.search('SILVER_ONLY_MARKER')).some(hit => hit.tier === 'silver'));
    assert((await evidenceAccess.search('BRONZE_ONLY_MARKER')).some(hit => hit.tier === 'bronze'));
    checks['separate-review-and-evidence-profiles'] = true;
    const citation = (await access.search(fixture.queries[0]!.query))[0];
    assert(citation !== undefined);
    await setTrust([]);
    await assert.rejects(access.search(fixture.queries[0]!.query));
    await assert.rejects(access.read(citation.citation_id));
    checks['live-key-removal-revokes-search-and-read'] = true;
    return {
      fixture_kind: 'synthetic-test-keys-not-human-authorization' as const,
      quality: evaluateRetrievalRankings(fixture, rankings, 'authorized-context-access-bm25'),
      boundary_checks: checks,
      build_diagnostics: buildDiagnostics,
      page_chunk_ids: Object.fromEntries(index.chunks.map(chunk => [pageIds.get(chunk.path)!, chunk.id])),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function cwdPath(path: string): string {
  const resolved = resolve(path);
  const rel = relative(process.cwd(), resolved);
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Evaluation paths must stay within the current working directory');
  }
  return resolved;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    strict: true,
    options: {
      fixture: { type: 'string' },
      baseline: { type: 'string' },
      output: { type: 'string' },
      'scorer-only': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    console.log('Retrieval evaluation (synthetic fixtures; no human/signing gate claim).\n'
      + '[--fixture JSON] [--baseline JSON] [--output NEW_JSON_FILE] [--scorer-only]\n'
      + 'Defaults to bundled fixtures/retrieval/v1, independent of cwd; includes signed ContextAccess unless scorer-only.\n'
      + 'Without --output, prints a machine-readable report to stdout. Never overwrites output.');
    return;
  }
  const fixturePath = values.fixture === undefined ? DEFAULT_FIXTURE : cwdPath(values.fixture);
  const baselinePath = values.baseline === undefined ? DEFAULT_BASELINE : cwdPath(values.baseline);
  const fixture = RetrievalFixtureSchema.parse(JSON.parse(await readFile(fixturePath, 'utf8')));
  const baseline = evaluateRetrievalBaseline(fixture,
    JSON.parse(await readFile(baselinePath, 'utf8')));
  const revised = evaluateRetrievalQuality(fixture);
  const authorized = values['scorer-only'] ? null : await evaluateAuthorizedRetrieval(fixture);
  const technicalRegressions = ['constructor', '__proto__', 'ERR_CONN', 'E123', 'v2', '1.2.3', 'C++', 'C#'];
  const regressionSnapshot = buildBm25(technicalRegressions.map(id => ({ id, text: id })));
  for (const id of technicalRegressions) {
    assert.deepEqual(bm25Search(id, regressionSnapshot).map(hit => hit.id), [id]);
  }
  const report = {
    schema_version: 1, baseline, revised, authorized,
    technical_smoke_pass: true,
    human_usability_gate: 'unverified-external',
    external_signing_interoperability: 'unverified-external',
    interpretation: 'Positive lexical matches are not answers. No abstention threshold or semantic gate is asserted.',
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (values.output === undefined) process.stdout.write(text);
  else await writeFile(cwdPath(values.output), text, { encoding: 'utf8', flag: 'wx' });
  if (revised.exact_identifier_holdout_pass !== true
    || (authorized !== null && authorized.quality.exact_identifier_holdout_pass !== true)) process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
