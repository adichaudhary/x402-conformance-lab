import { SPEC_COMMIT, SUITE_VERSION } from "../version.js";
import { evaluateAssertion, type StepResponse } from "./assertions.js";
import { missingFeatures, type ImplementationConfig } from "./config.js";
import type { AssertionResult, Step, TestDefinition, TestResult } from "./types.js";

export interface Report {
  suiteVersion: string;
  specCommit: string;
  implementation: { name: string; role: ImplementationConfig["role"]; url: string; version?: string };
  startedAt: string;
  finishedAt: string;
  summary: { total: number; pass: number; fail: number; skip: number; error: number; advisoryFail: number };
  results: TestResult[];
}

/** Our setup failed. The result is ERROR, not FAIL. */
class SetupError extends Error {
  constructor(
    message: string,
    readonly step?: string,
  ) {
    super(message);
  }
}

async function sendStep(step: Step, config: ImplementationConfig, sent: Map<string, string>) {
  if ((step.concurrency ?? 1) > 1) {
    throw new SetupError("concurrent steps are not implemented yet", step.id);
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  const p = step.payment;
  switch (p.mode) {
    case "none":
      break;
    case "raw":
      headers["PAYMENT-SIGNATURE"] = p.rawHeader!;
      break;
    case "replay": {
      const prior = sent.get(p.replayOf!);
      if (prior === undefined)
        throw new SetupError(`step "${p.replayOf}" sent no payment to replay`, step.id);
      headers["PAYMENT-SIGNATURE"] = prior;
      break;
    }
    case "valid":
    case "modified":
      throw new SetupError(
        `payment mode "${p.mode}" needs payment signing, which is not implemented yet`,
        step.id,
      );
  }
  if (headers["PAYMENT-SIGNATURE"]) sent.set(step.id, headers["PAYMENT-SIGNATURE"]);

  const path = step.path ?? config.resource?.path ?? "/";
  const url = new URL(path, config.url);
  const method = step.method ?? config.resource?.method ?? "GET";
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(config.requestTimeoutMs ?? 10_000),
      redirect: "manual",
    });
  } catch (err) {
    const cause = (err as Error & { cause?: Error }).cause;
    throw new SetupError(`request to ${url} failed: ${cause?.message ?? (err as Error).message}`, step.id);
  }
  const recorded: StepResponse = {
    status: response.status,
    headers: Object.fromEntries([...response.headers].map(([k, v]) => [k.toLowerCase(), v])),
    body: await response.text(),
  };
  return recorded;
}

export async function runTest(def: TestDefinition, config: ImplementationConfig): Promise<TestResult> {
  const startedAt = new Date();
  const t0 = performance.now();
  const base = {
    testId: def.id,
    title: def.title,
    role: def.role,
    severity: def.severity,
    advisory: def.advisory,
    specRef: def.specRef,
    startedAt: startedAt.toISOString(),
  };
  const done = (rest: Omit<TestResult, keyof typeof base | "durationMs">): TestResult => ({
    ...base,
    durationMs: Math.round(performance.now() - t0),
    ...rest,
  });

  if (def.role !== config.role) {
    return done({
      status: "SKIP",
      assertions: [],
      skipReason: `test is for a ${def.role}, config is a ${config.role}`,
    });
  }
  const missing = missingFeatures(def.requires, config.features);
  if (missing.length > 0) {
    return done({ status: "SKIP", assertions: [], skipReason: `missing features: ${missing.join(", ")}` });
  }

  const lastStep = def.input.steps[def.input.steps.length - 1]!.id;
  const responses = new Map<string, StepResponse>();
  const sent = new Map<string, string>();
  try {
    for (const step of def.input.steps) {
      responses.set(step.id, await sendStep(step, config, sent));
    }
  } catch (err) {
    const e = err as SetupError;
    return done({
      status: "ERROR",
      assertions: [],
      error: { message: e.message, ...(e.step && { step: e.step }) },
    });
  }

  const assertions: AssertionResult[] = def.assertions.map((a) => {
    const stepId = a.step ?? lastStep;
    return evaluateAssertion(a, stepId, responses.get(stepId)!, config);
  });

  const failedPrecondition = def.assertions.find(
    (a, i) => a.precondition && assertions[i]!.status !== "PASS",
  );
  if (failedPrecondition) {
    return done({
      status: "ERROR",
      assertions,
      error: {
        message: `precondition "${failedPrecondition.id}" failed, so the test could not run as designed`,
      },
    });
  }

  const warnings = assertions
    .filter((r) => r.level === "should" && r.status === "FAIL")
    .map((r) => `${r.id}: ${r.message ?? r.description}`);
  const mustFailed = assertions.some((r) => r.level === "must" && r.status === "FAIL");
  const errored = assertions.find((r) => r.status === "ERROR");

  if (mustFailed) return done({ status: "FAIL", assertions, ...(warnings.length > 0 ? { warnings } : {}) });
  if (errored) {
    return done({ status: "ERROR", assertions, error: { message: `${errored.id}: ${errored.message}` } });
  }
  return done({ status: "PASS", assertions, ...(warnings.length > 0 ? { warnings } : {}) });
}

export async function runTests(tests: TestDefinition[], config: ImplementationConfig): Promise<Report> {
  const startedAt = new Date().toISOString();
  const results: TestResult[] = [];
  for (const t of tests) results.push(await runTest(t, config));
  const count = (pred: (r: TestResult) => boolean) => results.filter(pred).length;
  return {
    suiteVersion: SUITE_VERSION,
    specCommit: SPEC_COMMIT,
    implementation: {
      name: config.name,
      role: config.role,
      url: config.url,
      ...(config.version && { version: config.version }),
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    summary: {
      total: results.length,
      pass: count((r) => r.status === "PASS"),
      fail: count((r) => r.status === "FAIL" && !r.advisory),
      skip: count((r) => r.status === "SKIP"),
      error: count((r) => r.status === "ERROR"),
      advisoryFail: count((r) => r.status === "FAIL" && r.advisory),
    },
    results,
  };
}
