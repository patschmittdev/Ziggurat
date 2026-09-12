import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import * as YAML from 'yaml';
import type { CliIO } from '../main.js';
import { GENERATED_ARTIFACTS, auditCleanRoom } from '../../eval/clean-room.js';
import type { CleanRoomReport } from '../../eval/clean-room.js';
import { renderCleanRoomMarkdown } from '../../eval/report.js';
import { inertSingleLineText } from '../../presentation/inert.js';

/**
 * Directories that never contain authored content. Everything else in the repository is
 * scanned, including root files, dotfile directories, and every nested source directory.
 *
 * A release gate that skips most of the tree reports "clean" while examining almost
 * nothing, which is worse than no gate at all because the green result gets cited as
 * evidence.
 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

export function decodeAuditedText(content: Buffer): string | null {
  if (content.includes(0)) return null;
  try {
    return UTF8_DECODER.decode(content);
  } catch {
    return null;
  }
}

/**
 * Paths excluded by default, for reasons that are about provenance rather than
 * convenience:
 *
 * - `package-lock.json` is machine-generated dependency metadata full of registry URLs.
 *   It is not authored content and a human cannot meaningfully clean it.
 * - the audit's own test file deliberately contains sample secrets as fixtures; they
 *   are the test subjects, not a leak.
 *
 * Anything else must be cleaned, not exempted. Additional exclusions belong in
 * `config/clean-room.yaml` where a reviewer can see them.
 */
const DEFAULT_EXCLUDES = ['package-lock.json', 'test/clean-room.test.ts'];

async function collectTextFiles(
  root: string,
  dir: string = root,
  files: Array<{ path: string; content: string }> = [],
  unscannableFiles: string[] = [],
): Promise<{
  files: Array<{ path: string; content: string }>;
  unscannableFiles: string[];
}> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collectTextFiles(root, full, files, unscannableFiles);
      continue;
    }
    if (!entry.isFile()) continue;

    const relPath = full
      .replace(/\\/g, '/')
      .replace(root.replace(/\\/g, '/') + '/', '');
    const content = decodeAuditedText(await readFile(full));
    if (content === null) {
      unscannableFiles.push(relPath);
      continue;
    }
    // A file that cannot be read is reported rather than skipped: an unreadable file is
    // an unaudited file, and the gate must not pass on material it never inspected.
    files.push({ path: relPath, content });
  }

  return { files, unscannableFiles };
}

interface CleanRoomConfig {
  projectNames: string[];
  excludePaths: string[];
}

const CLEAN_ROOM_CONFIG_KEYS = new Set(['project_names', 'exclude_paths']);

/**
 * Error raised when `config/clean-room.yaml` exists but cannot be trusted.
 *
 * A release gate that silently falls back to defaults when its own configuration is
 * unreadable or malformed reports "clean" while ignoring every exclusion and project
 * name a human configured. That is the failure mode the gate exists to prevent, so a
 * present-but-unusable configuration fails the audit instead.
 */
export class CleanRoomConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CleanRoomConfigError';
  }
}

function readStringList(
  value: unknown,
  field: string,
  configPath: string,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new CleanRoomConfigError(
      `${configPath}: "${field}" must be a list of strings. Fix the file or remove the key to use defaults.`,
    );
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new CleanRoomConfigError(
        `${configPath}: "${field}[${index}]" must be a non-empty string. Fix the file or remove the key to use defaults.`,
      );
    }
    return entry;
  });
}

/**
 * Reads clean-room config. An absent file means documented defaults. A file that
 * exists but is unreadable, is not valid YAML, is not a mapping, or carries unknown
 * keys fails closed with an actionable diagnostic.
 */
async function loadCleanRoomConfig(root: string): Promise<CleanRoomConfig> {
  const configPath = join(root, 'config', 'clean-room.yaml');
  const displayPath = 'config/clean-room.yaml';

  let text: string;
  try {
    text = await readFile(configPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { projectNames: [], excludePaths: [...DEFAULT_EXCLUDES] };
    }
    throw new CleanRoomConfigError(
      `${displayPath}: configuration exists but could not be read: `
      + `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // parseDocument does not resolve aliases, so an alias-expansion bomb surfaces as a
  // throw from toJS() rather than in doc.errors. Both must fail closed as config
  // errors, otherwise runCheck rethrows and emits no report at all.
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(text);
  } catch (err) {
    throw new CleanRoomConfigError(
      `${displayPath}: YAML parse error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (doc.errors.length > 0) {
    const first = doc.errors[0];
    throw new CleanRoomConfigError(
      `${displayPath}: YAML parse error: ${first != null ? String(first.message) : 'unknown'}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = doc.toJS() as unknown;
  } catch (err) {
    throw new CleanRoomConfigError(
      `${displayPath}: YAML document could not be resolved: `
      + `${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || parsed === undefined) {
    return { projectNames: [], excludePaths: [...DEFAULT_EXCLUDES] };
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CleanRoomConfigError(
      `${displayPath}: top level must be a YAML mapping with optional "project_names" and "exclude_paths" keys.`,
    );
  }

  const record = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter(key => !CLEAN_ROOM_CONFIG_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new CleanRoomConfigError(
      `${displayPath}: unknown configuration keys: ${unknownKeys.sort().join(', ')}. `
      + `Allowed keys are ${[...CLEAN_ROOM_CONFIG_KEYS].sort().join(' and ')}.`,
    );
  }

  return {
    projectNames: readStringList(record['project_names'], 'project_names', displayPath),
    excludePaths: [
      ...DEFAULT_EXCLUDES,
      ...readStringList(record['exclude_paths'], 'exclude_paths', displayPath),
    ],
  };
}

/** Generated retrieval state that is actually present on disk. */
async function findCommittedArtifacts(root: string): Promise<string[]> {
  const present: string[] = [];
  for (const artifact of GENERATED_ARTIFACTS) {
    try {
      await readFile(join(root, artifact), 'utf8');
      present.push(artifact);
    } catch {
      continue;
    }
  }
  return present;
}

export async function runCheck(root: string, json: boolean, io: CliIO): Promise<number> {
  let config: CleanRoomConfig;
  try {
    config = await loadCleanRoomConfig(root);
  } catch (err) {
    if (!(err instanceof CleanRoomConfigError)) throw err;
    const failure: CleanRoomReport = {
      pass: false,
      findings: [{
        path: 'config/clean-room.yaml',
        category: 'invalid-clean-room-config',
        line: 0,
        detail: err.message,
      }],
    };
    if (json) {
      io.stdout(JSON.stringify(failure, null, 2) + '\n');
    } else {
      io.stdout(renderCleanRoomMarkdown(failure) + '\n');
    }
    io.stderr(`error: ${inertSingleLineText(err.message)}\n`);
    return 1;
  }

  const excluded = new Set(config.excludePaths);
  const collected = await collectTextFiles(root);
  const files = collected.files.filter((f) => !excluded.has(f.path));
  const unscannableFiles = collected.unscannableFiles.filter(path => !excluded.has(path));
  const report = await auditCleanRoom(
    files,
    config.projectNames,
    await findCommittedArtifacts(root),
    unscannableFiles,
  );

  if (json) {
    io.stdout(JSON.stringify(report, null, 2) + '\n');
  } else {
    io.stdout(renderCleanRoomMarkdown(report) + '\n');
  }

  return report.pass ? 0 : 1;
}
