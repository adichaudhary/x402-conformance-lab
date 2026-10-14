# Outreach drafts

Drafts for the design partner plan in RFC section 9. Each message is under 120 words. Fill in the repo link before sending. Nothing here has been sent.

---

## x402 maintainers (GitHub Discussion in x402-foundation/x402)

**Title:** Open-source conformance suite for x402 V2, plus 5 spec questions

Hi all. We're a student team at Purdue building an open-source conformance suite for x402 V2. It tests servers, clients, and facilitators against the spec, with a focus on failure cases like underpayment, replay, and failed settlement. Every test links to a line range in `specs/` at a pinned commit (e95b066).

While mapping tests to the spec we found a few spots we couldn't resolve. One example: the HTTP transport says a malformed payment gets 400, but the TypeScript server returns 402. The full list is in our spec audit [link].

Would you look at those questions? We'd also love to run the alpha against the official TypeScript, Python, and Go packages and share results with you first.

---

## x402-rs (Rust)

Hi. We're building an open-source conformance suite for x402 V2 at Purdue, and we'd like x402-rs to be one of our first outside implementations.

The suite plays the client and facilitator against your server, then checks things like underpayment, wrong recipient, expired authorizations, and replayed payments. Results include on-chain balance checks on a local Anvil chain.

Would you run our alpha against x402-rs and tell us what breaks, in our tool or yours? You'd see results privately before anything is published, and you'd get credit in the compatibility grid. Alpha lands around week 10. Repo: [link]

---

## x402-rails (Quicknode)

Hi. We're a Purdue team building an open-source conformance suite for x402 V2, and we'd like to include x402-rails.

Rails middleware is a good test of the server side. Our suite checks that a server returns 402 with a valid PAYMENT-REQUIRED header, rejects bad payments, and never serves paid content when the facilitator fails or times out. We inject those faults with a mock facilitator.

Would you be open to running our alpha against x402-rails? You'd see results privately first, we'd tell you about any failure before publishing, and you'd get credit in the grid. Repo: [link]

---

## Mogami (Java library and facilitator)

Hi. We're building an open-source conformance suite for x402 V2 at Purdue. Mogami is interesting to us because it covers two roles: a Java library and a facilitator.

For the facilitator we'd check /supported, that /verify doesn't consume a payment, that settlement moves exactly the required amount to payTo, and that settling twice fails. For the library we'd run the server tests.

Could we run our alpha against your public test endpoint and share the results with you privately before anything goes public? You'd get credit in the compatibility grid. Repo: [link]

---

## PayAI (facilitator)

Hi. We're a Purdue team building an open-source conformance suite for x402 V2. We'd like to include PayAI's facilitator in our first round of testing.

The facilitator tests cover /supported, /verify, and /settle. Examples: verify approves a valid payment without consuming it, invalid payments get the right error code, settlement sends exactly the required amount to payTo, and a second settle of the same payment fails.

Would you be OK with us running the alpha against your public test endpoint? You'd see results privately first and get credit in the grid. Happy to adjust anything that doesn't fit how you operate. Repo: [link]

---

## Dexter (facilitator)

Hi. We're building an open-source conformance suite for x402 V2 at Purdue, and we'd like Dexter to be one of the facilitators we test against.

We check the facilitator API end to end: /supported lists what you actually accept, /verify is read-only, settlement moves the exact amount, and double settlement fails. Each test links to the spec line it checks, so any failure points at something concrete.

Could we run our alpha against your public test endpoint? Results go to you privately before anything is published, and you'd get credit in the compatibility grid. Feedback on the tests themselves is just as welcome. Repo: [link]

---

## Corbits (facilitator)

Hi. We're a Purdue team building an open-source conformance suite for x402 V2. Corbits is on our list of facilitators with public test endpoints, and we'd like to include you.

The suite sends test payments on a testnet and checks /supported, /verify, and /settle against the spec. That includes failure formats, unsupported networks, and replayed settlements.

Would you be willing to let us run the alpha against your test endpoint and tell us where our tests are wrong? You'd see results privately first, we'd flag any failure before publishing, and you'd get credit in the grid. Repo: [link]
