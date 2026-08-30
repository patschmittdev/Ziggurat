import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sha256Text } from '../src/bronze/canonical.js';
import {
  collectBronzeFilesDetailed,
  collectCuratedPagesDetailed,
} from '../src/corpus/collect.js';

const SECRET_LINE = 'CONFIDENTIAL merger terms for the eastern district.';

async function withVault(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-corpus-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function write(root: string, relPath: string, content: string): Promise<void> {
  const full = join(root, relPath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, content, 'utf8');
}

function validBronze(body: string): string {
  return '---\n'
    + 'schema_version: 1\n'
    + 'source_id: valid-doc\n'
    + 'source_kind: article\n'
    + 'captured_at: 2026-01-01T00:00:00.000Z\n'
    + `sha256: ${sha256Text(body)}\n`
    + 'sensitivity: public\n'
    + "pii: 'false'\n"
    + '---\n'
    + body;
}

test('bronze collection: reports a file with no frontmatter without admitting it', async () => {
  await withVault(async root => {
    await write(root, 'bronze/article/good.md', validBronze('# Good\nBody.\n'));
    await write(root, 'bronze/article/bare.md', `# Bare\n${SECRET_LINE}\n`);

    const { records, rejected } = await collectBronzeFilesDetailed(root);
    assert.deepEqual(records.map(r => r.path), ['bronze/article/good.md']);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.path, 'bronze/article/bare.md');
    assert.equal(rejected[0]?.reason, 'missing-frontmatter');
    assert.ok(!JSON.stringify(rejected).includes(SECRET_LINE));
  });
});

test('bronze collection: reports invalid YAML with position but not content', async () => {
  await withVault(async root => {
    await write(
      root,
      'bronze/article/broken.md',
      `---\nschema_version: 1\nsource_id: "unterminated\n---\n${SECRET_LINE}\n`,
    );
    const { records, rejected } = await collectBronzeFilesDetailed(root);
    assert.deepEqual(records, []);
    assert.equal(rejected[0]?.reason, 'invalid-yaml');
    assert.match(rejected[0]?.detail ?? '', /line \d+, column \d+/u);
    assert.ok(!JSON.stringify(rejected).includes(SECRET_LINE));
  });
});

test('bronze collection: a schema-invalid record is reported and stays unusable', async () => {
  await withVault(async root => {
    const body = `# Leaky\n${SECRET_LINE}\n`;
    await write(
      root,
      'bronze/article/extra.md',
      '---\n'
      + 'schema_version: 1\n'
      + 'source_id: extra\n'
      + 'source_kind: article\n'
      + 'captured_at: 2026-01-01T00:00:00.000Z\n'
      + `sha256: ${sha256Text(body)}\n`
      + 'sensitivity: public\n'
      + "pii: 'false'\n"
      + 'retrieval_eligible: true\n'
      + '---\n'
      + body,
    );

    const { records, rejected } = await collectBronzeFilesDetailed(root);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.reason, 'schema-invalid');
    assert.match(rejected[0]?.detail ?? '', /retrieval_eligible/u);
    assert.ok(!JSON.stringify(rejected).includes(SECRET_LINE));

    // The record is retained only in its maximally restricted, unverified form so
    // downstream privacy filters exclude it rather than never seeing it.
    const record = records.find(r => r.path === 'bronze/article/extra.md');
    assert.ok(record !== undefined);
    assert.equal(record.hashVerified, false);
    assert.equal(record.sensitivity, 'restricted');
    assert.equal(record.pii, 'unknown');
  });
});

test('bronze collection: nested entries are walked and reported by their real path', async () => {
  await withVault(async root => {
    // A directory named like a Bronze record is walked, not read as a file, so the
    // rejection must name the nested entry rather than the directory.
    await mkdir(join(root, 'bronze', 'article', 'entry.md'), { recursive: true });
    await write(root, 'bronze/article/entry.md/inner.md', 'not a record\n');

    const { records, rejected } = await collectBronzeFilesDetailed(root);
    assert.deepEqual(records, []);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0]?.path, 'bronze/article/entry.md/inner.md');
    assert.equal(rejected[0]?.reason, 'missing-frontmatter');
  });
});

