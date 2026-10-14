import { describe, expect, it } from "vitest";
import { loadCatalog } from "../../src/runner/catalog.js";
import { validators } from "../../src/runner/schemas.js";

// The PaymentRequired example from specs/transports-v2/http.md at the pinned commit.
const specExample = {
  x402Version: 2,
  error: "PAYMENT-SIGNATURE header is required",
  resource: {
    url: "https://api.example.com/premium-data",
    description: "Access to premium market data",
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2" },
    },
  ],
};

describe("catalog", () => {
  it("every catalog file validates against the test definition schema", () => {
    const { issues, tests } = loadCatalog();
    expect(issues).toEqual([]);
    expect(tests.length).toBeGreaterThan(0);
  });
});

describe("x402 V2 PaymentRequired schema", () => {
  const validate = validators.x402("PaymentRequired");

  it("accepts the example from the HTTP transport spec", () => {
    expect(validate(specExample)).toBe(true);
  });

  it("rejects a whole-unit decimal amount (amounts are atomic units)", () => {
    const bad = structuredClone(specExample);
    bad.accepts[0]!.amount = "0.01";
    expect(validate(bad)).toBe(false);
  });

  it("rejects a non-CAIP-2 network name", () => {
    const bad = structuredClone(specExample);
    bad.accepts[0]!.network = "base-sepolia";
    expect(validate(bad)).toBe(false);
  });

  it("rejects x402Version 1", () => {
    expect(validate({ ...specExample, x402Version: 1 })).toBe(false);
  });

  it("rejects an empty accepts array", () => {
    expect(validate({ ...specExample, accepts: [] })).toBe(false);
  });
});
