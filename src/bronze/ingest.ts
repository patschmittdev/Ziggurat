import { lstat, readFile, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join, posix, win32 } from 'node:path';
import { BronzeRecordSchema } from '../contracts/index.js';
import { assertRealPathWithinRoot } from '../fs/boundary.js';
import { canonicalBronzeBody, sha256Text } from './canonical.js';
import { assessPrivacy } from './privacy.js';
import {
  atomicWriteBronze,
  collectBronzeHashes,
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

const SAFE_SOURCE_KIND = /^[a-z0-9][a-z0-9-]*$/u;

/** The only directory an ingest source may physically live in. */
export const INBOX_DIR = 'inbox';

function toPosix(value: string): string {
  return value.replace(/\\/gu, '/').replace(/\/+$/u, '');
}

/**
 * Resolves a vault-relative ingest source to the real file it names, or throws.
 *
 * Ingest both READS and DELETES its source, so a source that escapes `inbox/` is a
 * combined arbitrary-read and arbitrary-delete primitive. Every rejection below
 * happens before the file is opened, so a rejected source is never read, copied into
 * Bronze, or unlinked.
 *
 * Rejected: absolute paths, `.`/`..` segments, empty segments, control characters,
 * anything whose first segment is not `inbox`, directories, symbolic links, Windows
 * junctions and other reparse points, hard links, and any path whose real parent
 * directory lies outside the real `inbox/` directory.
 *
 * Nested inbox paths such as `inbox/2026/report.md` remain valid.
 */
export async function resolveInboxSourcePath(
  root: string,
  inboxPath: string,
): Promise<string> {
  if (typeof inboxPath !== 'string' || inboxPath.length === 0) {
    throw new Error('ingest source must be a non-empty vault-relative path');
  }
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(inboxPath)) {
    throw new Error('ingest source must not contain control characters');
  }
  if (posix.isAbsolute(inboxPath) || win32.isAbsolute(inboxPath)) {
    throw new Error(`ingest source must be relative to the vault root: ${inboxPath}`);
  }

  const segments = inboxPath.split(/[\\/]/u);
  for (const segment of segments) {
    if (segment === '') {
      throw new Error(`ingest source must not contain empty path segments: ${inboxPath}`);
    }
    if (segment === '.' || segment === '..') {
      throw new Error(`ingest source must not contain . or .. segments: ${inboxPath}`);
    }
  }
  if (segments.length < 2 || segments[0] !== INBOX_DIR) {
    throw new Error(`ingest source must be a path under ${INBOX_DIR}/: ${inboxPath}`);
  }

  const relPath = segments.join('/');
  const inboxDir = join(root, INBOX_DIR);
  await assertRealPathWithinRoot(root, inboxDir, 'Inbox directory', false);

  const candidate = join(root, ...segments);
  const stats = await lstat(candidate);
  if (stats.isSymbolicLink()) {
    throw new Error(
      `ingest source must not be a symbolic link, junction, or reparse point: ${relPath}`,
    );
  }
  if (!stats.isFile()) {
    throw new Error(`ingest source must be a regular file: ${relPath}`);
  }
  if (stats.nlink > 1) {
    throw new Error(
      `ingest source must not be a hard link to content outside inbox/: ${relPath}`,
    );
  }

  const [realInbox, realParent] = await Promise.all([
    realpath(inboxDir),
    realpath(dirname(candidate)),
  ]);
  const normInbox = toPosix(realInbox);
  const normParent = toPosix(realParent);
  if (normParent !== normInbox && !normParent.startsWith(`${normInbox}/`)) {
    throw new Error(
      `ingest source resolves outside ${INBOX_DIR}/ (possible symlink or junction): ${relPath}`,
    );
  }

  return join(realParent, basename(candidate));
}

/**
 * Ingests an Inbox file as an immutable Bronze record.
 * - Returns 'duplicate' (without removing Inbox) if the body sha256 already exists in bronze/.
 * - Removes Inbox only after the Bronze file exists and body hash is verified.
 */
export async function ingestCapture(
  root: string,
  inboxPath: string,
  options: { now: Date; sourceKind: string; origin?: string },
): Promise<IngestResult> {
  const { now, sourceKind, origin } = options;

  if (!SAFE_SOURCE_KIND.test(sourceKind)) {
    throw new Error(`invalid sourceKind: "${sourceKind}"`);
  }

  const inboxFullPath = await resolveInboxSourcePath(root, inboxPath);
  const rawContent = await readFile(inboxFullPath, 'utf8');

  const body = canonicalBronzeBody(rawContent);
  const sha256 = sha256Text(body);

  const existingHashes = await collectBronzeHashes(root);
  const existingPath = existingHashes.get(sha256);
  if (existingPath !== undefined) {
    return { status: 'duplicate', source_path: existingPath, sha256 };
  }

  // Derive the slug from the resolved real filename so a backslash-separated input
  // cannot produce a different source_id on POSIX than on Windows.
  const sourceId = slugify(basename(inboxFullPath, extname(inboxFullPath)));
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

  await unlink(inboxFullPath);

  return { status: 'created', source_path: targetRelPath, sha256 };
}
