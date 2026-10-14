// Types mirroring schemas/test-definition.schema.json and schemas/test-result.schema.json.
// The JSON Schemas are the source of truth. Keep these in sync when the schemas change.

export type Role = "server" | "facilitator" | "client";
export type Severity = "critical" | "high" | "medium" | "low";
export type Priority = "P0" | "P1" | "P2";
export type Status = "PASS" | "FAIL" | "SKIP" | "ERROR";
export type AssertionLevel = "must" | "should";

export interface Expectation {
  equals?: unknown;
  notEquals?: unknown;
  oneOf?: unknown[];
  notOneOf?: unknown[];
  min?: number;
  max?: number;
  pattern?: string;
  matchesSchema?:
    "PaymentRequired" | "PaymentPayload" | "SettlementResponse" | "VerifyResponse" | "SupportedResponse";
}

export interface Modification {
  path: string;
  op: "set" | "delete" | "add" | "subtract";
  value?: unknown;
}

export interface PaymentSpec {
  mode: "none" | "valid" | "modified" | "raw" | "replay";
  select?: { scheme?: string; network?: string; assetTransferMethod?: string };
  modifications?: Modification[];
  signing?: "after-modifications" | "before-modifications";
  rawHeader?: string;
  replayOf?: string;
}

export interface Step {
  id: string;
  description?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  path?: string;
  payment: PaymentSpec;
  concurrency?: number;
  waitForSettlementMs?: number;
}

interface AssertionBase {
  id: string;
  description: string;
  step?: string;
  level?: AssertionLevel;
  precondition?: boolean;
}

export interface HttpStatusAssertion extends AssertionBase {
  target: "httpStatus";
  expect: Expectation;
}

export interface HeaderAssertion extends AssertionBase {
  target: "header";
  name: string;
  present?: boolean;
  decode?: "none" | "base64json";
  path?: string;
  expect?: Expectation;
  passIfAbsent?: boolean;
}

export interface BodyAssertion extends AssertionBase {
  target: "body";
  check: "paidContentAbsent" | "paidContentPresent" | "json";
  path?: string;
  expect?: Expectation;
}

export interface OnchainAssertion extends AssertionBase {
  target: "onchain";
  measure: "balanceDelta" | "authorizationUsed";
  account: string;
  asset?: string;
  expect: Expectation;
}

export type Assertion = HttpStatusAssertion | HeaderAssertion | BodyAssertion | OnchainAssertion;

export interface TestDefinition {
  id: string;
  title: string;
  role: Role;
  specRef: string;
  additionalSpecRefs?: string[];
  specArea?: string;
  severity: Severity;
  priority: Priority;
  advisory: boolean;
  advisoryReason?: string;
  requires: string[];
  input: {
    scenario: string;
    setup?: {
      facilitator?: "mock" | "verifying" | "implementation";
      chain?: "local" | "testnet" | "none";
      payerFunding?: string;
      mockFacilitator?: Record<string, unknown>;
    };
    steps: Step[];
  };
  expectedBehavior: string;
  assertions: Assertion[];
  notes?: string;
}

export interface AssertionResult {
  id: string;
  target: Assertion["target"];
  level: AssertionLevel;
  step?: string;
  description: string;
  status: Status;
  expected?: unknown;
  actual?: unknown;
  message?: string;
}

export interface TestResult {
  testId: string;
  title: string;
  role: Role;
  severity: Severity;
  advisory: boolean;
  specRef?: string;
  status: Status;
  durationMs: number;
  startedAt: string;
  assertions: AssertionResult[];
  warnings?: string[];
  skipReason?: string;
  error?: { message: string; stack?: string; step?: string };
}
