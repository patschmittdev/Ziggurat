import assert from 'node:assert/strict';
import test from 'node:test';
import remarkRelativeMdLinks, { rewriteRelativeMdLink } from './remark-relative-md-links.mjs';

const file = { path: '/repo/site/src/content/docs/guides/current.md' };

test('rewrites sibling Markdown and MDX links', () => {
  assert.equal(rewriteRelativeMdLink('./next.md', file), '/Ziggurat/guides/next/');
  assert.equal(rewriteRelativeMdLink('./next.mdx', file), '/Ziggurat/guides/next/');
});

test('rewrites parent-directory links with Windows paths and history fallback', () => {
  const windowsPath = String.raw`C:\repo\site\src\content\docs\guides\current.md`;
  const url = '../concepts/tiers.md';
  assert.equal(rewriteRelativeMdLink(url, file), '/Ziggurat/concepts/tiers/');
  assert.equal(rewriteRelativeMdLink(url, { path: windowsPath }), '/Ziggurat/concepts/tiers/');
  assert.equal(rewriteRelativeMdLink(url, { history: [windowsPath] }), '/Ziggurat/concepts/tiers/');
  assert.equal(rewriteRelativeMdLink(url, {}), url);
});

test('preserves fragments and rewrites nested link nodes', () => {
  const url = '../concepts/tiers.md#gold-authorized-reference-admission';
  const expected = '/Ziggurat/concepts/tiers/#gold-authorized-reference-admission';
  assert.equal(rewriteRelativeMdLink(url, file), expected);
  const link = { type: 'link', url };
  remarkRelativeMdLinks()({ type: 'root', children: [{ type: 'paragraph', children: [link] }] }, file);
  assert.equal(link.url, expected);
});

test('rewrites reference-style definitions with the same URL rules', () => {
  const definition = { type: 'definition', identifier: 't', url: '../concepts/tiers.md#body_sha256' };
  const reference = { type: 'linkReference', identifier: 't' };
  const absolute = { type: 'definition', identifier: 'home', url: '/Ziggurat/' };
  const external = { type: 'definition', identifier: 'repo', url: 'https://github.com/patschmittdev/Ziggurat/blob/main/README.md' };
  remarkRelativeMdLinks()({ type: 'root', children: [reference, definition, absolute, external] }, file);
  assert.equal(definition.url, '/Ziggurat/concepts/tiers/#body_sha256');
  assert.deepEqual(reference, { type: 'linkReference', identifier: 't' });
  assert.equal(absolute.url, '/Ziggurat/');
  assert.equal(external.url, 'https://github.com/patschmittdev/Ziggurat/blob/main/README.md');
});

test('maps index files to directory routes', () => {
  assert.equal(rewriteRelativeMdLink('./index.md', file), '/Ziggurat/guides/');
  assert.equal(rewriteRelativeMdLink('../index.md', file), '/Ziggurat/');
  assert.equal(rewriteRelativeMdLink('../concepts/index.mdx#tiers', file), '/Ziggurat/concepts/#tiers');
});

test('leaves absolute links untouched', () => {
  for (const url of ['/Ziggurat/', '/Ziggurat/concepts/tiers/#gold-authorized-reference-admission']) {
    assert.equal(rewriteRelativeMdLink(url, file), url);
  }
});

test('leaves external links untouched', () => {
  const url = 'https://github.com/patschmittdev/Ziggurat/blob/main/README.md';
  assert.equal(rewriteRelativeMdLink(url, file), url);
});
