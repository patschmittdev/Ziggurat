import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CuratedPage } from '../contracts/index.js';
import type { ZigguratConfig } from '../contracts/config.js';
import { parseZigguratConfig } from '../contracts/config.js';
import type {
  GoldChunk,
  GoldIndex,
} from '../contracts/gold-index.js';
import { GoldIndexSchema } from '../contracts/gold-index.js';
import { goldEligibilityReport } from '../review/eligibility.js';
import { buildBm25 } from './bm25.js';
import { makeGoldChunk } from './chunks.js';
import {
  indexCorpusFingerprint,
  trustPolicyFingerprint,
} from './integrity.js';
import { writeIndexAtomic } from './store.js';
import { parseBronzeRecord } from '../bronze/store.js';
import { canonicalBronzeBody } from '../bronze/canonical.js';
import { compareCodeUnits } from '../order.js';
import { resolveBronzeSourcePath } from '../refine/evidence.js';
import {
  collectStagedProposals,
} from '../refine/store.js';
import type { StagedProposalRecord } from '../refine/store.js';
import { buildContradictionIndex } from '../review/contradictions.js';

export interface GoldPageInput {
  path: string;
  page: CuratedPage;
  pageBody: string;
}

export interface BuildGoldIndexOptions {
  asOf?: Date;
  config?: ZigguratConfig;
  proposals?: StagedProposalRecord[];
}

async function bronzeLineage(
  root: string,
  paths: string[],
): Promise<Array<{ path: string; sha256: string }>> {
  const lineage: Array<{ path: string; sha256: string }> = [];
  for (const path of paths) {
    const content = canonicalBronzeBody(
      await readFile(await resolveBronzeSourcePath(root, path), 'utf8'),
    );
    lineage.push({ path, sha256: parseBronzeRecord(content).sha256 });
  }
  return lineage;
}

export async function collectEligibleGoldChunks(
  root: string,
  candidates: GoldPageInput[],
  options: BuildGoldIndexOptions = {},
): Promise<{ chunks: GoldChunk[]; config: ZigguratConfig }> {
  const asOf = options.asOf ?? new Date();
  const config = options.config ?? await parseZigguratConfig(root);
  const proposals = options.proposals ?? await collectStagedProposals(root);
  const contradictions = buildContradictionIndex(proposals);
  const chunks: GoldChunk[] = [];
  for (const { path, page, pageBody } of candidates) {
    const report = await goldEligibilityReport(
      root,
      path,
      page,
      pageBody,
      asOf,
      config,
      contradictions,
    );
    if (!report.eligible || report.authorization === undefined) continue;
    chunks.push(makeGoldChunk(
      path,
      page,
      pageBody,
      await bronzeLineage(root, report.bronze_lineage),
      report.authorization,
    ));
  }
  chunks.sort((left, right) => compareCodeUnits(left.path, right.path));
  return { chunks, config };
}

export async function buildGoldIndex(
  root: string,
  candidates: GoldPageInput[],
  options: BuildGoldIndexOptions = {},
): Promise<GoldIndex> {
  const { chunks, config } = await collectEligibleGoldChunks(root, candidates, options);
  const policy_fingerprint = trustPolicyFingerprint(config);
  const index: GoldIndex = {
    version: 2,
    profile: 'gold',
    retrieval_mode: 'bm25',
    built_at: (options.asOf ?? new Date()).toISOString(),
    corpus_fingerprint: indexCorpusFingerprint('gold', chunks, policy_fingerprint),
    policy_fingerprint,
    chunks,
    bm25: buildBm25(chunks.map(chunk => ({
      id: chunk.id,
      text: `${chunk.heading} ${chunk.body}`,
    }))),
  };
  await writeIndexAtomic(root, 'gold-index.json', GoldIndexSchema.parse(index));
  return index;
}

export async function loadGoldIndex(root: string): Promise<GoldIndex> {
  const text = await readFile(join(root, '.ziggurat', 'gold-index.json'), 'utf8');
  return GoldIndexSchema.parse(JSON.parse(text));
}

export interface FreshnessCheck {
  fresh: boolean;
  reason?: string;
}

export async function checkIndexFreshness(
  root: string,
  candidates: GoldPageInput[],
  options: BuildGoldIndexOptions = {},
): Promise<FreshnessCheck> {
  let index: GoldIndex;
  try {
    index = await loadGoldIndex(root);
  } catch {
    return { fresh: false, reason: 'index not found or unreadable' };
  }
  const { chunks, config } = await collectEligibleGoldChunks(root, candidates, options);
  const expected = indexCorpusFingerprint(
    'gold',
    chunks,
    trustPolicyFingerprint(config),
  );
  return expected === index.corpus_fingerprint
    ? { fresh: true }
    : { fresh: false, reason: 'corpus fingerprint mismatch' };
}
