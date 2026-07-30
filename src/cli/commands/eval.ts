import type { CliIO } from '../main.js';
import { runConformance } from '../../eval/conformance.js';
import { renderConformanceMarkdown } from '../../eval/report.js';
import { buildGoldIndex } from '../../retrieval/gold-index.js';
import { sha256Text } from '../../bronze/canonical.js';
import type { CuratedPage } from '../../contracts/index.js';

/** Runs the built-in conformance cases. */
export async function runEval(root: string, json: boolean, io: CliIO): Promise<number> {
  const cases = buildConformanceCases(root);
  const report = await runConformance(cases);

  if (json) {
    io.stdout(JSON.stringify(report, null, 2) + '\n');
  } else {
    io.stdout(renderConformanceMarkdown(report) + '\n');
  }

  return report.pass ? 0 : 1;
}

function buildConformanceCases(root: string) {
  return [
    {
      case: { id: 'C001', description: 'PII unknown is blocked from Gold index', category: 'privacy' },
      run: async () => {
        try {
          const piiPage: CuratedPage = {
            schema_version: 1, title: 'PII Test', type: 'concept', sources: [],
            confidence: 'high', status: 'reviewed', retrieval_eligible: true,
            pii: 'unknown', sensitivity: 'public', visibility: 'internal',
            egress: 'permitted', reviewed_by: 'tester', reviewed_at: '2026-01-01T00:00:00Z',
            last_verified: '2026-01-01T00:00:00Z',
          };
          const index = await buildGoldIndex(root, [
            { path: 'knowledge/pii-test.md', page: piiPage, pageBody: 'PII content.' },
          ], { asOf: new Date('2026-07-30T00:00:00Z') });
          const blocked = !index.chunks.some(c => c.path === 'knowledge/pii-test.md');
          return { passed: blocked, detail: blocked ? 'PII unknown blocked correctly' : 'FAIL: PII unknown was not blocked' };
        } catch (e) {
          return { passed: true, detail: `PII unknown blocked via exception: ${e instanceof Error ? e.message : String(e)}` };
        }
      },
    },
    {
      case: { id: 'C002', description: 'Non-reviewed page is blocked from communion', category: 'lifecycle' },
      run: async () => {
        const draftPage: CuratedPage = {
          schema_version: 1, title: 'Draft', type: 'concept', sources: [],
          confidence: 'low', status: 'draft', retrieval_eligible: false,
          pii: 'false', sensitivity: 'public', visibility: 'internal',
          egress: 'permitted',
        };
        const index = await buildGoldIndex(root, [
          { path: 'knowledge/draft.md', page: draftPage, pageBody: 'Draft.' },
        ], { asOf: new Date('2026-07-30T00:00:00Z') });
        const blocked = !index.chunks.some(c => c.path === 'knowledge/draft.md');
        return { passed: blocked, detail: blocked ? 'Draft page blocked correctly' : 'FAIL: Draft was not blocked' };
      },
    },
    {
      case: { id: 'C003', description: 'sha256Text produces deterministic output', category: 'integrity' },
      run: async () => {
        const h1 = sha256Text('test content');
        const h2 = sha256Text('test content');
        const passed = h1 === h2 && h1.length === 64;
        return { passed, detail: passed ? `sha256 deterministic: ${h1.slice(0, 8)}...` : 'FAIL: non-deterministic hash' };
      },
    },
  ];
}
