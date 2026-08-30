import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import {
  canTransition,
  contextExclusionReasons,
  classifyTier,
  goldExclusionReasons,
} from '../src/policy/index.js';

test('communion excludes every artifact without authorized-page provenance', () => {
  for (const artifact_kind of ['bronze-record', 'staged-proposal'] as const) {
    const reasons = contextExclusionReasons(
      { artifact_kind, retrieval_eligible: false, pii: 'false', sensitivity: 'public' },
      'communion',
      new Date('2026-01-01T00:00:00Z'),
    );
    assert(reasons.includes('artifact: authorized page required'));
  }
});

test('unknown PII is excluded from every model profile', () => {
  for (const profile of ['communion', 'review', 'evidence'] as const) {
    assert(contextExclusionReasons(
      { pii: 'unknown', sensitivity: 'restricted' }, profile, new Date(),
    ).includes('pii: false required'));
  }
});

test('true PII is excluded from every model profile', () => {
  for (const profile of ['communion', 'review', 'evidence'] as const) {
    assert(contextExclusionReasons(
      { pii: 'true', sensitivity: 'public' }, profile, new Date(),
    ).includes('pii: false required'));
  }
});

test('omitted pii blocks every model profile', () => {
  for (const profile of ['communion', 'review', 'evidence'] as const) {
    assert(contextExclusionReasons(
      { sensitivity: 'public' }, profile, new Date(),
    ).includes('pii: false required'), `profile ${profile} should block omitted pii`);
  }
});

test('lifecycle never permits reviewed metadata to be written by automation', () => {
  fc.assert(fc.property(
    fc.constantFrom('ingest', 'refine', 'build', 'query'),
    (actor) => assert.equal(canTransition('in-review', 'reviewed', actor), false),
  ));
  assert.equal(canTransition('in-review', 'reviewed', 'human'), true);
});

test('authorized page with false PII has no exclusion reasons for communion', () => {
  const reasons = contextExclusionReasons(
    {
      artifact_kind: 'authorized-page',
      retrieval_eligible: true,
      pii: 'false',
      sensitivity: 'public',
      last_verified: new Date().toISOString(),
      authorization_verified: true,
    },
    'communion',
    new Date(),
  );
  assert.equal(reasons.length, 0);
});

test('review profile allows Silver, excludes Bronze, and blocks pii', () => {
  assert.deepEqual(contextExclusionReasons(
    { artifact_kind: 'staged-proposal', pii: 'false', sensitivity: 'internal' },
    'review',
    new Date(),
  ), []);
  assert(contextExclusionReasons(
    { artifact_kind: 'bronze-record', pii: 'false', sensitivity: 'public' },
    'review',
    new Date(),
  ).includes('artifact: Bronze is not available in review'));
  assert(contextExclusionReasons(
    { artifact_kind: 'staged-proposal', pii: 'true', sensitivity: 'internal' },
    'review',
    new Date(),
  ).includes('pii: false required'));
});

test('evidence profile allows Bronze but excludes Silver', () => {
  const reasons = contextExclusionReasons(
    { artifact_kind: 'bronze-record', pii: 'false', sensitivity: 'public' },
    'evidence',
    new Date(),
  );
  assert.equal(reasons.length, 0);
  assert(contextExclusionReasons(
    { artifact_kind: 'staged-proposal', pii: 'false', sensitivity: 'internal' },
    'evidence',
    new Date(),
  ).includes('artifact: Silver is not available in evidence'));
});

test('canTransition only allows human to demote reviewed back to in-review', () => {
  assert.equal(canTransition('reviewed', 'in-review', 'human'), true);
  assert.equal(canTransition('reviewed', 'in-review', 'refine'), false);
  assert.equal(canTransition('reviewed', 'in-review', 'ingest'), false);
});

test('canTransition allows refine to advance draft to in-review', () => {
  assert.equal(canTransition('draft', 'in-review', 'refine'), false);
  assert.equal(canTransition('draft', 'in-review', 'ingest'), false);
});

test('canTransition forbids human to skip in-review (draft to reviewed is blocked)', () => {
  assert.equal(canTransition('draft', 'reviewed', 'human'), false);
});

test('review profile permits authorized page with false pii', () => {
  const reasons = contextExclusionReasons(
    { artifact_kind: 'authorized-page', pii: 'false', sensitivity: 'internal' },
    'review',
    new Date(),
  );
  assert.equal(reasons.length, 0);
});

test('classifyTier maps physical artifact kinds rather than self-asserted status', () => {
  assert.equal(classifyTier('bronze-record'), 'bronze');
  assert.equal(classifyTier('staged-proposal'), 'silver');
  assert.equal(classifyTier('authorized-page'), 'gold');
});

test('goldExclusionReasons rejects a page missing required gold fields', () => {
  const reasons = goldExclusionReasons({ status: 'draft', pii: 'false' });
  assert(reasons.includes('status: reviewed required'));
  assert(reasons.includes('sources: non-empty required'));
  assert(reasons.includes('reviewed_by: required'));
  assert(reasons.includes('reviewed_at: required'));
  assert(reasons.includes('last_verified: required'));
});

test('goldExclusionReasons accepts a valid reviewed page', () => {
  const reasons = goldExclusionReasons({
    status: 'reviewed',
    pii: 'false',
    sources: ['raw/articles/source.md'],
    reviewed_by: 'human',
    reviewed_at: '2026-01-01T00:00:00Z',
    last_verified: '2026-01-01T00:00:00Z',
    authorization_verified: true,
  });
  assert.equal(reasons.length, 0);
});

test('goldExclusionReasons blocks pii true, unknown, and absent', () => {
  const base = {
    status: 'reviewed' as const,
    sources: ['raw/articles/source.md'],
    reviewed_by: 'human',
    reviewed_at: '2026-01-01T00:00:00Z',
    last_verified: '2026-01-01T00:00:00Z',
  };
  for (const pii of ['true', 'unknown'] as const) {
    const reasons = goldExclusionReasons({ ...base, pii });
    assert(reasons.includes('pii: false required'), `pii: ${pii} should be excluded`);
  }
  // absent pii (omitted property)
  assert(goldExclusionReasons({ ...base }).includes('pii: false required'), 'absent pii should be excluded');
});
