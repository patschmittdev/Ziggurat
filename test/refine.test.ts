import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { sha256Text } from '../src/bronze/canonical.js';
import type { EvidenceCitation } from '../src/contracts/index.js';
import { validateEvidenceCitation } from '../src/refine/evidence.js';
import type { StructuredChatAdapter, ChatMessage } from '../src/refine/adapter.js';
import { LoopbackChatAdapter } from '../src/refine/adapter.js';
import { stageProposal, requestRefinement } from '../src/refine/proposal.js';
import type { RefinementInput } from '../src/refine/proposal.js';
import type { RefinementProposal } from '../src/contracts/index.js';

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

function makeValidProposal(
  sourcePath: string,
  bodySha: string,
  quote: string,
): RefinementProposal {
  return {
    schema_version: 1,
    operation: 'create',
    target_path: 'knowledge/test.md',
    evidence: [makeCitation(sourcePath, bodySha, 1, 1, quote)],
    confidence: 'medium',
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

// ---------------------------------------------------------------------------
// stageProposal
// ---------------------------------------------------------------------------

test('stageProposal: writes a file under .ziggurat/proposals/', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const proposal = makeValidProposal(sourcePath, bodySha, '# Test Source');
    const filePath = await stageProposal(root, proposal);
    assert.match(filePath, /\.ziggurat[/\\]proposals[/\\]/u);
    const contents = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(contents) as unknown;
    assert.deepEqual(parsed, proposal);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stageProposal: does not execute amend operation side-effects', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const proposal: RefinementProposal = {
      schema_version: 1,
      operation: 'amend',
      target_path: 'knowledge/page-to-amend.md',
      evidence: [makeCitation(sourcePath, bodySha, 1, 1, '# Test Source')],
      confidence: 'low',
      affected_paths: [],
      related_paths: [],
      unresolved_questions: [],
    };
    await stageProposal(root, proposal);
    // Target page must NOT have been created or modified.
    const targetPath = join(root, proposal.target_path);
    await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u);
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
    const proposal: RefinementProposal = {
      schema_version: 1,
      operation: 'contradict',
      target_path: 'knowledge/page-to-contradict.md',
      evidence: [makeCitation(sourcePath, bodySha, 1, 1, '# Test Source')],
      confidence: 'high',
      affected_paths: [],
      related_paths: [],
      unresolved_questions: [],
    };
    await stageProposal(root, proposal);
    const targetPath = join(root, proposal.target_path);
    await assert.rejects(readFile(targetPath, 'utf8'), /ENOENT/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// requestRefinement
// ---------------------------------------------------------------------------

test('requestRefinement: throws when adapter returns malformed JSON', async () => {
  const { root } = await makeVaultWithBronze(BODY);
  try {
    const adapter = new FakeAdapter({ totally: 'wrong', shape: true });
    const input: RefinementInput = {
      root,
      topic: 'test topic',
      target_path: 'knowledge/test.md',
      bronze_source_paths: [],
    };
    await assert.rejects(() => requestRefinement(adapter, input));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('requestRefinement: throws when adapter returns valid schema but bad evidence hash', async () => {
  const { root, sourcePath } = await makeVaultWithBronze(BODY);
  try {
    const proposal = {
      schema_version: 1,
      operation: 'create',
      target_path: 'knowledge/test.md',
      evidence: [
        {
          source_path: sourcePath,
          body_sha256: 'a'.repeat(64), // wrong hash
          line_start: 1,
          line_end: 1,
          quote: '# Test Source',
          quote_sha256: sha256Text('# Test Source'),
        },
      ],
      confidence: 'medium',
      affected_paths: [],
      related_paths: [],
      unresolved_questions: [],
    };
    const adapter = new FakeAdapter(proposal);
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

test('requestRefinement: stages proposal and returns it when adapter is valid', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const proposal = makeValidProposal(sourcePath, bodySha, '# Test Source');
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
      schema_version: 1,
      operation: 'create',
      target_path: 'knowledge/test.md',
      evidence: [{
        source_path: sourcePath,
        body_sha256: 'a'.repeat(64),
        line_start: 1,
        line_end: 1,
        quote: '# Test Source',
        quote_sha256: sha256Text('# Test Source'),
      }],
      confidence: 'medium',
      affected_paths: [],
      related_paths: [],
      unresolved_questions: [],
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

// ---------------------------------------------------------------------------
// Adversarial: target_path / affected_paths / related_paths constraints
// ---------------------------------------------------------------------------

test('stageProposal: rejects target_path with traversal', async () => {
  const { root, sourcePath, bodySha } = await makeVaultWithBronze(BODY);
  try {
    const badProposal = {
      schema_version: 1,
      operation: 'create',
      target_path: '../../../etc/passwd',
      evidence: [makeCitation(sourcePath, bodySha, 1, 1, '# Test Source')],
      confidence: 'medium',
      affected_paths: [],
      related_paths: [],
      unresolved_questions: [],
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
      schema_version: 1,
      operation: 'create',
      target_path: 'bronze/evil.md',
      evidence: [makeCitation(sourcePath, bodySha, 1, 1, '# Test Source')],
      confidence: 'medium',
      affected_paths: [],
      related_paths: [],
      unresolved_questions: [],
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
      schema_version: 1,
      operation: 'create',
      target_path: 'knowledge/test.md',
      evidence: [makeCitation(sourcePath, bodySha, 1, 1, '# Test Source')],
      confidence: 'medium',
      affected_paths: ['../evil'],
      related_paths: [],
      unresolved_questions: [],
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
      schema_version: 1,
      operation: 'create',
      target_path: 'knowledge/test.md',
      evidence: [makeCitation(sourcePath, bodySha, 1, 1, '# Test Source')],
      confidence: 'medium',
      affected_paths: [],
      related_paths: ['knowledge\\evil.md'],
      unresolved_questions: [],
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
    assert.notEqual(p1, p2);
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
      schema_version: 1,
      operation: 'create',
      target_path: 'knowledge/test.md',
      evidence: [{
        source_path: sourcePath,
        body_sha256: 'a'.repeat(64),
        line_start: 1,
        line_end: 1,
        quote: '# Test Source',
        quote_sha256: sha256Text('# Test Source'),
      }],
      confidence: 'medium',
      affected_paths: [],
      related_paths: [],
      unresolved_questions: [],
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

// ---------------------------------------------------------------------------
// LoopbackChatAdapter: HTTP request structure (in-process server)
// ---------------------------------------------------------------------------

async function withHttpCapture(
  responseBody: unknown,
  fn: (port: number) => Promise<void>,
): Promise<unknown> {
  let capturedBody: unknown;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      capturedBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(port);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err != null ? reject(err) : resolve())),
    );
  }
  if (capturedBody === undefined) throw new Error('No request body captured');
  return capturedBody;
}

test('LoopbackChatAdapter: completeJson sends response_format type json_schema', async () => {
  const body = await withHttpCapture({}, async (port) => {
    const adapter = new LoopbackChatAdapter(`http://127.0.0.1:${port}/v1/chat/completions`);
    await adapter.completeJson([{ role: 'user', content: 'test' }]);
  });
  const rf = (body as Record<string, unknown>)['response_format'] as Record<string, unknown>;
  assert.equal(rf['type'], 'json_schema');
});

test('LoopbackChatAdapter: completeJson sends json_schema strict true', async () => {
  const body = await withHttpCapture({}, async (port) => {
    const adapter = new LoopbackChatAdapter(`http://127.0.0.1:${port}/v1/chat/completions`);
    await adapter.completeJson([{ role: 'user', content: 'test' }]);
  });
  const js = ((body as Record<string, unknown>)['response_format'] as Record<string, unknown>)['json_schema'] as Record<string, unknown>;
  assert.equal(js['strict'], true);
});

test('LoopbackChatAdapter: completeJson sends json_schema name ziggurat_refinement_proposal', async () => {
  const body = await withHttpCapture({}, async (port) => {
    const adapter = new LoopbackChatAdapter(`http://127.0.0.1:${port}/v1/chat/completions`);
    await adapter.completeJson([{ role: 'user', content: 'test' }]);
  });
  const js = ((body as Record<string, unknown>)['response_format'] as Record<string, unknown>)['json_schema'] as Record<string, unknown>;
  assert.equal(js['name'], 'ziggurat_refinement_proposal');
});

test('LoopbackChatAdapter: completeJson schema includes operation enum create/amend/contradict', async () => {
  const body = await withHttpCapture({}, async (port) => {
    const adapter = new LoopbackChatAdapter(`http://127.0.0.1:${port}/v1/chat/completions`);
    await adapter.completeJson([{ role: 'user', content: 'test' }]);
  });
  const js = ((body as Record<string, unknown>)['response_format'] as Record<string, unknown>)['json_schema'] as Record<string, unknown>;
  const schema = js['schema'] as Record<string, unknown>;
  const props = schema['properties'] as Record<string, Record<string, unknown>>;
  const opEnum = (props['operation'] as Record<string, unknown>)['enum'] as string[];
  assert.deepEqual([...opEnum].sort(), ['amend', 'contradict', 'create']);
});

test('LoopbackChatAdapter: completeJson schema lists all required top-level fields', async () => {
  const body = await withHttpCapture({}, async (port) => {
    const adapter = new LoopbackChatAdapter(`http://127.0.0.1:${port}/v1/chat/completions`);
    await adapter.completeJson([{ role: 'user', content: 'test' }]);
  });
  const js = ((body as Record<string, unknown>)['response_format'] as Record<string, unknown>)['json_schema'] as Record<string, unknown>;
  const schema = js['schema'] as Record<string, unknown>;
  const required = schema['required'] as string[];
  const expected = ['schema_version', 'operation', 'target_path', 'evidence', 'confidence', 'affected_paths', 'related_paths', 'unresolved_questions'];
  for (const field of expected) {
    assert.ok(required.includes(field), `schema.required must include "${field}"`);
  }
});

test('LoopbackChatAdapter: completeJson evidence item schema lists all required fields', async () => {
  const body = await withHttpCapture({}, async (port) => {
    const adapter = new LoopbackChatAdapter(`http://127.0.0.1:${port}/v1/chat/completions`);
    await adapter.completeJson([{ role: 'user', content: 'test' }]);
  });
  const js = ((body as Record<string, unknown>)['response_format'] as Record<string, unknown>)['json_schema'] as Record<string, unknown>;
  const schema = js['schema'] as Record<string, unknown>;
  const props = schema['properties'] as Record<string, unknown>;
  const evidence = props['evidence'] as Record<string, unknown>;
  const items = evidence['items'] as Record<string, unknown>;
  const itemRequired = items['required'] as string[];
  const expected = ['source_path', 'body_sha256', 'line_start', 'line_end', 'quote', 'quote_sha256'];
  for (const field of expected) {
    assert.ok(itemRequired.includes(field), `evidence items.required must include "${field}"`);
  }
});
