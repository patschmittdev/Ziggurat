import { access } from 'node:fs/promises';
import { join } from 'node:path';

export interface CleanRoomFinding {
  path: string;
  category: string;
  line: number;
  detail: string;
}

export interface CleanRoomReport {
  pass: boolean;
  findings: CleanRoomFinding[];
}

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /[A-Z]:\\Users\\[^\\]+\\/u, category: 'windows-absolute-path' },
  { pattern: /\/Users\/[a-z]/u, category: 'unix-absolute-path' },
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/u, category: 'email-address' },
  { pattern: /(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}/u, category: 'github-token' },
  { pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u, category: 'private-key-material' },
];

const GITHUB_HTTPS_REPOSITORY =
  /(?:git\+)?https?:\/\/github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\.git)?/u;
const GITHUB_SSH_REPOSITORY =
  /(?:git@github\.com:[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\.git)?|ssh:\/\/git@github\.com\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+(?:\.git)?)/u;

function containsGitRemote(line: string): boolean {
  if (GITHUB_SSH_REPOSITORY.test(line)) return true;

  const match = GITHUB_HTTPS_REPOSITORY.exec(line);
  if (match === null) return false;
  if (match[0].startsWith('git+') || match[0].endsWith('.git')) return true;

  const prefix = line.slice(0, match.index);
  const suffix = line.slice(match.index + match[0].length);
  return (
    /\bgit\s+(?:clone|fetch|pull)\b/u.test(prefix) ||
    /\bgit\s+remote\s+(?:add|set-url)\b/u.test(prefix) ||
    /(?:^|\s)(?:origin|upstream|remote)\s*$/u.test(prefix) ||
    /^\s*(?:url|pushurl)\s*=\s*$/u.test(prefix) ||
    /^\s+\((?:fetch|push)\)\s*$/u.test(suffix)
  );
}

/**
 * Project-name detection is configured, never compiled in.
 *
 * Hard-coding a private vault's project names into the scanner would embed exactly the
 * vocabulary the clean-room rule exists to keep out of this repository, and would make
 * the starter useless to anyone whose projects are named differently. Terms come from
 * `config/clean-room.yaml`, which ships with none.
 */
export function buildProjectNamePattern(terms: string[]): RegExp | null {
  const cleaned = terms
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'));

  if (cleaned.length === 0) return null;

  return new RegExp(`\\b(?:${cleaned.join('|')})\\b`, 'iu');
}

/**
 * Generated retrieval state that must never be committed.
 *
 * Presence is checked by asking whether the file EXISTS, not by searching text for its
 * name. A content match flags every module that legitimately writes the index, the
 * architecture doc that explains it, and this very list; that is how the earlier gate
 * produced noise instead of signal.
 */
export const GENERATED_ARTIFACTS = [
  '.ziggurat/gold-index.json',
  '.ziggurat/review-index.json',
  '.ziggurat/evidence-index.json',
];

/**
 * Audits a set of text files for clean-room violations.
 * Returns findings per file and line; reports path, category, and line number.
 */
export async function auditCleanRoom(
  files: Array<{ path: string; content: string }>,
  projectNames: string[] = [],
  committedArtifacts: string[] = [],
  unscannableFiles: string[] = [],
): Promise<CleanRoomReport> {
  const findings: CleanRoomFinding[] = [];
  const projectNamePattern = buildProjectNamePattern(projectNames);
  const patterns = projectNamePattern === null
    ? FORBIDDEN_PATTERNS
    : [...FORBIDDEN_PATTERNS, { pattern: projectNamePattern, category: 'personal-project-name' }];

  for (const artifact of committedArtifacts) {
    findings.push({
      path: artifact,
      category: 'committed-index-artifact',
      line: 0,
      detail: `Generated retrieval state is present in the repository: ${artifact}`,
    });
  }

  for (const path of unscannableFiles) {
    findings.push({
      path,
      category: 'unscannable-file',
      line: 0,
      detail: `File is not valid UTF-8 text. Review it and add an explicit clean-room exclusion if it is safe: ${path}`,
    });
  }

  for (const file of files) {
    // Check for forbidden patterns
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (containsGitRemote(line)) {
        findings.push({
          path: file.path,
          category: 'git-remote',
          line: i + 1,
          detail: 'Line contains git-remote pattern',
        });
        continue;
      }
      for (const { pattern, category } of patterns) {
        if (pattern.test(line)) {
          findings.push({
            path: file.path,
            category,
            line: i + 1,
            detail: `Line contains ${category} pattern`,
          });
          break; // one finding per line per file
        }
      }
    }
  }

  return { pass: findings.length === 0, findings };
}
