import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { sha256Text } from '../src/bronze/canonical.js';
import { tokenize, termFreqs, buildBm25, bm25Search } from '../src/retrieval/bm25.js';
import { computeCorpusFingerprint } from '../src/retrieval/fingerprint.js';
import { buildGoldIndex, checkIndexFreshness, loadGoldIndex } from '../src/retrieval/gold-index.js';
import type { CuratedPage } from '../src/contracts/index.js';
import { Bm25SnapshotSchema, ProfileChunkSchema } from '../src/contracts/gold-index.js';
import { assertIndexTrustworthy } from '../src/retrieval/verify.js';
import { makeProfileChunk } from '../src/retrieval/chunks.js';
import * as YAML from 'yaml';
import {
  authorizeTestPage,
  createTestReviewer,
} from './helpers/authorization.js';

const TEST_REVIEWER = createTestReviewer('retrieval-reviewer', 'retrieval-reviewer-primary');

async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.retrieval-vault-'));
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

test('tokenize: lowercases Unicode words and retains numbers', () => {
  const tokens = tokenize('Hello World 123');
  assert.deepEqual(tokens, ['hello', 'world', '123']);
});

test('tokenize: handles empty string', () => {
  assert.deepEqual(tokenize(''), []);
});

test('tokenize: preserves technical identifiers and separates hyphenated words', () => {
  assert.deepEqual(
    tokenize('ERR_CONN E123 v2 1.2.3 v1.2.3 x86 sha256 C++ C# __proto__ garden-drip ERR-CONN'),
    ['err_conn', 'e123', 'v2', '1.2.3', 'v1.2.3', 'x86', 'sha256', 'c++', 'c#',
      '__proto__', 'garden', 'drip', 'err', 'conn'],
  );
  assert.deepEqual(tokenize('C. C# C++ C+++'), ['c', 'c#', 'c++', 'c++']);
});

test('tokenize: keeps coherent NFC words without compatibility folding', () => {
  assert.deepEqual(tokenize('CAFÉ cafe\u0301 naïve देवनागरी 中文'), [
    'café', 'café', 'naïve', 'देवनागरी', '中文',
  ]);
  assert.notDeepEqual(tokenize('Ａ'), tokenize('A'));
});

test('termFreqs: arbitrary own keys never read inherited members', () => {
  const keys = ['constructor', 'toString', '__proto__', 'hasOwnProperty', '', '0'];
  const frequencies = termFreqs([...keys, ...keys]);
  for (const key of keys) {
    assert(Object.hasOwn(frequencies, key));
    assert.equal(frequencies[key], 2);
  }
  assert.equal(Object.getPrototypeOf(frequencies), Object.prototype);
  assert.deepEqual(JSON.parse(JSON.stringify(frequencies)), frequencies);
});

test('BM25: reserved document IDs and terms survive JSON/schema round trips', () => {
  const ids = ['constructor', 'toString', '__proto__', 'hasOwnProperty', '', '0', '\0'];
  const snapshot = buildBm25(ids.map(id => ({
    id, text: 'constructor constructor __proto__ toString hasOwnProperty',
  })));
  const parsed = Bm25SnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
  assert(isDeepStrictEqual(parsed, snapshot));
  for (const state of [snapshot, parsed]) {
    for (const query of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const results = bm25Search(query, state);
      assert.deepEqual(results.map(hit => hit.id), [...ids].sort());
      assert(results.every(hit => Number.isFinite(hit.score) && hit.score > 0));
    }
    assert.equal(state.term_doc_freqs['constructor']?.['__proto__'], 2);
    assert.equal(Object.getPrototypeOf(state.term_doc_freqs), Object.prototype);
  }
});

test('BM25: missing inherited-name queries do not create phantom scores', () => {
  const snapshot = buildBm25([{ id: 'constructor', text: 'water' }]);
  for (const query of ['constructor', '__proto__', 'toString', '', ' \t\n', '!?']) {
    assert.deepEqual(bm25Search(query, snapshot), []);
  }
  assert.deepEqual(bm25Search('water', buildBm25([])), []);
  assert.deepEqual(bm25Search('water', buildBm25([{ id: '__proto__', text: '' }])), []);
});

test('BM25: repeated query terms preserve additive weighting', () => {
  const snapshot = buildBm25([{ id: 'constructor', text: 'constructor constructor water' }]);
  const once = bm25Search('constructor', snapshot)[0]?.score;
  const twice = bm25Search('constructor constructor', snapshot)[0]?.score;
  assert.equal(typeof once, 'number');
  assert.equal(twice, 2 * once!);
});

test('BM25: duplicate IDs fail instead of producing inconsistent document frequencies', () => {
  assert.throws(() => buildBm25([
    { id: '__proto__', text: 'first' }, { id: '__proto__', text: 'second' },
  ]), /Duplicate BM25 document ID/u);
});

