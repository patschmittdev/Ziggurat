import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccessProfile } from '../contracts/index.js';
import type { ZigguratConfig } from '../contracts/config.js';
import { parseZigguratConfig } from '../contracts/config.js';
import type {
  ProfileChunk,
  ProfileIndex,
  SearchResult,
} from '../contracts/gold-index.js';
import { ProfileIndexSchema } from '../contracts/gold-index.js';
import type { CuratedInput, BronzeInput } from '../corpus/collect.js';
import { piiBlocksModelAccess } from '../policy/privacy.js';
import type { StagedProposalRecord } from '../refine/store.js';
import { buildBm25, bm25Search } from './bm25.js';
import { makeProfileChunk } from './chunks.js';
import { collectEligibleGoldChunks } from './gold-index.js';
import {
  indexCorpusFingerprint,
  trustPolicyFingerprint,
} from './integrity.js';
import { writeIndexAtomic } from './store.js';
import { compareCodeUnits } from '../order.js';

export type { CuratedInput, BronzeInput } from '../corpus/collect.js';

export function bronzeBlockedFromModelAccess(record: BronzeInput): boolean {
  return piiBlocksModelAccess(record.pii as never)
    || record.sensitivity === 'restricted'
    || !record.hashVerified;
}

export interface BuildProfileIndexInput {
  curated: CuratedInput[];
  bronze: BronzeInput[];
  proposals?: StagedProposalRecord[];
  config?: ZigguratConfig;
  asOf?: Date;
}

function goldProfileChunk(
  profile: 'review' | 'evidence',
  chunk: Awaited<ReturnType<typeof collectEligibleGoldChunks>>['chunks'][number],
): ProfileChunk {
  return makeProfileChunk(
    chunk.path,
    chunk.heading,
    chunk.body,
    'gold',
    'reviewed',
    profile,
    {
      kind: 'authorization',
      receipt_path: chunk.authorization.receipt_path,
      receipt_sha256: chunk.authorization.receipt_sha256,
      reviewer_id: chunk.authorization.reviewer_id,
      key_id: chunk.authorization.key_id,
      bronze_lineage: chunk.bronze_lineage,
    },
  );
}

export async function collectReviewChunks(
  root: string,
  input: BuildProfileIndexInput,
): Promise<{ chunks: ProfileChunk[]; config: ZigguratConfig }> {
  const config = input.config ?? await parseZigguratConfig(root);
  const chunks: ProfileChunk[] = [];
  const bronzeByPath = new Map(input.bronze.map(record => [record.path, record]));
  for (const record of input.proposals ?? []) {
    const candidate = record.proposal.candidate;
    if (piiBlocksModelAccess(candidate.pii)) continue;
    const sourcesAreModelReadable = candidate.sources.every(path => {
      const source = bronzeByPath.get(path);
      return source !== undefined && !bronzeBlockedFromModelAccess(source);
    });
    if (!sourcesAreModelReadable) continue;
    chunks.push(makeProfileChunk(
      record.artifact_path,
      candidate.title,
      candidate.body,
      'silver',
      'staged',
      'review',
      {
        kind: 'proposal',
        proposal_id: record.proposal.proposal_id,
        artifact_path: record.artifact_path,
        artifact_sha256: record.artifact_sha256,
      },
    ));
  }
  const gold = await collectEligibleGoldChunks(root, input.curated, {
    config,
    ...(input.proposals === undefined ? {} : { proposals: input.proposals }),
    ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
  });
  chunks.push(...gold.chunks.map(chunk => goldProfileChunk('review', chunk)));
  chunks.sort((left, right) => compareCodeUnits(left.path, right.path));
  return { chunks, config };
}

export async function collectEvidenceChunks(
  root: string,
  input: BuildProfileIndexInput,
): Promise<{ chunks: ProfileChunk[]; config: ZigguratConfig }> {
  const config = input.config ?? await parseZigguratConfig(root);
  const chunks: ProfileChunk[] = [];
  for (const record of input.bronze) {
    if (bronzeBlockedFromModelAccess(record)) continue;
    chunks.push(makeProfileChunk(
      record.path,
      record.path,
      record.body,
      'bronze',
      'bronze',
      'evidence',
      { kind: 'bronze', body_sha256: record.sha256 },
    ));
  }
  const gold = await collectEligibleGoldChunks(root, input.curated, {
    config,
    ...(input.proposals === undefined ? {} : { proposals: input.proposals }),
    ...(input.asOf === undefined ? {} : { asOf: input.asOf }),
  });
  chunks.push(...gold.chunks.map(chunk => goldProfileChunk('evidence', chunk)));
  chunks.sort((left, right) => compareCodeUnits(left.path, right.path));
  return { chunks, config };
}

export async function buildReviewIndex(
  root: string,
  input: BuildProfileIndexInput,
): Promise<ProfileIndex> {
  const { chunks, config } = await collectReviewChunks(root, input);
  return buildAndWriteProfileIndex(root, 'review', chunks, config, 'review-index.json');
}

export async function buildEvidenceIndex(
  root: string,
  input: BuildProfileIndexInput,
): Promise<ProfileIndex> {
  const { chunks, config } = await collectEvidenceChunks(root, input);
  return buildAndWriteProfileIndex(root, 'evidence', chunks, config, 'evidence-index.json');
}

async function buildAndWriteProfileIndex(
  root: string,
  profile: 'review' | 'evidence',
  chunks: ProfileChunk[],
  config: ZigguratConfig,
  filename: string,
): Promise<ProfileIndex> {
  const policy_fingerprint = trustPolicyFingerprint(config);
  const index: ProfileIndex = {
    version: 2,
    profile,
    retrieval_mode: 'bm25',
    built_at: new Date().toISOString(),
    corpus_fingerprint: indexCorpusFingerprint(profile, chunks, policy_fingerprint),
    policy_fingerprint,
    chunks,
    bm25: buildBm25(chunks.map(chunk => ({
      id: chunk.id,
      text: `${chunk.heading} ${chunk.body}`,
    }))),
  };
  await writeIndexAtomic(root, filename, ProfileIndexSchema.parse(index));
  return index;
}

export async function loadProfileIndex(
  root: string,
  profile: Exclude<AccessProfile, 'gold'>,
): Promise<ProfileIndex> {
  const filename = profile === 'review' ? 'review-index.json' : 'evidence-index.json';
  const text = await readFile(join(root, '.ziggurat', filename), 'utf8');
  return ProfileIndexSchema.parse(JSON.parse(text));
}

export function searchProfileIndex(index: ProfileIndex, query: string): SearchResult[] {
  const ranked = bm25Search(query, index.bm25);
  const chunkMap = new Map(index.chunks.map(chunk => [chunk.id, chunk]));
  return ranked.flatMap(({ id, score }) => {
    const chunk = chunkMap.get(id);
    return chunk === undefined ? [] : [{
      chunk_id: id,
      path: chunk.path,
      heading: chunk.heading,
      score,
      tier: chunk.tier,
      profile: chunk.profile,
      status: chunk.status,
      body: chunk.body,
      content_role: chunk.content_role,
      instruction_authority: chunk.instruction_authority,
    }];
  });
}
