import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, readdir, realpath, rm, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { writeIndexAtomic } from '../../src/retrieval/store.js';

export async function assertDisposableVolume(path: string, confirmed: boolean): Promise<string> {
  if (!confirmed) throw new Error('--confirm-disposable is required; this test intentionally fills the dedicated volume.');
  const root = await realpath(path);
  const info = await statfs(root);
  const bytes = info.bsize * info.blocks;
  if (bytes < 1024 ** 2 || bytes > 64 * 1024 ** 2) {
    throw new Error('Refusing disk-full test: the entire dedicated filesystem must be between 1 and 64 MiB.');
  }
  const entries = await readdir(root);
  if (entries.some(name => !['.ziggurat-disposable-volume', 'System Volume Information', '$RECYCLE.BIN', 'lost+found'].includes(name))) {
    throw new Error('Refusing disk-full test: dedicated volume contains unexpected files.');
  }
  if ((await readFile(join(root, '.ziggurat-disposable-volume'), 'utf8')).trim() !== 'DISPOSABLE ZIGGURAT TEST VOLUME') {
    throw new Error('Refusing disk-full test: explicit disposable-volume marker is missing or invalid.');
  }
  return root;
}

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  if ('code' in error && typeof error.code === 'string') return error.code;
  return errorCode(error.cause);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { volume: { type: 'string' }, 'confirm-disposable': { type: 'boolean', default: false } },
    strict: true,
  });
  if (!values.volume) throw new Error('--volume must identify a separately provisioned disposable 1-64 MiB filesystem.');
  const volume = await assertDisposableVolume(values.volume, values['confirm-disposable']);
  const root = await mkdtemp(join(volume, 'ziggurat-enospc-'));
  const filler = join(root, 'volume-filler.bin');
  try {
    await writeIndexAtomic(root, 'gold-index.json', { revision: 'previous' });
    const file = await open(filler, 'wx');
    let fillCode: string | undefined;
    try {
      const block = Buffer.alloc(256 * 1024, 0x5a);
      let written = 0;
      while (written < 64 * 1024 ** 2) {
        const result = await file.write(block);
        if (result.bytesWritten === 0) throw new Error('Volume write made no progress without reporting ENOSPC.');
        written += result.bytesWritten;
      }
      throw new Error('Volume did not report ENOSPC within the fixed 64 MiB fill ceiling.');
    } catch (error) {
      fillCode = errorCode(error);
      if (fillCode !== 'ENOSPC') throw error;
    } finally {
      await file.close();
    }
    assert.equal(fillCode, 'ENOSPC');
    await assert.rejects(
      () => writeIndexAtomic(root, 'gold-index.json', { body: 'replacement'.repeat(1024 * 1024) }),
      (error: unknown) => errorCode(error) === 'ENOSPC',
    );
    assert.deepEqual(JSON.parse(await readFile(join(root, '.ziggurat', 'gold-index.json'), 'utf8')), { revision: 'previous' });
    await unlink(filler);
    await writeIndexAtomic(root, 'gold-index.json', { revision: 'recovered' });
    assert.deepEqual(JSON.parse(await readFile(join(root, '.ziggurat', 'gold-index.json'), 'utf8')), { revision: 'recovered' });
    console.log(JSON.stringify({ actual_errno: 'ENOSPC', previous_index_preserved: true, recovery: 'passed' }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
