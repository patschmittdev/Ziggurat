import { cp, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../cli/main.js';
import type { CliIO } from '../cli/main.js';

export interface WalkthroughResult {
  root: string;
  ingest_results: Array<{ status: string; source_path: string }>;
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

/**
 * Runs the full garden walkthrough lifecycle in a temporary vault.
 * Order: init -> ingest -> write reviewed page -> build Gold -> stage contradiction -> query.
 * The contradiction is staged after the Gold build to demonstrate the detection mechanism
 * without blocking the build (the reviewed page has already resolved the discrepancy).
 */
export async function runGardenWalkthrough(
  fixturesDir: string,
  outputDir?: string,
): Promise<WalkthroughResult> {
  const root = outputDir ?? await mkdtemp(join(tmpdir(), 'ziggurat-garden-'));

  // Step 1: Init
  const { io: initIo, captured: initCap } = captureIO();
  const initCode = await runCli(['init', '--root', root], initIo);
  if (initCode !== 0) throw new Error(`init failed: ${initCap.err}`);

  // Step 2: Copy and ingest Inbox fixtures
  const inboxDir = join(fixturesDir, 'inbox');
  const inboxFiles = await readdir(inboxDir);
  const ingestResults: WalkthroughResult['ingest_results'] = [];

  for (const file of inboxFiles) {
    await cp(join(inboxDir, file), join(root, 'inbox', file));
    const { io, captured } = captureIO();
    const code = await runCli(['ingest', '--root', root, '--file', `inbox/${file}`, '--json'], io);
    if (code !== 0) throw new Error(`ingest failed for ${file}: ${captured.err}`);
    const parsed = JSON.parse(captured.out) as { status: string; source_path: string };
    ingestResults.push(parsed);
  }

  // Step 3: Copy reviewed page (simulates human Gold promotion)
  // Map original inbox filename -> actual Bronze path from ingest
  const bronzeByFilename: Record<string, string> = {};
  for (let i = 0; i < inboxFiles.length; i++) {
    const file = inboxFiles[i] ?? '';
    const r = ingestResults[i];
    if (r !== undefined) bronzeByFilename[file.replace('.md', '')] = r.source_path;
  }

  const reviewedSrc = join(fixturesDir, 'expected', 'irrigation-decision.md');
  await mkdir(join(root, 'knowledge'), { recursive: true });
  let reviewedContent = await readFile(reviewedSrc, 'utf8');
  const sourceMap: Record<string, string> = {
    'bronze/municipal-report.md': bronzeByFilename['municipal-report'] ?? 'bronze/municipal-report.md',
    'bronze/vendor-study.md': bronzeByFilename['vendor-study'] ?? 'bronze/vendor-study.md',
    'bronze/maintenance-log.md': bronzeByFilename['maintenance-log'] ?? 'bronze/maintenance-log.md',
    'bronze/revised-water-rates.md': bronzeByFilename['revised-water-rates'] ?? 'bronze/revised-water-rates.md',
  };
  for (const [from, to] of Object.entries(sourceMap)) {
    reviewedContent = reviewedContent.replace(from, to);
  }
  await writeFile(join(root, 'knowledge', 'irrigation-decision.md'), reviewedContent, 'utf8');

  // Step 4: Build Gold index (no contradictions staged yet, so page is eligible)
  const { io: buildIo, captured: buildCap } = captureIO();
  const buildCode = await runCli(['build', '--root', root, '--json'], buildIo);
  if (buildCode !== 0) throw new Error(`build failed: ${buildCap.err}`);
  const build_stats = JSON.parse(buildCap.out) as WalkthroughResult['build_stats'];

  // Step 5: Stage contradiction (after build, demonstrates the detection mechanism)
  const contradictionSrc = join(fixturesDir, 'expected', 'contradiction.json');
  await mkdir(join(root, '.ziggurat', 'proposals'), { recursive: true });
  await cp(contradictionSrc, join(root, '.ziggurat', 'proposals', 'water-rate-contradiction.json'));

  // Step 6: Query the Gold communion index
  const { io: queryIo, captured: queryCap } = captureIO();
  const queryCode = await runCli(['query', '--root', root, '--query', 'irrigation water rate', '--json'], queryIo);
  if (queryCode !== 0) throw new Error(`query failed: ${queryCap.err}`);
  const query_hits = JSON.parse(queryCap.out) as WalkthroughResult['query_hits'];

  return { root, ingest_results: ingestResults, build_stats, query_hits };
}
