import { parseArgs } from 'node:util';
import type { ReviewOrder } from '../review/queue.js';

export type CliCommand = 'init' | 'ingest' | 'refine' | 'review' | 'build' | 'query' | 'mcp' | 'check' | 'eval';

export interface ParsedArgs {
  command: CliCommand | null;
  root: string;
  file?: string | undefined;
  query?: string | undefined;
  target?: string | undefined;
  order?: ReviewOrder | undefined;
  cursor?: string | undefined;
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
      target: { type: 'string' },
      order: { type: 'string' },
      cursor: { type: 'string' },
      json: { type: 'boolean' },
      'audit-clean-room': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  });

  const command = positionals[0];
  const auditCleanRoom = values['audit-clean-room'] ?? false;
  for (const option of ['order', 'cursor'] as const) {
    if (values[option] !== undefined && command !== 'review') {
      throw new Error(`--${option} applies only to the review command.`);
    }
  }
  if (values.order !== undefined && values.order !== 'priority' && values.order !== 'oldest') {
    throw new Error('--order must be priority or oldest.');
  }
  if (!command && values.help === true) {
    return {
      command: null,
      root: values.root ?? process.cwd(),
      file: values.file,
      query: values.query,
      sources: values.source,
      target: values.target,
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
  //
  // This deliberately runs before the per-command `--help` short-circuit in runCli, so
  // `ziggurat build --help --audit-clean-room` is an error rather than a usage screen.
  // A misplaced gate flag should never produce a success exit code, and help output is
  // still reachable through the correct invocation. Global `ziggurat --help` is
  // unaffected: it returns above, before any command is required.
  if (auditCleanRoom && command !== 'check') {
    throw new Error(
      `--audit-clean-room applies only to the check command, but was passed to "${command}". `
      + 'Run: ziggurat check --root <repo> --audit-clean-room',
    );
  }
  if (values.target !== undefined && command !== 'refine') {
    throw new Error('--target applies only to the refine command.');
  }

  const root = values.root ?? process.cwd();

  return {
    command: command as CliCommand,
    root,
    file: values.file,
    query: values.query,
    sources: values.source,
    target: values.target,
    order: values.order as ReviewOrder | undefined,
    cursor: values.cursor,
    auditCleanRoom,
    json: values.json ?? false,
    help: values.help ?? false,
  };
}
