import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";

// ajv-formats ships CommonJS; under NodeNext the callable is on .default.
const addFormats = addFormatsModule as unknown as typeof addFormatsModule.default;

export const SCHEMA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "schemas");

const BASE_ID = "https://github.com/adichaudhary/x402-conformance-lab/schemas/";

export const X402_TYPES = [
  "PaymentRequired",
  "PaymentPayload",
  "SettlementResponse",
  "VerifyResponse",
  "SupportedResponse",
] as const;
export type X402Type = (typeof X402_TYPES)[number];

function loadJson(relPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, relPath), "utf8")) as Record<string, unknown>;
}

let ajvInstance: Ajv2020 | undefined;

/** One shared Ajv instance with every schema in schemas/ registered. */
export function getAjv(): Ajv2020 {
  if (ajvInstance) return ajvInstance;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
    allowUnionTypes: true,
  });
  addFormats(ajv);
  ajv.addSchema(loadJson("test-definition.schema.json"));
  ajv.addSchema(loadJson("test-result.schema.json"));
  ajv.addSchema(loadJson("report.schema.json"));
  ajv.addSchema(loadJson("implementation-config.schema.json"));
  ajv.addSchema(loadJson("x402/x402-v2.schema.json"));
  ajvInstance = ajv;
  return ajv;
}

function compiled(id: string): ValidateFunction {
  const fn = getAjv().getSchema(BASE_ID + id);
  if (!fn) throw new Error(`Schema not registered: ${id}`);
  return fn;
}

export const validators = {
  testDefinition: () => compiled("test-definition.schema.json"),
  testResult: () => compiled("test-result.schema.json"),
  report: () => compiled("report.schema.json"),
  implementationConfig: () => compiled("implementation-config.schema.json"),
  x402: (type: X402Type) => compiled(`x402/x402-v2.schema.json#/$defs/${type}`),
};

export function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
}
