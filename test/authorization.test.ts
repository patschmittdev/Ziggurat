import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  authorizationReceiptPath,
  authorizationSigningPayload,
  canonicalPageSha256,
} from '../src/authorization/canonical.js';
import { verifyPageAuthorization } from '../src/authorization/verify.js';
import { sha256Text } from '../src/bronze/canonical.js';
import { goldEligibilityReport } from '../src/review/eligibility.js';
import type {
  AuthorizationReceipt,
  CuratedPage,
  ZigguratConfig,
} from '../src/contracts/index.js';

const TARGET_PATH = 'knowledge/memory-boundary.md';
const BODY = '# Memory boundary\r\n\r\nApproved reference content.\r\n';

function makePage(overrides: Partial<CuratedPage> = {}): CuratedPage {
  return {
    schema_version: 1,
    title: 'Memory boundary',
    type: 'concept',
    sources: ['bronze/source.md'],
    confidence: 'high',
    status: 'reviewed',
    retrieval_eligible: true,
    pii: 'false',
    sensitivity: 'public',
    visibility: 'internal',
    egress: 'approved-cloud',
    reviewed_by: 'reviewer-1',
    reviewed_at: '2026-08-29T00:00:00Z',
    last_verified: '2026-08-29T00:00:00Z',
    resolved_proposals: [],
    ...overrides,
  };
}

function keyMaterial() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey,
    privateKey,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function makeConfig(publicKeyPem: string): ZigguratConfig {
  return {
    schema_version: 1,
    lifecycle: { review_queue_limit: 20 },
    domain: { page_types: ['concept'], tags: ['security'] },
    privacy: { default_sensitivity: 'restricted', default_pii: 'unknown' },
    adapters: {},
    trust: {
      reviewers: [{
        reviewer_id: 'reviewer-1',
        key_id: 'reviewer-1-primary',
        algorithm: 'ed25519',
        public_key_pem: publicKeyPem,
      }],
    },
  };
}

async function writeReceipt(
  root: string,
  page: CuratedPage,
  body: string,
  privateKey: ReturnType<typeof keyMaterial>['privateKey'],
  overrides: Partial<AuthorizationReceipt> = {},
): Promise<AuthorizationReceipt> {
  const unsigned = {
    schema_version: 1 as const,
    decision: 'admit' as const,
    target_path: TARGET_PATH,
    content_sha256: canonicalPageSha256(TARGET_PATH, page, body),
    reviewer_id: page.reviewed_by ?? '',
    reviewed_at: page.reviewed_at ?? '',
    key_id: 'reviewer-1-primary',
    algorithm: 'ed25519' as const,
  };
  const receipt: AuthorizationReceipt = {
    ...unsigned,
    signature: sign(null, authorizationSigningPayload(unsigned), privateKey).toString('base64'),
    ...overrides,
  };
  const path = join(root, authorizationReceiptPath(TARGET_PATH));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  return receipt;
}

