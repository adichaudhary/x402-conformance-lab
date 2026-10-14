import type { ImplementationConfig } from "./config.js";
import { decodeBase64Json, evaluateExpectation, getPointer, type Check } from "./expect.js";
import type { Assertion, AssertionResult, BodyAssertion, HeaderAssertion } from "./types.js";

/** What we recorded for one step. Header names are lower-cased. */
export interface StepResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

class NotEvaluable extends Error {}

function checkHeader(a: HeaderAssertion, res: StepResponse): Check {
  const raw = res.headers[a.name.toLowerCase()];
  if (raw === undefined) {
    if (a.present === true) return { ok: false, message: `${a.name} header is missing` };
    if (a.passIfAbsent || a.present === false) return { ok: true, message: `${a.name} absent` };
    if (a.expect) return { ok: false, message: `${a.name} header is missing` };
    return { ok: true };
  }
  if (a.present === false) return { ok: false, message: `${a.name} header is present but should not be` };
  if (!a.expect) return { ok: true };

  let value: unknown = raw;
  if (a.decode === "base64json") {
    const decoded = decodeBase64Json(raw);
    if (!decoded.ok) return { ok: false, message: `${a.name}: ${decoded.error}` };
    value = decoded.value;
  }
  if (a.path !== undefined) {
    const found = getPointer(value, a.path);
    if (!found.found) {
      return a.passIfAbsent ? { ok: true } : { ok: false, message: `${a.name} has no value at ${a.path}` };
    }
    value = found.value;
  }
  return evaluateExpectation(value, a.expect);
}

function checkBody(a: BodyAssertion, res: StepResponse, config: ImplementationConfig): Check {
  if (a.check === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      return { ok: false, message: "body is not JSON" };
    }
    const found = a.path ? getPointer(parsed, a.path) : { found: true, value: parsed };
    if (!found.found) return { ok: false, message: `body has no value at ${a.path}` };
    return a.expect ? evaluateExpectation(found.value, a.expect) : { ok: true };
  }
  const marker = config.resource?.paidContentMarker;
  if (!marker) {
    throw new NotEvaluable("config has no resource.paidContentMarker, so paid content can't be detected");
  }
  const present = res.body.includes(marker);
  if (a.check === "paidContentAbsent") {
    return present ? { ok: false, message: "paid content was returned" } : { ok: true };
  }
  return present ? { ok: true } : { ok: false, message: "paid content was not returned" };
}

export function evaluateAssertion(
  a: Assertion,
  stepId: string,
  res: StepResponse,
  config: ImplementationConfig,
): AssertionResult {
  const base: AssertionResult = {
    id: a.id,
    target: a.target,
    level: a.level ?? "must",
    step: stepId,
    description: a.description,
    status: "PASS",
  };
  try {
    let check: Check;
    switch (a.target) {
      case "httpStatus":
        check = evaluateExpectation(res.status, a.expect);
        base.expected = a.expect;
        base.actual = res.status;
        break;
      case "header":
        check = checkHeader(a, res);
        break;
      case "body":
        check = checkBody(a, res, config);
        break;
      case "onchain":
        throw new NotEvaluable("on-chain assertions are not implemented yet (needs the Anvil harness)");
    }
    return {
      ...base,
      status: check.ok ? "PASS" : "FAIL",
      ...(check.message ? { message: check.message } : {}),
    };
  } catch (err) {
    return { ...base, status: "ERROR", message: (err as Error).message };
  }
}
