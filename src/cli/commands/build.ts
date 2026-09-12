import type { CliIO } from '../main.js';
import { buildGoldIndex, collectEligibleGoldChunks } from '../../retrieval/gold-index.js';
import { buildReviewIndex, buildEvidenceIndex } from '../../retrieval/profile-index.js';
import { collectBronzeFilesDetailed, collectCuratedPagesDetailed } from '../../corpus/collect.js';
import type { CorpusRejection } from '../../corpus/collect.js';
import { collectStagedProposals } from '../../refine/store.js';
import { parseZigguratConfig } from '../../contracts/config.js';
import { inertSingleLineText } from '../../presentation/inert.js';
import { createVerifiedBronzeReader } from '../../refine/evidence.js';

export async function runBuild(root: string, json: boolean, io: CliIO): Promise<number> {
  const asOf = new Date();
  const config = await parseZigguratConfig(root);
  const curatedCollection = await collectCuratedPagesDetailed(root);
  const bronzeCollection = await collectBronzeFilesDetailed(root);
  const curated = curatedCollection.pages;
  const bronze = bronzeCollection.records;
  const rejected: CorpusRejection[] = [
    ...curatedCollection.rejected,
    ...bronzeCollection.rejected,
  ];
  const bronzeReader = createVerifiedBronzeReader(root);
  const proposals = await collectStagedProposals(root, { bronzeReader });
  const gold = await collectEligibleGoldChunks(root, curated, {
    asOf, config, proposals, bronze, bronzeRejections: bronzeCollection.rejected, bronzeReader,
  });
  const goldIndex = await buildGoldIndex(root, curated, { gold });
  const reviewIndex = await buildReviewIndex(root, {
    curated,
    bronze,
    proposals,
    config,
    asOf,
    gold,
  });
  const evidenceIndex = await buildEvidenceIndex(root, {
    curated,
    bronze,
    proposals,
    config,
    asOf,
    gold,
  });

  const result = {
    gold_chunks: goldIndex.chunks.length,
    review_chunks: reviewIndex.chunks.length,
    evidence_chunks: evidenceIndex.chunks.length,
    corpus_fingerprint: goldIndex.corpus_fingerprint,
    rejected_corpus_entries: rejected,
    gold_decisions: gold.decisions,
  };

  if (json) {
    io.stdout(JSON.stringify(result, null, 2) + '\n');
  } else {
    io.stdout(`Built indexes:\n  Gold: ${result.gold_chunks} chunks\n  Review: ${result.review_chunks} chunks\n  Evidence: ${result.evidence_chunks} chunks\n  Fingerprint: ${result.corpus_fingerprint.slice(0, 16)}...\n`);
  }

  // Rejected entries are never admitted, but staying silent about them makes a broken
  // page indistinguishable from an absent one. Report the path and the structural
  // reason on stderr; never the content that failed.
  if (rejected.length > 0) {
    io.stderr(`warning: ${rejected.length} corpus entr${rejected.length === 1 ? 'y was' : 'ies were'} rejected and not indexed:\n`);
    for (const entry of rejected) {
      io.stderr(`  ${inertSingleLineText(entry.path)} [${entry.reason}]: ${inertSingleLineText(entry.detail)}\n`);
    }
  }
  for (const decision of gold.decisions) {
    if (decision.eligible) continue;
    io.stderr(`Gold excluded: ${inertSingleLineText(decision.path)}\n`);
    for (const reason of decision.reason_details) {
      io.stderr(`  [${reason.code}] ${inertSingleLineText(reason.message)}${reason.path === decision.path ? '' : ` (${inertSingleLineText(reason.path ?? '')})`}\n`);
    }
  }
  return 0;
}
