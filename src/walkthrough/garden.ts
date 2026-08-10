import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../cli/main.js';
import type { CliIO } from '../cli/main.js';

/**
 * The garden walkthrough is split in two because Gold promotion is human-only.
 *
 * `prepareGardenVault` runs everything automation is permitted to do and then stops at
 * the promotion boundary. Nothing in this module writes reviewed metadata: the only
 * function that does is `promoteGardenFixtureAsHuman`, which exists so tests can stand
 * in for a person, is named to say so, and is never called by the shipped runner.
 *
 * `completeGardenWalkthrough` picks up after a human has promoted a page.
 */

export interface PreparedVault {
  root: string;
  ingest_results: Array<{ status: string; source_path: string }>;
  /** Bronze paths keyed by original inbox filename, for the manual promotion step. */
  bronze_by_name: Record<string, string>;
  next_step: string;
}

export interface WalkthroughResult {
  root: string;
  ingest_results: Array<{ status: string; source_path: string }>;
  /** Gold chunk count while the contradiction was still unresolved. Must be 0. */
  gold_chunks_while_contested: number;
  build_stats: { gold_chunks: number; review_chunks: number; evidence_chunks: number; corpus_fingerprint: string };
  query_hits: Array<{ citation_id: string; path: string; tier: string; score: number }>;
}

function captureIO(): { captured: { out: string; err: string }; io: CliIO } {
  const captured = { out: '', err: '' };
  const io: CliIO = {
    stdout: (t) => { captured.out += t; },
    stderr: (t) => { captured.err += t; },
  };
  return { captured, io };
}

async function build(root: string): Promise<WalkthroughResult['build_stats']> {
  const { io, captured } = captureIO();
  const code = await runCli(['build', '--root', root, '--json'], io);
  if (code !== 0) throw new Error(`build failed: ${captured.err}`);
  return JSON.parse(captured.out) as WalkthroughResult['build_stats'];
}

/**
 * Phase 1: init and ingest. Stops at the promotion boundary and returns instructions.
 * This is the entire automated surface of the walkthrough.
 */
export async function prepareGardenVault(
  fixturesDir: string,
  outputDir?: string,
): Promise<PreparedVault> {
  const root = outputDir ?? await mkdtemp(join(tmpdir(), 'ziggurat-garden-'));

  const { io: initIo, captured: initCap } = captureIO();
  const initCode = await runCli(['init', '--root', root], initIo);
  if (initCode !== 0) throw new Error(`init failed: ${initCap.err}`);

  const inboxDir = join(fixturesDir, 'inbox');
  const inboxFiles = (await readdir(inboxDir)).sort();
  const ingest_results: PreparedVault['ingest_results'] = [];

  for (const file of inboxFiles) {
    await cp(join(inboxDir, file), join(root, 'inbox', file));
    const { io, captured } = captureIO();
    const code = await runCli(['ingest', '--root', root, '--file', `inbox/${file}`, '--json'], io);
    if (code !== 0) throw new Error(`ingest failed for ${file}: ${captured.err}`);
    ingest_results.push(JSON.parse(captured.out) as { status: string; source_path: string });
  }

  const bronze_by_name: Record<string, string> = {};
  for (let i = 0; i < inboxFiles.length; i++) {
    const file = inboxFiles[i] ?? '';
    const r = ingest_results[i];
    if (r !== undefined) bronze_by_name[file.replace('.md', '')] = r.source_path;
  }

  return {
    root,
    ingest_results,
    bronze_by_name,
    next_step: [
      'Bronze capture is complete. Gold promotion is human-only and no command performs it.',
      '',
      `  1. Review the staged evidence:  ziggurat review --root ${root}`,
      `  2. Author a curated page under ${join(root, 'knowledge')}, citing the Bronze paths above.`,
      '  3. Set status: reviewed together with reviewed_by, reviewed_at, and last_verified.',
      '  4. Commit the page. That commit is the promotion record.',
      `  5. Then build and query:  ziggurat build --root ${root}`,
      '',
      'The walkthrough stops here by design. See ARCHITECTURE.md, "Human-only promotion".',
    ].join('\n'),
  };
}

