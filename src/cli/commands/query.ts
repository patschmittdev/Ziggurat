import type { CliIO } from '../main.js';
import { createContextAccess } from '../../mcp/access.js';

/** query always uses the communion profile. */
export async function runQuery(root: string, query: string | undefined, json: boolean, io: CliIO): Promise<number> {
  if (!query) {
    io.stderr('error: --query is required for the query command\n');
    return 1;
  }

  const access = await createContextAccess(root, 'communion');
  const hits = await access.search(query);

  if (json) {
    io.stdout(JSON.stringify(hits.map(h => ({
      citation_id: h.citation_id,
      path: h.path,
      heading: h.heading,
      score: h.score,
      tier: h.tier,
      excerpt: h.body.slice(0, 300),
    })), null, 2) + '\n');
  } else {
    if (hits.length === 0) {
      io.stdout('No results.\n');
    } else {
      for (const hit of hits) {
        io.stdout(`[${hit.citation_id}] ${hit.heading} (${hit.path}) score=${hit.score.toFixed(4)}\n`);
      }
    }
  }
  return 0;
}
