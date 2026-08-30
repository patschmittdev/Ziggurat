import type { CliIO } from '../main.js';
import { buildGoldIndex } from '../../retrieval/gold-index.js';
import { buildReviewIndex, buildEvidenceIndex } from '../../retrieval/profile-index.js';
import { collectBronzeFilesDetailed, collectCuratedPagesDetailed } from '../../corpus/collect.js';
import type { CorpusRejection } from '../../corpus/collect.js';
import { collectStagedProposals } from '../../refine/store.js';
import { parseZigguratConfig } from '../../contracts/config.js';
import { inertSingleLineText } from '../../presentation/inert.js';

export async function runBuild(root: string, json: boolean, io: CliIO): Promise<number> {
  const curatedCollection = await collectCuratedPagesDetailed(root);
  const bronzeCollection = await collectBronzeFilesDetailed(root);
  const curated = curatedCollection.pages;
  const bronze = bronzeCollection.records;
  const rejected: CorpusRejection[] = [
    ...curatedCollection.rejected,
    ...bronzeCollection.rejected,
  ];
  const proposals = await collectStagedProposals(root);
  const config = await parseZigguratConfig(root);
  const asOf = new Date();

  const goldIndex = await buildGoldIndex(root, curated, { asOf, config, proposals });
  const reviewIndex = await buildReviewIndex(root, {
    curated,
    bronze,
    proposals,
    config,
    asOf,
  });
  const evidenceIndex = await buildEvidenceIndex(root, {
    curated,
    bronze,
    proposals,
    config,
    asOf,
  });

  const result = {
    gold_chunks: goldIndex.chunks.length,
    review_chunks: reviewIndex.chunks.length,
    evidence_chunks: evidenceIndex.chunks.length,
    corpus_fingerprint: goldIndex.corpus_fingerprint,
    rejected_corpus_entries: rejected,
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
  return 0;
}
