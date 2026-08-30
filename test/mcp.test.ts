import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sha256Text } from '../src/bronze/canonical.js';
import { buildGoldIndex } from '../src/retrieval/gold-index.js';
import { createContextAccess, ContextAccess } from '../src/mcp/access.js';
import { createMcpServer } from '../src/mcp/server.js';
import * as YAML from 'yaml';
import type { CuratedPage } from '../src/contracts/index.js';
import {
  authorizeTestPage,
  createTestReviewer,
} from './helpers/authorization.js';

const TEST_REVIEWER = createTestReviewer('mcp-reviewer', 'mcp-reviewer-primary');
const MAIN_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'main.js');
const FIXED_DATE = new Date();
const RECENT_REVIEW = new Date(FIXED_DATE.getTime() - 24 * 60 * 60 * 1000).toISOString();

async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-mcp-'));
  const configFiles = {
    'config/ziggurat.yaml': 'schema_version: 1\nlifecycle:\n  review_queue_limit: 10\n',
    'config/domain.yaml': 'domain:\n  page_types: [concept]\n  tags: [security]\n',
    'config/privacy.yaml': 'privacy:\n  default_sensitivity: restricted\n  default_pii: unknown\n',
    'config/adapters.yaml': 'adapters: {}\n',
    'config/trust.yaml': YAML.stringify({
      trust: {
        reviewers: [{
          reviewer_id: TEST_REVIEWER.reviewerId,
          key_id: TEST_REVIEWER.keyId,
          algorithm: 'ed25519',
          public_key_pem: TEST_REVIEWER.publicKeyPem,
        }],
      },
    }),
  };
  for (const [relPath, content] of Object.entries({ ...configFiles, ...files })) {
    const fullPath = join(root, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return root;
}

function makeBronzeContent(body: string): string {
  const canonBody = body.replace(/\r\n/g, '\n');
  const sha = sha256Text(canonBody);
  return `---\nschema_version: 1\nsource_id: test\nsource_kind: article\ncaptured_at: 2026-01-01T00:00:00Z\nsha256: ${sha}\nsensitivity: public\npii: 'false'\n---\n${canonBody}`;
}

function makeGoldPage(): CuratedPage {
  return {
    schema_version: 1,
    title: 'Gold Page',
    type: 'concept',
    sources: ['bronze/src.md'],
    confidence: 'high',
    status: 'reviewed',
    retrieval_eligible: true,
    pii: 'false',
    sensitivity: 'public',
    visibility: 'internal',
    egress: 'approved-cloud',
    reviewed_by: TEST_REVIEWER.reviewerId,
    reviewed_at: RECENT_REVIEW,
    last_verified: RECENT_REVIEW,
    resolved_proposals: [],
  };
}

/**
 * Writes a curated page to disk so the live corpus matches what the index was built
 * from. Index verification recomputes the fingerprint from the real corpus, so a
 * fixture that only builds an in-memory index is correctly rejected as stale.
 */
export async function writeCuratedPage(
  root: string,
  relPath: string,
  page: CuratedPage,
  pageBody: string,
): Promise<void> {
  const fullPath = join(root, relPath);
  await mkdir(dirname(fullPath), { recursive: true });
  const yaml = YAML.stringify(page, { lineWidth: 0 }).trimEnd();
  await writeFile(fullPath, `---\n${yaml}\n---\n${pageBody}`, 'utf8');
}

async function buildTestVaultWithGoldIndex(root: string): Promise<void> {
  const bronzeBody = '# Source\n\nTest evidence for irrigation systems.\n';
  await mkdir(join(root, 'bronze'), { recursive: true });
  await writeFile(join(root, 'bronze', 'src.md'), makeBronzeContent(bronzeBody), 'utf8');

  const page = makeGoldPage();
  const body = 'Gold content about irrigation and water supply.';
  await writeCuratedPage(root, 'knowledge/gold.md', page, body);
  await authorizeTestPage(root, 'knowledge/gold.md', page, body, TEST_REVIEWER);
  await buildGoldIndex(root, [
    { path: 'knowledge/gold.md', page, pageBody: body },
  ], { asOf: FIXED_DATE });
}

// ---------------------------------------------------------------------------
// createContextAccess
// ---------------------------------------------------------------------------

test('createContextAccess: throws when index does not exist', async () => {
  const root = await makeVault({});
  try {
    await assert.rejects(
      () => createContextAccess(root, 'communion'),
      /no such file|ENOENT|not found/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createContextAccess: loads communion index successfully', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const access = await createContextAccess(root, 'communion');
    assert(access instanceof ContextAccess);
    assert.equal(access.accessProfile, 'communion');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ContextAccess.search
// ---------------------------------------------------------------------------

test('search: returns results with citation IDs', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const access = await createContextAccess(root, 'communion');
    const hits = await access.search('irrigation');
    assert(hits.length >= 1);
    assert(typeof hits[0]?.citation_id === 'string');
    assert(hits[0]?.citation_id.length === 36); // UUID format
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('search: returns empty for unmatched query', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const access = await createContextAccess(root, 'communion');
    const hits = await access.search('xyznonexistentterm');
    assert.deepEqual(hits, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Forged citation rejection
// ---------------------------------------------------------------------------

test('read: rejects forged citation ID not from search', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const access = await createContextAccess(root, 'communion');
    await assert.rejects(
      () => access.read(randomUUID()),
      /unknown citation/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('read: accepts citation ID returned by search on the same instance', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const access = await createContextAccess(root, 'communion');
    const hits = await access.search('irrigation');
    assert(hits.length >= 1);
    const payload = await access.read(hits[0]!.citation_id);
    assert.equal(payload.profile, 'communion');
    assert.equal(typeof payload.body, 'string');
    assert.equal(payload.content_role, 'reference');
    assert.equal(payload.instruction_authority, 'none');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Cross-instance citation rejection
// ---------------------------------------------------------------------------

test('read: rejects citation ID from a different access instance', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const instanceA = await createContextAccess(root, 'communion');
    const instanceB = await createContextAccess(root, 'communion');

    const hitsA = await instanceA.search('irrigation');
    assert(hitsA.length >= 1);

    await assert.rejects(
      () => instanceB.read(hitsA[0]!.citation_id),
      /unknown citation/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('read: fails closed when the live authorized corpus changes after search', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const access = await createContextAccess(root, 'communion');
    const hits = await access.search('irrigation');
    assert(hits.length >= 1);
    await writeFile(
      join(root, 'knowledge', 'gold.md'),
      '---\nschema_version: 1\n---\nTampered.\n',
      'utf8',
    );
    await assert.rejects(() => access.read(hits[0]!.citation_id), /stale|fingerprint/iu);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('read: rejects a cached citation after revocation and a valid rebuild', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const access = await createContextAccess(root, 'communion');
    const hits = await access.search('irrigation');
    assert(hits.length >= 1);
    await writeFile(join(root, 'config', 'trust.yaml'), 'trust:\n  reviewers: []\n', 'utf8');
    await buildGoldIndex(root, [], { asOf: FIXED_DATE });
    await assert.rejects(
      () => access.read(hits[0]!.citation_id),
      /citation|fingerprint|revoked/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fingerprint change detection
// ---------------------------------------------------------------------------

test('search: rejects when index is rebuilt with different corpus after creation', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const access = await createContextAccess(root, 'communion');

    // Rebuild the index with different content
    const page = makeGoldPage();
    await buildGoldIndex(root, [
      { path: 'knowledge/gold.md', page, pageBody: 'Completely different content now.' },
    ], { asOf: FIXED_DATE });

    await assert.rejects(
      () => access.search('irrigation'),
      /fingerprint/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Profile isolation
// ---------------------------------------------------------------------------

test('communion access does not expose review profile label', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const access = await createContextAccess(root, 'communion');
    const hits = await access.search('irrigation');
    for (const hit of hits) {
      assert.equal(hit.profile, 'communion');
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// MCP server tool listing
// ---------------------------------------------------------------------------

test('createMcpServer: registers exactly two tools', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const server = await createMcpServer(root);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    const names = Object.keys(tools);
    assert.equal(names.length, 2);
    assert(names.includes('search_context'), 'search_context not registered');
    assert(names.includes('read_context'), 'read_context not registered');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createMcpServer: tools are read-only and non-destructive', async () => {
  const root = await makeVault({});
  try {
    await buildTestVaultWithGoldIndex(root);
    const server = await createMcpServer(root);
    const tools = (server as unknown as { _registeredTools: Record<string, { annotations?: Record<string, unknown> }> })._registeredTools;

    for (const [name, tool] of Object.entries(tools)) {
      const ann = tool.annotations ?? {};
      assert.equal(ann['readOnlyHint'], true, `${name} must have readOnlyHint: true`);
      assert.equal(ann['destructiveHint'], false, `${name} must have destructiveHint: false`);
      assert.equal(ann['openWorldHint'], false, `${name} must have openWorldHint: false`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createMcpServer: cannot call startMcpServer without index', async () => {
  const root = await makeVault({});
  try {
    await assert.rejects(
      () => createMcpServer(root),
      /ENOENT|no such file|not found/iu,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('mcp executable remains alive after stdio transport connects', async () => {
  const root = await makeVault({});
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await buildTestVaultWithGoldIndex(root);
    child = spawn(process.execPath, [MAIN_PATH, 'mcp', '--root', root], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    await Promise.race([
      once(child, 'exit'),
      new Promise(resolve => setTimeout(resolve, 150)),
    ]);
    assert.equal(child.exitCode, null);
  } finally {
    if (child !== undefined && child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
    await rm(root, { recursive: true, force: true });
  }
});
