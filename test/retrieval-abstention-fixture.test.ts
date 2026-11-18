import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import {
  RetrievalFixtureSchema,
  retrievalFixtureDigest,
  type RetrievalFixture,
} from '../src/eval/retrieval-quality.js';
import {
  verifyAbstentionFixture,
  type AbstentionManifest,
} from '../src/eval/retrieval-abstention-fixture.js';

const directory = join(process.cwd(), 'fixtures', 'retrieval', 'abstention-v1');
const legacyDirectory = join(process.cwd(), 'fixtures', 'retrieval', 'v1');
const readJson = async (file: string): Promise<unknown> =>
  JSON.parse(await readFile(file, 'utf8'));

function canonicalizeQuery(value: string): string {
  return value.normalize('NFC').toLowerCase().trim().replace(/\s+/gu, ' ');
}

async function loadVerifiedFixture(): Promise<{
  fixture: RetrievalFixture;
  manifest: AbstentionManifest;
  legacy: RetrievalFixture;
}> {
  assert.equal(
    existsSync(join(directory, 'corpus.json')),
    true,
    'the abstention corpus fixture must exist',
  );
  assert.equal(
    existsSync(join(directory, 'manifest.json')),
    true,
    'the abstention manifest fixture must exist',
  );
  assert.equal(existsSync(join(legacyDirectory, 'corpus.json')), true);
  const legacy = RetrievalFixtureSchema.parse(
    await readJson(join(legacyDirectory, 'corpus.json')),
  );
  const { fixture, manifest } = verifyAbstentionFixture(
    await readJson(join(directory, 'corpus.json')),
    await readJson(join(directory, 'manifest.json')),
    legacy,
  );
  return { fixture, manifest, legacy };
}

test('abstention fixture: frozen corpus, split counts and provenance', async () => {
  const { fixture, manifest, legacy } = await loadVerifiedFixture();
  assert.deepEqual(fixture.documents, legacy.documents);
  assert.equal(fixture.queries.length, 48);
  assert.equal(fixture.corpus_revision, 'synthetic-retrieval-abstention-v1');
  assert.equal(fixture.query_revision, 'ai-labels-abstention-v1');
  assert.equal(manifest.fixture_sha256, retrievalFixtureDigest(fixture));
  assert.equal(manifest.legacy_fixture_sha256, retrievalFixtureDigest(legacy));
  assert.equal(manifest.label_provenance, 'ai-authored-synthetic');
  assert.equal(manifest.human_review, 'unverified');
  assert.equal(
    manifest.authoring_method,
    'separate-context-no-policy-or-results',
  );

  for (const split of ['tuning', 'holdout'] as const) {
    const queries = fixture.queries.filter(query => query.split === split);
    assert.equal(queries.filter(query => query.category === 'exact-identifier').length, 6);
    assert.equal(queries.filter(query => query.category === 'paraphrase').length, 6);
    assert.equal(queries.filter(query => query.category === 'ambiguous').length, 4);
    assert.equal(queries.filter(query => query.category === 'no-good-answer').length, 8);
  }

  assert.equal(new Set(fixture.queries.map(query => query.id)).size, fixture.queries.length);
  const legacyQueryTexts = new Set(legacy.queries.map(query => canonicalizeQuery(query.query)));
  assert.equal(
    fixture.queries.some(query => legacyQueryTexts.has(canonicalizeQuery(query.query))),
    false,
  );
  assert.equal(
    fixture.queries[0]?.category,
    'exact-identifier',
  );
  assert.deepEqual(
    manifest.query_rationales.map(rationale => rationale.query_id).sort(),
    fixture.queries.map(query => query.id).sort(),
  );
});

