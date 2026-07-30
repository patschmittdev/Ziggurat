import { parseArgs } from 'node:util';

export type CliCommand = 'init' | 'ingest' | 'refine' | 'review' | 'build' | 'query' | 'mcp' | 'check' | 'eval';

export interface ParsedArgs {
  command: CliCommand;
  root: string;
  file?: string | undefined;
  query?: string | undefined;
  profile?: string | undefined;
  json: boolean;
}

const COMMANDS = new Set<string>(['init', 'ingest', 'refine', 'review', 'build', 'query', 'mcp', 'check', 'eval']);

/** Parses CLI args. Throws a descriptive Error on unknown flags or missing required args. */
export function parseCliArgs(args: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args,
    options: {
      root: { type: 'string' },
      file: { type: 'string' },
      query: { type: 'string', short: 'q' },
      profile: { type: 'string' },
      json: { type: 'boolean' },
      'audit-clean-room': { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });

  const command = positionals[0];
  if (!command || !COMMANDS.has(command)) {
    const known = [...COMMANDS].join(', ');
    throw new Error(`Unknown command: ${command ?? '(none)'}. Known commands: ${known}`);
  }

  const root = values.root ?? process.cwd();

  return {
    command: command as CliCommand,
    root,
    file: values.file,
    query: values.query,
    profile: values.profile,
    json: values.json ?? false,
  };
}
