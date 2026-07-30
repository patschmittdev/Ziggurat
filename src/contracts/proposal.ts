import { z } from 'zod';
import { EvidenceCitationSchema } from './common.js';

export const RefinementProposalSchema = z.object({
  schema_version: z.literal(1),
  operation: z.union([
    z.literal('create'),
    z.literal('update'),
    z.literal('deprecate'),
  ]),
  target_path: z.string().min(1),
  evidence: z.array(EvidenceCitationSchema).min(1),
  confidence: z.union([z.literal('high'), z.literal('medium'), z.literal('low')]),
  affected_paths: z.array(z.string()),
  related_paths: z.array(z.string()),
  unresolved_questions: z.array(z.string()),
});

export type RefinementProposal = z.infer<typeof RefinementProposalSchema>;
