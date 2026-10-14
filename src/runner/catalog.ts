import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatErrors, validators } from "./schemas.js";
import type { TestDefinition } from "./types.js";

export const CATALOG_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "tests", "catalog");

const ROLE_DIRS = { server: "server", facilitator: "facilitator", client: "client" } as const;

export interface CatalogIssue {
  file: string;
  message: string;
}

export interface CatalogLoadResult {
  tests: TestDefinition[];
  issues: CatalogIssue[];
  fileCount: number;
}

function listJsonFiles(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Checks the schema can't express: file name matches id, folder matches role,
 * ids are unique, and assertion step references point at real steps.
 */
function crossChecks(file: string, folderRole: string, def: TestDefinition): string[] {
  const problems: string[] = [];
  if (basename(file, ".json") !== def.id) {
    problems.push(`file name should be ${def.id}.json`);
  }
  if (def.role !== folderRole) {
    problems.push(`role "${def.role}" does not match folder "${folderRole}"`);
  }
  const stepIds = new Set(def.input.steps.map((s) => s.id));
  if (stepIds.size !== def.input.steps.length) problems.push("step ids must be unique");
  const assertionIds = new Set<string>();
  for (const a of def.assertions) {
    if (assertionIds.has(a.id)) problems.push(`duplicate assertion id "${a.id}"`);
    assertionIds.add(a.id);
    if (a.step && !stepIds.has(a.step)) {
      problems.push(`assertion "${a.id}" refers to unknown step "${a.step}"`);
    }
  }
  for (const s of def.input.steps) {
    if (s.payment.mode === "replay" && s.payment.replayOf && !stepIds.has(s.payment.replayOf)) {
      problems.push(`step "${s.id}" replays unknown step "${s.payment.replayOf}"`);
    }
  }
  return problems;
}

export function loadCatalog(catalogDir: string = CATALOG_DIR): CatalogLoadResult {
  const validate = validators.testDefinition();
  const tests: TestDefinition[] = [];
  const issues: CatalogIssue[] = [];
  const seen = new Map<string, string>();
  let fileCount = 0;

  for (const role of Object.values(ROLE_DIRS)) {
    for (const file of listJsonFiles(join(catalogDir, role))) {
      fileCount++;
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(file, "utf8"));
      } catch (err) {
        issues.push({ file, message: `invalid JSON: ${(err as Error).message}` });
        continue;
      }
      if (!validate(data)) {
        for (const message of formatErrors(validate.errors)) issues.push({ file, message });
        continue;
      }
      const def = data as TestDefinition;
      for (const message of crossChecks(file, role, def)) issues.push({ file, message });
      const prior = seen.get(def.id);
      if (prior) issues.push({ file, message: `id ${def.id} already used by ${prior}` });
      seen.set(def.id, file);
      tests.push(def);
    }
  }
  return { tests, issues, fileCount };
}
