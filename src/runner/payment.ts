import { randomBytes } from "node:crypto";
import { getAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { Modification, PaymentSpec } from "./types.js";

/**
 * EIP-3009 `TransferWithAuthorization`, as signed for exact payments.
 * `extra.name` and `extra.version` are the EIP-712 domain. The chain id comes
 * from the CAIP-2 network, and the verifying contract is the token.
 */
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

interface Requirement {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

interface Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

interface PaymentPayload {
  x402Version: 2;
  resource?: unknown;
  accepted: Requirement;
  payload: {
    signature: Hex;
    authorization: Authorization;
  };
}

export interface SignedPayment {
  header: string;
  /** The accepts[] entry we built the payment from, before modifications. */
  requirement: Requirement;
  payer: Address;
}

const ATOMIC = /^(0|[1-9][0-9]*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requirementFrom(value: unknown): Requirement {
  if (!isRecord(value)) throw new Error("accepts[] entry is not an object");
  const { scheme, network, amount, asset, payTo, maxTimeoutSeconds, extra } = value;
  if (typeof scheme !== "string" || typeof network !== "string") {
    throw new Error("accepts[] entry is missing scheme or network");
  }
  if (typeof amount !== "string" || !ATOMIC.test(amount)) {
    throw new Error("accepts[] amount is not an atomic-unit string");
  }
  if (typeof asset !== "string" || typeof payTo !== "string") {
    throw new Error("accepts[] entry is missing asset or payTo");
  }
  if (typeof maxTimeoutSeconds !== "number" || maxTimeoutSeconds <= 0) {
    throw new Error("accepts[] maxTimeoutSeconds is not a positive number");
  }
  if (extra !== undefined && !isRecord(extra)) throw new Error("accepts[] extra is not an object");
  return {
    scheme,
    network,
    amount,
    asset,
    payTo,
    maxTimeoutSeconds,
    ...(extra ? { extra } : {}),
  };
}

function paymentRequiredFrom(value: unknown): { resource?: unknown; accepts: Requirement[] } {
  if (!isRecord(value)) throw new Error("PAYMENT-REQUIRED is not an object");
  if (value.x402Version !== 2)
    throw new Error(`PAYMENT-REQUIRED x402Version is ${String(value.x402Version)}`);
  if (!Array.isArray(value.accepts) || value.accepts.length === 0) {
    throw new Error("PAYMENT-REQUIRED has no accepts[] entries");
  }
  return { resource: value.resource, accepts: value.accepts.map(requirementFrom) };
}

/** Absent assetTransferMethod means EIP-3009. The spec says clients default to it. */
function transferMethod(req: Requirement): string {
  const method = req.extra?.assetTransferMethod;
  return typeof method === "string" ? method : "eip3009";
}

function selectRequirement(accepts: Requirement[], select: PaymentSpec["select"]): Requirement {
  const chosen = accepts.find((req) => {
    if (select?.scheme && req.scheme !== select.scheme) return false;
    if (select?.network && req.network !== select.network) return false;
    if (select?.assetTransferMethod && transferMethod(req) !== select.assetTransferMethod) return false;
    return true;
  });
  if (!chosen) throw new Error("no accepts[] entry matches the payment select");
  if (transferMethod(chosen) !== "eip3009") {
    throw new Error(`signing assetTransferMethod "${transferMethod(chosen)}" is not implemented yet`);
  }
  return chosen;
}

function chainIdOf(network: string): number {
  const match = /^eip155:(\d+)$/.exec(network);
  if (!match) throw new Error(`cannot sign EIP-3009 for network ${network}`);
  return Number(match[1]);
}

function pointerSegments(pointer: string): string[] {
  if (!pointer.startsWith("/")) throw new Error(`${pointer} is not a JSON pointer`);
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** Applies one catalog modification to a PaymentPayload. Mutates `root`. */
function applyModification(root: PaymentPayload, mod: Modification): void {
  const segments = pointerSegments(mod.path);
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    throw new Error(`${mod.path} does not point at a field`);
  }
  let parent: unknown = root;
  for (const key of segments.slice(0, -1)) {
    if (!isRecord(parent) || !(key in parent)) throw new Error(`${mod.path} does not exist`);
    parent = parent[key];
  }
  const key = segments[segments.length - 1]!;
  if (!isRecord(parent)) throw new Error(`${mod.path} does not exist`);

  if (mod.op === "delete") {
    if (!(key in parent)) throw new Error(`${mod.path} does not exist`);
    delete parent[key];
    return;
  }
  if (mod.op === "set") {
    parent[key] = mod.value;
    return;
  }
  const current = parent[key];
  if (typeof current !== "string" || !ATOMIC.test(current)) {
    throw new Error(`${mod.path} is not an atomic-unit string`);
  }
  if (typeof mod.value !== "string" || !ATOMIC.test(mod.value)) {
    throw new Error(`modification value for ${mod.path} is not an atomic-unit string`);
  }
  const next = mod.op === "add" ? BigInt(current) + BigInt(mod.value) : BigInt(current) - BigInt(mod.value);
  if (next < 0n) throw new Error(`${mod.path} would become negative`);
  parent[key] = next.toString();
}

function domainFields(req: Requirement): { name: string; version: string } {
  const name = req.extra?.name;
  const version = req.extra?.version;
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error("accepted.extra.name and extra.version are required to sign EIP-3009");
  }
  return { name, version };
}

async function signAuthorization(payload: PaymentPayload, account: PrivateKeyAccount): Promise<void> {
  const auth = payload.payload.authorization;
  const { name, version } = domainFields(payload.accepted);
  payload.payload.signature = await account.signTypedData({
    domain: {
      name,
      version,
      chainId: chainIdOf(payload.accepted.network),
      verifyingContract: getAddress(payload.accepted.asset),
    },
    types: EIP3009_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: getAddress(auth.from),
      to: getAddress(auth.to),
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce as Hex,
    },
  });
}

export function signingAccount(privateKeyEnv: string | undefined): PrivateKeyAccount {
  if (!privateKeyEnv) throw new Error("config has no wallet.privateKeyEnv, so payments can't be signed");
  const raw = process.env[privateKeyEnv];
  if (!raw) throw new Error(`environment variable ${privateKeyEnv} is not set`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`${privateKeyEnv} is not a 32-byte hex private key`);
  }
  return privateKeyToAccount(raw as Hex);
}

