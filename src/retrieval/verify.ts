import { isDeepStrictEqual } from 'node:util';
import type { AccessProfile } from '../contracts/index.js';
import { parseZigguratConfig } from '../contracts/config.js';
import type { GoldIndex, ProfileIndex } from '../contracts/gold-index.js';
import { collectBronzeFiles, collectCuratedPages } from '../corpus/collect.js';
import { collectStagedProposals } from '../refine/store.js';
import { buildBm25 } from './bm25.js';
import { collectEligibleGoldChunks } from './gold-index.js';
import {
  indexCorpusFingerprint,
  trustPolicyFingerprint,
} from './integrity.js';
import {
  collectEvidenceChunks,
  collectReviewChunks,
} from './profile-index.js';

export class IndexVerificationError extends Error {
  constructor(reason: string, profile: AccessProfile) {
    super(`${reason} Rebuild with: ziggurat build (profile: ${profile})`);
    this.name = 'IndexVerificationError';
  }
}

export function chunkDerivedFingerprint(index: GoldIndex | ProfileIndex): string {
  return indexCorpusFingerprint(index.profile, index.chunks, index.policy_fingerprint);
}

export async function computeLiveFingerprint(
  root: string,
  profile: AccessProfile,
  asOf: Date = new Date(),
): Promise<string> {
  const [curated, bronze, proposals, config] = await Promise.all([
    collectCuratedPages(root),
    collectBronzeFiles(root),
    collectStagedProposals(root),
    parseZigguratConfig(root),
  ]);
  const policy = trustPolicyFingerprint(config);
  if (profile === 'communion') {
    const { chunks } = await collectEligibleGoldChunks(root, curated, {
      asOf,
      config,
      proposals,
    });
    return indexCorpusFingerprint(profile, chunks, policy);
  }
  if (profile === 'review') {
    const { chunks } = await collectReviewChunks(root, {
      curated,
      bronze,
      proposals,
      config,
      asOf,
    });
    return indexCorpusFingerprint(profile, chunks, policy);
  }
  const { chunks } = await collectEvidenceChunks(root, {
    curated,
    bronze,
    proposals,
    config,
    asOf,
  });
  return indexCorpusFingerprint(profile, chunks, policy);
}

export async function assertIndexTrustworthy(
  root: string,
  profile: AccessProfile,
  index: GoldIndex | ProfileIndex,
  asOf: Date = new Date(),
): Promise<void> {
  if (index.profile !== profile) {
    throw new IndexVerificationError(
      `Index declares profile "${index.profile}" but was loaded for "${profile}".`,
      profile,
    );
  }
  if (chunkDerivedFingerprint(index) !== index.corpus_fingerprint) {
    throw new IndexVerificationError(
      'Index chunks or trust labels do not match the corpus fingerprint.',
      profile,
    );
  }
  const expectedBm25 = buildBm25(index.chunks.map(chunk => ({
    id: chunk.id,
    text: `${chunk.heading} ${chunk.body}`,
  })));
  if (!isDeepStrictEqual(expectedBm25, index.bm25)) {
    throw new IndexVerificationError('Index search data has been altered.', profile);
  }
  const livePolicy = trustPolicyFingerprint(await parseZigguratConfig(root));
  if (livePolicy !== index.policy_fingerprint) {
    throw new IndexVerificationError('Trust policy changed after the index was built.', profile);
  }
  const live = await computeLiveFingerprint(root, profile, asOf);
  if (live !== index.corpus_fingerprint) {
    throw new IndexVerificationError('Corpus fingerprint mismatch: the index is stale.', profile);
  }
}
