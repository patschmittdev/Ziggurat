import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import * as YAML from 'yaml';
import { sha256Text } from '../src/bronze/canonical.js';
import { runBuild } from '../src/cli/commands/build.js';
import type { CliIO } from '../src/cli/main.js';
import type {
  CuratedPage,
  RefinementProposal,
  ZigguratConfig,
} from '../src/contracts/index.js';
import { createContextAccess } from '../src/mcp/access.js';
import { loadGoldIndex } from '../src/retrieval/gold-index.js';
import {
  collectEvidenceChunks,
  collectReviewChunks,
  loadProfileIndex,
} from '../src/retrieval/profile-index.js';
import { chunkDerivedFingerprint } from '../src/retrieval/verify.js';
import { collectBronzeFiles, collectCuratedPages } from '../src/corpus/collect.js';
import { collectStagedProposals } from '../src/refine/store.js';
import { parseZigguratConfig } from '../src/contracts/config.js';
import { trustPolicyFingerprint } from '../src/retrieval/integrity.js';
import {
  authorizeTestPage,
  createTestReviewer,
} from './helpers/authorization.js';
import { createOperatingVault } from './helpers/operating-vault.js';

const REVIEWER = createTestReviewer();
const BRONZE_BODY = '# Source\n\nApproved factual observation.\n';
const GOLD_BODY = '# Approved memory\n\nApproved factual observation.\n';
const TARGET_PATH = 'knowledge/approved.md';
const RECENT_REVIEW = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

function makePage(overrides: Partial<CuratedPage> = {}): CuratedPage {
  return {
    schema_version: 1,
    title: 'Approved memory',
    type: 'concept',
    sources: ['bronze/source.md'],
    confidence: 'high',
    status: 'reviewed',
    retrieval_eligible: true,
    pii: 'false',
    sensitivity: 'public',
    visibility: 'internal',
    egress: 'approved-cloud',
    reviewed_by: REVIEWER.reviewerId,
    reviewed_at: RECENT_REVIEW,
    last_verified: RECENT_REVIEW,
    resolved_proposals: [],
    ...overrides,
  };
}

function makeProposal(): RefinementProposal {
  const quote = 'Approved factual observation.';
  const evidence = {
    source_path: 'bronze/source.md',
    body_sha256: sha256Text(BRONZE_BODY),
    line_start: 3,
    line_end: 3,
    quote,
    quote_sha256: sha256Text(quote),
  };
  return {
    schema_version: 2,
    proposal_id: '61cdd2d3-daf2-44c5-98a1-3cf891e31891',
    staged_at: '2026-08-28T00:00:00Z',
    state: 'staged',
    operation: 'create',
    target_path: 'knowledge/proposed.md',
    candidate: {
      schema_version: 1,
      title: 'Proposed memory',
      type: 'concept',
      sources: ['bronze/source.md'],
      confidence: 'medium',
      retrieval_eligible: false,
      pii: 'false',
      sensitivity: 'internal',
      visibility: 'internal',
      egress: 'local-only',
      body: '# Proposed memory\n\nCandidate reference text.\n',
    },
    evidence: [evidence],
    contradictions: [],
    confidence: 'medium',
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
  };
}

async function writeVault(): Promise<{ root: string; page: CuratedPage }> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-index-boundary-'));
  const files: Record<string, string> = {
    'config/ziggurat.yaml': 'schema_version: 1\nlifecycle:\n  review_queue_limit: 10\n',
    'config/domain.yaml': 'domain:\n  page_types: [concept]\n  tags: [security]\n',
    'config/privacy.yaml': 'privacy:\n  default_sensitivity: restricted\n  default_pii: unknown\n',
    'config/adapters.yaml': 'adapters: {}\n',
    'config/trust.yaml': YAML.stringify({
      trust: {
        reviewers: [{
          reviewer_id: REVIEWER.reviewerId,
          key_id: REVIEWER.keyId,
          algorithm: 'ed25519',
          public_key_pem: REVIEWER.publicKeyPem,
        }],
      },
    }),
    'bronze/source.md': [
      '---',
      'schema_version: 1',
      'source_id: source',
      'source_kind: article',
      'captured_at: 2026-08-01T00:00:00Z',
      `sha256: ${sha256Text(BRONZE_BODY)}`,
      'sensitivity: public',
      "pii: 'false'",
      '---',
      BRONZE_BODY,
    ].join('\n'),
    '.ziggurat/proposals/61cdd2d3-daf2-44c5-98a1-3cf891e31891.json':
      JSON.stringify(makeProposal(), null, 2) + '\n',
  };
  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }

  const page = makePage();
  const yaml = YAML.stringify(page, { lineWidth: 0 }).trimEnd();
  await mkdir(join(root, 'knowledge'), { recursive: true });
  await writeFile(join(root, TARGET_PATH), `---\n${yaml}\n---\n${GOLD_BODY}`, 'utf8');
  await writeFile(
    join(root, 'knowledge', 'unsigned-draft.md'),
    `---\n${YAML.stringify(makePage({
      title: 'Unsigned draft',
      status: 'draft',
      reviewed_by: undefined,
      reviewed_at: undefined,
      last_verified: undefined,
    }), { lineWidth: 0 }).trimEnd()}\n---\nUnsigned draft.\n`,
    'utf8',
  );
  await authorizeTestPage(root, TARGET_PATH, page, GOLD_BODY, REVIEWER);
  return { root, page };
}

