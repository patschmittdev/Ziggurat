import assert from 'node:assert/strict';
import test from 'node:test';
import fc from 'fast-check';
import {
  canTransition,
  contextExclusionReasons,
  classifyTier,
  goldExclusionReasons,
} from '../src/policy/index.js';

test('communion excludes every non-reviewed page', () => {
  for (const status of ['draft', 'in-review'] as const) {
    const reasons = contextExclusionReasons(
      { status, retrieval_eligible: false, pii: 'false', sensitivity: 'public' },
      'communion',
      new Date('2026-01-01T00:00:00Z'),
    );
    assert(reasons.includes('status: reviewed required'));
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

test('reviewed page with false PII has no exclusion reasons for communion', () => {
  const reasons = contextExclusionReasons(
    {
      status: 'reviewed',
      retrieval_eligible: true,
      pii: 'false',
      sensitivity: 'public',
      last_verified: new Date().toISOString(),
    },
    'communion',
    new Date(),
  );
  assert.equal(reasons.length, 0);
});

test('review profile allows Silver (draft and in-review) but blocks pii', () => {
  for (const status of ['draft', 'in-review'] as const) {
    const reasons = contextExclusionReasons(
      { status, pii: 'false', sensitivity: 'internal' },
      'review',
      new Date(),
    );
    assert.equal(reasons.length, 0, `review profile should allow ${status}`);
  }
  assert(contextExclusionReasons(
    { status: 'draft', pii: 'true', sensitivity: 'internal' },
    'review',
    new Date(),
  ).includes('pii: false required'));
});

test('evidence profile excludes PII but not status', () => {
  const reasons = contextExclusionReasons(
    { status: 'in-review', pii: 'false', sensitivity: 'restricted' },
    'evidence',
    new Date(),
  );
  assert.equal(reasons.length, 0);
});

test('canTransition only allows human to demote reviewed back to in-review', () => {
  assert.equal(canTransition('reviewed', 'in-review', 'human'), true);
  assert.equal(canTransition('reviewed', 'in-review', 'refine'), false);
  assert.equal(canTransition('reviewed', 'in-review', 'ingest'), false);
});

test('canTransition allows refine to advance draft to in-review', () => {
  assert.equal(canTransition('draft', 'in-review', 'refine'), true);
  assert.equal(canTransition('draft', 'in-review', 'ingest'), false);
});

test('canTransition forbids human to skip in-review (draft to reviewed is blocked)', () => {
  assert.equal(canTransition('draft', 'reviewed', 'human'), false);
});

test('review profile permits reviewed page with false pii', () => {
  const reasons = contextExclusionReasons(
    { status: 'reviewed', pii: 'false', sensitivity: 'internal' },
    'review',
    new Date(),
  );
  assert.equal(reasons.length, 0);
});

test('classifyTier maps reviewed to gold and others to silver', () => {
  assert.equal(classifyTier('reviewed'), 'gold');
  assert.equal(classifyTier('draft'), 'silver');
  assert.equal(classifyTier('in-review'), 'silver');
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
