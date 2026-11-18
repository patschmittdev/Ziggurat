import { isDeepStrictEqual } from 'node:util';
import type { AccessProfile } from '../contracts/index.js';
import { parseZigguratConfig } from '../contracts/config.js';
import type { GoldIndex, ProfileIndex } from '../contracts/gold-index.js';
import { collectBronzeFiles, collectCuratedPages } from '../corpus/collect.js';
import { collectStagedProposals } from '../refine/store.js';
import { createVerifiedBronzeReader } from '../refine/evidence.js';
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

export type IndexVerificationCode = 'index_integrity' | 'trust_policy_changed' | 'index_stale';

export class IndexVerificationError extends Error {
  constructor(
    reason: string,
    profile: AccessProfile,
    public readonly code: IndexVerificationCode = 'index_integrity',
    public readonly reason_codes: readonly string[] = [],
  ) {
    super(`${reason} Rebuild with: ziggurat build (profile: ${profile})`);
    this.name = 'IndexVerificationError';
  }
}

export function chunkDerivedFingerprint(index: GoldIndex | ProfileIndex): string {
  return indexCorpusFingerprint(index.profile, index.chunks, index.policy_fingerprint);
}

async function computeLiveState(
  root: string,
  profile: AccessProfile,
  asOf: Date,
): Promise<{ fingerprint: string; policy: string; reasonCodes: string[] }> {
  const bronzeReader = createVerifiedBronzeReader(root);
  const [curated, bronze, proposals, config] = await Promise.all([
    collectCuratedPages(root),
    // Gold verifies cited lineage and all proposals below, not unrelated evidence.
    profile === 'gold' ? Promise.resolve([]) : collectBronzeFiles(root),
    collectStagedProposals(root, { bronzeReader }),
    parseZigguratConfig(root),
  ]);
  const policy = trustPolicyFingerprint(config);
  if (profile === 'gold') {
    const { chunks, decisions } = await collectEligibleGoldChunks(root, curated, {
      asOf,
      config,
      proposals,
      bronzeReader,
    });
    return {
      fingerprint: indexCorpusFingerprint(profile, chunks, policy),
      policy,
      reasonCodes: [...new Set(decisions.flatMap(decision =>
        decision.reason_details.map(reason => reason.code)))].sort(),
    };
  }
  if (profile === 'review') {
    const { chunks } = await collectReviewChunks(root, {
      curated,
      bronze,
      proposals,
      config,
      asOf,
      bronzeReader,
    });
    return { fingerprint: indexCorpusFingerprint(profile, chunks, policy), policy, reasonCodes: [] };
  }
  const { chunks } = await collectEvidenceChunks(root, {
    curated,
    bronze,
    proposals,
    config,
    asOf,
    bronzeReader,
  });
  return { fingerprint: indexCorpusFingerprint(profile, chunks, policy), policy, reasonCodes: [] };
}

export async function computeLiveFingerprint(
  root: string,
  profile: AccessProfile,
  asOf: Date = new Date(),
): Promise<string> {
  return (await computeLiveState(root, profile, asOf)).fingerprint;
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
  const live = await computeLiveState(root, profile, asOf);
  if (live.policy !== index.policy_fingerprint) {
    throw new IndexVerificationError('Trust policy changed after the index was built.', profile, 'trust_policy_changed', live.reasonCodes);
  }
  if (live.fingerprint !== index.corpus_fingerprint) {
    throw new IndexVerificationError('Corpus fingerprint mismatch: the index is stale.', profile, 'index_stale', live.reasonCodes);
  }
}
