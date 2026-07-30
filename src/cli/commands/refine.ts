import type { CliIO } from '../main.js';
import { stageProposal } from '../../refine/proposal.js';
import { parseZigguratConfig } from '../../contracts/config.js';
import { LoopbackChatAdapter } from '../../refine/adapter.js';

export async function runRefine(root: string, query: string | undefined, json: boolean, io: CliIO): Promise<number> {
  if (!query) {
    io.stderr('error: --query is required for the refine command\n');
    return 1;
  }

  const config = await parseZigguratConfig(root);
  const endpoint = config.adapters.model_endpoint;
  if (!endpoint) {
    io.stderr('error: adapters.model_endpoint is required in config/adapters.yaml for the refine command\n');
    return 1;
  }

  const adapter = new LoopbackChatAdapter(endpoint);
  const raw = await adapter.completeJson([
    { role: 'system', content: 'You are a knowledge refinement assistant. Output a RefinementProposal JSON object.' },
    { role: 'user', content: query },
  ]);

  const stagePath = await stageProposal(root, raw);

  if (json) {
    io.stdout(JSON.stringify({ staged: stagePath }, null, 2) + '\n');
  } else {
    io.stdout(`Staged proposal: ${stagePath}\n`);
  }
  return 0;
}
