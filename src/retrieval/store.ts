import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { assertRealPathWithinRoot } from '../fs/boundary.js';

async function publishIndex(temporary: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temporary, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== 'win32' || (code !== 'EPERM' && code !== 'EBUSY') || attempt >= 5) throw error;
      // Windows readers can briefly hold a sharing lock on the destination.
      await delay(5 * 2 ** attempt);
    }
  }
}

export async function writeIndexAtomic(
  root: string,
  filename: string,
  data: unknown,
): Promise<void> {
  const dir = join(root, '.ziggurat');
  await mkdir(dir, { recursive: true });
  await assertRealPathWithinRoot(root, dir, 'Index directory');
  const tmpPath = join(dir, `${randomUUID()}.tmp`);
  const finalPath = join(dir, filename);
  let phase = 'open';
  let ownsTemporary = false;
  try {
    const file = await open(tmpPath, 'wx');
    ownsTemporary = true;
    try {
      phase = 'serialize/write';
      await file.writeFile(JSON.stringify(data, null, 2), 'utf8');
      phase = 'sync';
      await file.sync();
    } finally {
      await file.close();
    }
    phase = 'publish';
    await publishIndex(tmpPath, finalPath);
  } catch (error) {
    if (ownsTemporary) {
      try {
        await unlink(tmpPath);
      } catch (cleanupError) {
        if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new AggregateError([error, cleanupError],
            `Index ${filename} failed during ${phase}; could not remove temporary file ${tmpPath}. `
            + 'Check disk space and permissions, stop overlapping writers, and rebuild.');
        }
      }
    }
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'serialization-or-io';
    throw new Error(
      `Index ${filename} failed during ${phase} (${code}). `
      + 'The previous index was not replaced. Check disk space and permissions, then rebuild.',
      { cause: error },
    );
  }
}
