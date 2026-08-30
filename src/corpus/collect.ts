import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import * as YAML from 'yaml';
import { CuratedPageSchema } from '../contracts/index.js';
import type { CuratedPage } from '../contracts/index.js';
import { BronzeRecordSchema } from '../contracts/bronze.js';
import { sha256Text } from '../bronze/canonical.js';
import { isKnowledgePath } from '../contracts/path.js';
import { assertRealPathWithinRoot } from '../fs/boundary.js';

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
}

interface Split {
  frontmatter: string;
  body: string;
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
}

export interface CuratedCollection {
  pages: CuratedInput[];
  rejected: CorpusRejection[];
}

export interface BronzeCollection {
  records: BronzeInput[];
  rejected: CorpusRejection[];
}

function describeYamlFailure(error: unknown): string {
  if (error !== null && typeof error === 'object' && 'linePos' in error) {
    const pos = (error as { linePos?: Array<{ line: number; col: number }> }).linePos;
    const start = pos?.[0];
    if (start !== undefined) {
      return `frontmatter is not valid YAML at line ${start.line}, column ${start.col}`;
    }
  }
  return 'frontmatter is not valid YAML';
}

/** Summarizes schema failures by field path and issue code only, never by value. */
function describeSchemaFailure(
  issues: readonly { path: PropertyKey[]; code: string }[],
): string {
  const fields = [...new Set(issues.flatMap(issue => {
    // Unrecognized keys are reported at the object root, so the key names are the only
    // way an operator can find the offending line. Key names are structure, not content.
    const keys = (issue as { keys?: readonly PropertyKey[] }).keys;
    const prefix = issue.path.length === 0 ? '' : `${issue.path.map(String).join('.')}.`;
    if (Array.isArray(keys) && keys.length > 0) {
      return keys.map(key => `${prefix}${String(key)}`);
    }
    return [issue.path.length === 0 ? '<root>' : issue.path.map(String).join('.')];
  }))].sort();
  const codes = [...new Set(issues.map(issue => issue.code))].sort();
  return `frontmatter failed schema validation at ${fields.join(', ')} (${codes.join(', ')})`;
}

function splitFile(content: string): Split | null {
  if (!content.startsWith('---\n')) return null;
  const afterOpen = content.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx === -1) return null;
  return { frontmatter: afterOpen.slice(0, closeIdx), body: afterOpen.slice(closeIdx + 5) };
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
  for (const entry of entries.sort()) {
    if (!isKnowledgePath(`knowledge/${entry}`)) continue;
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
      continue;
    }

    const content = raw.replace(/\r\n/g, '\n');
    const split = splitFile(content);
    if (split === null) {
      rejected.push({
        path: relPath,
        reason: 'missing-frontmatter',
        detail: 'file does not start with a closed --- frontmatter block',
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(split.frontmatter) as unknown;
    } catch (error) {
      rejected.push({ path: relPath, reason: 'invalid-yaml', detail: describeYamlFailure(error) });
      continue;
    }

    const result = CuratedPageSchema.safeParse(parsed);
    if (!result.success) {
      rejected.push({
        path: relPath,
        reason: 'schema-invalid',
        detail: describeSchemaFailure(result.error.issues),
      });
      continue;
    }
    pages.push({ path: relPath, page: result.data, pageBody: split.body });
  }
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
  await walkBronzeDir(root, bronzeDir, inputs, rejected);
  inputs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  rejected.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { records: inputs, rejected };
}

async function walkBronzeDir(
  root: string,
  dir: string,
  inputs: BronzeInput[],
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
      await walkBronzeDir(root, fullPath, inputs, rejected);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
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
      continue;
    }

    const content = raw.replace(/\r\n/g, '\n');
    const split = splitFile(content);
    if (split === null) {
      rejected.push({
        path: relPath,
        reason: 'missing-frontmatter',
        detail: 'file does not start with a closed --- frontmatter block',
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = YAML.parse(split.frontmatter) as unknown;
    } catch (error) {
      rejected.push({ path: relPath, reason: 'invalid-yaml', detail: describeYamlFailure(error) });
      continue;
    }

    const record = BronzeRecordSchema.safeParse(parsed);
    const actual = sha256Text(split.body);

    if (!record.success) {
      // A record whose frontmatter will not validate cannot assert its own privacy
      // state. Treat it as maximally sensitive rather than skipping it silently, so
      // downstream filters exclude it instead of never seeing it. It is also reported
      // so an operator can repair the record instead of wondering where it went.
      rejected.push({
        path: relPath,
        reason: 'schema-invalid',
        detail: describeSchemaFailure(record.error.issues),
      });
      inputs.push({
        path: relPath,
        sha256: actual,
        body: split.body,
        pii: 'unknown',
        sensitivity: 'restricted',
        hashVerified: false,
      });
      continue;
    }

    inputs.push({
      path: relPath,
      sha256: record.data.sha256,
      body: split.body,
      pii: record.data.pii,
      sensitivity: record.data.sensitivity,
      // Compare against the DECLARED hash, never a freshly computed one: recomputing
      // and storing the new digest is exactly how a tampered body would launder
      // itself back into the corpus.
      hashVerified: actual === record.data.sha256,
    });
  }
}
