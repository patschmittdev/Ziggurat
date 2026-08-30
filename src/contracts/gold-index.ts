import { z } from 'zod';

const Sha256Schema = z.string().length(64).regex(/^[0-9a-f]{64}$/u);

const AuthorizationProvenanceSchema = z.object({
  receipt_path: z.string().min(1),
  receipt_sha256: Sha256Schema,
  content_sha256: Sha256Schema,
  reviewer_id: z.string().min(1),
  reviewed_at: z.string().min(1),
  key_id: z.string().min(1),
  algorithm: z.literal('ed25519'),
  decision: z.literal('admit'),
}).strict();

export const GoldChunkSchema = z.object({
  id: Sha256Schema,
  path: z.string().min(1),
  heading: z.string().min(1),
  body: z.string().min(1),
  bronze_lineage: z.array(z.object({
    path: z.string().min(1),
    sha256: Sha256Schema,
  }).strict()),
  profile: z.literal('communion'),
  tier: z.literal('gold'),
  status: z.literal('reviewed'),
  content_role: z.literal('reference'),
  instruction_authority: z.literal('none'),
  authorization: AuthorizationProvenanceSchema,
}).strict();

export type GoldChunk = z.infer<typeof GoldChunkSchema>;

const ProfileProvenanceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('bronze'),
    body_sha256: Sha256Schema,
  }).strict(),
  z.object({
    kind: z.literal('proposal'),
    proposal_id: z.string().uuid(),
    artifact_path: z.string().min(1),
    artifact_sha256: Sha256Schema,
  }).strict(),
  z.object({
    kind: z.literal('authorization'),
    receipt_path: z.string().min(1),
    receipt_sha256: Sha256Schema,
    reviewer_id: z.string().min(1),
    key_id: z.string().min(1),
    bronze_lineage: z.array(z.object({
      path: z.string().min(1),
      sha256: Sha256Schema,
    }).strict()),
  }).strict(),
]);

export const ProfileChunkSchema = z.object({
  id: Sha256Schema,
  path: z.string().min(1),
  heading: z.string().min(1),
  body: z.string().min(1),
  profile: z.enum(['review', 'evidence']),
  tier: z.enum(['gold', 'silver', 'bronze']),
  status: z.enum(['bronze', 'staged', 'reviewed']),
  content_role: z.literal('reference'),
  instruction_authority: z.literal('none'),
  provenance: ProfileProvenanceSchema,
}).strict();

export type ProfileChunk = z.infer<typeof ProfileChunkSchema>;

export const Bm25SnapshotSchema = z.object({
  k1: z.number(),
  b: z.number(),
  avg_doc_length: z.number(),
  doc_count: z.number(),
  doc_lengths: z.record(z.string(), z.number()),
  term_doc_freqs: z.record(z.string(), z.record(z.string(), z.number())),
}).strict();

export type Bm25Snapshot = z.infer<typeof Bm25SnapshotSchema>;

export const EmbeddingSnapshotSchema = z.object({
  model: z.string().min(1),
  dimensions: z.number().int().min(1),
  vectors: z.record(z.string(), z.array(z.number())),
}).strict();

export type EmbeddingSnapshot = z.infer<typeof EmbeddingSnapshotSchema>;

export const GoldIndexSchema = z.object({
  version: z.literal(2),
  profile: z.literal('communion'),
  retrieval_mode: z.literal('bm25'),
  built_at: z.string().min(1),
  corpus_fingerprint: Sha256Schema,
  policy_fingerprint: Sha256Schema,
  chunks: z.array(GoldChunkSchema),
  bm25: Bm25SnapshotSchema,
}).strict();

export type GoldIndex = z.infer<typeof GoldIndexSchema>;

export const ProfileIndexSchema = z.object({
  version: z.literal(2),
  profile: z.enum(['review', 'evidence']),
  retrieval_mode: z.literal('bm25'),
  built_at: z.string().min(1),
  corpus_fingerprint: Sha256Schema,
  policy_fingerprint: Sha256Schema,
  chunks: z.array(ProfileChunkSchema),
  bm25: Bm25SnapshotSchema,
}).strict();

export type ProfileIndex = z.infer<typeof ProfileIndexSchema>;

export interface RrfEntry {
  id: string;
  score: number;
}

export interface SearchResult {
  chunk_id: string;
  path: string;
  heading: string;
  score: number;
  tier: string;
  profile: string;
  status: string;
  body: string;
  content_role: 'reference';
  instruction_authority: 'none';
}
