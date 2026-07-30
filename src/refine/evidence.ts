import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { posix } from 'node:path';
import type { EvidenceCitation } from '../contracts/index.js';
import { sha256Text } from '../bronze/canonical.js';
import { parseBronzeRecord, BronzeCorruptionError } from '../bronze/store.js';

export type EvidenceFailedField = 'body_sha256' | 'quote' | 'quote_sha256';

export interface EvidenceValidationError {
  source_path: string;
  failed_field: EvidenceFailedField;
  message: string;
}

function extractBronzeBody(content: string): string {
  if (!content.startsWith('---\n')) throw new Error('not a valid Bronze file: missing opening frontmatter delimiter');
  const afterOpen = content.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx === -1) throw new Error('not a valid Bronze file: unclosed frontmatter');
  return afterOpen.slice(closeIdx + 5);
}

/**
 * Asserts sourcePath is a normalized POSIX vault-relative path under bronze/.
 * Resolves real paths to detect symlink escapes.
 * Throws on: absolute paths, backslashes, dot segments, traversal, paths outside bronze/.
 */
async function assertBronzeSourcePath(root: string, sourcePath: string): Promise<string> {
  if (sourcePath.includes('\\')) {
    throw new Error(`source_path must use forward slashes only: ${sourcePath}`);
  }
  if (posix.isAbsolute(sourcePath)) {
    throw new Error(`source_path must be a relative path: ${sourcePath}`);
  }
  const parts = sourcePath.split('/');
  for (const part of parts) {
    if (part === '.' || part === '..') {
      throw new Error(`source_path must not contain . or .. segments: ${sourcePath}`);
    }
    if (part === '') {
      throw new Error(`source_path must not contain empty path segments: ${sourcePath}`);
    }
  }
  if (!sourcePath.startsWith('bronze/') || sourcePath.length <= 'bronze/'.length) {
    throw new Error(`source_path must be a relative path under bronze/: ${sourcePath}`);
  }

  const absolutePath = join(root, sourcePath);
  const bronzeRootAbs = join(root, 'bronze');

  const [realFile, realBronze] = await Promise.all([
    realpath(absolutePath),
    realpath(bronzeRootAbs),
  ]);

  const normFile = realFile.replace(/\\/g, '/');
  const normBronze = realBronze.replace(/\\/g, '/');

  if (!normFile.startsWith(normBronze + '/')) {
    throw new Error(`source_path escapes the bronze/ directory (possible symlink): ${sourcePath}`);
  }

  return absolutePath;
}

/**
 * Validates that an EvidenceCitation exactly matches the referenced Bronze file.
 * Requires the file to be a valid Bronze record with a verified body hash.
 * Returns null on success or an error describing the first failed citation field.
 * Throws on path violations, non-Bronze files, or corpus corruption.
 */
export async function validateEvidenceCitation(
  root: string,
  citation: EvidenceCitation,
): Promise<EvidenceValidationError | null> {
  const filePath = await assertBronzeSourcePath(root, citation.source_path);

  const rawContent = await readFile(filePath, 'utf8');
  const content = rawContent.replace(/\r\n/g, '\n');

  const bronzeRecord = parseBronzeRecord(content);
  const body = extractBronzeBody(content);

  const actualBodySha = sha256Text(body);
  if (actualBodySha !== bronzeRecord.sha256) {
    throw new BronzeCorruptionError(filePath, bronzeRecord.sha256, actualBodySha);
  }

  if (actualBodySha !== citation.body_sha256) {
    return {
      source_path: citation.source_path,
      failed_field: 'body_sha256',
      message: `body hash mismatch: expected ${citation.body_sha256}, got ${actualBodySha}`,
    };
  }

  const lines = body.split('\n');
  const extracted = lines.slice(citation.line_start - 1, citation.line_end).join('\n');

  if (extracted !== citation.quote) {
    return {
      source_path: citation.source_path,
      failed_field: 'quote',
      message: `quote mismatch at lines ${citation.line_start}-${citation.line_end}`,
    };
  }

  const actualQuoteSha = sha256Text(citation.quote);
  if (actualQuoteSha !== citation.quote_sha256) {
    return {
      source_path: citation.source_path,
      failed_field: 'quote_sha256',
      message: `quote digest mismatch: expected ${citation.quote_sha256}, got ${actualQuoteSha}`,
    };
  }

  return null;
}
