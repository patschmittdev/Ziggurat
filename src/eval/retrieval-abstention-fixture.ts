import { z } from 'zod';
import {
  RETRIEVAL_CATEGORIES,
  RETRIEVAL_SPLITS,
  RetrievalFixtureSchema,
  retrievalFixtureDigest,
  type RetrievalCategory,
  type RetrievalFixture,
  type RetrievalSplit,
} from './retrieval-quality.js';

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const NonBlankStringSchema = z.string().refine(value => value.trim().length > 0, {
  message: 'Expected a nonempty string',
});
const RationaleSchema = z.object({
  query_id: NonBlankStringSchema,
  rationale: NonBlankStringSchema,
}).strict();

export const AbstentionManifestSchema = z.object({
  schema_version: z.literal(1),
  experiment_id: z.literal('retrieval-abstention-v1'),
  fixture_sha256: DigestSchema,
  legacy_fixture_sha256: DigestSchema,
  label_provenance: z.literal('ai-authored-synthetic'),
  human_review: z.literal('unverified'),
  authoring_method: z.literal('separate-context-no-policy-or-results'),
  query_rationales: z.array(RationaleSchema),
}).strict();

export type AbstentionManifest = z.infer<typeof AbstentionManifestSchema>;

const EXPECTED_CORPUS_REVISION = 'synthetic-retrieval-abstention-v1';
const EXPECTED_QUERY_REVISION = 'ai-labels-abstention-v1';
const EXPECTED_QUERY_COUNTS = {
  tuning: {
    'exact-identifier': 6,
    paraphrase: 6,
    ambiguous: 4,
    'no-good-answer': 8,
  },
  holdout: {
    'exact-identifier': 6,
    paraphrase: 6,
    ambiguous: 4,
    'no-good-answer': 8,
  },
} as const satisfies Record<RetrievalSplit, Record<RetrievalCategory, number>>;

function canonicalQueryText(value: string): string {
  return value.normalize('NFC').toLowerCase().trim().replace(/\s+/gu, ' ');
}

function validateDocumentIdentity(
  fixture: RetrievalFixture,
  legacy: RetrievalFixture,
): void {
  if (fixture.documents.length !== legacy.documents.length
    || fixture.documents.some((document, index) => {
      const legacyDocument = legacy.documents[index];
      return legacyDocument === undefined
        || document.id !== legacyDocument.id
        || document.title !== legacyDocument.title
        || document.body !== legacyDocument.body;
    })) {
    throw new Error('Fixture documents differ from legacy corpus');
  }
}

function validateRevisionsAndCounts(fixture: RetrievalFixture): void {
  if (fixture.corpus_revision !== EXPECTED_CORPUS_REVISION) {
    throw new Error(`Unexpected corpus revision: ${fixture.corpus_revision}`);
  }
  if (fixture.query_revision !== EXPECTED_QUERY_REVISION) {
    throw new Error(`Unexpected query revision: ${fixture.query_revision}`);
  }
  if (fixture.queries.length !== 48) {
    throw new Error(`Unexpected query total: expected 48, received ${fixture.queries.length}`);
  }
  if (fixture.queries[0]?.category !== 'exact-identifier') {
    throw new Error('First fixture query must use exact-identifier category');
  }

  for (const split of RETRIEVAL_SPLITS) {
    for (const category of RETRIEVAL_CATEGORIES) {
      const count = fixture.queries.filter(query =>
        query.split === split && query.category === category
      ).length;
      const expected = EXPECTED_QUERY_COUNTS[split][category];
      if (count !== expected) {
        throw new Error(
          `Unexpected query count for ${split}/${category}: expected ${expected}, received ${count}`,
        );
      }
    }
  }
}

function validateQueryTexts(fixture: RetrievalFixture, legacy: RetrievalFixture): void {
  const fixtureQueryIds = new Map<string, string>();
  for (const query of fixture.queries) {
    const canonical = canonicalQueryText(query.query);
    if (canonical.length === 0) {
      throw new Error(`Empty normalized query text for ${query.id}`);
    }
    const existing = fixtureQueryIds.get(canonical);
    if (existing !== undefined) {
      throw new Error(`Duplicate normalized query text for ${query.id} and ${existing}`);
    }
    fixtureQueryIds.set(canonical, query.id);
  }

  const legacyQueryIds = new Map(
    legacy.queries.map(query => [canonicalQueryText(query.query), query.id]),
  );
  for (const [canonical, queryId] of fixtureQueryIds) {
    const legacyQueryId = legacyQueryIds.get(canonical);
    if (legacyQueryId !== undefined) {
      throw new Error(`Query ${queryId} duplicates legacy query ${legacyQueryId}`);
    }
  }
}

function validateRationaleCoverage(
  fixture: RetrievalFixture,
  manifest: AbstentionManifest,
): void {
  const queryIds = new Set(fixture.queries.map(query => query.id));
  const rationaleIds = new Set<string>();
  for (const rationale of manifest.query_rationales) {
    if (!queryIds.has(rationale.query_id)) {
      throw new Error(`Unknown rationale query ID: ${rationale.query_id}`);
    }
    if (rationaleIds.has(rationale.query_id)) {
      throw new Error(`Duplicate rationale query ID: ${rationale.query_id}`);
    }
    rationaleIds.add(rationale.query_id);
  }
  for (const queryId of queryIds) {
    if (!rationaleIds.has(queryId)) {
      throw new Error(`Missing rationale for query ID: ${queryId}`);
    }
  }
}

export function verifyAbstentionFixture(
  input: unknown,
  inputManifest: unknown,
  inputLegacy: unknown,
): { fixture: RetrievalFixture; manifest: AbstentionManifest } {
  const fixture = RetrievalFixtureSchema.parse(input);
  const manifest = AbstentionManifestSchema.parse(inputManifest);
  const legacy = RetrievalFixtureSchema.parse(inputLegacy);

  if (manifest.fixture_sha256 !== retrievalFixtureDigest(fixture)) {
    throw new Error('Fixture digest mismatch');
  }
  if (manifest.legacy_fixture_sha256 !== retrievalFixtureDigest(legacy)) {
    throw new Error('Legacy fixture digest mismatch');
  }

  validateDocumentIdentity(fixture, legacy);
  validateRevisionsAndCounts(fixture);
  validateQueryTexts(fixture, legacy);
  validateRationaleCoverage(fixture, manifest);
  return { fixture, manifest };
}
