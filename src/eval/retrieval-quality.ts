import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildBm25, bm25Search } from '../retrieval/bm25.js';

export const RETRIEVAL_CATEGORIES = [
  'exact-identifier', 'paraphrase', 'ambiguous', 'no-good-answer',
] as const;
export const RETRIEVAL_SPLITS = ['tuning', 'holdout'] as const;
const FixtureIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/u);
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const RetrievalFixtureSchema = z.object({
  schema_version: z.literal(1),
  corpus_revision: z.string().min(1),
  query_revision: z.string().min(1),
  description: z.string().min(1),
  documents: z.array(z.object({
    id: FixtureIdSchema, title: z.string().min(1), body: z.string().min(1),
  }).strict()).min(1),
  queries: z.array(z.object({
    id: FixtureIdSchema,
    split: z.enum(RETRIEVAL_SPLITS),
    category: z.enum(RETRIEVAL_CATEGORIES),
    query: z.string().min(1),
    relevant_ids: z.array(FixtureIdSchema),
  }).strict()).min(1),
}).strict().superRefine((fixture, ctx) => {
  const documents = new Set(fixture.documents.map(doc => doc.id));
  if (documents.size !== fixture.documents.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate document ID' });
  }
  if (new Set(fixture.queries.map(query => query.id)).size !== fixture.queries.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate query ID' });
  }
  for (const query of fixture.queries) {
    if (new Set(query.relevant_ids).size !== query.relevant_ids.length
      || query.relevant_ids.some(id => !documents.has(id))) {
      ctx.addIssue({ code: 'custom', message: `Invalid relevance labels for ${query.id}` });
    }
    const count = query.relevant_ids.length;
    if ((query.category === 'exact-identifier' && count !== 1)
      || (query.category === 'ambiguous' && count < 2)
      || (query.category === 'paraphrase' && count < 1)
      || (query.category === 'no-good-answer' && count !== 0)) {
      ctx.addIssue({ code: 'custom', message: `Category/label mismatch for ${query.id}` });
    }
  }
});

const RankingSchema = z.object({
  query_id: FixtureIdSchema,
  hits: z.array(z.object({ id: FixtureIdSchema, score: z.number().nonnegative() }).strict()).max(5),
}).strict();

export const RetrievalBaselineSchema = z.object({
  schema_version: z.literal(1),
  corpus_revision: z.string().min(1),
  query_revision: z.string().min(1),
  fixture_sha256: DigestSchema,
  implementation: z.literal('unmodified-letters-only-bm25'),
  implementation_source_sha256: DigestSchema,
  rankings: z.array(RankingSchema),
}).strict();

export type RetrievalFixture = z.infer<typeof RetrievalFixtureSchema>;
export type RetrievalRanking = z.infer<typeof RankingSchema>;
export type RetrievalCategory = typeof RETRIEVAL_CATEGORIES[number];
export type RetrievalSplit = typeof RETRIEVAL_SPLITS[number];

export interface RetrievalQueryResult extends RetrievalRanking {
  split: RetrievalSplit;
  category: RetrievalCategory;
  query: string;
  relevant_ids: string[];
  relevant_found_at_5: number;
  recall_at_5: number | null;
  reciprocal_rank_at_5: number | null;
  exact_top1_correct: boolean | null;
  no_answer_false_positive: boolean | null;
}

export interface RetrievalMetrics {
  queries: number;
  answerable_queries: number;
  queries_with_relevant_at_5: number;
  relevant_found_at_5: number;
  relevant_total: number;
  recall_at_5: number | null;
  mrr_at_5: number | null;
  exact_identifier_queries: number;
  exact_top1_correct: number;
  exact_top1_accuracy: number | null;
  no_answer_queries: number;
  no_answer_false_positives: number;
  no_answer_false_positive_rate: number | null;
}

export interface RetrievalQualityReport {
  schema_version: 1;
  corpus_revision: string;
  query_revision: string;
  fixture_sha256: string;
  implementation: string;
  evaluation_unit: 'page';
  k: 5;
  rejection_threshold: null;
  summary: RetrievalMetrics;
  by_split: Record<RetrievalSplit, {
    summary: RetrievalMetrics;
    by_category: Record<RetrievalCategory, RetrievalMetrics>;
  }>;
  exact_identifier_holdout_pass: boolean | null;
  queries: RetrievalQueryResult[];
}

/** Hash parsed fixture JSON, not platform-dependent file line endings. */
export function retrievalFixtureDigest(fixture: RetrievalFixture): string {
  return createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
}

