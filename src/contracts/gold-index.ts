import { z } from 'zod';

export const GoldChunkSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  heading: z.string().min(1),
  body: z.string().min(1),
  bronze_lineage: z.array(z.object({
    path: z.string().min(1),
    sha256: z.string().length(64),
  })),
  profile: z.literal('communion'),
  tier: z.literal('gold'),
  status: z.literal('reviewed'),
});

export type GoldChunk = z.infer<typeof GoldChunkSchema>;

export const ProfileChunkSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  heading: z.string().min(1),
  body: z.string().min(1),
  profile: z.union([z.literal('review'), z.literal('evidence')]),
  tier: z.union([z.literal('gold'), z.literal('silver'), z.literal('bronze')]),
  status: z.string().min(1),
});

export type ProfileChunk = z.infer<typeof ProfileChunkSchema>;

export const Bm25SnapshotSchema = z.object({
  k1: z.number(),
  b: z.number(),
  avg_doc_length: z.number(),
  doc_count: z.number(),
  doc_lengths: z.record(z.string(), z.number()),
  term_doc_freqs: z.record(z.string(), z.record(z.string(), z.number())),
});

export type Bm25Snapshot = z.infer<typeof Bm25SnapshotSchema>;

export const EmbeddingSnapshotSchema = z.object({
  model: z.string().min(1),
  dimensions: z.number().int().min(1),
  vectors: z.record(z.string(), z.array(z.number())),
});

export type EmbeddingSnapshot = z.infer<typeof EmbeddingSnapshotSchema>;

export const GoldIndexSchema = z.object({
  version: z.literal(1),
  profile: z.literal('communion'),
  retrieval_mode: z.union([z.literal('bm25'), z.literal('bm25+embedding')]),
  built_at: z.string().min(1),
  corpus_fingerprint: z.string().length(64),
  chunks: z.array(GoldChunkSchema),
  bm25: Bm25SnapshotSchema,
  embeddings: EmbeddingSnapshotSchema.optional(),
});

export type GoldIndex = z.infer<typeof GoldIndexSchema>;

export const ProfileIndexSchema = z.object({
  version: z.literal(1),
  profile: z.union([z.literal('review'), z.literal('evidence')]),
  retrieval_mode: z.union([z.literal('bm25'), z.literal('bm25+embedding')]),
  built_at: z.string().min(1),
  corpus_fingerprint: z.string().length(64),
  chunks: z.array(ProfileChunkSchema),
  bm25: Bm25SnapshotSchema,
  embeddings: EmbeddingSnapshotSchema.optional(),
});

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
}
