import type { CliIO } from '../main.js';
import { executeRefinement } from '../../refine/proposal.js';
import { parseZigguratConfig } from '../../contracts/config.js';
import { LoopbackChatAdapter } from '../../refine/adapter.js';
import { inertSingleLineText } from '../../presentation/inert.js';

export interface RefineOptions {
  /**
   * Explicit Bronze paths the operator chose to place in the request. Omitting this
   * uses the conservative default: only Bronze the model-access privacy policy already
   * allows. Naming sources is a deliberate human decision to widen that set.
   */
  sources?: readonly string[] | undefined;
  target?: string | undefined;
}

export async function runRefine(
  root: string,
  query: string | undefined,
  json: boolean,
  io: CliIO,
  options: RefineOptions = {},
): Promise<number> {
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

  const adapter = new LoopbackChatAdapter(endpoint, {
    ...(config.adapters.model_name === undefined ? {} : { model: config.adapters.model_name }),
  });
  const staged = await executeRefinement(adapter, {
    root,
    topic: query,
    target_path: options.target,
    bronze_source_paths: options.sources,
  }, {
    onReference(reference) {
      for (const omission of reference.omitted) {
        io.stderr(
          `warning: omitted Bronze source ${inertSingleLineText(omission.source_path)}: ${omission.reason}\n`,
        );
      }
    },
  });
  const reference = staged.reference;

  if (json) {
    io.stdout(JSON.stringify({
      staged: staged.path,
      proposal_id: staged.proposal.proposal_id,
      staged_at: staged.proposal.staged_at,
      reference_sources: reference.sources.map(source => source.source_path),
      omitted_sources: reference.omitted,
    }, null, 2) + '\n');
  } else {
    io.stdout(`Staged proposal: ${staged.path}\n`);
    io.stdout(`Bronze reference sources: ${reference.sources.length}\n`);
  }

  return 0;
}
