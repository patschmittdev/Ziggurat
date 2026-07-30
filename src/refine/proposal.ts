import { randomUUID } from 'node:crypto';
import { link, mkdir, open, unlink } from 'node:fs/promises';
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
 * Parses unknownProposal through RefinementProposalSchema, validates every evidence
 * citation against Bronze files under root, then atomically stages the proposal under
 * .ziggurat/proposals/. This is the single validated staging path; no unchecked writer
 * is exposed.
 */
export async function stageProposal(
  root: string,
  unknownProposal: unknown,
): Promise<string> {
  const proposal = RefinementProposalSchema.parse(unknownProposal);

  for (const citation of proposal.evidence) {
    const error = await validateEvidenceCitation(root, citation);
    if (error !== null) {
      throw new Error(
        `Evidence citation failed: ${error.source_path} (${error.failed_field}): ${error.message}`,
      );
    }
  }

  const proposalsDir = join(root, '.ziggurat', 'proposals');
  await mkdir(proposalsDir, { recursive: true });

  const finalPath = join(proposalsDir, `${randomUUID()}.json`);
  const tmpPath = join(proposalsDir, `${randomUUID()}.tmp`);
  const content = JSON.stringify(proposal, null, 2) + '\n';

  let fh: import('node:fs/promises').FileHandle | undefined;
  try {
    fh = await open(tmpPath, 'w');
    await fh.writeFile(content, 'utf8');
    await fh.sync();
    await fh.close();
    fh = undefined;
  } catch (writeErr) {
    if (fh !== undefined) {
      try { await fh.close(); } catch { /* ignore */ }
    }
    await unlink(tmpPath).catch(() => undefined);
    throw writeErr;
  }

  try {
    await link(tmpPath, finalPath);
  } catch (linkErr) {
    await unlink(tmpPath).catch(() => undefined);
    throw linkErr;
  }
  await unlink(tmpPath).catch(() => undefined);

  return finalPath;
}

/**
 * Requests a Silver refinement from the adapter, then delegates to stageProposal
 * which parses, validates all evidence citations, and atomically stages on disk.
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
  await stageProposal(input.root, raw);
  return RefinementProposalSchema.parse(raw);
}
