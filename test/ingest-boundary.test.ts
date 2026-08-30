import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ingestCapture, resolveInboxSourcePath } from '../src/bronze/ingest.js';

const NOW = new Date('2026-01-02T03:04:05.000Z');
const OPTIONS = { now: NOW, sourceKind: 'article' } as const;
const SECRET = '# External secret\nThis file lives outside the vault.\n';

interface Scenario {
  root: string;
  outside: string;
  outsideFile: string;
}

async function makeScenario(): Promise<Scenario> {
  const base = await mkdtemp(join(tmpdir(), 'ziggurat-ingest-'));
  const root = join(base, 'vault');
  const outside = join(base, 'outside');
  await mkdir(join(root, 'inbox'), { recursive: true });
  await mkdir(outside, { recursive: true });
  const outsideFile = join(outside, 'secret.md');
  await writeFile(outsideFile, SECRET, 'utf8');
  return { root, outside, outsideFile };
}

async function cleanup(scenario: Scenario): Promise<void> {
  await rm(join(scenario.root, '..'), { recursive: true, force: true });
}

async function bronzeFileCount(root: string): Promise<number> {
  const entries = await readdir(join(root, 'bronze'), {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  return entries.filter(entry => entry.isFile()).length;
}

/** Asserts the source was refused and that nothing outside the vault was touched. */
async function assertRefused(
  scenario: Scenario,
  inboxPath: string,
  expected: RegExp,
): Promise<void> {
  await assert.rejects(
    () => ingestCapture(scenario.root, inboxPath, OPTIONS),
    expected,
    `expected ingest to refuse ${inboxPath}`,
  );
  assert.equal(
    await readFile(scenario.outsideFile, 'utf8'),
    SECRET,
    'the external file must not be deleted or modified',
  );
  assert.equal(
    await bronzeFileCount(scenario.root),
    0,
    'a refused source must not be copied into bronze/',
  );
}

test('ingest: refuses an absolute path and never reads or deletes it', async () => {
  const scenario = await makeScenario();
  try {
    await assertRefused(scenario, scenario.outsideFile, /relative to the vault root/u);
  } finally {
    await cleanup(scenario);
  }
});

test('ingest: refuses a POSIX traversal escape from inbox/', async () => {
  const scenario = await makeScenario();
  try {
    await assertRefused(
      scenario,
      'inbox/../../outside/secret.md',
      /must not contain \. or \.\. segments/u,
    );
  } finally {
    await cleanup(scenario);
  }
});

test('ingest: refuses a Windows-style backslash traversal escape', async () => {
  const scenario = await makeScenario();
  try {
    await assertRefused(
      scenario,
      'inbox\\..\\..\\outside\\secret.md',
      /must not contain \. or \.\. segments/u,
    );
  } finally {
    await cleanup(scenario);
  }
});

test('ingest: refuses a path inside the vault but outside inbox/', async () => {
  const scenario = await makeScenario();
  try {
    await mkdir(join(scenario.root, 'notes'), { recursive: true });
    await writeFile(join(scenario.root, 'notes', 'private.md'), SECRET, 'utf8');
    await assert.rejects(
      () => ingestCapture(scenario.root, 'notes/private.md', OPTIONS),
      /must be a path under inbox\//u,
    );
    assert.equal(
      await readFile(join(scenario.root, 'notes', 'private.md'), 'utf8'),
      SECRET,
      'a refused in-vault source must not be deleted',
    );
    assert.equal(await bronzeFileCount(scenario.root), 0);
  } finally {
    await cleanup(scenario);
  }
});

test('ingest: refuses a bare inbox/ directory reference', async () => {
  const scenario = await makeScenario();
  try {
    await assert.rejects(
      () => ingestCapture(scenario.root, 'inbox', OPTIONS),
      /must be a path under inbox\//u,
    );
  } finally {
    await cleanup(scenario);
  }
});

test('ingest: refuses a directory inside inbox/', async () => {
  const scenario = await makeScenario();
  try {
    await mkdir(join(scenario.root, 'inbox', 'batch'), { recursive: true });
    await assert.rejects(
      () => ingestCapture(scenario.root, 'inbox/batch', OPTIONS),
      /must be a regular file/u,
    );
    assert.ok((await stat(join(scenario.root, 'inbox', 'batch'))).isDirectory());
  } finally {
    await cleanup(scenario);
  }
});

test('ingest: refuses control characters in the source path', async () => {
  const scenario = await makeScenario();
  try {
    await assertRefused(
      scenario,
      'inbox/note\u0000.md',
      /must not contain control characters/u,
    );
  } finally {
    await cleanup(scenario);
  }
});

test('ingest: refuses empty path segments', async () => {
  const scenario = await makeScenario();
  try {
    await assertRefused(
      scenario,
      'inbox//secret.md',
      /must not contain empty path segments/u,
    );
  } finally {
    await cleanup(scenario);
  }
});

test('ingest: refuses a symlink inside inbox/ that points outside the vault', async () => {
  const scenario = await makeScenario();
  try {
    const link = join(scenario.root, 'inbox', 'linked.md');
    try {
      await symlink(scenario.outsideFile, link, 'file');
    } catch (error) {
      // Creating symlinks requires elevation or Developer Mode on Windows.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') return;
      throw error;
    }
    await assertRefused(
      scenario,
      'inbox/linked.md',
      /must not be a symbolic link, junction, or reparse point/u,
    );
  } finally {
    await cleanup(scenario);
  }
});

test('ingest: refuses a source whose parent directory is a symlink escaping inbox/', async () => {
  const scenario = await makeScenario();
  try {
    const linkedDir = join(scenario.root, 'inbox', 'linked');
    try {
      await symlink(scenario.outside, linkedDir, 'dir');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') return;
      throw error;
    }
    await assertRefused(
      scenario,
      'inbox/linked/secret.md',
      /resolves outside inbox\//u,
    );
  } finally {
    await cleanup(scenario);
  }
});

test('ingest: refuses when inbox/ itself is a symlink to a directory outside the vault', async () => {
  const base = await mkdtemp(join(tmpdir(), 'ziggurat-ingest-'));
  try {
    const root = join(base, 'vault');
    const outside = join(base, 'outside');
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    const outsideFile = join(outside, 'secret.md');
    await writeFile(outsideFile, SECRET, 'utf8');
    try {
      await symlink(outside, join(root, 'inbox'), 'dir');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOSYS') return;
      throw error;
    }
    await assert.rejects(() => ingestCapture(root, 'inbox/secret.md', OPTIONS));
    assert.equal(await readFile(outsideFile, 'utf8'), SECRET);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('ingest: still accepts a nested inbox path and removes only that source', async () => {
  const scenario = await makeScenario();
  try {
    const nestedDir = join(scenario.root, 'inbox', '2026', 'january');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, 'report.md'), '# Nested report\n', 'utf8');

    const result = await ingestCapture(
      scenario.root,
      'inbox/2026/january/report.md',
      OPTIONS,
    );

    assert.equal(result.status, 'created');
    assert.equal(result.source_path, 'bronze/article/2026-01-02-report.md');
    assert.equal(await bronzeFileCount(scenario.root), 1);
    await assert.rejects(() => stat(join(nestedDir, 'report.md')));
    assert.equal(await readFile(scenario.outsideFile, 'utf8'), SECRET);
  } finally {
    await cleanup(scenario);
  }
});

test('resolveInboxSourcePath: returns a real path under the real inbox directory', async () => {
  const scenario = await makeScenario();
  try {
    await writeFile(join(scenario.root, 'inbox', 'note.md'), '# Note\n', 'utf8');
    const resolved = await resolveInboxSourcePath(scenario.root, 'inbox/note.md');
    assert.equal(await readFile(resolved, 'utf8'), '# Note\n');
    assert.ok(resolved.endsWith('note.md'));
  } finally {
    await cleanup(scenario);
  }
});

test('resolveInboxSourcePath: refuses a missing file without creating anything', async () => {
  const scenario = await makeScenario();
  try {
    await assert.rejects(
      () => resolveInboxSourcePath(scenario.root, 'inbox/absent.md'),
      /ENOENT/u,
    );
    assert.deepEqual(await readdir(join(scenario.root, 'inbox')), []);
  } finally {
    await cleanup(scenario);
  }
});
