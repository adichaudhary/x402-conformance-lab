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
  type MockServerOptions,
} from "../../src/mocks/server/app.js";

const SPEC_REF =
  "https://github.com/x402-foundation/x402/blob/e95b06661e1a2a8a9a21fce34cc28b9934834650/specs/x402-specification-v2.md?plain=1#L120-L130";


const srv02 = loadCatalog().tests.find((t) => t.id === "SRV-02")!;
const SUPPORTED_NETWORKS = ["network:eip155:31337", "network:solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"];
let server: ServerType | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

async function runAgainstMock(
  faults: MockServerFault[] = [],
  options: { mock?: MockServerOptions; features?: string[] } = {},
) {
  const app = createMockServer({ ...options.mock, faults });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => resolve(info.port));
  });
  const config = parseConfig({
    name: "mock",
    role: "server",
    url: `http://localhost:${port}`,
    resource: { path: "/paid", paidContentMarker: MOCK_PAID_CONTENT_MARKER },
    features: options.features ?? ["scheme:exact", "scheme:upto", ...SUPPORTED_NETWORKS],
  });
  const report = await runTests([srv02], config);
  return { report, result: report.results[0]! };
}

function statusOf(result: Awaited<ReturnType<typeof runAgainstMock>>["result"], id: string) {
  return result.assertions.find((assertion) => assertion.id === id)?.status;
}

describe("SRV-02 against the mock server", () => {

  it("links specRef at the pinned PaymentRequired lines", () => {
    expect(srv02.specRef).toBe(SPEC_REF);
  });
  
  it("passes against a correct exact EIP-3009 server", async () => {
    const { report, result } = await runAgainstMock();
    expect(result.status).toBe("PASS");
    expect(result.assertions.every((assertion) => assertion.status === "PASS")).toBe(true);
    expect(validateReport(report)).toEqual([]);
  });

  it("passes when EIP-3009 is implied, permit2 omits EIP-712 fields, and upto follows the EVM rule", async () => {
    const { result } = await runAgainstMock([
      "omit-asset-transfer-method",
      "permit2-without-eip712",
      "upto-offer",
      "upto-solana",
    ]);
    expect(result.status).toBe("PASS");
    expect(result.assertions.every((assertion) => assertion.status === "PASS")).toBe(true);
  });

  it('fails an amount of "0.01" because amounts are atomic-unit integer strings', async () => {
    const { report, result } = await runAgainstMock(["decimal-amount"]);
    expect(result.status).toBe("FAIL");
    expect(statusOf(result, "amount-atomic")).toBe("FAIL");
    expect(statusOf(result, "requirements-valid")).toBe("FAIL");
    expect(result.assertions.find((a) => a.id === "amount-atomic")?.message).toContain('"0.01"');
    expect(validateReport(report)).toEqual([]);
  });

  it.each<[MockServerFault, string]>([
    ["decimal-amount", "amount-atomic"],
    ["legacy-network", "requirements-valid"],
    ["legacy-network", "network-caip2"],
    ["omit-extra-name", "exact-eip3009-name"],
    ["blank-extra-name", "exact-eip3009-name"],
    ["omit-extra-version", "exact-eip3009-version"],
    ["upto-omit-facilitator", "upto-facilitator-address"],
    ["blank-facilitator-address", "upto-facilitator-address"],
  ])("fails %s on %s", async (fault, failingAssertion) => {
    const { report, result } = await runAgainstMock([fault]);
    expect(result.status).toBe("FAIL");
    expect(statusOf(result, failingAssertion)).toBe("FAIL");
    expect(validateReport(report)).toEqual([]);
  });

  it("fails a CAIP-2 network the config does not list as supported", async () => {
    const { result } = await runAgainstMock([], { mock: { network: "eip155:1" } });
    expect(result.status).toBe("FAIL");
    expect(statusOf(result, "network-caip2")).toBe("PASS");
    expect(statusOf(result, "network-supported")).toBe("FAIL");
  });

  it("accepts any chain in a namespace when the config declares the bare namespace", async () => {
    const { result } = await runAgainstMock([], {
      mock: { network: "eip155:1" },
      features: ["scheme:exact", "network:eip155"],
    });
    expect(result.status).toBe("PASS");
  });

  it("reports ERROR, not FAIL, when the config declares no networks", async () => {
    const { result } = await runAgainstMock([], { features: ["scheme:exact"] });
    expect(result.status).toBe("ERROR");
    expect(statusOf(result, "network-supported")).toBe("ERROR");
  });

  it("still requires extra.name when assetTransferMethod is omitted", async () => {
    const { result } = await runAgainstMock(["omit-asset-transfer-method", "omit-extra-name"]);
    expect(result.status).toBe("FAIL");
    expect(statusOf(result, "requirements-valid")).toBe("PASS");
    expect(statusOf(result, "exact-eip3009-name")).toBe("FAIL");
  });

  it("keeps the field checks independent of the PaymentRequired schema", async () => {
    const { result } = await runAgainstMock(["omit-extra-name"]);
    expect(statusOf(result, "requirements-valid")).toBe("PASS");
    expect(statusOf(result, "exact-eip3009-version")).toBe("PASS");
    expect(statusOf(result, "upto-facilitator-address")).toBe("PASS");
  });
});
