import assert from 'node:assert/strict';
import { execFile, fork } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { writeIndexAtomic } from '../src/retrieval/store.js';
import { createOperatingVault } from './helpers/operating-vault.js';
import { runBuild } from '../src/cli/commands/build.js';
import { createContextAccess } from '../src/mcp/access.js';

const execute = promisify(execFile);

test('failed serialization removes its real temporary file and preserves the previous index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-index-recovery-'));
  try {
    await writeIndexAtomic(root, 'gold-index.json', { revision: 'previous' });
    await assert.rejects(() => writeIndexAtomic(root, 'gold-index.json', { unsupported: 1n }), /serialize\/write/u);
    assert.deepEqual(JSON.parse(await readFile(join(root, '.ziggurat', 'gold-index.json'), 'utf8')), { revision: 'previous' });
    assert.deepEqual(await readdir(join(root, '.ziggurat')), ['gold-index.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('failed index publication is explicit and cleans only its own temporary file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-index-publish-'));
  try {
    await mkdir(join(root, '.ziggurat', 'gold-index.json'), { recursive: true });
    await assert.rejects(() => writeIndexAtomic(root, 'gold-index.json', { revision: 'new' }), /publish/u);
    assert.deepEqual(await readdir(join(root, '.ziggurat')), ['gold-index.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('overlapping real index writes expose only a complete old or new JSON document', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-index-overlap-'));
  try {
    await writeIndexAtomic(root, 'gold-index.json', { writer: -1, body: 'old' });
    const pending = Promise.allSettled(Array.from({ length: 16 }, (_, writer) =>
      writeIndexAtomic(root, 'gold-index.json', { writer, body: String(writer).repeat(64_000) })));
    for (let index = 0; index < 16; index++) {
      const value = JSON.parse(await readFile(join(root, '.ziggurat', 'gold-index.json'), 'utf8')) as {
        writer: number; body: string;
      };
      assert.equal(value.body, value.writer === -1 ? 'old' : String(value.writer).repeat(64_000));
    }
    const outcomes = await pending;
    assert(outcomes.some(outcome => outcome.status === 'fulfilled'));
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') assert.match(String(outcome.reason), /Index gold-index\.json failed/u);
    }
    assert.deepEqual(await readdir(join(root, '.ziggurat')), ['gold-index.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('process death before publication preserves the old index and permits a rebuild', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-index-crash-'));
  const workerPath = fileURLToPath(new URL('./helpers/crash-writer.js', import.meta.url));
  let child: ReturnType<typeof fork> | undefined;
  let exited: Promise<void> | undefined;
  try {
    await writeIndexAtomic(root, 'gold-index.json', { revision: 'previous' });
    child = fork(workerPath, [root], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    exited = new Promise<void>(resolve => child?.once('exit', () => resolve()));
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Crash worker never reached the write boundary')), 15_000);
      child?.once('error', error => { clearTimeout(timer); reject(error); });
      child?.once('message', message => {
        clearTimeout(timer);
        if (message === 'temporary-file-open') resolve();
        else reject(new Error('Unexpected crash worker message'));
      });
      child?.once('exit', () => { clearTimeout(timer); reject(new Error('Crash worker exited before its boundary')); });
    });
    child.kill('SIGKILL');
    await exited;
    assert.deepEqual(JSON.parse(await readFile(join(root, '.ziggurat', 'gold-index.json'), 'utf8')), { revision: 'previous' });
    const remnants = (await readdir(join(root, '.ziggurat'))).filter(name => name.endsWith('.tmp'));
    assert.equal(remnants.length, 1);
    await writeIndexAtomic(root, 'gold-index.json', { revision: 'rebuilt' });
    assert.deepEqual(JSON.parse(await readFile(join(root, '.ziggurat', 'gold-index.json'), 'utf8')), { revision: 'rebuilt' });
    assert.equal((await readdir(join(root, '.ziggurat'))).filter(name => name.endsWith('.tmp')).length, 1);
  } finally {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await exited;
    await rm(root, { recursive: true, force: true });
  }
});

test('overlapping CLI builds preserve live verified Gold and all three profiles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-build-overlap-'));
  const cli = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
  try {
    await createOperatingVault(root, 2);
    await runBuild(root, true, { stdout() {}, stderr(text) { throw new Error(text); } });
    const access = await createContextAccess(root, 'gold');
    const writers = Promise.all(Array.from({ length: 3 }, () =>
      execute(process.execPath, [cli, 'build', '--root', root, '--json'], { timeout: 30_000 })));
    for (let sample = 0; sample < 3; sample++) {
      const hit = (await access.search('measured envelope'))[0];
      assert(hit !== undefined);
      assert.equal((await access.read(hit.citation_id)).instruction_authority, 'none');
    }
    for (const result of await writers) {
      assert.equal((JSON.parse(result.stdout) as { gold_chunks: number }).gold_chunks, 2);
    }
    for (const profile of ['gold', 'review', 'evidence'] as const) {
      assert((await (await createContextAccess(root, profile)).search('measured envelope')).length > 0);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
