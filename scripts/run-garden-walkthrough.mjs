/**
 * Garden walkthrough entry point.
 * Delegates to the compiled TypeScript module.
 * Usage: node scripts/run-garden-walkthrough.mjs [--output-dir <path>]
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const FIXTURES_DIR = join(REPO_ROOT, 'fixtures', 'garden');

const { runGardenWalkthrough } = await import(join(REPO_ROOT, 'dist', 'src', 'walkthrough', 'garden.js'));

const outputDir = process.argv.includes('--output-dir')
  ? process.argv[process.argv.indexOf('--output-dir') + 1]
  : undefined;

const result = await runGardenWalkthrough(FIXTURES_DIR, outputDir);
console.log(JSON.stringify(result, null, 2));
console.log(`\nWalkthrough completed. Vault at: ${result.root}`);
