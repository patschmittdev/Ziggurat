import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { sha256Text } from '../src/bronze/canonical.js';
import { collectUnresolvedContradictions } from '../src/review/contradictions.js';
import { goldEligibilityReport } from '../src/review/eligibility.js';
import { buildReviewQueue, renderReviewQueueMarkdown } from '../src/review/queue.js';
import type { CuratedPage } from '../src/contracts/index.js';
import type { ZigguratConfig } from '../src/contracts/config.js';

const STUB_CONFIG: ZigguratConfig = {
  schema_version: 1,
  lifecycle: { review_queue_limit: 5 },
  domain: { page_types: ['concept'], tags: ['ai'] },
  privacy: { default_sensitivity: 'restricted', default_pii: 'unknown' },
  adapters: {},
};

async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-review-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(root, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return root;
}

function makeBronzeFile(body: string): string {
  const canonBody = body.replace(/\r\n/g, '\n');
  const sha = sha256Text(canonBody);
  return `---\nschema_version: 1\nsource_id: test-source\nsource_kind: article\ncaptured_at: 2026-01-01T00:00:00Z\nsha256: ${sha}\nsensitivity: public\npii: 'false'\n---\n${canonBody}`;
}

function makeEligiblePage(overrides: Partial<CuratedPage> = {}): CuratedPage {
  return {
    schema_version: 1,
    title: 'Test Page',
    type: 'concept',
    sources: [],
    confidence: 'high',
    status: 'reviewed',
    retrieval_eligible: true,
    pii: 'false',
    sensitivity: 'public',
    visibility: 'internal',
    egress: 'permitted',
    reviewed_by: 'human',
    reviewed_at: '2026-07-01T00:00:00Z',
    last_verified: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

const FIXED_DATE = new Date('2026-07-30T00:00:00Z');

// ---------------------------------------------------------------------------
// goldEligibilityReport
// ---------------------------------------------------------------------------

test('goldEligibilityReport: eligible when all conditions met', async () => {
  const root = await makeVault({
    'bronze/article.md': makeBronzeFile('# Source\n\nBody.\n'),
  });
  try {
    const page = makeEligiblePage({ sources: ['bronze/article.md'] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert.equal(report.eligible, true);
    assert.deepEqual(report.reasons, []);
    assert.deepEqual(report.bronze_lineage, ['bronze/article.md']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for non-reviewed status', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({ status: 'draft', sources: [] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert.equal(report.eligible, false);
    assert(report.reasons.includes('status: reviewed required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for retrieval_eligible false', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({ retrieval_eligible: false, sources: [] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert(report.reasons.includes('retrieval_eligible required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for pii true', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({ pii: 'true', sources: [] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert(report.reasons.includes('pii: false required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for pii unknown', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({ pii: 'unknown', sources: [] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert(report.reasons.includes('pii: false required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for restricted sensitivity', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({ sensitivity: 'restricted', sources: [] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert(report.reasons.includes('sensitivity: restricted not permitted'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for non-permitted egress', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({ egress: 'blocked', sources: [] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert(report.reasons.includes('egress: permitted required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for missing reviewed_by', async () => {
  const root = await makeVault({});
  try {
    const { reviewed_by: _, ...rest } = makeEligiblePage({ sources: [] });
    const page = rest as CuratedPage;
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert(report.reasons.includes('reviewed_by: required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for arrived review_after', async () => {
  const root = await makeVault({});
  try {
    // review_after is in the past relative to FIXED_DATE
    const page = makeEligiblePage({ sources: [], review_after: '2026-07-01T00:00:00Z' });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert(report.reasons.includes('review_after: re-review required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: future review_after is not stale', async () => {
  const root = await makeVault({
    'bronze/article.md': makeBronzeFile('# Source\n\nBody.\n'),
  });
  try {
    // review_after is in the future
    const page = makeEligiblePage({
      sources: ['bronze/article.md'],
      review_after: '2027-01-01T00:00:00Z',
    });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert.equal(report.eligible, true);
    assert(!report.reasons.some(r => r.includes('review_after')), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: invalid Bronze lineage source fails', async () => {
  const root = await makeVault({
    'bronze/article.md': '# Not a Bronze file\n',
  });
  try {
    const page = makeEligiblePage({ sources: ['bronze/article.md'] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert.equal(report.eligible, false);
    assert(report.reasons.some(r => r.startsWith('lineage:')), JSON.stringify(report.reasons));
    assert.deepEqual(report.bronze_lineage, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: corrupt Bronze body hash fails lineage', async () => {
  const root = await makeVault({
    'bronze/article.md': `---\nschema_version: 1\nsource_id: x\nsource_kind: article\ncaptured_at: 2026-01-01T00:00:00Z\nsha256: ${'a'.repeat(64)}\nsensitivity: public\npii: 'false'\n---\nBody.\n`,
  });
  try {
    const page = makeEligiblePage({ sources: ['bronze/article.md'] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert.equal(report.eligible, false);
    assert(report.reasons.some(r => r.includes('hash mismatch')), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: unresolved contradiction excludes page', async () => {
  const root = await makeVault({
    'bronze/article.md': makeBronzeFile('# Source\n\nBody.\n'),
    '.ziggurat/proposals/contra.json': JSON.stringify({
      schema_version: 1,
      operation: 'contradict',
      target_path: 'knowledge/test.md',
    }),
  });
  try {
    const page = makeEligiblePage({ sources: ['bronze/article.md'] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert.equal(report.eligible, false);
    assert(report.reasons.some(r => r.startsWith('contradictions:')), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: resolved contradiction does not exclude page', async () => {
  const root = await makeVault({
    'bronze/article.md': makeBronzeFile('# Source\n\nBody.\n'),
    '.ziggurat/proposals/resolved.json': JSON.stringify({
      schema_version: 1,
      operation: 'contradict',
      target_path: 'knowledge/test.md',
      resolved_at: '2026-07-29T00:00:00Z',
      resolution: 'Accepted with amendment.',
    }),
  });
  try {
    const page = makeEligiblePage({ sources: ['bronze/article.md'] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert.equal(report.eligible, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: reports all failures, not just the first', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({
      status: 'draft',
      pii: 'unknown',
      sensitivity: 'restricted',
      sources: [],
    });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    assert(report.reasons.length >= 3, `expected at least 3 reasons, got: ${JSON.stringify(report.reasons)}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: reasons are in lexical order', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({
      status: 'draft',
      pii: 'unknown',
      sensitivity: 'restricted',
      sources: [],
      retrieval_eligible: false,
    });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, FIXED_DATE);
    const sorted = [...report.reasons].sort();
    assert.deepEqual(report.reasons, sorted);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// collectUnresolvedContradictions
// ---------------------------------------------------------------------------

test('collectUnresolvedContradictions: returns empty when no proposals dir', async () => {
  const root = await makeVault({});
  try {
    const result = await collectUnresolvedContradictions(root, 'knowledge/test.md');
    assert.deepEqual(result, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collectUnresolvedContradictions: ignores non-contradiction proposals', async () => {
  const root = await makeVault({
    '.ziggurat/proposals/create.json': JSON.stringify({
      schema_version: 1,
      operation: 'create',
      target_path: 'knowledge/test.md',
    }),
  });
  try {
    const result = await collectUnresolvedContradictions(root, 'knowledge/test.md');
    assert.deepEqual(result, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collectUnresolvedContradictions: ignores contradictions for other paths', async () => {
  const root = await makeVault({
    '.ziggurat/proposals/other.json': JSON.stringify({
      schema_version: 1,
      operation: 'contradict',
      target_path: 'knowledge/other.md',
    }),
  });
  try {
    const result = await collectUnresolvedContradictions(root, 'knowledge/test.md');
    assert.deepEqual(result, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collectUnresolvedContradictions: only resolved_at is not enough', async () => {
  const root = await makeVault({
    '.ziggurat/proposals/partial.json': JSON.stringify({
      schema_version: 1,
      operation: 'contradict',
      target_path: 'knowledge/test.md',
      resolved_at: '2026-07-29T00:00:00Z',
    }),
  });
  try {
    const result = await collectUnresolvedContradictions(root, 'knowledge/test.md');
    assert.equal(result.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// buildReviewQueue
// ---------------------------------------------------------------------------

test('buildReviewQueue: excludes reviewed pages', async () => {
  const root = await makeVault({});
  try {
    const queue = await buildReviewQueue(root, [
      { path: 'knowledge/p.md', page: makeEligiblePage(), updated_at: '2026-07-01T00:00:00Z' },
    ], STUB_CONFIG);
    assert.equal(queue.count, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildReviewQueue: sorts contradictions before non-contradictions', async () => {
  const root = await makeVault({
    '.ziggurat/proposals/c.json': JSON.stringify({
      schema_version: 1,
      operation: 'contradict',
      target_path: 'knowledge/a.md',
    }),
  });
  try {
    const candidates = [
      { path: 'knowledge/b.md', page: makeEligiblePage({ status: 'in-review', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
      { path: 'knowledge/a.md', page: makeEligiblePage({ status: 'draft', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
    ];
    const queue = await buildReviewQueue(root, candidates, STUB_CONFIG);
    assert.equal(queue.entries[0]?.path, 'knowledge/a.md');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildReviewQueue: sorts in-review before draft when no contradictions', async () => {
  const root = await makeVault({});
  try {
    const candidates = [
      { path: 'knowledge/a.md', page: makeEligiblePage({ status: 'draft', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
      { path: 'knowledge/b.md', page: makeEligiblePage({ status: 'in-review', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
    ];
    const queue = await buildReviewQueue(root, candidates, STUB_CONFIG);
    assert.equal(queue.entries[0]?.path, 'knowledge/b.md');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildReviewQueue: sorts lower confidence before higher within same status', async () => {
  const root = await makeVault({});
  try {
    const candidates = [
      { path: 'knowledge/high.md', page: makeEligiblePage({ status: 'in-review', confidence: 'high', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
      { path: 'knowledge/low.md', page: makeEligiblePage({ status: 'in-review', confidence: 'low', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
    ];
    const queue = await buildReviewQueue(root, candidates, STUB_CONFIG);
    assert.equal(queue.entries[0]?.path, 'knowledge/low.md');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildReviewQueue: sorts older updated_at before newer', async () => {
  const root = await makeVault({});
  try {
    const candidates = [
      { path: 'knowledge/new.md', page: makeEligiblePage({ status: 'in-review', confidence: 'high', sources: [] }), updated_at: '2026-07-20T00:00:00Z' },
      { path: 'knowledge/old.md', page: makeEligiblePage({ status: 'in-review', confidence: 'high', sources: [] }), updated_at: '2026-01-01T00:00:00Z' },
    ];
    const queue = await buildReviewQueue(root, candidates, STUB_CONFIG);
    assert.equal(queue.entries[0]?.path, 'knowledge/old.md');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildReviewQueue: caps at review_queue_limit', async () => {
  const root = await makeVault({});
  try {
    const config = { ...STUB_CONFIG, lifecycle: { review_queue_limit: 2 } };
    const candidates = [
      { path: 'knowledge/a.md', page: makeEligiblePage({ status: 'draft', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
      { path: 'knowledge/b.md', page: makeEligiblePage({ status: 'draft', sources: [] }), updated_at: '2026-07-02T00:00:00Z' },
      { path: 'knowledge/c.md', page: makeEligiblePage({ status: 'draft', sources: [] }), updated_at: '2026-07-03T00:00:00Z' },
    ];
    const queue = await buildReviewQueue(root, candidates, config);
    assert.equal(queue.count, 2);
    assert.equal(queue.entries.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildReviewQueue: sort is deterministic on equal fields via path', async () => {
  const root = await makeVault({});
  try {
    const candidates = [
      { path: 'knowledge/z.md', page: makeEligiblePage({ status: 'draft', confidence: 'medium', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
      { path: 'knowledge/a.md', page: makeEligiblePage({ status: 'draft', confidence: 'medium', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
    ];
    const queue = await buildReviewQueue(root, candidates, STUB_CONFIG);
    assert.equal(queue.entries[0]?.path, 'knowledge/a.md');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('renderReviewQueueMarkdown: includes title and path', async () => {
  const root = await makeVault({});
  try {
    const candidates = [
      { path: 'knowledge/p.md', page: makeEligiblePage({ status: 'in-review', title: 'My Page', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
    ];
    const queue = await buildReviewQueue(root, candidates, STUB_CONFIG);
    const md = renderReviewQueueMarkdown(queue);
    assert.match(md, /My Page/u);
    assert.match(md, /knowledge\/p\.md/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('renderReviewQueueMarkdown: contains no mutation commands', async () => {
  const root = await makeVault({});
  try {
    const candidates = [
      { path: 'knowledge/p.md', page: makeEligiblePage({ status: 'in-review', sources: [] }), updated_at: '2026-07-01T00:00:00Z' },
    ];
    const queue = await buildReviewQueue(root, candidates, STUB_CONFIG);
    const md = renderReviewQueueMarkdown(queue);
    // No mutation verbs as commands
    assert(!md.includes('git commit'), 'must not contain git commit');
    assert(!md.includes('ziggurat promote'), 'must not contain promote command');
    assert(!md.includes('npm run'), 'must not contain npm run');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
