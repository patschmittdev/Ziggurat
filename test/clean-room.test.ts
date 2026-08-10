import assert from 'node:assert/strict';
import test from 'node:test';
import { auditCleanRoom } from '../src/eval/clean-room.js';
import { renderCleanRoomMarkdown } from '../src/eval/report.js';

test('auditCleanRoom: clean fictional corpus passes', async () => {
  const files = [
    { path: 'fixtures/garden/inbox/municipal-report.md', content: '# Municipal Report\n\nIrrigation systems in Millbrook.\n' },
    { path: 'fixtures/garden/inbox/vendor-study.md', content: '# Vendor Study\n\nEquipment comparison.\n' },
  ];
  const report = await auditCleanRoom(files);
  assert.equal(report.pass, true);
  assert.deepEqual(report.findings, []);
});

test('auditCleanRoom: detects Windows absolute path', async () => {
  const report = await auditCleanRoom([
    { path: 'test-file.md', content: 'Path: C:\\Users\\someone\\file.md\n' },
  ]);
  assert.equal(report.pass, false);
  assert(report.findings.some(f => f.category === 'windows-absolute-path'));
  assert.equal(report.findings[0]?.line, 1);
  assert.equal(report.findings[0]?.path, 'test-file.md');
});

test('auditCleanRoom: detects Unix absolute path', async () => {
  const report = await auditCleanRoom([
    { path: 'test-file.md', content: 'See /Users/example/projects/repo\n' },
  ]);
  assert.equal(report.pass, false);
  assert(report.findings.some(f => f.category === 'unix-absolute-path'));
});

test('auditCleanRoom: detects email address', async () => {
  const report = await auditCleanRoom([
    { path: 'test.md', content: 'contact: user@example.com\n' },
  ]);
  assert.equal(report.pass, false);
  assert(report.findings.some(f => f.category === 'email-address'));
});

test('auditCleanRoom: detects GitHub token', async () => {
  const report = await auditCleanRoom([
    { path: 'config.yaml', content: 'token: ghp_abcdefghijklmnopqrstuvwxyz\n' },
  ]);
  assert.equal(report.pass, false);
  assert(report.findings.some(f => f.category === 'github-token'));
});

test('auditCleanRoom: detects git remote', async () => {
  const report = await auditCleanRoom([
    { path: 'readme.md', content: 'origin https://github.com/patschmittdev/second-brain.git\n' },
  ]);
  assert.equal(report.pass, false);
  assert(report.findings.some(f => f.category === 'git-remote'));
});

test('auditCleanRoom: detects a configured project name', async () => {
  // Fictional terms only. Naming a real private project here would reintroduce exactly
  // the vocabulary the clean-room rule exists to keep out of this repository.
  const report = await auditCleanRoom(
    [{ path: 'notes.md', content: 'Working on Northwind today.\n' }],
    ['northwind', 'apollo'],
  );
  assert.equal(report.pass, false);
  assert(report.findings.some(f => f.category === 'personal-project-name'));
});

test('auditCleanRoom: reports no project-name findings when none are configured', async () => {
  const report = await auditCleanRoom([
    { path: 'notes.md', content: 'Working on Northwind today.\n' },
  ]);
  assert(!report.findings.some(f => f.category === 'personal-project-name'));
});

test('auditCleanRoom: project-name terms are matched whole-word and case-insensitively', async () => {
  const matched = await auditCleanRoom(
    [{ path: 'a.md', content: 'The APOLLO programme.\n' }],
    ['apollo'],
  );
  assert(matched.findings.some(f => f.category === 'personal-project-name'));

  const notMatched = await auditCleanRoom(
    [{ path: 'b.md', content: 'apollogetics is a different word.\n' }],
    ['apollo'],
  );
  assert(!notMatched.findings.some(f => f.category === 'personal-project-name'));
});

test('auditCleanRoom: regex metacharacters in a term are escaped, not interpreted', async () => {
  const report = await auditCleanRoom(
    [{ path: 'c.md', content: 'mentions a.b here\n' }],
    ['a.b'],
  );
  assert(report.findings.some(f => f.category === 'personal-project-name'));

  const literal = await auditCleanRoom(
    [{ path: 'd.md', content: 'mentions axb here\n' }],
    ['a.b'],
  );
  assert(!literal.findings.some(f => f.category === 'personal-project-name'));
});

test('auditCleanRoom: source that merely names an index path is not a finding', async () => {
  // The modules that write the index necessarily name it. Flagging that was noise; the
  // rule is about generated state being committed, which is an existence question.
  const report = await auditCleanRoom([
    { path: 'test.ts', content: 'const path = ".ziggurat/gold-index.json";\n' },
  ]);
  assert(!report.findings.some(f => f.category === 'committed-index-artifact'));
});

test('auditCleanRoom: a generated index present in the repo is a finding', async () => {
  const report = await auditCleanRoom([], [], ['.ziggurat/gold-index.json']);
  assert.equal(report.pass, false);
  assert(report.findings.some(f => f.category === 'committed-index-artifact'));
});

test('auditCleanRoom: reports correct line number', async () => {
  const report = await auditCleanRoom([
    { path: 'f.md', content: 'line one\nline two\nC:\\Users\\someone\\doc.txt\nline four\n' },
  ]);
  assert(report.findings.some(f => f.line === 3));
});

test('renderCleanRoomMarkdown: shows PASS when no findings', async () => {
  const report = await auditCleanRoom([{ path: 'ok.md', content: 'clean content\n' }]);
  const md = renderCleanRoomMarkdown(report);
  assert.match(md, /PASS/u);
  assert.match(md, /No findings/u);
});

test('renderCleanRoomMarkdown: shows FAIL with finding details', async () => {
  const report = await auditCleanRoom([
    { path: 'bad.md', content: 'path: C:\\Users\\someone\\file.txt\n' },
  ]);
  const md = renderCleanRoomMarkdown(report);
  assert.match(md, /FAIL/u);
  assert.match(md, /bad\.md/u);
});
