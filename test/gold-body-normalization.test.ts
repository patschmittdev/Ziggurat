import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as YAML from 'yaml';
import {
  authorizationReceiptPath,
  canonicalPageContent,
  canonicalPageSha256,
} from '../src/authorization/canonical.js';
import { verifyPageAuthorization } from '../src/authorization/verify.js';
import { canonicalBronzeBody, sha256Text } from '../src/bronze/canonical.js';
import { runBuild } from '../src/cli/commands/build.js';
import { runInit } from '../src/cli/commands/init.js';
import { parseZigguratConfig } from '../src/contracts/config.js';
import type { CuratedPage } from '../src/contracts/index.js';
import { collectBronzeFiles, collectCuratedPages } from '../src/corpus/collect.js';
import { createContextAccess } from '../src/mcp/access.js';
import { createVerifiedBronzeReader, validateEvidenceCitation } from '../src/refine/evidence.js';
import { buildBm25 } from '../src/retrieval/bm25.js';
import { loadGoldIndex } from '../src/retrieval/gold-index.js';
import { loadProfileIndex } from '../src/retrieval/profile-index.js';
import {
  assertIndexTrustworthy,
  chunkDerivedFingerprint,
  computeLiveFingerprint,
  IndexVerificationError,
} from '../src/retrieval/verify.js';
import { authorizeTestPage, createTestReviewer } from './helpers/authorization.js';

const GOLD_PATH = 'knowledge/approved.md';
const BRONZE_PATH = 'bronze/source.md';
const GOLD_BODY = '# Approved memory\nFirst factual observation.\nSecond factual observation.\n';
const BRONZE_RAW = '# Evidence\r\nFirst factual observation.\rSecond factual observation.\r\n';
const PROFILES = ['gold', 'review', 'evidence'] as const;
const REPRESENTATIONS = [
  ['LF', GOLD_BODY],
  ['CRLF', GOLD_BODY.replace(/\n/gu, '\r\n')],
  ['lone CR', GOLD_BODY.replace(/\n/gu, '\r')],
  ['mixed', GOLD_BODY.replace('\n', '\r').replace('\n', '\r\n')],
] as const;
const IO = { stdout() {}, stderr(text: string) { throw new Error(text); } };

function document(page: CuratedPage, body: string, newline = '\n'): string {
  return `---\n${YAML.stringify(page)}---\n`.replace(/\n/gu, newline) + body;
}

async function writeFixture(root: string, goldBody = GOLD_BODY, bronzeBody = BRONZE_RAW) {
  assert.equal(await runInit(root, IO), 0);
  const reviewer = createTestReviewer();
  const now = new Date(Date.now() - 60_000).toISOString();
  await writeFile(join(root, 'config', 'trust.yaml'), YAML.stringify({
    trust: { reviewers: [{
      reviewer_id: reviewer.reviewerId,
      key_id: reviewer.keyId,
      algorithm: 'ed25519',
      public_key_pem: reviewer.publicKeyPem,
    }] },
  }));
  const bronze = {
    schema_version: 1, source_id: 'source', source_kind: 'article', captured_at: now,
    sha256: sha256Text(canonicalBronzeBody(bronzeBody)), sensitivity: 'public', pii: 'false',
  };
  await writeFile(join(root, BRONZE_PATH), `---\n${YAML.stringify(bronze)}---\n${bronzeBody}`);
  const page: CuratedPage = {
    schema_version: 1, title: 'Approved memory', type: 'concept', sources: [BRONZE_PATH],
    confidence: 'high', status: 'reviewed', retrieval_eligible: true,
    pii: 'false', sensitivity: 'public', visibility: 'internal', egress: 'approved-cloud',
    reviewed_by: reviewer.reviewerId, reviewed_at: now, last_verified: now, resolved_proposals: [],
  };
  await writeFile(join(root, GOLD_PATH), document(page, goldBody));
  // One receipt over LF authorizes every existing canonical-equivalent representation.
  const receipt = await authorizeTestPage(root, GOLD_PATH, page, GOLD_BODY, reviewer);
  return { page, receipt };
}

async function sourceBytes(root: string): Promise<Buffer[]> {
  return Promise.all([
    GOLD_PATH, BRONZE_PATH, authorizationReceiptPath(GOLD_PATH), 'config/trust.yaml',
  ].map(path => readFile(join(root, path))));
}

