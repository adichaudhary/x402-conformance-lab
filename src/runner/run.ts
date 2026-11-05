import { getAddress, type Address } from "viem";
import { SPEC_COMMIT, SUITE_VERSION } from "../version.js";
import { evaluateAssertion, type StepResponse } from "./assertions.js";
import { readErc20Balance } from "./chain.js";
import { missingFeatures, type ImplementationConfig } from "./config.js";
import { decodeBase64Json } from "./expect.js";
import { createPaymentSignature, signingAccount, type SignedPayment } from "./payment.js";
import type { AssertionResult, Step, TestDefinition, TestResult } from "./types.js";

export interface RunnerDeps {
  /** ERC-20 `balanceOf`. Defaults to Anvil at `X402_RPC_URL` or `http://127.0.0.1:8545`. */
  balanceOf?: (asset: Address, account: Address) => Promise<bigint>;
  /** Used for `waitForSettlementMs`. Defaults to a real delay. */
  sleep?: (ms: number) => Promise<void>;
}

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

interface ResolvedDeps {
  balanceOf: (asset: Address, account: Address) => Promise<bigint>;
  sleep: (ms: number) => Promise<void>;
}

function resolveDeps(deps?: RunnerDeps): ResolvedDeps {
  return {
    balanceOf: deps?.balanceOf ?? readErc20Balance,
    sleep: deps?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

async function request(
  url: URL,
  method: string,
  headers: Record<string, string>,
  timeoutMs: number,
  stepId: string,
): Promise<Response> {
  try {
    return await fetch(url, {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
  } catch (err) {
    const cause = (err as Error & { cause?: Error }).cause;
    throw new SetupError(`request to ${url} failed: ${cause?.message ?? (err as Error).message}`, stepId);
  }
}

async function fetchPaymentRequired(
  url: URL,
  method: string,
  timeoutMs: number,
  stepId: string,
): Promise<unknown> {
  const response = await request(url, method, { Accept: "application/json" }, timeoutMs, stepId);
  const header = response.headers.get("payment-required");
  await response.text();
  if (!header) {
    throw new SetupError(
      `no PAYMENT-REQUIRED header to build a payment from (status ${response.status})`,
      stepId,
    );
  }
  const decoded = decodeBase64Json(header);
  if (!decoded.ok) throw new SetupError(`PAYMENT-REQUIRED: ${decoded.error}`, stepId);
  return decoded.value;
}

function stepIdOf(def: TestDefinition, step: string | undefined): string {
  return step ?? def.input.steps[def.input.steps.length - 1]!.id;
}

/** Accounts named by this step's balanceDelta assertions, and the token to read. */
function balanceReads(
  def: TestDefinition,
  stepId: string,
  payer: Address,
  payTo: string,
  asset: string,
): { accounts: Map<string, Address>; asset: Address } {
  const accounts = new Map<string, Address>();
  const assets = new Set<string>();
  for (const a of def.assertions) {
    if (a.target !== "onchain" || a.measure !== "balanceDelta" || stepIdOf(def, a.step) !== stepId) continue;
    if (a.asset) assets.add(a.asset);
    if (a.account === "facilitator") {
      throw new SetupError("facilitator balance checks are not implemented yet", stepId);
    }
    if (a.account === "payer") accounts.set("payer", payer);
    else if (a.account === "payTo") accounts.set("payTo", getAddress(payTo));
    else accounts.set(a.account, getAddress(a.account));
  }
  if (assets.size > 1)
    throw new SetupError("on-chain assertions for this step name different assets", stepId);
  return { accounts, asset: getAddress([...assets][0] ?? asset) };
}

async function snapshotBalances(
  accounts: Map<string, Address>,
  asset: Address,
  balanceOf: ResolvedDeps["balanceOf"],
  stepId: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [name, account] of accounts) {
    try {
      out[name] = (await balanceOf(asset, account)).toString();
    } catch (err) {
      throw new SetupError(`balance of ${name} (${account}) failed: ${(err as Error).message}`, stepId);
    }
  }
  return out;
}

async function sendStep(
  step: Step,
  def: TestDefinition,
  config: ImplementationConfig,
  sent: Map<string, string>,
  deps: ResolvedDeps,
) {
  if ((step.concurrency ?? 1) > 1) {
    throw new SetupError("concurrent steps are not implemented yet", step.id);
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  const path = step.path ?? config.resource?.path ?? "/";
  const url = new URL(path, config.url);
  const method = step.method ?? config.resource?.method ?? "GET";
  const timeoutMs = config.requestTimeoutMs ?? 10_000;
  let signed: SignedPayment | undefined;
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
    case "modified": {
      const required = await fetchPaymentRequired(url, method, timeoutMs, step.id);
      try {
        signed = await createPaymentSignature(required, p, signingAccount(config.wallet?.privateKeyEnv));
      } catch (err) {
        throw new SetupError((err as Error).message, step.id);
      }
      headers["PAYMENT-SIGNATURE"] = signed.header;
      break;
    }
  }
  if (headers["PAYMENT-SIGNATURE"]) sent.set(step.id, headers["PAYMENT-SIGNATURE"]);

  const wantsBalances = def.assertions.some(
    (a) => a.target === "onchain" && a.measure === "balanceDelta" && stepIdOf(def, a.step) === step.id,
  );
  if (wantsBalances && !signed) {
    throw new SetupError("on-chain checks need a signed payment to identify payer and payTo", step.id);
  }
  const reads = signed
    ? balanceReads(def, step.id, signed.payer, signed.requirement.payTo, signed.requirement.asset)
    : undefined;
  const before =
    reads && reads.accounts.size > 0
      ? await snapshotBalances(reads.accounts, reads.asset, deps.balanceOf, step.id)
      : undefined;

  const response = await request(url, method, headers, timeoutMs, step.id);
  if (before && step.waitForSettlementMs) await deps.sleep(step.waitForSettlementMs);
  const after = before
    ? await snapshotBalances(reads!.accounts, reads!.asset, deps.balanceOf, step.id)
    : undefined;

  const recorded: StepResponse = {
    status: response.status,
    headers: Object.fromEntries([...response.headers].map(([k, v]) => [k.toLowerCase(), v])),
    body: await response.text(),
    ...(before && after ? { balances: { before, after } } : {}),
  };
  return recorded;
}

export async function runTest(
  def: TestDefinition,
  config: ImplementationConfig,
  deps?: RunnerDeps,
): Promise<TestResult> {
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
      responses.set(step.id, await sendStep(step, def, config, sent, resolveDeps(deps)));
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

export async function runTests(
  tests: TestDefinition[],
  config: ImplementationConfig,
  deps?: RunnerDeps,
): Promise<Report> {
  const startedAt = new Date().toISOString();
  const results: TestResult[] = [];
  for (const t of tests) results.push(await runTest(t, config, deps));
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
