import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { sha256Text } from '../src/bronze/canonical.js';
import { tokenize, buildBm25, bm25Search } from '../src/retrieval/bm25.js';
import { reciprocalRankFusion } from '../src/retrieval/rrf.js';
import { computeCorpusFingerprint } from '../src/retrieval/fingerprint.js';
import { buildGoldIndex, checkIndexFreshness, loadGoldIndex } from '../src/retrieval/gold-index.js';
import type { CuratedPage } from '../src/contracts/index.js';
import * as YAML from 'yaml';
import {
  authorizeTestPage,
  createTestReviewer,
} from './helpers/authorization.js';

const TEST_REVIEWER = createTestReviewer('retrieval-reviewer', 'retrieval-reviewer-primary');

async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-retrieval-'));
  const configFiles = {
    'config/ziggurat.yaml': 'schema_version: 1\nlifecycle:\n  review_queue_limit: 10\n',
    'config/domain.yaml': 'domain:\n  page_types: [concept]\n  tags: [security]\n',
    'config/privacy.yaml': 'privacy:\n  default_sensitivity: restricted\n  default_pii: unknown\n',
    'config/adapters.yaml': 'adapters: {}\n',
    'config/trust.yaml': YAML.stringify({
      trust: {
        reviewers: [{
          reviewer_id: TEST_REVIEWER.reviewerId,
          key_id: TEST_REVIEWER.keyId,
          algorithm: 'ed25519',
          public_key_pem: TEST_REVIEWER.publicKeyPem,
        }],
      },
    }),
  };
  for (const [relPath, content] of Object.entries({ ...configFiles, ...files })) {
    const fullPath = join(root, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return root;
}

function makeBronzeContent(body: string): string {
  const canonBody = body.replace(/\r\n/g, '\n');
  const sha = sha256Text(canonBody);
  return `---\nschema_version: 1\nsource_id: test\nsource_kind: article\ncaptured_at: 2026-01-01T00:00:00Z\nsha256: ${sha}\nsensitivity: public\npii: 'false'\n---\n${canonBody}`;
}

function makeGoldPage(overrides: Partial<CuratedPage> = {}): CuratedPage {
  return {
    schema_version: 1,
    title: 'Gold Page',
    type: 'concept',
    sources: [],
    confidence: 'high',
    status: 'reviewed',
    retrieval_eligible: true,
    pii: 'false',
    sensitivity: 'public',
    visibility: 'internal',
    egress: 'approved-cloud',
    reviewed_by: TEST_REVIEWER.reviewerId,
    reviewed_at: '2026-07-01T00:00:00Z',
    last_verified: '2026-07-01T00:00:00Z',
    resolved_proposals: [],
    ...overrides,
  };
}

const FIXED_DATE = new Date('2026-07-30T00:00:00Z');

// ---------------------------------------------------------------------------
// BM25
// ---------------------------------------------------------------------------

test('tokenize: lowercases and extracts Unicode words', () => {
  const tokens = tokenize('Hello World 123');
  assert.deepEqual(tokens, ['hello', 'world']);
});

test('tokenize: handles empty string', () => {
  assert.deepEqual(tokenize(''), []);
});

test('bm25Search: ranks by term relevance', () => {
  const docs = [
    { id: 'a', text: 'irrigation water garden' },
    { id: 'b', text: 'irrigation irrigation water water' },
    { id: 'c', text: 'completely unrelated topic here' },
  ];
  const bm25 = buildBm25(docs);
  const results = bm25Search('irrigation', bm25);
  assert(results.length >= 2);
  assert.equal(results[0]?.id, 'b');
});

test('bm25Search: returns empty for missing term', () => {
  const bm25 = buildBm25([{ id: 'a', text: 'hello world' }]);
  const results = bm25Search('nonexistent', bm25);
  assert.deepEqual(results, []);
});

test('bm25Search: ties broken by lexical id order', () => {
  const docs = [
    { id: 'z-doc', text: 'same text here' },
    { id: 'a-doc', text: 'same text here' },
  ];
  const bm25 = buildBm25(docs);
  const results = bm25Search('same', bm25);
  assert.equal(results[0]?.id, 'a-doc');
});

// ---------------------------------------------------------------------------
// RRF
// ---------------------------------------------------------------------------

test('RRF uses fixed k=60 and stable path tie-breaking', () => {
  const result = reciprocalRankFusion([
    ['a', 'b', 'c'],
    ['b', 'a', 'd'],
  ], 60);
  assert.deepEqual(result.map((e) => e.id).slice(0, 2), ['a', 'b']);
});

test('RRF: document appearing in only one list still scores', () => {
  const result = reciprocalRankFusion([['x', 'y'], ['z']], 60);
  assert(result.some(e => e.id === 'z'));
});

test('RRF: empty lists return empty', () => {
  assert.deepEqual(reciprocalRankFusion([], 60), []);
});

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

test('fingerprint: same inputs produce same hash', () => {
  const a = computeCorpusFingerprint('gold', 1, [{ path: 'knowledge/p.md', content_hash: 'abc' }]);
  const b = computeCorpusFingerprint('gold', 1, [{ path: 'knowledge/p.md', content_hash: 'abc' }]);
  assert.equal(a, b);
});

test('fingerprint: different content_hash produces different fingerprint', () => {
  const a = computeCorpusFingerprint('gold', 1, [{ path: 'p.md', content_hash: 'abc' }]);
  const b = computeCorpusFingerprint('gold', 1, [{ path: 'p.md', content_hash: 'xyz' }]);
  assert.notEqual(a, b);
});

test('fingerprint: order of entries does not matter', () => {
  const a = computeCorpusFingerprint('gold', 1, [
    { path: 'b.md', content_hash: '2' },
    { path: 'a.md', content_hash: '1' },
  ]);
  const b = computeCorpusFingerprint('gold', 1, [
    { path: 'a.md', content_hash: '1' },
    { path: 'b.md', content_hash: '2' },
  ]);
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// Gold index
// ---------------------------------------------------------------------------

test('buildGoldIndex: includes only eligible page', async () => {
  const bronzeBody = '# Source\n\nEvidence.\n';
  const root = await makeVault({
    'bronze/article.md': makeBronzeContent(bronzeBody),
  });
  try {
    const eligible = makeGoldPage({ sources: ['bronze/article.md'] });
    const ineligible = makeGoldPage({ status: 'draft', sources: [], reviewed_by: undefined as unknown as string });
    await authorizeTestPage(root, 'knowledge/good.md', eligible, 'Gold content.', TEST_REVIEWER);

    const index = await buildGoldIndex(root, [
      { path: 'knowledge/good.md', page: eligible, pageBody: 'Gold content.' },
      { path: 'knowledge/bad.md', page: ineligible, pageBody: 'Draft content.' },
    ], { asOf: FIXED_DATE });

    assert.equal(index.chunks.length, 1);
    assert.equal(index.chunks[0]?.path, 'knowledge/good.md');
    assert.equal(index.profile, 'gold');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildGoldIndex: stores Bronze lineage paths', async () => {
  const bronzeBody = '# Source\n\nEvidence.\n';
  const root = await makeVault({
    'bronze/article.md': makeBronzeContent(bronzeBody),
  });

  try {
    const page = makeGoldPage({ sources: ['bronze/article.md'] });
    await authorizeTestPage(root, 'knowledge/page.md', page, 'Content.', TEST_REVIEWER);
    const index = await buildGoldIndex(root, [
      { path: 'knowledge/page.md', page, pageBody: 'Content.' },
    ], { asOf: FIXED_DATE });

    assert.equal(index.chunks[0]?.bronze_lineage[0]?.path, 'bronze/article.md');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildGoldIndex: accepts a schema-valid quoted Bronze digest', async () => {
  const bronzeBody = '# Source\n\nEvidence.\n';
  const sha = sha256Text(bronzeBody);
  const root = await makeVault({
    'bronze/article.md':
      `---\nschema_version: 1\nsource_id: test\nsource_kind: article\ncaptured_at: 2026-01-01T00:00:00Z\nsha256: "${sha}"\nsensitivity: public\npii: 'false'\n---\n${bronzeBody}`,
  });
  try {
    const page = makeGoldPage({ sources: ['bronze/article.md'] });
    await authorizeTestPage(root, 'knowledge/quoted.md', page, 'Content.', TEST_REVIEWER);
    const index = await buildGoldIndex(root, [
      { path: 'knowledge/quoted.md', page, pageBody: 'Content.' },
    ], { asOf: FIXED_DATE });
    assert.equal(index.chunks[0]?.bronze_lineage[0]?.sha256, sha);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildGoldIndex: writes index to disk atomically', async () => {
  const root = await makeVault({
    'bronze/src.md': makeBronzeContent('Body.\n'),
  });
  try {
    const page = makeGoldPage({ sources: ['bronze/src.md'] });
    await authorizeTestPage(root, 'knowledge/p.md', page, 'Text.', TEST_REVIEWER);
    await buildGoldIndex(root, [{ path: 'knowledge/p.md', page, pageBody: 'Text.' }], { asOf: FIXED_DATE });
    const loaded = await loadGoldIndex(root);
    assert.equal(loaded.version, 2);
    assert.equal(loaded.profile, 'gold');
    assert.equal(loaded.chunks.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildGoldIndex: excludes PII pages', async () => {
  const root = await makeVault({});
  try {
    const piiPage = makeGoldPage({ pii: 'true', sources: [] });
    const index = await buildGoldIndex(root, [
      { path: 'knowledge/private.md', page: piiPage, pageBody: 'Private.' },
    ], { asOf: FIXED_DATE });
    assert.equal(index.chunks.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('checkIndexFreshness: stale when source changes', async () => {
  const root = await makeVault({
    'bronze/src.md': makeBronzeContent('Original.\n'),
  });
  try {
    const page = makeGoldPage({ sources: ['bronze/src.md'] });
    await authorizeTestPage(root, 'knowledge/p.md', page, 'Original text.', TEST_REVIEWER);
    await buildGoldIndex(root, [{ path: 'knowledge/p.md', page, pageBody: 'Original text.' }], { asOf: FIXED_DATE });

    const fresh = await checkIndexFreshness(root, [
      { path: 'knowledge/p.md', page, pageBody: 'Changed text.' },
    ], { asOf: FIXED_DATE });
    assert.equal(fresh.fresh, false);
    assert(fresh.reason?.includes('fingerprint') === true, fresh.reason);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('checkIndexFreshness: fresh when unchanged', async () => {
  const root = await makeVault({
    'bronze/src.md': makeBronzeContent('Body.\n'),
  });
  try {
    const page = makeGoldPage({ sources: ['bronze/src.md'] });
    await authorizeTestPage(root, 'knowledge/p.md', page, 'Stable.', TEST_REVIEWER);
    await buildGoldIndex(root, [{ path: 'knowledge/p.md', page, pageBody: 'Stable.' }], { asOf: FIXED_DATE });
    const result = await checkIndexFreshness(root, [
      { path: 'knowledge/p.md', page, pageBody: 'Stable.' },
    ], { asOf: FIXED_DATE });
    assert.equal(result.fresh, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
