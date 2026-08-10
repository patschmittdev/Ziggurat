import type { AccessProfile } from '../contracts/index.js';
import type { GoldIndex, ProfileIndex } from '../contracts/gold-index.js';
import { sha256Text } from '../bronze/canonical.js';
import { piiBlocksModelAccess } from '../policy/privacy.js';
import { goldEligibilityReport } from '../review/eligibility.js';
import { collectBronzeFiles, collectCuratedPages } from '../corpus/collect.js';
import { bronzeBlockedFromModelAccess } from './profile-index.js';
import { computeCorpusFingerprint } from './fingerprint.js';

/**
 * Index verification.
 *
 * A stored `corpus_fingerprint` is an assertion the index makes about itself, so
 * comparing it to itself proves nothing. Every served index is therefore checked
 * against two independent sources of truth:
 *
 *   1. its own chunks  — catches injected, replaced, or edited chunks;
 *   2. the live corpus — catches edited, newly ineligible, or newly private pages.
 *
 * Both run at server startup and again before every query, because a corpus can change
 * while a server is running.
 */

const INDEX_VERSION = 1;

export class IndexVerificationError extends Error {
  constructor(reason: string, profile: AccessProfile) {
    super(`${reason} Rebuild with: ziggurat build (profile: ${profile})`);
    this.name = 'IndexVerificationError';
  }
}

/**
 * Recomputes the fingerprint from the index's own chunk contents. A tampered chunk
 * changes this value even when the stored `corpus_fingerprint` field is left untouched.
 */
export function chunkDerivedFingerprint(index: GoldIndex | ProfileIndex): string {
  const entries = index.chunks.map((chunk) => ({
    path: chunk.path,
    content_hash: sha256Text(chunk.body),
  }));
  return computeCorpusFingerprint(index.profile, INDEX_VERSION, entries);
}

/**
 * Recomputes the fingerprint the builder would produce from the corpus as it exists
 * right now, using the same eligibility rules the builder applied.
 */
export async function computeLiveFingerprint(
  root: string,
  profile: AccessProfile,
  asOf: Date = new Date(),
): Promise<string> {
  const curated = await collectCuratedPages(root);
  const entries: Array<{ path: string; content_hash: string }> = [];

  if (profile === 'communion') {
    for (const { path, page, pageBody } of curated) {
      const report = await goldEligibilityReport(root, path, page, asOf);
      if (!report.eligible) continue;
      entries.push({ path, content_hash: sha256Text(pageBody) });
    }
    return computeCorpusFingerprint('communion', INDEX_VERSION, entries);
  }

  if (profile === 'evidence') {
    for (const record of await collectBronzeFiles(root)) {
      if (bronzeBlockedFromModelAccess(record)) continue;
      entries.push({ path: record.path, content_hash: record.sha256 });
    }
  }

  for (const { path, page, pageBody } of curated) {
    if (piiBlocksModelAccess(page.pii)) continue;
    entries.push({ path, content_hash: sha256Text(pageBody) });
  }

  return computeCorpusFingerprint(profile, INDEX_VERSION, entries);
}

/**
 * Throws unless the index is internally consistent AND still matches the live corpus.
 * Serving nothing is the correct outcome for a stale or tampered index.
 */
export async function assertIndexTrustworthy(
  root: string,
  profile: AccessProfile,
  index: GoldIndex | ProfileIndex,
  asOf: Date = new Date(),
): Promise<void> {
  if (index.profile !== profile) {
    throw new IndexVerificationError(
      `Index declares profile "${index.profile}" but was loaded for "${profile}".`,
      profile,
    );
  }

  if (chunkDerivedFingerprint(index) !== index.corpus_fingerprint) {
    throw new IndexVerificationError(
      'Index chunks do not match its recorded corpus fingerprint; the index has been altered.',
      profile,
    );
  }

  const live = await computeLiveFingerprint(root, profile, asOf);
  if (live !== index.corpus_fingerprint) {
    throw new IndexVerificationError(
      'Corpus fingerprint mismatch: the index no longer matches the current corpus and is stale.',
      profile,
    );
  }
}
