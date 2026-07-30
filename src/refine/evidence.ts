import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { EvidenceCitation } from '../contracts/index.js';
import { sha256Text } from '../bronze/canonical.js';

export type EvidenceFailedField = 'body_sha256' | 'quote' | 'quote_sha256';

export interface EvidenceValidationError {
  source_path: string;
  failed_field: EvidenceFailedField;
  message: string;
}

function extractBronzeBody(content: string): string | null {
  if (!content.startsWith('---\n')) return null;
  const afterOpen = content.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx === -1) return null;
  return afterOpen.slice(closeIdx + 5);
}

/**
 * Validates that an EvidenceCitation exactly matches the referenced Bronze file.
 * Returns null on success or an error describing the first failed field.
 */
export async function validateEvidenceCitation(
  root: string,
  citation: EvidenceCitation,
): Promise<EvidenceValidationError | null> {
  const filePath = join(root, citation.source_path);
  const rawContent = await readFile(filePath, 'utf8');
  const content = rawContent.replace(/\r\n/g, '\n');
  const body = extractBronzeBody(content) ?? content;

  const actualBodySha = sha256Text(body);
  if (actualBodySha !== citation.body_sha256) {
    return {
      source_path: citation.source_path,
      failed_field: 'body_sha256',
      message: `body hash mismatch: expected ${citation.body_sha256}, got ${actualBodySha}`,
    };
  }

  // 1-based inclusive line range -> 0-based slice
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