test('bronze collection: a file that cannot be read is reported as unreadable', async t => {
  await withVault(async root => {
    await write(root, 'bronze/article/locked.md', validBronze('Body line.\n'));
    const target = join(root, 'bronze', 'article', 'locked.md');
    try {
      await chmod(target, 0o000);
      await readFile(target, 'utf8');
      // Root and most Windows configurations ignore the mode bits entirely.
      t.skip('filesystem does not enforce read permissions for this user');
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EACCES' && code !== 'EPERM') {
        t.skip(`chmod-based unreadable file unsupported here (${String(code)})`);
        return;
      }
    }

    try {
      const { records, rejected } = await collectBronzeFilesDetailed(root);
      assert.deepEqual(records, []);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0]?.path, 'bronze/article/locked.md');
      assert.equal(rejected[0]?.reason, 'unreadable');
      assert.match(String(rejected[0]?.detail), /file could not be read/u);
      assert.ok(!String(rejected[0]?.detail).includes('Body line.'));
    } finally {
      await chmod(target, 0o600);
    }
  });
});

test('bronze collection: a directory that cannot be listed is reported as unreadable', async t => {
  await withVault(async root => {
    await write(root, 'bronze/article/entry.md', validBronze('Body line.\n'));
    const sealed = join(root, 'bronze', 'sealed');
    await mkdir(sealed, { recursive: true });
    try {
      await chmod(sealed, 0o000);
      await readdir(sealed);
      t.skip('filesystem does not enforce directory permissions for this user');
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EACCES' && code !== 'EPERM') {
        t.skip(`chmod-based unreadable directory unsupported here (${String(code)})`);
        return;
      }
    }

    try {
      const { records, rejected } = await collectBronzeFilesDetailed(root);
      // The readable sibling is still collected; only the sealed subtree is rejected.
      assert.equal(records.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0]?.path, 'bronze/sealed');
      assert.equal(rejected[0]?.reason, 'unreadable');
      assert.match(String(rejected[0]?.detail), /directory could not be listed/u);
    } finally {
      await chmod(sealed, 0o700);
    }
  });
});

test('bronze collection: an absent bronze directory is not an error', async () => {
  await withVault(async root => {
    const { records, rejected } = await collectBronzeFilesDetailed(root);
    assert.deepEqual(records, []);
    assert.deepEqual(rejected, []);
  });
});

test('curated collection: reports a malformed page without admitting it', async () => {
  await withVault(async root => {
    await write(root, 'knowledge/bare.md', `# Bare\n${SECRET_LINE}\n`);
    const { pages, rejected } = await collectCuratedPagesDetailed(root);
    assert.deepEqual(pages, []);
    assert.equal(rejected[0]?.path, 'knowledge/bare.md');
    assert.equal(rejected[0]?.reason, 'missing-frontmatter');
    assert.ok(!JSON.stringify(rejected).includes(SECRET_LINE));
  });
});

test('curated collection: reports schema failures by field, not by value', async () => {
  await withVault(async root => {
    await write(
      root,
      'knowledge/incomplete.md',
      '---\nschema_version: 1\ntitle: Incomplete\n---\n' + SECRET_LINE + '\n',
    );
    const { pages, rejected } = await collectCuratedPagesDetailed(root);
    assert.deepEqual(pages, []);
    assert.equal(rejected[0]?.reason, 'schema-invalid');
    assert.match(rejected[0]?.detail ?? '', /frontmatter failed schema validation at /u);
    assert.ok(!JSON.stringify(rejected).includes(SECRET_LINE));
    assert.ok(!JSON.stringify(rejected).includes('Incomplete'));
  });
});

test('curated collection: a valid page is still admitted alongside rejections', async () => {
  await withVault(async root => {
    await write(root, 'knowledge/bare.md', '# Bare\n');
    await write(
      root,
      'knowledge/good.md',
      '---\n'
      + 'schema_version: 1\n'
      + 'title: Good\n'
      + 'type: concept\n'
      + 'sources:\n  - bronze/article/good.md\n'
      + 'confidence: high\n'
      + 'status: draft\n'
      + 'retrieval_eligible: false\n'
      + "pii: 'false'\n"
      + 'sensitivity: public\n'
      + 'visibility: internal\n'
      + '---\n# Good\n',
    );
    const { pages, rejected } = await collectCuratedPagesDetailed(root);
    assert.deepEqual(pages.map(p => p.path), ['knowledge/good.md']);
    assert.deepEqual(rejected.map(r => r.path), ['knowledge/bare.md']);
  });
});
