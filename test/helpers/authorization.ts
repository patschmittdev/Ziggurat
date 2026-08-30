import {
  generateKeyPairSync,
  sign,
} from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  authorizationReceiptPath,
  authorizationSigningPayload,
  canonicalPageSha256,
} from '../../src/authorization/canonical.js';
import type {
  AuthorizationReceipt,
  CuratedPage,
  ZigguratConfig,
} from '../../src/contracts/index.js';

export interface TestReviewer {
  reviewerId: string;
  keyId: string;
  publicKeyPem: string;
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'];
}

export function createTestReviewer(
  reviewerId = 'test-reviewer',
  keyId = 'test-reviewer-primary',
): TestReviewer {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    reviewerId,
    keyId,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey,
  };
}

export function withTestReviewer(
  base: Omit<ZigguratConfig, 'trust'>,
  reviewer: TestReviewer,
): ZigguratConfig {
  return {
    ...base,
    trust: {
      reviewers: [{
        reviewer_id: reviewer.reviewerId,
        key_id: reviewer.keyId,
        algorithm: 'ed25519',
        public_key_pem: reviewer.publicKeyPem,
      }],
    },
  };
}

export async function authorizeTestPage(
  root: string,
  targetPath: string,
  page: CuratedPage,
  body: string,
  reviewer: TestReviewer,
): Promise<AuthorizationReceipt> {
  const unsigned = {
    schema_version: 1 as const,
    decision: 'admit' as const,
    target_path: targetPath,
    content_sha256: canonicalPageSha256(targetPath, page, body),
    reviewer_id: reviewer.reviewerId,
    reviewed_at: page.reviewed_at ?? '',
    key_id: reviewer.keyId,
    algorithm: 'ed25519' as const,
  };
  const receipt: AuthorizationReceipt = {
    ...unsigned,
    signature: sign(
      null,
      authorizationSigningPayload(unsigned),
      reviewer.privateKey,
    ).toString('base64'),
  };
  const fullPath = join(root, authorizationReceiptPath(targetPath));
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  return receipt;
}
