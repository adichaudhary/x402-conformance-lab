# Running the official TypeScript example server

This is how to run the suite against `examples/typescript/servers/hono` from x402-foundation/x402 at the pinned commit. Config: [`configs/implementations/official-typescript-hono.json`](../configs/implementations/official-typescript-hono.json).

## What it needs

| Variable          | What it is                                   | Secret?                                                      |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `EVM_ADDRESS`     | Address that receives Base Sepolia payments  | No, it's a public address                                    |
| `SVM_ADDRESS`     | Address that receives Solana devnet payments | No, it's a public address                                    |
| `FACILITATOR_URL` | Facilitator the server calls                 | No. `https://x402.org/facilitator` is the public testnet one |

SRV-01 sends no payment, so it needs no private keys, no test funds, and no facilitator account. The server still contacts the facilitator at startup to fetch `/supported`, so the machine needs internet access.

Tests that pay (SRV-03 onward) also need a funded Base Sepolia wallet whose private key is in `X402_TEST_PRIVATE_KEY`, plus testnet USDC. Those tests can't run against this server until the payment signer exists. After that, the default plan is to run them on Anvil with our own verifying facilitator, not on Base Sepolia.

## Steps

```bash
git clone https://github.com/x402-foundation/x402.git
cd x402
git checkout e95b06661e1a2a8a9a21fce34cc28b9934834650
cd examples/typescript
pnpm install --filter "@x402/hono-server-example..."
pnpm --filter "@x402/hono-server-example^..." run build
cd servers/hono
cat > .env <<'EOF'
EVM_ADDRESS=0x209693Bc6afc0C5328bA36FaF03C514EF312287C
SVM_ADDRESS=CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5
FACILITATOR_URL=https://x402.org/facilitator
EOF
pnpm dev          # listens on http://localhost:4021/weather
```

The addresses above are the example addresses from the spec. Use your own if you ever take payments.

**Windows:** clone to a short path such as `C:\Users\<you>\x402-upstream`. In a deeply nested folder, `pnpm install` fails in esbuild's postinstall with `spawnSync ... esbuild.exe ENOENT` because the path passes Windows' 260-character limit. `subst` doesn't help because pnpm resolves the real path.

Then, from this repo:

```bash
npm run cli -- run --config configs/implementations/official-typescript-hono.json --test SRV-01
```

## Last result

2026-10-14, pinned commit `e95b066`: **SRV-01 PASS**. The server returned 402 with a valid `PAYMENT-REQUIRED` header offering `exact` on Base Sepolia (`amount: "1000"`, the `$0.001` price in atomic units) and Solana devnet.

A quick manual probe also confirmed the SRV-04 finding from the spec audit: a `PAYMENT-SIGNATURE: not-base64!!` header gets **402**, where the HTTP transport spec says 400.
