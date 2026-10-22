// Verifying facilitator for the local Anvil chain. Run: npm run facilitator
import { serve } from "@hono/node-server";
import { x402Facilitator } from "@x402/core/facilitator";
import { toFacilitatorEvmSigner } from "@x402/evm";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import { Hono } from "hono";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

// Anvil account 3 settles payments and pays the gas. Public test key, local use only.
const account = privateKeyToAccount("0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6");
const wallet = createWalletClient({ account, chain: foundry, transport: http() }).extend(publicActions);
const signer = toFacilitatorEvmSigner({ ...wallet, address: account.address } as never);

// The official x402 rules for "exact" payments, used for our chain.
const facilitator = new x402Facilitator().register("eip155:31337", new ExactEvmScheme(signer));

const app = new Hono();
app.get("/supported", (c) => c.json(facilitator.getSupported()));
app.post("/verify", async (c) => {
  const { paymentPayload, paymentRequirements } = await c.req.json();
  return c.json(await facilitator.verify(paymentPayload, paymentRequirements));
});
app.post("/settle", async (c) => {
  const { paymentPayload, paymentRequirements } = await c.req.json();
  return c.json(await facilitator.settle(paymentPayload, paymentRequirements));
});

serve({ fetch: app.fetch, port: 4022 });
console.log("Facilitator listening on http://localhost:4022");