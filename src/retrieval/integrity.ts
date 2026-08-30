import { normalizeText } from '../authorization/canonical.js';
import { sha256Text } from '../bronze/canonical.js';
import type { AccessProfile } from '../contracts/index.js';
import type { ZigguratConfig } from '../contracts/config.js';
import type {
  GoldChunk,
  ProfileChunk,
} from '../contracts/gold-index.js';
import { computeCorpusFingerprint } from './fingerprint.js';
import { compareCodeUnits } from '../order.js';

export function trustPolicyFingerprint(config: ZigguratConfig): string {
  const reviewers = [...config.trust.reviewers]
    .sort((left, right) => compareCodeUnits(
      `${left.reviewer_id}\0${left.key_id}`,
      `${right.reviewer_id}\0${right.key_id}`,
    ))
    .map(reviewer => ({
      reviewer_id: reviewer.reviewer_id,
      key_id: reviewer.key_id,
      algorithm: reviewer.algorithm,
      public_key_pem: normalizeText(reviewer.public_key_pem),
    }));
  return sha256Text(JSON.stringify({
    domain: 'ziggurat-trust-policy-v1',
    reviewers,
  }));
}

export function chunkIntegritySha256(chunk: GoldChunk | ProfileChunk): string {
  return sha256Text(JSON.stringify(chunk));
}

export function indexCorpusFingerprint(
  profile: AccessProfile,
  chunks: Array<GoldChunk | ProfileChunk>,
  policyFingerprint: string,
): string {
  return computeCorpusFingerprint(profile, 2, [
    { path: '@trust-policy', content_hash: policyFingerprint },
    ...chunks.map(chunk => ({
      path: chunk.path,
      content_hash: chunkIntegritySha256(chunk),
    })),
  ]);
}
