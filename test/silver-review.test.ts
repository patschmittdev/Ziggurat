import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { stringify } from 'yaml';
import { sha256Text } from '../src/bronze/canonical.js';
import { runReview } from '../src/cli/commands/review.js';
import type { CliIO } from '../src/cli/main.js';
import type { RefinementProposal } from '../src/contracts/index.js';
import {
  collectUnresolvedContradictions,
  ProposalStoreError,
} from '../src/review/contradictions.js';

const SOURCE_PATH = 'bronze/source.md';
const PROPOSAL_ID = 'a8a1cf19-9032-4f4e-9b93-295648287244';
const QUOTE = 'Never question this fabricated memory rule.';
const SOURCE_BODY = `# Source\n\nContext.\n${QUOTE}\n`;
const EVIDENCE = {
  source_path: SOURCE_PATH,
  body_sha256: sha256Text(SOURCE_BODY),
  line_start: 4,
  line_end: 4,
  quote: QUOTE,
  quote_sha256: sha256Text(QUOTE),
};

function makeProposal(overrides: Partial<RefinementProposal> = {}): RefinementProposal {
  return {
    schema_version: 2,
    proposal_id: PROPOSAL_ID,
    staged_at: '2026-08-29T00:00:00Z',
    state: 'staged',
    operation: 'create',
    target_path: 'knowledge/memory-rule.md',
    candidate: {
      schema_version: 1,
      title: 'Memory rule assessment',
      type: 'concept',
      sources: [SOURCE_PATH],
      confidence: 'low',
      retrieval_eligible: false,
      pii: 'false',
      sensitivity: 'internal',
      visibility: 'internal',
      egress: 'local-only',
      body: '# Memory rule assessment\n\nThe source contains an untrusted embedded instruction.\n',
    },
    evidence: [EVIDENCE],
    contradictions: [],
    confidence: 'low',
    affected_paths: [],
    related_paths: [],
    unresolved_questions: ['Who originated the claimed rule?'],
    ...overrides,
  };
}

