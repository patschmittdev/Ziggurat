import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { normalizeText } from '../src/authorization/canonical.js';
import { canonicalBronzeBody, sha256Text } from '../src/bronze/canonical.js';
import { RefinementProposalPayloadSchema } from '../src/contracts/proposal.js';
import type { RefinementDraft } from '../src/contracts/refinement-draft.js';
import type { ChatMessage, StructuredChatAdapter } from '../src/refine/adapter.js';
import { buildBronzeReference, REFERENCE_LIMITS } from '../src/refine/context.js';
import type { BronzeReference } from '../src/refine/context.js';
import { RefinementError } from '../src/refine/errors.js';
import type { RefinementFailureCode } from '../src/refine/errors.js';
import { materializeDraft, readTargetSnapshot } from '../src/refine/materialize.js';
import { executeRefinement, requestRefinement } from '../src/refine/proposal.js';
import type { RefinementInput } from '../src/refine/proposal.js';

const SOURCE = 'bronze/article/source.md';
const TARGET = 'knowledge/claim.md';
const BODY = '# Source\nThe current claim.\nAdditional context.\n';
const EXISTING = '# Current page\r\nReviewed text stays unchanged.\r\n';
const RANGE = { source_id: 'source-1', line_start: 1, line_end: 2 };

function draft(overrides: Partial<RefinementDraft> = {}): RefinementDraft {
  return {
    schema_version: 1,
    operation: 'create',
    target_path: TARGET,
    candidate: {
      title: 'Proposed claim',
      type: 'concept',
      retrieval_eligible: false,
      pii: 'unknown',
      sensitivity: 'restricted',
      visibility: 'internal',
      egress: 'local-only',
      body: '# Proposed claim\nA model-authored interpretation.\n',
    },
    evidence: [{ ...RANGE }],
    contradictions: [],
    confidence: 'medium',
    affected_paths: [],
    related_paths: [],
    unresolved_questions: [],
    ...overrides,
  };
}

async function write(root: string, path: string, content: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content, 'utf8');
}

async function writeBronze(
  root: string,
  path = SOURCE,
  body = BODY,
  options: { digest?: string; sensitivity?: string; pii?: string } = {},
): Promise<void> {
  await write(root, path, [
    '---',
    'schema_version: 1',
    'source_id: stored-id-is-not-request-authority',
    'source_kind: article',
    'captured_at: 2026-01-01T00:00:00Z',
    `sha256: ${options.digest ?? sha256Text(canonicalBronzeBody(body))}`,
    `sensitivity: ${options.sensitivity ?? 'public'}`,
    `pii: '${options.pii ?? 'false'}'`,
    '---',
    body,
  ].join('\n'));
}

