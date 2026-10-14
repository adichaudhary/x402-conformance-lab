#!/usr/bin/env node
import { Command, Option } from "commander";
import { join } from "node:path";
import { writeJsonReport } from "../report/json.js";
import { formatTextReport } from "../report/text.js";
import { loadCatalog } from "../runner/catalog.js";
import { ConfigError, loadConfig } from "../runner/config.js";
import { runTests } from "../runner/run.js";
import { SPEC_COMMIT, SUITE_VERSION } from "../version.js";

// Exit codes: 0 = no failures, 1 = at least one non-advisory FAIL, 2 = setup problem or ERROR result.
const EXIT_FAIL = 1;
const EXIT_SETUP = 2;

const program = new Command()
  .name("x402-conformance")
  .description(`Conformance tests for x402 V2 (spec ${SPEC_COMMIT.slice(0, 7)})`)
  .version(SUITE_VERSION);

program
  .command("run")
  .description("Run catalog tests against one implementation")
  .requiredOption("-c, --config <file>", "implementation config (see configs/implementations/)")
  .option(
    "-t, --test <id...>",
    "test ID(s) to run, for example SRV-01. Default: every test for the config's role",
  )
  .option("-o, --out <file>", "where to write the JSON report", "")
  .addOption(new Option("--no-json", "skip writing the JSON report"))
  .action(async (opts: { config: string; test?: string[]; out: string; json: boolean }) => {
    let config;
    try {
      config = loadConfig(opts.config);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(EXIT_SETUP);
    }

    const catalog = loadCatalog();
    if (catalog.issues.length > 0) {
      console.error("The test catalog has problems. Run npm run validate:catalog for details.");
      process.exit(EXIT_SETUP);
    }

    let tests = catalog.tests.filter((t) => t.role === config.role);
    if (opts.test) {
      const wanted = opts.test.map((id) => id.toUpperCase());
      const unknown = wanted.filter((id) => !catalog.tests.some((t) => t.id === id));
      if (unknown.length > 0) {
        console.error(`Unknown test ID(s): ${unknown.join(", ")}`);
        process.exit(EXIT_SETUP);
      }
      tests = catalog.tests.filter((t) => wanted.includes(t.id));
    }

    const report = await runTests(tests, config);
    console.log(formatTextReport(report));

    if (opts.json) {
      const stamp = report.startedAt.replace(/[:.]/g, "-");
      const out = opts.out || join("reports", `${config.name}-${stamp}.json`);
      writeJsonReport(report, out);
      console.log(`\nJSON report: ${out}`);
    }

    if (report.summary.fail > 0) process.exitCode = EXIT_FAIL;
    else if (report.summary.error > 0) process.exitCode = EXIT_SETUP;
  });

program.parseAsync().catch((err: unknown) => {
  if (err instanceof ConfigError) console.error(err.message);
  else console.error(err);
  process.exit(EXIT_SETUP);
});
