import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runCli, type CliIO } from '../src/cli/main.js';
import type { CleanRoomReport } from '../src/eval/clean-room.js';
import type { ConformanceReport } from '../src/eval/conformance.js';
import { renderCleanRoomMarkdown, renderConformanceMarkdown } from '../src/eval/report.js';
import { safeJsonStringify } from '../src/presentation/inert.js';

const LIVE_CONTROLS =
  /[\x00-\x09\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const HOSTILE = 'before\\literal\\u009b"\u0000\t\u001b[2J\u007f\u0085\u009b31m\u202e\u2066\r\nnext\rlast\nend';
const INERT = 'before\\literal\\u009b"\\u0000\\u0009\\u001b[2J\\u007f\\u0085\\u009b31m\\u202e\\u2066\\nnext\\nlast\\nend';

// C1, bidi, and Unicode line separators are permitted in Windows filenames too.
const HOSTILE_NAME = 'note-\u009b31m\u202e\u2028.md';
const INERT_NAME = 'note-\\u009b31m\\u202e\\u2028.md';

function captureIO(): { io: CliIO; captured: { out: string; err: string } } {
  const captured = { out: '', err: '' };
  return {
    captured,
    io: {
      stdout: text => { captured.out += text; },
      stderr: text => { captured.err += text; },
    },
  };
}

test('clean-room Markdown renders every finding string as inert single-line text', () => {
  const report: CleanRoomReport = {
    pass: false,
    findings: [{ path: HOSTILE, line: 7, category: HOSTILE, detail: HOSTILE }],
  };
  const before = structuredClone(report);
  const rendered = renderCleanRoomMarkdown(report);

  assert.equal(rendered, `# Clean-Room Audit: FAIL\n\n- ${INERT}:7 [${INERT}] ${INERT}`);
  assert.doesNotMatch(rendered, LIVE_CONTROLS);
  assert.deepEqual(report, before);
});

test('conformance Markdown renders case IDs and details as inert single-line text', () => {
  const report: ConformanceReport = {
    pass: false,
    cases_run: 2,
    passed: 1,
    failed: 1,
    findings: [
      { case_id: HOSTILE, passed: true, detail: HOSTILE },
      { case_id: HOSTILE, passed: false, detail: HOSTILE },
    ],
  };
  const before = structuredClone(report);
  const rendered = renderConformanceMarkdown(report);

  assert.equal(
    rendered,
    '# Conformance Report: FAIL\n\nCases: 2 | Passed: 1 | Failed: 1\n\n'
      + `\u2713 ${INERT}: ${INERT}\n\u2717 ${INERT}: ${INERT}`,
  );
  assert.doesNotMatch(rendered, LIVE_CONTROLS);
  assert.deepEqual(report, before);
});

test('report renderers preserve ordinary wording, punctuation, and backslashes', () => {
  assert.equal(
    renderCleanRoomMarkdown({ pass: true, findings: [] }),
    '# Clean-Room Audit: PASS\n\nNo findings.',
  );
  assert.equal(
    renderCleanRoomMarkdown({
      pass: false,
      findings: [{ path: 'notes\\example.md', line: 3, category: 'example', detail: 'Review this file.' }],
    }),
    '# Clean-Room Audit: FAIL\n\n- notes\\example.md:3 [example] Review this file.',
  );
  assert.equal(
    renderConformanceMarkdown({
      pass: true,
      cases_run: 1,
      passed: 1,
      failed: 0,
      findings: [{ case_id: 'C001', passed: true, detail: 'Passed correctly.' }],
    }),
    '# Conformance Report: PASS\n\nCases: 1 | Passed: 1 | Failed: 0\n\n\u2713 C001: Passed correctly.',
  );
});

test('safe JSON remains render-safe and byte-exact after parsing, including literal escapes', () => {
  const value = {
    path: HOSTILE,
    body: `${HOSTILE}\n\\n\\r\\u202e\\\\end`,
    detail: '\u061c\u200e\u200f\u2028\u2029\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069',
  };
  for (const space of [undefined, 2]) {
    const rendered = safeJsonStringify(value, space);
    const decoded = JSON.parse(rendered) as typeof value;
    assert.doesNotMatch(rendered, LIVE_CONTROLS);
    assert.deepEqual(decoded, JSON.parse(JSON.stringify(value)));
    for (const field of ['path', 'body', 'detail'] as const) {
      assert.deepEqual(Buffer.from(decoded[field], 'utf8'), Buffer.from(value[field], 'utf8'));
    }
  }
});

test('init CLI renders real hostile roots inertly without changing the initialized path', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ziggurat-inert-init-'));
  const root = join(base, 'vault-\u009b31m\u202e\u2028');
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { io, captured } = captureIO();
      assert.equal(await runCli(['init', '--root', root], io), 0);
      assert.equal(captured.out, `Initialized Ziggurat vault at ${join(base, 'vault-\\u009b31m\\u202e\\u2028')}\n`);
      assert.doesNotMatch(captured.out, LIVE_CONTROLS);
      assert.equal(captured.err, '');
    }
    assert.match(await readFile(join(root, 'config', 'ziggurat.yaml'), 'utf8'), /^schema_version: 1\n/u);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('ingest CLI renders duplicate Bronze paths inertly while machine JSON retains exact filenames', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-inert-ingest-'));
  const body = 'An ordinary captured note.\n';
  const inboxPath = join(root, 'inbox', 'note.md');
  try {
    const initialized = captureIO();
    assert.equal(await runCli(['init', '--root', root], initialized.io), 0);
    assert.equal(initialized.captured.out, `Initialized Ziggurat vault at ${root}\n`);
    assert.equal(initialized.captured.err, '');
    await writeFile(inboxPath, body, 'utf8');
    const created = captureIO();
    assert.equal(await runCli(['ingest', '--root', root, '--file', 'inbox/note.md'], created.io), 0);
    const bronzeDir = join(root, 'bronze', 'article');
    const files = await readdir(bronzeDir);
    assert.equal(files.length, 1);
    const filename = files[0];
    assert.ok(filename !== undefined);
    assert.equal(created.captured.out, `created: bronze/article/${filename}\n`);
    assert.equal(created.captured.err, '');

    // New ingest paths are slugified; duplicate lookup returns existing Bronze names.
    await rename(join(bronzeDir, filename), join(bronzeDir, HOSTILE_NAME));
    await writeFile(inboxPath, body, 'utf8');
    const human = captureIO();
    assert.equal(await runCli(['ingest', '--root', root, '--file', 'inbox/note.md'], human.io), 0);
    assert.equal(human.captured.out, `duplicate: bronze/article/${INERT_NAME}\n`);
    assert.doesNotMatch(human.captured.out, LIVE_CONTROLS);
    assert.equal(human.captured.err, '');

    const machine = captureIO();
    assert.equal(await runCli(['ingest', '--root', root, '--file', 'inbox/note.md', '--json'], machine.io), 0);
    const result = JSON.parse(machine.captured.out) as { status: string; source_path: string };
    assert.equal(result.status, 'duplicate');
    assert.deepEqual(Buffer.from(result.source_path, 'utf8'), Buffer.from(`bronze/article/${HOSTILE_NAME}`, 'utf8'));
    assert.equal(machine.captured.err, '');
    assert.equal(await readFile(inboxPath, 'utf8'), body);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check CLI renders real finding paths and details inertly while JSON retains their exact values', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-inert-check-'));
  try {
    await writeFile(join(root, HOSTILE_NAME), Buffer.from([0xff]));
    const human = captureIO();
    assert.equal(await runCli(['check', '--root', root, '--audit-clean-room'], human.io), 1);
    assert.equal(
      human.captured.out,
      '# Clean-Room Audit: FAIL\n\n'
        + `- ${INERT_NAME}:0 [unscannable-file] File is not valid UTF-8 text. `
        + `Review it and add an explicit clean-room exclusion if it is safe: ${INERT_NAME}\n`,
    );
    assert.doesNotMatch(human.captured.out, LIVE_CONTROLS);
    assert.equal(human.captured.err, '');

    const machine = captureIO();
    assert.equal(await runCli(['check', '--root', root, '--audit-clean-room', '--json'], machine.io), 1);
    const report = JSON.parse(machine.captured.out) as CleanRoomReport;
    assert.deepEqual(report, {
      pass: false,
      findings: [{
        path: HOSTILE_NAME,
        category: 'unscannable-file',
        line: 0,
        detail: 'File is not valid UTF-8 text. Review it and add an explicit clean-room exclusion if it is safe: '
          + HOSTILE_NAME,
      }],
    });
    assert.equal(machine.captured.err, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check CLI renders unknown config keys inertly on stderr without changing JSON diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-inert-config-'));
  const prefix = 'config/clean-room.yaml: unknown configuration keys: ';
  const suffix = '. Allowed keys are exclude_paths and project_names.';
  const inertDetail = `${prefix}${INERT}${suffix}`;
  try {
    await mkdir(join(root, 'config'));
    await writeFile(join(root, 'config', 'clean-room.yaml'), `${JSON.stringify(HOSTILE)}: true\n`, 'utf8');
    for (const json of [false, true]) {
      const { io, captured } = captureIO();
      const args = ['check', '--root', root, '--audit-clean-room', ...(json ? ['--json'] : [])];
      assert.equal(await runCli(args, io), 1);
      assert.equal(captured.err, `error: ${inertDetail}\n`);
      assert.doesNotMatch(captured.err, LIVE_CONTROLS);
      if (json) {
        const report = JSON.parse(captured.out) as CleanRoomReport;
        assert.deepEqual(report, {
          pass: false,
          findings: [{
            path: 'config/clean-room.yaml',
            category: 'invalid-clean-room-config',
            line: 0,
            detail: `${prefix}${HOSTILE}${suffix}`,
          }],
        });
      } else {
        assert.equal(
          captured.out,
          '# Clean-Room Audit: FAIL\n\n'
            + `- config/clean-room.yaml:0 [invalid-clean-room-config] ${inertDetail}\n`,
        );
        assert.doesNotMatch(captured.out, LIVE_CONTROLS);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
