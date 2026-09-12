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
import { buildBronzeReference, buildRefineMessages } from './context.js';
import type { StructuredChatAdapter, ChatMessage } from './adapter.js';
import type { z } from 'zod';
import { assertRealPathWithinRoot } from '../fs/boundary.js';
import { materializeDraft, readTargetSnapshot } from './materialize.js';
import type { BronzeReference } from './context.js';
import { RefinementError } from './errors.js';

export type { StructuredChatAdapter, ChatMessage } from './adapter.js';

export interface RefinementInput {
  /** Absolute path to the vault root, used for evidence validation and staging. */
  root: string;
  topic: string;
  target_path?: string | undefined;
  bronze_source_paths?: readonly string[] | undefined;
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
      throw new RefinementError('target-changed', `Create proposal target already exists: ${proposal.target_path}`);
    }
    return;
  }

  if (current === undefined) {
    throw new RefinementError('target-changed', `${proposal.operation} proposal target does not exist: ${proposal.target_path}`);
  }
  const actual = sha256Text(normalizeText(current));
  if (actual !== proposal.base_content_sha256) {
    throw new RefinementError('target-changed',
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
    try {
      const error = await validateEvidenceCitation(root, citation);
      if (error !== null) {
        throw new RefinementError(
          'evidence-changed',
          `Evidence citation failed: ${error.source_path} (${error.failed_field}): ${error.message}`,
        );
      }
    } catch (error) {
      if (error instanceof RefinementError) throw error;
      throw new RefinementError('evidence-changed', 'Evidence citation failed: stored Bronze is no longer verifiable.');
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
 * Both the CLI and library use this host-controlled draft-to-Silver boundary.
 */
export async function executeRefinement(
  adapter: StructuredChatAdapter,
  input: RefinementInput,
  options: { onReference?: (reference: BronzeReference) => void } = {},
): Promise<StagedProposalResult & { reference: BronzeReference }> {
  const reference = await buildBronzeReference(input.root, {
    sourcePaths: input.bronze_source_paths,
  });
  options.onReference?.(reference);
  if (reference.sources.length === 0) {
    throw new RefinementError(
      'no-evidence',
      'No Bronze evidence is available for this request. Check source selection, privacy policy, integrity, and reference limits.',
    );
  }
  const target = input.target_path === undefined
    ? undefined
    : await readTargetSnapshot(input.root, input.target_path);
  if (input.existing_content !== undefined
    && (target?.content === undefined
      || normalizeText(input.existing_content) !== normalizeText(target.content))) {
    throw new RefinementError('target-context', 'Supplied existing content does not match the host-read target.');
  }
  const messages: ChatMessage[] = buildRefineMessages(
    {
      topic: input.topic,
      target_path: input.target_path,
      existing_content: target?.content,
    },
    reference,
  );

  const raw = await adapter.completeJson(messages);
  const payload = materializeDraft(raw, reference, target);
  return { ...await stageProposal(input.root, payload), reference };
}

export async function requestRefinement(
  adapter: StructuredChatAdapter,
  input: RefinementInput,
): Promise<RefinementProposal> {
  return (await executeRefinement(adapter, input)).proposal;
}