/**
 * Stands in for the human promotion step in automated tests ONLY.
 *
 * This is the one function in the codebase that writes reviewed metadata, and it is
 * deliberately not reachable from the CLI or from `scripts/run-garden-walkthrough.mjs`.
 * A test needs a reviewed page to exist in order to assert anything about Gold, and a
 * test cannot pause for a person; this function makes that substitution explicit rather
 * than disguising it as part of the pipeline.
 */
export async function promoteGardenFixtureAsHuman(
  root: string,
  fixturesDir: string,
  bronzeByName: Record<string, string>,
): Promise<void> {
  const reviewedSrc = join(fixturesDir, 'expected', 'irrigation-decision.md');
  await mkdir(join(root, 'knowledge'), { recursive: true });
  let reviewedContent = await readFile(reviewedSrc, 'utf8');

  const sourceMap: Record<string, string> = {
    'bronze/municipal-report.md': bronzeByName['municipal-report'] ?? 'bronze/municipal-report.md',
    'bronze/vendor-study.md': bronzeByName['vendor-study'] ?? 'bronze/vendor-study.md',
    'bronze/maintenance-log.md': bronzeByName['maintenance-log'] ?? 'bronze/maintenance-log.md',
    'bronze/revised-water-rates.md': bronzeByName['revised-water-rates'] ?? 'bronze/revised-water-rates.md',
  };
  for (const [from, to] of Object.entries(sourceMap)) {
    reviewedContent = reviewedContent.replace(from, to);
  }
  await writeFile(join(root, 'knowledge', 'irrigation-decision.md'), reviewedContent, 'utf8');
}

/**
 * Phase 2: runs after a human has promoted a page.
 *
 * Order matters. The contradiction is staged BEFORE the first build so the walkthrough
 * demonstrates the promised behaviour — an unresolved contradiction revokes communion
 * eligibility — rather than demonstrating continued service against an index built
 * before the conflict was known.
 */
export async function completeGardenWalkthrough(
  root: string,
  fixturesDir: string,
  ingest_results: WalkthroughResult['ingest_results'],
): Promise<WalkthroughResult> {
  // Step 1: stage the unresolved contradiction first.
  const contradictionSrc = join(fixturesDir, 'expected', 'contradiction.json');
  const artifactPath = join(root, '.ziggurat', 'proposals', 'water-rate-contradiction.json');
  await mkdir(join(root, '.ziggurat', 'proposals'), { recursive: true });
  await cp(contradictionSrc, artifactPath);

  // Step 2: build while contested. The target page must be absent from communion.
  const contested = await build(root);
  if (contested.gold_chunks !== 0) {
    throw new Error(
      `expected an unresolved contradiction to revoke Gold eligibility, got ${contested.gold_chunks} chunks`,
    );
  }

  // Step 3: a human resolves the contradiction, then the page returns to communion.
  const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as Record<string, unknown>;
  artifact['resolved_at'] = '2026-07-30T00:00:00Z';
  artifact['resolution'] = 'Reviewed page states both water rates with dates; newer rate supersedes.';
  await writeFile(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');

  const build_stats = await build(root);

  const { io: queryIo, captured: queryCap } = captureIO();
  const queryCode = await runCli(['query', '--root', root, '--query', 'irrigation water rate', '--json'], queryIo);
  if (queryCode !== 0) throw new Error(`query failed: ${queryCap.err}`);
  const query_hits = JSON.parse(queryCap.out) as WalkthroughResult['query_hits'];

  return {
    root,
    ingest_results,
    gold_chunks_while_contested: contested.gold_chunks,
    build_stats,
    query_hits,
  };
}
