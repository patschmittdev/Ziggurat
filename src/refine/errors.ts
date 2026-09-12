export type RefinementFailureCode =
  | 'draft-schema'
  | 'no-evidence'
  | 'unknown-source'
  | 'line-range'
  | 'target-path'
  | 'target-context'
  | 'target-changed'
  | 'evidence-changed'
  | 'canonical-schema';

export class RefinementError extends Error {
  constructor(public readonly code: RefinementFailureCode, message: string) {
    super(message);
    this.name = 'RefinementError';
  }
}
