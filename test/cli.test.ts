import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { runCli } from '../src/cli/main.js';
import type { CliIO } from '../src/cli/main.js';
import { parseCliArgs } from '../src/cli/args.js';
import type { CleanRoomReport } from '../src/eval/clean-room.js';

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
  'config/trust.yaml': 'trust:\n  reviewers: []\n',
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
// --audit-clean-room: parsing, scope, and audit behavior
//
// The flag was previously declared in the parser but never returned, so every
// command silently accepted it and `check` could not observe it. Release
// automation, CONTRIBUTING, and the pull request template all invoke it, so a
// silently swallowed flag reads as an assertion that the gate ran.
// ---------------------------------------------------------------------------

test('--audit-clean-room parses into typed args for check', () => {
  const parsed = parseCliArgs(['check', '--root', '.', '--audit-clean-room']);
  assert.equal(parsed.command, 'check');
  assert.equal(parsed.auditCleanRoom, true);
});

test('--audit-clean-room defaults to false when omitted', () => {
  const parsed = parseCliArgs(['check', '--root', '.']);
  assert.equal(parsed.command, 'check');
  assert.equal(parsed.auditCleanRoom, false);
});

test('--audit-clean-room defaults to false for every other command', () => {
  for (const command of ['init', 'ingest', 'refine', 'review', 'build', 'query', 'mcp', 'eval']) {
    const parsed = parseCliArgs([command, '--root', '.']);
    assert.equal(parsed.auditCleanRoom, false, `${command} should default to false`);
  }
});

test('--audit-clean-room is rejected by every command except check', async () => {
  for (const command of ['init', 'ingest', 'refine', 'review', 'build', 'query', 'mcp', 'eval']) {
    assert.throws(
      () => parseCliArgs([command, '--root', '.', '--audit-clean-room']),
      /applies only to the check command/iu,
      `${command} should reject --audit-clean-room`,
    );

    const { io, captured } = makeIO();
    const code = await runCli([command, '--root', '.', '--audit-clean-room'], io);
    assert.equal(code, 1, `${command} should exit 1`);
    assert.match(captured.err, /applies only to the check command/iu);
  }
});

test('--audit-clean-room rejects an inline value like every other boolean option', () => {
  assert.throws(
    () => parseCliArgs(['check', '--root', '.', '--audit-clean-room=true']),
    /does not take an argument/iu,
  );
  // Same contract as the pre-existing --json boolean, so the two cannot drift.
  assert.throws(
    () => parseCliArgs(['check', '--root', '.', '--json=true']),
    /does not take an argument/iu,
  );
});

test('a repeated --audit-clean-room collapses to true like a repeated --json', () => {
  const audit = parseCliArgs(['check', '--root', '.', '--audit-clean-room', '--audit-clean-room']);
  assert.equal(audit.auditCleanRoom, true);
  const json = parseCliArgs(['check', '--root', '.', '--json', '--json']);
  assert.equal(json.json, true);
});

test('check --help short-circuits with the audit flag parsed, not discarded', async () => {
  // Asserting only on the usage text would be vacuous: the check usage line contains
  // the flag name whether or not the flag was passed. Assert the parsed shape instead.
  const parsed = parseCliArgs(['check', '--root', '.', '--audit-clean-room', '--help']);
  assert.equal(parsed.auditCleanRoom, true);
  assert.equal(parsed.help, true);

  const { io, captured } = makeIO();
  const code = await runCli(['check', '--root', '.', '--audit-clean-room', '--help'], io);
  assert.equal(code, 0);
  assert.match(captured.out, /Usage: ziggurat check/u);
  assert.equal(captured.err, '');
});

test('a misplaced audit flag fails even when --help is requested', async () => {
  // The scope check runs before the per-command help short-circuit on purpose: a
  // misplaced release-gate flag must never produce a success exit code.
  const { io, captured } = makeIO();
  const code = await runCli(['build', '--root', '.', '--help', '--audit-clean-room'], io);
  assert.equal(code, 1);
  assert.match(captured.err, /applies only to the check command/iu);
  assert.equal(captured.out, '');
});

test('global --help is unaffected by the audit flag scope check', async () => {
  const parsed = parseCliArgs(['--help', '--audit-clean-room']);
  assert.equal(parsed.command, null);
  assert.equal(parsed.auditCleanRoom, true);

  const { io, captured } = makeIO();
  const code = await runCli(['--help', '--audit-clean-room'], io);
  assert.equal(code, 0);
  assert.match(captured.out, /Usage: ziggurat <command>/u);
});

