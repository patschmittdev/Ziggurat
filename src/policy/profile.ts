import type { ReviewStatus, PiiState, Sensitivity, AccessProfile } from '../contracts/index.js';
import type { TierArtifact } from './tier.js';
import { piiBlocksModelAccess } from './privacy.js';

const STALENESS_MS = 90 * 24 * 60 * 60 * 1000;

export interface PolicyRecord {
  artifact_kind?: TierArtifact;
  retrieval_eligible?: boolean;
  pii?: PiiState;
  sensitivity?: Sensitivity;
  last_verified?: string;
  authorization_verified?: boolean;
}

export interface GoldCandidate {
  status?: ReviewStatus;
  pii?: PiiState;
  sources?: string[];
  reviewed_by?: string;
  reviewed_at?: string;
  last_verified?: string;
  authorization_verified?: boolean;
}

/**
 * Returns reasons why a record is ineligible for model context under the given profile.
 * Communion is Gold-only. PII true/unknown blocks all profiles.
 * No caller may elevate the profile after initialization.
 */
export function contextExclusionReasons(
  record: PolicyRecord,
  profile: AccessProfile,
  asOf: Date,
): string[] {
  const reasons: string[] = [];

  if (piiBlocksModelAccess(record.pii)) {
    reasons.push('pii: false required');
  }

  if (profile === 'communion') {
    if (record.artifact_kind !== 'authorized-page') {
      reasons.push('artifact: authorized page required');
    }
    if (record.retrieval_eligible !== true) {
      reasons.push('retrieval_eligible required');
    }
    if (record.authorization_verified !== true) {
      reasons.push('authorization: verified human receipt required');
    }
    if (record.sensitivity === 'restricted') {
      reasons.push('sensitivity: restricted not permitted for communion');
    }
    const stalenessReason = stalenessExclusion(record.last_verified, asOf);
    if (stalenessReason !== undefined) {
      reasons.push(stalenessReason);
    }
  }
  if (profile === 'review' && record.artifact_kind === 'bronze-record') {
    reasons.push('artifact: Bronze is not available in review');
  }
  if (profile === 'evidence' && record.artifact_kind === 'staged-proposal') {
    reasons.push('artifact: Silver is not available in evidence');
  }

  return reasons;
}

/**
 * Returns reasons why a curated page does not meet basic Gold admission requirements.
 */
export function goldExclusionReasons(candidate: GoldCandidate): string[] {
  const reasons: string[] = [];

  if (candidate.status !== 'reviewed') {
    reasons.push('status: reviewed required');
  }

  const sources = candidate.sources;
  if (sources === undefined || sources.length === 0) {
    reasons.push('sources: non-empty required');
  }

  if (!candidate.reviewed_by) {
    reasons.push('reviewed_by: required');
  }

  if (!candidate.reviewed_at) {
    reasons.push('reviewed_at: required');
  }

  if (!candidate.last_verified) {
    reasons.push('last_verified: required');
  }

  if (piiBlocksModelAccess(candidate.pii)) {
    reasons.push('pii: false required');
  }
  if (candidate.authorization_verified !== true) {
    reasons.push('authorization: verified human receipt required');
  }

  return reasons;
}

function stalenessExclusion(lastVerified: string | undefined, asOf: Date): string | undefined {
  if (lastVerified === undefined) return 'staleness: last_verified required';
  const verifiedAt = new Date(lastVerified);
  if (Number.isNaN(verifiedAt.getTime())) return 'staleness: last_verified invalid';
  if (asOf.getTime() - verifiedAt.getTime() > STALENESS_MS) return 'staleness: page is stale';
  return undefined;
}
