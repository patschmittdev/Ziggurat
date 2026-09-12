import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as YAML from 'yaml';
import { runInit } from '../../src/cli/commands/init.js';
import { sha256Text } from '../../src/bronze/canonical.js';
import { serializeBronzeFile } from '../../src/bronze/store.js';
import type { CuratedPage } from '../../src/contracts/index.js';
import { stageProposal } from '../../src/refine/proposal.js';
import { authorizeTestPage, createTestReviewer } from './authorization.js';

export async function createOperatingVault(
  root: string,
  pages: number,
  options: { reviewAfter?: string } = {},
): Promise<{
  bronze: number;
  proposals: number;
  canonical_bytes: number;
}> {
  await runInit(root, { stdout() {}, stderr(text) { throw new Error(text); } });
  await mkdir(join(root, 'bronze', 'article'), { recursive: true });
  const reviewer = createTestReviewer('envelope-reviewer', 'envelope-key');
  const now = new Date(Date.now() - 60_000).toISOString();
  await writeFile(join(root, 'config', 'trust.yaml'), YAML.stringify({
    trust: { reviewers: [{
      reviewer_id: reviewer.reviewerId,
      key_id: reviewer.keyId,
      algorithm: 'ed25519',
      public_key_pem: reviewer.publicKeyPem,
    }] },
  }));
  let canonicalBytes = 0;
  const bronze: Array<{ path: string; sha256: string; quote: string }> = [];
  for (let start = 0; start < pages * 5; start += 32) {
    await Promise.all(Array.from({ length: Math.min(32, pages * 5 - start) }, async (_, offset) => {
      const index = start + offset;
      const id = String(index).padStart(6, '0');
      const quote = `Measured envelope fact ${id} is supported by this synthetic record.`;
      const prefix = `# Synthetic evidence ${id}\n${quote}\n`;
      const body = prefix + 'background observation '.repeat(Math.ceil((19_000 - prefix.length) / 23))
        .slice(0, 19_000 - prefix.length - 1) + '\n';
      const record = { path: `bronze/article/source-${id}.md`, sha256: sha256Text(body), quote };
      bronze[index] = record;
      canonicalBytes += Buffer.byteLength(body);
      await writeFile(join(root, record.path), serializeBronzeFile({
        schema_version: 1, source_id: `source-${id}`, source_kind: 'article',
        captured_at: now, sha256: record.sha256, sensitivity: 'public', pii: 'false',
      }, body));
    }));
  }
  for (let start = 0; start < pages; start += 16) {
    await Promise.all(Array.from({ length: Math.min(16, pages - start) }, async (_, offset) => {
      const index = start + offset;
      const source = bronze[index];
      if (source === undefined) throw new Error('Missing benchmark evidence');
      const id = String(index).padStart(6, '0');
      const title = `Measured envelope concept ${id}`;
      const prefix = `# ${title}\n${source.quote}\n`;
      const body = prefix + 'synthetic operating context '.repeat(200).slice(0, 4_000 - prefix.length - 1) + '\n';
      canonicalBytes += Buffer.byteLength(body);
      const page: CuratedPage = {
        schema_version: 1, title, type: 'concept', sources: [source.path],
        confidence: 'high', status: 'reviewed', retrieval_eligible: true,
        pii: 'false', sensitivity: 'public', visibility: 'internal', egress: 'approved-cloud',
        reviewed_by: reviewer.reviewerId, reviewed_at: now, last_verified: now, resolved_proposals: [],
        ...(options.reviewAfter === undefined ? {} : { review_after: options.reviewAfter }),
      };
      const target = `knowledge/concept-${id}.md`;
      await writeFile(join(root, target), `---\n${YAML.stringify(page)}---\n${body}`);
      await authorizeTestPage(root, target, page, body, reviewer);
      await stageProposal(root, {
        schema_version: 2, operation: 'create', target_path: `knowledge/proposed-${id}.md`,
        candidate: {
          schema_version: 1, title, type: 'concept', sources: [source.path],
          confidence: 'medium', retrieval_eligible: false, pii: 'false',
          sensitivity: 'public', visibility: 'internal', egress: 'local-only',
          body: `# Proposed ${id}\n${source.quote}\n`,
        },
        evidence: [{
          source_path: source.path, body_sha256: source.sha256, line_start: 2, line_end: 2,
          quote: source.quote, quote_sha256: sha256Text(source.quote),
        }],
        contradictions: [], confidence: 'medium', affected_paths: [], related_paths: [], unresolved_questions: [],
      });
    }));
  }
  return { bronze: bronze.length, proposals: pages, canonical_bytes: canonicalBytes };
}
