import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { sha256Text } from '../src/bronze/canonical.js';
import { serializeBronzeFile } from '../src/bronze/store.js';
import type { CuratedPage, PiiState, RefinementProposal, Sensitivity } from '../src/contracts/index.js';
import { collectBronzeFilesDetailed } from '../src/corpus/collect.js';
import { authorizationReceiptPath } from '../src/authorization/canonical.js';
import { modelSourceAccessReasons, bronzeBlockedFromModelAccess } from '../src/policy/index.js';
import type { PolicyReasonCode } from '../src/policy/index.js';
import { buildBronzeReference } from '../src/refine/context.js';
import { collectStagedProposals } from '../src/refine/store.js';
import { createVerifiedBronzeReader, validateEvidenceCitation } from '../src/refine/evidence.js';
import { buildGoldIndex, collectEligibleGoldChunks } from '../src/retrieval/gold-index.js';
import { buildReviewIndex, buildEvidenceIndex } from '../src/retrieval/profile-index.js';
import { buildContradictionIndex } from '../src/review/contradictions.js';
import { createGoldEligibilityContext, goldEligibilityReport } from '../src/review/eligibility.js';
import { authorizeTestPage, createTestReviewer, withTestReviewer } from './helpers/authorization.js';

const REVIEWER = createTestReviewer();
const CONFIG = withTestReviewer({
  schema_version: 1,
  lifecycle: { review_queue_limit: 10 },
  domain: { page_types: ['concept'], tags: [] },
  privacy: { default_sensitivity: 'restricted', default_pii: 'unknown' },
  adapters: {},
}, REVIEWER);
const AS_OF = new Date('2026-07-30T00:00:00Z');
const SOURCE = 'bronze/source.md';
const TARGET = 'knowledge/page.md';
const SOURCE_BODY = 'Factual evidence.\n';
const BODY = 'Curated reference.\n';
const PROPOSAL_ID = '61cdd2d3-daf2-44c5-98a1-3cf891e31891';

function page(overrides: Partial<CuratedPage> = {}): CuratedPage {
  return {
    schema_version: 1, title: 'Policy fixture', type: 'concept', sources: [SOURCE],
    confidence: 'high', status: 'reviewed', retrieval_eligible: true, pii: 'false',
    sensitivity: 'public', visibility: 'internal', egress: 'approved-cloud',
    reviewed_by: REVIEWER.reviewerId, reviewed_at: '2026-07-01T00:00:00Z',
    last_verified: '2026-07-01T00:00:00Z', resolved_proposals: [], ...overrides,
  };
}

function bronze(pii: PiiState = 'false', sensitivity: Sensitivity = 'public'): string {
  return serializeBronzeFile({
    schema_version: 1, source_id: 'source', source_kind: 'article',
    captured_at: '2026-01-01T00:00:00Z', sha256: sha256Text(SOURCE_BODY), pii, sensitivity,
  }, SOURCE_BODY);
}

