import { sha256Text } from '../bronze/canonical.js';
import type {
  AuthorizationReceipt,
  AuthorizationReceiptUnsigned,
  CuratedPage,
} from '../contracts/index.js';
import { isKnowledgePath } from '../contracts/path.js';

function assertKnowledgePath(targetPath: string): void {
  const valid = isKnowledgePath(targetPath);
  if (!valid) {
    throw new Error('target path must be lowercase top-level Markdown under knowledge/');
  }
}

export function normalizeText(value: string): string {
  return value.replace(/\r\n?/gu, '\n');
}

export function canonicalPageContent(
  targetPath: string,
  page: CuratedPage,
  body: string,
): string {
  assertKnowledgePath(targetPath);
  return JSON.stringify({
    domain: 'ziggurat-curated-page-v1',
    target_path: targetPath,
    page: {
      schema_version: page.schema_version,
      title: page.title,
      type: page.type,
      sources: page.sources,
      confidence: page.confidence,
      status: page.status,
      retrieval_eligible: page.retrieval_eligible,
      pii: page.pii,
      sensitivity: page.sensitivity,
      visibility: page.visibility,
      egress: page.egress,
      reviewed_by: page.reviewed_by ?? null,
      reviewed_at: page.reviewed_at ?? null,
      last_verified: page.last_verified ?? null,
      review_after: page.review_after ?? null,
      resolved_proposals: page.resolved_proposals ?? [],
    },
    body: normalizeText(body),
  });
}

export function canonicalPageSha256(
  targetPath: string,
  page: CuratedPage,
  body: string,
): string {
  return sha256Text(canonicalPageContent(targetPath, page, body));
}

export function authorizationReceiptPath(targetPath: string): string {
  assertKnowledgePath(targetPath);
  return `authorizations/${targetPath.slice('knowledge/'.length)}.authorization.json`;
}

export function authorizationSigningPayload(
  receipt: AuthorizationReceiptUnsigned,
): Buffer {
  return Buffer.from(JSON.stringify({
    domain: 'ziggurat-authorization-receipt-v1',
    schema_version: receipt.schema_version,
    decision: receipt.decision,
    target_path: receipt.target_path,
    content_sha256: receipt.content_sha256,
    reviewer_id: receipt.reviewer_id,
    reviewed_at: receipt.reviewed_at,
    key_id: receipt.key_id,
    algorithm: receipt.algorithm,
  }), 'utf8');
}

export function canonicalReceiptContent(receipt: AuthorizationReceipt): string {
  return JSON.stringify({
    schema_version: receipt.schema_version,
    decision: receipt.decision,
    target_path: receipt.target_path,
    content_sha256: receipt.content_sha256,
    reviewer_id: receipt.reviewer_id,
    reviewed_at: receipt.reviewed_at,
    key_id: receipt.key_id,
    algorithm: receipt.algorithm,
    signature: receipt.signature,
  });
}
