# Test definition format

Every test in the catalog is one JSON file in `tests/catalog/<role>/<ID>.json`. The file says what we send, what the spec expects, and how we check it. The runner reads these files. It doesn't hard-code test logic, so you can review a test without reading TypeScript.

- Schema: [`schemas/test-definition.schema.json`](../schemas/test-definition.schema.json) (JSON Schema draft 2020-12)
- Result schema: [`schemas/test-result.schema.json`](../schemas/test-result.schema.json)
- Report schema: [`schemas/report.schema.json`](../schemas/report.schema.json)
- x402 wire types used by `matchesSchema`: [`schemas/x402/x402-v2.schema.json`](../schemas/x402/x402-v2.schema.json)

Check your file with:

```bash
npm run validate:catalog
```

The validator also checks a few things the schema can't: the file name matches `id`, the folder matches `role`, IDs are unique, and every `step` an assertion names actually exists.

## Top-level fields

| Field                | Required    | What it is                                                                                                                        |
| -------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                 | yes         | `SRV-NN`, `FAC-NN`, or `CLI-NN`. The prefix must match `role`.                                                                    |
| `title`              | yes         | One line, under 120 characters.                                                                                                   |
| `role`               | yes         | `server`, `facilitator`, or `client`. The role of the implementation under test.                                                  |
| `specRef`            | yes         | Permalink to the main spec section, pinned to a full commit SHA. Use `?plain=1#Lx-Ly` so the line anchor works on Markdown files. |
| `additionalSpecRefs` | no          | Other sections the test depends on.                                                                                               |
| `specArea`           | no          | One of the RFC's spec areas (`handshake`, `payment-validation`, ...).                                                             |
| `severity`           | yes         | `critical`, `high`, `medium`, `low`. Defined in the RFC section 5.                                                                |
| `priority`           | yes         | `P0` (alpha), `P1` (beta), `P2` (v1.0 optional).                                                                                  |
| `advisory`           | yes         | `true` if the spec is ambiguous here. Advisory failures are reported but don't count.                                             |
| `advisoryReason`     | if advisory | What is ambiguous. Link the question you raised upstream.                                                                         |
| `requires`           | yes         | Feature flags. If the implementation's config doesn't list one, the result is SKIP. Use `[]` for none.                            |
| `input`              | yes         | Setup and the requests to send. See below.                                                                                        |
| `expectedBehavior`   | yes         | Plain-language summary of what the spec requires.                                                                                 |
| `assertions`         | yes         | The checks. See below.                                                                                                            |
| `notes`              | no          | Anything a reviewer should know.                                                                                                  |

### Feature flags

Flags are namespaced strings. Current ones:

- `scheme:exact`, `scheme:upto`
- `network:eip155` (any EVM chain) or `network:eip155:31337` (a specific chain)
- `chain:local` (runs against Anvil), `chain:testnet`
- `ext:payment-identifier` (and other extension names from the spec)
- `facilitator:configurable` (the server can be pointed at our facilitator)

## Input

```json
"input": {
  "scenario": "One or two sentences.",
  "setup": { "facilitator": "verifying", "chain": "local", "payerFunding": "1000000000" },
  "steps": [ { "id": "...", "payment": { ... } } ]
}
```

`setup.facilitator` says which facilitator the server under test talks to:

- `mock`: our mock facilitator, returning the responses in `setup.mockFacilitator`. Use it to inject faults (invalid, settle failure, timeout).
- `verifying`: a facilitator that really verifies and settles on the local chain.
- `implementation`: whatever the implementation already uses.

Each step is one HTTP request (or `concurrency` identical requests sent at once). `payment.mode` controls the `PAYMENT-SIGNATURE` header:

| Mode       | Header sent                                           |
| ---------- | ----------------------------------------------------- |
| `none`     | No header                                             |
| `valid`    | A correct payment for the selected `accepts[]` entry  |
| `modified` | A correct payment with `modifications` applied        |
| `raw`      | `rawHeader`, exactly as written (for malformed input) |
| `replay`   | The exact header from step `replayOf`                 |

A modification is `{ "path": <JSON Pointer into the PaymentPayload>, "op": "set" | "delete" | "add" | "subtract", "value": ... }`. `add` and `subtract` do integer math on atomic-unit strings. `signing` decides whether the signature is computed after the modifications (`after-modifications`, the default, gives a valid signature over bad values) or before (`before-modifications`, gives a broken signature).

## Assertions

Every assertion has `id`, `target`, `description`, and optionally:

- `step`: which step's response to check (default: the last step)
- `level`: `must` (default) or `should`. A failed `should` is a warning. Use it for status codes the spec recommends, or where the spec is unclear.
- `precondition`: if `true` and it fails, the test result is ERROR, not FAIL. Use it when an earlier step has to succeed for the test to mean anything.

There are four targets:

| `target`     | Extra fields                                                  | Checks                                                                                                                                                     |
| ------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `httpStatus` | `expect`                                                      | The response status code                                                                                                                                   |
| `header`     | `name`, `present`, `decode`, `path`, `expect`, `passIfAbsent` | A response header. `decode: "base64json"` decodes x402 headers. `path` is a JSON Pointer into the decoded value.                                           |
| `body`       | `check`, `path`, `expect`                                     | `paidContentAbsent` / `paidContentPresent` look for the paid-content marker from the implementation config. `json` parses the body and compares at `path`. |
| `onchain`    | `measure`, `account`, `asset`, `expect`                       | `balanceDelta` is the change in `account`'s token balance across the step. `account` is `payer`, `payTo`, `facilitator`, or an address.                    |

