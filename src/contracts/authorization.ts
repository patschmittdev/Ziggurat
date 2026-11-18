import { z } from 'zod';
import { createPublicKey } from 'node:crypto';
import { isKnowledgePath } from './path.js';
import { UtcDateTimeSchema } from './common.js';

const Sha256Schema = z.string().length(64).regex(/^[0-9a-f]{64}$/u);
const KnowledgePathSchema = z.string().refine(value =>
  isKnowledgePath(value), {
  message: 'target_path must be a lowercase top-level Markdown path under knowledge/',
});

export const TrustedReviewerSchema = z.object({
  reviewer_id: z.string().min(1),
  key_id: z.string().min(1),
  algorithm: z.literal('ed25519'),
  public_key_pem: z.string()
    .startsWith('-----BEGIN PUBLIC KEY-----')
    .endsWith('-----END PUBLIC KEY-----\n'),
}).strict().superRefine((reviewer, ctx) => {
  try {
    if (createPublicKey(reviewer.public_key_pem).asymmetricKeyType !== 'ed25519') {
      ctx.addIssue({
        code: 'custom',
        path: ['public_key_pem'],
        message: 'public_key_pem must contain an Ed25519 public key',
      });
    }
  } catch {
    ctx.addIssue({
      code: 'custom',
      path: ['public_key_pem'],
      message: 'public_key_pem must contain a valid public key',
    });
  }
});

export const TrustPolicySchema = z.object({
  reviewers: z.array(TrustedReviewerSchema),
}).strict().superRefine((policy, ctx) => {
  const identities = new Set<string>();
  const keys = new Set<string>();
  policy.reviewers.forEach((reviewer, index) => {
    if (identities.has(reviewer.reviewer_id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewers', index, 'reviewer_id'],
        message: 'reviewer_id must be unique',
      });
    }
    if (keys.has(reviewer.key_id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reviewers', index, 'key_id'],
        message: 'key_id must be unique',
      });
    }
    identities.add(reviewer.reviewer_id);
    keys.add(reviewer.key_id);
  });
});

export const TrustConfigSchema = z.object({
  trust: TrustPolicySchema,
}).strict();

export const AuthorizationReceiptUnsignedSchema = z.object({
  schema_version: z.literal(1),
  decision: z.literal('admit'),
  target_path: KnowledgePathSchema,
  content_sha256: Sha256Schema,
  reviewer_id: z.string().min(1),
  reviewed_at: UtcDateTimeSchema,
  key_id: z.string().min(1),
  algorithm: z.literal('ed25519'),
}).strict();

export const AuthorizationReceiptSchema = AuthorizationReceiptUnsignedSchema.extend({
  signature: z.string().min(1).regex(
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u,
    'signature must be canonical base64',
  ),
}).strict();

export type TrustedReviewer = z.infer<typeof TrustedReviewerSchema>;
export type TrustPolicy = z.infer<typeof TrustPolicySchema>;
export type AuthorizationReceiptUnsigned = z.infer<typeof AuthorizationReceiptUnsignedSchema>;
export type AuthorizationReceipt = z.infer<typeof AuthorizationReceiptSchema>;
