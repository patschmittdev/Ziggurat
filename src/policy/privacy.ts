import type { PiiState } from '../contracts/index.js';

export function piiBlocksModelAccess(pii: PiiState | undefined): boolean {
  return pii !== 'false';
}
