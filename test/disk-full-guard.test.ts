import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, statfs, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertDisposableVolume } from './manual/disk-full.js';

test('disk-full harness refuses an ordinary host filesystem without writing fill data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-volume-guard-'));
  try {
    await writeFile(join(root, '.ziggurat-disposable-volume'), 'DISPOSABLE ZIGGURAT TEST VOLUME\n');
    await assert.rejects(() => assertDisposableVolume(root, false), /confirm-disposable/u);
    const info = await statfs(root);
    if (info.bsize * info.blocks > 64 * 1024 ** 2) {
      await assert.rejects(() => assertDisposableVolume(root, true), /entire dedicated filesystem/u);
    } else {
      await writeFile(join(root, 'not-disposable.txt'), 'Occupied test volume');
      await assert.rejects(() => assertDisposableVolume(root, true), /unexpected files/u);
      await rm(join(root, 'not-disposable.txt'));
    }
    assert.deepEqual(await readdir(root), ['.ziggurat-disposable-volume']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
