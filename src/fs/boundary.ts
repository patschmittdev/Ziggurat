import { realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';

export async function assertRealPathWithinRoot(
  root: string,
  target: string,
  label: string,
  allowRoot = true,
): Promise<void> {
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);
  const rel = relative(realRoot, realTarget);
  if ((allowRoot && rel === '') || (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel))) {
    return;
  }
  throw new Error(`${label} resolves outside the vault root`);
}
