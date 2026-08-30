import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BronzeRecordSchema,
  CuratedPageSchema,
  RefinementProposalPayloadSchema,
  RefinementProposalSchema,
  TrustConfigSchema,
  ZigguratConfigSchema,
  parseZigguratConfig,
} from '../src/contracts/index.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const VALID_ZIGGURAT = 'schema_version: 1\nlifecycle:\n  review_queue_limit: 50\n';
const VALID_DOMAIN = 'domain:\n  page_types:\n    - entity\n  tags:\n    - ai\n';
const VALID_PRIVACY = 'privacy:\n  default_sensitivity: restricted\n  default_pii: unknown\n';
const VALID_ADAPTERS = 'adapters: {}\n';
const VALID_TRUST = 'trust:\n  reviewers: []\n';

async function withTempConfig(
  overrides: {
    ziggurat?: string;
    domain?: string;
    privacy?: string;
    adapters?: string;
    trust?: string;
  },
  fn: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-test-'));
  try {
    const configDir = join(root, 'config');
    await mkdir(configDir);
    await writeFile(join(configDir, 'ziggurat.yaml'), overrides.ziggurat ?? VALID_ZIGGURAT);
    await writeFile(join(configDir, 'domain.yaml'), overrides.domain ?? VALID_DOMAIN);
    await writeFile(join(configDir, 'privacy.yaml'), overrides.privacy ?? VALID_PRIVACY);
    await writeFile(join(configDir, 'adapters.yaml'), overrides.adapters ?? VALID_ADAPTERS);
    await writeFile(join(configDir, 'trust.yaml'), overrides.trust ?? VALID_TRUST);
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

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

test('curated review timestamps require canonical UTC datetimes', () => {
  const result = CuratedPageSchema.safeParse({
    schema_version: 1,
    title: 'Irrigation decision',
    type: 'decision',
    sources: ['bronze/source.md'],
    confidence: 'high',
    status: 'reviewed',
    retrieval_eligible: true,
    pii: 'false',
    sensitivity: 'public',
    visibility: 'internal',
    egress: 'approved-cloud',
    reviewed_by: 'reviewer',
    reviewed_at: '2026-08-29T00:00:00',
    last_verified: '2026-08-29',
  });
  assert.equal(result.success, false);
});

test('proposal payload requires a complete evidence-backed candidate', () => {
  const result = RefinementProposalPayloadSchema.safeParse({
    schema_version: 2,
    operation: 'create',
    target_path: 'knowledge/irrigation.md',
    candidate: {
      schema_version: 1,
      title: 'Irrigation',
      type: 'concept',
      sources: ['bronze/report.md'],
      confidence: 'medium',
      retrieval_eligible: false,
      pii: 'unknown',
      sensitivity: 'restricted',
      visibility: 'internal',
      egress: 'local-only',
      body: '# Irrigation\n',
    },
    evidence: [{ source_path: 'bronze/report.md' }],
    confidence: 'medium',
    contradictions: [],
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
  });
  assert.equal(result.success, false);
});

test('proposal candidate rejects human admission fields', () => {
  const evidence = {
    source_path: 'bronze/report.md',
    body_sha256: 'a'.repeat(64),
    line_start: 1,
    line_end: 1,
    quote: 'Evidence',
    quote_sha256: 'b'.repeat(64),
  };
  const result = RefinementProposalPayloadSchema.safeParse({
    schema_version: 2,
    operation: 'create',
    target_path: 'knowledge/irrigation.md',
    candidate: {
      schema_version: 1,
      title: 'Irrigation',
      type: 'concept',
      sources: ['bronze/report.md'],
      confidence: 'medium',
      retrieval_eligible: false,
      pii: 'unknown',
      sensitivity: 'restricted',
      visibility: 'internal',
      egress: 'local-only',
      body: '# Irrigation\n',
      status: 'reviewed',
      reviewed_by: 'model',
    },
    evidence: [evidence],
    confidence: 'medium',
    contradictions: [],
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
  });

  assert.equal(result.success, false);
});

test('proposal paths reject terminal control characters', () => {
  const result = RefinementProposalPayloadSchema.safeParse({
    schema_version: 2,
    operation: 'create',
    target_path: 'knowledge/\u001b[2Jfake.md',
    candidate: {
      schema_version: 1,
      title: 'Candidate',
      type: 'concept',
      sources: ['bronze/report.md'],
      confidence: 'medium',
      retrieval_eligible: false,
      pii: 'unknown',
      sensitivity: 'restricted',
      visibility: 'internal',
      egress: 'local-only',
      body: 'Candidate body.',
    },
    evidence: [{
      source_path: 'bronze/report.md',
      body_sha256: 'a'.repeat(64),
      line_start: 1,
      line_end: 1,
      quote: 'Evidence',
      quote_sha256: 'b'.repeat(64),
    }],
    contradictions: [],
    confidence: 'medium',
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
  });

  assert.equal(result.success, false);
});

test('proposal targets reject case aliases, nested paths, and non-Markdown files', () => {
  const base = {
    schema_version: 2,
    operation: 'create',
    candidate: {
      schema_version: 1,
      title: 'Candidate',
      type: 'concept',
      sources: ['bronze/report.md'],
      confidence: 'medium',
      retrieval_eligible: false,
      pii: 'unknown',
      sensitivity: 'restricted',
      visibility: 'internal',
      egress: 'local-only',
      body: 'Candidate body.',
    },
    evidence: [{
      source_path: 'bronze/report.md',
      body_sha256: 'a'.repeat(64),
      line_start: 1,
      line_end: 1,
      quote: 'Evidence',
      quote_sha256: 'b'.repeat(64),
    }],
    contradictions: [],
    confidence: 'medium',
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
  };
  for (const target_path of [
    'knowledge/Policy.md',
    'knowledge/nested/policy.md',
    'knowledge/policy.txt',
    'knowledge/con.md',
    'knowledge/topic..md',
  ]) {
    assert.equal(
      RefinementProposalPayloadSchema.safeParse({ ...base, target_path }).success,
      false,
    );
  }
});

test('proposal evidence rejects unknown nested fields', () => {
  const result = RefinementProposalPayloadSchema.safeParse({
    schema_version: 2,
    operation: 'create',
    target_path: 'knowledge/candidate.md',
    candidate: {
      schema_version: 1,
      title: 'Candidate',
      type: 'concept',
      sources: ['bronze/report.md'],
      confidence: 'medium',
      retrieval_eligible: false,
      pii: 'unknown',
      sensitivity: 'restricted',
      visibility: 'internal',
      egress: 'local-only',
      body: 'Candidate body.',
    },
    evidence: [{
      source_path: 'bronze/report.md',
      body_sha256: 'a'.repeat(64),
      line_start: 1,
      line_end: 1,
      quote: 'Evidence',
      quote_sha256: 'b'.repeat(64),
      reviewed: true,
    }],
    contradictions: [],
    confidence: 'medium',
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
  });
  assert.equal(result.success, false);
});

test('staged proposal requires locally assigned audit fields', () => {
  const result = RefinementProposalSchema.safeParse({
    schema_version: 2,
    operation: 'create',
    target_path: 'knowledge/irrigation.md',
  });
  assert.equal(result.success, false);
});

test('trust config rejects private and unknown fields', () => {
  const result = TrustConfigSchema.safeParse({
    trust: {
      reviewers: [{
        reviewer_id: 'reviewer',
        key_id: 'primary',
        algorithm: 'ed25519',
        public_key_pem: '-----BEGIN PUBLIC KEY-----\ninvalid\n-----END PUBLIC KEY-----',
        private_key_pem: 'forbidden',
      }],
    },
  });

  assert.equal(result.success, false);
});

test('trust config rejects malformed public key material', () => {
  const result = TrustConfigSchema.safeParse({
    trust: {
      reviewers: [{
        reviewer_id: 'reviewer',
        key_id: 'primary',
        algorithm: 'ed25519',
        public_key_pem: '-----BEGIN PUBLIC KEY-----\ninvalid\n-----END PUBLIC KEY-----\n',
      }],
    },
  });
  assert.equal(result.success, false);
});

// === ZigguratConfigSchema export (Finding 1) ===

test('ZigguratConfigSchema is exported and validates a valid config', () => {
  const result = ZigguratConfigSchema.safeParse({
    schema_version: 1,
    lifecycle: { review_queue_limit: 50 },
    domain: { page_types: ['entity'], tags: ['ai'] },
    privacy: { default_sensitivity: 'restricted', default_pii: 'unknown' },
    adapters: {},
    trust: { reviewers: [] },
  });
  assert.equal(result.success, true);
});

// === parseZigguratConfig filesystem tests (Finding 3) ===

test('parseZigguratConfig: committed config happy path', async () => {
  const config = await parseZigguratConfig(PROJECT_ROOT);
  assert.equal(config.schema_version, 1);
  assert.ok(config.lifecycle.review_queue_limit > 0);
  assert.ok(config.domain.page_types.length > 0);
  assert.ok(config.domain.tags.length > 0);
});

test('parseZigguratConfig: rejects tab characters', async () => {
  const tabYaml = 'schema_version: 1\nlifecycle:\n\treview_queue_limit: 50\n';
  await withTempConfig({ ziggurat: tabYaml }, async (root) => {
    await assert.rejects(() => parseZigguratConfig(root), /tab/i);
  });
});

test('parseZigguratConfig: rejects YAML anchors', async () => {
  const anchorYaml = 'schema_version: 1\nlifecycle:\n  review_queue_limit: &lim 50\n';
  await withTempConfig({ ziggurat: anchorYaml }, async (root) => {
    await assert.rejects(() => parseZigguratConfig(root), /anchor/i);
  });
});

test('parseZigguratConfig: rejects YAML aliases', async () => {
  const aliasYaml =
    'defaults: &defaults\n  review_queue_limit: 50\nlifecycle: *defaults\nschema_version: 1\n';
  await withTempConfig({ ziggurat: aliasYaml }, async (root) => {
    await assert.rejects(() => parseZigguratConfig(root), /alias/i);
  });
});

test('parseZigguratConfig: rejects explicit YAML type tags (Finding 2)', async () => {
  const tagYaml = 'schema_version: 1\nlifecycle:\n  review_queue_limit: !!int 50\n';
  await withTempConfig({ ziggurat: tagYaml }, async (root) => {
    await assert.rejects(() => parseZigguratConfig(root), /tag/i);
  });
});

test('parseZigguratConfig: accepts comments containing !!', async () => {
  const commentYaml =
    '# !! important: do not lower this limit\nschema_version: 1\nlifecycle:\n  review_queue_limit: 50\n';
  await withTempConfig({ ziggurat: commentYaml }, async (root) => {
    const config = await parseZigguratConfig(root);
    assert.equal(config.schema_version, 1);
  });
});

test('parseZigguratConfig: accepts quoted strings containing !!', async () => {
  const quotedDomain = 'domain:\n  page_types:\n    - "page !! annotated"\n  tags:\n    - ai\n';
  await withTempConfig({ domain: quotedDomain }, async (root) => {
    const config = await parseZigguratConfig(root);
    assert.ok(config.domain.page_types[0]?.includes('!!'));
  });
});

test('parseZigguratConfig: rejects non-loopback adapter endpoint', async () => {
  const remoteAdapters = 'adapters:\n  model_endpoint: http://example.com/api\n';
  await withTempConfig({ adapters: remoteAdapters }, async (root) => {
    await assert.rejects(() => parseZigguratConfig(root), /loopback/i);
  });

});

test('parseZigguratConfig: rejects non-HTTP schemes even on loopback', async () => {
  const adapters = 'adapters:\n  embedding_endpoint: https://localhost/embeddings\n';
  await withTempConfig({ adapters }, async (root) => {
    await assert.rejects(() => parseZigguratConfig(root), /http.*loopback|loopback.*http/iu);
  });
});
