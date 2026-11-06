import { Hono } from "hono";

/**
 * A minimal x402 V2 resource server for exercising the runner.
 *
 * It implements the handshake from specs/transports-v2/http.md: unpaid requests
 * get 402 with a base64 PAYMENT-REQUIRED header, and undecodable payments get
 * 400. It does not verify or settle payments yet. That needs the local chain
 * and a facilitator. Any decodable payment gets 402 with an explanatory error,
 * unless a fault says otherwise.
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
  | "not-base64" // PAYMENT-REQUIRED is raw JSON, not base64
  | "legacy-network" // network "base-sepolia" instead of a CAIP-2 id
  | "omit-extra-name" // exact EIP-3009 entry has no extra.name
  | "blank-extra-name" // exact EIP-3009 extra.name is ""
  | "omit-extra-version" // exact EIP-3009 entry has no extra.version
  | "omit-asset-transfer-method" // exact entry omits extra.assetTransferMethod (defaults to eip3009)
  | "permit2-without-eip712" // second exact entry uses permit2 and has no name or version
  | "upto-offer" // also advertise upto on EVM with extra.facilitatorAddress
  | "upto-omit-facilitator" // upto on EVM with no extra.facilitatorAddress
  | "blank-facilitator-address" // upto on EVM with extra.facilitatorAddress ""
  | "upto-solana" // upto on Solana with no facilitatorAddress
  | "accept-payment" // 200 + paid content + PAYMENT-RESPONSE success: true
  | "accept-first-payment" // accept the first payment, then reject later payments (replay test)
  | "settlement-failure" // 402 + PAYMENT-RESPONSE success: false with an error reason
  | "success-receipt" // 402, but PAYMENT-RESPONSE reports success
  | "leak-paid-content" // 402 whose body contains the paid content
  | "reject-as-400" // rejects the payment with 400 instead of 402
  | "credit-payto"; // rejects, but adds 1 atomic unit to payTo in options.balances

export interface MockServerOptions {
  path?: string;
  /** Atomic units. Default 10000 (0.01 of a 6-decimal token). */
  amount?: string;
  network?: string;
  asset?: string;
  payTo?: string;
  faults?: MockServerFault[];
  /** PAYMENT-SIGNATURE headers received, in order. Unpaid probes are not recorded. */
  recordedPayments?: string[];
  /**
   * ERC-20 balances keyed by lower-cased address. The credit-payto fault adds 1
   * atomic unit to payTo when a payment arrives, so a test can observe a delta.
   */
  balances?: Map<string, bigint>;
}

const DEFAULTS = {
  path: "/paid",
  amount: "10000",
  // Anvil's default chain ID. Asset and payTo are placeholder addresses.
  network: "eip155:31337",
  asset: "0x0000000000000000000000000000000000000402",
  payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
};

