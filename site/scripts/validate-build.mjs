#!/usr/bin/env node
/**
 * Deterministic validation of the built documentation site.
 *
 * Astro and Starlight prefix their own generated navigation with the configured base,
 * but hand-authored Markdown and template links are emitted verbatim. A root-relative
 * link that omits `/Ziggurat/` therefore builds cleanly and 404s in production. This
 * script fails the build instead.
 *
 * Checks, all against the built output rather than the sources:
 *   1. every root-relative URL begins with the configured base path
 *   2. every internal link resolves to a real file in dist/
 *   3. every fragment resolves to an id in the target document
 *   4. every referenced asset exists, including root-relative url() in built CSS
 *   5. page headings, metadata, language, resource URLs, and new-tab links are valid
 *   6. repository blob links resolve to local files and Markdown heading anchors
 *
 * Uses only Node built-ins. No network access, no dependency, no heuristics.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_ROOT = resolve(SITE_ROOT, '..');
const DIST = join(SITE_ROOT, 'dist');
const BASE = '/Ziggurat';
const ORIGIN = 'https://patschmittdev.github.io';
const REPO_BLOB = 'https://github.com/patschmittdev/Ziggurat/blob/main/';

/** Schemes that leave the site and are not this script's business. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** @typedef {{ file: string; url: string; reason: string }} Problem */

/** @type {Problem[]} */
const problems = [];

/** @type {Map<string, Set<string>>} distRelativePath -> ids in that document */
const idCache = new Map();

const counts = { h1: 0, description: 0, canonical: 0, lang: 0, httpPages: 0, resources: 0, insecure: 0, noopener: 0, repositoryLinks: 0, repositoryAnchors: 0 };
/** @type {Map<string, Set<string>>} */
const headingCache = new Map();

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

function githubHeadingSlugs(source) {
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
    const base = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M} -]/gu, '').replace(/ /g, '-');
    let slug = base;
    for (let suffix = 1; slugs.has(slug); suffix++) slug = `${base}-${suffix}`;
    slugs.add(slug);
  }
  return slugs;
}

function attributes(tag) {
  /** @type {Record<string, string>} */
  const result = {};
  for (const match of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function checkResource(raw, file) {
  if (!raw.trim()) return;
  counts.resources++;
  if (/^http:\/\//i.test(raw.trim())) {
    counts.insecure++;
    problems.push({ file, url: raw, reason: 'resource URL must not use http://' });
  }
}

function checkCssResources(css, file) {
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/gi)) {
    checkResource(match[1] ?? match[2], file);
  }
}

async function checkRepositoryLink(raw, file) {
  if (!raw.startsWith(REPO_BLOB)) return;
  counts.repositoryLinks++;
  try {
    const url = new URL(raw);
    const path = decodeURIComponent(url.pathname.slice('/patschmittdev/Ziggurat/blob/main/'.length));
    const target = resolve(REPO_ROOT, path);
    const repoRelative = relative(REPO_ROOT, target);
    if (!repoRelative || isAbsolute(repoRelative) || repoRelative === '..' || repoRelative.startsWith(`..${sep}`) ||
        !(await exists(target))) {
      problems.push({ file, url: raw, reason: 'repository blob target is not a file inside the repository' });
      return;
    }
    if (!url.hash) return;
    counts.repositoryAnchors++;
    if (!headingCache.has(target)) headingCache.set(target, githubHeadingSlugs(await readFile(target, 'utf8')));
    const fragment = decodeURIComponent(url.hash.slice(1));
    if (!headingCache.get(target)?.has(fragment)) {
      problems.push({ file, url: raw, reason: `fragment #${fragment} has no matching GitHub heading in ${repoRelative}` });
    }
  } catch (error) {
    problems.push({ file, url: raw, reason: `cannot validate repository link: ${error.message}` });
  }
}

