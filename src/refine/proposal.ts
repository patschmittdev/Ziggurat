import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  RefinementProposalPayloadSchema,
  RefinementProposalSchema,
} from '../contracts/index.js';
import type {
  EvidenceCitation,
  RefinementProposal,
} from '../contracts/index.js';
import { sha256Text } from '../bronze/canonical.js';
import { normalizeText } from '../authorization/canonical.js';
import { validateEvidenceCitation } from './evidence.js';
import type { StructuredChatAdapter, ChatMessage } from './adapter.js';
import type { z } from 'zod';
import { assertRealPathWithinRoot } from '../fs/boundary.js';

export type { StructuredChatAdapter, ChatMessage } from './adapter.js';

export interface RefinementInput {
  /** Absolute path to the vault root, used for evidence validation and staging. */
  root: string;
  topic: string;
  target_path: string;
  bronze_source_paths: string[];
  existing_content?: string;
}

export interface StagedProposalResult {
  path: string;
  proposal: RefinementProposal;
}

export interface StageProposalOptions {
  now?: Date;
  proposalId?: string;
}

function allEvidence(proposal: z.infer<typeof RefinementProposalPayloadSchema>): EvidenceCitation[] {
  return [
    ...proposal.evidence,
    ...proposal.contradictions.flatMap(contradiction => contradiction.evidence),
  ];
}

async function assertOperationMatchesTarget(
  root: string,
  proposal: z.infer<typeof RefinementProposalPayloadSchema>,
): Promise<void> {
  const targetPath = join(root, proposal.target_path);
  let current: string | undefined;
  try {
    await assertRealPathWithinRoot(root, targetPath, 'Proposal target');
    current = await readFile(targetPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (proposal.operation === 'create') {
    if (current !== undefined) {
      throw new Error(`Create proposal target already exists: ${proposal.target_path}`);
    }
    return;
  }

  if (current === undefined) {
    throw new Error(`${proposal.operation} proposal target does not exist: ${proposal.target_path}`);
  }
  const actual = sha256Text(normalizeText(current));
  if (actual !== proposal.base_content_sha256) {
    throw new Error(
      `Base content hash mismatch for ${proposal.target_path}: expected ${proposal.base_content_sha256}, got ${actual}`,
    );
  }
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
  options: StageProposalOptions = {},
): Promise<StagedProposalResult> {
  const payload = RefinementProposalPayloadSchema.parse(unknownProposal);

  for (const citation of allEvidence(payload)) {
    const error = await validateEvidenceCitation(root, citation);
    if (error !== null) {
      throw new Error(
        `Evidence citation failed: ${error.source_path} (${error.failed_field}): ${error.message}`,
      );
    }
  }
  await assertOperationMatchesTarget(root, payload);

  const proposal = RefinementProposalSchema.parse({
    ...payload,
    proposal_id: options.proposalId ?? randomUUID(),
    staged_at: (options.now ?? new Date()).toISOString(),
    state: 'staged',
  });

  const proposalsDir = join(root, '.ziggurat', 'proposals');
  await mkdir(proposalsDir, { recursive: true });
  await assertRealPathWithinRoot(root, proposalsDir, 'Proposal directory');

  const finalPath = join(proposalsDir, `${proposal.proposal_id}.json`);
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

  return { path: finalPath, proposal };
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
        'Return a JSON object matching the RefinementProposalPayload schema version 2. ' +
        'Include a complete candidate, exact Bronze evidence, structured contradictions, ' +
        'confidence, affected paths, related paths, and unresolved questions. Never include ' +
        'status, reviewed_by, reviewed_at, authorization, or other admission metadata.',
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
  return (await stageProposal(input.root, raw)).proposal;
}
