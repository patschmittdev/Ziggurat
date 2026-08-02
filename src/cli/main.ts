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

  const { command, root, file, query, profile, json } = parsed;

  try {
    switch (command) {
      case 'init':    return await runInit(root, io);
      case 'ingest':  return await runIngest(root, file, json, io);
      case 'refine':  return await runRefine(root, query, json, io);
      case 'review':  return await runReview(root, json, io);
      case 'build':   return await runBuild(root, json, io);
      case 'query':   return await runQuery(root, query, json, io);
      case 'mcp':     return await runMcp(root, profile, json, io);
      case 'check':   return await runCheck(root, json, io);
      case 'eval':    return await runEval(root, json, io);
    }
  } catch (err) {
    io.stderr(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
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
  process.exit(exitCode);
}
