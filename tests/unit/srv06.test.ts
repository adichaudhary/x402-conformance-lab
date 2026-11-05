import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  createMockServer,
  MOCK_PAID_CONTENT_MARKER,
  type MockServerFault,
} from "../../src/mocks/server/app.js";
import { validateReport } from "../../src/report/json.js";
import { loadCatalog } from "../../src/runner/catalog.js";
import { parseConfig } from "../../src/runner/config.js";
import { createPaymentSignature } from "../../src/runner/payment.js";
import { runTests, type RunnerDeps } from "../../src/runner/run.js";

const SPEC_REF =
  "https://github.com/x402-foundation/x402/blob/e95b06661e1a2a8a9a21fce34cc28b9934834650/specs/schemes/exact/scheme_exact_evm.md?plain=1#L75-L81";

/** Anvil's default account 0. Public test key, not a secret. */
const PAYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

interface SignedPayload {
  accepted: {
    amount: string;
    asset: Address;
    payTo: Address;
    network: string;
    extra: { name: string; version: string };
  };
  payload: {
    signature: Hex;
    authorization: {
      from: Address;
      to: Address;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: Hex;
    };
  };
}

const srv06 = loadCatalog().tests.find((t) => t.id === "SRV-06")!;
let server: ServerType | undefined;

beforeAll(() => {
  process.env.X402_TEST_PRIVATE_KEY = PAYER_KEY;
});

afterEach(() => {
  server?.close();
  server = undefined;
});

function runnerDeps(balances: Map<string, bigint>): RunnerDeps {
  return {
    balanceOf: async (_asset, account) => balances.get(account.toLowerCase()) ?? 0n,
    sleep: async () => {},
  };
}

async function runAgainstMock(faults: MockServerFault[] = []) {
  const balances = new Map<string, bigint>();
  const recordedPayments: string[] = [];
  const app = createMockServer({ faults, recordedPayments, balances });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => resolve(info.port));
  });
  const config = parseConfig({
    name: "mock",
    role: "server",
    url: `http://localhost:${port}`,
    resource: { path: "/paid", paidContentMarker: MOCK_PAID_CONTENT_MARKER },
    features: ["scheme:exact", "network:eip155", "chain:local"],
    wallet: { privateKeyEnv: "X402_TEST_PRIVATE_KEY" },
  });
  const report = await runTests([srv06], config, runnerDeps(balances));
  return { report, result: report.results[0]!, recordedPayments };
}

function decodePayment(header: string): SignedPayload {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as SignedPayload;
}

/** Recovers the EIP-3009 signer. `value` overrides authorization.value so a test can try the pre-edit amount. */
async function recoveredSigner(
  payload: SignedPayload,
  value = payload.payload.authorization.value,
): Promise<Address> {
  const auth = payload.payload.authorization;
  const chainId = Number(payload.accepted.network.split(":")[1]);
  return recoverTypedDataAddress({
    domain: {
      name: payload.accepted.extra.name,
      version: payload.accepted.extra.version,
      chainId,
      verifyingContract: getAddress(payload.accepted.asset),
    },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: getAddress(auth.from),
      to: getAddress(auth.to),
      value: BigInt(value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
    signature: payload.payload.signature,
  });
}

const requirements = {
  x402Version: 2,
  resource: { url: "http://localhost/paid" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:31337",
      amount: "10000",
      asset: "0x0000000000000000000000000000000000000402",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
    },
  ],
};

describe("modified EIP-3009 payments", () => {
  const payer = privateKeyToAccount(PAYER_KEY).address;

  it("re-signs after modifications so the signature covers the reduced value", async () => {
    const { header } = await createPaymentSignature(
      requirements,
      {
        mode: "modified",
        modifications: [{ path: "/payload/authorization/value", op: "subtract", value: "1" }],
        signing: "after-modifications",
      },
      privateKeyToAccount(PAYER_KEY),
    );
    const payload = decodePayment(header);
    expect(payload.payload.authorization.value).toBe("9999");
    expect(await recoveredSigner(payload)).toBe(payer);
    expect(await recoveredSigner(payload, "10000")).not.toBe(payer);
  });

  it("keeps the original signature when signing happens before the modification", async () => {
    const { header } = await createPaymentSignature(
      requirements,
      {
        mode: "modified",
        modifications: [{ path: "/payload/authorization/value", op: "subtract", value: "1" }],
        signing: "before-modifications",
      },
      privateKeyToAccount(PAYER_KEY),
    );
    const payload = decodePayment(header);
    expect(payload.payload.authorization.value).toBe("9999");
    expect(await recoveredSigner(payload)).not.toBe(payer);
    expect(await recoveredSigner(payload, "10000")).toBe(payer);
  });
});

