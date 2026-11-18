import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

const exec = promisify(execFile);

test('profiled launcher executes the compiled CLI with the bounded profile', async () => {
  const result = await exec(process.execPath, ['scripts/run-ziggurat.mjs', '--help'], {
    env: { ...process.env, ZIGGURAT_MAX_OLD_SPACE_SIZE: '512' },
  });
  assert.match(result.stdout, /Usage: ziggurat/u);
});

test('profiled launcher rejects invalid heap sizes before spawning Node', async () => {
  await assert.rejects(
    exec(process.execPath, ['scripts/run-ziggurat.mjs', '--help'], {
      env: { ...process.env, ZIGGURAT_MAX_OLD_SPACE_SIZE: 'not-a-size' },
    }),
    error => {
      assert.equal(error.code, 2);
      assert.match(error.stderr, /must be a positive integer/u);
      return true;
    },
  );
});
