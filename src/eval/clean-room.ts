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
  { pattern: /(?:https?:\/\/)?(?:www\.)?github\.com\/[a-zA-Z0-9-]+\/[a-zA-Z0-9-]+(?:\.git)?/u, category: 'git-remote' },
  { pattern: /\bcastrum\b|\blegion\b|\blegate\b|\bchamber\b|\bdominion\b|\bgrimoire\b|\bmikoshi\b|\bcynosure\b|\bvault0\b|\bagentcore\b|\bchimera\b|\bgastown\b/iu, category: 'personal-project-name' },
];

const FORBIDDEN_FILES = ['.ziggurat/gold-index.json', '.ziggurat/review-index.json', '.ziggurat/evidence-index.json'];

/**
 * Audits a set of text files for clean-room violations.
 * Returns findings per file and line; reports path, category, and line number.
 */
export async function auditCleanRoom(
  files: Array<{ path: string; content: string }>,
): Promise<CleanRoomReport> {
  const findings: CleanRoomFinding[] = [];

  for (const file of files) {
    // Check for forbidden file paths in content
    for (const forbiddenFile of FORBIDDEN_FILES) {
      if (file.content.includes(forbiddenFile)) {
        const lines = file.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if ((lines[i] ?? '').includes(forbiddenFile)) {
            findings.push({
              path: file.path,
              category: 'index-artifact-reference',
              line: i + 1,
              detail: `References index artifact: ${forbiddenFile}`,
            });
          }
        }
      }
    }

    // Check for forbidden patterns
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      for (const { pattern, category } of FORBIDDEN_PATTERNS) {
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
