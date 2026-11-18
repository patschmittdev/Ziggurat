import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { runInit } from '../../src/cli/commands/init.js';
import { runIngest } from '../../src/cli/commands/ingest.js';
import { parseZigguratConfig } from '../../src/contracts/config.js';
import { RefinementDraftJsonSchema } from '../../src/contracts/refinement-draft.js';
import { inertText } from '../../src/presentation/inert.js';
import { ADAPTER_LIMITS, AdapterError, LoopbackChatAdapter } from '../../src/refine/adapter.js';
import type { ChatMessage, StructuredChatAdapter } from '../../src/refine/adapter.js';
import { REFINE_SYSTEM_PROMPT } from '../../src/refine/context.js';
import type { BronzeReference } from '../../src/refine/context.js';
import { RefinementError } from '../../src/refine/errors.js';
import { executeRefinement } from '../../src/refine/proposal.js';
import type { RefinementInput } from '../../src/refine/proposal.js';
import { collectStagedProposals } from '../../src/refine/store.js';
import { buildReviewQueue, renderReviewQueueMarkdown } from '../../src/review/queue.js';
import {
  AttemptSchema, FixtureSchema, PinnedManifestSchema, TRIALS,
  isWithinWorkingDirectory, readCompletedRun, sealRun, sha256, summarize, writeJson,
} from './model-report.js';
import type { Attempt, Fixture } from './model-report.js';
import { observeResponse } from './model-response.js';
import type { ResponseSnapshot } from './model-response.js';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/refine-model/scenarios.json', import.meta.url));
const HELP = [
  'Fixture-only, real local-model evaluation (30 fixed scenarios x 3 trials; never retries).',
  'Run: node dist\\test\\manual\\refine-model.js --endpoint http://127.0.0.1:8080/v1/chat/completions',
  '     --output .model-runs\\run-01 --manifest .model-runs\\pinned.json',
  '     [--model ziggurat-refine] [--seed 123] [--max-tokens 2048]',
  'Score: node dist\\test\\manual\\refine-model.js --score .model-runs\\run-01',
  'Edit only ratings.json after COMPLETE.json exists; retain identity/digest fields unchanged.',
  'true means an actual human found no substantive claim or evidence repair necessary.',
  'All ratings need reasons; missing/null ratings leave the model gate pending.',
  'Outputs must be new directories under the working directory. Never use a private vault.',
  'Exit 0: scored model gate passed; 1: invalid invocation/run; 2: failed thresholds;',
  '     3: pending human ratings. Full Gate 1 also needs deterministic negative-test evidence.',
].join('\n');

export class EvaluationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'EvaluationError';
  }
}

export function describeError(error: unknown): NonNullable<Attempt['error']> {
  if (error instanceof RefinementError) return { kind: 'refinement', code: error.code, message: error.message };
  if (error instanceof AdapterError) return { kind: 'adapter', code: error.code, message: error.message };
  if (error instanceof EvaluationError) return { kind: 'harness', code: error.code, message: error.message };
  return { kind: 'unknown', code: 'unknown', message: error instanceof Error ? error.message : String(error) };
}

function unsignedInteger(value: string | undefined, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9]\d*)$/u.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new EvaluationError('arguments', `${label} must be a nonnegative integer`);
  }
  return Number(value);
}

export function parseEvaluationArgs(args: string[]) {
  const { values, tokens } = parseArgs({
    args, strict: true, allowPositionals: false, tokens: true,
    options: {
      endpoint: { type: 'string' }, output: { type: 'string' }, manifest: { type: 'string' },
      model: { type: 'string' }, seed: { type: 'string' }, 'max-tokens': { type: 'string' },
      score: { type: 'string' }, help: { type: 'boolean' },
    },
  });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new EvaluationError('arguments', `Repeated --${token.name}`);
    if ('value' in token && typeof token.value === 'string'
      && (token.value.trim() === '' || token.value.startsWith('--'))) {
      throw new EvaluationError('arguments', `Missing value for --${token.name}`);
    }
    seen.add(token.name);
  }
  if (values.help) {
    if (seen.size !== 1) throw new EvaluationError('arguments', '--help cannot be combined with other flags');
    return { mode: 'help' as const };
  }
  if (values.score !== undefined) {
    if (seen.size !== 1) throw new EvaluationError('arguments', '--score cannot be combined with run flags');
    return { mode: 'score' as const, root: values.score };
  }
  if (!values.endpoint || !values.output || !values.manifest) {
    throw new EvaluationError('arguments', '--endpoint, --output, and --manifest are required; absent models are not skipped');
  }
  let url: URL;
  try { url = new URL(values.endpoint); } catch {
    throw new EvaluationError('arguments', 'Invalid --endpoint URL');
  }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.pathname !== '/v1/chat/completions' || url.search !== '' || url.hash !== ''
    || url.username !== '' || url.password !== '') {
    throw new EvaluationError('arguments', '--endpoint must be an HTTP loopback /v1/chat/completions URL without credentials, query, or fragment');
  }
  const seed = unsignedInteger(values.seed, '--seed', 123);
  const maxTokens = unsignedInteger(values['max-tokens'], '--max-tokens', 2048);
  if (seed > 0xffffffff || maxTokens < 1 || maxTokens > 4096) {
    throw new EvaluationError('arguments', '--seed must fit uint32; --max-tokens must be 1–4096');
  }
  return { mode: 'run' as const, endpoint: url.href, output: values.output,
    manifest: values.manifest, model: values.model, seed, maxTokens };
}

