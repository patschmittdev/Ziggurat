import { z } from 'zod';

export const UtcDateTimeSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u,
  'must be a UTC ISO-8601 datetime',
);

export type PiiState = 'true' | 'false' | 'unknown';
export type Sensitivity = 'public' | 'internal' | 'restricted';
export type ReviewStatus = 'draft' | 'in-review' | 'reviewed';
export type AccessProfile = 'gold' | 'review' | 'evidence';

export const PiiStateSchema = z.union([
  z.literal('true'),
  z.literal('false'),
  z.literal('unknown'),
]);

export const SensitivitySchema = z.union([
  z.literal('public'),
  z.literal('internal'),
  z.literal('restricted'),
]);

export const ReviewStatusSchema = z.union([
  z.literal('draft'),
  z.literal('in-review'),
  z.literal('reviewed'),
]);

export const AccessProfileSchema = z.union([
  z.literal('gold'),
  z.literal('review'),
  z.literal('evidence'),
]);

export interface EvidenceCitation {
  source_path: string;
  body_sha256: string;
  line_start: number;
  line_end: number;
  quote: string;
  quote_sha256: string;
}

const hexSha256 = z.string().length(64).regex(/^[0-9a-f]{64}$/);

export const EvidenceCitationSchema = z.object({
  source_path: z.string().min(1),
  body_sha256: hexSha256,
  line_start: z.number().int().min(1),
  line_end: z.number().int().min(1),
  quote: z.string().min(1),
  quote_sha256: hexSha256,
}).strict().superRefine((citation, ctx) => {
  if (citation.line_end < citation.line_start) {
    ctx.addIssue({
      code: 'custom',
      path: ['line_end'],
      message: 'line_end must be greater than or equal to line_start',
    });
  }
});