async function withVault(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(process.cwd(), '.phase3-policy-'));
  try {
    await mkdir(join(root, 'bronze'));
    await writeFile(join(root, SOURCE), bronze());
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function proposal(operation: 'create' | 'contradict' = 'create'): RefinementProposal {
  const evidence = {
    source_path: SOURCE, body_sha256: sha256Text(SOURCE_BODY),
    line_start: 1, line_end: 1, quote: SOURCE_BODY.trimEnd(),
    quote_sha256: sha256Text(SOURCE_BODY.trimEnd()),
  };
  return {
    schema_version: 2, proposal_id: PROPOSAL_ID, staged_at: '2026-07-01T00:00:00Z',
    state: 'staged', operation, target_path: operation === 'create' ? 'knowledge/new.md' : TARGET,
    ...(operation === 'create' ? {} : { base_content_sha256: 'a'.repeat(64) }),
    candidate: {
      schema_version: 1, title: 'Advisory only', type: 'concept', sources: [SOURCE],
      confidence: 'medium', retrieval_eligible: false, pii: 'false', sensitivity: 'internal',
      visibility: 'internal', egress: 'local-only', body: 'Candidate observation.',
    },
    evidence: [evidence],
    contradictions: operation === 'create' ? [] : [{ summary: 'Disagrees.', evidence: [evidence] }],
    confidence: 'medium', affected_paths: [], related_paths: [], unresolved_questions: [],
  };
}

async function writeProposal(root: string): Promise<void> {
  await mkdir(join(root, '.ziggurat', 'proposals'), { recursive: true });
  await writeFile(join(root, '.ziggurat', 'proposals', `${PROPOSAL_ID}.json`),
    JSON.stringify(proposal('contradict')));
}

interface MatrixCase {
  name: string;
  overrides?: Partial<CuratedPage>;
  omit?: keyof CuratedPage;
  expected?: PolicyReasonCode;
  before?: (root: string) => Promise<void>;
}

const matrix: MatrixCase[] = [
  { name: 'authorized reviewed page' },
  { name: 'draft', overrides: { status: 'draft' }, expected: 'gold.status' },
  { name: 'in review', overrides: { status: 'in-review' }, expected: 'gold.status' },
  { name: 'retrieval disabled', overrides: { retrieval_eligible: false }, expected: 'gold.retrieval-eligible' },
  { name: 'PII true', overrides: { pii: 'true' }, expected: 'gold.pii' },
  { name: 'PII unknown', overrides: { pii: 'unknown' }, expected: 'gold.pii' },
  { name: 'restricted', overrides: { sensitivity: 'restricted' }, expected: 'gold.sensitivity' },
  { name: 'local-only', overrides: { egress: 'local-only' }, expected: 'gold.egress' },
  { name: 'missing reviewer', omit: 'reviewed_by', expected: 'gold.reviewer-required' },
  { name: 'missing reviewed date', omit: 'reviewed_at', expected: 'gold.reviewed-at-required' },
  { name: 'invalid reviewed date', overrides: { reviewed_at: 'invalid' }, expected: 'gold.reviewed-at-invalid' },
  { name: 'future reviewed date', overrides: { reviewed_at: '2026-08-01T00:00:00Z' }, expected: 'gold.reviewed-at-future' },
  { name: 'missing verified date', omit: 'last_verified', expected: 'gold.last-verified-required' },
  { name: 'invalid verified date', overrides: { last_verified: 'invalid' }, expected: 'gold.last-verified-invalid' },
  { name: 'future verified date', overrides: { last_verified: '2026-08-01T00:00:00Z' }, expected: 'gold.last-verified-future' },
  { name: 'stale', overrides: { last_verified: '2026-01-01T00:00:00Z' }, expected: 'gold.last-verified-stale' },
  { name: 'exactly 90 days', overrides: { last_verified: new Date(AS_OF.getTime() - 90 * 86400_000).toISOString() } },
  { name: 'invalid re-review date', overrides: { review_after: 'invalid' }, expected: 'gold.review-after-invalid' },
  { name: 're-review due now', overrides: { review_after: AS_OF.toISOString() }, expected: 'gold.review-after-due' },
  { name: 'future re-review', overrides: { review_after: '2026-08-01T00:00:00Z' } },
  { name: 'empty lineage', overrides: { sources: [] }, expected: 'gold.sources-required' },
  { name: 'invalid lineage path', overrides: { sources: ['bronze/../outside.md'] }, expected: 'lineage.path-invalid' },
  { name: 'unreadable source', before: root => rm(join(root, SOURCE)), expected: 'lineage.unreadable' },
  { name: 'missing frontmatter', before: root => writeFile(join(root, SOURCE), SOURCE_BODY), expected: 'lineage.missing-frontmatter' },
  { name: 'invalid YAML', before: root => writeFile(join(root, SOURCE), '---\npii: [\n---\nsecret'), expected: 'lineage.invalid-yaml' },
  { name: 'invalid schema', before: root => writeFile(join(root, SOURCE), '---\nschema_version: 2\n---\nsecret'), expected: 'lineage.schema-invalid' },
  { name: 'tampered hash', before: root => writeFile(join(root, SOURCE), bronze() + 'tampered'), expected: 'lineage.hash-mismatch' },
  { name: 'private lineage does not redefine signed Gold policy', before: root => writeFile(join(root, SOURCE), bronze('unknown', 'restricted')) },
  { name: 'missing receipt', before: root => rm(join(root, authorizationReceiptPath(TARGET))), expected: 'authorization.receipt-unreadable' },
  { name: 'malformed receipt', before: root => writeFile(join(root, authorizationReceiptPath(TARGET)), '{"private":'), expected: 'authorization.receipt-unreadable' },
  { name: 'strict receipt schema', before: root => writeFile(join(root, authorizationReceiptPath(TARGET)), '{"unexpected":"secret"}'), expected: 'authorization.receipt-schema-invalid' },
  { name: 'unresolved contradiction', before: writeProposal, expected: 'gold.contradictions-unresolved' },
  { name: 'authorized contradiction resolution', overrides: { resolved_proposals: [PROPOSAL_ID] }, before: writeProposal },
];

for (const row of matrix) {
  test(`runtime Gold/profile decision matrix: ${row.name}`, async () => {
    await withVault(async root => {
      const candidate = page(row.overrides);
      if (row.omit !== undefined) delete candidate[row.omit];
      await authorizeTestPage(root, TARGET, candidate, BODY, REVIEWER);
      await row.before?.(root);
      const collected = await collectBronzeFilesDetailed(root);
      const proposals = await collectStagedProposals(root);
      const contradictions = buildContradictionIndex(proposals);
      const direct = await goldEligibilityReport(root, TARGET, candidate, BODY, AS_OF, CONFIG, contradictions);
      const reused = await goldEligibilityReport(root, TARGET, candidate, BODY, AS_OF, CONFIG,
        contradictions, createGoldEligibilityContext(collected.records, collected.rejected));
      assert.deepEqual(reused, direct, 'collected-source reuse must preserve every decision');
      const recordsOnly = await goldEligibilityReport(root, TARGET, candidate, BODY, AS_OF, CONFIG,
        contradictions, createGoldEligibilityContext(collected.records));
      assert.deepEqual(recordsOnly, direct, 'records-only callers retain strict-schema denial codes');
      const readerBacked = await goldEligibilityReport(root, TARGET, candidate, BODY, AS_OF, CONFIG,
        contradictions, createGoldEligibilityContext([], [], createVerifiedBronzeReader(root)));
      assert.deepEqual(readerBacked, direct, 'shared verified reader preserves every Gold rule and reason');
      assert.equal(direct.eligible, row.expected === undefined);
      if (row.expected !== undefined) {
        assert(direct.reason_details.some(reason => reason.code === row.expected), JSON.stringify(direct.reason_details));
      }
      const curated = [{ path: TARGET, page: candidate, pageBody: BODY }];
      const input = {
        curated, bronze: collected.records, bronzeRejections: collected.rejected,
        proposals, config: CONFIG, asOf: AS_OF,
      };
      const gold = await buildGoldIndex(root, curated, input);
      const review = await buildReviewIndex(root, input);
      const evidence = await buildEvidenceIndex(root, input);
      for (const index of [gold, review, evidence]) {
        assert.equal(index.chunks.some(chunk => chunk.path === TARGET), direct.eligible, index.profile);
        assert.equal(index.built_at, AS_OF.toISOString());
        assert(index.chunks.every(chunk => chunk.instruction_authority === 'none'));
      }
      assert(gold.chunks.every(chunk => chunk.tier === 'gold'));
      assert(review.chunks.every(chunk => chunk.tier !== 'bronze'));
      assert(evidence.chunks.every(chunk => chunk.tier !== 'silver'));
    });
  });
}

test('all authorization mismatch codes survive Gold collection without leaking values', async () => {
  const cases: [string, unknown, PolicyReasonCode][] = [
    ['target_path', 'knowledge/other.md', 'authorization.target-mismatch'],
    ['content_sha256', '0'.repeat(64), 'authorization.content-mismatch'],
    ['reviewer_id', 'private-reviewer', 'authorization.reviewer-mismatch'],
    ['reviewed_at', '2026-06-01T00:00:00Z', 'authorization.reviewed-at-mismatch'],
    ['key_id', 'private-key', 'authorization.key-untrusted'],
    ['signature', Buffer.alloc(64).toString('base64'), 'authorization.signature-invalid'],
    ['signature', Buffer.alloc(63).toString('base64'), 'authorization.signature-encoding'],
  ];
  await withVault(async root => {
    const candidate = page();
    for (const [field, value, code] of cases) {
      const receipt = await authorizeTestPage(root, TARGET, candidate, BODY, REVIEWER);
      await writeFile(join(root, authorizationReceiptPath(TARGET)), JSON.stringify({ ...receipt, [field]: value }));
      const collection = await collectEligibleGoldChunks(root,
        [{ path: TARGET, page: candidate, pageBody: BODY }], { config: CONFIG, asOf: AS_OF });
      assert.equal(collection.chunks.length, 0);
      const reason = collection.decisions[0]?.reason_details.find(reason => reason.code === code);
      assert.equal(reason?.field, field);
      assert.equal(reason?.path, authorizationReceiptPath(TARGET));
      assert(!JSON.stringify(collection.decisions).includes('private-reviewer'));
      assert(!JSON.stringify(collection.decisions).includes('private-key'));
    }
  });
});

test('invalid contradiction state is a safe typed denial, not raw parse text', async () => {
  await withVault(async root => {
    const candidate = page();
    await authorizeTestPage(root, TARGET, candidate, BODY, REVIEWER);
    await mkdir(join(root, '.ziggurat', 'proposals'), { recursive: true });
    await writeFile(join(root, '.ziggurat', 'proposals', 'private.json'), '{"PRIVATE-MARKER":');
    const report = await goldEligibilityReport(root, TARGET, candidate, BODY, AS_OF, CONFIG);
    assert(report.reason_details.some(reason => reason.code === 'gold.contradictions-unverifiable'));
    assert(!JSON.stringify(report).includes('PRIVATE-MARKER'));
    assert.deepEqual(report.reasons, ['contradictions: state unverifiable']);
  });
});

test('Gold authorization preserves invalid-key and wrong-algorithm reason codes', async () => {
  await withVault(async root => {
    const candidate = page();
    await authorizeTestPage(root, TARGET, candidate, BODY, REVIEWER);
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    for (const [pem, code] of [
      ['PRIVATE-INVALID-KEY', 'authorization.key-invalid'],
      [publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'authorization.key-algorithm'],
    ] as const) {
      const config = {
        ...CONFIG,
        trust: { reviewers: CONFIG.trust.reviewers.map(reviewer => ({ ...reviewer, public_key_pem: pem })) },
      };
      const report = await goldEligibilityReport(root, TARGET, candidate, BODY, AS_OF, config);
      assert(report.reason_details.some(reason => reason.code === code));
      assert(!JSON.stringify(report).includes('PRIVATE-INVALID-KEY'));
    }
  });
});

for (const pii of ['false', 'unknown', 'true'] as const) {
  for (const sensitivity of ['public', 'internal', 'restricted'] as const) {
    for (const hashVerified of [true, false]) {
      test(`shared source rule: pii=${pii}, sensitivity=${sensitivity}, hash=${hashVerified}`, async () => {
        await withVault(async root => {
          await writeFile(join(root, SOURCE), bronze(pii, sensitivity) + (hashVerified ? '' : 'changed'));
          const { records } = await collectBronzeFilesDetailed(root);
          const source = records[0]!;
          const reasons = modelSourceAccessReasons(source);
          const blocked = pii !== 'false' || sensitivity === 'restricted' || !hashVerified;
          assert.equal(bronzeBlockedFromModelAccess(source), blocked);
          assert.equal(reasons.some(reason => reason.code === 'model-source.pii'), pii !== 'false');
          assert.equal(reasons.some(reason => reason.code === 'model-source.sensitivity'), sensitivity === 'restricted');
          assert.equal(reasons.some(reason => reason.code === 'model-source.hash-unverified'), !hashVerified);
          const reference = await buildBronzeReference(root);
          assert.equal(reference.sources.length, blocked ? 0 : 1);
          const explicit = await buildBronzeReference(root, { sourcePaths: [SOURCE] });
          assert.equal(explicit.sources.length, hashVerified ? 1 : 0, 'operator privacy override remains explicit');
          const staged = proposal();
          const input = {
            curated: [], bronze: records, config: CONFIG, asOf: AS_OF,
            proposals: [{ artifact_path: `.ziggurat/proposals/${PROPOSAL_ID}.json`,
              artifact_sha256: sha256Text(JSON.stringify(staged)), proposal: staged }],
          };
          const review = await buildReviewIndex(root, input);
          const evidence = await buildEvidenceIndex(root, input);
          assert.equal(review.chunks.length, blocked ? 0 : 1);
          assert.equal(evidence.chunks.length, blocked ? 0 : 1);
        });
      });
    }
  }
}

test('each Gold collection rereads receipt, lineage and contradictions rather than caching across requests', async () => {
  await withVault(async root => {
    const candidate = page();
    await authorizeTestPage(root, TARGET, candidate, BODY, REVIEWER);
    const candidates = [{ path: TARGET, page: candidate, pageBody: BODY }];
    const options = { config: CONFIG, asOf: AS_OF };
    assert.equal((await collectEligibleGoldChunks(root, candidates, options)).chunks.length, 1);
    assert.equal((await collectEligibleGoldChunks(root, candidates, {
      ...options, config: { ...CONFIG, trust: { reviewers: [] } },
    })).chunks.length, 0);
    assert.equal((await collectEligibleGoldChunks(root, candidates, {
      ...options, asOf: new Date('2027-01-01T00:00:00Z'),
    })).chunks.length, 0);
    assert.equal((await collectEligibleGoldChunks(root,
      [{ ...candidates[0]!, pageBody: BODY + 'changed' }], options)).chunks.length, 0);
    await writeFile(join(root, SOURCE), bronze() + 'changed');
    assert.equal((await collectEligibleGoldChunks(root, candidates, options)).chunks.length, 0);
    await writeFile(join(root, SOURCE), bronze());
    assert.equal((await collectEligibleGoldChunks(root, candidates, options)).chunks.length, 1);
    const receiptPath = join(root, authorizationReceiptPath(TARGET));
    const receipt = await readFile(receiptPath, 'utf8');
    await rm(receiptPath);
    assert.equal((await collectEligibleGoldChunks(root, candidates, options)).chunks.length, 0);
    await writeFile(receiptPath, receipt);
    await writeProposal(root);
    assert.equal((await collectEligibleGoldChunks(root, candidates, options)).chunks.length, 0);
  });
});

test('collected-source reuse preserves valid lineage outside the Markdown enumeration', async () => {
  await withVault(async root => {
    const source = 'bronze/source.txt';
    await writeFile(join(root, source), bronze());
    const candidate = page({ sources: [source] });
    await authorizeTestPage(root, TARGET, candidate, BODY, REVIEWER);
    const collected = await collectBronzeFilesDetailed(root);
    assert(!collected.records.some(record => record.path === source));
    const collection = await collectEligibleGoldChunks(root,
      [{ path: TARGET, page: candidate, pageBody: BODY }], {
        config: CONFIG, asOf: AS_OF, bronze: collected.records,
      });
    assert.equal(collection.chunks.length, 1);
    assert.deepEqual(collection.chunks[0]?.bronze_lineage, [{ path: source, sha256: sha256Text(SOURCE_BODY) }]);
  });
});

test('concurrent Gold checks preserve sorted chunks and all deterministic per-page decisions', async () => {
  await withVault(async root => {
    const candidates = Array.from({ length: 70 }, (_, index) => ({
      path: `knowledge/page-${String(69 - index).padStart(3, '0')}.md`,
      page: page({ pii: index % 9 === 0 ? 'unknown' : 'false' }),
      pageBody: `${BODY}${index}\n`,
    }));
    for (const candidate of candidates) {
      await authorizeTestPage(root, candidate.path, candidate.page, candidate.pageBody, REVIEWER);
    }
    const { records } = await collectBronzeFilesDetailed(root);
    const options = { config: CONFIG, asOf: AS_OF, bronze: records };
    const collected = await collectEligibleGoldChunks(root, candidates, options);
    const reversed = await collectEligibleGoldChunks(root, [...candidates].reverse(), options);
    assert.deepEqual(collected, reversed);
    assert.equal(collected.decisions.length, 70);
    assert.equal(collected.chunks.length, candidates.filter(candidate => candidate.page.pii === 'false').length);
    assert.deepEqual(collected.decisions.map(decision => decision.path), candidates.map(candidate => candidate.path).sort());
    for (const decision of collected.decisions) {
      assert.equal(decision.eligible, !decision.reason_details.some(reason => reason.code === 'gold.pii'));
    }
  });
});

test('verified Bronze reader deduplicates pending reads, freezes verified data and binds its vault', async () => {
  await withVault(async root => {
    const reader = createVerifiedBronzeReader(root);
    const first = reader.read(root, SOURCE);
    assert.equal(reader.read(root, SOURCE), first);
    const verified = await first;
    assert.equal(verified.body, SOURCE_BODY);
    assert.equal(verified.record.sha256, sha256Text(SOURCE_BODY));
    assert(Object.isFrozen(verified));
    assert(Object.isFrozen(verified.record));
    assert(Object.isFrozen(verified.lines));
    assert.equal(await reader.read(root, SOURCE), verified);
    await withVault(async otherRoot => {
      await assert.rejects(reader.read(otherRoot, SOURCE), /different vault root/u);
    });
    await writeFile(join(root, SOURCE), bronze() + 'changed');
    await assert.rejects(createVerifiedBronzeReader(root).read(root, SOURCE), /corrupt/u);
    await assert.rejects(validateEvidenceCitation(root, proposal().evidence[0]!), /corrupt/u);
  });
});

test('verified-reader citation validation retains exact range, quote and digest checks', async () => {
  await withVault(async root => {
    const reader = createVerifiedBronzeReader(root);
    const citation = proposal().evidence[0]!;
    assert.equal(await validateEvidenceCitation(root, citation, reader), null);
    for (const [override, field] of [
      [{ body_sha256: '0'.repeat(64) }, 'body_sha256'],
      [{ line_start: 0 }, 'line_range'],
      [{ line_end: 2 }, 'line_range'],
      [{ line_start: 1.5 }, 'line_range'],
      [{ quote: 'Different observation.' }, 'quote'],
      [{ quote_sha256: '0'.repeat(64) }, 'quote_sha256'],
    ] as const) {
      assert.equal((await validateEvidenceCitation(root, { ...citation, ...override }, reader))?.failed_field, field);
    }
  });
});

test('proposal and Gold collection share verified bytes but fresh default calls detect edits', async () => {
  await withVault(async root => {
    const candidate = page({ resolved_proposals: [PROPOSAL_ID] });
    await authorizeTestPage(root, TARGET, candidate, BODY, REVIEWER);
    await writeProposal(root);
    const bronzeReader = createVerifiedBronzeReader(root);
    const proposals = await collectStagedProposals(root, { bronzeReader });
    const source = await bronzeReader.read(root, SOURCE);
    const collected = await collectEligibleGoldChunks(root,
      [{ path: TARGET, page: candidate, pageBody: BODY }], {
        config: CONFIG, asOf: AS_OF, proposals, bronzeReader,
      });
    assert.equal(collected.chunks.length, 1);
    assert.equal(await bronzeReader.read(root, SOURCE), source);
    assert.deepEqual(collected.chunks[0]?.bronze_lineage, [{ path: SOURCE, sha256: source.record.sha256 }]);
    await writeFile(join(root, SOURCE), bronze() + 'changed');
    await assert.rejects(collectStagedProposals(root), /evidence is unverifiable/u);
    await assert.rejects(collectEligibleGoldChunks(root,
      [{ path: TARGET, page: candidate, pageBody: BODY }], { config: CONFIG, asOf: AS_OF }),
    /evidence is unverifiable/u);
  });
});

test('parallel proposal collection retains artifact ordering and validates every non-contradiction citation', async () => {
  await withVault(async root => {
    await mkdir(join(root, '.ziggurat', 'proposals'), { recursive: true });
    const proposals = Array.from({ length: 70 }, () => ({ ...proposal(), proposal_id: randomUUID() }));
    for (const staged of proposals) {
      await writeFile(join(root, '.ziggurat', 'proposals', `${staged.proposal_id}.json`), JSON.stringify(staged));
    }
    const bronzeReader = createVerifiedBronzeReader(root);
    const records = await collectStagedProposals(root, { bronzeReader });
    assert.equal(records.length, 70);
    assert.deepEqual(records.map(record => record.artifact_path),
      proposals.map(staged => `.ziggurat/proposals/${staged.proposal_id}.json`).sort());
    const last = proposals.at(-1)!;
    last.evidence = [{ ...last.evidence[0]!, line_end: 200 }];
    await writeFile(join(root, '.ziggurat', 'proposals', `${last.proposal_id}.json`), JSON.stringify(last));
    await assert.rejects(collectStagedProposals(root), /invalid evidence/u);
    const candidate = page();
    await authorizeTestPage(root, TARGET, candidate, BODY, REVIEWER);
    await assert.rejects(collectEligibleGoldChunks(root,
      [{ path: TARGET, page: candidate, pageBody: BODY }], { config: CONFIG, asOf: AS_OF }),
    /invalid evidence/u);
  });
});
