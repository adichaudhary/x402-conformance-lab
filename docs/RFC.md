# **x402 Interoperability & Conformance Lab**

## 1\. Problem statement

x402 is an open protocol for paying for API access with stablecoins like USDC. It's built on HTTP's 402 "Payment Required" status code. When a client requests a paid resource, the server replies with a 402 and a price. The client signs a payment and resends the request, and the server verifies the payment before returning the data. The main use case is AI agents, since an agent can sign a payment autonomously but can't enter a credit card number.

Three parties are involved:

- **Resource server:** the API that charges for access  
- **Client:** the app or agent that pays  
- **Facilitator:** a service the server uses to verify payments and submit them to the blockchain

A lot of teams have built their own x402 implementations at this point, in different languages and on different chains, and the spec keeps changing. The official repo does have tests, but they only cover its own code in the normal case where everything works. Two implementations can each pass their own tests and still fail to work with each other, and nobody finds out until a real payment breaks.

Nobody has a neutral tool you can point at your implementation to see how it handles failure cases either. What happens if a client underpays? Reuses an old payment? Sends one that already expired? What if the payment never settles? Those are the situations where someone loses funds or gets data without paying, and right now nobody is checking them across implementations.

## 2\. Goals and non-goals

### Goals

- An open-source test suite that checks whether an x402 server, client, or facilitator follows the spec  
- Cover payments over regular HTTP  
- Support Ethereum-compatible chains  
- Test both fixed-price payments and pay-up-to-a-limit payments, which matter for usage-based pricing like AI tokens  
- A command-line tool that runs the tests and writes a report  
- A mock server and mock facilitator we control, so we can trigger failures on purpose  
- 30 tests in the v1 catalog, each with a pass/fail result and a severity  
- Human-readable and JSON reports  
- Run it against at least 5 real implementations and publish a public compatibility grid

### Stretch goals

- MCP support (the protocol AI agents use to call tools)  
- Solana support  
- Other chains the spec covers, like Stellar and XRPL  
- A2A, the protocol for agents paying other agents  
- The more advanced payment types in the spec, like batched payments and hold-then-capture payments  
- Tests for optional extensions, like payment IDs and sign-in with a wallet

### Non-goals

- Building a real, production facilitator  
- The old V1 protocol  
- Officially certifying implementations

## 3\. Success metrics

**Technical:** 25 to 30 tests, each linked to the section of the spec it checks. Clear pass/fail results and severity for every test. Human-readable and JSON reports. CI passes on every change.

**Adoption:** At least 2 outside teams run the suite on their own implementation, and people outside the club file at least 3 issues. GitHub stars and installs are tracked but secondary to these two numbers.

**Process:** We post a public progress update every week on GitHub Discussions, and we incorporate feedback from design partners into each release.

## 4\. Architecture overview

### Components

- **CLI runner:** The command you actually run. You give it a config file for the implementation you want to test and it runs whatever tests apply.  
- **Test catalog:** All the tests, one file each, labeled with what they check, the spec section they cover, and how severe a failure is  
- **Mock server:** A simulated resource server for testing clients. It issues payment requests, including malformed and edge-case ones, and validates what the client sends back.  
- **Mock facilitator:** A simulated facilitator for testing servers. We can configure it to reject a payment, fail settlement, or time out, then verify the server handles each case correctly.  
- **Report generator:** Turns the results into a human-readable summary and a JSON file

### How each role is tested

| What we're testing | What our tool acts as |
| :---- | :---- |
| Resource server | A paying client, plus the facilitator the server talks to |
| Facilitator | A resource server sending it payments to verify and settle |
| Client | A resource server that charges it and inspects the payment it sends |

### How a test is defined

Each test specifies three things:

- **Input:** the scenario setup and the exact request or payment we send  
- **Expected behavior:** what the spec says the implementation should do  
- **Assertions:** checks against the HTTP status code, the x402 payment headers, and on-chain settlement state

Take the underpayment test. The input is a payment signed for 1 unit less than the server's price. The expected behavior is that the server rejects it. The assertions check that the status code is the rejection code the spec requires, that the response headers carry no settlement receipt, that no paid data came back, and that no funds moved on chain.

A test can end up as:

- **PASS:** the implementation behaved correctly  
- **FAIL:** it violated the spec  
- **SKIP:** it doesn't support that feature  
- **ERROR:** our setup failed, so the result doesn't count against the implementation

### Testing multiple implementations

Each implementation gets a short config file with its URL, supported features, and a test wallet. A scheduled job runs every test against every implementation and publishes a grid of results.

### Blockchain setup

