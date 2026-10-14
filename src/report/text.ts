import type { Report } from "../runner/run.js";
import type { Status } from "../runner/types.js";

const MARK: Record<Status, string> = { PASS: "✓", FAIL: "✗", SKIP: "-", ERROR: "!" };

/** Human-readable summary for stdout. */
export function formatTextReport(report: Report): string {
  const lines: string[] = [];
  const impl = report.implementation;
  lines.push(`x402 conformance ${report.suiteVersion}  (spec ${report.specCommit.slice(0, 7)})`);
  lines.push(`Implementation: ${impl.name} (${impl.role}) at ${impl.url}`);
  lines.push("");

  for (const r of report.results) {
    const tag = r.advisory && r.status === "FAIL" ? "FAIL (advisory)" : r.status;
    lines.push(
      `${MARK[r.status]} ${r.testId}  ${tag.padEnd(15)} ${r.title}  [${r.severity}, ${r.durationMs}ms]`,
    );
    for (const a of r.assertions) {
      if (a.status === "PASS") continue;
      const level = a.level === "should" ? "should" : "must";
      lines.push(`    ${MARK[a.status]} ${a.id} (${level}): ${a.message ?? a.description}`);
    }
    if (r.skipReason) lines.push(`    skipped: ${r.skipReason}`);
    if (r.error) lines.push(`    error: ${r.error.message}`);
    if (r.warnings?.length) lines.push(`    ${r.warnings.length} warning(s) from should-level assertions`);
  }

  const s = report.summary;
  lines.push("");
  lines.push(
    `${s.total} test(s): ${s.pass} passed, ${s.fail} failed, ${s.advisoryFail} advisory failure(s), ` +
      `${s.skip} skipped, ${s.error} error(s)`,
  );
  return lines.join("\n");
}
