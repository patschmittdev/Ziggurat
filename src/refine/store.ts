import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Text } from '../bronze/canonical.js';
import { RefinementProposalSchema } from '../contracts/index.js';
import type { RefinementProposal } from '../contracts/index.js';
import { assertRealPathWithinRoot } from '../fs/boundary.js';
import { createVerifiedBronzeReader, validateEvidenceCitation } from './evidence.js';
import type { VerifiedBronzeReader } from './evidence.js';
import { compareCodeUnits } from '../order.js';
import { mapCorpusReads } from '../corpus/read-pool.js';

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

export interface CollectStagedProposalsOptions {
  /** Share only with other verification steps in this same request and vault. */
  bronzeReader?: VerifiedBronzeReader;
}

export async function collectStagedProposals(
  root: string,
  options: CollectStagedProposalsOptions = {},
): Promise<StagedProposalRecord[]> {
  const bronzeReader = options.bronzeReader ?? createVerifiedBronzeReader(root);
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

  return mapCorpusReads(
    entries.filter(entry => entry.name.endsWith('.json'))
      .sort((left, right) => compareCodeUnits(left.name, right.name)),
    async entry => {
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
          const error = await validateEvidenceCitation(root, citation, bronzeReader);
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
      return {
        artifact_path: `.ziggurat/proposals/${entry.name}`,
        artifact_sha256: sha256Text(JSON.stringify(result.data)),
        proposal: result.data,
      };
    },
  );
}
