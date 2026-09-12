import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

parseArgs({ options: {}, allowPositionals: false, strict: true });

const root = fileURLToPath(new URL('../', import.meta.url));
const image = 'node@sha256:2c87ef9bd3c6a3bd4b472b4bec2ce9d16354b0c574f736c476489d09f560a203';
const bootstrap = `
  const fs = require('node:fs');
  const { spawnSync } = require('node:child_process');
  console.log(JSON.stringify({
    node: process.version,
    platform: process.platform,
    kernel: require('node:os').release(),
    filesystem: fs.statfsSync('/volume'),
  }));
  fs.writeFileSync('/volume/.ziggurat-disposable-volume',
    'DISPOSABLE ZIGGURAT TEST VOLUME\\n', { flag: 'wx' });
  const result = spawnSync(process.execPath, [
    'dist/test/manual/disk-full.js', '--volume', '/volume', '--confirm-disposable',
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) throw new Error('Disk-full test terminated: ' + result.signal);
  if (result.status === null) throw new Error('Disk-full test returned no exit status');
  process.exitCode = result.status;
`;

const result = spawnSync('docker', [
  'run', '--rm', '--network', 'none', '--read-only',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
  '--memory', '256m', '--pids-limit', '64', '--user', 'node',
  '--tmpfs', '/volume:rw,noexec,nosuid,size=48m,mode=1777',
  '--mount', `type=bind,source=${join(root, 'dist')},target=/app/dist,readonly`,
  '--mount', `type=bind,source=${join(root, 'node_modules')},target=/app/node_modules,readonly`,
  '--mount', `type=bind,source=${join(root, 'package.json')},target=/app/package.json,readonly`,
  '--workdir', '/app', image, 'node', '-e', bootstrap,
], { stdio: 'inherit' });

if (result.error) {
  console.error(`Unable to run the disk-full test with Docker: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.signal) {
  console.error(`Docker disk-full test terminated: ${result.signal}`);
  process.exitCode = 1;
} else if (result.status === null) {
  console.error('Docker disk-full test returned no exit status');
  process.exitCode = 1;
} else {
  process.exitCode = result.status;
}
