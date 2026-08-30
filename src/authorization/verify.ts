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
  const reasons: string[] = [];
  let receipt: AuthorizationReceipt;
  const receiptPath = authorizationReceiptPath(targetPath);

  try {
    const fullReceiptPath = join(root, receiptPath);
    await assertRealPathWithinRoot(root, fullReceiptPath, 'Authorization receipt');
    const parsed = JSON.parse(await readFile(fullReceiptPath, 'utf8')) as unknown;
    const result = AuthorizationReceiptSchema.safeParse(parsed);
    if (!result.success) {
      return { valid: false, reasons: ['authorization receipt failed strict schema validation'] };
    }
    receipt = result.data;
  } catch {
    return { valid: false, reasons: ['authorization receipt is missing or unreadable'] };
  }

  const contentSha256 = canonicalPageSha256(targetPath, page, body);
  if (receipt.target_path !== targetPath) {
    reasons.push('authorization target path does not match page');
  }
  if (receipt.content_sha256 !== contentSha256) {
    reasons.push('authorization content digest does not match page');
  }
  if (receipt.reviewer_id !== page.reviewed_by) {
    reasons.push('authorization reviewer identity does not match page');
  }
  if (receipt.reviewed_at !== page.reviewed_at) {
    reasons.push('authorization review timestamp does not match page');
  }

  const reviewer = config.trust.reviewers.find(candidate =>
    candidate.reviewer_id === receipt.reviewer_id && candidate.key_id === receipt.key_id);
  if (reviewer === undefined) {
    reasons.push('authorization reviewer key is not trusted');
  } else {
    try {
      const publicKey = createPublicKey(reviewer.public_key_pem);
      if (publicKey.asymmetricKeyType !== 'ed25519') {
        reasons.push('authorization key must be Ed25519');
      } else {
        const signature = decodeCanonicalBase64(receipt.signature);
        if (signature === null || signature.length !== 64) {
          reasons.push('authorization signature is not canonical Ed25519 base64');
        } else if (!verify(
          null,
          authorizationSigningPayload(receipt),
          publicKey,
          signature,
        )) {
          reasons.push('authorization signature verification failed');
        }
      }
    } catch {
      reasons.push('authorization public key is invalid');
    }
  }

  reasons.sort();
  if (reasons.length > 0) return { valid: false, reasons };

  return {
    valid: true,
    reasons: [],
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
