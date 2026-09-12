import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { CuratedPageSchema } from '../contracts/index.js';
import type { CuratedPage } from '../contracts/index.js';
import { BronzeRecordSchema } from '../contracts/bronze.js';
import { sha256Text } from '../bronze/canonical.js';
import { isKnowledgePath } from '../contracts/path.js';
import { assertRealPathWithinRoot } from '../fs/boundary.js';
import { parseCorpusDocument } from './documents.js';
import { mapCorpusReads } from './read-pool.js';

/**
 * Shared corpus collection.
 *
 * This lives outside the CLI because the MCP server needs the same view of the corpus
 * that `build` used: recomputing a fingerprint from the live corpus is the only way to
 * detect that an index has gone stale, and it must read the corpus exactly as the
 * builder did or every comparison would report a false mismatch.
 */

export interface CuratedInput {
  path: string;
  page: CuratedPage;
  pageBody: string;
}

export interface BronzeInput {
  path: string;
  sha256: string;
  body: string;
  /**
   * Privacy state carried from the record's own frontmatter. Ingest defaults an
   * unassessed capture to `restricted` / `unknown`, so dropping these fields during
   * collection would silently reclassify every fresh source as safe to index.
   */
  pii: string;
  sensitivity: string;
  /**
   * False when the body no longer hashes to the `sha256` the record declares. A record
   * that fails this check has lost its provenance and must not be indexed.
   */
  hashVerified: boolean;
  /** Preserve structural failure when a caller uses the records-only collector. */
  rejection?: CorpusRejection;
}

/**
 * Why a corpus entry was refused.
 *
 * Rejections carry the path, a category, and structural detail only. They never carry
 * file content or parsed values: an operator needs to know which file to inspect, not
 * to have a restricted page quoted back through build output or logs.
 */
export interface CorpusRejection {
  path: string;
  reason: 'unreadable' | 'missing-frontmatter' | 'invalid-yaml' | 'schema-invalid';
  detail: string;
  fields?: string[];
}

export interface CuratedCollection {
  pages: CuratedInput[];
  rejected: CorpusRejection[];
}

export interface BronzeCollection {
  records: BronzeInput[];
  rejected: CorpusRejection[];
}

/**
 * Collects curated pages and the entries that were refused.
 *
 * A refused entry is still refused: nothing here admits partially valid content. The
 * rejection list exists so an operator can tell "no pages matched" apart from "three
 * pages are broken and were skipped", which previously looked identical.
 */
export async function collectCuratedPagesDetailed(root: string): Promise<CuratedCollection> {
  const knowledgeDir = join(root, 'knowledge');
  const pages: CuratedInput[] = [];
  const rejected: CorpusRejection[] = [];
  let entries: string[];
  try {
    entries = await readdir(knowledgeDir);
  } catch {
    return { pages, rejected };
  }
  await mapCorpusReads(entries.sort().filter(entry => isKnowledgePath(`knowledge/${entry}`)), async entry => {
    const relPath = `knowledge/${entry}`;
    let raw: string;
    try {
      raw = await readFile(join(root, relPath), 'utf8');
    } catch (error) {
      rejected.push({
        path: relPath,
        reason: 'unreadable',
        detail: `file could not be read (${(error as NodeJS.ErrnoException).code ?? 'unknown error'})`,
      });
      return;
    }

    const result = parseCorpusDocument(raw, CuratedPageSchema, Object.keys(CuratedPageSchema.shape));
    if (!result.valid) {
      rejected.push({ path: relPath, ...result.failure });
      return;
    }
    pages.push({ path: relPath, page: result.data, pageBody: result.body });
  });
  pages.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  rejected.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  return { pages, rejected };
}

export async function collectCuratedPages(root: string): Promise<CuratedInput[]> {
  return (await collectCuratedPagesDetailed(root)).pages;
}

export async function collectBronzeFiles(root: string): Promise<BronzeInput[]> {
  return (await collectBronzeFilesDetailed(root)).records;
}

export async function collectBronzeFilesDetailed(root: string): Promise<BronzeCollection> {
  const inputs: BronzeInput[] = [];
  const rejected: CorpusRejection[] = [];
  const bronzeDir = join(root, 'bronze');
  try {
    await assertRealPathWithinRoot(root, bronzeDir, 'Bronze directory', false);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records: [], rejected };
    throw error;
  }
  const paths: string[] = [];
  await walkBronzeDir(root, bronzeDir, paths, rejected);
  await mapCorpusReads(paths, fullPath => collectBronzeFile(root, fullPath, inputs, rejected));
  inputs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  rejected.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { records: inputs, rejected };
}

async function walkBronzeDir(
  root: string,
  dir: string,
  paths: string[],
  rejected: CorpusRejection[],
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    rejected.push({
      path: relative(root, dir).replace(/\\/gu, '/') || 'bronze',
      reason: 'unreadable',
      detail: `directory could not be listed (${(error as NodeJS.ErrnoException).code ?? 'unknown error'})`,
    });
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkBronzeDir(root, fullPath, paths, rejected);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    paths.push(fullPath);
  }
}

async function collectBronzeFile(
  root: string,
  fullPath: string,
  inputs: BronzeInput[],
  rejected: CorpusRejection[],
): Promise<void> {
  const relPath = relative(root, fullPath).replace(/\\/gu, '/');
  let raw: string;
  try {
    raw = await readFile(fullPath, 'utf8');
  } catch (error) {
    rejected.push({
      path: relPath,
      reason: 'unreadable',
      detail: `file could not be read (${(error as NodeJS.ErrnoException).code ?? 'unknown error'})`,
    });
    return;
  }

  const record = parseCorpusDocument(raw, BronzeRecordSchema, Object.keys(BronzeRecordSchema.shape));
  if (!record.valid) {
    // A record whose frontmatter will not validate cannot assert its own privacy
    // state. Retain it only as restricted, unknown and unverified.
    rejected.push({ path: relPath, ...record.failure });
    if (record.body === undefined) return;
    inputs.push({
      path: relPath,
      sha256: sha256Text(record.body),
      body: record.body,
      pii: 'unknown',
      sensitivity: 'restricted',
      hashVerified: false,
      rejection: { path: relPath, ...record.failure },
    });
    return;
  }

  const actual = sha256Text(record.body);
  inputs.push({
    path: relPath,
    sha256: record.data.sha256,
    body: record.body,
    pii: record.data.pii,
    sensitivity: record.data.sensitivity,
    // Keep the declared digest: replacing it with the computed digest would launder
    // a tampered body into the corpus.
    hashVerified: actual === record.data.sha256,
  });
}
