import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { z } from 'zod';
import { createOperatingVault } from './helpers/operating-vault.js';
import { runBuild } from '../src/cli/commands/build.js';

const cli = fileURLToPath(new URL('../src/cli/main.js', import.meta.url));
const execute = promisify(execFile);
const toolResult = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
});
const errorResult = z.object({
  error: z.object({ code: z.string(), message: z.string(), reason_codes: z.array(z.string()) }).strict(),
}).strict();

test('CLI and live MCP expose structured policy codes without excluded paths or source content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ziggurat-runtime-diagnostics-'));
  let server: ReturnType<typeof spawn> | undefined;
  try {
    await createOperatingVault(root, 1);
    await runBuild(root, true, { stdout() {}, stderr(text) { throw new Error(text); } });
    server = spawn(process.execPath, [cli, 'mcp', '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
    assert(server.stdout !== null && server.stdin !== null);
    const lines = createInterface({ input: server.stdout });
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let sequence = 0;
    lines.on('line', line => {
      const response = z.object({ id: z.number().optional(), result: z.unknown().optional(), error: z.unknown().optional() })
        .safeParse(JSON.parse(line));
      if (!response.success || response.data.id === undefined) return;
      const entry = pending.get(response.data.id);
      if (entry === undefined) return;
      pending.delete(response.data.id);
      if (response.data.error !== undefined) entry.reject(new Error('MCP returned a protocol error'));
      else entry.resolve(response.data.result);
    });
    const request = async (method: string, params: object): Promise<unknown> => {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP ${method} timed out`));
        }, 15_000);
        pending.set(id, {
          resolve(value) { clearTimeout(timeout); resolve(value); },
          reject(error) { clearTimeout(timeout); reject(error); },
        });
        server?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    };
    await request('initialize', {
      protocolVersion: '2026-07-28',
      capabilities: {},
      clientInfo: { name: 'diagnostics-test', version: '1' },
    });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const first = toolResult.parse(await request('tools/call', { name: 'search_context', arguments: { query: 'measured envelope' } }));
    assert.notEqual(first.isError, true);
    const hits = z.array(z.object({ citation_id: z.string() })).parse(JSON.parse(first.content[0]?.text ?? ''));
    assert(hits[0] !== undefined);
    await writeFile(join(root, 'config', 'trust.yaml'), 'trust:\n  reviewers: []\n');
    for (const args of [
      { name: 'search_context', arguments: { query: 'measured envelope' } },
      { name: 'read_context', arguments: { citation_id: hits[0].citation_id } },
    ]) {
      const result = toolResult.parse(await request('tools/call', args));
      assert.equal(result.isError, true);
      const text = result.content[0]?.text ?? '';
      const error = errorResult.parse(JSON.parse(text)).error;
      assert.equal(error.code, 'trust_policy_changed');
      assert(error.reason_codes.length > 0);
      assert(!text.includes('bronze/'));
      assert(!text.includes('knowledge/'));
      assert(!text.includes(root));
      assert(!text.includes('synthetic record'));
    }
    await assert.rejects(
      () => execute(process.execPath, [cli, 'query', '--root', root, '--query', 'measured', '--json']),
      error => {
        assert(error instanceof Error && 'stderr' in error);
        assert.equal(errorResult.parse(JSON.parse(String(error.stderr))).error.code, 'trust_policy_changed');
        return true;
      },
    );
    lines.close();
  } finally {
    if (server !== undefined && server.exitCode === null) {
      server.kill();
      await once(server, 'exit');
    }
    await rm(root, { recursive: true, force: true });
  }
});