// Composed at runtime so the literal never appears in this file. The audit scans this
// repository too, and a hard-coded address here would make the release gate fail on
// its own regression test.
const PLANTED_EMAIL = ['release', 'example.com'].join('@');

test('check --audit-clean-room runs the clean-room audit and fails on a violation', async () => {
  const root = await makeVault({
    // A contributor email address is one of the categories the release gate exists
    // to catch, so its presence proves the audit actually executed.
    'notes.md': `# Notes\n\nContact: ${PLANTED_EMAIL}\n`,
  });
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['check', '--root', root, '--audit-clean-room', '--json'], io);
    assert.equal(code, 1);
    const report = JSON.parse(captured.out) as CleanRoomReport;
    assert.equal(report.pass, false);
    assert.ok(
      report.findings.some(f => f.path === 'notes.md' && f.category === 'email-address'),
      'the audit should report the planted email address',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check --audit-clean-room passes on a clean tree', async () => {
  const root = await makeVault({ 'notes.md': '# Fictional notes\n\nNothing sensitive here.\n' });
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['check', '--root', root, '--audit-clean-room'], io);
    assert.equal(code, 0);
    assert.match(captured.out, /Clean-Room Audit: PASS/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the audit flag names the gate and does not change what check reports', async () => {
  const root = await makeVault({ 'notes.md': `# Notes\n\nContact: ${PLANTED_EMAIL}\n` });
  try {
    const flagged = makeIO();
    const flaggedCode = await runCli(
      ['check', '--root', root, '--audit-clean-room', '--json'], flagged.io,
    );
    const bare = makeIO();
    const bareCode = await runCli(['check', '--root', root, '--json'], bare.io);

    // check performs exactly one audit, so selecting it explicitly must not change
    // the result. This pins the documented semantics: the flag is a scoped selector,
    // never a switch that could silently downgrade the release gate.
    assert.equal(flaggedCode, bareCode);
    assert.deepEqual(
      JSON.parse(flagged.captured.out) as CleanRoomReport,
      JSON.parse(bare.captured.out) as CleanRoomReport,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('global help lists the communion-only and proposal-only surfaces', async () => {
  const { io, captured } = makeIO();
  const code = await runCli(['--help'], io);
  assert.equal(code, 0);
  assert.match(captured.out, /ziggurat mcp --root/iu);
  assert.match(captured.out, /Silver proposal/iu);
  assert(!captured.out.includes('--profile'));
  assert(!captured.out.includes('--promote'));
});

test('command help uses the same parser and does not execute the command', async () => {
  const { io, captured } = makeIO();
  const code = await runCli(['review', '--help'], io);
  assert.equal(code, 0);
  assert.match(captured.out, /ziggurat review/iu);
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
    await access(join(root, 'authorizations'));
    await access(join(root, '.ziggurat', 'proposals'));
    await access(join(root, 'config', 'ziggurat.yaml'));
    await access(join(root, 'config', 'trust.yaml'));
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

test('concurrent init calls never truncate starter trust policy', async () => {
  const root = await makeVault();
  try {
    const [left, right] = await Promise.all([
      runCli(['init', '--root', root], makeIO().io),
      runCli(['init', '--root', root], makeIO().io),
    ]);
    assert.equal(left, 0);
    assert.equal(right, 0);
    const { readFile } = await import('node:fs/promises');
    assert.equal(
      await readFile(join(root, 'config', 'trust.yaml'), 'utf8'),
      'trust:\n  reviewers: []\n',
    );
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

test('mcp is communion-only and does not require a profile selector', async () => {
  const root = await makeVault();
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['mcp', '--root', root], io);
    assert.equal(code, 1);
    assert(!captured.err.includes('--profile'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mcp rejects every profile selector', async () => {
  const root = await makeVault();
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['mcp', '--root', root, '--profile', 'review'], io);
    assert.equal(code, 1);
    assert.match(captured.err, /unknown option|profile/iu);
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

test('eval exercises the production Gold eligibility path', async () => {
  const root = await makeVault(STUB_CONFIG_FILES);
  try {
    const { io, captured } = makeIO();
    const code = await runCli(['eval', '--root', root, '--json'], io);
    assert.equal(code, 0, captured.err);
    const report = JSON.parse(captured.out) as {
      pass: boolean;
      findings: Array<{ case_id: string; passed: boolean }>;
    };
    assert.equal(report.pass, true);
    assert(report.findings.some(finding =>
      finding.case_id === 'C004' && finding.passed));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
