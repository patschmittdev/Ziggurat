#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const files = [
  'README.md', 'ARCHITECTURE.md', 'SECURITY.md', 'PRODUCT.md', 'DESIGN.md',
  'CONTRIBUTING.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md',
];

async function collect(directory, extensions) {
  const entries = await readdir(join(ROOT, directory), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(file, extensions);
    else if (entry.isFile() && extensions.includes(extname(entry.name))) files.push(file);
  }
}

await collect('docs', ['.md']);
await collect('site/src', ['.astro', '.md', '.mdx', '.css', '.ts']);
await collect('src', ['.ts']);

let hits = 0;
for (const file of files) {
  const lines = (await readFile(join(ROOT, file), 'utf8')).split(/\r?\n/);
  const markdown = ['.md', '.mdx'].includes(extname(file));
  let fenceLength = 0;
  for (const [index, line] of lines.entries()) {
    if (markdown) {
      const fence = line.match(/^ {0,3}(`{3,})(.*)$/);
      if (fenceLength) {
        if (fence && fence[1].length >= fenceLength && fence[2].trim() === '') {
          fenceLength = 0;
        }
        continue;
      }
      if (fence && !fence[2].includes('`')) {
        fenceLength = fence[1].length;
        continue;
      }
    }
    for (const match of line.matchAll(/[\u2014\u2013]/g)) {
      const codePoint = match[0].codePointAt(0).toString(16).toUpperCase();
      console.error(`${file}:${index + 1}: U+${codePoint} is not allowed`);
      hits++;
    }
  }
}

process.exitCode = hits ? 1 : 0;
