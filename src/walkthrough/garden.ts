import { cp, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../cli/main.js';
import type { CliIO } from '../cli/main.js';

export interface PreparedVault {
  root: string;
  ingest_results: Array<{ status: string; source_path: string }>;
  bronze_by_name: Record<string, string>;
  next_step: string;
}

function captureIO(): { captured: { out: string; err: string }; io: CliIO } {
  const captured = { out: '', err: '' };
  const io: CliIO = {
    stdout: text => { captured.out += text; },
    stderr: text => { captured.err += text; },
  };
  return { captured, io };
}

/**
 * Runs every automated walkthrough action and stops before human admission. Production
 * code never writes knowledge, reviewed metadata, trusted keys, or authorization receipts.
 */
export async function prepareGardenVault(
  fixturesDir: string,
  outputDir?: string,
): Promise<PreparedVault> {
  const root = outputDir ?? await mkdtemp(join(tmpdir(), 'ziggurat-garden-'));
  const { io: initIo, captured: initCaptured } = captureIO();
  if (await runCli(['init', '--root', root], initIo) !== 0) {
    throw new Error(`init failed: ${initCaptured.err}`);
  }

  const inboxDir = join(fixturesDir, 'inbox');
  const inboxFiles = (await readdir(inboxDir)).sort();
  const ingest_results: PreparedVault['ingest_results'] = [];
  for (const file of inboxFiles) {
    await cp(join(inboxDir, file), join(root, 'inbox', file));
    const { io, captured } = captureIO();
    const code = await runCli(
      ['ingest', '--root', root, '--file', `inbox/${file}`, '--json'],
      io,
    );
    if (code !== 0) throw new Error(`ingest failed for ${file}: ${captured.err}`);
    ingest_results.push(JSON.parse(captured.out) as {
      status: string;
      source_path: string;
    });
  }

  const bronze_by_name: Record<string, string> = {};
  inboxFiles.forEach((file, index) => {
    const result = ingest_results[index];
    if (result !== undefined) {
      bronze_by_name[file.replace(/\.md$/u, '')] = result.source_path;
    }
  });

  return {
    root,
    ingest_results,
    bronze_by_name,
    next_step: [
      'Bronze capture is complete. Gold admission is human-only.',
      '',
      '  1. Configure a loopback model and stage a strict Silver proposal.',
      `  2. Inspect it with: ziggurat review --root "${root}"`,
      '  3. Manually author the reviewed knowledge page.',
      '  4. Obtain an external Ed25519 signature from a configured trusted reviewer.',
      '  5. Store the detached receipt under authorizations/ and commit both files.',
      `  6. Rebuild with: ziggurat build --root "${root}"`,
      '',
      'Ziggurat ships no signing, apply, approval, or promotion command.',
    ].join('\n'),
  };
}
