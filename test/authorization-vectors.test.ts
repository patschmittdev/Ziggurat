import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  authorizationReceiptPath,
  authorizationSigningPayload,
  canonicalPageContent,
  canonicalPageSha256,
} from '../src/authorization/canonical.js';
import { verifyPageAuthorization } from '../src/authorization/verify.js';
import { CuratedPageSchema } from '../src/contracts/index.js';
import type {
  AuthorizationReceiptUnsigned,
  TrustedReviewer,
  ZigguratConfig,
} from '../src/contracts/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/test/ -> dist/ -> repo root -> fixtures/authorization
const VECTORS_PATH = join(
  __dirname, '..', '..', 'fixtures', 'authorization', 'receipt-vectors.json',
);

interface VectorCase {
  name: string;
  trust_reviewers: TrustedReviewer[];
  page_body: string;
  receipt: Record<string, unknown>;
  expected: { valid: boolean; reasons: string[] };
}

interface Vectors {
  protocol: string;
  canonicalization: string;
  trusted_reviewer: TrustedReviewer;
  untrusted_reviewer_public_key_pem: string;
  page: {
    target_path: string;
    receipt_path: string;
    frontmatter: Record<string, unknown>;
    body: string;
    canonical_page_content: string;
    canonical_page_content_sha256: string;
  };
  signing: {
    unsigned_receipt: AuthorizationReceiptUnsigned;
    signing_payload: string;
    signing_payload_base64: string;
    signature: string;
  };
  cases: VectorCase[];
}

async function loadVectors(): Promise<Vectors> {
  return JSON.parse(await readFile(VECTORS_PATH, 'utf8')) as Vectors;
}

function makeConfig(reviewers: readonly TrustedReviewer[]): ZigguratConfig {
  return {
    schema_version: 1,
    lifecycle: { review_queue_limit: 20 },
    domain: { page_types: ['reference'], tags: ['security'] },
    privacy: { default_sensitivity: 'restricted', default_pii: 'unknown' },
    adapters: {},
    trust: { reviewers: [...reviewers] },
  };
}

test('interop vectors: canonical page bytes and digest match the implementation', async () => {
  const vectors = await loadVectors();
  const page = CuratedPageSchema.parse(vectors.page.frontmatter);
  assert.equal(
    canonicalPageContent(vectors.page.target_path, page, vectors.page.body),
    vectors.page.canonical_page_content,
  );
  assert.equal(
    canonicalPageSha256(vectors.page.target_path, page, vectors.page.body),
    vectors.page.canonical_page_content_sha256,
  );
});

test('interop vectors: signing payload bytes match the implementation', async () => {
  const vectors = await loadVectors();
  const payload = authorizationSigningPayload(vectors.signing.unsigned_receipt);
  assert.equal(payload.toString('utf8'), vectors.signing.signing_payload);
  assert.equal(payload.toString('base64'), vectors.signing.signing_payload_base64);
});

test('interop vectors: receipt path derivation is deterministic', async () => {
  const vectors = await loadVectors();
  assert.equal(
    authorizationReceiptPath(vectors.page.target_path),
    vectors.page.receipt_path,
  );
});

test('interop vectors: the published fixture contains no private key material', async () => {
  const raw = await readFile(VECTORS_PATH, 'utf8');
  assert.doesNotMatch(raw, /PRIVATE KEY/u);
});

test('interop vectors: every published case verifies to its published expectation', async () => {
  const vectors = await loadVectors();
  const page = CuratedPageSchema.parse(vectors.page.frontmatter);
  assert.ok(vectors.cases.length >= 5, 'expected a meaningful number of vector cases');

  for (const testCase of vectors.cases) {
    const root = await mkdtemp(join(tmpdir(), 'ziggurat-vectors-'));
    try {
      const receiptFile = join(root, vectors.page.receipt_path);
      await mkdir(dirname(receiptFile), { recursive: true });
      await writeFile(
        receiptFile,
        JSON.stringify(testCase.receipt, null, 2) + '\n',
        'utf8',
      );

      const report = await verifyPageAuthorization(
        root,
        vectors.page.target_path,
        page,
        testCase.page_body,
        makeConfig(testCase.trust_reviewers),
      );

      assert.equal(
        report.valid,
        testCase.expected.valid,
        `${testCase.name}: expected valid=${String(testCase.expected.valid)}, ` +
          `got ${String(report.valid)} (${report.reasons.join('; ')})`,
      );
      assert.deepEqual(report.reasons, testCase.expected.reasons, testCase.name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('interop vectors: a missing receipt fails closed', async () => {
  const vectors = await loadVectors();
  const page = CuratedPageSchema.parse(vectors.page.frontmatter);
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-vectors-'));
  try {
    const report = await verifyPageAuthorization(
      root,
      vectors.page.target_path,
      page,
      vectors.page.body,
      makeConfig([vectors.trusted_reviewer]),
    );
    assert.equal(report.valid, false);
    assert.deepEqual(report.reasons, ['authorization receipt is missing or unreadable']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