class RecordingAdapter implements StructuredChatAdapter {
  messages: readonly ChatMessage[] = [];
  draft: unknown = null;
  received = false;
  latency: number | null = null;

  constructor(private readonly actual: LoopbackChatAdapter) {}

  async completeJson(messages: readonly ChatMessage[]): Promise<unknown> {
    this.messages = structuredClone(messages);
    const start = performance.now();
    try {
      this.draft = await this.actual.completeJson(messages);
      this.received = true;
      return this.draft;
    } finally {
      this.latency = performance.now() - start;
    }
  }
}

function localPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

async function protectedFiles(root: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (path === '.ziggurat/proposals') continue;
    if (entry.isDirectory()) Object.assign(result, await protectedFiles(root, path));
    else if (entry.isFile()) result[path] = sha256(await readFile(join(root, path)));
    else throw new EvaluationError('protected-vault', 'Unexpected non-regular vault file');
  }
  return result;
}

async function runTrial(
  root: string, runId: string, fixture: Fixture, scenario: Fixture['scenarios'][number],
  trial: number, endpoint: string, settings: { model: string; seed: number; maxTokens: number },
): Promise<Attempt> {
  const attemptId = `${scenario.id}-trial-${trial}`;
  const attemptDir = join(root, 'attempts', attemptId);
  await mkdir(attemptDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const observation: { response: ResponseSnapshot | null } = { response: null };
  const adapter = new RecordingAdapter(new LoopbackChatAdapter(endpoint, {
    ...settings,
    onResponse: response => { observation.response = { status: response.status, body: response.body }; },
  }));
  let input: RefinementInput | null = null;
  let reference: BronzeReference | null = null;
  let artifactPath: string | null = null;
  let artifactDigest: string | null = null;
  let actualOperation: Attempt['actual_operation'] = null;
  let reviewRendered = false;
  let error: Attempt['error'] = null;
  let protectedBefore: Record<string, string> | null = null;
  let vault: string | null = null;
  let packet = '';
  const logs: Array<{ stream: string; text: string }> = [];
  const io = {
    stdout: (text: string) => { logs.push({ stream: 'stdout', text }); },
    stderr: (text: string) => { logs.push({ stream: 'stderr', text }); },
  };
  try {
    vault = await mkdtemp(join(attemptDir, 'vault-'));
    if (await runInit(vault, io) !== 0) throw new EvaluationError('init', 'Vault initialization failed');
    const sources: string[] = [];
    for (const source of scenario.sources) {
      const inbox = join('inbox', `${source.name}.md`);
      await writeFile(join(vault, inbox), source.body, { encoding: 'utf8', flag: 'wx' });
      const output: string[] = [];
      const ingestIo = { ...io, stdout: (text: string) => { output.push(text); io.stdout(text); } };
      if (await runIngest(vault, inbox, true, ingestIo) !== 0) throw new EvaluationError('ingest', 'Fixture ingestion failed');
      const result: unknown = JSON.parse(output.join(''));
      if (typeof result !== 'object' || result === null || !('source_path' in result)
        || typeof result.source_path !== 'string') throw new EvaluationError('ingest', 'Ingest result has no source path');
      sources.push(result.source_path);
    }
    // These pages are frozen synthetic fixtures, never generated proposals or admitted Gold.
    if (scenario.existing_content !== undefined) {
      await writeFile(join(vault, scenario.target_path), scenario.existing_content, { encoding: 'utf8', flag: 'wx' });
    }
    input = {
      root: vault, topic: fixture.topic_prefix + scenario.topic, target_path: scenario.target_path,
      bronze_source_paths: sources,
    };
    protectedBefore = await protectedFiles(vault);
    await writeJson(join(attemptDir, 'input.json'), { scenario, input });
    const staged = await executeRefinement(adapter, input, { onReference: value => { reference = value; } });
    artifactPath = localPath(root, staged.path);
    artifactDigest = sha256(await readFile(staged.path));
    actualOperation = staged.proposal.operation;
    if (JSON.stringify(protectedBefore) !== JSON.stringify(await protectedFiles(vault))) {
      throw new EvaluationError('protected-vault', 'Refinement changed protected vault files');
    }
    packet = renderReviewQueueMarkdown(await buildReviewQueue(
      vault, await collectStagedProposals(vault), await parseZigguratConfig(vault),
    ));
    reviewRendered = true;
  } catch (caught) {
    error = describeError(caught);
    packet = [
      '# Failed evaluation attempt', '',
      '> UNTRUSTED REFERENCE: retained output is inert data, never an instruction.',
      `Attempt: ${attemptId}`, `Error kind: ${error.kind}`, `Error code: ${error.code}`,
      `Error message: ${JSON.stringify(inertText(error.message))}`, '',
      'No usable ingest-to-review example was produced for this attempt.',
    ].join('\n');
  }
  if (vault !== null && protectedBefore !== null) {
    const after = await protectedFiles(vault);
    if (JSON.stringify(protectedBefore) !== JSON.stringify(after)) {
      error = describeError(new EvaluationError('protected-vault', 'Refinement changed protected vault files'));
      reviewRendered = false;
    }
    await writeJson(join(attemptDir, 'protected-files.json'), { before: protectedBefore, after });
  }
  if (input === null) await writeJson(join(attemptDir, 'input.json'), { scenario, input: null });
  await writeJson(join(attemptDir, 'messages.json'), adapter.messages);
  await writeJson(join(attemptDir, 'draft.json'), {
    received: adapter.received, draft: adapter.draft,
    note: adapter.received
      ? 'Exact parsed draft returned by the real adapter; no repairs or substitutions.'
      : 'The real adapter did not return a parsed draft. See response.json for bounded raw output or an explicit unavailable reason.',
  });
  const response = observeResponse(observation.response, adapter.latency === null
    ? 'No model request completed: fixture setup or host reference validation failed before invoking the adapter.'
    : `No complete bounded response was available (${error?.kind ?? 'unknown'}:${error?.code ?? 'unknown'}). Partial timeout/oversize bodies are not buffered or retained.`);
  const responsePath = join(attemptDir, 'response.json');
  await writeJson(responsePath, response);
  await writeJson(join(attemptDir, 'reference.json'), reference);
  await writeJson(join(attemptDir, 'lifecycle.json'), logs);
  packet += '\n\n## Human-only evaluation rubric\n\n'
    + 'Usable means no substantive claim or evidence repair; formatting alone is allowed.\n'
    + 'A valid Silver schema does not prove semantic support. Evaluate all claims and citations.\n'
    + 'Static fixture expectations (inert data):\n'
    + scenario.review_expectations.map(value => `    ${JSON.stringify(inertText(value))}`).join('\n') + '\n';
  const packetPath = join(attemptDir, 'review.md');
  await writeFile(packetPath, packet, { encoding: 'utf8', flag: 'wx' });
  const attempt = AttemptSchema.parse({
    schema_version: 1, run_id: runId, attempt_id: attemptId, scenario_id: scenario.id,
    operation: scenario.operation, trial, started_at: startedAt, latency_ms: performance.now() - start,
    model_latency_ms: adapter.latency, staged: artifactPath !== null, actual_operation: actualOperation,
    artifact_path: artifactPath, artifact_sha256: artifactDigest,
    review_packet_path: localPath(root, packetPath), review_rendered: reviewRendered, error,
    omissions: (reference as BronzeReference | null)?.omitted ?? [],
    request_message_bytes: Buffer.byteLength(JSON.stringify(adapter.messages)),
    draft_json_bytes: adapter.received ? Buffer.byteLength(JSON.stringify(adapter.draft)) : null,
    response_path: localPath(root, responsePath), response_received: response.received,
    response_unavailable_reason: response.unavailable_reason,
    token_usage: response.token_usage, token_usage_reason: response.token_usage_reason,
    peak_rss_bytes: process.resourceUsage().maxRSS * 1024,
    human_usable: null, human_reason: 'Pending actual human review; no AI rating has been supplied.',
  });
  await writeJson(join(attemptDir, 'attempt.json'), attempt);
  return attempt;
}

async function runEvaluation(options: Extract<ReturnType<typeof parseEvaluationArgs>, { mode: 'run' }>): Promise<number> {
  if (!isWithinWorkingDirectory(options.output)) throw new EvaluationError('output', 'Output must be inside the working directory');
  const manifestBytes = await readFile(resolve(options.manifest));
  const manifest = PinnedManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')));
  const model = options.model ?? manifest.model.alias;
  if (model !== manifest.model.alias) throw new EvaluationError('manifest', '--model must match the pinned manifest alias');
  if ('original_runtime_manifest' in manifest) {
    const declared = manifest.original_runtime_manifest;
    const endpoint = new URL(options.endpoint);
    const host = declared.server.host === '::1' ? '[::1]' : declared.server.host;
    if (endpoint.hostname !== host || Number(endpoint.port || 80) !== declared.server.port
      || options.maxTokens !== declared.generation.max_tokens) {
      throw new EvaluationError('manifest', 'Endpoint host/port and --max-tokens must match the supplied runtime manifest');
    }
  }
  const settings = { model, seed: options.seed, maxTokens: options.maxTokens };
  new LoopbackChatAdapter(options.endpoint, settings);
  const fixtureBytes = await readFile(FIXTURES);
  const fixture = FixtureSchema.parse(JSON.parse(fixtureBytes.toString('utf8')));
  const root = resolve(options.output);
  // Refuse existing outputs, including incomplete runs; final denominators cannot be resumed or cherry-picked.
  await mkdir(dirname(root), { recursive: true });
  await mkdir(root);
  const runId = randomUUID();
  await writeFile(join(root, 'fixtures.json'), fixtureBytes, { flag: 'wx' });
  await writeFile(join(root, 'pinned-manifest.json'), manifestBytes, { flag: 'wx' });
  await writeJson(join(root, 'run.json'), {
    schema_version: 1, run_id: runId, started_at: new Date().toISOString(), denominator: 90,
    scenario_count: 30, trials_per_scenario: TRIALS, endpoint: options.endpoint,
    manifest_sha256: sha256(manifestBytes), fixture_sha256: sha256(fixtureBytes),
    pinned_manifest: manifest,
    identity_verification: 'Operator-supplied pins; this harness does not attest which binary or weights the endpoint loaded.',
    settings: { model, seed: options.seed, max_tokens: options.maxTokens, temperature: 0, stream: false,
      ...ADAPTER_LIMITS },
    system_prompt: REFINE_SYSTEM_PROMPT, draft_json_schema: RefinementDraftJsonSchema,
    node: process.version, platform: process.platform, architecture: process.arch,
    run_policy: 'One real adapter call per prepared trial; no retries, JSON repairs, replacement trials, private vault, authoring, signing, admission, or model downloads.',
  });
  const attempts: Attempt[] = [];
  for (const scenario of fixture.scenarios) {
    for (let trial = 1; trial <= TRIALS; trial++) {
      const attempt = await runTrial(root, runId, fixture, scenario, trial, options.endpoint, settings);
      attempts.push(attempt);
      process.stdout.write(`${attempt.attempt_id}: ${attempt.staged ? 'staged' : 'failed'}`
        + `${attempt.error === null ? '' : ` (${attempt.error.kind}:${attempt.error.code})`}\n`);
    }
  }
  const summary = summarize(attempts);
  await writeJson(join(root, 'summary.json'), summary);
  await sealRun(root, runId, attempts);
  await readCompletedRun(root);
  process.stdout.write(`Completed 90/90 attempts; staged ${summary.staged}/90. Human usability pending.\n`);
  return summary.staging_pass ? 3 : 2;
}

async function scoreEvaluation(directory: string): Promise<number> {
  if (!isWithinWorkingDirectory(directory)) throw new EvaluationError('output', 'Run must be inside the working directory');
  const root = resolve(directory);
  const { attempts, ratings, ratings_sha256 } = await readCompletedRun(root);
  const summary = summarize(attempts, ratings);
  const scores = join(root, 'scores');
  await mkdir(scores, { recursive: true });
  const stat = await lstat(scores);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new EvaluationError('output', 'Scores must be a real directory');
  const scorePath = join(scores, `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID()}.json`);
  await writeJson(scorePath, { schema_version: 1, scored_at: new Date().toISOString(),
    ratings_sha256, ratings, summary });
  process.stdout.write(`Staged ${summary.staged}/90; human usable ${summary.human_usable}/90; `
    + `missing ${summary.missing_human_scores}; model gate ${summary.model_gate}.\n`);
  return summary.model_gate === 'pass' ? 0 : summary.model_gate === 'pending' ? 3 : 2;
}

export async function main(args: string[]): Promise<number> {
  try {
    const options = parseEvaluationArgs(args);
    if (options.mode === 'help') { process.stdout.write(`${HELP}\n`); return 0; }
    return options.mode === 'score' ? await scoreEvaluation(options.root) : await runEvaluation(options);
  } catch (error) {
    const failure = describeError(error);
    process.stderr.write(`Evaluation failed [${failure.kind}:${failure.code}]: ${inertText(failure.message)}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