async function withVault(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(process.cwd(), '.ziggurat-draft-test-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

class ScriptedAdapter implements StructuredChatAdapter {
  public calls = 0;
  public seen: readonly ChatMessage[] = [];

  constructor(private readonly reply: (messages: readonly ChatMessage[]) => unknown | Promise<unknown>) {}

  async completeJson(messages: readonly ChatMessage[]): Promise<unknown> {
    this.calls++;
    this.seen = messages;
    return this.reply(messages);
  }
}

function failure(code: RefinementFailureCode): (error: unknown) => boolean {
  return error => error instanceof RefinementError && error.code === code;
}

function input(root: string, overrides: Partial<RefinementInput> = {}): RefinementInput {
  return { root, topic: 'claim', target_path: TARGET, bronze_source_paths: [SOURCE], ...overrides };
}

async function vaultState(root: string, omitProposals = false): Promise<Record<string, string>> {
  const state: Record<string, string> = {};
  async function visit(relative: string): Promise<void> {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (omitProposals && path === '.ziggurat/proposals') continue;
      if (entry.isDirectory()) {
        state[path] = 'directory';
        await visit(path);
      } else {
        state[path] = (await readFile(join(root, path))).toString('base64');
      }
    }
  }
  await visit('');
  return state;
}

const paths = [
  {
    name: 'executeRefinement',
    run: async (adapter: StructuredChatAdapter, request: RefinementInput) =>
      (await executeRefinement(adapter, request)).proposal,
  },
  { name: 'requestRefinement', run: requestRefinement },
];

test('materializeDraft: host derives exact quotes, hashes, candidate confidence, and sorted source union', async () => {
  await withVault(async root => {
    const sourcePaths = [
      'bronze/article/zulu.md',
      'bronze/article/alpha.md',
      'bronze/article/middle.md',
      'bronze/article/unused.md',
    ];
    for (const path of sourcePaths) await writeBronze(root, path, `# ${path}\nCafé 猫 e\u0301 🧱\n`);
    const reference = await buildBronzeReference(root, { sourcePaths });
    assert.deepEqual(reference.sources.map(source => source.source_id), [
      'source-1', 'source-2', 'source-3', 'source-4',
    ]);
    const raw = draft({
      evidence: [
        { source_id: 'source-4', line_start: 1, line_end: 2 },
        { source_id: 'source-1', line_start: 2, line_end: 2 },
        { source_id: 'source-4', line_start: 2, line_end: 2 },
      ],
      contradictions: [{
        summary: 'A separate source conflicts.',
        evidence: [{ source_id: 'source-2', line_start: 1, line_end: 2 }],
      }],
      confidence: 'high',
    });
    const original = structuredClone({ raw, reference });
    const payload = materializeDraft(raw, reference);
    assert.deepEqual({ raw, reference }, original);
    assert.equal(payload.schema_version, 2);
    assert.equal(payload.candidate.schema_version, 1);
    assert.equal(payload.candidate.confidence, 'high');
    assert.deepEqual(payload.candidate.sources, [
      'bronze/article/alpha.md', 'bronze/article/middle.md', 'bronze/article/zulu.md',
    ]);
    assert.deepEqual(payload.candidate, {
      ...raw.candidate,
      schema_version: 1,
      confidence: raw.confidence,
      sources: payload.candidate.sources,
    });
    assert.equal(Object.hasOwn(payload, 'base_content_sha256'), false);
    for (const citation of [...payload.evidence, ...payload.contradictions.flatMap(item => item.evidence)]) {
      const source = reference.sources.find(item => item.source_path === citation.source_path);
      assert.ok(source);
      const quote = source.lines.slice(citation.line_start - 1, citation.line_end).join('\n');
      assert.equal(citation.quote, quote);
      assert.equal(citation.body_sha256, source.body_sha256);
      assert.equal(citation.quote_sha256, sha256Text(quote));
      assert.equal(Object.hasOwn(citation, 'source_id'), false);
    }
    assert.deepEqual(RefinementProposalPayloadSchema.parse(payload), payload);
  });
});

test('materializeDraft: duplicate host source IDs fail even when the duplicate source is not cited', async () => {
  await withVault(async root => {
    await writeBronze(root);
    await writeBronze(root, 'bronze/article/other.md');
    const reference = await buildBronzeReference(root);
    const first = reference.sources[0];
    const second = reference.sources[1];
    assert.ok(first && second);
    second.source_id = first.source_id;
    assert.throws(() => materializeDraft(draft(), reference), failure('unknown-source'));
  });
});

test('readTargetSnapshot: reads exact live bytes and hashes normalized content without creating a missing target', async () => {
  await withVault(async root => {
    assert.deepEqual(await readTargetSnapshot(root, TARGET), { target_path: TARGET });
    assert.deepEqual(await vaultState(root), {});
    await write(root, TARGET, EXISTING);
    assert.deepEqual(await readTargetSnapshot(root, TARGET), {
      target_path: TARGET,
      content: EXISTING,
      sha256: sha256Text(normalizeText(EXISTING)),
    });
  });
});

const schemaMutations: Array<[string, (value: RefinementDraft) => unknown]> = [
  ['canonical v2 schema version', value => ({ ...value, schema_version: 2 })],
  ['unknown top-level field', value => ({ ...value, extra: true })],
  ['status', value => ({ ...value, status: 'gold' })],
  ['reviewed_by', value => ({ ...value, reviewed_by: 'human' })],
  ['reviewed_at', value => ({ ...value, reviewed_at: '2026-01-01T00:00:00Z' })],
  ['authorization', value => ({ ...value, authorization: { decision: 'approved' } })],
  ['receipt', value => ({ ...value, receipt: {} })],
  ['proposal_id', value => ({ ...value, proposal_id: '00000000-0000-4000-8000-000000000000' })],
  ['state', value => ({ ...value, state: 'staged' })],
  ['base_content_sha256', value => ({ ...value, base_content_sha256: sha256Text(EXISTING) })],
  ['candidate schema_version', value => ({ ...value, candidate: { ...value.candidate, schema_version: 1 } })],
  ['candidate sources', value => ({ ...value, candidate: { ...value.candidate, sources: [SOURCE] } })],
  ['candidate confidence', value => ({ ...value, candidate: { ...value.candidate, confidence: value.confidence } })],
  ['candidate admission metadata', value => ({ ...value, candidate: { ...value.candidate, status: 'gold' } })],
  ['candidate unknown field', value => ({ ...value, candidate: { ...value.candidate, extra: true } })],
  ['source_path', value => ({ ...value, evidence: [{ ...RANGE, source_path: SOURCE }] })],
  ['body_sha256', value => ({ ...value, evidence: [{ ...RANGE, body_sha256: sha256Text(BODY) }] })],
  ['quote', value => ({ ...value, evidence: [{ ...RANGE, quote: '# Source\nThe current claim.' }] })],
  ['quote_sha256', value => ({ ...value, evidence: [{ ...RANGE, quote_sha256: sha256Text('# Source\nThe current claim.') }] })],
  ['unknown evidence field', value => ({ ...value, evidence: [{ ...RANGE, extra: true }] })],
  ['unknown contradiction field', value => ({
    ...value, contradictions: [{ summary: 'Conflict', evidence: [{ ...RANGE }], extra: true }],
  })],
  ['contradiction evidence hash', value => ({
    ...value, contradictions: [{ summary: 'Conflict', evidence: [{ ...RANGE, body_sha256: sha256Text(BODY) }] }],
  })],
  ['missing candidate field', value => ({ ...value, candidate: { ...value.candidate, body: undefined } })],
  ['string line number', value => ({ ...value, evidence: [{ ...RANGE, line_start: '1' }] })],
  ['fractional line number', value => ({ ...value, evidence: [{ ...RANGE, line_start: 1.5 }] })],
  ['empty evidence', value => ({ ...value, evidence: [] })],
];

for (const boundary of paths) {
  test(`${boundary.name}: strict draft rejection never strips, repairs, retries, or writes`, async t => {
    await withVault(async root => {
      await writeBronze(root);
      const reference = await buildBronzeReference(root, { sourcePaths: [SOURCE] });
      const before = await vaultState(root);
      for (const [name, mutate] of schemaMutations) {
        await t.test(name, async () => {
          const raw = mutate(draft());
          const original = structuredClone(raw);
          assert.throws(() => materializeDraft(raw, reference), failure('draft-schema'));
          const adapter = new ScriptedAdapter(() => raw);
          await assert.rejects(() => boundary.run(adapter, input(root)), failure('draft-schema'));
          assert.equal(adapter.calls, 1);
          assert.deepEqual(raw, original);
          assert.deepEqual(await vaultState(root), before);
        });
      }
    });
  });

  for (const operation of ['create', 'amend', 'contradict'] as const) {
    test(`${boundary.name}: ${operation} materializes and stages only Silver without protected writes`, async () => {
      await withVault(async root => {
        await writeBronze(root);
        const protectedPaths = [
          'knowledge/protected.md',
          'authorizations/protected.md.authorization.json',
          '.ziggurat/trust.json',
          '.ziggurat/gold-index.json',
          '.ziggurat/review-index.json',
          '.ziggurat/evidence-index.json',
        ];
        for (const path of protectedPaths) await write(root, path, `Protected sentinel: ${path}\n`);
        if (operation !== 'create') await write(root, TARGET, EXISTING);
        const before = await vaultState(root, true);
        const raw = draft({
          operation,
          contradictions: operation === 'contradict'
            ? [{ summary: 'A conflicting claim.', evidence: [{ ...RANGE }] }]
            : [],
        });
        const adapter = new ScriptedAdapter(messages => {
          const prompt = JSON.parse(messages[1]?.content ?? '') as {
            request: { target_path: string; existing_content?: string };
          };
          assert.equal(prompt.request.target_path, TARGET);
          assert.equal(prompt.request.existing_content, operation === 'create' ? undefined : EXISTING);
          return raw;
        });
        const proposal = await boundary.run(adapter, input(root));
        assert.equal(adapter.calls, 1);
        assert.equal(proposal.operation, operation);
        assert.equal(proposal.schema_version, 2);
        assert.equal(proposal.state, 'staged');
        assert.equal(proposal.candidate.body, raw.candidate.body);
        assert.deepEqual(proposal.candidate.sources, [SOURCE]);
        assert.equal(proposal.candidate.confidence, raw.confidence);
        assert.equal(proposal.evidence[0]?.body_sha256, sha256Text(BODY));
        assert.equal(proposal.evidence[0]?.quote, '# Source\nThe current claim.');
        assert.equal(proposal.evidence[0]?.quote_sha256, sha256Text('# Source\nThe current claim.'));
        assert.equal(
          proposal.base_content_sha256,
          operation === 'create' ? undefined : sha256Text(normalizeText(EXISTING)),
        );
        assert.deepEqual(await vaultState(root, true), before);
        const staged = await readdir(join(root, '.ziggurat', 'proposals'));
        assert.deepEqual(staged, [`${proposal.proposal_id}.json`]);
        assert.deepEqual(JSON.parse(await readFile(join(root, '.ziggurat', 'proposals', staged[0]!), 'utf8')), proposal);
      });
    });
  }

  test(`${boundary.name}: source IDs authorize only the selected prompt snapshot, not existing filesystem paths`, async t => {
    await withVault(async root => {
      await writeBronze(root);
      const unselected = 'bronze/article/unselected.md';
      await writeBronze(root, unselected, '# Unselected\nThese bytes must not reach the model.\n');
      const before = await vaultState(root);
      for (const sourceId of ['source-2', 'source-999', SOURCE, unselected, 'stored-id-is-not-request-authority']) {
        for (const location of ['evidence', 'contradictions']) {
          await t.test(`${sourceId} in ${location}`, async () => {
            const evidence = [{ ...RANGE, source_id: sourceId }];
            const raw = location === 'evidence'
              ? draft({ evidence })
              : draft({ contradictions: [{ summary: 'Conflict', evidence }] });
            const adapter = new ScriptedAdapter(() => raw);
            await assert.rejects(() => boundary.run(adapter, input(root)), failure('unknown-source'));
            assert.equal(adapter.calls, 1);
            assert.ok(!adapter.seen[1]?.content.includes('These bytes must not reach the model.'));
            assert.deepEqual(await vaultState(root), before);
          });
        }
      }
    });
  });

  test(`${boundary.name}: line ranges are validated in both ordinary and contradiction evidence`, async t => {
    await withVault(async root => {
      await writeBronze(root);
      const before = await vaultState(root);
      const ranges: Array<[string, number, number, RefinementFailureCode]> = [
        ['zero start', 0, 1, 'draft-schema'],
        ['zero end', 1, 0, 'draft-schema'],
        ['negative start', -1, 1, 'draft-schema'],
        ['reversed', 3, 2, 'line-range'],
        ['start beyond body', 4, 4, 'line-range'],
        ['end beyond body', 1, 4, 'line-range'],
      ];
      for (const [name, line_start, line_end, code] of ranges) {
        for (const location of ['evidence', 'contradictions']) {
          await t.test(`${name} in ${location}`, async () => {
            const evidence = [{ source_id: 'source-1', line_start, line_end }];
            const raw = location === 'evidence'
              ? draft({ evidence })
              : draft({ contradictions: [{ summary: 'Conflict', evidence }] });
            const adapter = new ScriptedAdapter(() => raw);
            await assert.rejects(() => boundary.run(adapter, input(root)), failure(code));
            assert.equal(adapter.calls, 1);
            assert.deepEqual(await vaultState(root), before);
          });
        }
      }
    });
  });

  for (const mutation of ['body-only', 'rehashed-body', 'removed'] as const) {
    for (const location of ['evidence', 'contradictions'] as const) {
      test(`${boundary.name}: detects live Bronze ${mutation} after prompt in ${location}`, async () => {
        await withVault(async root => {
          await writeBronze(root);
          const other = 'bronze/article/zulu.md';
          await writeBronze(root, other);
          const changedPath = location === 'evidence' ? SOURCE : other;
          let afterMutation: Record<string, string> | undefined;
          const adapter = new ScriptedAdapter(async () => {
            if (mutation === 'removed') {
              await rm(join(root, changedPath));
            } else {
              // The cited lines stay identical; a fresh body digest must still fail the prompt snapshot.
              const changedBody = '# Source\nThe current claim.\nChanged uncited context.\n';
              await writeBronze(root, changedPath, changedBody, mutation === 'body-only'
                ? { digest: sha256Text(BODY) }
                : {});
            }
            afterMutation = await vaultState(root);
            return draft({
              contradictions: [{
                summary: 'Conflict',
                evidence: [{ ...RANGE, source_id: 'source-2' }],
              }],
            });
          });
          await assert.rejects(
            () => boundary.run(adapter, input(root, { bronze_source_paths: [SOURCE, other] })),
            failure('evidence-changed'),
          );
          assert.equal(adapter.calls, 1);
          assert.deepEqual(await vaultState(root), afterMutation);
        });
      });
    }
  }

  for (const operation of ['amend', 'contradict'] as const) {
    for (const mutation of ['changed', 'removed'] as const) {
      test(`${boundary.name}: detects ${operation} target ${mutation} after prompt`, async () => {
        await withVault(async root => {
          await writeBronze(root);
          await write(root, TARGET, EXISTING);
          let afterMutation: Record<string, string> | undefined;
          const adapter = new ScriptedAdapter(async messages => {
            assert.ok(messages[1]?.content.includes('Reviewed text stays unchanged.'));
            if (mutation === 'removed') await rm(join(root, TARGET));
            else await write(root, TARGET, '# New live content\n');
            afterMutation = await vaultState(root);
            return draft({
              operation,
              contradictions: [{ summary: 'Conflict', evidence: [{ ...RANGE }] }],
            });
          });
          await assert.rejects(() => boundary.run(adapter, input(root)), failure('target-changed'));
          assert.equal(adapter.calls, 1);
          assert.deepEqual(await vaultState(root), afterMutation);
        });
      });
    }

    for (const selected of [false, true]) {
      test(`${boundary.name}: ${operation} requires existing target context (${selected ? 'missing selected target' : 'unselected existing file'})`, async () => {
        await withVault(async root => {
          await writeBronze(root);
          if (!selected) await write(root, TARGET, EXISTING);
          const before = await vaultState(root);
          const adapter = new ScriptedAdapter(() => draft({
            operation,
            contradictions: [{ summary: 'Conflict', evidence: [{ ...RANGE }] }],
          }));
          await assert.rejects(
            () => boundary.run(adapter, input(root, { target_path: selected ? TARGET : undefined })),
            failure('target-context'),
          );
          assert.equal(adapter.calls, 1);
          assert.ok(!adapter.seen[1]?.content.includes('existing_content'));
          assert.deepEqual(await vaultState(root), before);
        });
      });
    }
  }

  test(`${boundary.name}: a create target appearing after the prompt is not overwritten`, async () => {
    await withVault(async root => {
      await writeBronze(root);
      let afterMutation: Record<string, string> | undefined;
      const adapter = new ScriptedAdapter(async () => {
        await write(root, TARGET, '# Concurrently created target\n');
        afterMutation = await vaultState(root);
        return draft();
      });
      await assert.rejects(() => boundary.run(adapter, input(root)), failure('target-changed'));
      assert.equal(adapter.calls, 1);
      assert.deepEqual(await vaultState(root), afterMutation);
    });
  });

  test(`${boundary.name}: model-selected target cannot override host selection for any operation`, async t => {
    await withVault(async root => {
      await writeBronze(root);
      for (const operation of ['create', 'amend', 'contradict'] as const) {
        await t.test(operation, async () => {
          if (operation !== 'create') await write(root, TARGET, EXISTING);
          const before = await vaultState(root);
          const adapter = new ScriptedAdapter(() => draft({
            operation,
            target_path: 'knowledge/different.md',
            contradictions: [{ summary: 'Conflict', evidence: [{ ...RANGE }] }],
          }));
          await assert.rejects(() => boundary.run(adapter, input(root)), failure('target-context'));
          assert.equal(adapter.calls, 1);
          assert.deepEqual(await vaultState(root), before);
        });
      }
    });
  });

  test(`${boundary.name}: a supplied existing_content cannot forge host-read context`, async t => {
    await withVault(async root => {
      await writeBronze(root);
      await write(root, TARGET, EXISTING);
      const before = await vaultState(root);
      for (const selected of [false, true]) {
        await t.test(selected ? 'different existing content' : 'no selected target', async () => {
          const adapter = new ScriptedAdapter(() => draft({ operation: 'amend' }));
          await assert.rejects(() => boundary.run(adapter, input(root, {
            target_path: selected ? TARGET : undefined,
            existing_content: selected ? '# Forged content\n' : EXISTING,
          })), failure('target-context'));
          assert.equal(adapter.calls, 0);
          assert.deepEqual(await vaultState(root), before);
        });
      }
    });
  });

  test(`${boundary.name}: no usable source means no model call and no write`, async t => {
    const scenarios = ['empty', 'empty selection', 'missing', 'hash-unverified', 'privacy-policy', 'source-too-large'] as const;
    for (const scenario of scenarios) {
      await t.test(scenario, async () => {
        await withVault(async root => {
          if (scenario !== 'empty') {
            await writeBronze(root, SOURCE, scenario === 'source-too-large'
              ? 'x'.repeat(REFERENCE_LIMITS.maxSourceBytes + 1)
              : BODY, {
              ...(scenario === 'hash-unverified' ? { digest: 'a'.repeat(64) } : {}),
              ...(scenario === 'privacy-policy' ? { sensitivity: 'restricted', pii: 'unknown' } : {}),
            });
          }
          const bronze_source_paths = scenario === 'empty selection' ? []
            : scenario === 'missing' ? ['bronze/article/missing.md']
              : scenario === 'privacy-policy' || scenario === 'empty' ? undefined : [SOURCE];
          const before = await vaultState(root);
          const adapter = new ScriptedAdapter(() => {
            assert.fail('The model must not run without supplied evidence.');
          });
          await assert.rejects(
            () => boundary.run(adapter, input(root, { bronze_source_paths })),
            failure('no-evidence'),
          );
          assert.equal(adapter.calls, 0);
          assert.deepEqual(await vaultState(root), before);
        });
      });
    }
  });
}

const bodies: Array<[string, string, string[]]> = [
  ['LF without final newline', '# Café\n猫 🧱 e\u0301\nfin', ['# Café', '猫 🧱 e\u0301', 'fin']],
  ['LF with final newline', '# Café\n猫 🧱 e\u0301\nfin\n', ['# Café', '猫 🧱 e\u0301', 'fin']],
  ['CRLF with final newline', '# Café\r\n猫 🧱 e\u0301\r\nfin\r\n', ['# Café', '猫 🧱 e\u0301', 'fin']],
  ['interior and trailing blank line', '# Café\n\n猫 🧱 e\u0301\n\n', ['# Café', '', '猫 🧱 e\u0301', '']],
  ['lone CR preserved', '# Café\r猫 🧱\nfin\n', ['# Café\r猫 🧱', 'fin']],
];

for (const [name, body, lines] of bodies) {
  test(`executeRefinement: exact host citation for ${name}`, async () => {
    await withVault(async root => {
      await writeBronze(root, SOURCE, body);
      const adapter = new ScriptedAdapter(() => draft({
        evidence: [{ source_id: 'source-1', line_start: 1, line_end: lines.length }],
      }));
      const result = await executeRefinement(adapter, input(root));
      assert.equal(result.reference.sources[0]?.line_count, lines.length);
      assert.deepEqual(result.reference.sources[0]?.lines, lines);
      assert.equal(result.reference.sources[0]?.body_sha256, sha256Text(canonicalBronzeBody(body)));
      assert.deepEqual(result.proposal.evidence, [{
        source_path: SOURCE,
        body_sha256: sha256Text(canonicalBronzeBody(body)),
        line_start: 1,
        line_end: lines.length,
        quote: lines.join('\n'),
        quote_sha256: sha256Text(lines.join('\n')),
      }]);
      assert.deepEqual(JSON.parse(await readFile(result.path, 'utf8')), result.proposal);
      assert.throws(
        () => materializeDraft(draft({
          evidence: [{ source_id: 'source-1', line_start: 1, line_end: lines.length + 1 }],
        }), result.reference),
        failure('line-range'),
      );
    });
  });
}

test('executeRefinement: optional source and target selection use policy-safe reference and a new model target', async () => {
  await withVault(async root => {
    await writeBronze(root);
    await writeBronze(root, 'bronze/article/private.md', '# Private bytes\n', {
      sensitivity: 'restricted', pii: 'unknown',
    });
    const adapter = new ScriptedAdapter(() => draft());
    const result = await executeRefinement(adapter, { root, topic: 'claim' });
    assert.equal(result.reference.selection, 'policy-filtered');
    assert.deepEqual(result.reference.sources.map(source => source.source_path), [SOURCE]);
    assert.ok(!adapter.seen[1]?.content.includes('Private bytes'));
    assert.equal(result.proposal.target_path, TARGET);
    assert.equal(result.proposal.state, 'staged');
  });
});

test('executeRefinement: matching caller content is checked but the prompt uses host-read bytes', async () => {
  await withVault(async root => {
    await writeBronze(root);
    await write(root, TARGET, EXISTING);
    const adapter = new ScriptedAdapter(() => draft({ operation: 'amend' }));
    const result = await executeRefinement(adapter, input(root, { existing_content: normalizeText(EXISTING) }));
    const prompt = JSON.parse(adapter.seen[1]?.content ?? '') as { request: { existing_content: string } };
    assert.equal(prompt.request.existing_content, EXISTING);
    assert.equal(result.proposal.base_content_sha256, sha256Text(normalizeText(EXISTING)));
  });
});

test('materializeDraft: final canonical validation still enforces path and operation semantics', async t => {
  await withVault(async root => {
    await writeBronze(root);
    await write(root, TARGET, EXISTING);
    const reference: BronzeReference = await buildBronzeReference(root, { sourcePaths: [SOURCE] });
    const target = await readTargetSnapshot(root, TARGET);
    for (const target_path of [
      '../escape.md', 'bronze/article/source.md', 'knowledge/Uppercase.md',
      'knowledge/nested/page.md', 'knowledge\\page.md', 'knowledge/con.md',
    ]) {
      await t.test(target_path, async () => {
        assert.throws(() => materializeDraft(draft({ target_path }), reference), failure('canonical-schema'));
        await assert.rejects(() => readTargetSnapshot(root, target_path), failure('target-path'));
      });
    }
    assert.throws(() => materializeDraft(draft({ affected_paths: ['../escape'] }), reference), failure('canonical-schema'));
    assert.throws(() => materializeDraft(draft({ related_paths: ['knowledge\\page.md'] }), reference), failure('canonical-schema'));
    assert.throws(() => materializeDraft(draft({ operation: 'contradict' }), reference, target), failure('canonical-schema'));
    assert.throws(() => materializeDraft(draft(), reference, target), failure('target-context'));
  });
});
