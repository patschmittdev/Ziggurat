import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { assertRealPathWithinRoot } from '../fs/boundary.js';

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
  const file = await open(tmpPath, 'w');
  try {
    await file.writeFile(JSON.stringify(data, null, 2), 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(tmpPath, finalPath);
  } catch (error) {
    await unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}
