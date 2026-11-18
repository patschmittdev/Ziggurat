import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';

export const OPERATIONS = ['create', 'amend', 'contradict'] as const;
export const DENOMINATOR = 90;
export const TRIALS = 3;
const digest = z.string().regex(/^[0-9a-f]{64}$/u);
const operation = z.enum(OPERATIONS);
const nonempty = z.string().min(1).refine(value => value.trim().length > 0);
const relativePath = z.string().regex(/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/u)
  .refine(value => !value.split('/').some(part => part === '.' || part === '..'));

export const FixtureSchema = z.object({
  schema_version: z.literal(1),
  revision: nonempty,
  topic_prefix: nonempty,
  scenarios: z.array(z.object({
    id: z.string().regex(/^(create|amend|contradict)-\d{2}$/u),
    operation,
    target_path: z.string().regex(/^knowledge\/[a-z0-9-]+\.md$/u),
    topic: nonempty,
    tags: z.array(z.enum(['technical', 'multiline', 'multisource', 'ambiguous', 'hostile'])).min(1),
    existing_content: nonempty.optional(),
    sources: z.array(z.object({
      name: z.string().regex(/^[a-z0-9-]+$/u),
      body: nonempty,
    }).strict()).min(1),
    review_expectations: z.array(nonempty).min(1),
  }).strict()).length(30),
}).strict().superRefine((value, context) => {
  for (const op of OPERATIONS) {
    for (let n = 1; n <= 10; n++) {
      const id = `${op}-${String(n).padStart(2, '0')}`;
      const matches = value.scenarios.filter(scenario => scenario.id === id && scenario.operation === op);
      if (matches.length !== 1) context.addIssue({ code: 'custom', message: `Missing or duplicate ${id}` });
    }
  }
  for (const scenario of value.scenarios) {
    if ((scenario.operation === 'create') !== (scenario.existing_content === undefined)) {
      context.addIssue({ code: 'custom', message: `Invalid static target for ${scenario.id}` });
    }
    if (new Set(scenario.sources.map(source => source.name)).size !== scenario.sources.length) {
      context.addIssue({ code: 'custom', message: `Duplicate source names in ${scenario.id}` });
    }
  }
});
export type Fixture = z.infer<typeof FixtureSchema>;

const ModelFilesSchema = z.array(z.object({
  name: nonempty,
  sha256: digest,
  bytes: z.number().int().positive().optional(),
}).strict()).min(1).refine(files => new Set(files.map(file => file.name)).size === files.length,
  'Model filenames must be unique');

const StandardPinnedManifestSchema = z.object({
  schema_version: z.literal(1),
  server: z.object({
    repository: nonempty,
    commit: z.string().regex(/^[0-9a-f]{40}$/u),
    build: nonempty,
  }).strict(),
  model: z.object({
    repository: nonempty,
    revision: z.string().regex(/^[0-9a-f]{40}$/u),
    files: ModelFilesSchema,
    license: nonempty,
    alias: nonempty,
  }).strict(),
  runtime: z.object({
    chat_template: nonempty,
    context_size: z.number().int().positive(),
    gpu_offload: nonempty,
    parallel: z.number().int().positive().optional(),
    context_shift: z.boolean().optional(),
  }).strict(),
  machine: z.object({
    cpu: nonempty,
    ram_gib: z.number().positive(),
    gpu: nonempty,
    vram_gib: z.number().positive(),
  }).strict().optional(),
  probe: z.object({
    response_format: nonempty,
    verified_at: z.iso.datetime({ offset: true }),
  }).strict(),
}).strict();

