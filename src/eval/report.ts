import type { ConformanceReport } from './conformance.js';
import type { CleanRoomReport } from './clean-room.js';

/** Renders a ConformanceReport as Markdown. */
export function renderConformanceMarkdown(report: ConformanceReport): string {
  const status = report.pass ? 'PASS' : 'FAIL';
  const lines = [
    `# Conformance Report: ${status}`,
    '',
    `Cases: ${report.cases_run} | Passed: ${report.passed} | Failed: ${report.failed}`,
    '',
  ];

  for (const f of report.findings) {
    const icon = f.passed ? '✓' : '✗';
    lines.push(`${icon} ${f.case_id}: ${f.detail}`);
  }

  return lines.join('\n');
}

/** Renders a CleanRoomReport as Markdown. */
export function renderCleanRoomMarkdown(report: CleanRoomReport): string {
  const status = report.pass ? 'PASS' : 'FAIL';
  const lines = [
    `# Clean-Room Audit: ${status}`,
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const f of report.findings) {
      lines.push(`- ${f.path}:${f.line} [${f.category}] ${f.detail}`);
    }
  }

  return lines.join('\n');
}
