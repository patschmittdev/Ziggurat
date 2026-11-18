import type { PiiState, Sensitivity } from '../contracts/index.js';

export interface PrivacyAssessment {
  sensitivity: Sensitivity;
  pii: PiiState;
}

/** All inbound captures default to restricted/unknown until a human explicitly assesses them. */
export function assessPrivacy(): PrivacyAssessment {
  return { sensitivity: 'restricted', pii: 'unknown' };
}
