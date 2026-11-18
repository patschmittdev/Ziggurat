export interface ConformanceCase {
  id: string;
  description: string;
  category: string;
}

export interface ConformanceFinding {
  case_id: string;
  passed: boolean;
  detail: string;
}

export interface ConformanceReport {
  pass: boolean;
  cases_run: number;
  passed: number;
  failed: number;
  findings: ConformanceFinding[];
}

/**
 * Runs a set of conformance cases and returns a deterministic report.
 * Cases and findings are sorted by ID.
 */
export async function runConformance(
  cases: Array<{ case: ConformanceCase; run: () => Promise<{ passed: boolean; detail: string }> }>,
): Promise<ConformanceReport> {
  const sortedCases = [...cases].sort((a, b) =>
    a.case.id < b.case.id ? -1 : a.case.id > b.case.id ? 1 : 0,
  );

  const findings: ConformanceFinding[] = [];
  for (const { case: c, run } of sortedCases) {
    const result = await run();
    findings.push({ case_id: c.id, passed: result.passed, detail: result.detail });
  }

  findings.sort((a, b) => a.case_id < b.case_id ? -1 : a.case_id > b.case_id ? 1 : 0);

  const passed = findings.filter(f => f.passed).length;
  return {
    pass: passed === findings.length,
    cases_run: findings.length,
    passed,
    failed: findings.length - passed,
    findings,
  };
}
