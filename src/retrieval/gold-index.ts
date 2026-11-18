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
import { createGoldEligibilityContext, goldEligibilityReport } from '../review/eligibility.js';
import type { EligibilityReport } from '../review/eligibility.js';
import type { BronzeInput, CorpusRejection } from '../corpus/collect.js';
import { mapCorpusReads } from '../corpus/read-pool.js';
import { buildBm25 } from './bm25.js';
import { makeGoldChunk } from './chunks.js';
import {
  indexCorpusFingerprint,
  trustPolicyFingerprint,
} from './integrity.js';
import { writeIndexAtomic } from './store.js';
import { compareCodeUnits } from '../order.js';
import {
  collectStagedProposals,
} from '../refine/store.js';
import type { StagedProposalRecord } from '../refine/store.js';
import { buildContradictionIndex } from '../review/contradictions.js';
import { createVerifiedBronzeReader } from '../refine/evidence.js';
import type { VerifiedBronzeReader } from '../refine/evidence.js';

export interface GoldPageInput {
  path: string;
  page: CuratedPage;
  pageBody: string;
}

export interface BuildGoldIndexOptions {
  asOf?: Date;
  config?: ZigguratConfig;
  proposals?: StagedProposalRecord[];
  bronze?: BronzeInput[];
  bronzeRejections?: CorpusRejection[];
  bronzeReader?: VerifiedBronzeReader;
  /** Reuse only within the build operation that collected this decision. */
  gold?: EligibleGoldCollection;
}

export interface GoldPageDecision {
  path: string;
  eligible: boolean;
  reasons: string[];
  reason_details: EligibilityReport['reason_details'];
}

export interface EligibleGoldCollection {
  chunks: GoldChunk[];
  config: ZigguratConfig;
  asOf: Date;
  decisions: GoldPageDecision[];
}

export async function collectEligibleGoldChunks(
  root: string,
  candidates: GoldPageInput[],
  options: BuildGoldIndexOptions = {},
): Promise<EligibleGoldCollection> {
  const asOf = options.asOf ?? new Date();
  const config = options.config ?? await parseZigguratConfig(root);
  const bronzeReader = options.bronzeReader ?? createVerifiedBronzeReader(root);
  const proposals = options.proposals ?? await collectStagedProposals(root, { bronzeReader });
  const contradictions = buildContradictionIndex(proposals);
  const context = createGoldEligibilityContext(
    options.bronze, options.bronzeRejections,
    options.bronzeReader ?? (options.bronze === undefined ? bronzeReader : undefined),
  );
  const chunks: GoldChunk[] = [];
  const decisions: GoldPageDecision[] = [];
  await mapCorpusReads(candidates, async ({ path, page, pageBody }) => {
    const report = await goldEligibilityReport(
      root,
      path,
      page,
      pageBody,
      asOf,
      config,
      contradictions,
      context,
    );
    decisions.push({
      path, eligible: report.eligible, reasons: report.reasons, reason_details: report.reason_details,
    });
    if (!report.eligible || report.authorization === undefined) return;
    chunks.push(makeGoldChunk(
      path,
      page,
      pageBody,
      report.verified_bronze_lineage,
      report.authorization,
    ));
  });
  chunks.sort((left, right) => compareCodeUnits(left.path, right.path));
  decisions.sort((left, right) => compareCodeUnits(left.path, right.path));
  return { chunks, config, asOf, decisions };
}

export async function buildGoldIndex(
  root: string,
  candidates: GoldPageInput[],
  options: BuildGoldIndexOptions = {},
): Promise<GoldIndex> {
  const { chunks, config, asOf } = options.gold
    ?? await collectEligibleGoldChunks(root, candidates, options);
  const policy_fingerprint = trustPolicyFingerprint(config);
  const index: GoldIndex = {
    version: 2,
    profile: 'gold',
    retrieval_mode: 'bm25',
    built_at: asOf.toISOString(),
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
