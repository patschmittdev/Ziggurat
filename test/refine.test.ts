import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sha256Text } from '../src/bronze/canonical.js';
import type { EvidenceCitation } from '../src/contracts/index.js';
import { validateEvidenceCitation } from '../src/refine/evidence.js';
import type { StructuredChatAdapter, ChatMessage } from '../src/refine/adapter.js';
import { LoopbackChatAdapter } from '../src/refine/adapter.js';
import { stageProposal, requestRefinement } from '../src/refine/proposal.js';
import type { RefinementInput } from '../src/refine/proposal.js';
import type { RefinementProposalPayload } from '../src/contracts/index.js';
import type { RefinementDraft } from '../src/contracts/refinement-draft.js';
import { RefinementError } from '../src/refine/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BODY = '# Test Source\nLine two content.\nLine three content.\n';

async function makeVaultWithBronze(body: string): Promise<{
  root: string;
  sourcePath: string;
  bodySha: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-refine-'));
  const canonical = body.replace(/\r\n/g, '\n');
  const bodySha = sha256Text(canonical);
  const yaml =
    'schema_version: 1\n' +
    'source_id: test-doc\n' +
    'source_kind: article\n' +
    'captured_at: 2026-01-01T00:00:00.000Z\n' +
    `sha256: ${bodySha}\n` +
    'sensitivity: restricted\n' +
    'pii: unknown\n';
  const fileContent = `---\n${yaml}---\n${canonical}`;
  const sourcePath = 'bronze/test-doc.md';
  await mkdir(join(root, 'bronze'), { recursive: true });
  await writeFile(join(root, sourcePath), fileContent, 'utf8');
  return { root, sourcePath, bodySha };
}

function makeCitation(
  sourcePath: string,
  bodySha: string,
  lineStart: number,
  lineEnd: number,
  quote: string,
): EvidenceCitation {
  return {
    source_path: sourcePath,
    body_sha256: bodySha,
    line_start: lineStart,
    line_end: lineEnd,
    quote,
    quote_sha256: sha256Text(quote),
  };
}

class FakeAdapter implements StructuredChatAdapter {
  constructor(private readonly value: unknown) {}
  async completeJson(_messages: readonly ChatMessage[]): Promise<unknown> {
    return this.value;
  }
}

function makeValidDraft(): RefinementDraft {
  return {
    schema_version: 1,
    operation: 'create',
    target_path: 'knowledge/test.md',
    candidate: {
      title: 'Test candidate',
      type: 'concept',
      retrieval_eligible: false,
      pii: 'unknown',
      sensitivity: 'restricted',
      visibility: 'internal',
      egress: 'local-only',
      body: '# Test candidate\n',
    },
    evidence: [{ source_id: 'source-1', line_start: 1, line_end: 1 }],
    confidence: 'medium',
    contradictions: [],
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
  };
}

function makeValidProposal(
  sourcePath: string,
  bodySha: string,
  quote: string,
): RefinementProposalPayload {
  return {
    schema_version: 2,
    operation: 'create',
    target_path: 'knowledge/test.md',
    candidate: {
      schema_version: 1,
      title: 'Test candidate',
      type: 'concept',
      sources: [sourcePath],
      confidence: 'medium',
      retrieval_eligible: false,
      pii: 'unknown',
      sensitivity: 'restricted',
      visibility: 'internal',
      egress: 'local-only',
      body: '# Test candidate\n',
    },
    evidence: [makeCitation(sourcePath, bodySha, 1, 1, quote)],
    confidence: 'medium',
    contradictions: [],
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
  };
}

// ---------------------------------------------------------------------------
// validateEvidenceCitation
// ---------------------------------------------------------------------------

