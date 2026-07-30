import { readFile, unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { BronzeRecordSchema } from '../contracts/index.js';
import { canonicalBronzeBody, sha256Text } from './canonical.js';
import { assessPrivacy } from './privacy.js';
import {
  atomicWriteBronze,
  collectBronzeHashes,
  parseBronzeRecord,
  serializeBronzeFile,
  verifyBronzeFile,
} from './store.js';

export interface IngestResult {
  status: 'created' | 'duplicate';
  source_path: string;
  sha256: string;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Ingests an Inbox file as an immutable Bronze record.
 * - Returns 'duplicate' (without removing Inbox) if the body sha256 already exists in bronze/.
 * - Removes Inbox only after the Bronze file exists and reparses through BronzeRecordSchema.
 */
export async function ingestCapture(
  root: string,
  inboxPath: string,
  options: { now: Date; sourceKind: string; origin?: string },
): Promise<IngestResult> {
  const { now, sourceKind, origin } = options;

  const inboxFullPath = join(root, inboxPath);
  const rawContent = await readFile(inboxFullPath, 'utf8');

  const body = canonicalBronzeBody(rawContent);
  const sha256 = sha256Text(body);

  const existingHashes = await collectBronzeHashes(root);
  const existingPath = existingHashes.get(sha256);
  if (existingPath !== undefined) {
    return { status: 'duplicate', source_path: existingPath, sha256 };
  }

  const sourceId = slugify(basename(inboxPath, extname(inboxPath)));
  const targetRelPath = `bronze/${sourceKind}/${toDateStr(now)}-${sourceId}.md`;

  const privacy = assessPrivacy();
  const record = BronzeRecordSchema.parse({
    schema_version: 1,
    source_id: sourceId,
    source_kind: sourceKind,
    captured_at: now.toISOString(),
    sha256,
    ...(origin !== undefined ? { origin } : {}),
    sensitivity: privacy.sensitivity,
    pii: privacy.pii,
  });

  const fileContent = serializeBronzeFile(record, body);

  // Inbox is not touched until after both atomicWrite and verification succeed.
  await atomicWriteBronze(root, targetRelPath, fileContent);

  const targetFullPath = join(root, targetRelPath);
  const verifyResult = await verifyBronzeFile(targetFullPath);
  if (!verifyResult.valid) {
    throw new Error(
      `Bronze write failed body verification: expected ${verifyResult.expected}, got ${verifyResult.actual}`,
    );
  }
  // Re-parse through schema as a final structural guard.
  const writtenContent = await readFile(targetFullPath, 'utf8');
  parseBronzeRecord(writtenContent);

  await unlink(inboxFullPath);

  return { status: 'created', source_path: targetRelPath, sha256 };
}
