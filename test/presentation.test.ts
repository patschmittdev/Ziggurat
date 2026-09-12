import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inertText,
  safeJsonStringify,
} from '../src/presentation/inert.js';

test('inertText escapes terminal and bidi presentation controls', () => {
  const rendered = inertText('before\u001b[2Jmiddle\u009b31m\u202espoof\u2028after');
  assert(!rendered.includes('\u001b'));
  assert(!rendered.includes('\u009b'));
  assert(!rendered.includes('\u202e'));
  assert(!rendered.includes('\u2028'));
  assert(rendered.includes('\\u001b'));
  assert(rendered.includes('\\u009b'));
  assert(rendered.includes('\\u202e'));
  assert(rendered.includes('\\u2028'));
});

test('safeJsonStringify emits no literal terminal controls', () => {
  const rendered = safeJsonStringify({ value: '\u009b31mspoof' }, 2);
  assert(!rendered.includes('\u009b'));
  assert(rendered.includes('\\u009b'));
});

test('presentation normalization preserves Markdown text as data rather than claiming to sanitize Markdown', () => {
  const markdown = '![image](https://invalid.example/pixel)\n```\n<img src="x">\n> instruction';
  assert.equal(inertText(markdown), markdown);
  // Review packets must additionally wrap this output in blank-delimited indented
  // literals; quotes or terminal escaping alone do not neutralize Markdown.
  assert.equal(JSON.parse(safeJsonStringify({ markdown })).markdown, markdown);
});
