import { serve, type ServerType } from "@hono/node-server";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { validateReport } from "../../src/report/json.js";
import { loadCatalog } from "../../src/runner/catalog.js";
import { parseConfig } from "../../src/runner/config.js";
import { runTests } from "../../src/runner/run.js";

const PAYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const REQUIREMENTS = {
  scheme: "exact",
  network: "eip155:31337",
  amount: "10000",
  asset: "0x0000000000000000000000000000000000000402",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
  maxTimeoutSeconds: 60,
  extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
};

const catalog = loadCatalog().tests;
const fac01 = catalog.find((test) => test.id === "FAC-01")!;
const fac02 = catalog.find((test) => test.id === "FAC-02")!;
let server: ServerType | undefined;

beforeAll(() => {
  process.env.X402_TEST_PRIVATE_KEY = PAYER_KEY;
});

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("facilitator catalog tests", () => {
  it("runs /supported and a signed /verify request", async () => {
    let verifyRequest: Record<string, unknown> | undefined;
    const app = new Hono();
    app.get("/supported", (c) =>
      c.json({
        kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:31337" }],
        extensions: [],
        signers: { "eip155:*": ["0x0000000000000000000000000000000000000001"] },
      }),
    );
    app.post("/verify", async (c) => {
      verifyRequest = await c.req.json<Record<string, unknown>>();
      const paymentPayload = verifyRequest.paymentPayload as {
        payload: { authorization: { from: string } };
      };
      return c.json({ isValid: true, payer: paymentPayload.payload.authorization.from.toUpperCase() });
    });

    const port = await new Promise<number>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => resolve(info.port));
    });
    const config = parseConfig({
      name: "mock-facilitator",
      role: "facilitator",
      url: `http://localhost:${port}`,
      features: ["scheme:exact", "network:eip155:31337", "chain:local"],
      wallet: { privateKeyEnv: "X402_TEST_PRIVATE_KEY" },
      facilitator: { paymentRequirements: REQUIREMENTS },
    });
    const report = await runTests([fac01, fac02], config);

    expect(report.results.map((result) => result.status)).toEqual(["PASS", "PASS"]);
    expect(verifyRequest?.x402Version).toBe(2);
    expect(verifyRequest?.paymentRequirements).toEqual(REQUIREMENTS);
    expect(verifyRequest?.paymentPayload).toBeTypeOf("object");
    expect(validateReport(report)).toEqual([]);
  });
});
