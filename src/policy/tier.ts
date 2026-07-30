import type { ReviewStatus } from '../contracts/index.js';

export type Tier = 'bronze' | 'silver' | 'gold';

export function classifyTier(status: ReviewStatus): 'silver' | 'gold' {
  return status === 'reviewed' ? 'gold' : 'silver';
}
