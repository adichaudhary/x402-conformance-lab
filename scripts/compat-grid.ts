// Builds the compatibility grid from a folder of JSON reports.
// Usage: npm run grid -- <reports-dir> [output.md]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateReport } from "../src/report/json.js";
import { formatCompatGrid } from "../src/report/markdown.js";
import type { Report } from "../src/runner/run.js";

const [dir = "reports", out] = process.argv.slice(2);

function findJson(d: string): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? findJson(join(d, e.name)) : e.name.endsWith(".json") ? [join(d, e.name)] : [],
  );
}

const reports: Report[] = [];
for (const file of findJson(dir)) {
  const data = JSON.parse(readFileSync(file, "utf8")) as Report;
  const problems = validateReport(data);
  if (problems.length > 0) {
    console.error(`Skipping ${file}: not a valid report (${problems[0]})`);
    continue;
  }
  reports.push(data);
}

// Keep only the newest report per implementation.
const latest = new Map<string, Report>();
for (const r of reports) {
  const prior = latest.get(r.implementation.name);
  if (!prior || r.startedAt > prior.startedAt) latest.set(r.implementation.name, r);
}

const md = formatCompatGrid([...latest.values()]);
if (out) writeFileSync(out, md);
console.log(md);