const RuntimeManifestSchema = z.object({
  server: z.object({
    repository: nonempty, tag: nonempty, commit: z.string().regex(/^[0-9a-f]{40}$/u), build: nonempty,
    archive_sha256: digest, cuda_runtime_archive_sha256: digest,
    host: z.enum(['localhost', '127.0.0.1', '::1']),
    port: z.number().int().min(1).max(65535), alias: nonempty,
    context_size: z.number().int().positive(), gpu_layers: z.number().int().nonnegative(),
    parallel: z.number().int().positive(), context_shift: z.boolean(), offline: z.boolean(),
  }).strict(),
  model: z.object({
    repository: nonempty, revision: z.string().regex(/^[0-9a-f]{40}$/u), license: nonempty,
    quantization: nonempty, chat_template: nonempty,
    files: ModelFilesSchema,
  }).strict(),
  hardware: z.object({
    cpu: nonempty, ram_gib: z.number().positive(), gpu: nonempty, vram_mib: z.number().positive(),
    driver: nonempty, os: nonempty,
  }).strict(),
  generation: z.object({
    temperature: z.literal(0), max_tokens: z.number().int().min(1).max(4096), stream: z.literal(false),
    request_deadline_ms: z.literal(30_000), request_response_ceiling_bytes: z.literal(1_048_576),
  }).strict(),
}).strict();

export const PinnedManifestSchema = z.union([
  StandardPinnedManifestSchema,
  RuntimeManifestSchema.transform(manifest => ({
    schema_version: 1 as const,
    server: manifest.server,
    model: {
      ...manifest.model,
      alias: manifest.server.alias,
    },
    runtime: {
      chat_template: manifest.model.chat_template, context_size: manifest.server.context_size,
      gpu_offload: `${manifest.server.gpu_layers} layers`, parallel: manifest.server.parallel,
      context_shift: manifest.server.context_shift,
    },
    machine: {
      cpu: manifest.hardware.cpu, ram_gib: manifest.hardware.ram_gib,
      gpu: manifest.hardware.gpu, vram_gib: manifest.hardware.vram_mib / 1024,
    },
    probe: null,
    probe_record_note: 'No probe timestamp is present in this supplied runtime manifest. Verify the protocol separately before evaluation; pilot requests are excluded from the 90 measured attempts.',
    declared_generation: manifest.generation,
    original_runtime_manifest: manifest,
  })),
]);

export const TokenUsageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative().nullable(),
  completion_tokens: z.number().int().nonnegative().nullable(),
  total_tokens: z.number().int().nonnegative().nullable(),
}).strict();
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const AttemptSchema = z.object({
  schema_version: z.literal(1),
  run_id: z.uuid(),
  attempt_id: z.string().regex(/^(create|amend|contradict)-\d{2}-trial-[123]$/u),
  scenario_id: nonempty,
  operation,
  trial: z.number().int().min(1).max(TRIALS),
  started_at: z.iso.datetime(),
  latency_ms: z.number().nonnegative(),
  model_latency_ms: z.number().nonnegative().nullable(),
  staged: z.boolean(),
  actual_operation: operation.nullable(),
  artifact_path: relativePath.nullable(),
  artifact_sha256: digest.nullable(),
  review_packet_path: relativePath,
  review_rendered: z.boolean(),
  error: z.object({
    kind: z.enum(['refinement', 'adapter', 'harness', 'unknown']),
    code: nonempty,
    message: z.string(),
  }).strict().nullable(),
  omissions: z.array(z.unknown()),
  request_message_bytes: z.number().int().nonnegative(),
  draft_json_bytes: z.number().int().nonnegative().nullable(),
  response_path: relativePath,
  response_received: z.boolean(),
  response_unavailable_reason: nonempty.nullable(),
  token_usage: TokenUsageSchema.nullable(),
  token_usage_reason: nonempty.nullable(),
  peak_rss_bytes: z.number().int().nonnegative(),
  human_usable: z.null(),
  human_reason: nonempty,
}).strict().superRefine((value, context) => {
  if (value.attempt_id !== `${value.scenario_id}-trial-${value.trial}`
    || !value.scenario_id.startsWith(`${value.operation}-`)
    || value.staged !== (value.artifact_path !== null && value.artifact_sha256 !== null)
    || value.staged !== (value.actual_operation !== null)
    || (!value.staged && value.error === null)) {
    context.addIssue({ code: 'custom', message: 'Inconsistent attempt identity or staging state' });
  }
});
export type Attempt = z.infer<typeof AttemptSchema>;