async function checkPageRequirements(html, file) {
  const markup = html.replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(<(script|style)\b[^>]*>)[\s\S]*?<\/\2\s*>/gi, '$1');
  const tags = [...markup.matchAll(/<([a-z][a-z0-9:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)]
    .map((match) => ({ name: match[1].toLowerCase(), attrs: attributes(match[2]) }));
  const h1 = tags.filter((tag) => tag.name === 'h1').length;
  counts.h1++;
  counts.description++;
  counts.canonical++;
  counts.lang++;
  counts.httpPages++;
  const fail = (reason) => problems.push({ file, url: pageUrlFor(file), reason });
  if (h1 !== 1) fail(`expected exactly one h1; found ${h1}`);
  if (!tags.some(({ name, attrs }) => name === 'meta' && attrs.name?.toLowerCase() === 'description' && attrs.content?.trim())) {
    fail('missing non-empty meta description');
  }
  if (!tags.some(({ name, attrs }) => name === 'link' && attrs.rel?.toLowerCase().split(/\s+/).includes('canonical') && attrs.href?.trim())) {
    fail('missing canonical link');
  }
  if (!tags.some(({ name, attrs }) => name === 'html' && attrs.lang === 'en')) fail('html must declare lang="en"');

  for (const { name, attrs } of tags) {
    if (name === 'a') {
      if (attrs.target?.toLowerCase() === '_blank') {
        counts.noopener++;
        if (!attrs.rel?.toLowerCase().split(/\s+/).includes('noopener')) {
          problems.push({ file, url: attrs.href ?? '(no href)', reason: 'target="_blank" link must include rel="noopener"' });
        }
      }
      if (attrs.href) await checkRepositoryLink(attrs.href, file);
    }
    for (const attribute of ['src', 'poster']) {
      if (attrs[attribute]) checkResource(attrs[attribute], file);
    }
    if (name === 'object' && attrs.data) checkResource(attrs.data, file);
    if (['link', 'image', 'use'].includes(name)) {
      for (const attribute of ['href', 'xlink:href']) if (attrs[attribute]) checkResource(attrs[attribute], file);
    }
    if (attrs.srcset) {
      for (const candidate of attrs.srcset.split(',')) checkResource(candidate.trim().split(/\s+/)[0], file);
    }
    if (name === 'meta' && /^(?:og:(?:image|video|audio)(?::url|:secure_url)?|twitter:image)$/i.test(attrs.property ?? attrs.name ?? '') && attrs.content) {
      checkResource(attrs.content, file);
    }
    if (attrs.style) checkCssResources(attrs.style, file);
  }
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)) checkCssResources(match[1], file);
}

async function walk(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else found.push(full);
  }
  return found;
}

async function exists(path) {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a site-absolute URL path to a file inside dist/.
 * Returns the dist-relative path, or null when nothing serves that URL.
 */
async function resolveToFile(urlPath) {
  const withoutBase = urlPath.slice(BASE.length) || '/';
  const clean = decodeURIComponent(withoutBase);
  const candidates = clean.endsWith('/')
    ? [posix.join(clean, 'index.html')]
    : [clean, `${clean}/index.html`, `${clean}.html`];

  for (const candidate of candidates) {
    const rel = candidate.replace(/^\//, '');
    if (rel !== '' && (await exists(join(DIST, rel)))) return rel;
  }
  return null;
}

async function idsFor(distRelative) {
  const cached = idCache.get(distRelative);
  if (cached) return cached;

  const html = await readFile(join(DIST, distRelative), 'utf8');
  /** @type {Set<string>} */
  const ids = new Set();
  for (const match of html.matchAll(/\sid="([^"]+)"/g)) {
    const value = match[1];
    if (value) ids.add(value);
  }
  for (const match of html.matchAll(/\sname="([^"]+)"/g)) {
    const value = match[1];
    if (value) ids.add(value);
  }
  idCache.set(distRelative, ids);
  return ids;
}

/** Turn a link found on `pageUrl` into a site-absolute URL path, or null to skip it. */
function toAbsolute(raw, pageUrl, file) {
  const url = raw.trim();
  if (url === '' || url === '#') return null;
  if (EXTERNAL.test(url)) return null;

  if (url.startsWith('/')) {
    if (!url.startsWith(`${BASE}/`) && url !== BASE) {
      problems.push({
        file,
        url,
        reason: `root-relative URL escapes the base path; it must start with ${BASE}/`,
      });
      return null;
    }
    return url;
  }

  if (url.startsWith('#')) return `${pageUrl}${url}`;

  // Relative: resolve against the directory the page is served from.
  const dir = pageUrl.endsWith('/') ? pageUrl : posix.dirname(pageUrl) + '/';
  const resolved = posix.normalize(posix.join(dir, url));
  if (!resolved.startsWith(`${BASE}/`) && resolved !== BASE) {
    problems.push({
      file,
      url,
      reason: `relative URL resolves to ${resolved}, which escapes ${BASE}/`,
    });
    return null;
  }
  return resolved;
}

async function checkUrl(absolute, file) {
  const [pathPart, fragment] = absolute.split('#');
  if (!pathPart) return;

  const target = await resolveToFile(pathPart);
  if (target === null) {
    problems.push({ file, url: absolute, reason: 'no file in dist/ serves this URL' });
    return;
  }

  if (fragment === undefined || fragment === '') return;
  if (!target.endsWith('.html')) return;

  const ids = await idsFor(target);
  if (!ids.has(fragment)) {
    problems.push({
      file,
      url: absolute,
      reason: `fragment #${fragment} has no matching id in ${target}`,
    });
  }
}

