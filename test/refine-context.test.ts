import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { sha256Text } from '../src/bronze/canonical.js';
import type { RefinementProposalPayload } from '../src/contracts/index.js';
import {
  REFERENCE_LIMITS,
  REFINE_SYSTEM_PROMPT,
  UNTRUSTED_REFERENCE_NOTICE,
  buildBronzeReference,
  buildRefineMessages,
  bodyLines,
} from '../src/refine/context.js';
import { validateEvidenceCitation } from '../src/refine/evidence.js';
import { requestRefinement } from '../src/refine/proposal.js';
import type { ChatMessage, StructuredChatAdapter } from '../src/refine/adapter.js';

interface BronzeOptions {
  sensitivity?: string;
  pii?: string;
  sha256?: string;
}

async function writeBronze(
  root: string,
  relPath: string,
  body: string,
  options: BronzeOptions = {},
): Promise<void> {
  const canonical = body.replace(/\r\n/gu, '\n');
  const declared = options.sha256 ?? sha256Text(canonical);
  const frontmatter =
    'schema_version: 1\n'
    + `source_id: ${relPath.replace(/[^a-z0-9]+/gu, '-')}\n`
    + 'source_kind: article\n'
    + 'captured_at: 2026-01-01T00:00:00.000Z\n'
    + `sha256: ${declared}\n`
    + `sensitivity: ${options.sensitivity ?? 'public'}\n`
    + `pii: ${options.pii ?? "'false'"}\n`;
  const full = join(root, relPath);
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, `---\n${frontmatter}---\n${canonical}`, 'utf8');
}

