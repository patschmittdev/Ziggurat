import { randomUUID } from 'node:crypto';
import {
  access,
  constants,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  unlink,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import * as YAML from 'yaml';
import { BronzeRecordSchema } from '../contracts/index.js';
import type { BronzeRecord } from '../contracts/index.js';
import { parseCorpusDocument } from '../corpus/documents.js';
import { sha256Text } from './canonical.js';

export interface VerifyResult {
  valid: boolean;
  expected: string;
  actual: string;
}

export class BronzeCorruptionError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`Bronze corpus is corrupt: ${filePath} (expected ${expected}, got ${actual})`);
    this.name = 'BronzeCorruptionError';
  }
}

/** Parses a Bronze file's frontmatter + validates through BronzeRecordSchema. */
export function parseBronzeRecord(content: string): BronzeRecord {
  return parseBronzeFile(content).record;
}

export function parseBronzeFile(content: string): { record: BronzeRecord; body: string } {
  const parsed = parseCorpusDocument(content, BronzeRecordSchema, Object.keys(BronzeRecordSchema.shape));
  if (!parsed.valid) {
    const detail = parsed.failure.reason === 'missing-frontmatter'
      ? 'missing frontmatter' : parsed.failure.detail;
    throw new Error(`not a valid Bronze file: ${detail}`);
  }
  return { record: parsed.data, body: parsed.body };
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
      const { record, body } = parseBronzeFile(content);
      const actualHash = sha256Text(body);
      if (actualHash !== record.sha256) {
        throw new BronzeCorruptionError(filePath, record.sha256, actualHash);
      }
      const relPath = relative(root, filePath).replace(/\\/gu, '/');
      hashes.set(record.sha256, relPath);
    } catch (err) {
      if (err instanceof BronzeCorruptionError) throw err;
      /* skip unreadable or invalid files */
    }
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
 * Writes content to a temporary file in the target directory, fsyncs, then atomically
 * hard-links to targetRelPath. Fails with EEXIST if the target already exists (immutability).
 * The caller is responsible for Inbox removal; this function never touches the Inbox.
 */
export async function atomicWriteBronze(
  root: string,
  targetRelPath: string,
  content: string,
): Promise<void> {
  const targetPath = join(root, targetRelPath);
  const targetDir = dirname(targetPath);

  await mkdir(targetDir, { recursive: true });

  const tmpPath = join(targetDir, randomUUID() + '.tmp');
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
    await unlink(tmpPath).catch(() => undefined);
    throw writeErr;
  }

  try {
    await link(tmpPath, targetPath);
  } catch (linkErr) {
    await unlink(tmpPath).catch(() => undefined);
    if ((linkErr as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`bronze target already exists and must not be overwritten: ${targetRelPath}`);
    }
    throw linkErr;
  }
  await unlink(tmpPath).catch(() => undefined);
}

/**
 * Verifies the body SHA-256 stored in a Bronze file's frontmatter matches the actual body.
 * Detects any mutation to the body content.
 */
export async function verifyBronzeFile(filePath: string): Promise<VerifyResult> {
  const content = await readFile(filePath, 'utf8');
  const { record, body } = parseBronzeFile(content);
  const actual = sha256Text(body);
  return { valid: actual === record.sha256, expected: record.sha256, actual };
}
