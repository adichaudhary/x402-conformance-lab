import { describe, expect, it } from "vitest";
import { formatCompatGrid } from "../../src/report/markdown.js";
import type { Report } from "../../src/runner/run.js";
import type { TestResult } from "../../src/runner/types.js";

const result = (testId: string, status: TestResult["status"], advisory = false): TestResult => ({
  testId,
  title: `Title ${testId}`,
  role: "server",
  severity: "high",
  advisory,
  status,
  durationMs: 1,
  startedAt: "2026-10-15T00:00:00.000Z",
  assertions: [],
});

const report = (name: string, results: TestResult[]): Report => ({
  suiteVersion: "0.0.1",
  specCommit: "e95b06661e1a2a8a9a21fce34cc28b9934834650",
  implementation: { name, role: "server", url: "http://x" },
  startedAt: "2026-10-15T00:00:00.000Z",
  finishedAt: "2026-10-15T00:00:01.000Z",
  summary: { total: results.length, pass: 0, fail: 0, skip: 0, error: 0, advisoryFail: 0 },
  results,
});

describe("compatibility grid", () => {
  it("has one row per test and one column per implementation", () => {
    const md = formatCompatGrid([
      report("zeta", [result("SRV-01", "PASS"), result("SRV-07", "FAIL", true)]),
      report("alpha", [result("SRV-01", "FAIL"), result("SRV-06", "SKIP")]),
    ]);
    const lines = md.split("\n");
    expect(lines[0]).toBe("| Test | alpha | zeta |");
    expect(md).toContain("| **SRV-01** Title SRV-01 | ❌ FAIL | ✅ PASS |");
    expect(md).toContain("| **SRV-06** Title SRV-06 | ➖ SKIP |  |");
    expect(md).toContain("| **SRV-07** Title SRV-07 |  | 🟡 FAIL (advisory) |");
  });

  it("handles no reports", () => {
    expect(formatCompatGrid([])).toContain("No reports found");
  });
});