test('verifyPageAuthorization accepts a valid detached Ed25519 receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const page = makePage();
    await writeReceipt(root, page, BODY, keys.privateKey);
    const report = await verifyPageAuthorization(
      root,
      TARGET_PATH,
      page,
      BODY,
      makeConfig(keys.publicKeyPem),
    );
    assert.equal(report.valid, true, JSON.stringify(report.reasons));
    assert.equal(report.authorization?.instruction_authority, 'none');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('canonical page digest is stable across CRLF and LF', () => {
  const page = makePage();
  assert.equal(
    canonicalPageSha256(TARGET_PATH, page, BODY),
    canonicalPageSha256(TARGET_PATH, page, BODY.replace(/\r\n/g, '\n')),
  );
});

for (const [name, mutate] of [
  ['target path', (r: AuthorizationReceipt) => ({ ...r, target_path: 'knowledge/other.md' })],
  ['content digest', (r: AuthorizationReceipt) => ({ ...r, content_sha256: 'a'.repeat(64) })],
  ['reviewer identity', (r: AuthorizationReceipt) => ({ ...r, reviewer_id: 'attacker' })],
  ['review timestamp', (r: AuthorizationReceipt) => ({ ...r, reviewed_at: '2026-08-30T00:00:00Z' })],
  ['key identity', (r: AuthorizationReceipt) => ({ ...r, key_id: 'unknown' })],
  ['signature bytes', (r: AuthorizationReceipt) => ({ ...r, signature: Buffer.alloc(64, 7).toString('base64') })],
] as const) {
  test(`verifyPageAuthorization rejects tampered ${name}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
    try {
      const keys = keyMaterial();
      const page = makePage();
      const receipt = await writeReceipt(root, page, BODY, keys.privateKey);
      await writeReceipt(root, page, BODY, keys.privateKey, mutate(receipt));
      const report = await verifyPageAuthorization(
        root,
        TARGET_PATH,
        page,
        BODY,
        makeConfig(keys.publicKeyPem),
      );
      assert.equal(report.valid, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('verifyPageAuthorization rejects a receipt signed by an untrusted key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const trusted = keyMaterial();
    const untrusted = keyMaterial();
    const page = makePage();
    await writeReceipt(root, page, BODY, untrusted.privateKey);
    const report = await verifyPageAuthorization(
      root,
      TARGET_PATH,
      page,
      BODY,
      makeConfig(trusted.publicKeyPem),
    );
    assert.equal(report.valid, false);
    assert(report.reasons.some(reason => reason.includes('signature')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('verifyPageAuthorization rejects a missing receipt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const report = await verifyPageAuthorization(
      root,
      TARGET_PATH,
      makePage(),
      BODY,
      makeConfig(keys.publicKeyPem),
    );
    assert.equal(report.valid, false);
    assert(report.reasons.some(reason => reason.includes('receipt')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('trust config public key is parsed as Ed25519, not accepted by label alone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const page = makePage();
    await writeReceipt(root, page, BODY, keys.privateKey);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString();
    const report = await verifyPageAuthorization(
      root,
      TARGET_PATH,
      page,
      BODY,
      makeConfig(rsa),
    );
    assert.equal(report.valid, false);
    assert(report.reasons.some(reason => reason.includes('Ed25519')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('receipt schema rejects unknown fields instead of stripping them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const page = makePage();
    const receipt = await writeReceipt(root, page, BODY, keys.privateKey);
    const path = join(root, authorizationReceiptPath(TARGET_PATH));
    await writeFile(path, JSON.stringify({ ...receipt, approve_everything: true }), 'utf8');
    const report = await verifyPageAuthorization(
      root,
      TARGET_PATH,
      page,
      BODY,
      makeConfig(keys.publicKeyPem),
    );
    assert.equal(report.valid, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('receipt schema rejects unsupported algorithms and non-canonical base64', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const page = makePage();
    const receipt = await writeReceipt(root, page, BODY, keys.privateKey);
    const path = join(root, authorizationReceiptPath(TARGET_PATH));
    for (const invalid of [
      { ...receipt, algorithm: 'rsa' },
      { ...receipt, signature: 'not base64!' },
    ]) {
      await writeFile(path, JSON.stringify(invalid), 'utf8');
      const report = await verifyPageAuthorization(
        root,
        TARGET_PATH,
        page,
        BODY,
        makeConfig(keys.publicKeyPem),
      );
      assert.equal(report.valid, false);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('authorization is invalid after the page content changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const page = makePage();
    await writeReceipt(root, page, BODY, keys.privateKey);
    const report = await verifyPageAuthorization(
      root,
      TARGET_PATH,
      page,
      `${BODY}Changed.\n`,
      makeConfig(keys.publicKeyPem),
    );
    assert.equal(report.valid, false);
    assert(report.reasons.some(reason => reason.includes('content digest')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeBronzeSource(root: string): Promise<void> {
  const body = '# Source\n\nEvidence.\n';
  const content = [
    '---',
    'schema_version: 1',
    'source_id: source',
    'source_kind: article',
    'captured_at: 2026-08-01T00:00:00Z',
    `sha256: ${sha256Text(body)}`,
    'sensitivity: public',
    "pii: 'false'",
    '---',
    body,
  ].join('\n');
  await mkdir(join(root, 'bronze'), { recursive: true });
  await writeFile(join(root, 'bronze', 'source.md'), content, 'utf8');
}

test('Gold eligibility rejects self-asserted reviewed metadata without authorization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const page = makePage();
    await writeBronzeSource(root);
    const report = await goldEligibilityReport(
      root,
      TARGET_PATH,
      page,
      BODY,
      new Date('2026-08-29T12:00:00Z'),
      makeConfig(keys.publicKeyPem),
    );
    assert.equal(report.eligible, false);
    assert(report.reasons.some(reason => reason.includes('authorization')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Gold eligibility accepts the same page after valid human authorization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const page = makePage();
    const config = makeConfig(keys.publicKeyPem);
    await writeBronzeSource(root);
    await writeReceipt(root, page, BODY, keys.privateKey);
    const report = await goldEligibilityReport(
      root,
      TARGET_PATH,
      page,
      BODY,
      new Date('2026-08-29T12:00:00Z'),
      config,
    );
    assert.equal(report.eligible, true, JSON.stringify(report.reasons));
    assert.equal(report.authorization?.reviewer_id, 'reviewer-1');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Gold eligibility requires re-authorization when verification is stale', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const page = makePage({ last_verified: '2026-01-01T00:00:00Z' });
    const config = makeConfig(keys.publicKeyPem);
    await writeBronzeSource(root);
    await writeReceipt(root, page, BODY, keys.privateKey);
    const report = await goldEligibilityReport(
      root,
      TARGET_PATH,
      page,
      BODY,
      new Date('2026-08-29T12:00:00Z'),
      config,
    );
    assert.equal(report.eligible, false);
    assert(report.reasons.includes('last_verified: page is stale'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Gold eligibility rejects a future-dated human review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const page = makePage({
      reviewed_at: '2026-08-30T00:00:00Z',
      last_verified: '2026-08-29T00:00:00Z',
    });
    const config = makeConfig(keys.publicKeyPem);
    await writeBronzeSource(root);
    await writeReceipt(root, page, BODY, keys.privateKey);
    const report = await goldEligibilityReport(
      root,
      TARGET_PATH,
      page,
      BODY,
      new Date('2026-08-29T12:00:00Z'),
      config,
    );
    assert.equal(report.eligible, false);
    assert(report.reasons.includes('reviewed_at: future date'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a contradiction is resolved only by an authorization covering its proposal ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  try {
    const keys = keyMaterial();
    const config = makeConfig(keys.publicKeyPem);
    await writeBronzeSource(root);
    const quote = 'Evidence.';
    const evidence = {
      source_path: 'bronze/source.md',
      body_sha256: sha256Text('# Source\n\nEvidence.\n'),
      line_start: 3,
      line_end: 3,
      quote,
      quote_sha256: sha256Text(quote),
    };
    const proposalId = '7e1683fb-8fc3-47bc-a8f9-aac9d9506bf5';
    const contradiction = {
      schema_version: 2,
      proposal_id: proposalId,
      staged_at: '2026-08-28T00:00:00Z',
      state: 'staged',
      operation: 'contradict',
      target_path: TARGET_PATH,
      base_content_sha256: 'a'.repeat(64),
      candidate: {
        schema_version: 1,
        title: 'Memory boundary',
        type: 'concept',
        sources: ['bronze/source.md'],
        confidence: 'high',
        retrieval_eligible: true,
        pii: 'false',
        sensitivity: 'public',
        visibility: 'internal',
        egress: 'approved-cloud',
        body: BODY,
      },
      evidence: [evidence],
      contradictions: [{ summary: 'Evidence conflicts with the current page.', evidence: [evidence] }],
      confidence: 'high',
      affected_paths: [TARGET_PATH],
      related_paths: [],
      unresolved_questions: [],
    };
    await mkdir(join(root, '.ziggurat', 'proposals'), { recursive: true });
    await writeFile(
      join(root, '.ziggurat', 'proposals', `${proposalId}.json`),
      JSON.stringify(contradiction),
      'utf8',
    );

    const unresolvedPage = makePage();
    await writeReceipt(root, unresolvedPage, BODY, keys.privateKey);
    const blocked = await goldEligibilityReport(
      root,
      TARGET_PATH,
      unresolvedPage,
      BODY,
      new Date('2026-08-29T12:00:00Z'),
      config,
    );
    assert.equal(blocked.eligible, false);
    assert(blocked.reasons.includes('contradictions: 1 unresolved'));

    const resolvedPage = makePage({ resolved_proposals: [proposalId] });
    await writeReceipt(root, resolvedPage, BODY, keys.privateKey);
    const admitted = await goldEligibilityReport(
      root,
      TARGET_PATH,
      resolvedPage,
      BODY,
      new Date('2026-08-29T12:00:00Z'),
      config,
    );
    assert.equal(admitted.eligible, true, JSON.stringify(admitted.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Gold eligibility rejects Bronze symlinks that escape the vault', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-auth-'));
  const outside = await mkdtemp(join(tmpdir(), 'ziggurat-auth-outside-'));
  try {
    const keys = keyMaterial();
    const page = makePage();
    const body = '# Source\n\nEvidence.\n';
    const externalPath = join(outside, 'source.md');
    await writeFile(
      externalPath,
      [
        '---',
        'schema_version: 1',
        'source_id: source',
        'source_kind: article',
        'captured_at: 2026-08-01T00:00:00Z',
        `sha256: ${sha256Text(body)}`,
        'sensitivity: public',
        "pii: 'false'",
        '---',
        body,
      ].join('\n'),
      'utf8',
    );
    await mkdir(join(root, 'bronze'), { recursive: true });
    try {
      await symlink(externalPath, join(root, 'bronze', 'source.md'));
    } catch {
      return;
    }
    await writeReceipt(root, page, BODY, keys.privateKey);
    const report = await goldEligibilityReport(
      root,
      TARGET_PATH,
      page,
      BODY,
      new Date('2026-08-29T12:00:00Z'),
      makeConfig(keys.publicKeyPem),
    );
    assert.equal(report.eligible, false);
    assert(report.reasons.some(reason => reason.includes('within Bronze')));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