const RatingSchema = z.object({
  attempt_id: nonempty,
  attempt_sha256: digest,
  artifact_sha256: digest.nullable(),
  human_usable: z.boolean().nullable(),
  reason: nonempty,
}).strict();
export const RatingsSchema = z.object({
  schema_version: z.literal(1),
  run_id: z.uuid(),
  completed_sha256: digest,
  ratings: z.array(RatingSchema).length(DENOMINATOR),
}).strict();
export type Ratings = z.infer<typeof RatingsSchema>;

const CompletedSchema = z.object({
  schema_version: z.literal(1),
  run_id: z.uuid(),
  completed_at: z.iso.datetime(),
  denominator: z.literal(DENOMINATOR),
  fixture_sha256: digest,
  attempts: z.array(z.object({
    attempt_id: nonempty,
    path: relativePath,
    sha256: digest,
  }).strict()).length(DENOMINATOR),
  files: z.array(z.object({ path: relativePath, sha256: digest }).strict()).min(1),
}).strict();

export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx', encoding: 'utf8' });
}

async function regularFile(root: string, path: string): Promise<Buffer> {
  relativePath.parse(path);
  let current = root;
  const parts = path.split('/');
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`Run contains a non-regular path: ${path}`);
    }
  }
  return readFile(current);
}

async function inventory(root: string, prefix = ''): Promise<Array<{ path: string; sha256: string }>> {
  const result: Array<{ path: string; sha256: string }> = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (prefix === '' && ['COMPLETE.json', 'ratings.json', 'scores'].includes(entry.name)) continue;
    relativePath.parse(path);
    if (entry.isDirectory()) result.push(...await inventory(root, path));
    else if (entry.isFile()) result.push({ path, sha256: sha256(await regularFile(root, path)) });
    else throw new Error(`Run contains a non-regular path: ${path}`);
  }
  return result.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