async function loadIndexes(root: string) {
  return Promise.all([
    loadGoldIndex(root), loadProfileIndex(root, 'review'), loadProfileIndex(root, 'evidence'),
  ]);
}

async function assertNormalizedGold(root: string): Promise<void> {
  for (const index of await loadIndexes(root)) {
    const chunk = index.chunks.find(candidate => candidate.path === GOLD_PATH);
    assert(chunk !== undefined);
    assert.equal(chunk.body, GOLD_BODY, `${index.profile}: Gold body must use canonical LF`);
    assert.equal(chunk.id, sha256Text(`${index.profile}\0${GOLD_PATH}\0${sha256Text(GOLD_BODY)}`));
    assert.equal(chunkDerivedFingerprint(index), index.corpus_fingerprint);
    assert.equal(await computeLiveFingerprint(root, index.profile), index.corpus_fingerprint);
    await assertIndexTrustworthy(root, index.profile, index);
    const access = await createContextAccess(root, index.profile);
    const hit = (await access.search('factual observation')).find(result => result.path === GOLD_PATH);
    assert(hit !== undefined);
    assert.equal(hit.chunk_id, chunk.id);
    assert.equal(hit.body, GOLD_BODY);
    const citation = await access.read(hit.citation_id);
    assert.equal(citation.body, GOLD_BODY);
    assert.equal(citation.body_sha256, sha256Text(GOLD_BODY));
  }
}

