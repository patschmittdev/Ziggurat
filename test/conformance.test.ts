import assert from 'node:assert/strict';
import test from 'node:test';
import { runConformance } from '../src/eval/conformance.js';
import { renderConformanceMarkdown } from '../src/eval/report.js';

test('runConformance: reports all passed when all cases pass', async () => {
  const report = await runConformance([
    { case: { id: 'A', description: 'test', category: 'x' }, run: async () => ({ passed: true, detail: 'ok' }) },
    { case: { id: 'B', description: 'test', category: 'x' }, run: async () => ({ passed: true, detail: 'ok' }) },
  ]);
  assert.equal(report.pass, true);
  assert.equal(report.passed, 2);
  assert.equal(report.failed, 0);
});

test('runConformance: reports fail when any case fails', async () => {
  const report = await runConformance([
    { case: { id: 'A', description: 'pass', category: 'x' }, run: async () => ({ passed: true, detail: 'ok' }) },
    { case: { id: 'B', description: 'fail', category: 'x' }, run: async () => ({ passed: false, detail: 'wrong' }) },
  ]);
  assert.equal(report.pass, false);
  assert.equal(report.failed, 1);
});

test('runConformance: findings are sorted by case ID', async () => {
  const report = await runConformance([
    { case: { id: 'Z', description: 'last', category: 'x' }, run: async () => ({ passed: true, detail: '' }) },
    { case: { id: 'A', description: 'first', category: 'x' }, run: async () => ({ passed: true, detail: '' }) },
  ]);
  assert.equal(report.findings[0]?.case_id, 'A');
  assert.equal(report.findings[1]?.case_id, 'Z');
});

test('renderConformanceMarkdown: shows PASS or FAIL status', async () => {
  const report = await runConformance([
    { case: { id: 'A', description: 'x', category: 'y' }, run: async () => ({ passed: true, detail: 'ok' }) },
  ]);
  const md = renderConformanceMarkdown(report);
  assert.match(md, /PASS/u);
});