const SOLANA_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

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
  let paymentCount = 0;

  const exactExtra = () => {
    const extra: Record<string, unknown> = {
      name: "USDC",
      version: "2",
      assetTransferMethod: "eip3009",
    };
    if (faults.has("omit-extra-name")) delete extra.name;
    if (faults.has("blank-extra-name")) extra.name = "";
    if (faults.has("omit-extra-version")) delete extra.version;
    if (faults.has("omit-asset-transfer-method")) delete extra.assetTransferMethod;
    return extra;
  };

  const uptoEntry = (network: string, facilitatorAddress: string | undefined) => {
    const extra: Record<string, unknown> = { name: "USDC", version: "2" };
    if (facilitatorAddress !== undefined) extra.facilitatorAddress = facilitatorAddress;
    return {
      scheme: "upto",
      network,
      amount: o.amount,
      asset: o.asset,
      payTo: o.payTo,
      maxTimeoutSeconds: 300,
      extra,
    };
  };

  const accepts = (): unknown[] => {
    if (faults.has("empty-accepts")) return [];
    const offered: unknown[] = [
      {
        scheme: "exact",
        network: faults.has("legacy-network") ? "base-sepolia" : o.network,
        amount: faults.has("decimal-amount") ? "0.01" : o.amount,
        asset: o.asset,
        payTo: o.payTo,
        maxTimeoutSeconds: 60,
        extra: exactExtra(),
      },
    ];
    if (faults.has("permit2-without-eip712")) {
      offered.push({
        scheme: "exact",
        network: o.network,
        amount: o.amount,
        asset: o.asset,
        payTo: o.payTo,
        maxTimeoutSeconds: 60,
        extra: { assetTransferMethod: "permit2" },
      });
    }
    if (faults.has("upto-offer")) {
      offered.push(uptoEntry(o.network, "0x0000000000000000000000000000000000000001"));
    }
    if (faults.has("upto-omit-facilitator")) offered.push(uptoEntry(o.network, undefined));
    if (faults.has("blank-facilitator-address")) offered.push(uptoEntry(o.network, ""));
    if (faults.has("upto-solana")) offered.push(uptoEntry(SOLANA_DEVNET, undefined));
    return offered;
  };

  const paymentRequired = (url: string, error: string) => ({
    x402Version: faults.has("wrong-version") ? 1 : 2,
    error,
    resource: { url, description: "Mock paid resource", mimeType: "application/json" },
    accepts: accepts(),
  });

  const respond402 = (url: string, error: string, extraHeaders: Record<string, string> = {}, body = "{}") => {
    const headers: Record<string, string> = { "Content-Type": "application/json", ...extraHeaders };
    if (!faults.has("omit-payment-required")) {
      const pr = paymentRequired(url, error);
      headers["PAYMENT-REQUIRED"] = faults.has("not-base64") ? JSON.stringify(pr) : encode(pr);
    }
    return new Response(body, { status: 402, headers });
  };

  if (faults.has("credit-payto") && !options.balances) {
    throw new Error("credit-payto fault requires options.balances");
  }

  app.all(o.path, (c) => {
    const header = c.req.header("PAYMENT-SIGNATURE");

    if (faults.has("serve-without-payment") || header === undefined) {
      if (faults.has("serve-without-payment")) {
        return c.json({ data: MOCK_PAID_CONTENT_MARKER });
      }
      return respond402(c.req.url, "PAYMENT-SIGNATURE header is required");
    }

    options.recordedPayments?.push(header);
    paymentCount++;
    const payment = decodePayment(header);
    if (faults.has("credit-payto")) {
      const key = o.payTo.toLowerCase();
      const balances = options.balances!;
      balances.set(key, (balances.get(key) ?? 0n) + 1n);
    }
    if (faults.has("accept-payment") || (faults.has("accept-first-payment") && paymentCount === 1)) {
      if (payment && options.balances) {
        const accepted = payment.accepted as Record<string, unknown>;
        const payload = payment.payload as Record<string, unknown>;
        const authorization = payload.authorization as Record<string, unknown>;
        const payer = String(authorization.from).toLowerCase();
        const payTo = String(accepted.payTo).toLowerCase();
        const amount = BigInt(String(authorization.value));
        options.balances.set(payer, (options.balances.get(payer) ?? 0n) - amount);
        options.balances.set(payTo, (options.balances.get(payTo) ?? 0n) + amount);
      }
      return c.json({ data: MOCK_PAID_CONTENT_MARKER }, 200, {
        "PAYMENT-RESPONSE": encode({
          success: true,
          transaction: "0xmock-settlement",
          network: o.network,
        }),
      });
    }
    if (faults.has("settlement-failure")) {
      return respond402(c.req.url, "settlement failed", {
        "PAYMENT-RESPONSE": encode({
          success: false,
          errorReason: "insufficient_funds",
          transaction: "",
          network: o.network,
        }),
      });
    }
    if (faults.has("success-receipt")) {
      return respond402(c.req.url, "mock rejected the payment", {
        "PAYMENT-RESPONSE": encode({ success: true }),
      });
    }
    if (faults.has("leak-paid-content")) {
      return respond402(
        c.req.url,
        "mock rejected the payment",
        {},
        JSON.stringify({ data: MOCK_PAID_CONTENT_MARKER }),
      );
    }
    if (faults.has("reject-as-400")) {
      return c.json({ error: "payment_failed" }, 400);
    }

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
