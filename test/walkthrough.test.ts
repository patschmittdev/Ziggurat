import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { runGardenWalkthrough } from '../src/walkthrough/garden.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/test/ -> dist/ -> repo root -> fixtures/garden
const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'garden');

test('garden walkthrough: end-to-end lifecycle', async () => {
  let root: string | undefined;
  try {
    const result = await runGardenWalkthrough(FIXTURES_DIR);
    root = result.root;

    // Five Bronze records (4 public + 1 private-donor which still gets ingested as restricted)
    assert.equal(
      result.ingest_results.filter(r => r.status === 'created').length,
      5,
      `expected 5 created Bronze records, got ${JSON.stringify(result.ingest_results)}`,
    );

    // Build produced at least 1 Gold chunk
    assert.equal(
      result.build_stats.gold_chunks,
      1,
      `expected 1 Gold chunk (the reviewed page), got ${result.build_stats.gold_chunks}`,
    );

    // Query returns at least one result for irrigation topic
    assert(result.query_hits.length >= 1, 'expected at least one query hit for irrigation');
    assert.equal(result.query_hits[0]?.tier, 'gold');

    // Private donor note must not appear in query results
    const paths = result.query_hits.map(h => h.path);
    assert(
      !paths.some(p => p.includes('private-donor')),
      `private donor note must not appear in Gold results: ${JSON.stringify(paths)}`,
    );
  } finally {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
