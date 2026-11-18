import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { canonicalBronzeBody, sha256Text } from '../src/bronze/canonical.js';
import { ingestCapture } from '../src/bronze/ingest.js';
import {
  BronzeCorruptionError,
  collectBronzeHashes,
  parseBronzeFile,
  parseBronzeRecord,
  verifyBronzeFile,
} from '../src/bronze/store.js';
import { collectBronzeFilesDetailed } from '../src/corpus/collect.js';
import { createVerifiedBronzeReader } from '../src/refine/evidence.js';

const OPTIONS = { now: new Date('2026-01-02T00:00:00Z'), sourceKind: 'article' };
const BODIES = [
  { name: 'ordinary body', body: '# Record\n\nEvidence stays unchanged.\n' },
  { name: 'lone CR body', body: '# Record\n\nEvidence\rstays unchanged.\n' },
];
const ENDINGS = [
  { name: 'LF', value: '\n' },
  { name: 'CRLF', value: '\r\n' },
];

async function withCapture(
  body: string,
  ending: string,
  fn: (root: string, sourcePath: string, stored: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-bronze-endings-'));
  try {
    await mkdir(join(root, 'inbox'));
    await writeFile(join(root, 'inbox', 'original.md'), body, 'utf8');
    const first = await ingestCapture(root, 'inbox/original.md', OPTIONS);
    assert.equal(first.status, 'created');
    assert.equal(first.sha256, sha256Text(body));
    const filePath = join(root, first.source_path);
    const stored = (await readFile(filePath, 'utf8')).replace(/\n/g, ending);
    await writeFile(filePath, stored, 'utf8');
    await fn(root, first.source_path, stored);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function bronzeFiles(root: string): Promise<string[]> {
  const entries = await readdir(join(root, 'bronze'), { recursive: true, withFileTypes: true });
  return entries.filter(entry => entry.isFile()).map(entry => entry.name).sort();
}

for (const ending of ENDINGS) {
  for (const fixture of BODIES) {
    test(`Bronze ${ending.name}: parsing, live reading and dedup agree for ${fixture.name}`, async () => {
      const { body } = fixture;
      const expected = sha256Text(body);
      await withCapture(body, ending.value, async (root, sourcePath, stored) => {
        const filePath = join(root, sourcePath);
        const live = await createVerifiedBronzeReader(root).read(root, sourcePath);
        assert.equal(live.body, body);
        assert.equal(live.record.sha256, expected);
        assert.deepEqual(parseBronzeFile(stored), { record: live.record, body });
        assert.deepEqual(parseBronzeRecord(stored), live.record);
        assert.deepEqual(await verifyBronzeFile(filePath), { valid: true, expected, actual: expected });
        assert.deepEqual(await collectBronzeHashes(root), new Map([[expected, sourcePath]]));

        const { records, rejected } = await collectBronzeFilesDetailed(root);
        assert.deepEqual(rejected, []);
        assert.equal(records.length, 1);
        assert.equal(records[0]?.body, body);
        assert.equal(records[0]?.sha256, expected);
        assert.equal(records[0]?.hashVerified, true);
        assert.equal(canonicalBronzeBody(body.replace(/\n/g, '\r\n')), body);
        if (body.includes('\r')) {
          assert.notEqual(expected, sha256Text(body.replace(/\r/g, '\n')));
        }

        const before = await bronzeFiles(root);
        assert.equal(before.length, 1);
        // A distinct filename prevents the no-overwrite guard from masking failed deduplication.
        const inboxPath = join(root, 'inbox', 'different-name.md');
        await writeFile(inboxPath, body, 'utf8');
        const result = await ingestCapture(root, 'inbox/different-name.md', OPTIONS);
        assert.deepEqual(result, { status: 'duplicate', source_path: sourcePath, sha256: expected });
        assert.deepEqual(await bronzeFiles(root), before);
        assert.equal(await readFile(inboxPath, 'utf8'), body);
        assert.equal(await readFile(filePath, 'utf8'), stored);
      });
    });

    test(`Bronze ${ending.name}: corrupted ${fixture.name} still blocks ingestion`, async () => {
      const { body } = fixture;
      const expected = sha256Text(body);
      const actual = sha256Text(body.replace('unchanged.', 'unchanged!'));
      await withCapture(body, ending.value, async (root, sourcePath, stored) => {
        const filePath = join(root, sourcePath);
        const mutated = stored.replace('unchanged.', 'unchanged!');
        assert.notEqual(mutated, stored);
        await writeFile(filePath, mutated, 'utf8');
        assert.deepEqual(await verifyBronzeFile(filePath), { valid: false, expected, actual });
        const isCorruption = (error: unknown): boolean =>
          error instanceof BronzeCorruptionError
          && error.filePath === filePath && error.expected === expected && error.actual === actual;
        await assert.rejects(collectBronzeHashes(root), isCorruption);
        await assert.rejects(createVerifiedBronzeReader(root).read(root, sourcePath), isCorruption);
        const { records } = await collectBronzeFilesDetailed(root);
        assert.equal(records.length, 1);
        assert.equal(records[0]?.sha256, expected);
        assert.equal(records[0]?.hashVerified, false);

        const before = await bronzeFiles(root);
        const inboxPath = join(root, 'inbox', 'different-name.md');
        await writeFile(inboxPath, body, 'utf8');
        await assert.rejects(ingestCapture(root, 'inbox/different-name.md', OPTIONS), isCorruption);
        assert.deepEqual(await bronzeFiles(root), before);
        assert.equal(await readFile(inboxPath, 'utf8'), body);
        assert.equal(await readFile(filePath, 'utf8'), mutated);
      });
    });
  }

  test(`Bronze ${ending.name}: malformed frontmatter still rejects direct reads and is not deduplicated`, async () => {
    await withCapture(BODIES[0]!.body, ending.value, async (root, sourcePath, stored) => {
      const filePath = join(root, sourcePath);
      const malformed = [
        stored.slice(3),
        stored.replace('source_id: original', 'source_id: ['),
        stored.replace('source_id: original', `source_id: original${ending.value}source_id: duplicate`),
        stored.replace('schema_version: 1', 'schema_version: 2'),
        stored.replace('schema_version: 1', `schema_version: 1${ending.value}unexpected: true`),
      ];
      for (const content of malformed) {
        assert.notEqual(content, stored);
        await writeFile(filePath, content, 'utf8');
        assert.throws(() => parseBronzeFile(content));
        assert.throws(() => parseBronzeRecord(content));
        await assert.rejects(verifyBronzeFile(filePath));
        await assert.rejects(createVerifiedBronzeReader(root).read(root, sourcePath));
        assert.deepEqual(await collectBronzeHashes(root), new Map());
      }
    });
  });
}
