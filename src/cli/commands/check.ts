import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import * as YAML from 'yaml';
import type { CliIO } from '../main.js';
import { GENERATED_ARTIFACTS, auditCleanRoom } from '../../eval/clean-room.js';
import { renderCleanRoomMarkdown } from '../../eval/report.js';

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

/** Reads clean-room config. Absent config means defaults, not a failure. */
async function loadCleanRoomConfig(root: string): Promise<CleanRoomConfig> {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

  try {
    const text = await readFile(join(root, 'config', 'clean-room.yaml'), 'utf8');
    const parsed = YAML.parse(text) as { project_names?: unknown; exclude_paths?: unknown } | null;
    return {
      projectNames: strings(parsed?.project_names),
      excludePaths: [...DEFAULT_EXCLUDES, ...strings(parsed?.exclude_paths)],
    };
  } catch {
    return { projectNames: [], excludePaths: [...DEFAULT_EXCLUDES] };
  }
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
  const config = await loadCleanRoomConfig(root);
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