describe("SRV-06 against the mock server", () => {
  const payer = privateKeyToAccount(PAYER_KEY).address;

  it("links specRef at the pinned exact-EVM verification lines", () => {
    expect(srv06.specRef).toBe(SPEC_REF);
    expect(srv06.input.steps.map((step) => step.id)).toEqual(["underpay-claimed", "underpay-hidden"]);
  });

  it("passes against a server that rejects both underpayments", async () => {
    const { report, result, recordedPayments } = await runAgainstMock();
    expect(result.status).toBe("PASS");
    expect(result.warnings).toBeUndefined();
    expect(result.assertions.every((a) => a.status === "PASS")).toBe(true);
    expect(validateReport(report)).toEqual([]);

    expect(recordedPayments).toHaveLength(2);
    const claimed = decodePayment(recordedPayments[0]!);
    const hidden = decodePayment(recordedPayments[1]!);
    const price = BigInt(hidden.accepted.amount);

    expect(BigInt(claimed.accepted.amount)).toBe(price - 1n);
    expect(BigInt(claimed.payload.authorization.value)).toBe(price - 1n);
    expect(hidden.payload.authorization.value).toBe((price - 1n).toString());
    expect(hidden.accepted.amount).toBe(price.toString());
    expect(claimed.payload.authorization.to).toBe(claimed.accepted.payTo);
    expect(hidden.payload.authorization.to).toBe(hidden.accepted.payTo);

    expect(await recoveredSigner(claimed)).toBe(payer);
    expect(await recoveredSigner(hidden)).toBe(payer);
    expect(await recoveredSigner(hidden, hidden.accepted.amount)).not.toBe(payer);
  });

  it.each<[MockServerFault, string]>([
    ["accept-payment", "claimed-not-2xx"],
    ["success-receipt", "claimed-no-success-receipt"],
    ["leak-paid-content", "claimed-no-paid-content"],
    ["credit-payto", "claimed-payto-unchanged"],
  ])("fails when the server has fault %s", async (fault, failingAssertion) => {
    const { report, result } = await runAgainstMock([fault]);
    expect(result.status).toBe("FAIL");
    expect(result.assertions.find((a) => a.id === failingAssertion)?.status).toBe("FAIL");
    expect(
      result.assertions.find((a) => a.id === failingAssertion.replace("claimed", "hidden"))?.status,
    ).toBe("FAIL");
    expect(validateReport(report)).toEqual([]);
  });

  it("passes with warnings when the server rejects with 400 instead of 402", async () => {
    const { report, result } = await runAgainstMock(["reject-as-400"]);
    expect(result.status).toBe("PASS");
    expect(result.assertions.filter((a) => a.level === "must").every((a) => a.status === "PASS")).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringContaining("claimed-status-402"),
      expect.stringContaining("hidden-status-402"),
    ]);
    expect(validateReport(report)).toEqual([]);
  });

  it("reports ERROR, not FAIL, when the server is unreachable", async () => {
    const config = parseConfig({
      name: "nothing-here",
      role: "server",
      url: "http://127.0.0.1:1",
      resource: { path: "/paid", paidContentMarker: "x" },
      features: ["scheme:exact", "network:eip155", "chain:local"],
      wallet: { privateKeyEnv: "X402_TEST_PRIVATE_KEY" },
    });
    const report = await runTests([srv06], config, runnerDeps(new Map()));
    expect(report.results[0]!.status).toBe("ERROR");
    expect(report.results[0]!.error?.message).toMatch(/request to/);
    expect(validateReport(report)).toEqual([]);
  });

  it("skips when chain:local is not declared", async () => {
    const config = parseConfig({
      name: "mock",
      role: "server",
      url: "http://localhost:1",
      resource: { path: "/paid" },
      features: ["scheme:exact", "network:eip155"],
    });
    const report = await runTests([srv06], config);
    expect(report.results[0]!.status).toBe("SKIP");
    expect(report.results[0]!.skipReason).toContain("chain:local");
    expect(validateReport(report)).toEqual([]);
  });
});
