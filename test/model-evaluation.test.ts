import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { AdapterError } from '../src/refine/adapter.js';
import { RefinementError } from '../src/refine/errors.js';
import {
  AttemptSchema, FixtureSchema, OPERATIONS, PinnedManifestSchema, RatingsSchema, readCompletedRun,
  sealRun, sha256, summarize, writeJson,
} from './manual/model-report.js';
import type { Attempt, Ratings } from './manual/model-report.js';
import { describeError, parseEvaluationArgs } from './manual/refine-model.js';
import { observeResponse } from './manual/model-response.js';

async function withRun(fn: (root: string, attempts: Attempt[], ratings: Ratings) => Promise<void>, staged = 81) {
  const root = await mkdtemp(join(resolve('.'), '.model-report-test-'));
  const runId = randomUUID();
  try {
    const fixture = await readFile(join(resolve('.'), 'fixtures', 'refine-model', 'scenarios.json'));
    await writeFile(join(root, 'fixtures.json'), fixture);
    const attempts: Attempt[] = [];
    for (const operation of OPERATIONS) {
      for (let scenario = 1; scenario <= 10; scenario++) {
        for (let trial = 1; trial <= 3; trial++) {
          const scenarioId = `${operation}-${String(scenario).padStart(2, '0')}`;
          const id = `${scenarioId}-trial-${trial}`;
          const dir = join(root, 'attempts', id);
          await mkdir(dir, { recursive: true });
          const success = attempts.length < staged;
          const artifact = `${JSON.stringify({ test_only_record: id })}\n`;
          if (success) await writeFile(join(dir, 'artifact.json'), artifact);
          await writeFile(join(dir, 'review.md'), `Inert unit-test report for ${id}\n`);
          await writeJson(join(dir, 'response.json'), observeResponse(null, 'Unit-test records do not call a model.'));
          const attempt = AttemptSchema.parse({
            schema_version: 1, run_id: runId, attempt_id: id, scenario_id: scenarioId, operation, trial,
            started_at: '2026-09-11T00:00:00.000Z', latency_ms: 12, model_latency_ms: success ? 10 : null,
            staged: success, actual_operation: success ? operation : null,
            artifact_path: success ? `attempts/${id}/artifact.json` : null,
            artifact_sha256: success ? sha256(artifact) : null,
            review_packet_path: `attempts/${id}/review.md`, review_rendered: success,
            error: success ? null : { kind: 'adapter', code: 'transport_error', message: 'Unit-test failure record' },
            omissions: [], request_message_bytes: 40, draft_json_bytes: success ? 40 : null,
            response_path: `attempts/${id}/response.json`, response_received: false,
            response_unavailable_reason: 'Unit-test records do not call a model.',
            token_usage: null, token_usage_reason: 'No server usage in this unit-test record.',
            peak_rss_bytes: 1024, human_usable: null, human_reason: 'Pending human review',
          });
          attempts.push(attempt);
          await writeJson(join(dir, 'attempt.json'), attempt);
        }
      }
    }
    const ratings = await sealRun(root, runId, attempts);
    await fn(root, attempts, ratings);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function putRatings(root: string, ratings: Ratings, attempts: Attempt[], usable: number): Promise<void> {
  let remaining = usable;
  for (const rating of ratings.ratings) {
    const attempt = attempts.find(item => item.attempt_id === rating.attempt_id)!;
    rating.human_usable = attempt.staged && remaining-- > 0;
    rating.reason = rating.human_usable
      ? 'Unit-test rating input represents a supplied human judgment, not a model measurement.'
      : 'Unit-test human rejection record.';
  }
  await writeFile(join(root, 'ratings.json'), `${JSON.stringify(ratings, null, 2)}\n`);
}

test('fixed evaluation fixtures have 10 scenarios per operation and static non-create targets', async () => {
  const fixture = FixtureSchema.parse(JSON.parse(await readFile(
    join(resolve('.'), 'fixtures', 'refine-model', 'scenarios.json'), 'utf8',
  )));
  for (const operation of OPERATIONS) {
    const scenarios = fixture.scenarios.filter(scenario => scenario.operation === operation);
    assert.equal(scenarios.length, 10);
    assert.ok(scenarios.some(scenario => scenario.tags.includes('hostile')));
    assert.ok(scenarios.some(scenario => scenario.sources.length > 1));
    assert.ok(scenarios.some(scenario => scenario.tags.includes('ambiguous')));
    assert.ok(scenarios.every(scenario => (scenario.existing_content === undefined) === (operation === 'create')));
  }
  assert.ok(fixture.scenarios[0]!.sources[0]!.body.endsWith('\n'), 'Schema must not rewrite frozen fixture text');
});

test('90 is the fixed denominator and missing human ratings are pending, never pass', async () => {
  await withRun(async (root, attempts) => {
    const { ratings } = await readCompletedRun(root);
    const summary = summarize(attempts, ratings);
    assert.equal(summary.denominator, 90);
    assert.equal(summary.staged, 81);
    assert.equal(summary.staging_pass, true);
    assert.equal(summary.human_usable, 0);
    assert.equal(summary.human_usability_pass, null);
    assert.equal(summary.model_gate, 'pending');
    assert.equal(summary.missing_human_scores, 90);
    assert.equal(summary.errors.length, 9);
    assert.equal(summary.by_operation.create?.denominator, 30);
    assert.throws(() => summarize(attempts.slice(0, 81)), /all 90/u);
    assert.throws(() => summarize([...attempts.slice(0, 89), attempts[0]!]), /90 unique/u);
  });
});

test('human threshold is 72/90, not 80 percent of staged proposals', async () => {
  await withRun(async (root, attempts, ratings) => {
    await putRatings(root, ratings, attempts, 71);
    let verified = await readCompletedRun(root);
    assert.equal(summarize(verified.attempts, verified.ratings).model_gate, 'fail');
    await putRatings(root, ratings, attempts, 72);
    verified = await readCompletedRun(root);
    const summary = summarize(verified.attempts, verified.ratings);
    assert.equal(summary.human_usable_rate, 72 / 90);
    assert.equal(summary.model_gate, 'pass');
    assert.equal(summary.by_operation.contradict?.human_usable_ingest_to_review_example, true);
    ratings.ratings[0]!.human_usable = null;
    ratings.ratings[0]!.reason = 'Human judgment not supplied';
    await writeFile(join(root, 'ratings.json'), JSON.stringify(ratings));
    verified = await readCompletedRun(root);
    assert.equal(summarize(verified.attempts, verified.ratings).model_gate, 'pending');
  });
});

test('80 staged attempts fail the 81/90 staging threshold even with 72 human-usable ratings', async () => {
  await withRun(async (root, attempts, ratings) => {
    await putRatings(root, ratings, attempts, 72);
    const verified = await readCompletedRun(root);
    const summary = summarize(verified.attempts, verified.ratings);
    assert.equal(summary.staging_pass, false);
    assert.equal(summary.model_gate, 'fail');
  }, 80);
});

test('scoring rejects incomplete runs, mismatched identities, and altered immutable artifacts', async () => {
  await withRun(async (root, attempts, ratings) => {
    const completePath = join(root, 'COMPLETE.json');
    const completed = await readFile(completePath);
    await rm(completePath);
    await assert.rejects(readCompletedRun(root), /ENOENT/u);
    await writeFile(completePath, completed);
    ratings.ratings[0]!.attempt_sha256 = '0'.repeat(64);
    await writeFile(join(root, 'ratings.json'), JSON.stringify(ratings));
    await assert.rejects(readCompletedRun(root), /identity or artifact digest/u);
    ratings.ratings[0]!.attempt_sha256 = sha256(await readFile(join(root, 'attempts', attempts[0]!.attempt_id, 'attempt.json')));
    await writeFile(join(root, 'ratings.json'), JSON.stringify(ratings));
    await writeFile(join(root, attempts[0]!.artifact_path!), 'changed artifact\n');
    await assert.rejects(readCompletedRun(root), /immutable file inventory or digest/u);
  });
});

test('ratings cannot duplicate identities, score failures usable, or omit a reason', async () => {
  await withRun(async (root, attempts, ratings) => {
    ratings.ratings[89]!.human_usable = true;
    ratings.ratings[89]!.reason = 'Invalid optimistic rating';
    await writeFile(join(root, 'ratings.json'), JSON.stringify(ratings));
    await assert.rejects(readCompletedRun(root), /unstaged, unreviewable, or wrong-operation/u);
    ratings.ratings[89]!.human_usable = false;
    ratings.ratings[89]!.attempt_id = ratings.ratings[0]!.attempt_id;
    assert.throws(() => summarize(attempts, ratings), /exactly once/u);
    ratings.ratings[0]!.reason = '';
    assert.equal(RatingsSchema.safeParse(ratings).success, false);
  });
});

test('scoring rejects an added immutable file and accepts only the ratings/scores mutable areas', async () => {
  await withRun(async (root) => {
    await mkdir(join(root, 'scores'));
    await writeFile(join(root, 'scores', 'previous.json'), '{}');
    await readCompletedRun(root);
    await writeFile(join(root, 'extra.json'), '{}');
    await assert.rejects(readCompletedRun(root), /immutable file inventory or digest/u);
  });
});

test('strict CLI separates score/run and rejects absent endpoints, duplicate flags, and malformed limits', () => {
  const run = ['--endpoint', 'http://127.0.0.1:8080/v1/chat/completions', '--output', '.model-runs\\run',
    '--manifest', '.model-runs\\pins.json'];
  assert.equal(parseEvaluationArgs(run).mode, 'run');
  assert.equal(parseEvaluationArgs(['--score', '.model-runs\\run']).mode, 'score');
  assert.throws(() => parseEvaluationArgs([]), /required/u);
  assert.throws(() => parseEvaluationArgs([...run, '--seed=-1']), /nonnegative/u);
  assert.throws(() => parseEvaluationArgs([...run, '--max-tokens', '0']), /1–4096/u);
  assert.throws(() => parseEvaluationArgs([...run, '--seed', '1', '--seed', '2']), /Repeated/u);
  assert.throws(() => parseEvaluationArgs([...run, '--output', '--model']), /Missing|Repeated|ambiguous/u);
  assert.throws(() => parseEvaluationArgs(['--score', 'run', '--model', 'other']), /cannot be combined/u);
  assert.throws(() => parseEvaluationArgs([...run, '--unknown']), /Unknown/u);
  assert.throws(() => parseEvaluationArgs(['--endpoint', 'https://example.com/v1/chat/completions', ...run.slice(2)]), /HTTP loopback/u);
});

test('typed failure codes remain distinct and arbitrary code-shaped errors are unknown', () => {
  assert.equal(describeError(new RefinementError('unknown-source', 'source unavailable')).kind, 'refinement');
  assert.equal(describeError(new AdapterError('invalid_json', 'invalid response')).code, 'invalid_json');
  assert.equal(describeError(Object.assign(new Error('failure'), { code: 'timeout' })).code, 'unknown');
  assert.equal(describeError({ code: 'http_error' }).kind, 'unknown');
});

test('pinned manifests retain every split-model file without inventing a combined checksum', () => {
  const first = { name: 'model-00001-of-00002.gguf', sha256: 'a'.repeat(64), bytes: 100 };
  const second = { name: 'model-00002-of-00002.gguf', sha256: 'b'.repeat(64) };
  const manifest = {
    schema_version: 1,
    server: { repository: 'test-only-server', commit: 'c'.repeat(40), build: 'test-only-build' },
    model: { repository: 'test-only-model', revision: 'd'.repeat(40),
      files: [first, second], license: 'test-only-license', alias: 'test-only-alias' },
    runtime: { chat_template: 'test-only-template', context_size: 8192, gpu_offload: '99 layers',
      parallel: 1, context_shift: false },
    machine: { cpu: 'test-only-cpu', ram_gib: 31.8, gpu: 'test-only-gpu', vram_gib: 16 },
    probe: { response_format: 'test-only-probe', verified_at: '2026-09-11T00:00:00Z' },
  };
  const parsed = PinnedManifestSchema.parse(manifest);
  assert.deepEqual(parsed.model.files, [first, second]);
  assert.equal('sha256' in parsed.model, false);
  assert.equal(parsed.runtime.context_shift, false);
  assert.equal(parsed.machine?.vram_gib, 16);
  assert.equal(PinnedManifestSchema.safeParse({
    ...manifest, model: { ...manifest.model, files: [] },
  }).success, false);
  assert.equal(PinnedManifestSchema.safeParse({
    ...manifest, model: { ...manifest.model, files: [first, first] },
  }).success, false);
});

test('runtime manifests preserve original pins without manufacturing a protocol-probe timestamp', () => {
  const manifest = {
    server: {
      repository: 'test-only-server', tag: 'test-only-tag', commit: 'c'.repeat(40), build: 'test-only-build',
      archive_sha256: 'd'.repeat(64), cuda_runtime_archive_sha256: 'e'.repeat(64),
      host: '127.0.0.1', port: 18080, alias: 'test-only-alias', context_size: 8192,
      gpu_layers: 99, parallel: 1, context_shift: false, offline: true,
    },
    model: {
      repository: 'test-only-model', revision: 'f'.repeat(40), license: 'test-only-license',
      quantization: 'Q4_K_M', chat_template: 'test-only-template',
      files: [{ name: 'first.gguf', sha256: 'a'.repeat(64), bytes: 100 },
        { name: 'second.gguf', sha256: 'b'.repeat(64), bytes: 50 }],
    },
    hardware: { cpu: 'test-only-cpu', ram_gib: 31.8, gpu: 'test-only-gpu', vram_mib: 16376,
      driver: 'test-only-driver', os: 'Windows' },
    generation: { temperature: 0, max_tokens: 2048, stream: false,
      request_deadline_ms: 30000, request_response_ceiling_bytes: 1048576 },
  };
  const parsed = PinnedManifestSchema.parse(manifest);
  assert.equal(parsed.model.alias, 'test-only-alias');
  assert.equal(parsed.model.files.length, 2);
  assert.equal(parsed.probe, null);
  assert.ok('original_runtime_manifest' in parsed);
  assert.deepEqual(parsed.original_runtime_manifest, manifest);
  assert.equal(PinnedManifestSchema.safeParse({
    ...manifest, generation: { ...manifest.generation, request_deadline_ms: 60000 },
  }).success, false);
});

test('bounded raw response observations preserve malformed failures and valid or partial token counts', async () => {
  const root = await mkdtemp(join(resolve('.'), '.model-report-test-'));
  try {
    const body = 'not JSON\n<script>inert payload</script>\n';
    await writeJson(join(root, 'malformed.json'), observeResponse({ status: 500, body }, 'unused'));
    const malformed = JSON.parse(await readFile(join(root, 'malformed.json'), 'utf8'));
    assert.equal(malformed.body, body);
    assert.equal(malformed.status, 500);
    assert.equal(malformed.token_usage, null);
    assert.match(malformed.token_usage_reason, /without repair/u);
    const valid = observeResponse({ status: 200,
      body: JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }),
    }, 'unused');
    assert.deepEqual(valid.token_usage, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 });
    const partial = observeResponse({ status: 200,
      body: JSON.stringify({ usage: { prompt_tokens: '100', completion_tokens: 20, total_tokens: -1 } }),
    }, 'unused');
    assert.deepEqual(partial.token_usage, { prompt_tokens: null, completion_tokens: 20, total_tokens: null });
    const unavailable = observeResponse(null, 'adapter:response_limit');
    assert.equal(unavailable.body, null);
    assert.equal(unavailable.unavailable_reason, 'adapter:response_limit');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
