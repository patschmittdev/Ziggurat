import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as YAML from 'yaml';
import { CuratedPageSchema } from '../contracts/index.js';
import type { CuratedPage } from '../contracts/index.js';
import { BronzeRecordSchema } from '../contracts/bronze.js';
import { sha256Text } from '../bronze/canonical.js';

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

function splitFile(content: string): Split | null {
  if (!content.startsWith('---\n')) return null;
  const afterOpen = content.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx === -1) return null;
  return { frontmatter: afterOpen.slice(0, closeIdx), body: afterOpen.slice(closeIdx + 5) };
}

export async function collectCuratedPages(root: string): Promise<CuratedInput[]> {
  const knowledgeDir = join(root, 'knowledge');
  const inputs: CuratedInput[] = [];
  let entries: string[];
  try {
    entries = await readdir(knowledgeDir);
  } catch {
    return inputs;
  }
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.md')) continue;
    const relPath = `knowledge/${entry}`;
    try {
      const raw = await readFile(join(root, relPath), 'utf8');
      const content = raw.replace(/\r\n/g, '\n');
      const split = splitFile(content);
      if (split === null) continue;
      const parsed = YAML.parse(split.frontmatter) as unknown;
      const result = CuratedPageSchema.safeParse(parsed);
      if (!result.success) continue;
      inputs.push({ path: relPath, page: result.data, pageBody: split.body });
    } catch {
      continue;
    }
  }
  return inputs;
}

export async function collectBronzeFiles(root: string): Promise<BronzeInput[]> {
  const inputs: BronzeInput[] = [];
  await walkBronzeDir(root, join(root, 'bronze'), inputs);
  return inputs.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

async function walkBronzeDir(root: string, dir: string, inputs: BronzeInput[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkBronzeDir(root, fullPath, inputs);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    try {
      const relPath = fullPath.replace(/\\/g, '/').replace(root.replace(/\\/g, '/') + '/', '');
      const content = (await readFile(fullPath, 'utf8')).replace(/\r\n/g, '\n');
      const split = splitFile(content);
      if (split === null) continue;

      const parsed = YAML.parse(split.frontmatter) as unknown;
      const record = BronzeRecordSchema.safeParse(parsed);
      const actual = sha256Text(split.body);

      if (!record.success) {
        // A record whose frontmatter will not validate cannot assert its own privacy
        // state. Treat it as maximally sensitive rather than skipping it silently, so
        // downstream filters exclude it instead of never seeing it.
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
    } catch {
      continue;
    }
  }
}
