import { z } from 'zod';
import { EvidenceCitationSchema } from './common.js';

function isNormalizedRelativePath(s: string): boolean {
  if (s === '' || s.includes('\\') || s.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(s)) return false;
  return s.split('/').every(p => p !== '' && p !== '.' && p !== '..');
}

const VaultRelativePathSchema = z
  .string()
  .refine(isNormalizedRelativePath, {
    message: 'must be a normalized vault-relative path (no backslash, absolute, or dot segments)',
  });

const KnowledgePathSchema = z
  .string()
  .refine(
    s => isNormalizedRelativePath(s) && s.startsWith('knowledge/') && s.length > 'knowledge/'.length,
    { message: 'target_path must be a normalized relative path under knowledge/' },
  );

export const RefinementProposalSchema = z.object({
  schema_version: z.literal(1),
  operation: z.union([
    z.literal('create'),
    z.literal('amend'),
    z.literal('contradict'),
  ]),
  target_path: KnowledgePathSchema,
  evidence: z.array(EvidenceCitationSchema).min(1),
  confidence: z.union([z.literal('high'), z.literal('medium'), z.literal('low')]),
  affected_paths: z.array(VaultRelativePathSchema),
  related_paths: z.array(VaultRelativePathSchema),
  unresolved_questions: z.array(z.string()),
});

export type RefinementProposal = z.infer<typeof RefinementProposalSchema>;
