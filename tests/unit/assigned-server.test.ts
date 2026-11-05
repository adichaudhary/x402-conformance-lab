import { serve, type ServerType } from "@hono/node-server";
import type { AddressInfo } from "node:net";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { recoverTypedDataAddress, type Address, type Hex } from "viem";
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

const PAYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const OTHER_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" as const;
const ASSET = "0x0000000000000000000000000000000000000402" as const;

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
    network: string;
    asset: Address;
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

const requirements = {
  x402Version: 2,
  resource: { url: "http://localhost/paid" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:31337",
      amount: "10000",
      asset: ASSET,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { name: "USDC", version: "2", assetTransferMethod: "eip3009" },
    },
  ],
};

const catalog = loadCatalog().tests;
const srv03 = catalog.find((test) => test.id === "SRV-03")!;
const srv13 = catalog.find((test) => test.id === "SRV-13")!;
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

async function runServerTest(testId: "SRV-03" | "SRV-13", fault: MockServerFault) {
  const payer = privateKeyToAccount(PAYER_KEY).address.toLowerCase();
  const balances = new Map<string, bigint>([
    [payer, 1000000n],
    [PAY_TO.toLowerCase(), 0n],
  ]);
  const app = createMockServer({ faults: [fault], balances });
  const port = await new Promise<number>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0 }, (info: AddressInfo) => resolve(info.port));
  });
  const config = parseConfig({
    name: "mock",
    role: "server",
    url: `http://localhost:${port}`,
    resource: { path: "/paid", paidContentMarker: MOCK_PAID_CONTENT_MARKER },
    features: ["scheme:exact", "network:eip155:31337", "chain:local"],
    wallet: { privateKeyEnv: "X402_TEST_PRIVATE_KEY" },
  });
  const definition = testId === "SRV-03" ? srv03 : srv13;
  const report = await runTests([definition], config, runnerDeps(balances));
  return { report, result: report.results[0]! };
}

function decode(header: string): SignedPayload {
  return JSON.parse(Buffer.from(header, "base64").toString("utf8")) as SignedPayload;
}

async function recover(payload: SignedPayload): Promise<Address> {
  const auth = payload.payload.authorization;
  return recoverTypedDataAddress({
    domain: {
      name: payload.accepted.extra.name,
      version: payload.accepted.extra.version,
      chainId: Number(payload.accepted.network.split(":")[1]),
      verifyingContract: payload.accepted.asset,
    },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
    signature: payload.payload.signature,
  });
}

describe("assigned server tests", () => {
  it("SRV-03 validates a successful receipt and exact balance deltas", async () => {
    const { report, result } = await runServerTest("SRV-03", "accept-payment");
    expect(result.status).toBe("PASS");
    expect(result.assertions.every((assertion) => assertion.status === "PASS")).toBe(true);
    expect(validateReport(report)).toEqual([]);
  });

  it("SRV-13 reuses payment metadata while snapshotting the replay", async () => {
    const { report, result } = await runServerTest("SRV-13", "accept-first-payment");
    expect(result.status).toBe("PASS");
    expect(result.assertions.find((assertion) => assertion.id === "replay-payto-unchanged")?.status).toBe(
      "PASS",
    );
    expect(validateReport(report)).toEqual([]);
  });
});

describe("invalid signature variants", () => {
  const payer = privateKeyToAccount(PAYER_KEY);
  const other = privateKeyToAccount(OTHER_KEY);

  it("flips one byte after signing", async () => {
    const valid = decode((await createPaymentSignature(requirements, { mode: "valid" }, payer)).header);
    const flipped = decode(
      (await createPaymentSignature(requirements, { mode: "valid", signatureVariant: "flip-byte" }, payer))
        .header,
    );
    expect(flipped.payload.signature).not.toBe(valid.payload.signature);
    const rejected = await recover(flipped)
      .then((address) => address !== payer.address)
      .catch(() => true);
    expect(rejected).toBe(true);
  });

  it("can sign with another key while keeping authorization.from as the payer", async () => {
    const payload = decode(
      (
        await createPaymentSignature(
          requirements,
          { mode: "valid", signatureVariant: "different-key" },
          payer,
          other,
        )
      ).header,
    );
    expect(payload.payload.authorization.from).toBe(payer.address);
    expect(await recover(payload)).toBe(other.address);
  });
});
