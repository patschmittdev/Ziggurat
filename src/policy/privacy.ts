export function piiBlocksModelAccess(pii: string | undefined): boolean {
  return pii !== 'false';
}
