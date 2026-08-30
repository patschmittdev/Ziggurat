import type { CliIO } from '../main.js';
import { createContextAccess } from '../../mcp/access.js';
import { inertSingleLineText, safeJsonStringify } from '../../presentation/inert.js';

/** query always uses the communion profile. */
export async function runQuery(root: string, query: string | undefined, json: boolean, io: CliIO): Promise<number> {
  if (!query) {
    io.stderr('error: --query is required for the query command\n');
    return 1;
  }

  const access = await createContextAccess(root, 'communion');
  const hits = await access.search(query);

  if (json) {
    io.stdout(safeJsonStringify(hits.map(h => ({
      citation_id: h.citation_id,
      path: h.path,
      heading: h.heading,
      score: h.score,
      tier: h.tier,
      content_role: h.content_role,
      instruction_authority: h.instruction_authority,
      excerpt: h.body.slice(0, 300),
    })), 2) + '\n');
  } else {
    if (hits.length === 0) {
      io.stdout('No results.\n');
    } else {
      for (const hit of hits) {
        io.stdout(
          `[${hit.citation_id}] ${inertSingleLineText(hit.heading)} `
          + `(${inertSingleLineText(hit.path)}) `
          + `score=${hit.score.toFixed(4)} `
          + 'content_role=reference instruction_authority=none\n',
        );
      }
    }
  }
  return 0;
}
