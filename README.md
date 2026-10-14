# x402 Interoperability & Conformance Lab

An open-source conformance suite for [x402](https://github.com/x402-foundation/x402), the protocol that lets AI agents and apps pay for API access with stablecoins over HTTP 402.

Point it at your x402 server, client, or facilitator, and it tells you where your implementation breaks the V2 spec. The focus is on failure cases like underpayment, replayed payments, expired signatures, and failed settlement. Those are the cases where someone loses funds or gets paid data for free.

> **Status:** Phase 0 (research and setup). The test format is locked and the spec version is pinned. 3 of 30 tests are fully defined, and SRV-01 runs end to end from the CLI. Alpha is planned for week 10 of the semester.

## Why

Teams are building x402 in many languages and on many chains, and the spec is still changing. Each implementation tests its own happy path. Nothing checks how implementations handle failure cases or whether they work with each other. This suite is a neutral way to check both.

## What it tests

| Role            | What our tool acts as                   | Example checks                                                 |
| --------------- | --------------------------------------- | -------------------------------------------------------------- |
| Resource server | A paying client plus a mock facilitator | Rejects underpayment, replays, wrong recipient, bad signatures |
| Facilitator     | A resource server sending payments      | Settles the exact amount, rejects double settlement            |
| Client          | A mock resource server                  | Pays the right amount to the right wallet with a fresh payment |

The v1 catalog has 30 tests (16 P0, 11 P1, 3 P2). Each one links to the spec section it checks and has a severity from Critical to Low. See [docs/RFC.md](docs/RFC.md) for the full list.

Results come back as:

- **PASS:** the implementation behaved correctly
- **FAIL:** it violated the spec
- **SKIP:** it doesn't support that feature
- **ERROR:** our setup failed, so the result doesn't count against the implementation

Tests where the spec is ambiguous are marked **advisory**. They still run, but a failure doesn't count. See [docs/SPEC_AUDIT.md](docs/SPEC_AUDIT.md) for which ones and why.

## Spec version

We target x402 V2 at [`x402-foundation/x402@e95b066`](https://github.com/x402-foundation/x402/tree/e95b06661e1a2a8a9a21fce34cc28b9934834650/specs) (2026-10-13). Every test links to a line range at that commit. Details and the process for bumping the pin are in [docs/SPEC_VERSION.md](docs/SPEC_VERSION.md).

## How it works

- **Test catalog:** one JSON file per test in `tests/catalog/<role>/`, validated against [`schemas/test-definition.schema.json`](schemas/test-definition.schema.json). Format guide: [docs/TEST_FORMAT.md](docs/TEST_FORMAT.md).
- **CLI runner** reads a config file for your implementation and runs the tests that apply.
- **Mock server and mock facilitator** inject faults on purpose, like rejected payments, failed settlement, and timeouts.
- **Local chain** runs on Anvil with a test USDC-compatible token, so runs are fast, free, and deterministic.
- **Reports** come out as JSON (matching [`schemas/report.schema.json`](schemas/report.schema.json)) and a human-readable summary.

## Running it

Requires Node.js 20 or later.

```bash
npm install
npm run validate:catalog   # check every test definition against the schema
npm test                   # unit tests
npm run check              # lint, format, typecheck, tests, catalog validation (what CI runs)
```

### Run SRV-01 against the local mock server

```bash
npm run mock:server        # terminal 1: starts http://localhost:4402/paid
npm run cli -- run --config configs/implementations/local-mock-server.json --test SRV-01
```

Output:

```
x402 conformance 0.0.1  (spec e95b066)
Implementation: local-mock-server (server) at http://localhost:4402

✓ SRV-01  PASS            Unpaid request returns 402 with payment requirements  [high, 52ms]

1 test(s): 1 passed, 0 failed, 0 advisory failure(s), 0 skipped, 0 error(s)

JSON report: reports/local-mock-server-<timestamp>.json
```

The JSON report matches [`schemas/report.schema.json`](schemas/report.schema.json). Exit code is 0 with no failures, 1 with at least one non-advisory FAIL, and 2 for setup problems or ERROR results.

### Test your own implementation

Copy a file from `configs/implementations/`, point `url` and `resource.path` at your server, set `paidContentMarker` to a string that only appears in the paid response, and list your `features`. The config is validated against [`schemas/implementation-config.schema.json`](schemas/implementation-config.schema.json). The wallet key is read from the environment variable named in `wallet.privateKeyEnv` and is never stored in the config.

Right now only SRV-01 runs end to end. Tests that need signed payments or on-chain checks report ERROR with "not implemented yet" until the payment signer and Anvil harness land.

Once published to npm: `npx x402-conformance run --config ./my-implementation.json`.

## Repository layout

```
src/cli                CLI entry point (commander)
src/runner             Loads the catalog, runs tests, evaluates assertions
src/mocks/server       Mock resource server (for testing clients)
src/mocks/facilitator  Mock facilitator (for testing servers)
src/report             Human-readable and JSON reports
tests/catalog/         Test definitions, one JSON file per test
tests/unit/            Unit tests for the suite itself (vitest)
configs/implementations  One config file per implementation under test
schemas/               JSON Schemas for definitions, results, reports, configs, x402 types
docs/                  RFC, spec pin, spec audit, test format guide
```

## Want to test your implementation?

We're looking for design partners. If you maintain an x402 library or facilitator, open an issue or reach out. You'll see your results privately before anything is published, and you'll get credit in the compatibility grid.

Want to add a test? See [CONTRIBUTING.md](CONTRIBUTING.md).

## Team

Built by Boiler Blockchain at Purdue University.

- Adi Chaudhary, Product Manager
- Chinmay Kamjith, Blockchain Infrastructure Engineer
- Jay Kohut, Test Engineer
- Krish Gupta, Integration Engineer
- Pardhu Konakandla, Test Framework Engineer

## License

Apache-2.0. See [LICENSE](LICENSE).
