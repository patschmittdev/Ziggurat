import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readFile,
  writeFile,
  mkdtemp,
  rm,
  mkdir,
  link,
  symlink,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPrivateKey } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as YAML from 'yaml';
import { runCli } from '../src/cli/main.js';
import { loadGoldIndex } from '../src/retrieval/gold-index.js';
const execute = promisify(execFile);
const signerPath = resolve(
  process.env.SIGNER_UNDER_TEST ?? 'examples/external-signer/signer.mjs',
);
// Dynamic loading keeps the standalone example outside TypeScript compilation.
const signer = await import(pathToFileURL(signerPath).href);
const vectors = JSON.parse(
  await readFile('fixtures/authorization/receipt-vectors.json', 'utf8'),
);
test('reference signer reproduces vectors from frontmatter and LF/CRLF files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signer-vectors-'));
  try {
    for (const newline of ['\n', '\r\n']) {
      const file = join(dir, 'page.md');
      await writeFile(
        file,
        (
          '---\n' +
          YAML.stringify(vectors.page.frontmatter) +
          '---\n' +
          vectors.page.body
        )
          .replace(/\r\n?/g, '\n')
          .replace(/\n/g, newline),
      );
      const { page, body } = signer.parsePage(await readFile(file, 'utf8'));
      assert.equal(
        signer.canonicalBytes(vectors.page.target_path, page, body).toString(),
        vectors.page.canonical_page_content,
      );
      assert.equal(
        signer.digest(vectors.page.target_path, page, body),
        vectors.page.canonical_page_content_sha256,
      );
      assert.equal(
        signer
          .signingPayload(
            signer.unsignedReceipt(
              vectors.page.target_path,
              page,
              body,
              vectors.signing.unsigned_receipt.key_id,
            ),
          )
          .toString(),
        vectors.signing.signing_payload,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('reference signer admits Gold through real commands and rejects tampering and revocation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'signer-e2e-'));
  const root = join(dir, 'vault');
  async function cli(args: string[]) {
    let out = '';
    let err = '';
    const code = await runCli([...args, '--root', root], {
      stdout: (t) => {
        out += t;
      },
      stderr: (t) => {
        err += t;
      },
    });
    assert.equal(code, 0, err);
    return out;
  }
  try {
    await cli(['init']);
    await writeFile(
      join(root, 'inbox/note.md'),
      'Synthetic garden reference.\n',
    );
    const ingested = JSON.parse(
      await cli(['ingest', '--file', 'inbox/note.md', '--json']),
    );
    const now = new Date().toISOString();
    const page = {
      ...vectors.page.frontmatter,
      title: 'Synthetic garden',
      type: 'concept',
      sources: [ingested.source_path],
      reviewed_by: 'reviewer-a',
      reviewed_at: now,
      last_verified: now,
    };
    const raw =
      '---\n' + YAML.stringify(page) + '---\nSynthetic garden reference.\n';
    const pageFile = join(root, 'knowledge/garden.md');
    await writeFile(pageFile, raw);
    const keyFile = join(dir, 'key.pem');
    const generated = await execute(process.execPath, [
      signerPath,
      'keygen',
      '--private-key',
      keyFile,
      '--reviewer-id',
      'reviewer-a',
      '--key-id',
      'reviewer-a-2026',
    ]);
    await writeFile(join(root, 'config/trust.yaml'), generated.stdout);
    const parsed = signer.parsePage(raw);
    await writeFile(
      join(root, 'authorizations/garden.md.authorization.json'),
      JSON.stringify(
        signer.signPage(
          'knowledge/garden.md',
          parsed.page,
          parsed.body,
          'reviewer-a-2026',
          createPrivateKey(await readFile(keyFile)),
        ),
      ),
    );
    await cli(['build']);
    assert.ok(
      (await loadGoldIndex(root)).chunks.some(
        (c) => c.path === 'knowledge/garden.md',
      ),
    );
    assert.match(await cli(['query', '--query', 'garden']), /Synthetic garden/);
    await writeFile(pageFile, raw + 'x');
    const changed = await cli(['build', '--json']);
    assert.equal((await loadGoldIndex(root)).chunks.length, 0);
    assert.match(changed, /digest/);
    await writeFile(pageFile, raw);
    await writeFile(
      join(root, 'config/trust.yaml'),
      'trust:\n  reviewers: []\n',
    );
    assert.match(await cli(['build', '--json']), /key is not trusted/);
    assert.equal((await loadGoldIndex(root)).chunks.length, 0);
    await assert.rejects(
      execute(process.execPath, [
        signerPath,
        'keygen',
        '--private-key',
        keyFile,
        '--reviewer-id',
        'reviewer-a',
        '--key-id',
        'reviewer-a-2026',
      ]),
      /EEXIST/,
    );
    const signArgs = [
      signerPath,
      'sign',
      '--page',
      pageFile,
      '--private-key',
      keyFile,
      '--key-id',
      'reviewer-a-2026',
      '--vault',
      root,
    ];
    await assert.rejects(
      execute(process.execPath, signArgs, { timeout: 3000 }),
      /interactive terminal/,
    );
    const inside = join(root, 'key.pem');
    await writeFile(inside, await readFile(keyFile));
    await assert.rejects(
      execute(process.execPath, [
        ...signArgs.slice(0, 5),
        inside,
        ...signArgs.slice(6),
      ]),
      /vault/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('standalone source preserves import independence and owner-only key creation', async () => {
  const source = await readFile(signerPath, 'utf8');
  const imports = [
    ...source.matchAll(
      /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)['"]([^'"]+)['"]/g,
    ),
  ].map((m) => m[1]);
  assert.ok(!source.includes('/src/') && !source.includes('dist/'));
  assert.match(source, /mode: 0o600/);
  assert.ok(imports.length > 0);
  assert.ok(imports.every((s) => s?.startsWith('node:') || s === 'yaml'));
});

test('reference parser agrees with runtime defaults and fractional timestamps', async () => {
  const { CuratedPageSchema } = await import('../src/contracts/curated.js');
  const { parseCorpusDocument } = await import('../src/corpus/documents.js');
  for (const extra of [
    { egress: undefined },
    {
      resolved_proposals: [
        '00000000-0000-0000-0000-000000000000',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
      ],
    },
    { reviewed_at: '2026-01-01T00:00:00.123456Z' },
  ]) {
    const frontmatter = { ...vectors.page.frontmatter, ...extra };
    const raw =
      '---\n' + YAML.stringify(frontmatter) + '---\nBody\rwith line endings\n';
    const runtime = parseCorpusDocument(
      raw,
      CuratedPageSchema,
      Object.keys(frontmatter),
    );
    assert.equal(runtime.valid, true);
    if (runtime.valid)
      assert.deepEqual(signer.parsePage(raw), {
        page: runtime.data,
        body: runtime.body,
      });
  }
  for (const extra of [
    { unknown: true },
    { reviewed_at: '2026-02-30T00:00:00Z' },
    { pii: false },
  ]) {
    const raw =
      '---\n' +
      YAML.stringify({ ...vectors.page.frontmatter, ...extra }) +
      '---\nBody\n';
    assert.throws(() => signer.parsePage(raw));
    assert.equal(parseCorpusDocument(raw, CuratedPageSchema, []).valid, false);
  }
});

test('canonical bytes agree with runtime for lone CR and absent proposal defaults; UUID case matches zod', async () => {
  const { canonicalPageContent } =
    await import('../src/authorization/canonical.js');
  const { CuratedPageSchema } = await import('../src/contracts/curated.js');
  const page = { ...vectors.page.frontmatter };
  delete page.resolved_proposals;
  assert.equal(
    signer.canonicalBytes('knowledge/garden.md', page, 'a\rb').toString(),
    canonicalPageContent(
      'knowledge/garden.md',
      CuratedPageSchema.parse(page),
      'a\rb',
    ),
  );
  for (const uuid of [
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    'FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF',
    'ABCDEFAB-ABCD-4ABC-ABCD-ABCDEFABCDEF',
    'abcdefab-abcd-4abc-abcd-abcdefabcdef',
    'abcdefab-abcd-0abc-abcd-abcdefabcdef',
  ]) {
    const input = { ...page, resolved_proposals: [uuid] };
    if (CuratedPageSchema.safeParse(input).success)
      assert.doesNotThrow(() => signer.validatePage(input));
    else assert.throws(() => signer.validatePage(input));
  }
  assert.throws(() =>
    signer.canonicalBytes('knowledge/nested/garden.md', page, 'body'),
  );
  assert.throws(() =>
    signer.unsignedReceipt(
      'knowledge/garden.md',
      { ...page, reviewed_by: undefined },
      'body',
      'key',
    ),
  );
});

test('CLI review, confirmation, exclusive output, location checks and private key isolation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'signer-cli-'));
  let stdout = '';
  let stderr = '';
  const io = {
    stdout: (text: string) => {
      stdout += text;
    },
    stderr: (text: string) => {
      stderr += text;
    },
    confirm: async (prompt: string) => prompt.split(' ')[1],
  };
  const root = join(dir, 'vault');
  const key = join(dir, 'key.pem');
  const pageFile = join(root, 'knowledge/garden.md');
  const options = {
    vault: root,
    page: pageFile,
    'private-key': key,
    'key-id': 'key-a',
  };
  try {
    await mkdir(join(root, 'config'), { recursive: true });
    await mkdir(join(root, 'knowledge'));
    await writeFile(
      join(root, 'config/trust.yaml'),
      'trust: {reviewers: []}\n',
    );
    await signer.runKeygen(
      { 'private-key': key, 'reviewer-id': 'reviewer-a', 'key-id': 'key-a' },
      io,
    );
    assert.ok(
      !stdout.includes('PRIVATE KEY') && !stderr.includes('PRIVATE KEY'),
    );
    if (process.platform !== 'win32')
      assert.equal((await stat(key)).mode & 0o777, 0o600);
    else t.diagnostic('POSIX mode assertion skipped on Windows');
    const page = {
      ...vectors.page.frontmatter,
      title: 'Safe\u202e title',
      egress: 'local-only',
    };
    delete page.resolved_proposals;
    const body = 'one\u200b\u009b\u007f\u061c\u200e\u2066\ufeff\u2028\nsecond';
    await writeFile(pageFile, '---\n' + YAML.stringify(page) + '---\n' + body);
    stdout = '';
    stderr = '';
    await signer.runSign(options, io);
    const canonical = JSON.parse(
      signer.canonicalBytes('knowledge/garden.md', page, body).toString(),
    );
    let previous = -1;
    for (const [name, value] of Object.entries(canonical.page)) {
      const visible = JSON.stringify(value).replace(/\u202e/g, '\\u{202E}');
      const position = stderr.indexOf(name + ': ' + visible + '\n');
      assert.ok(position > previous, name);
      previous = position;
    }
    assert.ok(stderr.includes('target_path: knowledge/garden.md'));
    assert.ok(stderr.includes('key_id: key-a'));
    assert.ok(stderr.includes(JSON.parse(stdout).content_sha256));
    assert.ok(
      stderr.includes(
        '1: one\\u{200B}\\u{009B}\\u{007F}\\u{061C}\\u{200E}\\u{2066}\\u{FEFF}\\u{2028}\n2: second',
      ),
    );
    assert.match(stderr, /Gold will reject: egress is local-only/);
    assert.ok(
      !stdout.includes('PRIVATE KEY') && !stderr.includes('PRIVATE KEY'),
    );
    for (const answer of ['wrong', '', undefined]) {
      await assert.rejects(
        signer.runSign(options, { ...io, confirm: async () => answer }),
        /confirmation/,
      );
    }
    const output = join(dir, 'receipt.json');
    await signer.runSign({ ...options, out: output }, io);
    assert.ok(!(await readFile(output, 'utf8')).includes('PRIVATE KEY'));
    await assert.rejects(
      signer.runSign({ ...options, out: output }, io),
      /EEXIST/,
    );
    await assert.rejects(
      signer.runSign({ ...options, vault: undefined }, io),
      /vault/,
    );
    const inside = join(root, 'inside.pem');
    await writeFile(inside, await readFile(key));
    await assert.rejects(
      signer.runSign({ ...options, 'private-key': inside }, io),
      /vault/,
    );
    await assert.rejects(
      signer.runKeygen({ 'private-key': join(root, 'config/new.pem') }, io),
      /vault/,
    );
    for (const parent of [join(root, 'stage'), join(dir, 'stage')]) {
      await mkdir(join(parent, 'knowledge'), { recursive: true });
      const staged = join(parent, 'knowledge/garden.md');
      await writeFile(staged, await readFile(pageFile));
      await assert.rejects(
        signer.runSign({ ...options, page: staged }, io),
        /knowledge/,
      );
    }
    const hard = join(dir, 'hard.pem');
    try {
      await link(key, hard);
    } catch (error) {
      t.diagnostic('hard links unsupported: ' + String(error));
      return;
    }
    await assert.rejects(
      signer.runSign({ ...options, 'private-key': hard }, io),
      /hard links/,
    );
    await rm(hard);
    const configAlias = join(dir, 'config-alias');
    await symlink(join(root, 'config'), configAlias, 'junction');
    await writeFile(join(root, 'config/inside.pem'), await readFile(key));
    await assert.rejects(
      signer.runSign(
        { ...options, 'private-key': join(configAlias, 'inside.pem') },
        io,
      ),
      /vault/,
    );
    const alias = join(dir, 'alias.pem');
    try {
      await symlink(inside, alias);
      await assert.rejects(
        signer.runSign({ ...options, 'private-key': alias }, io),
        /vault/,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
      t.diagnostic('key symlink unsupported; skipped');
    }
    const args = [
      signerPath,
      'sign',
      '--vault',
      root,
      '--page',
      pageFile,
      '--private-key',
      key,
      '--key-id',
      'key-a',
    ];
    await new Promise<void>((resolveTest, reject) => {
      const child = execFile(
        process.execPath,
        args,
        { timeout: 3000 },
        (error) => {
          try {
            assert.ok(error);
            assert.equal((error as any).killed, false);
            assert.match(String(error), /interactive terminal/);
            resolveTest();
          } catch (failure) {
            reject(failure);
          }
        },
      );
      child.stdin?.end();
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  'Windows knowledge junction outside vault is refused',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'signer-junction-'));
    try {
      const root = join(dir, 'vault');
      await mkdir(join(root, 'config'), { recursive: true });
      await mkdir(join(dir, 'outside'));
      await writeFile(
        join(root, 'config/trust.yaml'),
        'trust: {reviewers: []}',
      );
      try {
        await symlink(
          join(dir, 'outside'),
          join(root, 'knowledge'),
          'junction',
        );
      } catch (error) {
        t.skip('junction unsupported: ' + String(error));
        return;
      }
      await assert.rejects(
        signer.runSign(
          {
            vault: root,
            page: join(root, 'knowledge/garden.md'),
            'private-key': join(dir, 'key.pem'),
          },
          {},
        ),
        /outside the vault/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test('example dependency pin equals installed root yaml', async () => {
  const example = JSON.parse(
    await readFile('examples/external-signer/package.json', 'utf8'),
  );
  const installed = JSON.parse(
    await readFile('node_modules/yaml/package.json', 'utf8'),
  );
  assert.equal(example.dependencies.yaml, installed.version);
});

test('reviewed pages require sources and verification metadata; YAML errors reveal position only', () => {
  assert.throws(() =>
    signer.validatePage({
      ...vectors.page.frontmatter,
      sources: [],
      last_verified: undefined,
    }),
  );
  assert.throws(
    () => signer.parsePage('---\ntitle: [PRIVATE-CONTENT\n---\nbody'),
    (error) => {
      assert.match(String(error), /frontmatter is not valid YAML at line/);
      assert.ok(!String(error).includes('PRIVATE-CONTENT'));
      return true;
    },
  );
});
test(
  'keygen requests owner-only file mode and POSIX applies it',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'signer-mode-'));
    try {
      const key = join(dir, 'key.pem');
      await signer.runKeygen(
        { 'private-key': key, 'reviewer-id': 'reviewer-a', 'key-id': 'key-a' },
        { stdout: () => {}, stderr: () => {} },
      );
      assert.equal((await stat(key)).mode & 0o777, 0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
