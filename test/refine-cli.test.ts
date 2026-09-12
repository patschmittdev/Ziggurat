import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { sha256Text } from '../src/bronze/canonical.js';
import { normalizeText } from '../src/authorization/canonical.js';
import { RefinementProposalSchema } from '../src/contracts/proposal.js';
import { parseCliArgs } from '../src/cli/args.js';

const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
const sourceBody = '# Release note\nVersion 1.2.3 fixes ERR_CONN.\n';
const originalPage = '# Release note\nVersion 1.2.2 still has ERR_CONN.\n';

test('--target is scoped to refine even when displaying command help', () => {
  assert.equal(parseCliArgs(['refine', '--target', 'knowledge/release.md']).target, 'knowledge/release.md');
  for (const command of ['init', 'ingest', 'review', 'build', 'query', 'mcp', 'eval', 'check']) {
    assert.throws(() => parseCliArgs([command, '--target', 'knowledge/release.md', '--help']), /only to the refine/u);
  }
});

for (const operation of ['create', 'amend', 'contradict'] as const) {
  test(`executable CLI ingests, refines and reviews a ${operation} draft`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ziggurat-refine-cli-'));
    let observed = false;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const input = JSON.parse(request.messages[1].content);
        assert.equal(request.model, 'fixture-model');
        assert.equal(request.stream, false);
        assert.equal(input.bronze_sources.sources[0].source_id, 'source-1');
        assert.deepEqual(input.bronze_sources.sources[0].lines, [
          { line_number: 1, text: '# Release note' },
          { line_number: 2, text: 'Version 1.2.3 fixes ERR_CONN.' },
        ]);
        assert.equal(input.request.existing_content, operation === 'create' ? undefined : originalPage);
        observed = true;
        const evidence = [{ source_id: 'source-1', line_start: 2, line_end: 2 }];
        const draft = {
          schema_version: 1,
          operation,
          target_path: 'knowledge/release.md',
          candidate: {
            title: 'Release note', type: 'concept', retrieval_eligible: false,
            pii: 'unknown', sensitivity: 'restricted', visibility: 'internal',
            egress: 'local-only', body: '# Release note\nVersion 1.2.3 fixes ERR_CONN.\n',
          },
          evidence,
          contradictions: operation === 'contradict'
            ? [{ summary: 'The old page does not record the fix.', evidence }] : [],
          confidence: 'medium',
          affected_paths: [], related_paths: [], unresolved_questions: [],
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(draft) } }],
        }));
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address !== null && typeof address !== 'string');
    try {
      await exec(process.execPath, [cliPath, 'init', '--root', root]);
      await writeFile(join(root, 'config', 'adapters.yaml'),
        `adapters:\n  model_endpoint: http://127.0.0.1:${address.port}/v1/chat/completions\n  model_name: fixture-model\n`);
      await writeFile(join(root, 'inbox', 'release.md'), sourceBody);
      const capture = await exec(process.execPath, [cliPath, 'ingest', '--root', root, '--file', 'inbox/release.md', '--json']);
      const sourcePath = (JSON.parse(capture.stdout) as { source_path: string }).source_path;
      if (operation !== 'create') await writeFile(join(root, 'knowledge', 'release.md'), originalPage);
      const bronzeBefore = await readFile(join(root, sourcePath), 'utf8');
      const trustBefore = await readFile(join(root, 'config', 'trust.yaml'), 'utf8');
      const result = await exec(process.execPath, [
        cliPath, 'refine', '--root', root, '--query', 'Explain the fix',
        '--source', sourcePath, '--target', 'knowledge/release.md', '--json',
      ]);
      assert.equal(observed, true);
      const staged = JSON.parse(result.stdout) as { staged: string };
      const proposal = RefinementProposalSchema.parse(JSON.parse(await readFile(staged.staged, 'utf8')));
      assert.equal(proposal.schema_version, 2);
      assert.equal(proposal.evidence[0]?.quote, 'Version 1.2.3 fixes ERR_CONN.');
      assert.equal(proposal.evidence[0]?.quote_sha256, sha256Text('Version 1.2.3 fixes ERR_CONN.'));
      assert.deepEqual(proposal.candidate.sources, [sourcePath]);
      assert.equal(proposal.base_content_sha256,
        operation === 'create' ? undefined : sha256Text(normalizeText(originalPage)));
      const review = await exec(process.execPath, [cliPath, 'review', '--root', root]);
      assert.match(review.stdout, /UNTRUSTED REFERENCE/u);
      assert.match(review.stdout, /Version 1\.2\.3 fixes ERR_CONN/u);
      assert.equal(await readFile(join(root, sourcePath), 'utf8'), bronzeBefore);
      assert.equal(await readFile(join(root, 'config', 'trust.yaml'), 'utf8'), trustBefore);
      assert.deepEqual(await readdir(join(root, 'authorizations')), []);
      assert.deepEqual(await readdir(join(root, '.ziggurat')), ['proposals']);
      if (operation === 'create') assert.deepEqual(await readdir(join(root, 'knowledge')), []);
      else assert.equal(await readFile(join(root, 'knowledge', 'release.md'), 'utf8'), originalPage);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('executable refine exposes structured failure and omitted-source diagnostics without a model call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-refine-empty-'));
  try {
    await exec(process.execPath, [cliPath, 'init', '--root', root]);
    await writeFile(join(root, 'config', 'adapters.yaml'),
      'adapters:\n  model_endpoint: http://127.0.0.1:1/v1/chat/completions\n');
    await assert.rejects(
      () => exec(process.execPath, [cliPath, 'refine', '--root', root, '--query', 'missing',
        '--source', 'bronze/missing.md', '--json']),
      (error: unknown) => {
        assert.ok(error instanceof Error && 'stderr' in error && 'stdout' in error);
        assert.equal(error.stdout, '');
        assert.equal(typeof error.stderr, 'string');
        const stderr = String(error.stderr);
        assert.match(stderr, /not-found/u);
        const last = stderr.trim().split('\n').at(-1) ?? '';
        assert.equal((JSON.parse(last) as { error: { code: string } }).error.code, 'no-evidence');
        return true;
      },
    );
    assert.deepEqual(await readdir(join(root, '.ziggurat', 'proposals')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
