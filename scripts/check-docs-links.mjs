#!/usr/bin/env node
import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SITE_DOCS = join(ROOT, 'site/src/content/docs');
const REPO_BLOB = 'https://github.com/patschmittdev/Ziggurat/blob/main/';
const counts = { files: 0, links: 0, relative: 0, repository: 0, anchors: 0, sitePages: 0, failures: 0 };
const headingCache = new Map();
const scanned = new Set();
const queue = [
  'README.md', 'ARCHITECTURE.md', 'SECURITY.md', 'PRODUCT.md', 'DESIGN.md',
  'CONTRIBUTING.md', 'SUPPORT.md', 'CODE_OF_CONDUCT.md', '.github/copilot-instructions.md',
].map((file) => join(ROOT, file));

function decodeHtml(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, name) => {
    const lower = name.toLowerCase();
    if (lower.startsWith('#')) {
      const code = lower.startsWith('#x') ? parseInt(lower.slice(2), 16) : Number(lower.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[lower] ?? entity;
  });
}

function markdownWithoutCode(source) {
  let fence = '';
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/).map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length &&
            line.slice(marker[0].length).trim() === '') fence = '';
        return '';
      }
      if (marker) { fence = marker[1]; return ''; }
      return line;
    }).join('\n');
}

export function githubHeadingSlugs(source) {
  const slugs = new Set();
  const lines = markdownWithoutCode(source).split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    let heading = line.match(/^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/)?.[1];
    if (heading === undefined && line.trim() && !/^ {4}|^\t/.test(line) &&
        /^ {0,3}(?:=+|-+)[ \t]*$/.test(lines[index + 1] ?? '')) {
      heading = line.trim();
      index++;
    }
    if (heading === undefined) continue;
    const text = decodeHtml(heading.replace(/<[^>]*>/g, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'));
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-');
    let slug = base;
    for (let suffix = 1; slugs.has(slug); suffix++) slug = `${base}-${suffix}`;
    slugs.add(slug);
  }
  return slugs;
}

export function markdownLinks(source) {
  const links = [];
  const definitions = new Map();
  const label = (value) => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const text = markdownWithoutCode(source).replace(/(`+)[\s\S]*?\1(?!`)/g, ' ')
    .replace(/^ {0,3}\[([^\]]+)\]:[ \t]*(?:<([^>]+)>|(\S+)).*$/gm, (_, id, angle, bare) => {
      definitions.set(label(id), angle ?? bare);
      return '';
    });
  const withoutInlineLinks = text.replace(/!?\[(?:[^\[\]\\]|\\.|\[(?:[^\[\]\\]|\\.)*\])*\]\(\s*(?:<([^>\n]*)>|((?:[^\s()]|\([^()]*\))*))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g, (_, angle, bare) => {
    links.push(angle ?? bare);
    return '';
  });
  for (const match of withoutInlineLinks.matchAll(/!?\[([^\]\n]+)\](?:[ \t]*\[([^\]\n]*)\])?/g)) {
    const target = definitions.get(label(match[2] || match[1]));
    if (target !== undefined) links.push(target);
  }
  for (const match of withoutInlineLinks.matchAll(/<(https?:\/\/[^<>\s]+)>/gi)) links.push(match[1]);
  for (const match of withoutInlineLinks.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi)) {
    links.push(match[1] ?? match[2]);
  }
  return links.map((url) => decodeHtml(url.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, '$1')));
}

function fail(file, url, reason) {
  counts.failures++;
  console.error(`check-docs-links: ${relative(ROOT, file).split(sep).join('/')}: ${url}: ${reason}`);
}

function inside(directory, target) {
  const path = relative(directory, target);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

async function checkLink(raw, file) {
  if (!raw || raw === '#') return;
  const repository = raw.startsWith(REPO_BLOB);
  if (!repository && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) return;
  // Homepage links deliberately stay absolute because there is no Markdown target.
  if (inside(SITE_DOCS, file) && /^\/Ziggurat\/(?:#.*)?$/.test(raw)) return;
  counts.links++;
  counts[repository ? 'repository' : 'relative']++;
  try {
    let target;
    let fragment;
    if (repository) {
      const url = new URL(raw);
      target = resolve(ROOT, decodeURIComponent(url.pathname.slice('/patschmittdev/Ziggurat/blob/main/'.length)));
      fragment = decodeURIComponent(url.hash.slice(1));
    } else {
      if (raw.startsWith('/')) { fail(file, raw, 'root-absolute link does not resolve within the GitHub repository'); return; }
      const hash = raw.indexOf('#');
      const path = (hash === -1 ? raw : raw.slice(0, hash)).split('?')[0];
      target = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
      fragment = hash === -1 ? '' : decodeURIComponent(raw.slice(hash + 1));
    }
    if (!inside(ROOT, target)) { fail(file, raw, 'target escapes the repository'); return; }
    const info = await stat(target).catch(() => null);
    if (!info || (repository && !info.isFile())) { fail(file, raw, 'target does not exist as a repository path'); return; }
    if (fragment) {
      counts.anchors++;
      if (!info.isFile()) { fail(file, raw, 'heading target is not a file'); return; }
      if (!headingCache.has(target)) headingCache.set(target, githubHeadingSlugs(await readFile(target, 'utf8')));
      if (!headingCache.get(target).has(fragment)) fail(file, raw, `no matching GitHub heading for #${fragment}`);
    }
    if (info.isFile() && inside(SITE_DOCS, target) && /\.mdx?$/.test(target)) queue.push(target);
  } catch (error) {
    fail(file, raw, `cannot validate link: ${error.message}`);
  }
}

// Node resolves module URLs through symlinks, while argv can retain the alias.
const invokedPath = process.argv[1] ? await realpath(resolve(process.argv[1])).catch(error => {
  if (error.code === 'ENOENT') return undefined;
  throw error;
}) : undefined;

if (invokedPath !== undefined && invokedPath === await realpath(fileURLToPath(import.meta.url))) {
  try {
    for (const entry of await readdir(join(ROOT, 'docs'), { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) queue.push(join(ROOT, 'docs', entry.name));
    }
  } catch (error) {
    fail(join(ROOT, 'docs'), '(scan)', error.message);
  }
  for (let index = 0; index < queue.length; index++) {
    const file = queue[index];
    if (scanned.has(file)) continue;
    scanned.add(file);
    try {
      const source = await readFile(file, 'utf8');
      counts.files++;
      if (inside(SITE_DOCS, file)) counts.sitePages++;
      for (const url of markdownLinks(source)) await checkLink(url, file);
    } catch (error) {
      fail(file, '(scan)', error.message);
    }
  }
  console.log(`check-docs-links: ${counts.failures ? 'FAIL' : 'OK'}. ${counts.files} file(s) scanned; ${counts.links} link(s) checked (${counts.relative} relative, ${counts.repository} repository blob); ${counts.anchors} heading anchor(s); ${counts.sitePages} linked site page(s) scanned; ${counts.failures} failure(s).`);
  process.exitCode = counts.failures ? 1 : 0;
}