export function summarize(attempts: readonly Attempt[], ratings?: Ratings) {
  const ids = new Set(attempts.map(attempt => attempt.attempt_id));
  if (attempts.length !== DENOMINATOR || ids.size !== DENOMINATOR) {
    throw new Error('A measured report requires all 90 unique first attempts');
  }
  for (const op of OPERATIONS) {
    for (let scenario = 1; scenario <= 10; scenario++) {
      for (let trial = 1; trial <= TRIALS; trial++) {
        if (!ids.has(`${op}-${String(scenario).padStart(2, '0')}-trial-${trial}`)) {
          throw new Error('A measured report cannot omit or replace a fixed trial');
        }
      }
    }
  }
  const ratingMap = new Map(ratings?.ratings.map(rating => [rating.attempt_id, rating]) ?? []);
  if (ratings !== undefined && (ratingMap.size !== DENOMINATOR || [...ratingMap.keys()].some(id => !ids.has(id)))) {
    throw new Error('Ratings must identify each fixed attempt exactly once');
  }
  for (const attempt of attempts) {
    const rating = ratingMap.get(attempt.attempt_id);
    if (rating?.human_usable === true && (!attempt.staged || !attempt.review_rendered
      || attempt.actual_operation !== attempt.operation)) {
      throw new Error(`Cannot mark an unstaged, unreviewable, or wrong-operation attempt usable: ${attempt.attempt_id}`);
    }
  }
  const metrics = (subset: readonly Attempt[]) => {
    const staged = subset.filter(attempt => attempt.staged).length;
    const usable = subset.filter(attempt => ratingMap.get(attempt.attempt_id)?.human_usable === true).length;
    const missing = subset.filter(attempt => ratingMap.get(attempt.attempt_id)?.human_usable == null).length;
    const example = subset.some(attempt => attempt.staged && attempt.review_rendered
      && attempt.actual_operation === attempt.operation && ratingMap.get(attempt.attempt_id)?.human_usable === true);
    return { denominator: subset.length, staged, staging_rate: staged / subset.length,
      human_usable: usable, human_usable_rate: usable / subset.length, missing_human_scores: missing,
      human_usable_ingest_to_review_example: example };
  };
  const totals = metrics(attempts);
  const byOperation = Object.fromEntries(OPERATIONS.map(op => [op, metrics(attempts.filter(a => a.operation === op))]));
  const latency = attempts.map(attempt => attempt.latency_ms).sort((a, b) => a - b);
  const examples = Object.values(byOperation).every(value => value.human_usable_ingest_to_review_example);
  const observedTokens = (key: keyof TokenUsage) => {
    const values = attempts.map(attempt => attempt.token_usage?.[key]).filter(value => value != null);
    return { attempts_observed: values.length, total: values.length === 0 ? null : values.reduce((a, b) => a + b, 0) };
  };
  return {
    ...totals,
    thresholds: { staging: 81, human_usable: 72 },
    staging_pass: totals.staged >= 81,
    human_usability_pass: totals.missing_human_scores > 0 ? null : totals.human_usable >= 72,
    human_rating_provenance: 'Scores are operator-supplied local inputs. The machine verifies identities and digests, not human authorship, attention, or truth of the judgments.',
    model_gate: totals.missing_human_scores > 0 ? 'pending'
      : totals.staged >= 81 && totals.human_usable >= 72 && examples ? 'pass' : 'fail',
    by_operation: byOperation,
    latency_ms: { p50: latency[44], p95: latency[85], maximum: latency[89] },
    errors: attempts.filter(attempt => attempt.error !== null).map(attempt => ({
      attempt_id: attempt.attempt_id, ...attempt.error,
    })),
    reviewer_rejections: ratings?.ratings.filter(rating => rating.human_usable === false)
      .map(rating => ({ attempt_id: rating.attempt_id, reason: rating.reason })) ?? [],
    omissions: attempts.flatMap(attempt => attempt.omissions.map(omission => ({ attempt_id: attempt.attempt_id, omission }))),
    structural_integrity_negatives: 'not measured here; Gate 1 additionally requires zero invalid artifacts in deterministic negative tests',
    semantic_support: 'not automatically verified; byte-valid unsupported claims must be rejected by the human reviewer',
    resource_observations: {
      peak_process_rss_bytes: Math.max(...attempts.map(attempt => attempt.peak_rss_bytes)),
      model_tokens: {
        prompt_tokens: observedTokens('prompt_tokens'),
        completion_tokens: observedTokens('completion_tokens'),
        total_tokens: observedTokens('total_tokens'),
      },
      model_tokens_reason: 'Only observed server usage is totaled; missing counts are not estimated. These are server claims, not an independent token meter.',
      responses_captured: attempts.filter(attempt => attempt.response_received).length,
      responses_unavailable: attempts.filter(attempt => !attempt.response_received).map(attempt => ({
        attempt_id: attempt.attempt_id, reason: attempt.response_unavailable_reason,
      })),
      server_memory_bytes: null,
      server_memory_reason: 'No server process inspection is performed.',
    },
  };
}

