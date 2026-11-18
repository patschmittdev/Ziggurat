import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, symlink, rm, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isEntryPoint } from '../src/cli/main.js';
import { UtcDateTimeSchema } from '../src/contracts/common.js';

test('compiled CLI retains its executable shebang', async () => {
  assert((await readFile(new URL('../src/cli/main.js', import.meta.url), 'utf8')).startsWith('#!/usr/bin/env node\n'));
});
test('entry point resolves a symlink to the module', async () => {
  const dir = await mkdtemp(join(fileURLToPath(new URL('../../', import.meta.url)), '.entry-test-'));
  let junction: string | undefined;
  try {
    const moduleUrl = new URL('../src/cli/main.js', import.meta.url);
    let link = join(dir, 'cli.js');
    try { await symlink(fileURLToPath(moduleUrl), link); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EPERM') throw err;
      // Unprivileged Windows cannot create file symlinks. A directory junction needs no
      // privilege and exercises the same realpath comparison.
      junction = join(dir, 'cli-dir');
      await symlink(fileURLToPath(new URL('.', moduleUrl)), junction, 'junction');
      link = join(junction, 'main.js');
    }
    assert.notEqual(link, fileURLToPath(moduleUrl));
    assert.equal(isEntryPoint(moduleUrl.href, link), true);
  } finally {
    // Remove the link itself first so cleanup never traverses into the build output.
    if (junction) await unlink(junction).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
test('entry point rejects an unrelated existing path', () => {
  assert.equal(isEntryPoint(new URL('../src/cli/main.js', import.meta.url).href, fileURLToPath(import.meta.url)), false);
});
for (const value of ['2026-02-30T00:00:00Z', '2023-02-29T00:00:00Z', '2026-13-01T00:00:00Z', '2026-01-01T24:00:00Z', '2026-01-01T00:00:60Z']) {
  test(`UTC datetime rejects ${value}`, () => assert.equal(UtcDateTimeSchema.safeParse(value).success, false));
}
for (const value of ['2024-02-29T00:00:00Z', '2026-01-01T12:34:56.123456Z']) {
  test(`UTC datetime accepts ${value}`, () => assert.equal(UtcDateTimeSchema.safeParse(value).success, true));
}
