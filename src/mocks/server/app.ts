import { Hono } from "hono";

/**
 * A minimal x402 V2 resource server for exercising the runner.
 *
 * It implements the handshake from specs/transports-v2/http.md: unpaid requests
 * get 402 with a base64 PAYMENT-REQUIRED header, and undecodable payments get
 * 400. It does not verify or settle payments yet. That needs the local chain
 * and a facilitator. Any decodable payment gets 402 with an explanatory error.
 *
 * `faults` make it misbehave on purpose so tests can prove the runner catches it.
 */

export const MOCK_PAID_CONTENT_MARKER = "x402-conformance-paid-content";

export type MockServerFault =
  | "serve-without-payment" // 200 + paid content with no payment
  | "omit-payment-required" // 402 but no PAYMENT-REQUIRED header
  | "decimal-amount" // amount "0.01" instead of atomic units
  | "wrong-version" // x402Version 1
  | "empty-accepts" // accepts: []
  | "not-base64"; // PAYMENT-REQUIRED is raw JSON, not base64

export interface MockServerOptions {
  path?: string;
  /** Atomic units. Default 10000 (0.01 of a 6-decimal token). */
  amount?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  faults?: MockServerFault[];
}

const DEFAULTS = {
  path: "/paid",
  amount: "10000",
  // Anvil's default chain ID. Asset and payTo are placeholder addresses.
  network: "eip155:31337",
  asset: "0x0000000000000000000000000000000000000402",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
};

const encode = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");

function decodePayment(header: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    if (value && typeof value === "object" && "accepted" in value && "payload" in value) {
      return value as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

export function createMockServer(options: MockServerOptions = {}) {
  const o = { ...DEFAULTS, ...options };
  const faults = new Set(options.faults ?? []);
  const app = new Hono();

  const paymentRequired = (url: string, error: string) => ({
    x402Version: faults.has("wrong-version") ? 1 : 2,
    error,
    resource: { url, description: "Mock paid resource", mimeType: "application/json" },
    accepts: faults.has("empty-accepts")
      ? []
      : [
          {
            scheme: "exact",
            network: o.network,
            amount: faults.has("decimal-amount") ? "0.01" : o.amount,
            asset: o.asset,
            payTo: o.payTo,
            maxTimeoutSeconds: 60,
            extra: { name: "USDC", version: "2" },
          },
        ],
  });

  const respond402 = (url: string, error: string) => {
    const headers: Record<string, string> = {};
    if (!faults.has("omit-payment-required")) {
      const pr = paymentRequired(url, error);
      headers["PAYMENT-REQUIRED"] = faults.has("not-base64") ? JSON.stringify(pr) : encode(pr);
    }
    return new Response("{}", { status: 402, headers: { "Content-Type": "application/json", ...headers } });
  };

  app.all(o.path, (c) => {
    const header = c.req.header("PAYMENT-SIGNATURE");

    if (faults.has("serve-without-payment") || header === undefined) {
      if (faults.has("serve-without-payment")) {
        return c.json({ data: MOCK_PAID_CONTENT_MARKER });
      }
      return respond402(c.req.url, "PAYMENT-SIGNATURE header is required");
    }

    const payment = decodePayment(header);
    if (!payment) {
      // HTTP transport: "Invalid Payment: 400, malformed payment payload".
      return c.json({ error: "invalid_payload" }, 400);
    }
    if (payment.x402Version !== 2) {
      return c.json({ error: "invalid_x402_version" }, 400);
    }
    return respond402(c.req.url, "mock server cannot verify payments yet");
  });

  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}
