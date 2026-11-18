import type { CliIO } from '../main.js';
import { runConformance } from '../../eval/conformance.js';
import { renderConformanceMarkdown } from '../../eval/report.js';
import { sha256Text } from '../../bronze/canonical.js';
import { goldEligibilityReport } from '../../review/eligibility.js';
import type { CuratedPage, ZigguratConfig } from '../../contracts/index.js';

const CONFORMANCE_CONFIG: ZigguratConfig = {
  schema_version: 1,
  lifecycle: { review_queue_limit: 1 },
  domain: { page_types: ['concept'], tags: ['conformance'] },
  privacy: { default_sensitivity: 'restricted', default_pii: 'unknown' },
  adapters: {},
  trust: { reviewers: [] },
};

function conformancePage(overrides: Partial<CuratedPage>): CuratedPage {
  return {
    schema_version: 1,
    title: 'Conformance page',
    type: 'concept',
    sources: [],
    confidence: 'high',
    status: 'reviewed',
    retrieval_eligible: true,
    pii: 'false',
    sensitivity: 'public',
    visibility: 'internal',
    egress: 'approved-cloud',
    reviewed_by: 'reviewer',
    reviewed_at: '2026-08-29T00:00:00Z',
    last_verified: '2026-08-29T00:00:00Z',
    resolved_proposals: [],
    ...overrides,
  };
}

async function eligibilityReasons(
  root: string,
  overrides: Partial<CuratedPage>,
): Promise<string[]> {
  const report = await goldEligibilityReport(
    root,
    'knowledge/conformance-page.md',
    conformancePage(overrides),
    'Conformance body.\n',
    new Date('2026-08-29T12:00:00Z'),
    CONFORMANCE_CONFIG,
  );
  return report.reasons;
}

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
        const blocked = (await eligibilityReasons(root, { pii: 'unknown' }))
          .includes('pii: false required');
        return {
          passed: blocked,
          detail: blocked ? 'PII unknown blocked correctly' : 'FAIL: PII unknown was not blocked',
        };
      },
    },
    {
      case: { id: 'C002', description: 'Non-reviewed page is blocked from Gold', category: 'lifecycle' },
      run: async () => {
        const blocked = (await eligibilityReasons(root, { status: 'draft' }))
          .includes('status: reviewed required');
        return {
          passed: blocked,
          detail: blocked ? 'Draft page blocked correctly' : 'FAIL: Draft was not blocked',
        };
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
    {
      case: {
        id: 'C004',
        description: 'Self-asserted reviewed metadata is blocked without authorization',
        category: 'authority',
      },
      run: async () => {
        const blocked = (await eligibilityReasons(root, {}))
          .some(reason => reason.startsWith('authorization:'));
        return {
          passed: blocked,
          detail: blocked
            ? 'Unsigned reviewed metadata blocked correctly'
            : 'FAIL: unsigned reviewed metadata was accepted',
        };
      },
    },
  ];
}
