import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli/main.js';
import type { CliIO } from '../src/cli/main.js';

interface IOCapture { out: string; err: string; }

function makeIO(): { captured: IOCapture; io: CliIO } {
  const captured: IOCapture = { out: '', err: '' };
  const io: CliIO = {
    stdout: (t) => { captured.out += t; },
    stderr: (t) => { captured.err += t; },
  };
  return { captured, io };
}

async function makeVault(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-cli-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(root, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return root;
}

const STUB_CONFIG_FILES = {
  'config/ziggurat.yaml': 'schema_version: 1\nlifecycle:\n  review_queue_limit: 5\n',
  'config/domain.yaml': 'domain:\n  page_types: [concept]\n  tags: [ai]\n',
  'config/privacy.yaml': 'privacy:\n  default_sensitivity: restricted\n  default_pii: unknown\n',
  'config/adapters.yaml': 'adapters: {}\n',
};

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

test('unknown command returns exit code 1', async () => {
  const { io, captured } = makeIO();
  const code = await runCli(['nonexistent-command'], io);
  assert.equal(code, 1);
  assert.match(captured.err, /unknown command/iu);
});

test('unknown flag returns exit code 1', async () => {
  const { io } = makeIO();
  const code = await runCli(['init', '--unknown-flag'], io);
  assert.equal(code, 1);
});

test('--promote flag is rejected', async () => {
  const { io } = makeIO();
  const code = await runCli(['build', '--promote'], io);
  assert.equal(code, 1);
});

test('no command returns exit code 1', async () => {
  const { io } = makeIO();
  const code = await runCli([], io);
  assert.equal(code, 1);
});

// ---------------------------------------------------------------------------
// init command
// ---------------------------------------------------------------------------

test('init creates starter directories', async () => {
  const root = await makeVault();
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['init', '--root', root], io);
    assert.equal(code, 0);
    assert.match(captured.out, /initialized/iu);
    const { access } = await import('node:fs/promises');
    await access(join(root, 'bronze'));
    await access(join(root, 'knowledge'));
    await access(join(root, '.ziggurat', 'proposals'));
    await access(join(root, 'config', 'ziggurat.yaml'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('init is idempotent', async () => {
  const root = await makeVault();
  try {
    assert.equal(await runCli(['init', '--root', root], makeIO().io), 0);
    assert.equal(await runCli(['init', '--root', root], makeIO().io), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('init does not overwrite existing config', async () => {
  const root = await makeVault({
    'config/ziggurat.yaml': 'schema_version: 1\nlifecycle:\n  review_queue_limit: 99\n',
    'config/domain.yaml': 'domain:\n  page_types: [concept]\n  tags: [ai]\n',
    'config/privacy.yaml': 'privacy:\n  default_sensitivity: restricted\n  default_pii: unknown\n',
    'config/adapters.yaml': 'adapters: {}\n',
  });
  try {
    await runCli(['init', '--root', root], makeIO().io);
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(join(root, 'config', 'ziggurat.yaml'), 'utf8');
    assert.match(content, /review_queue_limit: 99/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ingest command
// ---------------------------------------------------------------------------

test('ingest requires --file', async () => {
  const root = await makeVault();
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['ingest', '--root', root], io);
    assert.equal(code, 1);
    assert.match(captured.err, /--file/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ingest creates Bronze record', async () => {
  const root = await makeVault({ 'inbox/source.md': '# Source\n\nContent here.\n' });
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['ingest', '--root', root, '--file', 'inbox/source.md'], io);
    assert.equal(code, 0);
    assert.match(captured.out, /created/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('ingest --json outputs JSON', async () => {
  const root = await makeVault({ 'inbox/source.md': '# Source\n\nContent.\n' });
  try {
    const { io, captured } = makeIO();
    await runCli(['ingest', '--root', root, '--file', 'inbox/source.md', '--json'], io);
    const parsed = JSON.parse(captured.out);
    assert(typeof parsed.status === 'string');
    assert(typeof parsed.source_path === 'string');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// refine command
// ---------------------------------------------------------------------------

test('refine requires --query', async () => {
  const root = await makeVault();
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['refine', '--root', root], io);
    assert.equal(code, 1);
    assert.match(captured.err, /--query/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('refine requires model endpoint in config', async () => {
  const root = await makeVault(STUB_CONFIG_FILES);
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['refine', '--root', root, '--query', 'test'], io);
    assert.equal(code, 1);
    assert.match(captured.err, /model_endpoint/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// mcp command
// ---------------------------------------------------------------------------

test('mcp requires --profile', async () => {
  const root = await makeVault();
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['mcp', '--root', root], io);
    assert.equal(code, 1);
    assert.match(captured.err, /--profile/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mcp rejects unknown profile', async () => {
  const root = await makeVault();
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['mcp', '--root', root, '--profile', 'admin'], io);
    assert.equal(code, 1);
    assert.match(captured.err, /unknown profile/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// query command
// ---------------------------------------------------------------------------

test('query requires --query flag', async () => {
  const root = await makeVault();
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['query', '--root', root], io);
    assert.equal(code, 1);
    assert.match(captured.err, /--query/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('query always uses communion (fails with missing index, not wrong profile)', async () => {
  const root = await makeVault();
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['query', '--root', root, '--query', 'test'], io);
    assert.equal(code, 1);
    assert(captured.err.length > 0, 'expected error about missing index');
    assert(!captured.err.includes('--profile'), 'should not mention --profile');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// review command
// ---------------------------------------------------------------------------

test('review outputs empty queue markdown for empty vault', async () => {
  const root = await makeVault(STUB_CONFIG_FILES);
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['review', '--root', root], io);
    assert.equal(code, 0);
    assert(captured.out.length > 0, 'expected output');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('review --json outputs parseable JSON', async () => {
  const root = await makeVault(STUB_CONFIG_FILES);
  try {
    const { io, captured } = makeIO();
    await runCli(['review', '--root', root, '--json'], io);
    const parsed = JSON.parse(captured.out);
    assert(typeof parsed.count === 'number');
    assert(Array.isArray(parsed.entries));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// build command
// ---------------------------------------------------------------------------

test('build --json outputs index statistics', async () => {
  const root = await makeVault({});
  try {
    await runCli(['init', '--root', root], makeIO().io);
    const { io, captured } = makeIO();
    await runCli(['build', '--root', root, '--json'], io);
    const parsed = JSON.parse(captured.out);
    assert(typeof parsed.gold_chunks === 'number');
    assert(typeof parsed.review_chunks === 'number');
    assert(typeof parsed.evidence_chunks === 'number');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
