import { readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { posix } from 'node:path';
import { BronzeRecordSchema } from '../contracts/index.js';
import type { BronzeRecord, EvidenceCitation } from '../contracts/index.js';
import { sha256Text } from '../bronze/canonical.js';
import { BronzeCorruptionError } from '../bronze/store.js';
import { bodyLines } from '../bronze/lines.js';
import { assertRealPathWithinRoot } from '../fs/boundary.js';
import { parseCorpusDocument } from '../corpus/documents.js';
import type { DocumentFailure } from '../corpus/documents.js';
import { createCorpusReadLimiter } from '../corpus/read-pool.js';

export type EvidenceFailedField = 'body_sha256' | 'line_range' | 'quote' | 'quote_sha256';

export interface EvidenceValidationError {
  source_path: string;
  failed_field: EvidenceFailedField;
  message: string;
}

export class BronzeDocumentError extends Error {
  constructor(public readonly reason: DocumentFailure['reason'], detail: string) {
    super(detail);
    this.name = 'BronzeDocumentError';
  }
}

export interface VerifiedBronzeSource {
  readonly record: Readonly<BronzeRecord>;
  readonly body: string;
  readonly lines: readonly string[];
}

/** Root-bound actual-file reads, owned by one request and never reused afterwards. */
export class VerifiedBronzeReader {
  readonly #root: string;
  readonly #sources = new Map<string, Promise<VerifiedBronzeSource>>();
  readonly #limit = createCorpusReadLimiter();

  constructor(root: string) {
    this.#root = resolve(root);
  }

  read(root: string, sourcePath: string): Promise<VerifiedBronzeSource> {
    if (resolve(root) !== this.#root) {
      return Promise.reject(new Error('Verified Bronze reader belongs to a different vault root'));
    }
    const cached = this.#sources.get(sourcePath);
    if (cached !== undefined) return cached;
    const pending = this.#limit(() => this.#readSource(sourcePath));
    this.#sources.set(sourcePath, pending);
    return pending;
  }

  async #readSource(sourcePath: string): Promise<VerifiedBronzeSource> {
    const filePath = await resolveBronzeSourcePath(this.#root, sourcePath);
    const raw = await readFile(filePath, 'utf8');
    const parsed = parseCorpusDocument(raw, BronzeRecordSchema, Object.keys(BronzeRecordSchema.shape));
    if (!parsed.valid) throw new BronzeDocumentError(parsed.failure.reason, parsed.failure.detail);
    const actual = sha256Text(parsed.body);
    if (actual !== parsed.data.sha256) {
      throw new BronzeCorruptionError(filePath, parsed.data.sha256, actual);
    }
    return Object.freeze({
      record: Object.freeze(parsed.data),
      body: parsed.body,
      lines: Object.freeze(bodyLines(parsed.body)),
    });
  }
}

export function createVerifiedBronzeReader(root: string): VerifiedBronzeReader {
  return new VerifiedBronzeReader(root);
}

/**
 * Asserts sourcePath is a normalized POSIX vault-relative path under bronze/.
 * Resolves real paths to detect symlink escapes.
 * Throws on: absolute paths, backslashes, dot segments, traversal, paths outside bronze/.
 */
export async function resolveBronzeSourcePath(
  root: string,
  sourcePath: string,
): Promise<string> {
  if (/[\x00-\x1f\x7f-\x9f]/u.test(sourcePath)) {
    throw new Error('source_path must not contain control characters');
  }
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
  await assertRealPathWithinRoot(root, bronzeRootAbs, 'Bronze directory', false);

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
  bronzeReader: VerifiedBronzeReader = createVerifiedBronzeReader(root),
): Promise<EvidenceValidationError | null> {
  const source = await bronzeReader.read(root, citation.source_path);
  const actualBodySha = source.record.sha256;

  if (actualBodySha !== citation.body_sha256) {
    return {
      source_path: citation.source_path,
      failed_field: 'body_sha256',
      message: `body hash mismatch: expected ${citation.body_sha256}, got ${actualBodySha}`,
    };
  }

  const lines = source.lines;
  const lineCount = lines.length;
  if (
    !Number.isInteger(citation.line_start)
    || !Number.isInteger(citation.line_end)
    || citation.line_start < 1
    || citation.line_end < citation.line_start
    || citation.line_start > lineCount
    || citation.line_end > lineCount
  ) {
    return {
      source_path: citation.source_path,
      failed_field: 'line_range',
      message: `line range ${citation.line_start}-${citation.line_end} exceeds body line count ${lineCount}`,
    };
  }
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
