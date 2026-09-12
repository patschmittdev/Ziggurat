import type { CliIO } from '../main.js';
import { parseZigguratConfig } from '../../contracts/config.js';
import { collectStagedProposals } from '../../refine/store.js';
import {
  buildReviewQueue,
  renderReviewQueueMarkdown,
} from '../../review/queue.js';
import type { ReviewOptions } from '../../review/queue.js';
import { safeJsonStringify } from '../../presentation/inert.js';

export async function runReview(
  root: string,
  json: boolean,
  io: CliIO,
  options: ReviewOptions = {},
): Promise<number> {
  const config = await parseZigguratConfig(root);
  const queue = await buildReviewQueue(
    root,
    await collectStagedProposals(root),
    config,
    options,
  );

  if (json) {
    io.stdout(safeJsonStringify(queue, 2) + '\n');
  } else {
    io.stdout(renderReviewQueueMarkdown(queue));
  }
  return 0;
}