/**
 * Builds a PAYMENT-SIGNATURE header for an exact EIP-3009 payment.
 * `signing: "after-modifications"` (the default) re-signs so the signature
 * covers the edited authorization. `before-modifications` signs the original
 * and then edits, so the signature no longer matches.
 */
export async function createPaymentSignature(
  required: unknown,
  spec: PaymentSpec,
  account: PrivateKeyAccount,
): Promise<SignedPayment> {
  const paymentRequired = paymentRequiredFrom(required);
  const requirement = selectRequirement(paymentRequired.accepts, spec.select);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const validAfter = now - 600n;
  const payload: PaymentPayload = {
    x402Version: 2,
    ...(paymentRequired.resource !== undefined ? { resource: paymentRequired.resource } : {}),
    accepted: structuredClone(requirement),
    payload: {
      signature: "0x",
      authorization: {
        from: account.address,
        to: requirement.payTo,
        value: requirement.amount,
        validAfter: validAfter.toString(),
        validBefore: (now + BigInt(requirement.maxTimeoutSeconds)).toString(),
        nonce: `0x${randomBytes(32).toString("hex")}`,
      },
    },
  };

  const modifications = spec.mode === "modified" ? (spec.modifications ?? []) : [];
  const signing = spec.signing ?? "after-modifications";
  if (signing === "before-modifications") await signAuthorization(payload, account);
  for (const mod of modifications) applyModification(payload, mod);
  if (signing === "after-modifications") await signAuthorization(payload, account);

  const header = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return { header, requirement, payer: account.address };
}
