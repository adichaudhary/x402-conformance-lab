# x402 Interoperability & Conformance Lab

An open-source conformance suite for [x402](https://github.com/x402-foundation/x402), the protocol that lets AI agents and apps pay for API access with stablecoins over HTTP 402.

Point it at your x402 server, client, or facilitator, and it tells you where your implementation breaks the V2 spec. The focus is on failure cases like underpayment, replayed payments, expired signatures, and failed settlement. Those are the cases where someone loses funds or gets paid data for free.

> **Status:** In active development. Targeting an alpha release in week 10 of the semester.

## Why

Teams are building x402 in many languages and on many chains, and the spec is still changing. Each implementation tests its own happy path, but nothing checks how implementations handle failure cases or whether they work with each other. This suite is a neutral way to check both.

## What it tests

| Role | What our tool acts as | Example checks |
|---|---|---|
| Resource server | A paying client plus a mock facilitator | Rejects underpayment, replays, wrong recipient, bad signatures |
| Facilitator | A resource server sending payments | Settles the exact amount, rejects double settlement |
| Client | A mock resource server | Pays the right amount to the right wallet with a fresh payment |

There are 30 tests in the v1 catalog. Each one links to the spec section it checks and has a severity from Critical to Low.

Results come back as:

- **PASS:** the implementation behaved correctly
- **FAIL:** it violated the spec
- **SKIP:** it doesn't support that feature
- **ERROR:** our setup failed, so the result doesn't count against the implementation

## How it works

- **CLI runner** reads a config file for your implementation and runs the tests that apply
- **Mock server and mock facilitator** inject faults on purpose, like rejected payments, failed settlement, and timeouts
- **Local chain** runs on Anvil with a test USDC-compatible token, so runs are fast, free, and deterministic
- **Reports** come out as JSON and a human-readable summary

## Usage (planned)

```bash
npx x402-conformance --config ./my-implementation.json
```

## Tech stack

TypeScript, Node.js, viem, Hono, JSON Schema, commander, Anvil, GitHub Actions

## Want to test your implementation?

We're looking for design partners. If you maintain an x402 library or facilitator, open an issue or reach out. You'll see your results privately before anything is published, and you'll get credit in the compatibility grid.

## Team

Built by Boiler Blockchain at Purdue University.

- Adi Chaudhary, Product Manager
- Chinmay Kamjith, Blockchain Infrastructure Engineer
- Jay Kohut, Test Engineer
- Krish Gupta, Integration Engineer
- Pardhu Konakandla, Test Framework Engineer
## License

Apache-2.0
