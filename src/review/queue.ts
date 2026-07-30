import type { CuratedPage } from '../contracts/index.js';
import type { ZigguratConfig } from '../contracts/config.js';
import { collectUnresolvedContradictions } from './contradictions.js';

export interface QueueEntry {
  path: string;
  title: string;
  status: CuratedPage['status'];
  confidence: CuratedPage['confidence'];
  updated_at: string;
  unresolved_contradiction_count: number;
}

export interface ReviewQueue {
  generated_at: string;
  count: number;
  entries: QueueEntry[];
}

const CONFIDENCE_ORDER: Record<CuratedPage['confidence'], number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/**
 * Builds a bounded, deterministically sorted review queue.
 * Sort: most unresolved contradictions, then in-review before draft, then lower confidence,
 * then oldest update (earliest ISO string), then lexical path.
 * Capped at config.lifecycle.review_queue_limit.
 */
export async function buildReviewQueue(
  root: string,
  candidates: Array<{ path: string; page: CuratedPage; updated_at: string }>,
  config: ZigguratConfig,
): Promise<ReviewQueue> {
  const entries: QueueEntry[] = [];

  for (const { path, page, updated_at } of candidates) {
    if (page.status === 'reviewed') continue;
    const contradictions = await collectUnresolvedContradictions(root, path);
    entries.push({
      path,
      title: page.title,
      status: page.status,
      confidence: page.confidence,
      updated_at,
      unresolved_contradiction_count: contradictions.length,
    });
  }

  entries.sort((a, b) => {
    if (b.unresolved_contradiction_count !== a.unresolved_contradiction_count) {
      return b.unresolved_contradiction_count - a.unresolved_contradiction_count;
    }
    const aReview = a.status === 'in-review' ? 0 : 1;
    const bReview = b.status === 'in-review' ? 0 : 1;
    if (aReview !== bReview) return aReview - bReview;
    const aCon = CONFIDENCE_ORDER[a.confidence];
    const bCon = CONFIDENCE_ORDER[b.confidence];
    if (aCon !== bCon) return aCon - bCon;
    if (a.updated_at !== b.updated_at) return a.updated_at < b.updated_at ? -1 : 1;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });

  const limited = entries.slice(0, config.lifecycle.review_queue_limit);

  return {
    generated_at: new Date().toISOString(),
    count: limited.length,
    entries: limited,
  };
}

/** Renders a ReviewQueue as a Markdown string with no mutation commands. */
export function renderReviewQueueMarkdown(queue: ReviewQueue): string {
  const lines: string[] = [
    `# Review Queue (${queue.count} entries)`,
    ``,
    `Generated: ${queue.generated_at}`,
    ``,
  ];

  if (queue.entries.length === 0) {
    lines.push('No pages pending review.');
    return lines.join('\n');
  }

  for (const entry of queue.entries) {
    lines.push(`## ${entry.title}`);
    lines.push(`- **Path:** \`${entry.path}\``);
    lines.push(`- **Status:** ${entry.status}`);
    lines.push(`- **Confidence:** ${entry.confidence}`);
    lines.push(`- **Updated:** ${entry.updated_at}`);
    if (entry.unresolved_contradiction_count > 0) {
      lines.push(`- **Unresolved contradictions:** ${entry.unresolved_contradiction_count}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
