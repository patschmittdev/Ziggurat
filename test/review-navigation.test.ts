import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';
import { normalizeText } from '../src/authorization/canonical.js';
import { sha256Text } from '../src/bronze/canonical.js';
import { parseCliArgs } from '../src/cli/args.js';
import { runCli } from '../src/cli/main.js';
import { runReview } from '../src/cli/commands/review.js';
import type { CliIO } from '../src/cli/main.js';
import { parseZigguratConfig } from '../src/contracts/config.js';
import type { CuratedPage, RefinementProposal } from '../src/contracts/index.js';
import { collectStagedProposals } from '../src/refine/store.js';
import { goldEligibilityReport } from '../src/review/eligibility.js';
import {
  buildReviewQueue, renderReviewQueueMarkdown, ReviewNavigationError,
} from '../src/review/queue.js';
import type { ReviewOptions, ReviewQueue } from '../src/review/queue.js';

const SOURCE = 'bronze/source.md';
const TARGET = 'knowledge/target.md';
const SOURCE_BODY = 'A source claim.\n';
const EVIDENCE = {
  source_path: SOURCE,
  body_sha256: sha256Text(SOURCE_BODY),
  line_start: 1,
  line_end: 1,
  quote: 'A source claim.',
  quote_sha256: sha256Text('A source claim.'),
};

function proposal(index: number, overrides: Partial<RefinementProposal> = {}): RefinementProposal {
  return {
    schema_version: 2,
    proposal_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    staged_at: `2026-08-${String(index).padStart(2, '0')}T00:00:00Z`,
    state: 'staged',
    operation: 'create',
    target_path: TARGET,
    candidate: {
      schema_version: 1,
      title: 'Proposed title',
      type: 'concept',
      sources: [SOURCE],
      confidence: 'high',
      retrieval_eligible: true,
      pii: 'false',
      sensitivity: 'public',
      visibility: 'internal',
      egress: 'approved-cloud',
      body: 'Shared heading\nNew claim.\nShared ending\n',
    },
    evidence: [EVIDENCE],
    contradictions: [],
    confidence: 'high',
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
    ...overrides,
  };
}

function page(): CuratedPage {
  const { body: _, ...metadata } = proposal(1).candidate;
  return {
    ...metadata,
    title: 'Current title',
    retrieval_eligible: false,
    status: 'reviewed',
    reviewed_by: 'external-reviewer',
    reviewed_at: '2026-08-01T00:00:00Z',
    last_verified: '2026-08-01T00:00:00Z',
    resolved_proposals: [],
  };
}

function pageText(body = 'Shared heading\nOld claim.\nShared ending\n'): string {
  return `---\n${stringify(page())}---\n${body}`;
}

async function put(root: string, path: string, text: string): Promise<void> {
  const full = join(root, path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, text, 'utf8');
}

async function stage(root: string, value: RefinementProposal): Promise<void> {
  await put(root, `.ziggurat/proposals/${value.proposal_id}.json`, JSON.stringify(value));
}

async function vault(limit = 1): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.test-review-navigation-'));
  await put(root, 'config/ziggurat.yaml', `schema_version: 1\nlifecycle:\n  review_queue_limit: ${limit}\n`);
  await put(root, 'config/domain.yaml', 'domain:\n  page_types: [concept]\n  tags: [test]\n');
  await put(root, 'config/privacy.yaml', 'privacy:\n  default_sensitivity: restricted\n  default_pii: unknown\n');
  await put(root, 'config/adapters.yaml', 'adapters: {}\n');
  await put(root, 'config/trust.yaml', 'trust:\n  reviewers: []\n');
  await put(root, SOURCE, `---\n${stringify({
    schema_version: 1,
    source_id: 'source',
    source_kind: 'article',
    captured_at: '2026-08-01T00:00:00Z',
    sha256: sha256Text(SOURCE_BODY),
    sensitivity: 'public',
    pii: 'false',
  })}---\n${SOURCE_BODY}`);
  return root;
}

async function queue(root: string, options: ReviewOptions = {}): Promise<ReviewQueue> {
  return buildReviewQueue(root, await collectStagedProposals(root), await parseZigguratConfig(root), options);
}

function ioCapture(): { io: CliIO; output: { out: string; err: string } } {
  const output = { out: '', err: '' };
  return { output, io: {
    stdout: text => { output.out += text; },
    stderr: text => { output.err += text; },
  } };
}

