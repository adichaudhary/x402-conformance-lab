# Running the official example servers

This is how to run the suite against the official example servers from x402-foundation/x402 at the pinned commit:

| Example                            | Config                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `examples/typescript/servers/hono` | [`official-typescript-hono.json`](../configs/implementations/official-typescript-hono.json) |
| `examples/python/servers/fastapi`  | [`official-python-fastapi.json`](../configs/implementations/official-python-fastapi.json)   |
| `examples/go/servers/gin`          | [`official-go-gin.json`](../configs/implementations/official-go-gin.json)                   |

All three serve `GET /weather` on port 4021, so run one at a time.

## What it needs

| Variable          | What it is                                   | Secret?                                                      |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `EVM_ADDRESS`     | Address that receives Base Sepolia payments  | No, it's a public address                                    |
| `SVM_ADDRESS`     | Address that receives Solana devnet payments | No, it's a public address                                    |
| `FACILITATOR_URL` | Facilitator the server calls                 | No. `https://x402.org/facilitator` is the public testnet one |

The Go example names the first two `EVM_PAYEE_ADDRESS` and `SVM_PAYEE_ADDRESS`.

SRV-01 sends no payment, so it needs no private keys, no test funds, and no facilitator account. The servers still contact the facilitator at startup to fetch `/supported`, so the machine needs internet access.

Tests that pay (SRV-03 onward) also need a funded Base Sepolia wallet whose private key is in `X402_TEST_PRIVATE_KEY`, plus testnet USDC. Those tests can't run against these servers until the payment signer exists. After that, the default plan is to run them on Anvil with our own verifying facilitator, not on Base Sepolia.

## Get the upstream repo

Clone next to this repo, not inside it:

```bash
git clone https://github.com/x402-foundation/x402.git
cd x402
git checkout e95b06661e1a2a8a9a21fce34cc28b9934834650
```

**Windows:** keep the clone at a short path such as `C:\Users\<you>\x402`. In a deeply nested folder, `pnpm install` fails in esbuild's postinstall with `spawnSync ... esbuild.exe ENOENT` because the path passes Windows' 260-character limit. `subst` doesn't help because pnpm resolves the real path.

The addresses in the `.env` files below are the example addresses from the spec. Use your own if you ever take payments.

## TypeScript (Hono)

Needs Node 20+ and pnpm. Without a global pnpm, prefix the commands with `corepack` (`corepack pnpm install ...`).

```bash
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

## Python (FastAPI)

Needs Python 3.10+. Upstream uses `uv sync` then `uv run python main.py`. Without uv, a plain virtual environment works. Note that pip resolves current dependency versions rather than the ones in `uv.lock`:

```bash
cd examples/python/servers/fastapi
python -m venv .venv
.venv/bin/pip install -e "../../../../python/x402[fastapi,evm,svm]" "python-dotenv>=1.2.1" "uvicorn[standard]>=0.40.0"
cat > .env <<'EOF'
EVM_ADDRESS=0x209693Bc6afc0C5328bA36FaF03C514EF312287C
SVM_ADDRESS=CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5
FACILITATOR_URL=https://x402.org/facilitator
EOF
.venv/bin/python main.py    # listens on http://localhost:4021/weather
```

On Windows the venv paths are `.venv\Scripts\pip` and `.venv\Scripts\python`.

## Go (Gin)

Needs Go 1.24+.

```bash
cd examples/go/servers/gin
go mod tidy
cat > .env <<'EOF'
EVM_PAYEE_ADDRESS=0x209693Bc6afc0C5328bA36FaF03C514EF312287C
SVM_PAYEE_ADDRESS=CKPKJWNdJEqa81x7CkZ14BVPiY6y16Sxs7owznqtWYp5
FACILITATOR_URL=https://x402.org/facilitator
EOF
go run .          # listens on http://localhost:4021/weather
```

Upstream's README says `go mod download`, but at the pinned commit that isn't enough: `go.sum` is gitignored and the example's `go.mod` lists older indirect versions than the Go SDK it points at, so the build fails with `missing go.sum entry`. `go mod tidy` fixes it. It rewrites the example's `go.mod` to match the SDK's own requirements (for example `go-ethereum` 1.16.7 to 1.17.2) and doesn't change the x402 code being tested.

## Run SRV-01

With one server running, from this repo:

```bash
npm run cli -- run --config configs/implementations/official-typescript-hono.json --test SRV-01
npm run cli -- run --config configs/implementations/official-python-fastapi.json --test SRV-01
npm run cli -- run --config configs/implementations/official-go-gin.json --test SRV-01
```

Each config's `paidContentMarker` matches that example's paid response: `"weather":"sunny"` for Hono and FastAPI, `"weather":"foggy"` for Gin, whose default city is San Francisco.

## Last result

2026-10-26, pinned commit `e95b066`, Windows 11: **SRV-01 PASS** on all three.

| Server  | Toolchain                | `/weather` price | `amount` offered |
| ------- | ------------------------ | ---------------- | ---------------- |
| Hono    | Node 24, pnpm 11.1.1     | `$0.001`         | `"1000"`         |
| FastAPI | Python 3.13, pip (no uv) | `$0.01`          | `"10000"`        |
| Gin     | Go 1.24.1                | `$0.001`         | `"1000"`         |

Each returned 402 with a valid `PAYMENT-REQUIRED` header offering `exact` on Base Sepolia (USDC, atomic units) and Solana devnet, and no `PAYMENT-RESPONSE` header.

Earlier, on 2026-10-14, a quick manual probe of the Hono server also confirmed the SRV-04 finding from the spec audit: a `PAYMENT-SIGNATURE: not-base64!!` header gets **402**, where the HTTP transport spec says 400.
