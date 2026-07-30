import { z } from 'zod';
import { PiiStateSchema, ReviewStatusSchema, SensitivitySchema } from './common.js';

const baseCuratedPage = z.object({
  schema_version: z.literal(1),
  title: z.string().min(1),
  type: z.string().min(1),
  sources: z.array(z.string()),
  confidence: z.union([z.literal('high'), z.literal('medium'), z.literal('low')]),
  status: ReviewStatusSchema,
  retrieval_eligible: z.boolean(),
  pii: PiiStateSchema,
  sensitivity: SensitivitySchema,
  visibility: z.string().min(1),
  egress: z.string().min(1),
  reviewed_by: z.string().optional(),
  reviewed_at: z.string().optional(),
  last_verified: z.string().optional(),
  review_after: z.string().optional(),
});

export const CuratedPageSchema = baseCuratedPage.refine(
  (data) => {
    if (data.status !== 'reviewed') return true;
    return (
      data.sources.length > 0 &&
      data.reviewed_by !== undefined &&
      data.reviewed_by.length > 0 &&
      data.reviewed_at !== undefined &&
      data.reviewed_at.length > 0 &&
      data.last_verified !== undefined &&
      data.last_verified.length > 0
    );
  },
  {
    message:
      'reviewed pages require non-empty sources, reviewed_by, reviewed_at, and last_verified',
  },
);

export type CuratedPage = z.infer<typeof CuratedPageSchema>;
