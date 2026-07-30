import { randomUUID } from 'node:crypto';
import {
  access,
  constants,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import * as YAML from 'yaml';
import { BronzeRecordSchema } from '../contracts/index.js';
import type { BronzeRecord } from '../contracts/index.js';
import { sha256Text } from './canonical.js';

export interface VerifyResult {
  valid: boolean;
  expected: string;
  actual: string;
}

interface BronzeSplit {
  yamlText: string;
  body: string;
}

/**
 * Splits a Bronze file into its YAML frontmatter text and body.
 * Format: ---\n<yaml>\n---\n<body>
 */
function splitBronzeFile(content: string): BronzeSplit | null {
  if (!content.startsWith('---\n')) return null;
  const afterOpen = content.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx === -1) return null;
  return {
    yamlText: afterOpen.slice(0, closeIdx),
    body: afterOpen.slice(closeIdx + 5),
  };
}

/** Parses a Bronze file's frontmatter + validates through BronzeRecordSchema. */
export function parseBronzeRecord(content: string): BronzeRecord {
  const split = splitBronzeFile(content);
  if (split === null) throw new Error('not a valid Bronze file: missing frontmatter');
  const parsed = YAML.parse(split.yamlText) as unknown;
  return BronzeRecordSchema.parse(parsed);
}

/** Serializes a BronzeRecord + canonical body into the on-disk file format. */
export function serializeBronzeFile(record: BronzeRecord, body: string): string {
  // Use an ordered plain object so key order is deterministic.
  const data: Record<string, unknown> = {
    schema_version: record.schema_version,
    source_id: record.source_id,
    source_kind: record.source_kind,
    captured_at: record.captured_at,
    sha256: record.sha256,
  };
  if (record.origin !== undefined) data['origin'] = record.origin;
  data['sensitivity'] = record.sensitivity;
  data['pii'] = record.pii;

  const yaml = YAML.stringify(data, null, { lineWidth: 0 });
  return `---\n${yaml}---\n${body}`;
}

/** Walks the bronze/ subtree and returns Map<sha256, vaultRelativePath>. */
export async function collectBronzeHashes(root: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  const bronzeDir = join(root, 'bronze');
  try {
    await access(bronzeDir, constants.F_OK);
  } catch {
    return hashes;
  }
  await walkDir(bronzeDir, async (filePath) => {
    if (!filePath.endsWith('.md')) return;
    try {
      const content = await readFile(filePath, 'utf8');
      const split = splitBronzeFile(content);
      if (split === null) return;
      const parsed = YAML.parse(split.yamlText) as unknown;
      const result = BronzeRecordSchema.safeParse(parsed);
      if (result.success) {
        const relPath = relative(root, filePath).replace(/\\/gu, '/');
        hashes.set(result.data.sha256, relPath);
      }
    } catch { /* skip unreadable or invalid files */ }
  });
  return hashes;
}

async function walkDir(dir: string, fn: (filePath: string) => Promise<void>): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkDir(fullPath, fn);
    } else if (entry.isFile()) {
      await fn(fullPath);
    }
  }
}

/**
 * Writes content to a temporary file, fsyncs, then atomically renames to targetRelPath.
 * Fails if the target already exists (immutability) or if the target directory cannot be created.
 * The caller is responsible for Inbox removal; this function never touches the Inbox.
 */
export async function atomicWriteBronze(
  root: string,
  targetRelPath: string,
  content: string,
): Promise<void> {
  const targetPath = join(root, targetRelPath);

  // Ensure target directory exists before creating any temp file (fail fast).
  await mkdir(dirname(targetPath), { recursive: true });

  // Refuse to overwrite an existing Bronze file.
  try {
    await access(targetPath, constants.F_OK);
    throw new Error(`bronze target already exists and must not be overwritten: ${targetRelPath}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const tmpDir = join(root, '.ziggurat', 'tmp');
  await mkdir(tmpDir, { recursive: true });

  const tmpPath = join(tmpDir, randomUUID());
  let fh: import('node:fs/promises').FileHandle | undefined;
  try {
    fh = await open(tmpPath, 'w');
    await fh.writeFile(content, 'utf8');
    await fh.sync();
    await fh.close();
    fh = undefined;
  } catch (writeErr) {
    if (fh !== undefined) {
      try { await fh.close(); } catch { /* ignore */ }
    }
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw writeErr;
  }

  try {
    await rename(tmpPath, targetPath);
  } catch (renameErr) {
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw renameErr;
  }
}

/**
 * Verifies the body SHA-256 stored in a Bronze file's frontmatter matches the actual body.
 * Detects any mutation to the body content.
 */
export async function verifyBronzeFile(filePath: string): Promise<VerifyResult> {
  const content = await readFile(filePath, 'utf8');
  const split = splitBronzeFile(content);
  if (split === null) throw new Error(`${filePath}: not a valid Bronze file (no frontmatter)`);
  const parsed = YAML.parse(split.yamlText) as unknown;
  const record = BronzeRecordSchema.parse(parsed);
  const actual = sha256Text(split.body);
  return { valid: actual === record.sha256, expected: record.sha256, actual };
}
