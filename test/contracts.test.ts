import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BronzeRecordSchema,
  CuratedPageSchema,
  RefinementProposalSchema,
} from '../src/contracts/index.js';

test('unknown PII is valid but cannot be silently converted to false', () => {
  const record = BronzeRecordSchema.parse({
    schema_version: 1,
    source_id: 'garden-water-report',
    source_kind: 'article',
    captured_at: '2026-01-01T00:00:00.000Z',
    sha256: 'a'.repeat(64),
    origin: 'https://example.invalid/report',
    sensitivity: 'restricted',
    pii: 'unknown',
  });
  assert.equal(record.pii, 'unknown');
});

test('reviewed pages require review identity and Bronze lineage', () => {
  const result = CuratedPageSchema.safeParse({
    schema_version: 1,
    title: 'Irrigation decision',
    type: 'decision',
    sources: [],
    confidence: 'high',
    status: 'reviewed',
    retrieval_eligible: true,
    sensitivity: 'public',
    visibility: 'internal',
    egress: 'local-only',
  });
  assert.equal(result.success, false);
});

test('proposal evidence requires body hash, range, quote, and digest', () => {
  const result = RefinementProposalSchema.safeParse({
    schema_version: 1,
    operation: 'create',
    target_path: 'knowledge/irrigation.md',
    evidence: [{ source_path: 'bronze/report.md' }],
    confidence: 'medium',
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
  });
  assert.equal(result.success, false);
});
