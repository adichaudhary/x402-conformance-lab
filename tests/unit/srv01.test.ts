import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { validateReport } from "../../src/report/json.js";
import { loadCatalog } from "../../src/runner/catalog.js";
import { parseConfig } from "../../src/runner/config.js";
import { runTests } from "../../src/runner/run.js";
import {
  createMockServer,
  MOCK_PAID_CONTENT_MARKER,
  type MockServerFault,
} from "../../src/mocks/server/app.js";

const srv01 = loadCatalog().tests.find((t) => t.id === "SRV-01")!;
let server: ServerType | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function runAgainstMock(faults: MockServerFault[] = []) {
  const app = createMockServer({ faults });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => resolve(info.port));
  });
  const config = parseConfig({
    name: "mock",
    role: "server",
    url: `http://localhost:${port}`,
    resource: { path: "/paid", paidContentMarker: MOCK_PAID_CONTENT_MARKER },
    features: ["scheme:exact"],
  });
  const report = await runTests([srv01], config);
  return { report, result: report.results[0]! };
}

describe("SRV-01 against the mock server", () => {
  it("passes against a correct server", async () => {
    const { report, result } = await runAgainstMock();
    expect(result.status).toBe("PASS");
    expect(result.assertions.every((a) => a.status === "PASS")).toBe(true);
    expect(validateReport(report)).toEqual([]);
  });

  it.each<[MockServerFault, string]>([
    ["serve-without-payment", "status-402"],
    ["omit-payment-required", "payment-required-present"],
    ["decimal-amount", "payment-required-valid"],
    ["wrong-version", "payment-required-valid"],
    ["empty-accepts", "payment-required-valid"],
    ["not-base64", "payment-required-valid"],
  ])("fails when the server has fault %s", async (fault, failingAssertion) => {
    const { report, result } = await runAgainstMock([fault]);
    expect(result.status).toBe("FAIL");
    expect(result.assertions.find((a) => a.id === failingAssertion)?.status).toBe("FAIL");
    expect(validateReport(report)).toEqual([]);
  });

  it("reports ERROR, not FAIL, when the server is unreachable", async () => {
    const config = parseConfig({
      name: "nothing-here",
      role: "server",
      url: "http://127.0.0.1:1",
      resource: { path: "/paid", paidContentMarker: "x" },
      features: [],
    });
    const report = await runTests([srv01], config);
    expect(report.results[0]!.status).toBe("ERROR");
    expect(report.results[0]!.error?.message).toMatch(/request to/);
    expect(validateReport(report)).toEqual([]);
  });

  it("skips tests whose required features are missing", async () => {
    const srv06 = loadCatalog().tests.find((t) => t.id === "SRV-06")!;
    const config = parseConfig({
      name: "mock",
      role: "server",
      url: "http://localhost:1",
      resource: { path: "/paid" },
      features: ["scheme:exact"],
    });
    const report = await runTests([srv06], config);
    expect(report.results[0]!.status).toBe("SKIP");
    expect(report.results[0]!.skipReason).toContain("network:eip155");
    expect(validateReport(report)).toEqual([]);
  });
});
