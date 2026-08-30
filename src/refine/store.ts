import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Text } from '../bronze/canonical.js';
import { RefinementProposalSchema } from '../contracts/index.js';
import type { RefinementProposal } from '../contracts/index.js';
import { assertRealPathWithinRoot } from '../fs/boundary.js';
import { validateEvidenceCitation } from './evidence.js';
import { compareCodeUnits } from '../order.js';

export interface StagedProposalRecord {
  artifact_path: string;
  artifact_sha256: string;
  proposal: RefinementProposal;
}

export class ProposalStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalStoreError';
  }
}

function isMissingDirectory(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export async function collectStagedProposals(root: string): Promise<StagedProposalRecord[]> {
  const proposalsDir = join(root, '.ziggurat', 'proposals');
  let entries: import('node:fs').Dirent[];
  try {
    await assertRealPathWithinRoot(root, proposalsDir, 'Proposal directory');
    entries = await readdir(proposalsDir, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectory(error)) return [];
    throw new ProposalStoreError(
      `Cannot read proposal directory ${proposalsDir}; Silver state is unknown.`,
    );
  }

  const records: StagedProposalRecord[] = [];
  for (const entry of entries.sort((left, right) => compareCodeUnits(left.name, right.name))) {
    if (!entry.name.endsWith('.json')) continue;
    if (!entry.isFile()) {
      throw new ProposalStoreError(
        `Proposal artifact ${entry.name} is not a regular file; Silver state is unknown.`,
      );
    }

    const artifactPath = join(proposalsDir, entry.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(artifactPath, 'utf8')) as unknown;
    } catch {
      throw new ProposalStoreError(
        `Proposal artifact ${artifactPath} is unreadable or invalid JSON; Silver state is unknown.`,
      );
    }

    const result = RefinementProposalSchema.safeParse(parsed);
    if (!result.success) {
      throw new ProposalStoreError(
        `Proposal artifact ${artifactPath} failed schema validation; Silver state is unknown.`,
      );
    }
    if (entry.name !== `${result.data.proposal_id}.json`) {
      throw new ProposalStoreError(
        `Proposal artifact ${artifactPath} filename does not match proposal_id; Silver state is unknown.`,
      );
    }
    const citations = [
      ...result.data.evidence,
      ...result.data.contradictions.flatMap(contradiction => contradiction.evidence),
    ];
    for (const citation of citations) {
      try {
        const error = await validateEvidenceCitation(root, citation);
        if (error !== null) {
          throw new ProposalStoreError(
            `Proposal artifact ${artifactPath} has invalid evidence at ${error.source_path}: ${error.message}`,
          );
        }
      } catch (error) {
        if (error instanceof ProposalStoreError) throw error;
        throw new ProposalStoreError(
          `Proposal artifact ${artifactPath} evidence is unverifiable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    records.push({
      artifact_path: `.ziggurat/proposals/${entry.name}`,
      artifact_sha256: sha256Text(JSON.stringify(result.data)),
      proposal: result.data,
    });
  }
  return records;
}
