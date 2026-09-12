import { z } from 'zod';
import { PiiStateSchema, SensitivitySchema } from './common.js';

export const DraftEvidenceSchema = z.object({
  source_id: z.string().min(1),
  line_start: z.number().int().min(1),
  line_end: z.number().int().min(1),
}).strict();

// Path and cross-field semantics are checked by the host, not the model grammar.
export const RefinementDraftSchema = z.object({
  schema_version: z.literal(1),
  operation: z.enum(['create', 'amend', 'contradict']),
  target_path: z.string().min(1),
  candidate: z.object({
    title: z.string().min(1),
    type: z.string().min(1),
    retrieval_eligible: z.boolean(),
    pii: PiiStateSchema,
    sensitivity: SensitivitySchema,
    visibility: z.string().min(1),
    egress: z.enum(['local-only', 'approved-cloud']),
    body: z.string().min(1),
  }).strict(),
  evidence: z.array(DraftEvidenceSchema).min(1),
  contradictions: z.array(z.object({
    summary: z.string().min(1),
    evidence: z.array(DraftEvidenceSchema).min(1),
  }).strict()),
  confidence: z.enum(['high', 'medium', 'low']),
  affected_paths: z.array(z.string().min(1)),
  related_paths: z.array(z.string().min(1)),
  unresolved_questions: z.array(z.string().min(1)),
}).strict();

export type RefinementDraft = z.infer<typeof RefinementDraftSchema>;
export type DraftEvidence = z.infer<typeof DraftEvidenceSchema>;
export const RefinementDraftJsonSchema = z.toJSONSchema(RefinementDraftSchema);
