import { createHash } from 'node:crypto';

interface CorpusEntry {
  path: string;
  content_hash: string;
}

/**
 * Computes a deterministic SHA-256 fingerprint of a corpus.
 * Entries are sorted by path before hashing.
 */
export function computeCorpusFingerprint(
  profile: string,
  version: number,
  entries: CorpusEntry[],
): string {
  const sorted = [...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const canonical = JSON.stringify({ version, profile, sources: sorted });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