async function withVault(fn: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-context-'));
  try {
    await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

class ScriptedAdapter implements StructuredChatAdapter {
  public seen: ChatMessage[] = [];
  constructor(private readonly reply: (messages: readonly ChatMessage[]) => unknown) {}
  async completeJson(messages: readonly ChatMessage[]): Promise<unknown> {
    this.seen = [...messages];
    return this.reply(messages);
  }
}

const BODY = '# Water rates\nThe published rate is 4.20 per unit.\nEffective next quarter.\n';

test('reference: labels the payload as untrusted, non-instructional evidence', async () => {
  await withVault(async root => {
    await writeBronze(root, 'bronze/article/rates.md', BODY);
    const reference = await buildBronzeReference(root, {
      sourcePaths: ['bronze/article/rates.md'],
    });
    assert.equal(reference.content_role, 'reference');
    assert.equal(reference.instruction_authority, 'none');
    assert.equal(reference.notice, UNTRUSTED_REFERENCE_NOTICE);
    assert.equal(reference.selection, 'operator-selected');
    assert.equal(reference.sources.length, 1);
  });
});

test('reference: line numbering matches the evidence validator exactly', async () => {
  await withVault(async root => {
    const path = 'bronze/article/rates.md';
    await writeBronze(root, path, BODY);
    const reference = await buildBronzeReference(root, { sourcePaths: [path] });
    const source = reference.sources[0];
    assert.ok(source !== undefined);
    assert.equal(source.line_count, 3);

    // Reconstruct a quote the way the system prompt instructs a model to.
    const quote = source.lines.slice(1, 3).join('\n');
    const failure = await validateEvidenceCitation(root, {
      source_path: source.source_path,
      body_sha256: source.body_sha256,
      line_start: 2,
      line_end: 3,
      quote,
      quote_sha256: sha256Text(quote),
    });
    assert.equal(failure, null);
  });
});

test('bodyLines: drops only the trailing newline element', () => {
  assert.deepEqual(bodyLines('a\nb\n'), ['a', 'b']);
  assert.deepEqual(bodyLines('a\nb'), ['a', 'b']);
  assert.deepEqual(bodyLines('a\n\n'), ['a', '']);
  assert.deepEqual(bodyLines(''), ['']);
});

test('reference: reports a requested path that does not exist', async () => {
  await withVault(async root => {
    await writeBronze(root, 'bronze/article/rates.md', BODY);
    const reference = await buildBronzeReference(root, {
      sourcePaths: ['bronze/article/absent.md'],
    });
    assert.deepEqual(reference.sources, []);
    assert.deepEqual(reference.omitted, [
      { source_path: 'bronze/article/absent.md', reason: 'not-found' },
    ]);
  });
});

test('reference: omits a record whose body no longer matches its declared digest', async () => {
  await withVault(async root => {
    const path = 'bronze/article/tampered.md';
    await writeBronze(root, path, BODY, { sha256: 'b'.repeat(64) });
    const reference = await buildBronzeReference(root, { sourcePaths: [path] });
    assert.deepEqual(reference.sources, []);
    assert.deepEqual(reference.omitted, [{ source_path: path, reason: 'hash-unverified' }]);
  });
});

test('reference: omits an oversize source instead of truncating it', async () => {
  await withVault(async root => {
    const path = 'bronze/article/huge.md';
    await writeBronze(root, path, 'x'.repeat(REFERENCE_LIMITS.maxSourceBytes + 1) + '\n');
    const reference = await buildBronzeReference(root, { sourcePaths: [path] });
    assert.deepEqual(reference.sources, []);
    assert.deepEqual(reference.omitted, [{ source_path: path, reason: 'source-too-large' }]);
  });
});

test('reference: the per-source ceiling is inclusive at exactly the limit', async () => {
  await withVault(async root => {
    const fits = 'bronze/article/fits.md';
    const over = 'bronze/article/over.md';
    // Body bytes are counted exactly, so build bodies of precisely N and N + 1 bytes.
    await writeBronze(root, fits, 'x'.repeat(REFERENCE_LIMITS.maxSourceBytes));
    await writeBronze(root, over, 'x'.repeat(REFERENCE_LIMITS.maxSourceBytes + 1));

    const included = await buildBronzeReference(root, { sourcePaths: [fits] });
    assert.equal(included.sources.length, 1);
    assert.deepEqual(included.omitted, []);
    assert.equal(
      Buffer.byteLength(included.sources[0]?.lines.join('\n') ?? '', 'utf8'),
      REFERENCE_LIMITS.maxSourceBytes,
    );

    const excluded = await buildBronzeReference(root, { sourcePaths: [over] });
    assert.deepEqual(excluded.sources, []);
    assert.deepEqual(excluded.omitted, [{ source_path: over, reason: 'source-too-large' }]);
  });
});

test('reference: the total-size ceiling omits the record that would cross it', async () => {
  await withVault(async root => {
    // Each record is individually legal; together they exceed the total ceiling.
    const per = REFERENCE_LIMITS.maxSourceBytes;
    const needed = Math.floor(REFERENCE_LIMITS.maxTotalBytes / per) + 1;
    assert.ok(needed <= REFERENCE_LIMITS.maxSources, 'limits must allow this scenario');

    const paths: string[] = [];
    for (let i = 0; i < needed; i++) {
      const path = `bronze/article/bulk-${String(i).padStart(2, '0')}.md`;
      await writeBronze(root, path, 'x'.repeat(per));
      paths.push(path);
    }

    const reference = await buildBronzeReference(root, { sourcePaths: paths });
    const fitting = Math.floor(REFERENCE_LIMITS.maxTotalBytes / per);
    assert.equal(reference.sources.length, fitting);
    assert.equal(reference.omitted.length, needed - fitting);
    assert.ok(reference.omitted.every(o => o.reason === 'total-size-limit'));

    const totalBytes = reference.sources.reduce(
      (sum, source) => sum + Buffer.byteLength(source.lines.join('\n'), 'utf8'),
      0,
    );
    assert.ok(totalBytes <= REFERENCE_LIMITS.maxTotalBytes);
  });
});

test('reference: caps the number of included sources', async () => {
  await withVault(async root => {
    const total = REFERENCE_LIMITS.maxSources + 3;
    const paths: string[] = [];
    for (let i = 0; i < total; i++) {
      const path = `bronze/article/doc-${String(i).padStart(2, '0')}.md`;
      await writeBronze(root, path, `# Doc ${i}\nBody line ${i}.\n`);
      paths.push(path);
    }
    const reference = await buildBronzeReference(root, { sourcePaths: paths });
    assert.equal(reference.sources.length, REFERENCE_LIMITS.maxSources);
    assert.equal(reference.omitted.length, 3);
    assert.ok(reference.omitted.every(o => o.reason === 'source-count-limit'));
  });
});

test('reference: the default selection applies the model-access privacy policy', async () => {
  await withVault(async root => {
    await writeBronze(root, 'bronze/article/public.md', BODY);
    await writeBronze(root, 'bronze/article/restricted.md', BODY, {
      sensitivity: 'restricted',
      pii: 'unknown',
    });

    const filtered = await buildBronzeReference(root);
    assert.equal(filtered.selection, 'policy-filtered');
    assert.deepEqual(filtered.sources.map(s => s.source_path), ['bronze/article/public.md']);
    assert.deepEqual(filtered.omitted, [
      { source_path: 'bronze/article/restricted.md', reason: 'privacy-policy' },
    ]);

    // A human naming the record overrides the default, and the override is recorded.
    const selected = await buildBronzeReference(root, {
      sourcePaths: ['bronze/article/restricted.md'],
    });
    assert.equal(selected.selection, 'operator-selected');
    assert.equal(selected.sources.length, 1);
  });
});

test('refine messages: state the authority boundary and carry no filesystem handle', async () => {
  await withVault(async root => {
    const path = 'bronze/article/rates.md';
    await writeBronze(root, path, BODY);
    const reference = await buildBronzeReference(root, { sourcePaths: [path] });
    const messages = buildRefineMessages({ topic: 'water rates' }, reference);

    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.role, 'system');
    assert.equal(messages[0]?.content, REFINE_SYSTEM_PROMPT);
    assert.match(REFINE_SYSTEM_PROMPT, /no filesystem, network, or tool access/u);
    assert.match(REFINE_SYSTEM_PROMPT, /nothing you return is admitted to durable memory/u);

    const user = messages[1]?.content ?? '';
    const parsed = JSON.parse(user) as {
      request: { topic: string };
      bronze_sources: { sources: Array<{ source_path: string }> };
    };
    assert.equal(parsed.request.topic, 'water rates');
    assert.deepEqual(parsed.bronze_sources.sources.map(s => s.source_path), [path]);
    // The vault root never appears: the model gets bytes, not a location it can fetch.
    assert.ok(!user.includes(root));
  });
});

test('refine: a model can produce a valid citation from the reference alone', async () => {
  await withVault(async root => {
    const path = 'bronze/article/rates.md';
    await writeBronze(root, path, BODY);

    const adapter = new ScriptedAdapter(messages => {
      const payload = JSON.parse(messages[1]?.content ?? '{}') as {
        bronze_sources: {
          sources: Array<{ source_path: string; body_sha256: string; lines: string[] }>;
        };
      };
      const source = payload.bronze_sources.sources[0];
      if (source === undefined) throw new Error('no reference source supplied');
      const quote = source.lines.slice(1, 2).join('\n');
      const proposal: RefinementProposalPayload = {
        schema_version: 2,
        operation: 'create',
        target_path: 'knowledge/water-rates.md',
        candidate: {
          schema_version: 1,
          title: 'Water rates',
          type: 'concept',
          sources: [source.source_path],
          confidence: 'medium',
          retrieval_eligible: false,
          pii: 'unknown',
          sensitivity: 'restricted',
          visibility: 'internal',
          egress: 'local-only',
          body: '# Water rates\n',
        },
        evidence: [{
          source_path: source.source_path,
          body_sha256: source.body_sha256,
          line_start: 2,
          line_end: 2,
          quote,
          quote_sha256: sha256Text(quote),
        }],
        confidence: 'medium',
        contradictions: [],
        affected_paths: [],
        related_paths: [],
        unresolved_questions: [],
      };
      return proposal;
    });

    const proposal = await requestRefinement(adapter, {
      root,
      topic: 'water rates',
      target_path: 'knowledge/water-rates.md',
      bronze_source_paths: [path],
    });
    assert.equal(proposal.state, 'staged');
    assert.equal(proposal.evidence[0]?.line_start, 2);
  });
});

test('refine: a fabricated quote still fails staging', async () => {
  await withVault(async root => {
    const path = 'bronze/article/rates.md';
    await writeBronze(root, path, BODY);
    const digest = sha256Text(BODY);

    const adapter = new ScriptedAdapter(() => ({
      schema_version: 2,
      operation: 'create',
      target_path: 'knowledge/water-rates.md',
      candidate: {
        schema_version: 1,
        title: 'Water rates',
        type: 'concept',
        sources: [path],
        confidence: 'medium',
        retrieval_eligible: false,
        pii: 'unknown',
        sensitivity: 'restricted',
        visibility: 'internal',
        egress: 'local-only',
        body: '# Water rates\n',
      },
      evidence: [{
        source_path: path,
        body_sha256: digest,
        line_start: 2,
        line_end: 2,
        quote: 'The published rate is 99.99 per unit.',
        quote_sha256: sha256Text('The published rate is 99.99 per unit.'),
      }],
      confidence: 'medium',
      contradictions: [],
      affected_paths: [],
      related_paths: [],
      unresolved_questions: [],
    }));

    await assert.rejects(
      () => requestRefinement(adapter, {
        root,
        topic: 'water rates',
        target_path: 'knowledge/water-rates.md',
        bronze_source_paths: [path],
      }),
      /Evidence citation failed/u,
    );
  });
});

test('refine: the adapter receives no bytes for a source the operator did not name', async () => {
  await withVault(async root => {
    await writeBronze(root, 'bronze/article/rates.md', BODY);
    await writeBronze(root, 'bronze/article/other.md', '# Other\nUnrelated evidence.\n');

    const adapter = new ScriptedAdapter(() => ({}));
    await assert.rejects(() => requestRefinement(adapter, {
      root,
      topic: 'water rates',
      target_path: 'knowledge/water-rates.md',
      bronze_source_paths: ['bronze/article/rates.md'],
    }));

    const user = adapter.seen[1]?.content ?? '';
    assert.ok(user.includes('4.20 per unit'));
    assert.ok(!user.includes('Unrelated evidence'));
  });
});
