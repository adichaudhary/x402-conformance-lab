import { formatErrors, validators } from "./schemas.js";
import type { Expectation } from "./types.js";

export interface Check {
  ok: boolean;
  message?: string;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** RFC 6901 JSON Pointer lookup. Returns { found: false } if any segment is missing. */
export function getPointer(value: unknown, pointer: string): { found: boolean; value?: unknown } {
  if (pointer === "") return { found: true, value };
  let current: unknown = value;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (current === null || typeof current !== "object" || !(key in (current as object))) {
      return { found: false };
    }
    current = (current as Record<string, unknown>)[key];
  }
  return { found: true, value: current };
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Decodes an x402 header: base64 (standard alphabet) of a UTF-8 JSON document. */
export function decodeBase64Json(
  header: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = header.trim();
  if (trimmed.length === 0 || trimmed.length % 4 !== 0 || !BASE64.test(trimmed)) {
    return { ok: false, error: "header is not valid base64" };
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.from(trimmed, "base64").toString("utf8")) };
  } catch {
    return { ok: false, error: "header base64-decodes to something that is not JSON" };
  }
}

const show = (v: unknown) => JSON.stringify(v);

/** Every comparison listed in the expectation must hold. */
export function evaluateExpectation(actual: unknown, expect: Expectation): Check {
  const failures: string[] = [];
  if ("equals" in expect && !deepEqual(actual, expect.equals)) {
    failures.push(`expected ${show(expect.equals)}, got ${show(actual)}`);
  }
  if ("notEquals" in expect && deepEqual(actual, expect.notEquals)) {
    failures.push(`expected anything but ${show(expect.notEquals)}`);
  }
  if (expect.oneOf && !expect.oneOf.some((v) => deepEqual(actual, v))) {
    failures.push(`expected one of ${show(expect.oneOf)}, got ${show(actual)}`);
  }
  if (expect.notOneOf && expect.notOneOf.some((v) => deepEqual(actual, v))) {
    failures.push(`expected none of ${show(expect.notOneOf)}, got ${show(actual)}`);
  }
  if (expect.min !== undefined && !(typeof actual === "number" && actual >= expect.min)) {
    failures.push(`expected >= ${expect.min}, got ${show(actual)}`);
  }
  if (expect.max !== undefined && !(typeof actual === "number" && actual <= expect.max)) {
    failures.push(`expected <= ${expect.max}, got ${show(actual)}`);
  }
  if (
    expect.pattern !== undefined &&
    !(typeof actual === "string" && new RegExp(expect.pattern).test(actual))
  ) {
    failures.push(`expected to match /${expect.pattern}/, got ${show(actual)}`);
  }
  if (expect.matchesSchema) {
    const validate = validators.x402(expect.matchesSchema);
    if (!validate(actual)) {
      failures.push(`not a valid ${expect.matchesSchema}: ${formatErrors(validate.errors).join("; ")}`);
    }
  }
  return failures.length === 0 ? { ok: true } : { ok: false, message: failures.join(". ") };
}
