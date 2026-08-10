import type { ReviewStatus } from '../contracts/index.js';

export type Tier = 'bronze' | 'silver' | 'gold';

// Only curated (Silver/Gold) statuses are valid inputs; raw/Bronze records have no ReviewStatus.
export function classifyTier(status: ReviewStatus): 'silver' | 'gold' {
  return status === 'reviewed' ? 'gold' : 'silver';
}
