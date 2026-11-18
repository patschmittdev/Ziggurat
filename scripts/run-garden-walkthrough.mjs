/**
 * Garden walkthrough entry point.
 *
 * Runs only the automated half of the walkthrough: init and Bronze ingest. It stops at
 * the signing boundary because Gold admission requires an external human-held key.
 *
 * Usage: node scripts/run-garden-walkthrough.mjs [--output-dir <path>]
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const FIXTURES_DIR = join(REPO_ROOT, 'fixtures', 'garden');

const walkthroughUrl = pathToFileURL(
  join(REPO_ROOT, 'dist', 'src', 'walkthrough', 'garden.js'),
);
const { prepareGardenVault } = await import(walkthroughUrl.href);

const outputDir = process.argv.includes('--output-dir')
  ? process.argv[process.argv.indexOf('--output-dir') + 1]
  : undefined;

const prepared = await prepareGardenVault(FIXTURES_DIR, outputDir);

console.log(JSON.stringify({
  root: prepared.root,
  ingest_results: prepared.ingest_results,
}, null, 2));
console.log(`\nVault prepared at: ${prepared.root}\n`);
console.log(prepared.next_step);
