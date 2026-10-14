# Weekly update #1: Phase 0 setup

_Draft for GitHub Discussions. Week 1 of 16._

## The goal

We're building an open-source conformance suite for x402 V2. You point it at a server, client, or facilitator, and it tells you where the implementation breaks the spec. We focus on the cases where money or data goes the wrong way: underpayment, replayed payments, expired signatures, failed settlement. The plan is 30 tests, run against at least 5 real implementations, with a public compatibility grid at the end of the semester.

## Pinned spec version

We target x402 V2 at commit `e95b066` of x402-foundation/x402 (October 13). Every test links to a line range at that commit. If the spec moves, we bump the pin on purpose and update the affected tests. See `docs/SPEC_VERSION.md`.

## What the spec audit found

We checked all 30 planned tests against the spec text before writing any of them. Most held up. A few didn't:

- Prices are in atomic units ("10000" means 0.01 USDC), not whole tokens. We had this wrong in the RFC.
- The spec says a malformed payment gets a 400. The official TypeScript server returns 402. We'll ask the maintainers which one is right.
- The exact scheme probably rejects overpayment, but the EVM text says "meet" and "covers" where the core spec says "exactly". Advisory until confirmed.
- Clients may add to extension data. Our client test now checks for a superset instead of an exact copy.
- None of our 30 tests cover the upto scheme yet, even though it's a stated goal. We'll propose 2 or 3 for Beta.

Nine tests are marked advisory. Full details are in `docs/SPEC_AUDIT.md`.

## Test format

Each test is one JSON file with an input, the expected behavior, and assertions on the HTTP status, x402 headers, response body, and on-chain balances. Assertions are either "must" or "should". That way a critical test like underpayment fails only on the security property, and a wrong status code shows up as a warning. Results are PASS, FAIL, SKIP, or ERROR. The format guide uses SRV-06 (underpayment) as a full example.

## Done this week

- Repo set up: TypeScript, viem, Hono, commander, ESLint, Prettier, vitest, CI on every push
- Spec pinned and audited
- JSON Schemas for tests, results, reports, and implementation configs
- SRV-01, SRV-06, and SRV-13 fully defined
- A script to open one issue per test, with labels and milestones (not run yet)
- First runnable test: SRV-01 runs from the CLI against a local mock server

## Next steps

- **Product (Adi):** Send outreach to the x402 maintainers and the six partner teams. Post the five spec questions as a Discussion upstream. Approve and run the issue script.
- **Test framework (Pardhu):** Generalize the SRV-01 runner so it can run any catalog file. That means payment modes, modifications, and the "must" and "should" logic. Add the HTML or Markdown report.
- **Blockchain infrastructure (Chinmay):** Anvil setup with an EIP-3009 test token, plus Permit2 and the two x402 proxies at their canonical addresses. Funded test wallets. A verifying facilitator that SRV-06 and SRV-13 can use.
- **Tests (Jay):** Write definitions for the remaining P0 server tests, starting with SRV-02 (now using atomic units), SRV-04, and SRV-08.
- **Integration (Krish):** Get the official TypeScript example server running locally against the suite. Write configs for the official Python and Go servers.

Questions or want to run the suite on your implementation? Reply here or open an issue.