test('validateEvidenceCitation: returns null for a correct single-line citation', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const quote = '# Test Source';
    const citation = makeCitation(sourcePath, bodySha, 1, 1, quote);
    const result = await validateEvidenceCitation(root, citation);
    assert.equal(result, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: returns null for a multi-line citation', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const quote = 'Line two content.\nLine three content.';
    const citation = makeCitation(sourcePath, bodySha, 2, 3, quote);
    const result = await validateEvidenceCitation(root, citation);
    assert.equal(result, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: rejects line ranges beyond the Bronze body', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const citation = makeCitation(
      sourcePath,
      bodySha,
      1,
      999,
      '# Test Source\nLine two content.\nLine three content.',
    );
    const result = await validateEvidenceCitation(root, citation);
    assert.equal(result?.failed_field, 'line_range');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: rejects reversed line ranges', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const citation = makeCitation(sourcePath, bodySha, 3, 2, 'Line three content.');
    const result = await validateEvidenceCitation(root, citation);
    assert.equal(result?.failed_field, 'line_range');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: preserves lone carriage returns exactly as ingested', async () => {
  const body = 'Line one\rLine two\n';
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(body);
  try {
    const citation = makeCitation(sourcePath, bodySha, 1, 1, 'Line one\rLine two');
    assert.equal(await validateEvidenceCitation(root, citation), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: rejects wrong body_sha256', async () => {
  const { root, sourcePath } = await makeVaultWithBronze(BODY);
  try {
    const badSha = 'a'.repeat(64);
    const citation: EvidenceCitation = {
      source_path: sourcePath,
      body_sha256: badSha,
      line_start: 1,
      line_end: 1,
      quote: '# Test Source',
      quote_sha256: sha256Text('# Test Source'),
    };
    const result = await validateEvidenceCitation(root, citation);
    assert.notEqual(result, null);
    assert.equal(result?.failed_field, 'body_sha256');
    assert.equal(result?.source_path, sourcePath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: rejects wrong quote for correct line range', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const wrongQuote = 'Not what is there';
    const citation: EvidenceCitation = {
      source_path: sourcePath,
      body_sha256: bodySha,
      line_start: 1,
      line_end: 1,
      quote: wrongQuote,
      quote_sha256: sha256Text(wrongQuote),
    };
    const result = await validateEvidenceCitation(root, citation);
    assert.notEqual(result, null);
    assert.equal(result?.failed_field, 'quote');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: rejects tampered quote_sha256', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const citation: EvidenceCitation = {
      source_path: sourcePath,
      body_sha256: bodySha,
      line_start: 1,
      line_end: 1,
      quote: '# Test Source',
      quote_sha256: 'b'.repeat(64), // wrong digest
    };
    const result = await validateEvidenceCitation(root, citation);
    assert.notEqual(result, null);
    assert.equal(result?.failed_field, 'quote_sha256');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// LoopbackChatAdapter construction guard
// ---------------------------------------------------------------------------

test('LoopbackChatAdapter: accepts 127.0.0.1 endpoint', () => {
  assert.doesNotThrow(() => new LoopbackChatAdapter('http://127.0.0.1:8080/v1/chat'));
});

test('LoopbackChatAdapter: accepts localhost endpoint', () => {
  assert.doesNotThrow(() => new LoopbackChatAdapter('http://localhost:11434/api/chat'));
});

test('LoopbackChatAdapter: rejects non-loopback endpoint', () => {
  assert.throws(
    () => new LoopbackChatAdapter('http://example.com/api'),
    /loopback/i,
  );
});

test('LoopbackChatAdapter: rejects remote HTTPS endpoint', () => {
  assert.throws(
    () => new LoopbackChatAdapter('https://api.openai.com/v1/chat/completions'),
    /loopback/i,
  );
});

// Focused regression: accepted HTTP loopback forms
test('LoopbackChatAdapter: accepts http://[::1] IPv6 loopback endpoint', () => {
  assert.doesNotThrow(() => new LoopbackChatAdapter('http://[::1]:11434/api/chat'));
});

// Focused regression: rejected HTTPS and other schemes even with loopback host
test('LoopbackChatAdapter: rejects https://localhost (HTTPS loopback)', () => {
  assert.throws(
    () => new LoopbackChatAdapter('https://localhost:11434/api/chat'),
    /loopback/i,
  );
});

test('LoopbackChatAdapter: rejects https://127.0.0.1 (HTTPS loopback IP)', () => {
  assert.throws(
    () => new LoopbackChatAdapter('https://127.0.0.1:8080/v1/chat'),
    /loopback/i,
  );
});

test('LoopbackChatAdapter: rejects ftp://127.0.0.1 (non-HTTP scheme)', () => {
  assert.throws(
    () => new LoopbackChatAdapter('ftp://127.0.0.1/resource'),
    /loopback/i,
  );
});

// ---------------------------------------------------------------------------
// stageProposal
// ---------------------------------------------------------------------------

test('stageProposal: writes a file under .ziggurat/proposals/', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const proposal = makeValidProposal(sourcePath, bodySha, '# Test Source');
    const staged = await stageProposal(root, proposal);
    assert.match(staged.path, /\.ziggurat[/\\]proposals[/\\]/u);
    const contents = await readFile(staged.path, 'utf8');
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    assert.equal(parsed['proposal_id'], staged.proposal.proposal_id);
    assert.equal(parsed['state'], 'staged');
    assert.deepEqual(parsed['candidate'], proposal.candidate);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stageProposal: does not execute amend operation side-effects', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const current = '# Existing\n';
    await mkdir(join(root, 'knowledge'), { recursive: true });
    await writeFile(join(root, 'knowledge', 'page-to-amend.md'), current, 'utf8');
    const proposal: RefinementProposalPayload = {
      ...makeValidProposal(sourcePath, bodySha, '# Test Source'),
      schema_version: 2,
      operation: 'amend',
      target_path: 'knowledge/page-to-amend.md',
      base_content_sha256: sha256Text(current),
      evidence: [makeCitation(sourcePath, bodySha, 1, 1, '# Test Source')],
    };
    await stageProposal(root, proposal);
    const targetPath = join(root, proposal.target_path);
    assert.equal(await readFile(targetPath, 'utf8'), current);
    // Only the proposals directory should have been created under .ziggurat.
    const proposalsDir = join(root, '.ziggurat', 'proposals');
    const entries = await readdir(proposalsDir);
    assert.equal(entries.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stageProposal: does not execute contradict operation side-effects', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const current = '# Existing\n';
    await mkdir(join(root, 'knowledge'), { recursive: true });
    await writeFile(join(root, 'knowledge', 'page-to-contradict.md'), current, 'utf8');
    const citation = makeCitation(sourcePath, bodySha, 1, 1, '# Test Source');
    const proposal: RefinementProposalPayload = {
      ...makeValidProposal(sourcePath, bodySha, '# Test Source'),
      schema_version: 2,
      operation: 'contradict',
      target_path: 'knowledge/page-to-contradict.md',
      base_content_sha256: sha256Text(current),
      evidence: [citation],
      contradictions: [{ summary: 'Source conflicts with the current page.', evidence: [citation] }],
    };
    await stageProposal(root, proposal);
    const targetPath = join(root, proposal.target_path);
    assert.equal(await readFile(targetPath, 'utf8'), current);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// requestRefinement
// ---------------------------------------------------------------------------

test('requestRefinement: throws when adapter returns malformed JSON', async () => {
  const { root, sourcePath } = await makeVaultWithBronze(BODY);
  try {
    const adapter = new FakeAdapter({ totally: 'wrong', shape: true });
    const input: RefinementInput = {
      root,
      topic: 'test topic',
      target_path: 'knowledge/test.md',
      bronze_source_paths: [sourcePath],
    };
    await assert.rejects(() => requestRefinement(adapter, input));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('requestRefinement: rejects model-supplied evidence hashes instead of repairing them', async () => {
  const { root, sourcePath } = await makeVaultWithBronze(BODY);
  try {
    const proposal = {
      ...makeValidDraft(),
      evidence: [
        {
          source_id: 'source-1',
          body_sha256: 'a'.repeat(64), // wrong hash
          line_start: 1,
          line_end: 1,
        },
      ],
    };
    const adapter = new FakeAdapter(proposal);
    const input: RefinementInput = {
      root,
      topic: 'test topic',
      target_path: 'knowledge/test.md',
      bronze_source_paths: [sourcePath],
    };
    await assert.rejects(
      () => requestRefinement(adapter, input),
      (error: unknown) => error instanceof RefinementError && error.code === 'draft-schema',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('requestRefinement: stages proposal and returns it when adapter is valid', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const proposal = makeValidDraft();
    const adapter = new FakeAdapter(proposal);
    const input: RefinementInput = {
      root,
      topic: 'test topic',
      target_path: 'knowledge/test.md',
      bronze_source_paths: [sourcePath],
    };
    const result = await requestRefinement(adapter, input);
    assert.equal(result.operation, 'create');
    assert.equal(result.target_path, 'knowledge/test.md');
    assert.equal(result.schema_version, 2);
    assert.deepEqual(result.candidate.sources, [sourcePath]);
    assert.equal(result.candidate.confidence, proposal.confidence);
    assert.deepEqual(result.evidence, [makeCitation(sourcePath, bodySha, 1, 1, '# Test Source')]);
    // Staged file must exist.
    const proposalsDir = join(root, '.ziggurat', 'proposals');
    const entries = await readdir(proposalsDir);
    assert.equal(entries.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Adversarial: direct stage bypass - stageProposal must parse+validate unknown
// ---------------------------------------------------------------------------

test('stageProposal: rejects unknown with bad evidence hash (internal schema parse)', async () => {
  const { root, sourcePath } = await makeVaultWithBronze(BODY);
  try {
    const badProposal = {
      ...makeValidProposal(sourcePath, 'a'.repeat(64), '# Test Source'),
      evidence: [{
        source_path: sourcePath,
        body_sha256: 'a'.repeat(64),
        line_start: 1,
        line_end: 1,
        quote: '# Test Source',
        quote_sha256: sha256Text('# Test Source'),
      }],
    };
    await assert.rejects(() => stageProposal(root, badProposal), /evidence/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stageProposal: rejects null', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-bad-'));
  try {
    await assert.rejects(() => stageProposal(root, null));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stageProposal: rejects object with missing required fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-bad-'));
  try {
    await assert.rejects(() => stageProposal(root, { totally: 'wrong' }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Adversarial: traversal / absolute / backslash in source_path
// ---------------------------------------------------------------------------

test('validateEvidenceCitation: rejects traversal in source_path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-trav-'));
  try {
    const citation: EvidenceCitation = {
      source_path: 'bronze/../outside.md',
      body_sha256: 'a'.repeat(64),
      line_start: 1,
      line_end: 1,
      quote: 'x',
      quote_sha256: sha256Text('x'),
    };
    await assert.rejects(() => validateEvidenceCitation(root, citation));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: rejects absolute source_path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-abs-'));
  try {
    const citation: EvidenceCitation = {
      source_path: '/bronze/doc.md',
      body_sha256: 'a'.repeat(64),
      line_start: 1,
      line_end: 1,
      quote: 'x',
      quote_sha256: sha256Text('x'),
    };
    await assert.rejects(() => validateEvidenceCitation(root, citation));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: rejects backslash in source_path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-bs-'));
  try {
    const citation: EvidenceCitation = {
      source_path: 'bronze\\evil.md',
      body_sha256: 'a'.repeat(64),
      line_start: 1,
      line_end: 1,
      quote: 'x',
      quote_sha256: sha256Text('x'),
    };
    await assert.rejects(() => validateEvidenceCitation(root, citation));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: rejects source_path not under bronze/', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-nb-'));
  try {
    const citation: EvidenceCitation = {
      source_path: 'knowledge/page.md',
      body_sha256: 'a'.repeat(64),
      line_start: 1,
      line_end: 1,
      quote: 'x',
      quote_sha256: sha256Text('x'),
    };
    await assert.rejects(() => validateEvidenceCitation(root, citation));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Adversarial: non-Bronze evidence and corrupt Bronze
// ---------------------------------------------------------------------------

test('validateEvidenceCitation: rejects non-Bronze file (no frontmatter)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-nbr-'));
  try {
    await mkdir(join(root, 'bronze'), { recursive: true });
    await writeFile(join(root, 'bronze', 'raw.md'), 'just some text\n', 'utf8');
    const citation: EvidenceCitation = {
      source_path: 'bronze/raw.md',
      body_sha256: sha256Text('just some text\n'),
      line_start: 1,
      line_end: 1,
      quote: 'just some text',
      quote_sha256: sha256Text('just some text'),
    };
    await assert.rejects(() => validateEvidenceCitation(root, citation));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: rejects corrupt Bronze (frontmatter sha256 does not match body)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-cor-'));
  try {
    await mkdir(join(root, 'bronze'), { recursive: true });
    const wrongSha = 'f'.repeat(64);
    const yaml =
      'schema_version: 1\n' +
      'source_id: corrupt-doc\n' +
      'source_kind: article\n' +
      'captured_at: 2026-01-01T00:00:00.000Z\n' +
      `sha256: ${wrongSha}\n` +
      'sensitivity: public\n' +
      'pii: false\n';
    const body = 'Real body content\n';
    await writeFile(join(root, 'bronze', 'corrupt.md'), `---\n${yaml}---\n${body}`, 'utf8');
    const citation: EvidenceCitation = {
      source_path: 'bronze/corrupt.md',
      body_sha256: sha256Text(body),
      line_start: 1,
      line_end: 1,
      quote: 'Real body content',
      quote_sha256: sha256Text('Real body content'),
    };
    await assert.rejects(() => validateEvidenceCitation(root, citation));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Adversarial: symlink escape
// ---------------------------------------------------------------------------

test('validateEvidenceCitation: rejects symlink escaping bronze/', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-sym-'));
  const outsideDir = await mkdtemp(join(tmpdir(), 'ziggurat-outside-'));
  try {
    await mkdir(join(root, 'bronze'), { recursive: true });
    const body = 'outside content\n';
    const bodySha = sha256Text(body);
    const outsideYaml =
      'schema_version: 1\n' +
      'source_id: outside\n' +
      'source_kind: article\n' +
      'captured_at: 2026-01-01T00:00:00.000Z\n' +
      `sha256: ${bodySha}\n` +
      'sensitivity: public\n' +
      'pii: false\n';
    const outsideFile = join(outsideDir, 'outside.md');
    await writeFile(outsideFile, `---\n${outsideYaml}---\n${body}`, 'utf8');
    const symlinkPath = join(root, 'bronze', 'escape.md');
    try {
      await symlink(outsideFile, symlinkPath);
    } catch {
      // Symlinks unavailable (Windows without privilege); skip.
      return;
    }
    const citation: EvidenceCitation = {
      source_path: 'bronze/escape.md',
      body_sha256: bodySha,
      line_start: 1,
      line_end: 1,
      quote: 'outside content',
      quote_sha256: sha256Text('outside content'),
    };
    await assert.rejects(() => validateEvidenceCitation(root, citation));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

test('validateEvidenceCitation: rejects a Bronze root symlink outside the vault', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-sym-root-'));
  const outsideDir = await mkdtemp(join(tmpdir(), 'ziggurat-outside-root-'));
  try {
    const body = 'outside content\n';
    const bodySha = sha256Text(body);
    await writeFile(
      join(outsideDir, 'source.md'),
      `---\nschema_version: 1\nsource_id: outside\nsource_kind: article\ncaptured_at: 2026-01-01T00:00:00Z\nsha256: ${bodySha}\nsensitivity: public\npii: 'false'\n---\n${body}`,
      'utf8',
    );
    try {
      await symlink(outsideDir, join(root, 'bronze'), 'dir');
    } catch {
      return;
    }
    const citation: EvidenceCitation = {
      source_path: 'bronze/source.md',
      body_sha256: bodySha,
      line_start: 1,
      line_end: 1,
      quote: 'outside content',
      quote_sha256: sha256Text('outside content'),
    };
    await assert.rejects(() => validateEvidenceCitation(root, citation), /outside/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outsideDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Adversarial: target_path / affected_paths / related_paths constraints
// ---------------------------------------------------------------------------

test('stageProposal: rejects target_path with traversal', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const badProposal = {
      ...makeValidProposal(sourcePath, bodySha, '# Test Source'),
      target_path: '../../../etc/passwd',
    };
    await assert.rejects(() => stageProposal(root, badProposal));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stageProposal: rejects target_path not under knowledge/', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const badProposal = {
      ...makeValidProposal(sourcePath, bodySha, '# Test Source'),
      target_path: 'bronze/evil.md',
    };
    await assert.rejects(() => stageProposal(root, badProposal));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stageProposal: rejects affected_paths with traversal', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const badProposal = {
      ...makeValidProposal(sourcePath, bodySha, '# Test Source'),
      affected_paths: ['../evil'],
    };
    await assert.rejects(() => stageProposal(root, badProposal));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stageProposal: rejects related_paths with backslash', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const badProposal = {
      ...makeValidProposal(sourcePath, bodySha, '# Test Source'),
      related_paths: ['knowledge\\evil.md'],
    };
    await assert.rejects(() => stageProposal(root, badProposal));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Adversarial: collision / no-overwrite, and cleanup
// ---------------------------------------------------------------------------

test('stageProposal: two calls produce two distinct files', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const proposal = makeValidProposal(sourcePath, bodySha, '# Test Source');
    const p1 = await stageProposal(root, proposal);
    const p2 = await stageProposal(root, proposal);
    assert.notEqual(p1.path, p2.path);
    const proposalsDir = join(root, '.ziggurat', 'proposals');
    const entries = await readdir(proposalsDir);
    assert.equal(entries.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stageProposal: no .tmp files remain after successful stage', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const proposal = makeValidProposal(sourcePath, bodySha, '# Test Source');
    await stageProposal(root, proposal);
    const proposalsDir = join(root, '.ziggurat', 'proposals');
    const entries = await readdir(proposalsDir);
    const tmpFiles = entries.filter(e => e.endsWith('.tmp'));
    assert.equal(tmpFiles.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stageProposal: no .tmp files remain after evidence validation failure', async () => {
  const { root, sourcePath } = await makeVaultWithBronze(BODY);
  try {
    const badProposal = {
      ...makeValidProposal(sourcePath, 'a'.repeat(64), '# Test Source'),
      evidence: [{
        source_path: sourcePath,
        body_sha256: 'a'.repeat(64),
        line_start: 1,
        line_end: 1,
        quote: '# Test Source',
        quote_sha256: sha256Text('# Test Source'),
      }],
    };
    await assert.rejects(() => stageProposal(root, badProposal));
    const proposalsDir = join(root, '.ziggurat', 'proposals');
    try {
      const entries = await readdir(proposalsDir);
      const tmpFiles = entries.filter(e => e.endsWith('.tmp'));
      assert.equal(tmpFiles.length, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
