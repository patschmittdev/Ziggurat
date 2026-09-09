import { pathToFileURL } from 'node:url';
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
    io.stderr(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  const { command, root, file, query, sources, json, help } = parsed;
  if (help) {
    io.stdout(renderHelp(command));
    return 0;
  }

  try {
    switch (command) {
      case 'init':    return await runInit(root, io);
      case 'ingest':  return await runIngest(root, file, json, io);
      case 'refine':  return await runRefine(root, query, json, io, { sources });
      case 'review':  return await runReview(root, json, io);
      case 'build':   return await runBuild(root, json, io);
      case 'query':   return await runQuery(root, query, json, io);
      case 'mcp':     return await runMcp(root, json, io);
      case 'check':   return await runCheck(root, json, io);
      case 'eval':    return await runEval(root, json, io);
    }
    io.stderr('error: command is required\n');
    return 1;
  } catch (err) {
    io.stderr(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  function renderHelp(command: import('./args.js').CliCommand | null): string {
    if (command !== null) {
      const usage: Record<import('./args.js').CliCommand, string> = {
        init: 'ziggurat init --root <vault>',
        ingest: 'ziggurat ingest --root <vault> --file <inbox-file>',
        refine: 'ziggurat refine --root <vault> --query <request> [--source <bronze-path>]...',
        review: 'ziggurat review --root <vault>',
        build: 'ziggurat build --root <vault>',
        query: 'ziggurat query --root <vault> --query <text>',
        mcp: 'ziggurat mcp --root <vault>',
        check: 'ziggurat check --root <repo> [--audit-clean-room]',
        eval: 'ziggurat eval --root <vault>',
      };
      return `Usage: ${usage[command]}\n`;
    }
    return [
      'Ziggurat: Models propose. Humans decide what persists.',
      '',
      'Usage: ziggurat <command> [options]',
      '',
      'Commands:',
      '  init     Initialize a vault with an empty human trust policy',
      '  ingest   Capture immutable Bronze evidence',
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
      'check option:  --audit-clean-room  Select the clean-room release audit.',
      '               check runs that audit either way; the flag names the gate',
      '               explicitly and is rejected by every other command.',
      '',
    ].join('\n');
  }
}

// Entry point when run as an executable.
//
// pathToFileURL, not `new URL(argv[1], import.meta.url)`: on Windows argv[1] is a path
// like C:\...\main.js, and the URL parser reads the drive letter as a scheme, so the
// comparison never matched and the shipped binary silently did nothing. Tests call
// runCli() directly, which is why CI stayed green on all three platforms.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
