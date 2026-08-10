import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  completeGardenWalkthrough,
  prepareGardenVault,
  promoteGardenFixtureAsHuman,
} from '../src/walkthrough/garden.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/test/ -> dist/ -> repo root -> fixtures/garden
const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'garden');

test('garden walkthrough: automation stops at the promotion boundary', async () => {
  let root: string | undefined;
  try {
    const prepared = await prepareGardenVault(FIXTURES_DIR);
    root = prepared.root;

    assert.equal(
      prepared.ingest_results.filter(r => r.status === 'created').length,
      5,
      `expected 5 created Bronze records, got ${JSON.stringify(prepared.ingest_results)}`,
    );

    // The automated phase must not have produced a curated page. Promotion is human-only,
    // so knowledge/ is either absent or empty at this point.
    const knowledge = await readdir(join(prepared.root, 'knowledge')).catch(() => []);
    assert.deepEqual(
      knowledge.filter(f => f.endsWith('.md')),
      [],
      'the automated walkthrough must not write a curated page',
    );

    assert.match(prepared.next_step, /human-only/iu);
  } finally {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});

test('garden walkthrough: a contradiction revokes Gold until resolved', async () => {
  let root: string | undefined;
  try {
    const prepared = await prepareGardenVault(FIXTURES_DIR);
    root = prepared.root;

    // Stands in for the human reviewer. A test cannot pause for a person, so the
    // substitution is made explicit here rather than hidden inside the pipeline.
    await promoteGardenFixtureAsHuman(prepared.root, FIXTURES_DIR, prepared.bronze_by_name);

    const result = await completeGardenWalkthrough(
      prepared.root,
      FIXTURES_DIR,
      prepared.ingest_results,
    );

    // The promised behaviour: while the contradiction was unresolved, communion served
    // nothing. This is the assertion the previous walkthrough could not make, because it
    // staged the contradiction after building.
    assert.equal(
      result.gold_chunks_while_contested,
      0,
      'an unresolved contradiction must revoke Gold eligibility',
    );

    // After a human resolves it, the page returns.
    assert.equal(
      result.build_stats.gold_chunks,
      1,
      `expected 1 Gold chunk after resolution, got ${result.build_stats.gold_chunks}`,
    );

    assert(result.query_hits.length >= 1, 'expected at least one query hit for irrigation');
    assert.equal(result.query_hits[0]?.tier, 'gold');

    const paths = result.query_hits.map(h => h.path);
    assert(
      !paths.some(p => p.includes('private-donor')),
      `private donor note must not appear in Gold results: ${JSON.stringify(paths)}`,
    );
  } finally {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});
