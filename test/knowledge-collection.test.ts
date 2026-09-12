import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectCuratedPages, collectCuratedPagesDetailed } from '../src/corpus/collect.js';
import { loadGoldIndex } from '../src/retrieval/gold-index.js';
import { loadProfileIndex } from '../src/retrieval/profile-index.js';
import { computeLiveFingerprint } from '../src/retrieval/verify.js';
import { createOperatingVault } from './helpers/operating-vault.js';

const CLI = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
const PROFILES = ['gold', 'review', 'evidence'] as const;
const FILE_CONTENT = 'Synthetic private content must not appear in a directory diagnostic.';

function build(root: string, json: boolean) {
  const result = spawnSync(process.execPath, [
    CLI, 'build', '--root', root, ...(json ? ['--json'] : []),
  ], { encoding: 'utf8', timeout: 30_000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

async function readIndexes(root: string): Promise<Buffer[]> {
  return Promise.all(PROFILES.map(profile =>
    readFile(join(root, '.ziggurat', `${profile}-index.json`))));
}

async function withPopulatedVault(fn: (root: string, indexes: Buffer[]) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-knowledge-collection-'));
  try {
    await createOperatingVault(root, 1);
    const result = build(root, true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const [gold, review, evidence] = await Promise.all([
      loadGoldIndex(root), loadProfileIndex(root, 'review'), loadProfileIndex(root, 'evidence'),
    ]);
    assert.equal(gold.chunks.length, 1);
    assert.equal(review.chunks.length, 2);
    assert.equal(evidence.chunks.length, 6);
    assert.equal(review.chunks.filter(chunk => chunk.tier === 'gold').length, 1);
    assert.equal(evidence.chunks.filter(chunk => chunk.tier === 'gold').length, 1);
    await fn(root, await readIndexes(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function assertBuildFailsWithoutPublication(
  root: string,
  indexes: Buffer[],
  code: RegExp,
): Promise<void> {
  for (const json of [false, true]) {
    const result = build(root, json);
    assert.equal(result.status, 1, result.stdout);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^error: .*knowledge directory/iu);
    assert.match(result.stderr, code);
    assert(!result.stderr.includes(FILE_CONTENT));
    assert(!result.stderr.includes('Measured envelope fact'));
    assert(!result.stderr.includes('scandir'), 'do not interpolate raw filesystem exceptions');
    assert.deepEqual(await readIndexes(root), indexes, 'all three published indexes must be byte-identical');
  }
}

test('build refuses knowledge replaced by a regular file before publishing any index', async () => {
  await withPopulatedVault(async (root, indexes) => {
    const knowledge = join(root, 'knowledge');
    const preserved = join(root, 'preserved-knowledge');
    const page = await readFile(join(knowledge, 'concept-000000.md'));
    await rename(knowledge, preserved);
    await writeFile(knowledge, FILE_CONTENT);
    await assert.rejects(readdir(knowledge), { code: 'ENOTDIR' });

    await assertBuildFailsWithoutPublication(root, indexes, /ENOTDIR/u);
    await assert.rejects(collectCuratedPagesDetailed(root), /knowledge directory.*ENOTDIR/iu);
    await assert.rejects(collectCuratedPages(root), /knowledge directory.*ENOTDIR/iu);
    for (const profile of PROFILES) {
      await assert.rejects(computeLiveFingerprint(root, profile), /knowledge directory.*ENOTDIR/iu);
    }
    assert.deepEqual(await readFile(join(preserved, 'concept-000000.md')), page);
    assert.equal(await readFile(knowledge, 'utf8'), FILE_CONTENT);
  });
});

test('build refuses permission-denied knowledge listing without replacing existing indexes', async t => {
  await withPopulatedVault(async (root, indexes) => {
    const knowledge = join(root, 'knowledge');
    let permissionsChanged = false;
    try {
      try {
        await chmod(knowledge, 0o000);
        permissionsChanged = true;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOSYS' && code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'EACCES') throw error;
        t.skip(`cannot enforce directory permissions with chmod (${code})`);
        return;
      }
      try {
        await readdir(knowledge);
        t.skip('filesystem does not enforce directory permissions for this user (Windows or privileged user)');
        return;
      } catch (error) {
        assert.match(String((error as NodeJS.ErrnoException).code), /^(EACCES|EPERM)$/u);
      }

      await assertBuildFailsWithoutPublication(root, indexes, /EACCES|EPERM/u);
    } finally {
      if (permissionsChanged) await chmod(knowledge, 0o700);
    }
  });
});

test('absent knowledge remains an empty curated collection and permits rebuilding advisory indexes', async () => {
  await withPopulatedVault(async root => {
    await rename(join(root, 'knowledge'), join(root, 'preserved-knowledge'));
    await assert.rejects(readdir(join(root, 'knowledge')), { code: 'ENOENT' });
    assert.deepEqual(await collectCuratedPagesDetailed(root), { pages: [], rejected: [] });
    assert.deepEqual(await collectCuratedPages(root), []);

    const result = build(root, true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const report = JSON.parse(result.stdout) as {
      gold_chunks: number;
      review_chunks: number;
      evidence_chunks: number;
      rejected_corpus_entries: unknown[];
      gold_decisions: unknown[];
    };
    assert.equal(report.gold_chunks, 0);
    assert.equal(report.review_chunks, 1);
    assert.equal(report.evidence_chunks, 5);
    assert.deepEqual(report.rejected_corpus_entries, []);
    assert.deepEqual(report.gold_decisions, []);
    assert.equal((await loadGoldIndex(root)).chunks.length, 0);
    assert.equal((await loadProfileIndex(root, 'review')).chunks.length, 1);
    assert.equal((await loadProfileIndex(root, 'evidence')).chunks.length, 5);
  });
});
