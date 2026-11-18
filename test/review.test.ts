import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { sha256Text } from '../src/bronze/canonical.js';
import { ContradictionScanError, collectUnresolvedContradictions } from '../src/review/contradictions.js';
import { goldEligibilityReport } from '../src/review/eligibility.js';
import type { CuratedPage } from '../src/contracts/index.js';
import type { ZigguratConfig } from '../src/contracts/config.js';
import {
  authorizeTestPage,
  createTestReviewer,
  withTestReviewer,
} from './helpers/authorization.js';

const TEST_REVIEWER = createTestReviewer();
const STUB_CONFIG: ZigguratConfig = withTestReviewer({
  schema_version: 1,
  lifecycle: { review_queue_limit: 5 },
  domain: { page_types: ['concept'], tags: ['ai'] },
  privacy: { default_sensitivity: 'restricted', default_pii: 'unknown' },
  adapters: {},
}, TEST_REVIEWER);

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
    egress: 'approved-cloud',
    reviewed_by: TEST_REVIEWER.reviewerId,
    reviewed_at: '2026-07-01T00:00:00Z',
    last_verified: '2026-07-01T00:00:00Z',
    resolved_proposals: [],
    ...overrides,
  };
}

const FIXED_DATE = new Date('2026-07-30T00:00:00Z');
const PAGE_BODY = 'Curated page body.\n';

// ---------------------------------------------------------------------------
// goldEligibilityReport
// ---------------------------------------------------------------------------

test('goldEligibilityReport: eligible when all conditions met', async () => {
  const root = await makeVault({
    'bronze/article.md': makeBronzeFile('# Source\n\nBody.\n'),
  });
  try {
    const page = makeEligiblePage({ sources: ['bronze/article.md'] });
    await authorizeTestPage(root, 'knowledge/test.md', page, PAGE_BODY, TEST_REVIEWER);
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
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
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
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
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
    assert(report.reasons.includes('retrieval_eligible required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for pii true', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({ pii: 'true', sources: [] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
    assert(report.reasons.includes('pii: false required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for pii unknown', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({ pii: 'unknown', sources: [] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
    assert(report.reasons.includes('pii: false required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for restricted sensitivity', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({ sensitivity: 'restricted', sources: [] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
    assert(report.reasons.includes('sensitivity: restricted not permitted'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails when egress is not approved-cloud', async () => {
  const root = await makeVault({});
  try {
    const page = makeEligiblePage({ egress: 'local-only', sources: [] });
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
    assert(report.reasons.includes('egress: approved-cloud required'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: fails for missing reviewed_by', async () => {
  const root = await makeVault({});
  try {
    const { reviewed_by: _, ...rest } = makeEligiblePage({ sources: [] });
    const page = rest as CuratedPage;
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
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
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
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
    await authorizeTestPage(root, 'knowledge/test.md', page, PAGE_BODY, TEST_REVIEWER);
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
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
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
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
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
    assert.equal(report.eligible, false);
    assert(report.reasons.some(r => r.includes('hash mismatch')), JSON.stringify(report.reasons));
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
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
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
    const report = await goldEligibilityReport(root, 'knowledge/test.md', page, PAGE_BODY, FIXED_DATE, STUB_CONFIG);
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

// ---------------------------------------------------------------------------
// Contradiction scanning fails closed
// ---------------------------------------------------------------------------

test('collectUnresolvedContradictions: an absent proposals directory means none staged', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-contra-'));
  try {
    assert.deepEqual(await collectUnresolvedContradictions(root, 'knowledge/p.md'), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collectUnresolvedContradictions: unparseable JSON fails closed', async () => {
  // Corrupting an artifact must never be a way to restore a blocked page's eligibility.
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-contra-'));
  try {
    await mkdir(join(root, '.ziggurat', 'proposals'), { recursive: true });
    await writeFile(join(root, '.ziggurat', 'proposals', 'broken.json'), '{ not json', 'utf8');
    await assert.rejects(
      () => collectUnresolvedContradictions(root, 'knowledge/p.md'),
      ContradictionScanError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collectUnresolvedContradictions: an invalid contradiction artifact fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-contra-'));
  try {
    await mkdir(join(root, '.ziggurat', 'proposals'), { recursive: true });
    await writeFile(
      join(root, '.ziggurat', 'proposals', 'bad.json'),
      JSON.stringify({ schema_version: 1, operation: 'contradict' }),
      'utf8',
    );
    await assert.rejects(
      () => collectUnresolvedContradictions(root, 'knowledge/p.md'),
      ContradictionScanError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('goldEligibilityReport: an unverifiable contradiction scan excludes the page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-contra-'));
  try {
    await mkdir(join(root, '.ziggurat', 'proposals'), { recursive: true });
    await writeFile(join(root, '.ziggurat', 'proposals', 'broken.json'), '{ not json', 'utf8');

    const bronzeBody = 'Evidence.\n';
    await mkdir(join(root, 'bronze'), { recursive: true });
    await writeFile(
      join(root, 'bronze', 'src.md'),
      `---
schema_version: 1
source_id: s
source_kind: article
captured_at: 2026-01-01T00:00:00Z
sha256: ${sha256Text(bronzeBody)}
sensitivity: public
pii: 'false'
---
${bronzeBody}`,
      'utf8',
    );

    const page = makeEligiblePage({ sources: ['bronze/src.md'] });
    const report = await goldEligibilityReport(
      root,
      'knowledge/p.md',
      page,
      PAGE_BODY,
      new Date('2026-07-30T00:00:00Z'),
      STUB_CONFIG,
    );

    assert.equal(report.eligible, false);
    assert(
      report.reasons.some(r => r.startsWith('contradictions: state unverifiable')),
      JSON.stringify(report.reasons),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