for (const [name, body] of REPRESENTATIONS) {
  test(`${name} curated body is served as canonical LF in all three indexes without rewriting sources`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ziggurat-gold-body-'));
    try {
      const { page, receipt } = await writeFixture(root, body);
      const before = await sourceBytes(root);
      assert.equal(canonicalPageContent(GOLD_PATH, page, body),
        canonicalPageContent(GOLD_PATH, page, GOLD_BODY));
      assert.equal(canonicalPageSha256(GOLD_PATH, page, body), receipt.content_sha256);
      assert.equal((await verifyPageAuthorization(
        root, GOLD_PATH, page, body, await parseZigguratConfig(root),
      )).valid, true);
      const collected = (await collectCuratedPages(root))[0];
      assert.equal(collected?.pageBody, body.replace(/\r\n/gu, '\n'),
        'shared corpus parsing must preserve lone CR');
      assert.equal(await runBuild(root, true, IO), 0);
      await assertNormalizedGold(root);
      const sourceBody = body.replace(/\r\n/gu, '\n');
      for (const index of await loadIndexes(root)) {
        const chunk = index.chunks.find(candidate => candidate.path === GOLD_PATH);
        assert(chunk !== undefined);
        const provenance = chunk.profile === 'gold' ? chunk : chunk.provenance;
        assert('source_body_sha256' in provenance || sourceBody === GOLD_BODY);
        assert.equal('source_body_sha256' in provenance ? provenance.source_body_sha256 : undefined,
          sourceBody === GOLD_BODY ? undefined : sha256Text(sourceBody));
        if (sourceBody === GOLD_BODY) assert(!Object.hasOwn(provenance, 'source_body_sha256'));
        const raw = JSON.parse(await readFile(
          join(root, '.ziggurat', `${index.profile}-index.json`), 'utf8',
        )) as { chunks: unknown[] };
        assert.equal(JSON.stringify(raw.chunks), JSON.stringify(index.chunks),
          'schema reload must preserve fingerprinted field order');
      }
      assert.deepEqual(await sourceBytes(root), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('ordinary LF to CRLF conversion preserves existing chunks, fingerprints and citations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-gold-crlf-'));
  try {
    const { page } = await writeFixture(root);
    assert.equal(await runBuild(root, true, IO), 0);
    const before = await loadIndexes(root);
    const issued = await Promise.all(PROFILES.map(async profile => {
      const access = await createContextAccess(root, profile);
      const hit = (await access.search('factual observation')).find(result => result.path === GOLD_PATH);
      assert(hit !== undefined);
      return { access, hit };
    }));
    await writeFile(join(root, GOLD_PATH),
      document(page, GOLD_BODY.replace(/\n/gu, '\r\n'), '\r\n'));
    const bytes = await sourceBytes(root);
    for (const { access, hit } of issued) {
      assert.equal((await access.read(hit.citation_id)).body, GOLD_BODY);
    }
    assert.equal(await runBuild(root, true, IO), 0);
    const after = await loadIndexes(root);
    assert.deepEqual(after.map(index => index.chunks), before.map(index => index.chunks));
    assert.deepEqual(after.map(index => index.corpus_fingerprint),
      before.map(index => index.corpus_fingerprint));
    await assertNormalizedGold(root);
    assert.deepEqual(await sourceBytes(root), bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lone-CR mutations stay stale until rebuild even when receipt and canonical Gold text are unchanged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-gold-cr-stale-'));
  try {
    const { page } = await writeFixture(root);
    assert.equal(await runBuild(root, true, IO), 0);
    const receiptBytes = await readFile(join(root, authorizationReceiptPath(GOLD_PATH)));
    for (const body of [GOLD_BODY.replace(/\n/gu, '\r'), REPRESENTATIONS[3][1], GOLD_BODY]) {
      const before = await loadIndexes(root);
      const issued = await Promise.all(PROFILES.map(async profile => {
        const access = await createContextAccess(root, profile);
        const hit = (await access.search('factual observation')).find(result => result.path === GOLD_PATH);
        assert(hit !== undefined);
        return { access, hit };
      }));
      await writeFile(join(root, GOLD_PATH), document(page, body));
      const bytes = await sourceBytes(root);
      assert.equal((await verifyPageAuthorization(
        root, GOLD_PATH, page, body, await parseZigguratConfig(root),
      )).valid, true);
      for (const { access, hit } of issued) {
        const stale = (error: unknown): boolean =>
          error instanceof IndexVerificationError && error.code === 'index_stale';
        await assert.rejects(() => access.search('factual observation'), stale);
        await assert.rejects(() => access.read(hit.citation_id), stale);
        await assert.rejects(() => createContextAccess(root, access.accessProfile), stale);
      }
      assert.equal(await runBuild(root, true, IO), 0);
      await assertNormalizedGold(root);
      const after = await loadIndexes(root);
      for (const [index, oldIndex] of after.map((index, offset) => [index, before[offset]] as const)) {
        assert(oldIndex !== undefined);
        assert.notEqual(index.corpus_fingerprint, oldIndex.corpus_fingerprint);
        assert.equal(index.chunks.find(chunk => chunk.path === GOLD_PATH)?.id,
          oldIndex.chunks.find(chunk => chunk.path === GOLD_PATH)?.id);
      }
      for (const { access, hit } of issued) {
        await assert.rejects(() => access.read(hit.citation_id), /different corpus state/u);
        assert((await access.search('factual observation')).some(result =>
          result.path === GOLD_PATH && result.body === GOLD_BODY));
      }
      assert.deepEqual(await sourceBytes(root), bytes);
      assert.deepEqual(await readFile(join(root, authorizationReceiptPath(GOLD_PATH))), receiptBytes);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legacy lone-CR Gold snapshots require rebuilding all profiles, not new receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-gold-legacy-cr-'));
  try {
    const body = GOLD_BODY.replace(/\n/gu, '\r');
    await writeFixture(root, body);
    const before = await sourceBytes(root);
    assert.equal(await runBuild(root, true, IO), 0);
    for (const index of await loadIndexes(root)) {
      for (const chunk of index.chunks) {
        if (chunk.path !== GOLD_PATH) continue;
        chunk.body = body;
        chunk.id = sha256Text(`${index.profile}\0${GOLD_PATH}\0${sha256Text(body)}`);
        if (chunk.profile === 'gold') delete chunk.source_body_sha256;
        else if (chunk.provenance.kind === 'authorization') delete chunk.provenance.source_body_sha256;
      }
      index.bm25 = buildBm25(index.chunks.map(chunk => ({
        id: chunk.id, text: `${chunk.heading} ${chunk.body}`,
      })));
      index.corpus_fingerprint = chunkDerivedFingerprint(index);
      await writeFile(join(root, '.ziggurat', `${index.profile}-index.json`), JSON.stringify(index));
      await assert.rejects(() => createContextAccess(root, index.profile), (error: unknown) =>
        error instanceof IndexVerificationError && error.code === 'index_stale');
    }
    assert.equal(await runBuild(root, true, IO), 0);
    await assertNormalizedGold(root);
    assert.deepEqual(await sourceBytes(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const MARKER_MUTATIONS: Array<{
  name: string;
  body: string;
  mutate: (provenance: { source_body_sha256?: string | undefined }) => void;
}> = [
  {
    name: 'removed marker',
    body: GOLD_BODY.replace(/\n/gu, '\r'),
    mutate: provenance => { delete provenance.source_body_sha256; },
  },
  {
    name: 'tampered marker',
    body: GOLD_BODY.replace(/\n/gu, '\r'),
    mutate: provenance => { provenance.source_body_sha256 = sha256Text('different source body'); },
  },
  {
    name: 'unexpected marker on ordinary LF',
    body: GOLD_BODY,
    mutate: provenance => { provenance.source_body_sha256 = sha256Text(GOLD_BODY); },
  },
];

for (const { name, body, mutate } of MARKER_MUTATIONS) {
  test(`${name} fails cache integrity and live verification in every Gold profile`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ziggurat-gold-source-marker-'));
    try {
      await writeFixture(root, body);
      const before = await sourceBytes(root);
      assert.equal(await runBuild(root, true, IO), 0);
      for (const index of await loadIndexes(root)) {
        const access = await createContextAccess(root, index.profile);
        const hit = (await access.search('factual observation')).find(result => result.path === GOLD_PATH);
        assert(hit !== undefined);
        const chunk = index.chunks.find(candidate => candidate.path === GOLD_PATH);
        assert(chunk !== undefined);
        if (chunk.profile === 'gold') mutate(chunk);
        else {
          assert(chunk.provenance.kind === 'authorization');
          mutate(chunk.provenance);
        }
        const path = join(root, '.ziggurat', `${index.profile}-index.json`);
        await writeFile(path, JSON.stringify(index));
        await assert.rejects(() => createContextAccess(root, index.profile), (error: unknown) =>
          error instanceof IndexVerificationError && error.code === 'index_integrity');
        const reloaded = index.profile === 'gold'
          ? await loadGoldIndex(root) : await loadProfileIndex(root, index.profile);
        reloaded.corpus_fingerprint = chunkDerivedFingerprint(reloaded);
        await writeFile(path, JSON.stringify(reloaded));
        const stale = (error: unknown): boolean =>
          error instanceof IndexVerificationError && error.code === 'index_stale';
        await assert.rejects(() => createContextAccess(root, index.profile), stale);
        await assert.rejects(() => access.search('factual observation'), stale);
        await assert.rejects(() => access.read(hit.citation_id), stale);
      }
      assert.equal(await runBuild(root, true, IO), 0);
      await assertNormalizedGold(root);
      assert.deepEqual(await sourceBytes(root), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

for (const [name, newline] of [['LF', '\n'], ['CRLF', '\r\n'], ['lone CR', '\r']] as const) {
  test(`${name} Bronze body retains its existing hash, line ranges and lossless citations`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ziggurat-gold-bronze-'));
    try {
      const raw = `First factual observation.${newline}Second factual observation.${newline}`;
      const expected = raw.replace(/\r\n/gu, '\n');
      await writeFixture(root, GOLD_BODY, raw);
      const before = await sourceBytes(root);
      assert.equal(canonicalBronzeBody(raw), expected);
      assert.equal(await runBuild(root, true, IO), 0);
      const bronze = (await collectBronzeFiles(root))[0];
      assert.equal(bronze?.body, expected);
      assert.equal(bronze?.sha256, sha256Text(expected));
      const source = await createVerifiedBronzeReader(root).read(root, BRONZE_PATH);
      const lines = name === 'lone CR'
        ? [expected] : ['First factual observation.', 'Second factual observation.'];
      assert.deepEqual(source.lines, lines);
      const quote = lines.join('\n');
      assert.equal(await validateEvidenceCitation(root, {
        source_path: BRONZE_PATH, body_sha256: sha256Text(expected),
        line_start: 1, line_end: lines.length, quote, quote_sha256: sha256Text(quote),
      }), null);
      const access = await createContextAccess(root, 'evidence');
      const hit = (await access.search('factual observation')).find(result => result.path === BRONZE_PATH);
      assert(hit !== undefined);
      assert.equal(hit.body, expected);
      assert.equal(hit.chunk_id, sha256Text(`evidence\0${BRONZE_PATH}\0${sha256Text(expected)}`));
      const citation = await access.read(hit.citation_id);
      assert.equal(citation.body, expected);
      assert.equal(citation.body_sha256, sha256Text(expected));
      assert.deepEqual(JSON.parse(JSON.stringify(citation)), citation);
      const gold = (await loadGoldIndex(root)).chunks[0];
      assert.deepEqual(gold?.bronze_lineage, [{ path: BRONZE_PATH, sha256: sha256Text(expected) }]);
      assert.deepEqual(await sourceBytes(root), before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
