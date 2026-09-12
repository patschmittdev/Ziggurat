import { piiBlocksModelAccess } from './privacy.js';
import type { PolicyReason } from './reasons.js';

export interface ModelSourceState {
  pii?: string;
  sensitivity?: string;
  hashVerified: boolean;
}

/** Default refinement and advisory profiles share this rule, not Gold admission. */
export function modelSourceAccessReasons(record: ModelSourceState): PolicyReason[] {
  const reasons: PolicyReason[] = [];
  if (piiBlocksModelAccess(record.pii)) {
    reasons.push({ code: 'model-source.pii', message: 'pii: false required', field: 'pii' });
  }
  if (record.sensitivity === 'restricted') {
    reasons.push({
      code: 'model-source.sensitivity',
      message: 'sensitivity: restricted not permitted',
      field: 'sensitivity',
    });
  }
  if (!record.hashVerified) {
    reasons.push({
      code: 'model-source.hash-unverified',
      message: 'verified Bronze body hash required',
      field: 'sha256',
    });
  }
  return reasons;
}

export function bronzeBlockedFromModelAccess(record: ModelSourceState): boolean {
  return modelSourceAccessReasons(record).length > 0;
}
