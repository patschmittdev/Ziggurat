import type { ReviewStatus } from '../contracts/index.js';

export type TransitionActor = 'ingest' | 'refine' | 'build' | 'query' | 'human';

/**
 * Only a human may promote to reviewed, and only from in-review.
 * Automated actors may not write reviewed status.
 */
export function canTransition(
  from: ReviewStatus,
  to: ReviewStatus,
  actor: TransitionActor,
): boolean {
  if (to === 'reviewed') return actor === 'human' && from === 'in-review';
  if (from === 'reviewed' && to === 'in-review') return actor === 'human';
  return actor === 'human' || (actor === 'refine' && from === 'draft' && to === 'in-review');
}