test('BM25: document and query technical tokenization agree', () => {
  const identifiers = ['ERR_CONN', 'E123', 'v2', '1.2.3', 'x86', 'sha256', 'C++', 'C#', 'café'];
  const snapshot = buildBm25(identifiers.map(id => ({ id, text: id })));
  for (const identifier of identifiers) {
    assert.deepEqual(bm25Search(identifier.normalize('NFD').toUpperCase(), snapshot).map(hit => hit.id),
      [identifier]);
  }
});

test('BM25: long-document counts match materialized public tokens exactly', () => {
  const body = 'constructor __proto__ C++ C# v2 1.2.3 E123 café cafe\u0301 जल ';
  const documents = [
    { id: '__proto__', text: body.repeat(500) },
    { id: 'constructor', text: body.repeat(300) },
    { id: 'empty', text: '' },
  ];
  const tokens = documents.map(doc => ({ id: doc.id, tokens: tokenize(doc.text) }));
  const lengths = Object.fromEntries(tokens.map(doc => [doc.id, doc.tokens.length]));
  const terms = new Set(tokens.flatMap(doc => doc.tokens));
  const expected = {
    k1: 1.5, b: 0.75,
    avg_doc_length: Object.values(lengths).reduce((sum, count) => sum + count, 0) / documents.length,
    doc_count: documents.length,
    doc_lengths: lengths,
    term_doc_freqs: Object.fromEntries([...terms].map(term => [
      term, Object.fromEntries(tokens.filter(doc => doc.tokens.includes(term)).map(doc => [
        doc.id, doc.tokens.filter(token => token === term).length,
      ])),
    ])),
  };
  const actual = buildBm25(documents);
  assert.deepEqual(actual, expected);
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  assert.deepEqual(bm25Search('constructor E123 café', actual), bm25Search('constructor E123 café', expected));
});

test('BM25 schema: rejects invalid records without silently stripping reserved keys', () => {
  const snapshot = buildBm25([{ id: 'a', text: 'a' }]);
  for (const doc_lengths of [null, [], 'invalid', { a: NaN }, JSON.parse('{"__proto__":"invalid"}')]) {
    assert.equal(Bm25SnapshotSchema.safeParse({ ...snapshot, doc_lengths }).success, false);
  }
});

test('profile chunk schema: preserves constructor field ordering used by integrity fingerprints', () => {
  const chunk = makeProfileChunk('bronze/test.md', 'Evidence', 'Evidence body',
    'bronze', 'bronze', 'evidence', { kind: 'bronze', body_sha256: sha256Text('Evidence body') });
  const loaded = ProfileChunkSchema.parse(JSON.parse(JSON.stringify(chunk)));
  assert.equal(JSON.stringify(loaded), JSON.stringify(chunk));
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

test('buildGoldIndex: uses bm25 without embeddings', async () => {
  const root = await makeVault({
    'bronze/src.md': makeBronzeContent('Evidence.\n'),
  });
  try {
    const page = makeGoldPage({ sources: ['bronze/src.md'] });
    await authorizeTestPage(root, 'knowledge/p.md', page, 'Gold content.', TEST_REVIEWER);
    const index = await buildGoldIndex(root, [
      { path: 'knowledge/p.md', page, pageBody: 'Gold content.' },
    ], { asOf: FIXED_DATE });

    assert.equal(index.chunks.length, 1);
    assert.equal(index.retrieval_mode, 'bm25');
    assert.equal('embeddings' in index, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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

test('verified index: legacy technical postings fail with rebuild guidance; rebuilt snapshots round trip', async () => {
  const root = await makeVault({ 'bronze/src.md': makeBronzeContent('Evidence.\n') });
  try {
    const page = makeGoldPage({ sources: ['bronze/src.md'] });
    const body = 'constructor __proto__ ERR_CONN E123 1.2.3 C++ C# café';
    await mkdir(join(root, 'knowledge'), { recursive: true });
    await writeFile(join(root, 'knowledge', 'technical.md'), `---\n${YAML.stringify(page)}---\n${body}`);
    await authorizeTestPage(root, 'knowledge/technical.md', page, body, TEST_REVIEWER);
    const index = await buildGoldIndex(root, [
      { path: 'knowledge/technical.md', page, pageBody: body },
    ], { asOf: FIXED_DATE });
    const loaded = await loadGoldIndex(root);
    assert(isDeepStrictEqual(loaded.bm25, index.bm25));
    await assertIndexTrustworthy(root, 'gold', loaded, FIXED_DATE);

    // Recreate the former letters-only search payload while retaining authentic chunks.
    loaded.bm25 = buildBm25(loaded.chunks.map(chunk => ({
      id: chunk.id,
      text: [...`${chunk.heading} ${chunk.body}`.matchAll(/\p{L}+/gu)].map(m => m[0]).join(' '),
    })));
    await assert.rejects(assertIndexTrustworthy(root, 'gold', loaded, FIXED_DATE), /Rebuild with: ziggurat build/u);
    await assertIndexTrustworthy(root, 'gold', await loadGoldIndex(root), FIXED_DATE);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
