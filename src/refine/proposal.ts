import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { RefinementProposalSchema } from '../contracts/index.js';
import type { RefinementProposal } from '../contracts/index.js';
import { validateEvidenceCitation } from './evidence.js';
import type { StructuredChatAdapter, ChatMessage } from './adapter.js';

export type { StructuredChatAdapter, ChatMessage } from './adapter.js';

export interface RefinementInput {
  /** Absolute path to the vault root, used for evidence validation and staging. */
  root: string;
  topic: string;
  target_path: string;
  bronze_source_paths: string[];
  existing_content?: string;
}

/**
 * Writes a proposal as JSON under `<root>/.ziggurat/proposals/`.
 * This function only stages the proposal; it never interprets or applies the operation.
 */
export async function stageProposal(
  root: string,
  proposal: RefinementProposal,
): Promise<string> {
  const proposalsDir = join(root, '.ziggurat', 'proposals');
  await mkdir(proposalsDir, { recursive: true });

  const filePath = join(proposalsDir, `${randomUUID()}.json`);
  const content = JSON.stringify(proposal, null, 2) + '\n';

  const fh = await open(filePath, 'wx');
  try {
    await fh.writeFile(content, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }

  return filePath;
}

/**
 * Requests a Silver refinement from the adapter, validates all evidence citations
 * against the Bronze corpus, then stages the proposal on disk.
 */
export async function requestRefinement(
  adapter: StructuredChatAdapter,
  input: RefinementInput,
): Promise<RefinementProposal> {
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a knowledge curation assistant. ' +
        'Return a JSON object matching the RefinementProposal schema (schema_version, ' +
        'operation, target_path, evidence, confidence, affected_paths, related_paths, ' +
        'unresolved_questions). All evidence citations must reference exact Bronze text.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        topic: input.topic,
        target_path: input.target_path,
        bronze_source_paths: input.bronze_source_paths,
        existing_content: input.existing_content,
      }),
    },
  ];

  const raw = await adapter.completeJson(messages);

  // Zod parse: throws ZodError on schema violation.
  const proposal = RefinementProposalSchema.parse(raw);

  // Validate every evidence citation against the actual Bronze files.
  for (const citation of proposal.evidence) {
    const error = await validateEvidenceCitation(input.root, citation);
    if (error !== null) {
      throw new Error(
        `Evidence citation failed: ${error.source_path} (${error.failed_field}): ${error.message}`,
      );
    }
  }

  await stageProposal(input.root, proposal);
  return proposal;
}
