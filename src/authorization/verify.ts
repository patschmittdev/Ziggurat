import { createPublicKey, verify } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Text } from '../bronze/canonical.js';
import { AuthorizationReceiptSchema } from '../contracts/index.js';
import type {
  AuthorizationReceipt,
  CuratedPage,
  ZigguratConfig,
} from '../contracts/index.js';
import {
  authorizationReceiptPath,
  authorizationSigningPayload,
  canonicalPageSha256,
  canonicalReceiptContent,
} from './canonical.js';
import { assertRealPathWithinRoot } from '../fs/boundary.js';
import type { PolicyReason, PolicyReasonCode } from '../policy/reasons.js';

export interface VerifiedAuthorization {
  receipt_path: string;
  receipt_sha256: string;
  content_sha256: string;
  reviewer_id: string;
  reviewed_at: string;
  key_id: string;
  algorithm: 'ed25519';
  decision: 'admit';
  instruction_authority: 'none';
}

export interface AuthorizationReport {
  valid: boolean;
  reasons: string[];
  reason_details: PolicyReason[];
  authorization?: VerifiedAuthorization;
}

function decodeCanonicalBase64(value: string): Buffer | null {
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function verifyPageAuthorization(
  root: string,
  targetPath: string,
  page: CuratedPage,
  body: string,
  config: ZigguratConfig,
): Promise<AuthorizationReport> {
  const reason_details: PolicyReason[] = [];
  let receipt: AuthorizationReceipt;
  const receiptPath = authorizationReceiptPath(targetPath);
  const reject = (code: PolicyReasonCode, message: string, field?: string): void => {
    reason_details.push({
      code, message, path: receiptPath, ...(field === undefined ? {} : { field }),
    });
  };
  const rejected = (): AuthorizationReport => {
    reason_details.sort((a, b) => a.message < b.message ? -1 : a.message > b.message ? 1 : 0);
    return { valid: false, reasons: reason_details.map(reason => reason.message), reason_details };
  };

  try {
    const fullReceiptPath = join(root, receiptPath);
    await assertRealPathWithinRoot(root, fullReceiptPath, 'Authorization receipt');
    const parsed = JSON.parse(await readFile(fullReceiptPath, 'utf8')) as unknown;
    const result = AuthorizationReceiptSchema.safeParse(parsed);
    if (!result.success) {
      reject('authorization.receipt-schema-invalid', 'authorization receipt failed strict schema validation');
      return rejected();
    }
    receipt = result.data;
  } catch {
    reject('authorization.receipt-unreadable', 'authorization receipt is missing or unreadable');
    return rejected();
  }

  const contentSha256 = canonicalPageSha256(targetPath, page, body);
  if (receipt.target_path !== targetPath) {
    reject('authorization.target-mismatch', 'authorization target path does not match page', 'target_path');
  }
  if (receipt.content_sha256 !== contentSha256) {
    reject('authorization.content-mismatch', 'authorization content digest does not match page', 'content_sha256');
  }
  if (receipt.reviewer_id !== page.reviewed_by) {
    reject('authorization.reviewer-mismatch', 'authorization reviewer identity does not match page', 'reviewer_id');
  }
  if (receipt.reviewed_at !== page.reviewed_at) {
    reject('authorization.reviewed-at-mismatch', 'authorization review timestamp does not match page', 'reviewed_at');
  }

  const reviewer = config.trust.reviewers.find(candidate =>
    candidate.reviewer_id === receipt.reviewer_id && candidate.key_id === receipt.key_id);
  if (reviewer === undefined) {
    reject('authorization.key-untrusted', 'authorization reviewer key is not trusted', 'key_id');
  } else {
    try {
      const publicKey = createPublicKey(reviewer.public_key_pem);
      if (publicKey.asymmetricKeyType !== 'ed25519') {
        reject('authorization.key-algorithm', 'authorization key must be Ed25519', 'key_id');
      } else {
        const signature = decodeCanonicalBase64(receipt.signature);
        if (signature === null || signature.length !== 64) {
          reject('authorization.signature-encoding', 'authorization signature is not canonical Ed25519 base64', 'signature');
        } else if (!verify(
          null,
          authorizationSigningPayload(receipt),
          publicKey,
          signature,
        )) {
          reject('authorization.signature-invalid', 'authorization signature verification failed', 'signature');
        }
      }
    } catch {
      reject('authorization.key-invalid', 'authorization public key is invalid', 'key_id');
    }
  }

  if (reason_details.length > 0) return rejected();

  return {
    valid: true,
    reasons: [],
    reason_details: [],
    authorization: {
      receipt_path: receiptPath,
      receipt_sha256: sha256Text(canonicalReceiptContent(receipt)),
      content_sha256: receipt.content_sha256,
      reviewer_id: receipt.reviewer_id,
      reviewed_at: receipt.reviewed_at,
      key_id: receipt.key_id,
      algorithm: receipt.algorithm,
      decision: receipt.decision,
      instruction_authority: 'none',
    },
  };
}
