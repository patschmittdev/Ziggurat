import type { CliIO } from '../main.js';
import { buildReviewQueue, renderReviewQueueMarkdown } from '../../review/queue.js';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as YAML from 'yaml';
import { CuratedPageSchema } from '../../contracts/index.js';
import { parseZigguratConfig } from '../../contracts/config.js';

export async function runReview(root: string, json: boolean, io: CliIO): Promise<number> {
  const config = await parseZigguratConfig(root);
  const knowledgeDir = join(root, 'knowledge');
  const candidates: Array<{ path: string; page: import('../../contracts/index.js').CuratedPage; updated_at: string }> = [];

  let entries: string[];
  try {
    entries = await readdir(knowledgeDir);
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const relPath = `knowledge/${entry}`;
    const fullPath = join(root, relPath);
    try {
      const content = await readFile(fullPath, 'utf8');
      const fm = extractFrontmatter(content);
      if (!fm) continue;
      const parsed = YAML.parse(fm) as unknown;
      const result = CuratedPageSchema.safeParse(parsed);
      if (!result.success) continue;
      const stat = await import('node:fs/promises').then(m => m.stat(fullPath));
      candidates.push({ path: relPath, page: result.data, updated_at: stat.mtime.toISOString() });
    } catch {
      continue;
    }
  }

  const queue = await buildReviewQueue(root, candidates, config);

  if (json) {
    io.stdout(JSON.stringify(queue, null, 2) + '\n');
  } else {
    io.stdout(renderReviewQueueMarkdown(queue));
  }
  return 0;
}

function extractFrontmatter(content: string): string | null {
  if (!content.startsWith('---\n')) return null;
  const afterOpen = content.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx === -1) return null;
  return afterOpen.slice(0, closeIdx);
}
