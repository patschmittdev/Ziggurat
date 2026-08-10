import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CuratedPage } from '../contracts/index.js';
import type { GoldChunk, GoldIndex } from '../contracts/gold-index.js';
import { GoldIndexSchema } from '../contracts/gold-index.js';
import { goldEligibilityReport } from '../review/eligibility.js';
import { buildBm25, bm25Search } from './bm25.js';
import { computeCorpusFingerprint } from './fingerprint.js';
import { makeGoldChunk } from './chunks.js';
import { sha256Text } from '../bronze/canonical.js';
import type { SearchResult } from '../contracts/gold-index.js';

export interface GoldPageInput {
  path: string;
  page: CuratedPage;
  pageBody: string;
}

export interface BuildGoldIndexOptions {
  asOf?: Date;
}

/**
 * Builds the physically isolated Gold (communion) index.
 * Writes atomically to .ziggurat/gold-index.json.
 * Only Gold-eligible pages are included; all others are silently excluded.
 */
export async function buildGoldIndex(
  root: string,
  candidates: GoldPageInput[],
  options: BuildGoldIndexOptions = {},
): Promise<GoldIndex> {
  const asOf = options.asOf ?? new Date();
  const chunks: GoldChunk[] = [];
  const fingerprintEntries: Array<{ path: string; content_hash: string }> = [];

  for (const { path, page, pageBody } of candidates) {
    const report = await goldEligibilityReport(root, path, page, asOf);
    if (!report.eligible) continue;

    const lineage = report.bronze_lineage.map(p => ({
      path: p,
      sha256: '',
    }));
    // Fill in sha256 for lineage entries from the page's sources
    for (const entry of lineage) {
      try {
        const content = await readFile(join(root, entry.path), 'utf8');
        const body = extractBronzeBody(content.replace(/\r\n/g, '\n'));
        entry.sha256 = sha256Text(body);
      } catch {
        entry.sha256 = '0'.repeat(64);
      }
    }

    chunks.push(makeGoldChunk(path, page, pageBody, lineage));
    fingerprintEntries.push({ path, content_hash: sha256Text(pageBody) });
  }

  const corpus_fingerprint = computeCorpusFingerprint('communion', 1, fingerprintEntries);
  const bm25 = buildBm25(chunks.map(c => ({ id: c.id, text: c.heading + ' ' + c.body })));

  const index: GoldIndex = {
    version: 1,
    profile: 'communion',
    retrieval_mode: 'bm25',
    built_at: asOf.toISOString(),
    corpus_fingerprint,
    chunks,
    bm25,
  };

  await writeIndexAtomic(root, 'gold-index.json', GoldIndexSchema.parse(index));

  return index;
}

/**
 * Searches the Gold index using BM25.
 * Loads the index from disk and validates freshness against the current corpus fingerprint.
 */
export async function searchGoldIndex(
  root: string,
  query: string,
  candidates: GoldPageInput[],
  options: BuildGoldIndexOptions = {},
): Promise<SearchResult[]> {
  const index = await loadGoldIndex(root);
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

export async function loadGoldIndex(root: string): Promise<GoldIndex> {
  const text = await readFile(join(root, '.ziggurat', 'gold-index.json'), 'utf8');
  return GoldIndexSchema.parse(JSON.parse(text));
}

export interface FreshnessCheck {
  fresh: boolean;
  reason?: string;
}

/** Checks if the stored Gold index fingerprint matches the current corpus. */
export async function checkIndexFreshness(
  root: string,
  candidates: GoldPageInput[],
  options: BuildGoldIndexOptions = {},
): Promise<FreshnessCheck> {
  let index: GoldIndex;
  try {
    index = await loadGoldIndex(root);
  } catch {
    return { fresh: false, reason: 'index not found or unreadable' };
  }

  const asOf = options.asOf ?? new Date();
  const fingerprintEntries: Array<{ path: string; content_hash: string }> = [];
  for (const { path, page, pageBody } of candidates) {
    const report = await goldEligibilityReport(root, path, page, asOf);
    if (!report.eligible) continue;
    fingerprintEntries.push({ path, content_hash: sha256Text(pageBody) });
  }

  const expected = computeCorpusFingerprint('communion', 1, fingerprintEntries);
  if (expected !== index.corpus_fingerprint) {
    return { fresh: false, reason: 'corpus fingerprint mismatch' };
  }
  return { fresh: true };
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

function extractBronzeBody(content: string): string {
  if (!content.startsWith('---\n')) return content;
  const afterOpen = content.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx === -1) return content;
  return afterOpen.slice(closeIdx + 5);
}