test('abstention fixture: rejects changed identities and invalid rationales', async () => {
  const { fixture, manifest, legacy } = await loadVerifiedFixture();
  const boundManifest = (candidate: RetrievalFixture): AbstentionManifest => ({
    ...structuredClone(manifest),
    fixture_sha256: retrievalFixtureDigest(candidate),
  });
  const firstRationale = manifest.query_rationales[0];
  if (firstRationale === undefined) {
    throw new Error('Fixture must include at least one query rationale');
  }

  assert.throws(
    () => verifyAbstentionFixture(fixture, {
      ...manifest,
      fixture_sha256: '0'.repeat(64),
    }, legacy),
    /Fixture digest mismatch/,
  );
  assert.throws(
    () => verifyAbstentionFixture(fixture, {
      ...manifest,
      legacy_fixture_sha256: '0'.repeat(64),
    }, legacy),
    /Legacy fixture digest mismatch/,
  );
  assert.throws(
    () => verifyAbstentionFixture(fixture, { ...manifest, unexpected: true }, legacy),
  );
  for (const invalidProvenance of [
    { ...manifest, label_provenance: 'human-authored' },
    { ...manifest, human_review: 'verified' },
    { ...manifest, authoring_method: 'policy-informed' },
  ]) {
    assert.throws(
      () => verifyAbstentionFixture(fixture, invalidProvenance, legacy),
    );
  }

  const duplicateRationales = structuredClone(manifest);
  duplicateRationales.query_rationales.push(structuredClone(firstRationale));
  assert.throws(
    () => verifyAbstentionFixture(fixture, duplicateRationales, legacy),
    /Duplicate rationale query ID/,
  );
  const missingRationale = structuredClone(manifest);
  missingRationale.query_rationales = missingRationale.query_rationales.slice(1);
  assert.throws(
    () => verifyAbstentionFixture(fixture, missingRationale, legacy),
    /Missing rationale for query ID/,
  );
  const unknownRationale = structuredClone(manifest);
  unknownRationale.query_rationales[0] = {
    ...firstRationale,
    query_id: 'unknown-rationale',
  };
  assert.throws(
    () => verifyAbstentionFixture(fixture, unknownRationale, legacy),
    /Unknown rationale query ID/,
  );

  const changedDocuments = structuredClone(fixture);
  const changedDocument = changedDocuments.documents[0];
  if (changedDocument === undefined) {
    throw new Error('Fixture must include at least one document');
  }
  changedDocument.body = `${changedDocument.body} Altered.`;
  assert.throws(
    () => verifyAbstentionFixture(
      changedDocuments,
      boundManifest(changedDocuments),
      legacy,
    ),
    /Fixture documents differ from legacy corpus/,
  );

  const duplicateQuery = structuredClone(fixture);
  const firstQuery = duplicateQuery.queries[0];
  const secondQuery = duplicateQuery.queries[1];
  if (firstQuery === undefined || secondQuery === undefined) {
    throw new Error('Fixture must include at least two queries');
  }
  secondQuery.query = ` ${firstQuery.query.toUpperCase()} `;
  assert.throws(
    () => verifyAbstentionFixture(
      duplicateQuery,
      boundManifest(duplicateQuery),
      legacy,
    ),
    /Duplicate normalized query text/,
  );

  const invalidRelevance = structuredClone(fixture);
  const relevanceQuery = invalidRelevance.queries[0];
  if (relevanceQuery === undefined) {
    throw new Error('Fixture must include at least one query');
  }
  relevanceQuery.relevant_ids = ['unknown-page'];
  assert.throws(
    () => verifyAbstentionFixture(
      invalidRelevance,
      boundManifest(invalidRelevance),
      legacy,
    ),
    /Invalid relevance labels/,
  );

  const changedSplitCount = structuredClone(fixture);
  const movedQuery = changedSplitCount.queries.find(query =>
    query.split === 'tuning' && query.category === 'no-good-answer'
  );
  if (movedQuery === undefined) {
    throw new Error('Fixture must include a tuning no-good-answer query');
  }
  movedQuery.split = 'holdout';
  assert.throws(
    () => verifyAbstentionFixture(
      changedSplitCount,
      boundManifest(changedSplitCount),
      legacy,
    ),
    /Unexpected query count for tuning\/no-good-answer/,
  );

  const movedFirstQuery = structuredClone(fixture);
  const noGoodAnswerIndex = movedFirstQuery.queries.findIndex(query =>
    query.category === 'no-good-answer'
  );
  if (noGoodAnswerIndex === -1) {
    throw new Error('Fixture must include a no-good-answer query');
  }
  const noGoodAnswer = movedFirstQuery.queries.splice(noGoodAnswerIndex, 1)[0];
  if (noGoodAnswer === undefined) {
    throw new Error('Fixture must include a no-good-answer query');
  }
  movedFirstQuery.queries.unshift(noGoodAnswer);
  assert.throws(
    () => verifyAbstentionFixture(
      movedFirstQuery,
      boundManifest(movedFirstQuery),
      legacy,
    ),
    /First fixture query must use exact-identifier category/,
  );
});
