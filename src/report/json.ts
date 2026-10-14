import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { formatErrors, validators } from "../runner/schemas.js";
import type { Report } from "../runner/run.js";

/** Checks the report against schemas/report.schema.json. Returns the problems, empty if valid. */
export function validateReport(report: Report): string[] {
  const validate = validators.report();
  return validate(report) ? [] : formatErrors(validate.errors);
}

export function writeJsonReport(report: Report, path: string): void {
  const problems = validateReport(report);
  if (problems.length > 0) {
    // A bug in the suite, not the implementation. Fail loudly.
    throw new Error(`Report does not match report.schema.json:\n  ${problems.join("\n  ")}`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
}