/** The URL an HTML file is served at, given its path inside dist/. */
function pageUrlFor(distRelative) {
  const asPosix = distRelative.split(sep).join('/');
  if (asPosix === 'index.html') return `${BASE}/`;
  if (asPosix.endsWith('/index.html')) return `${BASE}/${asPosix.slice(0, -'index.html'.length)}`;
  return `${BASE}/${asPosix}`;
}

/**
 * Absolute URLs pointing back at this site still have to resolve.
 *
 * Social-preview and canonical URLs live in `content` attributes rather than href/src,
 * and they name the production origin rather than a site-relative path, so the ordinary
 * link pass skips them. A missing og:image builds and validates cleanly and then serves
 * a broken card, which is exactly the failure this project should not ship.
 */
async function checkSelfReferencingMeta(html, distRelative) {
  const pattern = new RegExp(`content="${ORIGIN.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}([^"]*)"`, 'g');
  for (const match of html.matchAll(pattern)) {
    const path = match[1];
    if (path === undefined || path === '') continue;
    const [pathPart] = path.split('#');
    if (pathPart === undefined || !pathPart.startsWith(`${BASE}/`)) {
      problems.push({
        file: distRelative,
        url: `${ORIGIN}${path}`,
        reason: `absolute site URL does not start with ${BASE}/`,
      });
      continue;
    }
    if ((await resolveToFile(pathPart)) === null) {
      problems.push({
        file: distRelative,
        url: `${ORIGIN}${path}`,
        reason: 'no file in dist/ serves this absolute site URL',
      });
    }
  }
}

async function checkHtml(file) {
  const distRelative = relative(DIST, file);
  const pageUrl = pageUrlFor(distRelative);
  const html = await readFile(file, 'utf8');

  await checkPageRequirements(html, distRelative);

  /** @type {Set<string>} */
  const seen = new Set();
  for (const match of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const raw = match[1];
    if (raw === undefined || seen.has(raw)) continue;
    seen.add(raw);
    const absolute = toAbsolute(raw, pageUrl, distRelative);
    if (absolute !== null) await checkUrl(absolute, distRelative);
  }

  // The 404 page's own canonical and og:url describe a route that deliberately has no
  // file: the host serves 404.html for unmatched paths. Its links are still checked,
  // and every other page carries the same og:image, so coverage is unaffected.
  if (distRelative.split(sep).join('/') !== '404.html') {
    await checkSelfReferencingMeta(html, distRelative);
  }
}

async function checkCss(file) {
  const distRelative = relative(DIST, file);
  const css = await readFile(file, 'utf8');
  checkCssResources(css, distRelative);
  /** @type {Set<string>} */
  const seen = new Set();
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
    const raw = match[1]?.trim();
    if (raw === undefined || raw === '' || seen.has(raw)) continue;
    seen.add(raw);
    if (EXTERNAL.test(raw) || raw.startsWith('data:')) continue;
    if (!raw.startsWith('/')) continue;
    if (!raw.startsWith(`${BASE}/`)) {
      problems.push({
        file: distRelative,
        url: raw,
        reason: `CSS url() escapes the base path; it must start with ${BASE}/`,
      });
      continue;
    }
    if ((await resolveToFile(raw)) === null) {
      problems.push({ file: distRelative, url: raw, reason: 'CSS url() asset is missing' });
    }
  }
}

async function main() {
  if (!(await stat(DIST).catch(() => null))) {
    console.error(`validate-build: ${DIST} does not exist. Run "npm run build" first.`);
    process.exit(1);
  }

  const files = await walk(DIST);
  const html = files.filter((f) => f.endsWith('.html'));
  const css = files.filter((f) => f.endsWith('.css'));

  if (html.length === 0) {
    console.error('validate-build: no HTML files found in dist/.');
    process.exit(1);
  }

  for (const file of html) await checkHtml(file);
  for (const file of css) await checkCss(file);

  const checkedLinks = idCache.size;
  if (problems.length > 0) {
    console.error(`validate-build: ${problems.length} problem(s) found.\n`);
    for (const problem of problems) {
      console.error(`  ${problem.file}`);
      console.error(`    ${problem.url}`);
      console.error(`      ${problem.reason}\n`);
    }
    process.exit(1);
  }

  console.log(
    `validate-build: OK. ${html.length} page(s) and ${css.length} stylesheet(s) checked; ` +
      `${checkedLinks} document(s) scanned for heading targets; ` +
      `every internal link, fragment, and asset resolves under ${BASE}/; ` +
      `h1 ${counts.h1}, description ${counts.description}, canonical ${counts.canonical}, lang ${counts.lang}, ` +
      `http-resource pages ${counts.httpPages}, resource URLs ${counts.resources}, insecure resources ${counts.insecure}, ` +
      `noopener links ${counts.noopener}, outbound repository links ${counts.repositoryLinks}, repository anchors ${counts.repositoryAnchors}.`,
  );
}

await main();
