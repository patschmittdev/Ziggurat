import * as YAML from 'yaml';
import type { z } from 'zod';

export interface DocumentFailure {
  reason: 'missing-frontmatter' | 'invalid-yaml' | 'schema-invalid';
  detail: string;
  fields?: string[];
}

type ParsedDocument<T> =
  | { valid: true; data: T; body: string }
  | { valid: false; failure: DocumentFailure; body?: string };

/** Corpus collection and Gold lineage use identical normalization and strict parsing. */
export function parseCorpusDocument<T>(
  raw: string,
  schema: z.ZodType<T>,
  knownFields: readonly string[],
): ParsedDocument<T> {
  const content = raw.replace(/\r\n/g, '\n');
  const close = content.startsWith('---\n') ? content.indexOf('\n---\n', 4) : -1;
  if (close === -1) {
    return {
      valid: false,
      failure: {
        reason: 'missing-frontmatter',
        detail: 'file does not start with a closed --- frontmatter block',
      },
    };
  }
  const body = content.slice(close + 5);
  let parsed: unknown;
  try {
    parsed = YAML.parse(content.slice(4, close)) as unknown;
  } catch (error) {
    const start = (error as { linePos?: { line: number; col: number }[] } | null)?.linePos?.[0];
    const location = start !== undefined
      && Number.isInteger(start.line) && Number.isInteger(start.col)
      ? ` at line ${start.line}, column ${start.col}` : '';
    return {
      valid: false,
      failure: { reason: 'invalid-yaml', detail: `frontmatter is not valid YAML${location}` },
    };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map(issue => {
      // Unknown keys can themselves contain private content; only schema-owned names
      // and array indices may appear in diagnostics.
      const path = issue.path.map(part =>
        typeof part === 'number' ? String(part)
          : knownFields.includes(String(part)) ? String(part) : '<unknown>');
      return path.length === 0 ? '<root>' : path.join('.');
    }))].sort();
    const codes = [...new Set(result.error.issues.map(issue => issue.code))].sort();
    return {
      valid: false,
      body,
      failure: {
        reason: 'schema-invalid',
        fields,
        detail: `frontmatter failed schema validation at ${fields.join(', ')} (${codes.join(', ')})`,
      },
    };
  }
  return { valid: true, data: result.data, body };
}
