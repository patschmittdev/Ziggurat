import type { ReviewStatus } from '../contracts/index.js';

export type TransitionActor = 'ingest' | 'refine' | 'build' | 'query' | 'human';

/**
 * Lifecycle metadata is a human-authored surface. Refinement stages proposal artifacts
 * instead of transitioning a knowledge page.
 */
export function canTransition(
  from: ReviewStatus,
  to: ReviewStatus,
  actor: TransitionActor,
): boolean {
  if (actor !== 'human') return false;
  if (to === 'reviewed') return from === 'in-review';
  if (from === 'reviewed' && to === 'in-review') return actor === 'human';
  return true;
}