function metrics(rows: RetrievalQueryResult[]): RetrievalMetrics {
  const answerable = rows.filter(row => row.recall_at_5 !== null);
  const exact = rows.filter(row => row.exact_top1_correct !== null);
  const noAnswer = rows.filter(row => row.no_answer_false_positive !== null);
  const exactCorrect = exact.filter(row => row.exact_top1_correct).length;
  const falsePositives = noAnswer.filter(row => row.no_answer_false_positive).length;
  return {
    queries: rows.length,
    answerable_queries: answerable.length,
    queries_with_relevant_at_5: answerable.filter(row => row.relevant_found_at_5 > 0).length,
    relevant_found_at_5: answerable.reduce((total, row) => total + row.relevant_found_at_5, 0),
    relevant_total: answerable.reduce((total, row) => total + row.relevant_ids.length, 0),
    recall_at_5: answerable.length === 0 ? null
      : answerable.reduce((total, row) => total + row.recall_at_5!, 0) / answerable.length,
    mrr_at_5: answerable.length === 0 ? null
      : answerable.reduce((total, row) => total + row.reciprocal_rank_at_5!, 0) / answerable.length,
    exact_identifier_queries: exact.length,
    exact_top1_correct: exactCorrect,
    exact_top1_accuracy: exact.length === 0 ? null : exactCorrect / exact.length,
    no_answer_queries: noAnswer.length,
    no_answer_false_positives: falsePositives,
    no_answer_false_positive_rate: noAnswer.length === 0 ? null : falsePositives / noAnswer.length,
  };
}

/** Evaluate already-ranked page IDs, including results from authorized ContextAccess. */
export function evaluateRetrievalRankings(
  input: RetrievalFixture,
  inputRankings: RetrievalRanking[],
  implementation: string,
): RetrievalQualityReport {
  const fixture = RetrievalFixtureSchema.parse(input);
  const rankings = z.array(RankingSchema).parse(inputRankings);
  const byQuery = new Map(rankings.map(row => [row.query_id, row]));
  if (byQuery.size !== rankings.length || rankings.length !== fixture.queries.length
    || fixture.queries.some(query => !byQuery.has(query.id))) {
    throw new Error('Rankings must cover every fixture query exactly once');
  }
  const documents = new Set(fixture.documents.map(doc => doc.id));
  const queries = fixture.queries.map(query => {
    const hits = byQuery.get(query.id)!.hits;
    if (new Set(hits.map(hit => hit.id)).size !== hits.length
      || hits.some(hit => !documents.has(hit.id))) {
      throw new Error(`Unknown or duplicate ranked page for ${query.id}`);
    }
    const relevant = new Set(query.relevant_ids);
    const found = hits.filter(hit => relevant.has(hit.id)).length;
    const first = hits.findIndex(hit => relevant.has(hit.id));
    return {
      query_id: query.id, split: query.split, category: query.category,
      query: query.query, relevant_ids: query.relevant_ids, hits,
      relevant_found_at_5: found,
      recall_at_5: relevant.size === 0 ? null : found / relevant.size,
      reciprocal_rank_at_5: relevant.size === 0 ? null : first < 0 ? 0 : 1 / (first + 1),
      exact_top1_correct: query.category === 'exact-identifier' ? first === 0 : null,
      no_answer_false_positive: query.category === 'no-good-answer' ? hits.length > 0 : null,
    };
  });
  const bySplit = Object.fromEntries(RETRIEVAL_SPLITS.map(split => {
    const rows = queries.filter(row => row.split === split);
    return [split, {
      summary: metrics(rows),
      by_category: Object.fromEntries(RETRIEVAL_CATEGORIES.map(category => [
        category, metrics(rows.filter(row => row.category === category)),
      ])) as Record<RetrievalCategory, RetrievalMetrics>,
    }];
  })) as RetrievalQualityReport['by_split'];
  const holdout = bySplit.holdout.by_category['exact-identifier'];
  return {
    schema_version: 1, corpus_revision: fixture.corpus_revision,
    query_revision: fixture.query_revision, fixture_sha256: retrievalFixtureDigest(fixture),
    implementation, evaluation_unit: 'page', k: 5, rejection_threshold: null,
    summary: metrics(queries), by_split: bySplit,
    exact_identifier_holdout_pass: holdout.exact_identifier_queries === 0
      ? null : holdout.exact_top1_accuracy === 1,
    queries,
  };
}

export function evaluateRetrievalQuality(input: RetrievalFixture): RetrievalQualityReport {
  const fixture = RetrievalFixtureSchema.parse(input);
  const snapshot = buildBm25(fixture.documents.map(doc => ({
    id: doc.id, text: `${doc.title} ${doc.body}`,
  })));
  return evaluateRetrievalRankings(fixture, fixture.queries.map(query => ({
    query_id: query.id, hits: bm25Search(query.query, snapshot).slice(0, 5),
  })), 'identifier-aware-bm25');
}

export function evaluateRetrievalBaseline(
  fixture: RetrievalFixture,
  inputBaseline: unknown,
): RetrievalQualityReport {
  const parsed = RetrievalFixtureSchema.parse(fixture);
  const baseline = RetrievalBaselineSchema.parse(inputBaseline);
  if (baseline.corpus_revision !== parsed.corpus_revision
    || baseline.query_revision !== parsed.query_revision
    || baseline.fixture_sha256 !== retrievalFixtureDigest(parsed)) {
    throw new Error('Baseline fixture/revision mismatch; do not reuse labels or rankings across revisions');
  }
  return evaluateRetrievalRankings(parsed, baseline.rankings, baseline.implementation);
}
