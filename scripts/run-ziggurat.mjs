import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(scriptsDir);
const entrypoint = join(root, 'dist', 'src', 'cli', 'main.js');
const configuredHeap = process.env.ZIGGURAT_MAX_OLD_SPACE_SIZE ?? '512';

if (!/^[1-9][0-9]*$/u.test(configuredHeap)) {
  console.error('ZIGGURAT_MAX_OLD_SPACE_SIZE must be a positive integer in MiB.');
  process.exitCode = 2;
} else if (!existsSync(entrypoint)) {
  console.error('Compiled CLI not found. Run npm run build first.');
  process.exitCode = 2;
} else {
  const child = spawn(
    process.execPath,
    [`--max-old-space-size=${configuredHeap}`, entrypoint, ...process.argv.slice(2)],
    { stdio: 'inherit', windowsHide: false },
  );
  child.on('error', (error) => {
    console.error(`Failed to start Ziggurat: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal === null
      ? 1
      : 128 + (osConstants.signals[signal] ?? 0));
  });
}
