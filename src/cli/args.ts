import { parseArgs } from 'node:util';

export type CliCommand = 'init' | 'ingest' | 'refine' | 'review' | 'build' | 'query' | 'mcp' | 'check' | 'eval';

export interface ParsedArgs {
  command: CliCommand | null;
  root: string;
  file?: string | undefined;
  query?: string | undefined;
  /** Repeatable --source selections, currently used only by refine. */
  sources?: string[] | undefined;
  /**
   * Explicit selector for the clean-room release audit. Only `check` accepts it.
   *
   * `check` performs exactly one audit, so naming it does not change what runs; the
   * flag exists so release automation states which gate it is invoking, and so a
   * future second audit can be selected without changing the default. It is scoped
   * rather than global because a flag that every command silently swallows reads as
   * an assertion that the audit happened when it did not.
   */
  auditCleanRoom: boolean;
  json: boolean;
  help: boolean;
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
      source: { type: 'string', multiple: true },
      json: { type: 'boolean' },
      'audit-clean-room': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  });

  const command = positionals[0];
  const auditCleanRoom = values['audit-clean-room'] ?? false;
  if (!command && values.help === true) {
    return {
      command: null,
      root: values.root ?? process.cwd(),
      file: values.file,
      query: values.query,
      sources: values.source,
      auditCleanRoom,
      json: values.json ?? false,
      help: true,
    };
  }
  if (!command || !COMMANDS.has(command)) {
    const known = [...COMMANDS].join(', ');
    throw new Error(`Unknown command: ${command ?? '(none)'}. Known commands: ${known}`);
  }

  // Scope check, not a style preference. parseArgs accepts every declared option for
  // every command, so before this check `ziggurat build --audit-clean-room` exited 0
  // while auditing nothing. A release script that trusted that exit code would report
  // a clean gate it never ran.
  if (auditCleanRoom && command !== 'check') {
    throw new Error(
      `--audit-clean-room applies only to the check command, but was passed to "${command}". `
      + 'Run: ziggurat check --root <repo> --audit-clean-room',
    );
  }

  const root = values.root ?? process.cwd();

  return {
    command: command as CliCommand,
    root,
    file: values.file,
    query: values.query,
    sources: values.source,
    auditCleanRoom,
    json: values.json ?? false,
    help: values.help ?? false,
  };
}
