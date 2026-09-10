import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { githubHeadingSlugs, markdownLinks } from './check-docs-links.mjs';
import { githubHeadingSlugs as builtHeadingSlugs } from '../site/scripts/validate-build.mjs';

for (const [name, slugger] of [['root checker', githubHeadingSlugs], ['build validator', builtHeadingSlugs]]) {
  test(`${name} preserves underscores, hyphens, and duplicate heading suffixes`, () => {
    const source = [
      '## BODY_SHA256?!', '## `body_sha256`', '## body_sha256-1',
      '## body_sha256', '## Verify `BODY_SHA256`: now!',
    ].join('\n');
    assert.deepEqual([...slugger(source)], [
      'body_sha256', 'body_sha256-1', 'body_sha256-1-1', 'body_sha256-2', 'verify-body_sha256-now',
    ]);
  });
}

test('extracts inline links with nested or escaped brackets in their labels', () => {
  const source = [
    '[See [tiers]](missing.md)',
    '[Read [tiers] and [gold]](site/src/content/docs/concepts/tiers.md#body_sha256)',
    '![Chart [tiers]](figure.svg)',
    String.raw`[See \[tiers\]](other.md)`,
    '[Plain](plain.md)',
    '`[Code [example]](ignored.md)`',
  ].join('\n');
  assert.deepEqual(markdownLinks(source), [
    'missing.md', 'site/src/content/docs/concepts/tiers.md#body_sha256', 'figure.svg', 'other.md', 'plain.md',
  ]);
});

test('extracts reference-style links with nested brackets in their labels', () => {
  assert.deepEqual(markdownLinks('[See [tiers]][t]\n\n[t]: ./tiers.md#body_sha256\n'), ['./tiers.md#body_sha256']);
});

async function fixture(t, readme, sitePage) {
  const directory = await mkdtemp(join(tmpdir(), 'ziggurat-link-regression-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('ziggurat-link-regression-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const subdir of ['scripts', 'docs', '.github']) await mkdir(join(directory, subdir));
  await copyFile(new URL('./check-docs-links.mjs', import.meta.url), join(directory, 'scripts/check-docs-links.mjs'));
  for (const file of ['ARCHITECTURE.md', 'SECURITY.md', 'PRODUCT.md', 'DESIGN.md', 'CONTRIBUTING.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md', '.github/copilot-instructions.md']) {
    await writeFile(join(directory, file), '# Fixture\n');
  }
  await writeFile(join(directory, 'README.md'), readme);
  if (sitePage) {
    await mkdir(join(directory, 'site/src/content/docs/concepts'), { recursive: true });
    await writeFile(join(directory, 'site/src/content/docs/concepts/tiers.md'), sitePage);
  }
  return spawnSync(process.execPath, [join(directory, 'scripts/check-docs-links.mjs')], { encoding: 'utf8' });
}

test('rejects missing targets behind nested-bracket labels', async (t) => {
  const result = await fixture(t, '[See [tiers]](missing.md)\n');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /README\.md: missing\.md: target does not exist/);
  assert.match(result.stdout, /1 link\(s\) checked .*1 failure\(s\)/);
});

test('recursively checks site pages reached through nested-bracket labels', async (t) => {
  const result = await fixture(t, '[See [tiers]](site/src/content/docs/concepts/tiers.md)\n', '# Tiers\n[Missing](./missing.md)\n');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /site\/src\/content\/docs\/concepts\/tiers\.md: \.\/missing\.md: target does not exist/);
  assert.match(result.stdout, /1 linked site page\(s\) scanned; 1 failure\(s\)/);
});
