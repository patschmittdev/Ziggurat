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
 *
 * Uses only Node built-ins. No network access, no dependency, no heuristics.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = join(SITE_ROOT, 'dist');
const BASE = '/Ziggurat';
const ORIGIN = 'https://patschmittdev.github.io';

/** Schemes that leave the site and are not this script's business. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/** @typedef {{ file: string; url: string; reason: string }} Problem */

/** @type {Problem[]} */
const problems = [];

/** @type {Map<string, Set<string>>} distRelativePath -> ids in that document */
const idCache = new Map();

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
      `every internal link, fragment, and asset resolves under ${BASE}/.`,
  );
}

await main();
