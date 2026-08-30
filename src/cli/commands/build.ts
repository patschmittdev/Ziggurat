import type { CliIO } from '../main.js';
import { buildGoldIndex } from '../../retrieval/gold-index.js';
import { buildReviewIndex, buildEvidenceIndex } from '../../retrieval/profile-index.js';
import { collectBronzeFiles, collectCuratedPages } from '../../corpus/collect.js';
import { collectStagedProposals } from '../../refine/store.js';
import { parseZigguratConfig } from '../../contracts/config.js';

export async function runBuild(root: string, json: boolean, io: CliIO): Promise<number> {
  const curated = await collectCuratedPages(root);
  const bronze = await collectBronzeFiles(root);
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
  };

  if (json) {
    io.stdout(JSON.stringify(result, null, 2) + '\n');
  } else {
    io.stdout(`Built indexes:\n  Gold: ${result.gold_chunks} chunks\n  Review: ${result.review_chunks} chunks\n  Evidence: ${result.evidence_chunks} chunks\n  Fingerprint: ${result.corpus_fingerprint.slice(0, 16)}...\n`);
  }
  return 0;
}
