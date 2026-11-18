import { cpus, platform, release, totalmem } from 'node:os';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { runBuild } from '../../src/cli/commands/build.js';
import { createContextAccess } from '../../src/mcp/access.js';
import { loadGoldIndex } from '../../src/retrieval/gold-index.js';
import { computeLiveFingerprint } from '../../src/retrieval/verify.js';
import { buildBm25 } from '../../src/retrieval/bm25.js';
import { createOperatingVault } from '../helpers/operating-vault.js';
import { sha256Text } from '../../src/bronze/canonical.js';

const execute = promisify(execFile);

function distribution(values: number[]): { p50: number; p95: number; p99: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  return { p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
}

async function measured<T>(action: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now();
  const value = await action();
  return { ms: performance.now() - started, value };
}

async function diskBytes(root: string): Promise<number> {
  let bytes = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) bytes += await diskBytes(path);
    else if (entry.isFile()) bytes += (await stat(path)).size;
    else throw new Error('Unexpected non-regular benchmark file');
  }
  return bytes;
}

async function implementationFingerprint(): Promise<string> {
  const root = fileURLToPath(new URL('../../src/', import.meta.url));
  async function walk(directory: string): Promise<string[]> {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    const pieces: string[] = [];
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pieces.push(...await walk(path));
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        pieces.push(path.slice(root.length).replace(/\\/gu, '/'), sha256Text(await readFile(path, 'utf8')));
      }
    }
    return pieces;
  }
  return sha256Text(JSON.stringify(await walk(root)));
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      output: { type: 'string' }, sizes: { type: 'string', default: '100,500,1000' },
      samples: { type: 'string', default: '10' }, keep: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log('Synthetic signed-fixture benchmark; not model or human review.\n'
      + '--output NEW_DIRECTORY [--sizes 100,500,1000] [--samples 10] [--keep]\n'
      + 'Measures full verified startup/search/read, not BM25 alone. Outputs exact targets and failures.');
    return;
  }
  if (!values.output) throw new Error('--output NEW_DIRECTORY is required');
  const sizes = values.sizes.split(',').map(Number);
  const samples = Number(values.samples);
  if (sizes.length === 0 || sizes.length > 5 || sizes.some(n => !Number.isInteger(n) || n < 1 || n > 2000)) {
    throw new Error('--sizes must contain 1-5 integers between 1 and 2000');
  }
  if (!Number.isInteger(samples) || samples < 3 || samples > 100) throw new Error('--samples must be 3-100');
  const output = isAbsolute(values.output) ? resolve(values.output) : resolve(process.cwd(), values.output);
  const implementation = await implementationFingerprint();
  await mkdir(output, { recursive: false });
  const points: unknown[] = [];
  let allPass = true;
  for (const pages of sizes) {
    const root = await mkdtemp(join(output, `vault-${pages}-`));
    let peakRss = process.memoryUsage().rss;
    let peakHeap = process.memoryUsage().heapUsed;
    const sampler = setInterval(() => {
      const memory = process.memoryUsage();
      peakRss = Math.max(peakRss, memory.rss);
      peakHeap = Math.max(peakHeap, memory.heapUsed);
    }, 10);
    try {
      const setup = await measured(() => createOperatingVault(root, pages));
      const build = await measured(() => runBuild(root, true, {
        stdout() {}, stderr(text) { throw new Error(text); },
      }));
      if (build.value !== 0) throw new Error('Benchmark build failed');
      const startup = await measured(() => createContextAccess(root, 'gold'));
      const access = startup.value;
      const search: number[] = [];
      const read: number[] = [];
      for (let sample = 0; sample < samples; sample++) {
        const searched = await measured(() => access.search('measured envelope concept'));
        const hit = searched.value[0];
        if (hit === undefined) throw new Error('Signed fixture did not yield a result');
        const loaded = await measured(() => access.read(hit.citation_id));
        if (loaded.value.instruction_authority !== 'none') throw new Error('Benchmark authority violation');
        search.push(searched.ms);
        read.push(loaded.ms);
      }
      const indexLoad = await measured(() => loadGoldIndex(root));
      const bm25 = await measured(async () => buildBm25(indexLoad.value.chunks.map(chunk => ({
        id: chunk.id, text: `${chunk.heading} ${chunk.body}`,
      }))));
      const live = await measured(() => computeLiveFingerprint(root, 'gold'));
      const cli = await measured(() => execute(process.execPath, [
        ...process.execArgv.filter(argument => /^--max-old-space-size=\d+$/u.test(argument)),
        fileURLToPath(new URL('../../src/cli/main.js', import.meta.url)),
        'query', '--root', root, '--query', 'measured envelope concept', '--json',
      ], { timeout: 120_000, maxBuffer: 4 * 1024 ** 2 }));
      JSON.parse(cli.value.stdout);
      if (await implementationFingerprint() !== implementation) {
        throw new Error('Compiled implementation changed during the benchmark; discard this incomplete measurement and run a new batch.');
      }
      const indexBytes = (await Promise.all(['gold', 'review', 'evidence'].map(async profile =>
        (await stat(join(root, '.ziggurat', `${profile}-index.json`))).size))).reduce((a, b) => a + b, 0);
      peakRss = Math.max(peakRss, process.resourceUsage().maxRSS * 1024);
      const searchMs = distribution(search);
      const readMs = distribution(read);
      const inEnvelope = pages <= 1000;
      const pass = searchMs.p95 < 1000 && readMs.p95 < 1000 && peakRss < 1024 ** 3 && indexBytes < 512 * 1024 ** 2;
      if (inEnvelope && !pass) allPass = false;
      const point = {
        implementation_sha256: implementation,
        pages, ...setup.value, samples, fixture_setup_ms: setup.ms, build_ms: build.ms,
        startup_ms: startup.ms, verified_search_ms: searchMs, verified_read_ms: readMs,
        fresh_process_cli_query_ms: cli.ms,
        samples_ms: { search, read },
        diagnostic_sample_ms: { index_load: indexLoad.ms, bm25_rebuild: bm25.ms, live_corpus_verification: live.ms },
        peak_rss_bytes: peakRss, peak_heap_bytes: peakHeap, index_bytes: indexBytes,
        corpus_and_index_disk_bytes: await diskBytes(root),
        publication_headroom_bytes: indexBytes,
        in_envelope: inEnvelope, pass,
      };
      points.push(point);
      await writeFile(join(output, `point-${pages}.json`), JSON.stringify(point, null, 2) + '\n', { flag: 'wx' });
      console.log(`${pages} pages: search p95 ${searchMs.p95.toFixed(1)}ms; read p95 ${readMs.p95.toFixed(1)}ms; ${pass ? 'PASS' : 'FAIL'}`);
    } finally {
      clearInterval(sampler);
      if (!values.keep) await rm(root, { recursive: true, force: true });
    }
  }
  await writeFile(join(output, 'report.json'), JSON.stringify({
    schema_version: 1, generated_at: new Date().toISOString(), implementation_sha256: implementation,
    hardware: {
      cpu: cpus()[0]?.model, ram_bytes: totalmem(), platform: platform(), release: release(),
      node: process.version, node_arguments: process.execArgv,
    },
    targets: { search_read_p95_ms: 1000, rss_bytes: 1024 ** 3, indexes_bytes: 512 * 1024 ** 2 },
    notes: [
      'Synthetic test-only keys and public fixture data; not a human authorization claim.',
      'Startup is a new ContextAccess in the same process, not a cold OS disk-cache or CLI-start benchmark.',
      'Search/read timings include live integrity and authorization verification on every request.',
      'Diagnostic components are independent single samples and must not be added as an exact latency decomposition.',
      'RSS includes fixture preparation and prior points in this process; model server memory is not present.',
      'Fresh-process CLI time includes process startup and query verification; child-process RSS is not sampled.',
      'An explicit --max-old-space-size=MiB runtime argument is propagated to the measured CLI child.',
      'Reserved publication headroom equals the three serialized index sizes; actual ENOSPC needs a separate isolated volume.',
    ],
    points, pass: sizes.some(size => size <= 1000) ? allPass : null,
  }, null, 2) + '\n', { flag: 'wx' });
  if (!allPass) process.exitCode = 2;
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
