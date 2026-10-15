import type { Report } from "../runner/run.js";
import type { TestResult } from "../runner/types.js";

function cell(r: TestResult | undefined): string {
  if (!r) return "";
  switch (r.status) {
    case "PASS":
      return r.warnings?.length ? "✅ PASS ⚠️" : "✅ PASS";
    case "FAIL":
      return r.advisory ? "🟡 FAIL (advisory)" : "❌ FAIL";
    case "SKIP":
      return "➖ SKIP";
    case "ERROR":
      return "❗ ERROR";
  }
}

/**
 * Compatibility grid: one row per test, one column per implementation.
 * Used for the scheduled conformance run's job summary.
 */
export function formatCompatGrid(reports: Report[]): string {
  if (reports.length === 0) return "_No reports found._\n";
  const sorted = [...reports].sort((a, b) => a.implementation.name.localeCompare(b.implementation.name));
  const testIds = [...new Set(sorted.flatMap((r) => r.results.map((t) => t.testId)))].sort();
  const titles = new Map(sorted.flatMap((r) => r.results.map((t) => [t.testId, t.title] as const)));

  const lines: string[] = [];
  lines.push(`| Test | ${sorted.map((r) => r.implementation.name).join(" | ")} |`);
  lines.push(`| --- | ${sorted.map(() => "---").join(" | ")} |`);
  for (const id of testIds) {
    const cells = sorted.map((r) => cell(r.results.find((t) => t.testId === id)));
    lines.push(`| **${id}** ${titles.get(id) ?? ""} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  for (const r of sorted) {
    const s = r.summary;
    lines.push(
      `- **${r.implementation.name}**: ${s.pass} pass, ${s.fail} fail, ${s.advisoryFail} advisory fail, ` +
        `${s.skip} skip, ${s.error} error`,
    );
  }
  lines.push("");
  lines.push(
    `Spec \`${sorted[0]!.specCommit.slice(0, 7)}\`, suite ${sorted[0]!.suiteVersion}. ` +
      "ERROR means our setup could not run the test (for example, payment signing is not built yet). " +
      "It does not count against the implementation.",
  );
  return lines.join("\n") + "\n";
}