`expect` takes one or more of `equals`, `notEquals`, `oneOf`, `notOneOf`, `min`, `max`, `pattern`, `matchesSchema`. All of them must hold.

## Results

Each run of a test produces one result (see `schemas/test-result.schema.json`):

- **PASS**: every `must` assertion passed
- **FAIL**: at least one `must` assertion failed
- **SKIP**: a `requires` flag is missing from the implementation config. `skipReason` lists which.
- **ERROR**: our setup broke (network error, chain not reachable, failed precondition). `error.message` says what happened. It doesn't count against the implementation.

`should` failures show up in `warnings`. They never change the status.

## Worked example: SRV-06, underpayment

Full file: [`tests/catalog/server/SRV-06.json`](../tests/catalog/server/SRV-06.json).

**What we're checking.** The RFC says a payment for less than the price must be rejected. The spec audit traced this to the exact EVM verification steps ([`scheme_exact_evm.md` L75-81](https://github.com/x402-foundation/x402/blob/e95b06661e1a2a8a9a21fce34cc28b9934834650/specs/schemes/exact/scheme_exact_evm.md?plain=1#L75-L81)) and the `value_mismatch` error code. That's the `specRef`:

```json
"id": "SRV-06",
"role": "server",
"specRef": "https://github.com/x402-foundation/x402/blob/e95b066.../specs/schemes/exact/scheme_exact_evm.md?plain=1#L75-L81",
"severity": "critical",
"priority": "P0",
"advisory": false,
"requires": ["scheme:exact", "network:eip155", "chain:local"]
```

Severity is critical because a server that accepts underpayment gives away paid data. The test needs a local chain and EVM `exact`, so an implementation that only does Solana gets SKIP.

**Input.** There are two ways a client can underpay, and they get caught in different places, so the test has two steps:

```json
"setup": { "facilitator": "verifying", "chain": "local", "payerFunding": "1000000000" },
"steps": [
  {
    "id": "underpay-claimed",
    "payment": {
      "mode": "modified",
      "select": { "scheme": "exact", "assetTransferMethod": "eip3009" },
      "modifications": [
        { "path": "/accepted/amount", "op": "subtract", "value": "1" },
        { "path": "/payload/authorization/value", "op": "subtract", "value": "1" }
      ],
      "signing": "after-modifications"
    }
  },
  {
    "id": "underpay-hidden",
    "payment": {
      "mode": "modified",
      "modifications": [{ "path": "/payload/authorization/value", "op": "subtract", "value": "1" }],
      "signing": "after-modifications"
    }
  }
]
```

- `underpay-claimed`: the client openly says it accepted a lower price. The server should notice that `accepted` matches none of its offers.
- `underpay-hidden`: the client copies `accepted` exactly but signs for 1 unit less. Only real verification of the signed authorization catches this. That's why `setup.facilitator` is `verifying`, not `mock`.

Amounts are in atomic units (`"subtract", "1"` means 0.000001 USDC). `signing: "after-modifications"` keeps the signature valid, so we're testing the amount check and not the signature check (that's SRV-10).

**Assertions.** For each step:

```json
{ "id": "hidden-not-2xx", "target": "httpStatus", "step": "underpay-hidden",
  "description": "Hidden underpayment is not answered with a success status.",
  "expect": { "notOneOf": [200, 201, 202, 203, 204, 206] } },

{ "id": "hidden-status-402", "target": "httpStatus", "step": "underpay-hidden", "level": "should",
  "description": "Hidden underpayment returns 402 (Payment Failed).",
  "expect": { "equals": 402 } },

{ "id": "hidden-no-success-receipt", "target": "header", "step": "underpay-hidden",
  "name": "PAYMENT-RESPONSE", "decode": "base64json", "path": "/success", "passIfAbsent": true,
  "description": "No PAYMENT-RESPONSE reports success.",
  "expect": { "notEquals": true } },

{ "id": "hidden-no-paid-content", "target": "body", "step": "underpay-hidden",
  "check": "paidContentAbsent", "description": "Paid content is not returned." },

{ "id": "hidden-payto-unchanged", "target": "onchain", "step": "underpay-hidden",
  "measure": "balanceDelta", "account": "payTo",
  "description": "payTo balance does not change.", "expect": { "equals": "0" } }
```

Things to notice:

- The security property (no success status, no success receipt, no data, no funds moved) is `must`. The exact status code 402 is `should`. The HTTP transport maps a failed verification to 402, but returning 400 here is a compatibility bug, not a loss of funds. Splitting them keeps a critical test from reporting a status-code nit as a critical failure.
- `passIfAbsent: true` on the `PAYMENT-RESPONSE` check means "no receipt at all" also passes. What must not happen is a receipt with `success: true`.
- The on-chain check is what catches a server that returns 402 but still settles the payment in the background.

**Possible results.**

- Server rejects both, nothing moves on chain: **PASS**.
- Server rejects both, but with 400: **PASS** with a warning for `claimed-status-402` and `hidden-status-402`.
- Server returns 200 and the data for `underpay-hidden`: **FAIL**.
- Anvil isn't reachable, so we can't fund the payer: **ERROR**.
- Config doesn't list `scheme:exact`: **SKIP**.
