import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const runner = fileURLToPath(new URL('./test-disk-full-container.mjs', import.meta.url));

for (const args of [['--volume', '.'], ['--image', 'untrusted'], ['.']]) {
  test(`container disk-full runner refuses overrides: ${args.join(' ')}`, () => {
    const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /ERR_PARSE_ARGS_(UNKNOWN_OPTION|UNEXPECTED_POSITIONAL)/);
    assert.equal(result.stdout, '');
  });
}

test('container disk-full runner fails explicitly when Docker is missing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'ziggurat-no-docker-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => key.toLowerCase() !== 'path'));
  env.PATH = directory;

  const result = spawnSync(process.execPath, [runner], {
    encoding: 'utf8',
    cwd: directory,
    env,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to run the disk-full test with Docker:.*ENOENT/);
  assert.equal(result.stdout, '');
});
