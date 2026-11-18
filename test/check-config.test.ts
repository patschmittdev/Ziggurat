import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCheck } from '../src/cli/commands/check.js';
import type { CleanRoomReport } from '../src/eval/clean-room.js';

interface CheckRun {
  code: number;
  report: CleanRoomReport;
  stderr: string;
}

async function makeRepo(configText: string | null): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-check-'));
  await writeFile(join(root, 'README.md'), '# Fictional vault\n', 'utf8');
  if (configText !== null) {
    await mkdir(join(root, 'config'), { recursive: true });
    await writeFile(join(root, 'config', 'clean-room.yaml'), configText, 'utf8');
  }
  return root;
}

async function check(root: string): Promise<CheckRun> {
  let out = '';
  let err = '';
  const code = await runCheck(root, true, {
    stdout: text => { out += text; },
    stderr: text => { err += text; },
  });
  return { code, report: JSON.parse(out) as CleanRoomReport, stderr: err };
}

function configFindings(report: CleanRoomReport): CleanRoomReport['findings'] {
  return report.findings.filter(f => f.category === 'invalid-clean-room-config');
}

test('check: an absent clean-room config uses documented defaults and passes', async () => {
  const root = await makeRepo(null);
  try {
    const run = await check(root);
    assert.equal(run.code, 0);
    assert.equal(run.report.pass, true);
    assert.deepEqual(run.report.findings, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: an empty clean-room config uses documented defaults and passes', async () => {
  const root = await makeRepo('');
  try {
    const run = await check(root);
    assert.equal(run.code, 0);
    assert.equal(run.report.pass, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: a comments-only clean-room config uses documented defaults', async () => {
  const root = await makeRepo('# nothing configured yet\n');
  try {
    const run = await check(root);
    assert.equal(run.code, 0);
    assert.equal(run.report.pass, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: malformed YAML fails the audit instead of silently defaulting', async () => {
  const root = await makeRepo('project_names: [unterminated\n');
  try {
    const run = await check(root);
    assert.equal(run.code, 1);
    assert.equal(run.report.pass, false);
    const findings = configFindings(run.report);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.path, 'config/clean-room.yaml');
    assert.match(findings[0]?.detail ?? '', /YAML parse error/u);
    assert.match(run.stderr, /config\/clean-room\.yaml/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: an alias-expansion bomb fails the audit with a report, not a crash', async () => {
  // yaml's parseDocument does not resolve aliases, so this config has zero doc.errors
  // and only throws when the document is converted to JS. If that throw escaped
  // loadCleanRoomConfig, runCheck would emit no report at all and a JSON consumer
  // would get empty stdout for a config the audit is supposed to reject.
  const bomb = 'project_names: &a [x,x,x,x,x,x,x,x,x,x]\n'
    + 'exclude_paths: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\n'
    + 'z: [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\n';
  const root = await makeRepo(bomb);
  try {
    const run = await check(root);
    assert.equal(run.code, 1);
    assert.equal(run.report.pass, false);
    const findings = configFindings(run.report);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.path, 'config/clean-room.yaml');
    assert.match(findings[0]?.detail ?? '', /could not be resolved|alias/iu);
    assert.match(run.stderr, /config\/clean-room\.yaml/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: a non-mapping clean-room config fails the audit', async () => {
  const root = await makeRepo('- project_names\n- exclude_paths\n');
  try {
    const run = await check(root);
    assert.equal(run.code, 1);
    assert.match(
      configFindings(run.report)[0]?.detail ?? '',
      /top level must be a YAML mapping/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: an unknown clean-room config key fails the audit', async () => {
  const root = await makeRepo('project_names: []\nskip_everything: true\n');
  try {
    const run = await check(root);
    assert.equal(run.code, 1);
    const detail = configFindings(run.report)[0]?.detail ?? '';
    assert.match(detail, /unknown configuration keys: skip_everything/u);
    assert.match(detail, /Allowed keys are exclude_paths and project_names/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: a scalar where a list is required fails the audit', async () => {
  const root = await makeRepo('project_names: acme\n');
  try {
    const run = await check(root);
    assert.equal(run.code, 1);
    assert.match(
      configFindings(run.report)[0]?.detail ?? '',
      /"project_names" must be a list of strings/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: a non-string list entry fails the audit with its index', async () => {
  const root = await makeRepo('exclude_paths:\n  - ok.md\n  - 42\n');
  try {
    const run = await check(root);
    assert.equal(run.code, 1);
    assert.match(
      configFindings(run.report)[0]?.detail ?? '',
      /"exclude_paths\[1\]" must be a non-empty string/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: an unreadable clean-room config path fails the audit', async () => {
  const root = await makeRepo(null);
  try {
    // A directory where the config file belongs is present-but-unreadable.
    await mkdir(join(root, 'config', 'clean-room.yaml'), { recursive: true });
    const run = await check(root);
    assert.equal(run.code, 1);
    assert.match(
      configFindings(run.report)[0]?.detail ?? '',
      /configuration exists but could not be read/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: a valid clean-room config is actually applied', async () => {
  // The config file names the term itself, so it is excluded to keep the assertion
  // about notes.md rather than about the configuration file.
  const root = await makeRepo(
    'project_names:\n  - Nightingale\nexclude_paths:\n  - config/clean-room.yaml\n',
  );
  try {
    await writeFile(join(root, 'notes.md'), 'The Nightingale ledger.\n', 'utf8');
    const run = await check(root);
    assert.equal(run.code, 1);
    assert.ok(
      run.report.findings.some(
        f => f.category === 'personal-project-name' && f.path === 'notes.md',
      ),
      'the configured project name must be enforced',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check: configured exclude_paths suppress a finding in the named file', async () => {
  const root = await makeRepo(
    'project_names:\n  - Nightingale\nexclude_paths:\n'
    + '  - notes.md\n  - config/clean-room.yaml\n',
  );
  try {
    await writeFile(join(root, 'notes.md'), 'The Nightingale ledger.\n', 'utf8');
    const run = await check(root);
    assert.equal(run.code, 0);
    assert.equal(run.report.pass, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
