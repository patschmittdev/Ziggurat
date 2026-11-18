import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createOperatingVault } from './helpers/operating-vault.js';
import { runBuild } from '../src/cli/commands/build.js';
import { createContextAccess } from '../src/mcp/access.js';
import { loadGoldIndex } from '../src/retrieval/gold-index.js';
import { assertIndexTrustworthy } from '../src/retrieval/verify.js';
import { collectStagedProposals } from '../src/refine/store.js';
import { stageProposal } from '../src/refine/proposal.js';
import { sha256Text } from '../src/bronze/canonical.js';
import { normalizeText } from '../src/authorization/canonical.js';

const io = { stdout() {}, stderr(text: string) { throw new Error(text); } };
const mutations: Array<[string, (root: string) => Promise<void>]> = [
  ['key removal', root => writeFile(join(root, 'config', 'trust.yaml'), 'trust:\n  reviewers: []\n')],
  ['receipt removal', root => unlink(join(root, 'authorizations', 'concept-000000.md.authorization.json'))],
  ['receipt mutation', async root => {
    const path = join(root, 'authorizations', 'concept-000000.md.authorization.json');
    const receipt = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    receipt['signature'] = Buffer.alloc(64).toString('base64');
    await writeFile(path, JSON.stringify(receipt));
  }],
  ['page mutation', async root => {
    const path = join(root, 'knowledge', 'concept-000000.md');
    await writeFile(path, await readFile(path, 'utf8') + 'Changed assertion.\n');
  }],
  ['Bronze mutation', async root => {
    const path = join(root, 'bronze', 'article', 'source-000000.md');
    await writeFile(path, await readFile(path, 'utf8') + 'Changed evidence.\n');
  }],
  ['new unresolved contradiction', async root => {
    const existing = (await collectStagedProposals(root))[0]?.proposal;
    if (existing === undefined) throw new Error('No fixture proposal');
    const target = 'knowledge/concept-000000.md';
    const { proposal_id: _id, staged_at: _time, state: _state, ...payload } = existing;
    await stageProposal(root, {
      ...payload, operation: 'contradict', target_path: target,
      base_content_sha256: sha256Text(normalizeText(await readFile(join(root, target), 'utf8'))),
      contradictions: [{ summary: 'New conflicting synthetic observation', evidence: existing.evidence }],
    });
  }],
];

for (const [name, mutate] of mutations) {
  test(`a completed ${name} revokes search and already-issued citation reads`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ziggurat-live-revocation-'));
    try {
      await createOperatingVault(root, 1);
      await runBuild(root, true, io);
      const access = await createContextAccess(root, 'gold');
      const hit = (await access.search('measured envelope'))[0];
      assert(hit !== undefined);
      await mutate(root);
      await assert.rejects(() => access.search('measured envelope'));
      await assert.rejects(() => access.read(hit.citation_id));
      await assert.rejects(() => createContextAccess(root, 'gold'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('time-based verification age expires without any filesystem edit or TTL grace period', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-live-expiry-'));
  try {
    await createOperatingVault(root, 1);
    await runBuild(root, true, io);
    const index = await loadGoldIndex(root);
    await assertIndexTrustworthy(root, 'gold', index, new Date());
    await assert.rejects(() => assertIndexTrustworthy(root, 'gold', index, new Date(Date.now() + 91 * 86_400_000)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('signed review_after expiry is checked on every verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-review-expiry-'));
  try {
    const reviewAfter = new Date(Date.now() + 86_400_000);
    await createOperatingVault(root, 1, { reviewAfter: reviewAfter.toISOString() });
    await runBuild(root, true, io);
    const index = await loadGoldIndex(root);
    await assertIndexTrustworthy(root, 'gold', index, new Date());
    await assert.rejects(() => assertIndexTrustworthy(root, 'gold', index, new Date(reviewAfter.getTime() + 1)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