test('review compares current body and model metadata without deleting human-only metadata', async () => {
  const root = await vault();
  try {
    const current = pageText();
    await put(root, TARGET, current);
    await stage(root, proposal(1, {
      operation: 'amend',
      base_content_sha256: sha256Text(normalizeText(current)),
    }));
    const result = await queue(root);
    const entry = result.entries[0]!;
    assert.equal(entry.base_state, 'matches');
    assert.match(entry.comparison!.label, /^Matching-base/u);
    assert.deepEqual(entry.comparison!.body_diff, [
      '  Shared heading', '- Old claim.', '+ New claim.', '  Shared ending', '  ',
    ]);
    assert.deepEqual(entry.comparison!.metadata.find(item => item.field === 'title'), {
      field: 'title', current: 'Current title', proposed: 'Proposed title', change: 'changed',
    });
    assert.equal(entry.comparison!.metadata.find(item => item.field === 'sources')!.change, 'unchanged');
    assert(!entry.comparison!.metadata.some(item => String(item.field).startsWith('reviewed')));
    assert.equal(entry.current_target.human_metadata!.reviewed_by, 'external-reviewer');
    const rendered = renderReviewQueueMarkdown(result);
    assert.match(rendered, /absence in Silver never requests deletion from Gold/u);
    assert.match(rendered, /Exact Bronze evidence for candidate claims/u);
    assert.match(rendered, /Advisory authorization checklist/u);
    assert.match(rendered, /canonical final-page digest/u);
    assert.match(rendered, /Not a receipt, approval, or proof of human review/u);
    assert(!rendered.includes('- [x]'));
    assert.equal(await readFile(join(root, TARGET), 'utf8'), current);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review labels mismatched bases as current-target comparisons and warns for missing/create conflicts', async () => {
  const root = await vault();
  try {
    const staged = proposal(1, { operation: 'amend', base_content_sha256: 'b'.repeat(64) });
    await stage(root, staged);
    await put(root, TARGET, pageText());
    let result = await queue(root);
    assert.equal(result.entries[0]!.base_state, 'mismatch');
    assert.match(result.entries[0]!.comparison!.label, /Current target versus proposal \(not a historical-base diff\)/u);
    assert.match(renderReviewQueueMarkdown(result), /STALE BASE/u);
    await rm(join(root, TARGET));
    result = await queue(root);
    assert.equal(result.entries[0]!.base_state, 'missing');
    assert.match(renderReviewQueueMarkdown(result), /MISSING TARGET/u);
    await stage(root, proposal(1));
    result = await queue(root);
    assert.equal(result.entries[0]!.base_state, 'new-target');
    assert(result.entries[0]!.comparison!.body_diff.every(line => line.startsWith('+ ')));
    await put(root, TARGET, pageText());
    assert.match(renderReviewQueueMarkdown(await queue(root)), /CREATE CONFLICT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review explicitly reports malformed current targets instead of normalizing a successful diff', async () => {
  const root = await vault();
  try {
    await stage(root, proposal(1, { operation: 'amend', base_content_sha256: 'b'.repeat(64) }));
    for (const text of ['No frontmatter.\n', '---\ntitle: [\n---\nBody\n', '---\ntitle: bad schema\n---\nBody\n']) {
      await put(root, TARGET, text);
      const result = await queue(root);
      assert.equal(result.entries[0]!.current_target.parse_state, 'invalid');
      assert.equal(result.entries[0]!.comparison, null);
      assert(result.entries[0]!.current_target.parse_error);
      assert.match(renderReviewQueueMarkdown(result), /CURRENT TARGET PARSE FAILURE/u);
      assert.equal(result.entries[0]!.current_target.raw_content, text);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review keeps priority default and reaches globally oldest entries through stable pages', async () => {
  const root = await vault(2);
  try {
    for (let index = 1; index <= 5; index++) {
      const item = proposal(index);
      if (index === 5) {
        item.confidence = item.candidate.confidence = 'low';
        item.operation = 'contradict';
        item.base_content_sha256 = 'b'.repeat(64);
        item.contradictions = [{ summary: 'Contradicting source claim.', evidence: [EVIDENCE] }];
      }
      await stage(root, item);
    }
    assert.equal((await queue(root)).entries[0]!.proposal_id, proposal(5).proposal_id);
    const first = await queue(root, { order: 'oldest' });
    assert.equal(first.total_count, 5);
    assert.equal(first.displayed_count, 2);
    assert.equal(first.count, 2);
    assert.equal(first.remaining_count, 3);
    assert.equal(first.render_limit, 2);
    assert.deepEqual([first.page_number, first.page_count, first.page_start, first.page_end], [1, 3, 1, 2]);
    assert.equal(first.oldest_staged_at, proposal(1).staged_at);
    assert(first.oldest_age_seconds! > 0);
    assert(first.next_cursor && first.next_cursor.length < 512);
    const second = await queue(root, { cursor: first.next_cursor! });
    assert.equal(second.order, 'oldest');
    assert.deepEqual([second.page_start, second.page_end, second.remaining_count], [3, 4, 1]);
    const last = await queue(root, { cursor: second.next_cursor! });
    assert.deepEqual([last.page_start, last.page_end, last.remaining_count], [5, 5, 0]);
    assert.equal(last.next_cursor, null);
    assert.deepEqual([...first.entries, ...second.entries, ...last.entries].map(item => item.proposal_id),
      [1, 2, 3, 4, 5].map(index => proposal(index).proposal_id));
    assert.equal(last.oldest_staged_at, first.oldest_staged_at);
    const replay = await queue(root, { cursor: first.next_cursor! });
    assert.deepEqual(replay.entries, second.entries);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('empty review exposes zero counts, no age, and no continuation', async () => {
  const root = await vault();
  try {
    const result = await queue(root);
    assert.deepEqual([
      result.total_count, result.displayed_count, result.remaining_count,
      result.page_start, result.page_end, result.page_number, result.page_count,
    ], [0, 0, 0, 0, 0, 0, 0]);
    assert.equal(result.oldest_age_seconds, null);
    assert.equal(result.next_cursor, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cursor refuses added, removed, or edited artifacts, changed limits, and changed ordering', async () => {
  const root = await vault();
  try {
    await stage(root, proposal(1));
    await stage(root, proposal(2));
    const first = await queue(root);
    const cursor = first.next_cursor!;
    await assert.rejects(() => queue(root, { cursor, order: 'oldest' }), ReviewNavigationError);
    await stage(root, proposal(3));
    await assert.rejects(() => queue(root, { cursor }), /queue changed/u);
    await rm(join(root, `.ziggurat/proposals/${proposal(3).proposal_id}.json`));
    await stage(root, proposal(2, { unresolved_questions: ['New question.'] }));
    await assert.rejects(() => queue(root, { cursor }), /queue changed/u);
    await stage(root, proposal(2));
    await put(root, 'config/ziggurat.yaml', 'schema_version: 1\nlifecycle:\n  review_queue_limit: 2\n');
    await assert.rejects(() => queue(root, { cursor }), /queue changed/u);
    await put(root, 'config/ziggurat.yaml', 'schema_version: 1\nlifecycle:\n  review_queue_limit: 1\n');
    await rm(join(root, `.ziggurat/proposals/${proposal(2).proposal_id}.json`));
    await assert.rejects(() => queue(root, { cursor }), /queue changed/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('cursor binds hidden target digests, including mismatch-to-mismatch changes and disappearance', async () => {
  const root = await vault();
  try {
    await stage(root, proposal(1, { target_path: 'knowledge/visible.md' }));
    await stage(root, proposal(2, { operation: 'amend', base_content_sha256: 'b'.repeat(64) }));
    await put(root, TARGET, pageText('First stale content.\n'));
    const first = await queue(root);
    await put(root, TARGET, pageText('Different stale content.\n'));
    await assert.rejects(() => queue(root, { cursor: first.next_cursor! }), /queue changed/u);
    const next = await queue(root);
    await rm(join(root, TARGET));
    await assert.rejects(() => queue(root, { cursor: next.next_cursor! }), /queue changed/u);
    const missing = await queue(root);
    await put(root, TARGET, pageText());
    await assert.rejects(() => queue(root, { cursor: missing.next_cursor! }), /queue changed/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bounded cursor rejects malformed, noncanonical, extra-field, and invalid-offset tokens', async () => {
  const root = await vault();
  try {
    await stage(root, proposal(1));
    await stage(root, proposal(2));
    const first = await queue(root);
    const parsed = JSON.parse(Buffer.from(first.next_cursor!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const cursor of [
      '', '*', 'a'.repeat(513), `${first.next_cursor!}=`, encode(null),
      encode({ ...parsed, unexpected: true }), encode({ ...parsed, offset: 0 }),
      encode({ ...parsed, offset: -1 }), encode({ ...parsed, offset: 1.5 }),
      encode({ ...parsed, offset: Number.MAX_SAFE_INTEGER + 1 }),
      encode({ ...parsed, offset: 30 }), encode({ ...parsed, v: 2 }),
    ]) {
      await assert.rejects(() => queue(root, { cursor }), ReviewNavigationError);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review validates malformed and corrupted-evidence proposals outside the display page', async () => {
  const root = await vault();
  try {
    await stage(root, proposal(1));
    await stage(root, proposal(2));
    await put(root, '.ziggurat/proposals/broken.json', '{}');
    const capture = ioCapture();
    await assert.rejects(() => runReview(root, false, capture.io), /schema validation/u);
    assert.equal(capture.output.out, '');
    await rm(join(root, '.ziggurat/proposals/broken.json'));
    const hidden = proposal(2, { evidence: [{ ...EVIDENCE, quote_sha256: 'b'.repeat(64) }] });
    await stage(root, hidden);
    await assert.rejects(() => runReview(root, false, capture.io), /invalid evidence/u);
    assert.equal(capture.output.out, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a contradiction outside the oldest display page still blocks Gold admission', async () => {
  const root = await vault();
  try {
    await stage(root, proposal(1));
    const hidden = proposal(2, {
      operation: 'contradict',
      base_content_sha256: 'b'.repeat(64),
      contradictions: [{ summary: 'A contradictory claim.', evidence: [EVIDENCE] }],
    });
    await stage(root, hidden);
    const rendered = await queue(root, { order: 'oldest' });
    assert.equal(rendered.entries[0]!.proposal_id, proposal(1).proposal_id);
    assert.equal(rendered.entries.length, 1);
    const report = await goldEligibilityReport(root, TARGET, page(), 'Final page.\n',
      new Date('2026-08-20T00:00:00Z'), await parseZigguratConfig(root));
    assert.equal(report.eligible, false);
    assert(report.reasons.includes('contradictions: 1 unresolved'), JSON.stringify(report.reasons));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review refuses knowledge junctions that resolve outside the vault boundary', async () => {
  const root = await vault();
  const outside = await mkdtemp(join(process.cwd(), '.test-review-outside-'));
  try {
    await stage(root, proposal(1));
    await put(outside, 'target.md', pageText());
    await symlink(outside, join(root, 'knowledge'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => queue(root), /outside the vault root/u);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('review-only navigation flags reject every other command, including help', async () => {
  for (const command of ['init', 'ingest', 'refine', 'build', 'query', 'mcp', 'check', 'eval']) {
    for (const [option, value] of [['--order', 'oldest'], ['--cursor', 'token']]) {
      for (const help of [[], ['--help']]) {
        const capture = ioCapture();
        assert.equal(await runCli([command, option!, value!, ...help], capture.io), 1);
        assert.match(capture.output.err, /applies only to the review command/u);
        assert.equal(capture.output.out, '');
      }
    }
  }
  assert.throws(() => parseCliArgs(['--help', '--order', 'oldest']), /only to the review command/u);
  assert.throws(() => parseCliArgs(['review', '--order', 'recent']), /must be priority or oldest/u);
  assert.throws(() => parseCliArgs(['review', '--order']), /argument missing/u);
  assert.throws(() => parseCliArgs(['review', '--cursor']), /argument missing/u);
  const parsed = parseCliArgs(['review', '--order', 'oldest', '--cursor', 'token']);
  assert.equal(parsed.order, 'oldest');
  assert.equal(parsed.cursor, 'token');
  assert.equal(parseCliArgs(['refine', '--target', TARGET]).target, TARGET);
});

test('CLI JSON navigation retains order, exposes counts, and emits no partial page after changes', async () => {
  const root = await vault();
  try {
    await stage(root, proposal(1));
    await stage(root, proposal(2));
    let capture = ioCapture();
    assert.equal(await runCli(['review', '--root', root, '--order', 'oldest', '--json'], capture.io), 0);
    const first = JSON.parse(capture.output.out) as ReviewQueue;
    assert.equal(first.total_count, 2);
    assert.equal(first.order, 'oldest');
    capture = ioCapture();
    assert.equal(await runCli(['review', '--root', root, '--json', '--cursor', first.next_cursor!], capture.io), 0);
    assert.equal((JSON.parse(capture.output.out) as ReviewQueue).page_start, 2);
    await stage(root, proposal(3));
    capture = ioCapture();
    assert.equal(await runCli(['review', '--root', root, '--json', '--cursor', first.next_cursor!], capture.io), 1);
    assert.equal(capture.output.out, '');
    assert.match(capture.output.err, /queue changed/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
