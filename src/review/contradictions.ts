import {
  collectStagedProposals,
  ProposalStoreError,
} from '../refine/store.js';
import type { StagedProposalRecord } from '../refine/store.js';

export { ProposalStoreError } from '../refine/store.js';

export interface UnresolvedContradiction {
  artifact_path: string;
  proposal_id: string;
  target_path: string;
  summaries: string[];
}

export class ContradictionScanError extends ProposalStoreError {
  constructor(message: string) {
    super(message);
    this.name = 'ContradictionScanError';
  }
}

export type ContradictionIndex = ReadonlyMap<string, readonly StagedProposalRecord[]>;

export function buildContradictionIndex(
  proposals: readonly StagedProposalRecord[],
): ContradictionIndex {
  const byTarget = new Map<string, StagedProposalRecord[]>();
  for (const record of proposals) {
    if (record.proposal.operation !== 'contradict') continue;
    const records = byTarget.get(record.proposal.target_path) ?? [];
    records.push(record);
    byTarget.set(record.proposal.target_path, records);
  }
  return byTarget;
}

export function unresolvedContradictionsFromIndex(
  index: ContradictionIndex,
  targetPath: string,
  resolvedProposalIds: readonly string[] = [],
): UnresolvedContradiction[] {
  const resolved = new Set(resolvedProposalIds);
  return (index.get(targetPath) ?? [])
    .filter(record => !resolved.has(record.proposal.proposal_id))
    .map(record => ({
      artifact_path: record.artifact_path,
      proposal_id: record.proposal.proposal_id,
      target_path: targetPath,
      summaries: record.proposal.contradictions.map(contradiction => contradiction.summary),
    }));
}

/**
 * Contradiction proposals are immutable. A proposal is resolved only when its ID is
 * listed in the separately authorized curated page.
 */
export async function collectUnresolvedContradictions(
  root: string,
  targetPath: string,
  resolvedProposalIds: readonly string[] = [],
): Promise<UnresolvedContradiction[]> {
  try {
    return unresolvedContradictionsFromIndex(
      buildContradictionIndex(await collectStagedProposals(root)),
      targetPath,
      resolvedProposalIds,
    );
  } catch (error) {
    if (error instanceof ProposalStoreError) {
      throw new ContradictionScanError(error.message);
    }
    throw error;
  }
}
