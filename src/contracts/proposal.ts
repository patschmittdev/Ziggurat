import { z } from 'zod';
import {
  EvidenceCitationSchema,
  PiiStateSchema,
  SensitivitySchema,
  UtcDateTimeSchema,
} from './common.js';
import { isKnowledgePath, isNormalizedRelativePath } from './path.js';

const VaultRelativePathSchema = z.string().refine(isNormalizedRelativePath, {
  message: 'must be a normalized vault-relative path',
});

const KnowledgePathSchema = z.string().refine(
  isKnowledgePath,
  { message: 'target_path must be a lowercase top-level Markdown path under knowledge/' },
);

const Sha256Schema = z.string().length(64).regex(/^[0-9a-f]{64}$/u);
const ConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const RefinementCandidateSchema = z.object({
  schema_version: z.literal(1),
  title: z.string().min(1),
  type: z.string().min(1),
  sources: z.array(
    z.string().refine(
      value => isNormalizedRelativePath(value)
        && value.startsWith('bronze/')
        && value.length > 'bronze/'.length,
      { message: 'candidate sources must be normalized Bronze paths' },
    ),
  ).min(1),
  confidence: ConfidenceSchema,
  retrieval_eligible: z.boolean(),
  pii: PiiStateSchema,
  sensitivity: SensitivitySchema,
  visibility: z.string().min(1),
  egress: z.enum(['local-only', 'approved-cloud']),
  body: z.string().min(1),
}).strict();

export const ProposalContradictionSchema = z.object({
  summary: z.string().min(1),
  evidence: z.array(EvidenceCitationSchema).min(1),
}).strict();

const proposalPayloadBase = z.object({
  schema_version: z.literal(2),
  operation: z.enum(['create', 'amend', 'contradict']),
  target_path: KnowledgePathSchema,
  candidate: RefinementCandidateSchema,
  base_content_sha256: Sha256Schema.optional(),
  evidence: z.array(EvidenceCitationSchema).min(1),
  contradictions: z.array(ProposalContradictionSchema),
  confidence: ConfidenceSchema,
  affected_paths: z.array(VaultRelativePathSchema),
  related_paths: z.array(VaultRelativePathSchema),
  unresolved_questions: z.array(z.string().min(1)),
}).strict();

function citationPaths(
  proposal: z.infer<typeof proposalPayloadBase>,
): Set<string> {
  return new Set([
    ...proposal.evidence.map(citation => citation.source_path),
    ...proposal.contradictions.flatMap(contradiction =>
      contradiction.evidence.map(citation => citation.source_path)),
  ]);
}

export const RefinementProposalPayloadSchema = proposalPayloadBase.superRefine((proposal, ctx) => {
  if (proposal.operation === 'create' && proposal.base_content_sha256 !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['base_content_sha256'],
      message: 'create proposals must not declare base_content_sha256',
    });
  }
  if (proposal.operation !== 'create' && proposal.base_content_sha256 === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['base_content_sha256'],
      message: `${proposal.operation} proposals require base_content_sha256`,
    });
  }
  if (proposal.operation === 'contradict' && proposal.contradictions.length === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['contradictions'],
      message: 'contradict proposals require at least one structured contradiction',
    });
  }
  if (proposal.candidate.confidence !== proposal.confidence) {
    ctx.addIssue({
      code: 'custom',
      path: ['candidate', 'confidence'],
      message: 'candidate confidence must match proposal confidence',
    });
  }

  const cited = [...citationPaths(proposal)].sort();
  const sources = [...new Set(proposal.candidate.sources)].sort();
  if (JSON.stringify(cited) !== JSON.stringify(sources)) {
    ctx.addIssue({
      code: 'custom',
      path: ['candidate', 'sources'],
      message: 'candidate sources must exactly match cited Bronze paths',
    });
  }
});

export const RefinementProposalSchema = RefinementProposalPayloadSchema.and(z.object({
  proposal_id: z.string().uuid(),
  staged_at: UtcDateTimeSchema,
  state: z.literal('staged'),
}).strict());

export type RefinementCandidate = z.infer<typeof RefinementCandidateSchema>;
export type ProposalContradiction = z.infer<typeof ProposalContradictionSchema>;
export type RefinementProposalPayload = z.infer<typeof RefinementProposalPayloadSchema>;
export type RefinementProposal = z.infer<typeof RefinementProposalSchema>;
