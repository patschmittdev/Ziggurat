import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as YAML from 'yaml';
import type { CliIO } from '../main.js';
import { CuratedPageSchema } from '../../contracts/index.js';
import { sha256Text } from '../../bronze/canonical.js';
import { buildGoldIndex } from '../../retrieval/gold-index.js';
import { buildReviewIndex, buildEvidenceIndex } from '../../retrieval/profile-index.js';
import type { CuratedPage } from '../../contracts/index.js';
import type { BronzeInput, CuratedInput } from '../../retrieval/profile-index.js';

interface BronzeSplit {
  frontmatter: string;
  body: string;
}

function splitBronzeFile(content: string): BronzeSplit | null {
  if (!content.startsWith('---\n')) return null;
  const afterOpen = content.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx === -1) return null;
  return { frontmatter: afterOpen.slice(0, closeIdx), body: afterOpen.slice(closeIdx + 5) };
}

function extractFrontmatter(content: string): string | null {
  if (!content.startsWith('---\n')) return null;
  const afterOpen = content.slice(4);
  const closeIdx = afterOpen.indexOf('\n---\n');
  if (closeIdx === -1) return null;
  return afterOpen.slice(0, closeIdx);
}

async function collectCuratedPages(root: string): Promise<CuratedInput[]> {
  const knowledgeDir = join(root, 'knowledge');
  const inputs: CuratedInput[] = [];
  let entries: string[];
  try {
    entries = await readdir(knowledgeDir);
  } catch {
    return inputs;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const relPath = `knowledge/${entry}`;
    try {
      const raw = await readFile(join(root, relPath), 'utf8');
      const content = raw.replace(/\r\n/g, '\n');
      const fm = extractFrontmatter(content);
      if (!fm) continue;
      const parsed = YAML.parse(fm) as unknown;
      const result = CuratedPageSchema.safeParse(parsed);
      if (!result.success) continue;
      const body = content.slice(content.indexOf('\n---\n', 4) + 5);
      inputs.push({ path: relPath, page: result.data, pageBody: body });
    } catch {
      continue;
    }
  }
  return inputs;
}

async function collectBronzeFiles(root: string): Promise<BronzeInput[]> {
  const bronzeDir = join(root, 'bronze');
  const inputs: BronzeInput[] = [];
  await walkBronzeDir(root, bronzeDir, inputs);
  return inputs;
}

async function walkBronzeDir(root: string, dir: string, inputs: BronzeInput[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkBronzeDir(root, fullPath, inputs);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        const relPath = fullPath.replace(/\\/g, '/').replace(root.replace(/\\/g, '/') + '/', '');
        const content = await readFile(fullPath, 'utf8');
        const split = splitBronzeFile(content.replace(/\r\n/g, '\n'));
        if (!split) continue;
        const sha = sha256Text(split.body);
        inputs.push({ path: relPath, sha256: sha, body: split.body });
      } catch {
        continue;
      }
    }
  }
}

export async function runBuild(root: string, json: boolean, io: CliIO): Promise<number> {
  const curated = await collectCuratedPages(root);
  const bronze = await collectBronzeFiles(root);

  const goldIndex = await buildGoldIndex(root, curated, { asOf: new Date() });
  const reviewIndex = await buildReviewIndex(root, { curated, bronze });
  const evidenceIndex = await buildEvidenceIndex(root, { curated, bronze });

  const result = {
    gold_chunks: goldIndex.chunks.length,
    review_chunks: reviewIndex.chunks.length,
    evidence_chunks: evidenceIndex.chunks.length,
    corpus_fingerprint: goldIndex.corpus_fingerprint,
  };

  if (json) {
    io.stdout(JSON.stringify(result, null, 2) + '\n');
  } else {
    io.stdout(`Built indexes:\n  Gold: ${result.gold_chunks} chunks\n  Review: ${result.review_chunks} chunks\n  Evidence: ${result.evidence_chunks} chunks\n  Fingerprint: ${result.corpus_fingerprint.slice(0, 16)}...\n`);
  }
  return 0;
}