By default the tests run on a local blockchain using Anvil, with a test deployment of a USDC-compatible token. It's fast, free, and deterministic. A smaller set of tests can also run on Base Sepolia, a public testnet where tokens have no real value.

## 5\. Tests

**Severity:** Critical means someone could lose funds or get paid data without paying. High means it breaks compatibility with other implementations. Medium covers incorrect error codes and rules the spec recommends but doesn't require. Low covers minor or cosmetic issues.

**Priority:** P0 is required for the first release. P1 is required by the end of the semester. P2 is optional.

**Spec references:** All references point to the x402 V2 spec at github.com/x402-foundation/x402/tree/main/specs. Each test links to the specific section it checks, grouped by spec area: handshake, PaymentRequired schema, payment payload, payment validation, signature validation, replay protection, settlement, error cases, facilitator API, and extensions.

### Resource server

| ID | What it checks | Spec section | Severity | Priority |
| :---- | :---- | :---- | :---- | :---- |
| SRV-01 | A request with no payment returns a 402 with payment requirements attached | Handshake | High | P0 |
| SRV-02 | The payment requirements are correctly formatted (required fields, valid network ID, price in whole token units) | PaymentRequired schema | High | P0 |
| SRV-03 | A valid payment returns a 200 and a settlement receipt | Settlement | Critical | P0 |
| SRV-04 | A malformed payment returns a 400 and no data | Error cases | High | P0 |
| SRV-05 | A payment with the wrong protocol version is rejected | Payment payload | High | P1 |
| SRV-06 | Underpayment is rejected | Payment validation | Critical | P0 |
| SRV-07 | Overpayment is rejected, since the spec requires the exact amount | Payment validation | High | P1 |
| SRV-08 | A payment to the wrong wallet is rejected | Payment validation | Critical | P0 |
| SRV-09 | A payment in a different token or on a different chain than offered is rejected | Payment validation | Critical | P0 |
| SRV-10 | A payment with an invalid or altered signature is rejected | Signature validation | Critical | P0 |
| SRV-11 | An expired payment is rejected | Payment validation | High | P0 |
| SRV-12 | A payment that isn't valid yet is rejected | Payment validation | High | P1 |
| SRV-13 | Replaying an already settled payment is rejected | Replay protection | Critical | P0 |
| SRV-14 | Submitting the same payment concurrently succeeds at most once | Replay protection | Critical | P1 |
| SRV-15 | If the facilitator marks the payment invalid, no data is returned | Settlement | Critical | P0 |
| SRV-16 | If settlement fails, the server returns a 402 with a failure receipt | Settlement | High | P0 |
| SRV-17 | If the facilitator is down or times out, the server never returns the paid data | Error cases | High | P1 |
| SRV-18 | A pending settlement isn't reported as a success | Settlement | Medium | P1 |
| SRV-19 | Retrying with the same payment ID but different details is rejected (optional feature) | Extensions | Medium | P2 |

### Facilitator

| ID | What it checks | Spec section | Severity | Priority |
| :---- | :---- | :---- | :---- | :---- |
| FAC-01 | It correctly reports the payment types and chains it supports | Facilitator API | High | P0 |
| FAC-02 | It approves a valid payment and identifies the payer correctly | Facilitator API | High | P0 |
| FAC-03 | It rejects invalid payments with the correct error code | Error cases | Medium | P1 |
| FAC-04 | Verifying a payment doesn't consume it, so it can still be settled afterward | Facilitator API | High | P1 |
| FAC-05 | Settlement transfers exactly the required amount to exactly the right wallet | Settlement | Critical | P0 |
| FAC-06 | Settling the same payment twice fails the second time | Replay protection | Critical | P0 |
| FAC-07 | Failure responses are correctly formatted | Error cases | Medium | P1 |
| FAC-08 | Unsupported payment types or chains return the correct error | Error cases | Medium | P2 |

### Client

| ID | What it checks | Spec section | Severity | Priority |
| :---- | :---- | :---- | :---- | :---- |
| CLI-01 | The client selects one of the offered payment options and pays the correct amount to the correct wallet, with a unique payment each time | Payment payload | High | P1 |
| CLI-02 | The client passes through extension data from the server unmodified | Extensions | Medium | P1 |
| CLI-03 | The client skips payment options it doesn't support and selects one it does | Handshake | Medium | P2 |

**Totals:** 16 P0, 11 P1, 3 P2 (30 tests).

## 6\. Tech stack

