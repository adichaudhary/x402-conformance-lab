// Validates every tests/catalog/**/*.json file against schemas/test-definition.schema.json.
// Usage: npm run validate:catalog
import { relative } from "node:path";
import { loadCatalog } from "../src/runner/catalog.js";

const { tests, issues, fileCount } = loadCatalog();

if (fileCount === 0) {
  console.error("No catalog files found under tests/catalog/.");
  process.exit(1);
}

for (const issue of issues) {
  console.error(`✗ ${relative(process.cwd(), issue.file)}: ${issue.message}`);
}

if (issues.length > 0) {
  console.error(`\n${issues.length} problem(s) in ${fileCount} catalog file(s).`);
  process.exit(1);
}

for (const t of tests) console.log(`✓ ${t.id}  ${t.title}`);
console.log(`\n${tests.length} catalog file(s) valid.`);