export async function sealRun(root: string, runId: string, attempts: Attempt[]): Promise<Ratings> {
  summarize(attempts);
  const files = await inventory(root);
  const attemptsIndex = attempts.map(attempt => {
    const path = `attempts/${attempt.attempt_id}/attempt.json`;
    const file = files.find(entry => entry.path === path);
    if (file === undefined) throw new Error(`Missing attempt record: ${path}`);
    return { attempt_id: attempt.attempt_id, ...file };
  });
  const fixtureFile = files.find(file => file.path === 'fixtures.json');
  if (fixtureFile === undefined) throw new Error('Missing frozen fixtures');
  const completed = CompletedSchema.parse({
    schema_version: 1, run_id: runId, completed_at: new Date().toISOString(), denominator: DENOMINATOR,
    fixture_sha256: fixtureFile.sha256, attempts: attemptsIndex, files,
  });
  await writeJson(join(root, 'COMPLETE.json'), completed);
  const ratings = RatingsSchema.parse({
    schema_version: 1, run_id: runId,
    completed_sha256: sha256(await readFile(join(root, 'COMPLETE.json'))),
    ratings: attempts.map(attempt => ({
      attempt_id: attempt.attempt_id,
      attempt_sha256: attemptsIndex.find(entry => entry.attempt_id === attempt.attempt_id)!.sha256,
      artifact_sha256: attempt.artifact_sha256,
      human_usable: null,
      reason: 'Pending actual human review; no AI rating has been supplied.',
    })),
  });
  await writeJson(join(root, 'ratings.json'), ratings);
  return ratings;
}

export async function readCompletedRun(directory: string): Promise<{
  attempts: Attempt[];
  ratings: Ratings;
  ratings_sha256: string;
}> {
  const root = resolve(directory);
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Run root must be a real directory');
  const completedBytes = await regularFile(root, 'COMPLETE.json');
  const completed = CompletedSchema.parse(JSON.parse(completedBytes.toString('utf8')));
  const ratingsBytes = await regularFile(root, 'ratings.json');
  const ratings = RatingsSchema.parse(JSON.parse(ratingsBytes.toString('utf8')));
  if (ratings.run_id !== completed.run_id || ratings.completed_sha256 !== sha256(completedBytes)) {
    throw new Error('Ratings identify a different completed run');
  }
  const actualFiles = await inventory(root);
  if (JSON.stringify(actualFiles) !== JSON.stringify(completed.files)) {
    throw new Error('Completed run changed: immutable file inventory or digest mismatch');
  }
  const fixtureBytes = await regularFile(root, 'fixtures.json');
  FixtureSchema.parse(JSON.parse(fixtureBytes.toString('utf8')));
  if (sha256(fixtureBytes) !== completed.fixture_sha256) throw new Error('Frozen fixtures changed');
  const attempts: Attempt[] = [];
  for (const entry of completed.attempts) {
    const bytes = await regularFile(root, entry.path);
    if (sha256(bytes) !== entry.sha256) throw new Error(`Attempt changed: ${entry.attempt_id}`);
    const attempt = AttemptSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (attempt.run_id !== completed.run_id || attempt.attempt_id !== entry.attempt_id
      || entry.path !== `attempts/${attempt.attempt_id}/attempt.json`) {
      throw new Error(`Attempt identity mismatch: ${entry.attempt_id}`);
    }
    const rating = ratings.ratings.find(item => item.attempt_id === attempt.attempt_id);
    if (rating === undefined || rating.attempt_sha256 !== entry.sha256
      || rating.artifact_sha256 !== attempt.artifact_sha256) {
      throw new Error(`Rating identity or artifact digest mismatch: ${attempt.attempt_id}`);
    }
    if (attempt.artifact_path !== null
      && sha256(await regularFile(root, attempt.artifact_path)) !== attempt.artifact_sha256) {
      throw new Error(`Staged artifact changed: ${attempt.attempt_id}`);
    }
    await regularFile(root, attempt.review_packet_path);
    await regularFile(root, attempt.response_path);
    attempts.push(attempt);
  }
  summarize(attempts, ratings);
  return { attempts, ratings, ratings_sha256: sha256(ratingsBytes) };
}

export function isWithinWorkingDirectory(path: string): boolean {
  const cwd = resolve('.');
  const absolute = resolve(path);
  return absolute.startsWith(`${cwd}${sep}`);
}
