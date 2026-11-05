import { createPublicClient, http, type Address } from "viem";

const ERC20_BALANCE_OF = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
] as const;

/** Reads an ERC-20 balance from Anvil (or `X402_RPC_URL`). */
export async function readErc20Balance(asset: Address, account: Address): Promise<bigint> {
  const rpc = process.env.X402_RPC_URL ?? "http://127.0.0.1:8545";
  const client = createPublicClient({ transport: http(rpc, { timeout: 10_000 }) });
  try {
    return await client.readContract({
      address: asset,
      abi: ERC20_BALANCE_OF,
      functionName: "balanceOf",
      args: [account],
    });
  } catch (err) {
    throw new Error(`reading ${account} balance of ${asset} at ${rpc} failed: ${(err as Error).message}`, {
      cause: err,
    });
  }
}
