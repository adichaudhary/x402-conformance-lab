import type { ImplementationConfig } from "./config.js";
import { decodeBase64Json, evaluateExpectation, getPointer, type Check } from "./expect.js";
import type { Assertion, AssertionResult, BodyAssertion, HeaderAssertion } from "./types.js";

/** What we recorded for one step. Header names are lower-cased. */
export interface StepResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  /** Atomic-unit balances keyed by the assertion account ("payer", "payTo", or an address). */
  balances?: { before: Record<string, string>; after: Record<string, string> };
  payment?: { payer: string; network: string; amount: string };
}

class NotEvaluable extends Error {}

function resolveExpectation(a: Assertion, res: StepResponse) {
  if (!("expect" in a) || !a.expect) return undefined;
  const values: Record<string, string> = {
    "payment.payer": res.payment?.payer ?? "${payment.payer}",
    "payment.network": res.payment?.network ?? "${payment.network}",
    "payment.amount": res.payment?.amount ?? "${payment.amount}",
  };
  const visit = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.replace(
        /\$\{(payment\.(?:payer|network|amount))\}/g,
        (_match, key: string) => values[key]!,
      );
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    }
    return value;
  };
  return visit(a.expect) as typeof a.expect;
}

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
  return evaluateExpectation(value, resolveExpectation(a, res)!);
}

function checkBody(a: BodyAssertion, res: StepResponse, config: ImplementationConfig): Check {
  if (a.check === "configuredKinds" || a.check === "allKindsV2") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      return { ok: false, message: "body is not JSON" };
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { kinds?: unknown }).kinds)) {
      return { ok: false, message: "body has no kinds array" };
    }
    const kinds = (parsed as { kinds: unknown[] }).kinds;
    if (a.check === "allKindsV2") {
      const bad = kinds.find(
        (kind) => !kind || typeof kind !== "object" || (kind as { x402Version?: unknown }).x402Version !== 2,
      );
      return bad === undefined
        ? { ok: true }
        : { ok: false, message: "one or more supported kinds do not use x402Version 2" };
    }
    const schemes = config.features
      .filter((feature) => feature.startsWith("scheme:"))
      .map((feature) => feature.slice("scheme:".length));
    const networks = config.features
      .filter((feature) => feature.startsWith("network:"))
      .map((feature) => feature.slice("network:".length));
    const records = kinds.filter(
      (kind): kind is { scheme?: unknown; network?: unknown } => kind !== null && typeof kind === "object",
    );
    const missingSchemes = schemes.filter((scheme) => !records.some((kind) => kind.scheme === scheme));
    const missingNetworks = networks.filter(
      (network) =>
        !records.some(
          (kind) =>
            typeof kind.network === "string" &&
            (kind.network === network || (!network.includes(":") && kind.network.startsWith(`${network}:`))),
        ),
    );
    const missing = [
      ...missingSchemes.map((v) => `scheme:${v}`),
      ...missingNetworks.map((v) => `network:${v}`),
    ];
    return missing.length === 0
      ? { ok: true }
      : { ok: false, message: `kinds is missing configured features: ${missing.join(", ")}` };
  }
  if (a.check === "json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      return { ok: false, message: "body is not JSON" };
    }
    const found = a.path ? getPointer(parsed, a.path) : { found: true, value: parsed };
    if (!found.found) {
      return a.passIfAbsent
        ? { ok: true, message: `body has no value at ${a.path}` }
        : { ok: false, message: `body has no value at ${a.path}` };
    }
    return a.expect ? evaluateExpectation(found.value, resolveExpectation(a, res)!) : { ok: true };
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
        check = evaluateExpectation(res.status, resolveExpectation(a, res)!);
        base.expected = a.expect;
        base.actual = res.status;
        break;
      case "header":
        check = checkHeader(a, res);
        break;
      case "body":
        check = checkBody(a, res, config);
        break;
      case "onchain": {
        if (a.measure !== "balanceDelta") {
          throw new NotEvaluable("authorizationUsed is not implemented yet");
        }
        const snap = res.balances;
        if (!snap) throw new NotEvaluable("no balance snapshot was taken for this step");
        const before = snap.before[a.account];
        const after = snap.after[a.account];
        if (before === undefined || after === undefined) {
          throw new NotEvaluable(`no balance was read for ${a.account}`);
        }
        const delta = (BigInt(after) - BigInt(before)).toString();
        check = evaluateExpectation(delta, resolveExpectation(a, res)!);
        base.expected = a.expect;
        base.actual = delta;
        break;
      }
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