const SILENT_IO: CliIO = {
  stdout: () => undefined,
  stderr: () => undefined,
};

test('operating fixture profile fingerprints survive schema and disk round trips', async () => {
  const root = await mkdtemp(join(process.cwd(), '.phase3-profile-roundtrip-'));
  try {
    await createOperatingVault(root, 2);
    await runBuild(root, true, SILENT_IO);
    const [curated, bronze, proposals, config] = await Promise.all([
      collectCuratedPages(root), collectBronzeFiles(root),
      collectStagedProposals(root), parseZigguratConfig(root),
    ]);
    for (const profile of ['review', 'evidence'] as const) {
      const index = await loadProfileIndex(root, profile);
      const raw = JSON.parse(await readFile(join(root, '.ziggurat', `${profile}-index.json`), 'utf8')) as {
        chunks: unknown[];
      };
      assert.equal(index.chunks.filter(chunk => chunk.tier === 'gold').length, 2);
      assert.equal(index.chunks.filter(chunk => chunk.tier === 'silver').length, profile === 'review' ? 2 : 0);
      assert.equal(index.chunks.filter(chunk => chunk.tier === 'bronze').length, profile === 'evidence' ? 10 : 0);
      assert.equal(chunkDerivedFingerprint(index), index.corpus_fingerprint);
      assert.equal(JSON.stringify(raw.chunks), JSON.stringify(index.chunks),
        `${profile}: schema normalization must not change fingerprinted property order`);
      const input = { curated, bronze, proposals, config, asOf: new Date(index.built_at) };
      const live = profile === 'review'
        ? await collectReviewChunks(root, input)
        : await collectEvidenceChunks(root, input);
      assert.equal(JSON.stringify(live.chunks), JSON.stringify(index.chunks));
      assert.equal(chunkDerivedFingerprint({ ...index, chunks: live.chunks }), index.corpus_fingerprint);
      const access = await createContextAccess(root, profile);
      const hit = (await access.search('measured envelope'))[0];
      assert(hit !== undefined);
      assert.equal((await access.read(hit.citation_id)).instruction_authority, 'none');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('build JSON exposes stable per-page Gold decisions without page content', async () => {
  const { root } = await writeVault();
  try {
    const stdout: string[] = [];
    const stderr: string[] = [];
    assert.equal(await runBuild(root, true, {
      stdout: text => stdout.push(text), stderr: text => stderr.push(text),
    }), 0);
    const result = JSON.parse(stdout.join('')) as {
      gold_decisions: Array<{
        path: string; eligible: boolean; reasons: string[];
        reason_details: Array<{ code: string; field?: string; path?: string; message: string }>;
      }>;
    };
    const accepted = result.gold_decisions.find(decision => decision.path === TARGET_PATH);
    assert.equal(accepted?.eligible, true);
    assert.deepEqual(accepted.reason_details, []);
    const denied = result.gold_decisions.find(decision => decision.path === 'knowledge/unsigned-draft.md');
    assert.equal(denied?.eligible, false);
    assert(denied.reason_details.some(reason => reason.code === 'gold.status' && reason.field === 'status'));
    assert(denied.reason_details.some(reason => reason.code === 'authorization.receipt-unreadable'));
    assert(stderr.join('').includes('[gold.status]'));
    assert(!stdout.join('').includes(GOLD_BODY));
    assert(!stdout.join('').includes(BRONZE_BODY));
    const indexes = await Promise.all([
      loadGoldIndex(root), loadProfileIndex(root, 'review'), loadProfileIndex(root, 'evidence'),
    ]);
    assert.equal(new Set(indexes.map(index => index.built_at)).size, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('trust policy fingerprint ordering is locale independent', () => {
  const other = createTestReviewer('z-reviewer', 'z-key');
  const reviewers: ZigguratConfig['trust']['reviewers'] = [
    {
      reviewer_id: 'ä-reviewer',
      key_id: REVIEWER.keyId,
      algorithm: 'ed25519',
      public_key_pem: REVIEWER.publicKeyPem,
    },
    {
      reviewer_id: other.reviewerId,
      key_id: other.keyId,
      algorithm: 'ed25519',
      public_key_pem: other.publicKeyPem,
    },
  ];
  const base: Omit<ZigguratConfig, 'trust'> = {
    schema_version: 1,
    lifecycle: { review_queue_limit: 10 },
    domain: { page_types: ['concept'], tags: ['security'] },
    privacy: { default_sensitivity: 'restricted', default_pii: 'unknown' },
    adapters: {},
  };
  assert.equal(
    trustPolicyFingerprint({ ...base, trust: { reviewers } }),
    trustPolicyFingerprint({ ...base, trust: { reviewers: [...reviewers].reverse() } }),
  );
});

test('build keeps Silver, Gold, and Bronze in their canonical isolated indexes', async () => {
  const { root } = await writeVault();
  try {
    assert.equal(await runBuild(root, false, SILENT_IO), 0);
    const gold = await loadGoldIndex(root);
    const review = await loadProfileIndex(root, 'review');
    const evidence = await loadProfileIndex(root, 'evidence');

    assert.deepEqual(gold.chunks.map(chunk => chunk.path), [TARGET_PATH]);
    assert(review.chunks.some(chunk =>
      chunk.path === '.ziggurat/proposals/61cdd2d3-daf2-44c5-98a1-3cf891e31891.json'
      && chunk.tier === 'silver'
      && chunk.status === 'staged'));
    assert(review.chunks.some(chunk => chunk.path === TARGET_PATH && chunk.tier === 'gold'));
    const reviewGold = review.chunks.find(chunk => chunk.path === TARGET_PATH);
    assert.equal(reviewGold?.provenance.kind, 'authorization');
    if (reviewGold?.provenance.kind === 'authorization') {
      assert.deepEqual(reviewGold.provenance.bronze_lineage, [{
        path: 'bronze/source.md',
        sha256: sha256Text(BRONZE_BODY),
      }]);
    }
    assert(!review.chunks.some(chunk => chunk.path.includes('unsigned-draft')));
    assert(evidence.chunks.some(chunk => chunk.path === 'bronze/source.md' && chunk.tier === 'bronze'));
    assert(evidence.chunks.some(chunk => chunk.path === TARGET_PATH && chunk.tier === 'gold'));
    assert(gold.chunks.every(chunk =>
      chunk.instruction_authority === 'none'
      && chunk.content_role === 'reference'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Gold rejects tampered trust labels in a stored index', async () => {
  const { root } = await writeVault();
  try {
    await runBuild(root, false, SILENT_IO);
    const indexPath = join(root, '.ziggurat', 'gold-index.json');
    const index = JSON.parse(await readFile(indexPath, 'utf8')) as {
      chunks: Array<Record<string, unknown>>;
    };
    index.chunks[0]!['content_role'] = 'instruction';
    await writeFile(indexPath, JSON.stringify(index), 'utf8');
    await assert.rejects(() => createContextAccess(root, 'gold'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

interface MutableGoldIndex {
  chunks: Array<{
    bronze_lineage: Array<{ sha256: string }>;
    authorization: { receipt_sha256: string };
  }>;
  bm25: { doc_count: number };
}

for (const [name, mutate] of [
  ['Bronze lineage', (index: MutableGoldIndex) => {
    index.chunks[0]!.bronze_lineage[0]!.sha256 = 'b'.repeat(64);
  }],
  ['authorization provenance', (index: MutableGoldIndex) => {
    index.chunks[0]!.authorization.receipt_sha256 = 'c'.repeat(64);
  }],
  ['BM25 search data', (index: MutableGoldIndex) => {
    index.bm25.doc_count = 999;
  }],
] as const) {
  test(`Gold rejects tampered ${name}`, async () => {
    const { root } = await writeVault();
    try {
      await runBuild(root, false, SILENT_IO);
      const indexPath = join(root, '.ziggurat', 'gold-index.json');
      const index = JSON.parse(await readFile(indexPath, 'utf8')) as MutableGoldIndex;
      mutate(index);
      await writeFile(indexPath, JSON.stringify(index), 'utf8');
      await assert.rejects(() => createContextAccess(root, 'gold'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('Gold search fails closed when authorization state becomes stale', async () => {
  const { root } = await writeVault();
  try {
    await runBuild(root, false, SILENT_IO);
    const access = await createContextAccess(root, 'gold');
    const receiptPath = join(root, 'authorizations', 'approved.md.authorization.json');
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<string, unknown>;
    receipt['reviewed_at'] = '2026-08-30T00:00:00Z';
    await writeFile(receiptPath, JSON.stringify(receipt), 'utf8');
    await assert.rejects(() => access.search('approved'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Gold search fails closed when the trusted reviewer policy changes', async () => {
  const { root } = await writeVault();
  try {
    await runBuild(root, false, SILENT_IO);
    const access = await createContextAccess(root, 'gold');
    await writeFile(
      join(root, 'config', 'trust.yaml'),
      'trust:\n  reviewers: []\n',
      'utf8',
    );
    await assert.rejects(() => access.search('approved'), /policy|stale|fingerprint/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