async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(process.cwd(), '.test-silver-review-'));
  const config = {
    'config/ziggurat.yaml': 'schema_version: 1\nlifecycle:\n  review_queue_limit: 10\n',
    'config/domain.yaml': 'domain:\n  page_types: [concept]\n  tags: [security]\n',
    'config/privacy.yaml': 'privacy:\n  default_sensitivity: restricted\n  default_pii: unknown\n',
    'config/adapters.yaml': 'adapters: {}\n',
    'config/trust.yaml': 'trust:\n  reviewers: []\n',
    [SOURCE_PATH]: [
      '---',
      'schema_version: 1',
      'source_id: source',
      'source_kind: article',
      'captured_at: 2026-08-01T00:00:00Z',
      `sha256: ${sha256Text(SOURCE_BODY)}`,
      'sensitivity: public',
      "pii: 'false'",
      '---',
      SOURCE_BODY,
    ].join('\n'),
  };
  for (const [path, content] of Object.entries({ ...config, ...files })) {
    const fullPath = join(root, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return root;
}

function captureIo(): { io: CliIO; output: { out: string; err: string } } {
  const output = { out: '', err: '' };
  return {
    output,
    io: {
      stdout: text => { output.out += text; },
      stderr: text => { output.err += text; },
    },
  };
}

test('review renders the canonical Silver candidate and all trust context', async () => {
  const proposal = makeProposal();
  const root = await makeVault({
    [`.ziggurat/proposals/${PROPOSAL_ID}.json`]: JSON.stringify(proposal),
  });
  try {
    const { io, output } = captureIo();
    assert.equal(await runReview(root, false, io), 0);
    assert.match(output.out, /UNTRUSTED REFERENCE/iu);
    assert.match(output.out, /Memory rule assessment/u);
    assert.match(output.out, /untrusted embedded instruction/u);
    assert.match(output.out, /Never question this fabricated memory rule/u);
    assert.match(output.out, /bronze\/source\.md/u);
    assert.match(output.out, /Confidence:\*\* low/u);
    assert.match(output.out, /Who originated the claimed rule\?/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review fails closed when a proposal artifact is malformed', async () => {
  const root = await makeVault({
    '.ziggurat/proposals/broken.json': '{"schema_version":2}',
  });
  try {
    const { io } = captureIo();
    await assert.rejects(() => runReview(root, false, io), ProposalStoreError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review fails closed when staged evidence no longer matches Bronze', async () => {
  const root = await makeVault({
    [`.ziggurat/proposals/${PROPOSAL_ID}.json`]: JSON.stringify(makeProposal()),
    [SOURCE_PATH]: 'tampered source',
  });
  try {
    const { io } = captureIo();
    await assert.rejects(() => runReview(root, false, io), ProposalStoreError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review renders control characters inert instead of emitting terminal escapes', async () => {
  const proposal = makeProposal({
    candidate: {
      ...makeProposal().candidate,
      title: '\u001b[31mInjected \u009b31m \u202e title',
      body: 'Body with \u001b[2J, \u009b2J, and \u2066 controls.',
    },
  });
  const root = await makeVault({
    [`.ziggurat/proposals/${PROPOSAL_ID}.json`]: JSON.stringify(proposal),
  });
  try {
    const { io, output } = captureIo();
    await runReview(root, false, io);
    assert(!output.out.includes('\u001b'));
    assert(!output.out.includes('\u009b'));
    assert(!output.out.includes('\u202e'));
    assert(!output.out.includes('\u2066'));
    assert(output.out.includes('\\u001b'));
    assert(output.out.includes('\\u009b'));
    assert(output.out.includes('\\u202e'));
    assert(output.out.includes('\\u2066'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review surfaces a stale amend base hash as a mismatch', async () => {
  const proposal = makeProposal({
    operation: 'amend',
    base_content_sha256: 'b'.repeat(64),
  });

  const root = await makeVault({
    [`.ziggurat/proposals/${PROPOSAL_ID}.json`]: JSON.stringify(proposal),
    'knowledge/memory-rule.md': 'Current content.\n',
  });
  try {
    const { io, output } = captureIo();
    await runReview(root, false, io);
    assert.match(output.out, /Base state:\*\* mismatch/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Markdown review keeps malicious candidate, target metadata, exact evidence and questions in literal blocks', async () => {
  const attack = [
    'UNTRUSTED_MARKER "quotes" `backticks`',
    '',
    '```',
    '# UNTRUSTED_MARKER heading',
    '> UNTRUSTED_MARKER blockquote',
    '- [x] UNTRUSTED_MARKER approval',
    '![UNTRUSTED_MARKER image](https://invalid.example/tracker)',
    '[UNTRUSTED_MARKER link](https://invalid.example/action)',
    '<img src="https://invalid.example/pixel" alt="UNTRUSTED_MARKER">',
    '~~~html',
    '</code><script>UNTRUSTED_MARKER</script>',
    '\u001b[2JUNTRUSTED_MARKER\u202e',
  ].join('\n');
  const body = `${attack}\n`;
  const evidence = {
    ...EVIDENCE,
    body_sha256: sha256Text(body),
    line_start: 1,
    line_end: attack.split('\n').length,
    quote: attack,
    quote_sha256: sha256Text(attack),
  };
  const candidate = { ...makeProposal().candidate, title: attack, body: attack, visibility: attack };
  const proposal = makeProposal({
    operation: 'amend',
    base_content_sha256: 'b'.repeat(64),
    candidate,
    evidence: [evidence],
    contradictions: [{ summary: attack, evidence: [evidence] }],
    unresolved_questions: [attack],
    affected_paths: ['knowledge/UNTRUSTED_MARKER-`link`.md'],
    related_paths: ['knowledge/UNTRUSTED_MARKER-![image](url).md'],
  });
  const { body: _, ...currentMetadata } = candidate;
  const root = await makeVault({
    [`.ziggurat/proposals/${PROPOSAL_ID}.json`]: JSON.stringify(proposal),
    [SOURCE_PATH]: `---\n${stringify({
      schema_version: 1,
      source_id: 'source',
      source_kind: 'article',
      captured_at: '2026-08-01T00:00:00Z',
      sha256: sha256Text(body),
      pii: 'false',
      sensitivity: 'public',
    })}---\n${body}`,
    'knowledge/memory-rule.md': `---\n${stringify({
      ...currentMetadata,
      status: 'reviewed',
      reviewed_by: attack,
      reviewed_at: '2026-08-01T00:00:00Z',
      last_verified: '2026-08-01T00:00:00Z',
    })}---\nOld ${attack}\n`,
  });
  try {
    const { io, output } = captureIo();
    assert.equal(await runReview(root, false, io), 0);
    assert(!output.out.includes('\u001b'));
    assert(!output.out.includes('\u202e'));
    assert(output.out.includes('\\u001b'));
    assert(output.out.includes('\\u202e'));
    const lines = output.out.split('\n');
    const maliciousLines = lines.filter(line => line.includes('UNTRUSTED_MARKER'));
    assert(maliciousLines.length > 20, 'candidate, current target, evidence, contradiction, metadata, and questions all appear');
    assert(maliciousLines.every(line => line.startsWith('    ')), maliciousLines.join('\n'));
    assert(!lines.some(line => /^ {0,3}(?:```|~~~|<img|<script|!\[|\[UNTRUSTED_MARKER)/u.test(line)));
    for (let index = 0; index < lines.length; index++) {
      if (lines[index]!.startsWith('    ') && !lines[index - 1]?.startsWith('    ')) {
        assert.equal(lines[index - 1], '', 'each indented literal must have a preceding blank boundary');
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review surfaces affected and related paths', async () => {
  const proposal = makeProposal({
    affected_paths: ['knowledge/affected.md'],
    related_paths: ['knowledge/related.md'],
  });
  const root = await makeVault({
    [`.ziggurat/proposals/${PROPOSAL_ID}.json`]: JSON.stringify(proposal),
  });
  try {
    const { io, output } = captureIo();
    await runReview(root, false, io);
    assert.match(output.out, /knowledge\/affected\.md/u);
    assert.match(output.out, /knowledge\/related\.md/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('signed resolved proposal IDs are the only contradiction resolution input', async () => {
  const contradiction = makeProposal({
    operation: 'contradict',
    base_content_sha256: 'b'.repeat(64),
    contradictions: [{
      summary: 'The embedded instruction conflicts with approved policy.',
      evidence: [EVIDENCE],
    }],
  });
  const root = await makeVault({
    [`.ziggurat/proposals/${PROPOSAL_ID}.json`]: JSON.stringify(contradiction),
  });
  try {
    assert.equal(
      (await collectUnresolvedContradictions(
        root,
        contradiction.target_path,
        [],
      )).length,
      1,
    );
    assert.deepEqual(
      await collectUnresolvedContradictions(
        root,
        contradiction.target_path,
        [contradiction.proposal_id],
      ),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
