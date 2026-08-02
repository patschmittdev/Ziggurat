import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CuratedPage, AccessProfile } from '../contracts/index.js';
import type { ProfileChunk, ProfileIndex } from '../contracts/gold-index.js';
import { ProfileIndexSchema } from '../contracts/gold-index.js';
import { piiBlocksModelAccess } from '../policy/privacy.js';
import { buildBm25, bm25Search } from './bm25.js';
import { computeCorpusFingerprint } from './fingerprint.js';
import { makeProfileChunk } from './chunks.js';
import { sha256Text } from '../bronze/canonical.js';
import type { SearchResult } from '../contracts/gold-index.js';

export type { CuratedInput, BronzeInput } from '../corpus/collect.js';
import type { CuratedInput, BronzeInput } from '../corpus/collect.js';

/**
 * A Bronze record may enter a model-readable index only when it positively asserts
 * `pii: false`, is not restricted, and still hashes to its declared digest.
 *
 * Ingest deliberately defaults an unassessed capture to `pii: unknown` /
 * `sensitivity: restricted`, so an omitted check here would expose every freshly
 * captured source through the evidence profile. `piiBlocksModelAccess` already fails
 * closed on `unknown`; sensitivity and integrity need the same treatment.
 */
export function bronzeBlockedFromModelAccess(record: BronzeInput): boolean {
  return piiBlocksModelAccess(record.pii as never)
    || record.sensitivity === 'restricted'
    || !record.hashVerified;
}

export interface BuildProfileIndexInput {
  curated: CuratedInput[];
  bronze: BronzeInput[];
}

/**
 * Builds a review profile index (Silver + Gold, no Bronze, no PII).
 * Atomic write to .ziggurat/review-index.json.
 */
export async function buildReviewIndex(
  root: string,
  input: BuildProfileIndexInput,
): Promise<ProfileIndex> {
  const chunks: ProfileChunk[] = [];
  const fingerprintEntries: Array<{ path: string; content_hash: string }> = [];

  for (const { path, page, pageBody } of input.curated) {
    if (piiBlocksModelAccess(page.pii)) continue;
    const tier = page.status === 'reviewed' ? 'gold' as const : 'silver' as const;
    chunks.push(makeProfileChunk(path, page.title, pageBody, tier, page.status, 'review'));
    fingerprintEntries.push({ path, content_hash: sha256Text(pageBody) });
  }

  return buildAndWriteProfileIndex(root, 'review', chunks, fingerprintEntries, 'review-index.json');
}

/**
 * Builds an evidence profile index (valid Bronze + labeled curated context, no PII).
 * Atomic write to .ziggurat/evidence-index.json.
 */
export async function buildEvidenceIndex(
  root: string,
  input: BuildProfileIndexInput,
): Promise<ProfileIndex> {
  const chunks: ProfileChunk[] = [];
  const fingerprintEntries: Array<{ path: string; content_hash: string }> = [];

  for (const record of input.bronze) {
    if (bronzeBlockedFromModelAccess(record)) continue;
    const { path, sha256, body } = record;
    chunks.push(makeProfileChunk(path, path, body, 'bronze', 'bronze', 'evidence'));
    fingerprintEntries.push({ path, content_hash: sha256 });
  }

  for (const { path, page, pageBody } of input.curated) {
    if (piiBlocksModelAccess(page.pii)) continue;
    const tier = page.status === 'reviewed' ? 'gold' as const : 'silver' as const;
    chunks.push(makeProfileChunk(path, page.title, pageBody, tier, page.status, 'evidence'));
    fingerprintEntries.push({ path, content_hash: sha256Text(pageBody) });
  }

  return buildAndWriteProfileIndex(root, 'evidence', chunks, fingerprintEntries, 'evidence-index.json');
}

async function buildAndWriteProfileIndex(
  root: string,
  profile: 'review' | 'evidence',
  chunks: ProfileChunk[],
  fingerprintEntries: Array<{ path: string; content_hash: string }>,
  filename: string,
): Promise<ProfileIndex> {
  const corpus_fingerprint = computeCorpusFingerprint(profile, 1, fingerprintEntries);
  const bm25 = buildBm25(chunks.map(c => ({ id: c.id, text: c.heading + ' ' + c.body })));

  const index: ProfileIndex = {
    version: 1,
    profile,
    retrieval_mode: 'bm25',
    built_at: new Date().toISOString(),
    corpus_fingerprint,
    chunks,
    bm25,
  };

  await writeIndexAtomic(root, filename, ProfileIndexSchema.parse(index));
  return index;
}

export async function loadProfileIndex(root: string, profile: Exclude<AccessProfile, 'communion'>): Promise<ProfileIndex> {
  const filename = profile === 'review' ? 'review-index.json' : 'evidence-index.json';
  const text = await readFile(join(root, '.ziggurat', filename), 'utf8');
  return ProfileIndexSchema.parse(JSON.parse(text));
}

export function searchProfileIndex(
  index: ProfileIndex,
  query: string,
): SearchResult[] {
  const ranked = bm25Search(query, index.bm25);
  const chunkMap = new Map(index.chunks.map(c => [c.id, c]));

  const results: SearchResult[] = [];
  for (const { id, score } of ranked) {
    const chunk = chunkMap.get(id);
    if (chunk === undefined) continue;
    results.push({ chunk_id: id, path: chunk.path, heading: chunk.heading, score, tier: chunk.tier, profile: chunk.profile, status: chunk.status, body: chunk.body });
  }
  return results;
}

async function writeIndexAtomic(root: string, filename: string, data: unknown): Promise<void> {
  const dir = join(root, '.ziggurat');
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, randomUUID() + '.tmp');
  const finalPath = join(dir, filename);

  const fh = await open(tmpPath, 'w');
  try {
    await fh.writeFile(JSON.stringify(data, null, 2), 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }

  try {
    await rename(tmpPath, finalPath);
  } catch (err) {
    await unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}
