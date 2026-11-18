import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import test from 'node:test';
import { canonicalBronzeBody, sha256Text } from '../src/bronze/canonical.js';
import { ingestCapture } from '../src/bronze/ingest.js';
import { BronzeCorruptionError, collectBronzeHashes, verifyBronzeFile } from '../src/bronze/store.js';
import { collectBronzeFiles } from '../src/corpus/collect.js';

async function makeVault(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-bronze-'));
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(root, relPath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf8');
  }
  return root;
}

test('sha256 is identical for LF and CRLF bodies', () => {
  const lf = sha256Text(canonicalBronzeBody('# A\n\nBody.\n'));
  const crlf = sha256Text(canonicalBronzeBody('# A\r\n\r\nBody.\r\n'));
  assert.equal(lf, crlf);
});

test('ingest writes immutable restricted Bronze then removes Inbox', async () => {
  const root = await makeVault({ 'inbox/report.md': '# Report\r\n\r\nEvidence.\r\n' });
  try {
    const result = await ingestCapture(root, 'inbox/report.md', {
      now: new Date('2026-01-02T00:00:00Z'),
      sourceKind: 'article',
    });
    assert.equal(result.status, 'created');
    await assert.rejects(access(join(root, 'inbox/report.md')));
    const written = await readFile(join(root, result.source_path), 'utf8');
    assert.match(written, /sensitivity: restricted/u);
    assert.match(written, /pii: unknown/u);
    const expectedSha = sha256Text(canonicalBronzeBody('# Report\r\n\r\nEvidence.\r\n'));
    assert.match(written, new RegExp(`sha256: ${expectedSha}`));
    assert.equal(result.sha256, expectedSha);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('duplicate body returns duplicate status and leaves Inbox untouched', async () => {
  const root = await makeVault({ 'inbox/doc.md': '# Doc\n\nSame content.\n' });
  try {
    const first = await ingestCapture(root, 'inbox/doc.md', {
      now: new Date('2026-01-02T00:00:00Z'),
      sourceKind: 'article',
    });
    assert.equal(first.status, 'created');
    // Re-create the inbox file with identical content.
    await mkdir(join(root, 'inbox'), { recursive: true });
    await writeFile(join(root, 'inbox/doc.md'), '# Doc\n\nSame content.\n', 'utf8');
    const second = await ingestCapture(root, 'inbox/doc.md', {
      now: new Date('2026-01-03T00:00:00Z'),
      sourceKind: 'article',
    });
    assert.equal(second.status, 'duplicate');
    assert.equal(second.sha256, first.sha256);
    // Inbox must not be removed for a duplicate.
    await assert.doesNotReject(access(join(root, 'inbox/doc.md')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('inbox is retained when bronze directory cannot be created', async () => {
  const root = await makeVault({ 'inbox/fail.md': '# Fail\n\nContent.\n' });
  try {
    // Block bronze directory creation by placing a file at that path.
    await writeFile(join(root, 'bronze'), 'not-a-directory', 'utf8');
    await assert.rejects(
      ingestCapture(root, 'inbox/fail.md', {
        now: new Date('2026-01-02T00:00:00Z'),
        sourceKind: 'article',
      }),
    );
    await assert.doesNotReject(access(join(root, 'inbox/fail.md')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('different content at same target path is rejected and existing Bronze is unchanged', async () => {
  const root = await makeVault({ 'inbox/report.md': '# Report\n\nFirst body.\n' });
  try {
    const first = await ingestCapture(root, 'inbox/report.md', {
      now: new Date('2026-01-02T00:00:00Z'),
      sourceKind: 'article',
    });
    assert.equal(first.status, 'created');

    await mkdir(join(root, 'inbox'), { recursive: true });
    await writeFile(join(root, 'inbox/report.md'), '# Report\n\nSecond body.\n', 'utf8');

    await assert.rejects(
      ingestCapture(root, 'inbox/report.md', {
        now: new Date('2026-01-02T00:00:00Z'),
        sourceKind: 'article',
      }),
    );
    const bronzeContent = await readFile(join(root, first.source_path), 'utf8');
    assert.match(bronzeContent, /First body\./u);
    assert.doesNotMatch(bronzeContent, /Second body\./u);
    await assert.doesNotReject(access(join(root, 'inbox/report.md')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collectBronzeHashes throws BronzeCorruptionError for corrupt Bronze body', async () => {
  const root = await makeVault({ 'inbox/doc.md': '# Doc\n\nContent.\n' });
  try {
    const result = await ingestCapture(root, 'inbox/doc.md', {
      now: new Date('2026-01-02T00:00:00Z'),
      sourceKind: 'article',
    });
    const bronzePath = join(root, result.source_path);
    const original = await readFile(bronzePath, 'utf8');
    await writeFile(bronzePath, original.replace('Content.', 'Content!'), 'utf8');
    await assert.rejects(
      collectBronzeHashes(root),
      (err: unknown) => err instanceof BronzeCorruptionError,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid sourceKind rejects ingest and Inbox is preserved', async () => {
  const invalid = ['', '../evil', 'has/slash', 'UPPER', '.hidden'];
  for (const kind of invalid) {
    const root = await makeVault({ 'inbox/doc.md': '# Doc\n\nContent.\n' });
    try {
      await assert.rejects(
        ingestCapture(root, 'inbox/doc.md', {
          now: new Date('2026-01-02T00:00:00Z'),
          sourceKind: kind,
        }),
        /invalid sourceKind/u,
      );
      await assert.doesNotReject(access(join(root, 'inbox/doc.md')));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('verifyBronzeFile detects a one-character body mutation', async () => {
  const root = await makeVault({ 'inbox/doc.md': '# Doc\n\nContent.\n' });
  try {
    const result = await ingestCapture(root, 'inbox/doc.md', {
      now: new Date('2026-01-02T00:00:00Z'),
      sourceKind: 'article',
    });

    const bronzePath = join(root, result.source_path);
    const clean = await verifyBronzeFile(bronzePath);
    assert.equal(clean.valid, true);
    // Mutate one character in the body.
    const original = await readFile(bronzePath, 'utf8');
    const mutated = original.replace('Content.', 'Content!');
    assert.notEqual(original, mutated, 'mutation must actually change the file');
    await writeFile(bronzePath, mutated, 'utf8');
    const corrupted = await verifyBronzeFile(bronzePath);
    assert.equal(corrupted.valid, false);
    assert.notEqual(corrupted.expected, corrupted.actual);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('collectBronzeFiles returns vault-relative paths when root has a trailing separator', async () => {
  const root = await makeVault({ 'inbox/doc.md': '# Doc\n\nContent.\n' });
  try {
    await ingestCapture(root, 'inbox/doc.md', {
      now: new Date('2026-01-02T00:00:00Z'),
      sourceKind: 'article',
    });
    const records = await collectBronzeFiles(`${root}${sep}`);
    assert.equal(records.length, 1);
    assert.match(records[0]!.path, /^bronze\//u);
    assert(!records[0]!.path.includes(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
