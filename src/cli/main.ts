#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { parseCliArgs } from './args.js';
import { runInit } from './commands/init.js';
import { runIngest } from './commands/ingest.js';
import { runRefine } from './commands/refine.js';
import { runReview } from './commands/review.js';
import { runBuild } from './commands/build.js';
import { runQuery } from './commands/query.js';
import { runMcp } from './commands/mcp.js';
import { runCheck } from './commands/check.js';
import { runEval } from './commands/eval.js';
import { RefinementError } from '../refine/errors.js';
import { AdapterError } from '../refine/adapter.js';
import { IndexVerificationError } from '../retrieval/verify.js';
import { inertSingleLineText } from '../presentation/inert.js';

export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const DEFAULT_IO: CliIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export async function runCli(args: string[], io: CliIO = DEFAULT_IO): Promise<number> {
  let parsed;
  try {
    parsed = parseCliArgs(args);
  } catch (err) {
    io.stderr(`error: ${inertSingleLineText(err instanceof Error ? err.message : String(err))}\n`);
    return 1;
  }

  const { command, root, file, query, sources, target, order, cursor, json, help } = parsed;
  if (help) {
    io.stdout(renderHelp(command));
    return 0;
  }

  try {
    switch (command) {
      case 'init':    return await runInit(root, io);
      case 'ingest':  return await runIngest(root, file, json, io);
      case 'refine':  return await runRefine(root, query, json, io, { sources, target });
      case 'review':  return await runReview(root, json, io, { order, cursor });
      case 'build':   return await runBuild(root, json, io);
      case 'query':   return await runQuery(root, query, json, io);
      case 'mcp':     return await runMcp(root, json, io);
      case 'check':   return await runCheck(root, json, io);
      case 'eval':    return await runEval(root, json, io);
    }
    io.stderr('error: command is required\n');
    return 1;
  } catch (err) {
    if (err instanceof IndexVerificationError) {
      const message = inertSingleLineText(err.message);
      io.stderr(json
        ? JSON.stringify({ error: { code: err.code, message, reason_codes: err.reason_codes } }) + '\n'
        : `error [${err.code}]: ${message}\n`);
      return 1;
    }
    if (err instanceof RefinementError || err instanceof AdapterError) {
      const message = inertSingleLineText(err.message);
      io.stderr(json
        ? JSON.stringify({ error: { code: err.code, message } }) + '\n'
        : `error [${err.code}]: ${message}\n`);
      return 1;
    }
    io.stderr(`error: ${inertSingleLineText(err instanceof Error ? err.message : String(err))}\n`);
    return 1;
  }

  function renderHelp(command: import('./args.js').CliCommand | null): string {
    if (command !== null) {
      const usage: Record<import('./args.js').CliCommand, string> = {
        init: 'ziggurat init --root <vault>',
        ingest: 'ziggurat ingest --root <vault> --file <inbox-file>',
        refine: 'ziggurat refine --root <vault> --query <request> [--source <bronze-path>]... [--target <knowledge-path>]',
        review: 'ziggurat review --root <vault> [--order priority|oldest] [--cursor <token>]',
        build: 'ziggurat build --root <vault>',
        query: 'ziggurat query --root <vault> --query <text>',
        mcp: 'ziggurat mcp --root <vault>',
        check: 'ziggurat check --root <repo> [--audit-clean-room]',
        eval: 'ziggurat eval --root <vault>',
      };
      return `Usage: ${usage[command]}\n`;
    }
    return [
      'Ziggurat: Models propose. A trusted key decides what persists.',
      '',
      'Usage: ziggurat <command> [options]',
      '',
      'Commands:',
      '  init     Initialize a vault with an empty human trust policy',
      '  ingest   Capture no-overwrite Bronze evidence',
      '  refine   Stage an evidence-backed Silver proposal',
      '  review   Render staged Silver proposals for human review',
      '  build    Rebuild isolated indexes; unsigned content stays out of Gold',
      '  query    Query authorized Gold',
      '  mcp      Start the read-only Gold MCP server',
      '  check    Audit clean-room and key-material policy',
      '  eval     Run conformance checks',
      '',
      'Gold MCP: ziggurat mcp --root <vault>',
      'Common options: --root <vault> --json --help',
      'review options: --order priority|oldest --cursor <token> (read-only, state-bound pagination).',
      'check option:  --audit-clean-room  Select the clean-room release audit.',
      '               check runs that audit either way; the flag names the gate',
      '               explicitly and is rejected by every other command.',
      '',
    ].join('\n');
  }
}

// Resolve symlinks before comparison so npm link invokes the entry point.
// pathToFileURL preserves Windows drive letters as paths rather than URL schemes.
export function isEntryPoint(moduleUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) return false;
  try {
    return pathToFileURL(realpathSync(fileURLToPath(moduleUrl))).href ===
      pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return false;
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
