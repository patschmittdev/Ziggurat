import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { prepareGardenVault } from '../src/walkthrough/garden.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// From dist/test/ -> dist/ -> repo root -> fixtures/garden
const FIXTURES_DIR = join(__dirname, '..', '..', 'fixtures', 'garden');

test('garden walkthrough: automation stops at the human signing boundary', async () => {
  let root: string | undefined;
  try {
    const prepared = await prepareGardenVault(FIXTURES_DIR);
    root = prepared.root;

    assert.equal(
      prepared.ingest_results.filter(r => r.status === 'created').length,
      6,
      `expected 6 created Bronze records, got ${JSON.stringify(prepared.ingest_results)}`,
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
    assert.match(prepared.next_step, /external Ed25519 signature/iu);
    const authorizations = await readdir(join(prepared.root, 'authorizations')).catch(() => []);
    assert.deepEqual(authorizations, []);
  } finally {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
  }
});
