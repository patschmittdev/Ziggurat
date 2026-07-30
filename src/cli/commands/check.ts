import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CliIO } from '../main.js';
import { auditCleanRoom } from '../../eval/clean-room.js';
import { renderCleanRoomMarkdown } from '../../eval/report.js';

async function collectTextFiles(root: string): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  const dirs = ['src', 'test', 'fixtures', 'scripts', 'docs', 'config'];
  for (const dir of dirs) {
    const dirPath = join(root, dir);
    try {
      const entries = await readdir(dirPath);
      for (const entry of entries) {
        if (!entry.match(/\.(ts|js|mjs|md|yaml|yml|json)$/u)) continue;
        try {
          const content = await readFile(join(dirPath, entry), 'utf8');
          files.push({ path: `${dir}/${entry}`, content });
        } catch { continue; }
      }
    } catch { continue; }
  }
  return files;
}

export async function runCheck(root: string, json: boolean, io: CliIO): Promise<number> {
  const files = await collectTextFiles(root);
  const report = await auditCleanRoom(files);

  if (json) {
    io.stdout(JSON.stringify(report, null, 2) + '\n');
  } else {
    io.stdout(renderCleanRoomMarkdown(report) + '\n');
  }

  return report.pass ? 0 : 1;
}
