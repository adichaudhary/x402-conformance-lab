import { readFileSync } from "node:fs";
import { formatErrors, validators } from "./schemas.js";
import type { Role } from "./types.js";

// Mirrors schemas/implementation-config.schema.json.
export interface ImplementationConfig {
  name: string;
  displayName?: string;
  version?: string;
  role: Role;
  url: string;
  resource?: {
    path: string;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
    paidContentMarker?: string;
  };
  features: string[];
  wallet?: { privateKeyEnv: string };
  requestTimeoutMs?: number;
  notes?: string;
}

export class ConfigError extends Error {}

export function parseConfig(data: unknown, source = "config"): ImplementationConfig {
  const validate = validators.implementationConfig();
  if (!validate(data)) {
    throw new ConfigError(`${source} is invalid:\n  ${formatErrors(validate.errors).join("\n  ")}`);
  }
  return data as ImplementationConfig;
}

export function loadConfig(path: string): ImplementationConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new ConfigError(`Cannot read config ${path}: ${(err as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new ConfigError(`Config ${path} is not valid JSON: ${(err as Error).message}`);
  }
  return parseConfig(data, path);
}

/**
 * Returns the feature flags a test requires that the config doesn't declare.
 * A more specific declared flag satisfies a general requirement: declaring
 * "network:eip155:31337" satisfies "network:eip155". The reverse does not hold.
 */
export function missingFeatures(requires: string[], features: string[]): string[] {
  return requires.filter((req) => !features.some((f) => f === req || f.startsWith(req + ":")));
}