- **TypeScript on Node.js:** The official x402 library and the official repo's tests are both in TypeScript, so we can reuse their data types directly.  
- **viem:** TypeScript library for signing payments and reading blockchain data  
- **JSON Schema:** Standard format for describing valid data. Other projects can reuse our schemas no matter what language they use.  
- **Hono:** Lightweight web framework for the mock server and facilitator  
- **commander:** For building the CLI. Outside teams can run the whole suite with one npx command.  
- **Anvil:** Runs the local test blockchain  
- **GitHub Actions:** Runs the tests on every change  
- **License:** Apache-2.0, same as the official repo, which makes contributing upstream easier later

## 7\. Team roles and ownership

| Domain | Owns | Person |
| :---- | :---- | :---- |
| Product Manager | RFC doc, the roadmap, weekly updates, check-ins with leadership, outreach to outside teams, tracking feedback, docs | Adi Chaudhary |
| Test Framework Engineer | The CLI, the test format, reports | Pardhu Konakandla |
| Blockchain Infrastructure Engineer | Local chain setup, test tokens and wallets, CI, and the settlement and replay tests | Chinmay Kamjith |
| Test Engineer | Writing server, facilitator, and client tests and mapping them to the spec | Jay Kohut |
| Integration Engineer | Getting each implementation running against the suite, writing their config files, and debugging setup issues | Krish Gupta |

## 8\. Roadmap (16 weeks)

**Phase 0, Weeks 1 to 2: Research and setup**

- Everyone reads the core spec, the HTTP spec, and the Ethereum payment spec  
- Set up the repo, finalize the test format, and pin the spec version we're targeting  
- Done when: this doc is approved, the test format is locked in, and we've talked to at least one outside team

**Phase 1, Weeks 3 to 6: Core tooling**

- CLI, config files, mock facilitator, local chain setup, JSON reports  
- Done when: 6 server tests pass against the official TypeScript example server

**Phase 2, Weeks 7 to 10: Alpha**

- All 16 P0 tests, facilitator tests, human-readable reports  
- Run against the official TypeScript, Python, and Go implementations  
- Done when: the alpha is released, the results grid is published, and we've sent the alpha to outside teams

**Phase 3, Weeks 11 to 14: Beta**

- P1 tests, client tests, public testnet mode  
- Done when: all 27 P0 and P1 tests are done, at least 1 outside team has run it, and we've reviewed their feedback

**Phase 4, Weeks 15 to 16: v1.0**

- Docs, contributor guide, final results grid, writeup  
- Done when: v1.0 is released and we've asked the x402 maintainers about linking it from the official repo

## 9\. Design Partner Plan

Contacting:

- Maintainers of the official x402 libraries, through GitHub  
- Maintainers of unofficial x402 libraries: x402-rs (Rust), x402-rails (Ruby, from Quicknode), and Mogami (Java)  
- Facilitators from the official x402 docs that have public test endpoints: PayAI, Dexter, Corbits, Mogami, and the x402.org test facilitator

"We're building a free, open-source conformance suite for x402. Would you run our alpha against your implementation and give us feedback on what breaks?"

They see their results privately before anything is published, and they get credit in the results grid. If something fails, we notify them before we post it.

## 10\. Risks/Mitigations

| Risk | Mitigation |
| :---- | :---- |
| The spec changes mid-semester | Each release targets a pinned version of the spec. Every test links to the section it checks, so it's easy to find what needs updating. |
| Public testnets are unreliable | Use the local chain by default. If our setup fails, the result shows as ERROR instead of FAIL. |
| Scope creep into building a real facilitator | The mock facilitator only returns configured responses. No real settlement logic goes in it. |
| Some rules in the spec are ambiguous | Mark those tests as advisory, raise the question with the x402 maintainers, and keep shipping in the meantime. |
| Outside teams don't respond | Start outreach in week 1\. The 3 official implementations are enough to test against even without outside responses. |
| Finals and winter break | Keep weeks 13 and 14 light and leave a buffer before v1.0. |

## 11\. Questions

1. Should we pursue ecosystem grants or hackathon submissions with this, and if so, which ones?

x402 Foundation or Coinbase/Cloudflare-adjacent ecosystem grants or bounties

University or student open-source grants.

Relevant hackathons that have an interoperability / tooling track.

2. Should we turn the compatibility results into a public writeup or research post at the end of the semester? We could also publish writeups on Medium throughout the semester, covering things like interesting test failures and lessons from partner runs.

A short public compatibility grid \+ a final writeup at the end of the semester is good. Medium (or a simple GitHub blog / mirror) posts during the semester about interesting failures or partner feedback are also good, provided they do not become a distraction. Prioritize getting the tool into other people’s hands first since the writeups become more credible once you have real external runs.

