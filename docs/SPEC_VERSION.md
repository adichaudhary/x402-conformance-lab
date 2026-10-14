# Pinned spec version

Every release of this suite targets one fixed snapshot of the x402 spec. Test definitions link to that snapshot, not to `main`, so a spec change upstream never silently changes what a test means.

## Current pin

| Field | Value |
| --- | --- |
| Repository | https://github.com/x402-foundation/x402 |
| Pinned commit | [`e95b06661e1a2a8a9a21fce34cc28b9934834650`](https://github.com/x402-foundation/x402/tree/e95b06661e1a2a8a9a21fce34cc28b9934834650/specs) |
| Commit date | 2026-10-13 |
| `specs/` tree hash | `fd92aa2f26e0b20985479ef43ab54cb28b555cf2` |
| Last commit that changed `specs/` | [`1566e13f3dbe12ca211761b0bb30215cb10471aa`](https://github.com/x402-foundation/x402/commit/1566e13f3dbe12ca211761b0bb30215cb10471aa) (2026-10-06, builder-code settlement metadata) |
| Protocol version | x402 V2 (`x402Version: 2`) |
| Pinned on | 2026-10-14 |

Permalink base for test definitions:

```
https://github.com/x402-foundation/x402/blob/e95b06661e1a2a8a9a21fce34cc28b9934834650/specs/<file>?plain=1#L<start>-L<end>
```

`?plain=1` is required. GitHub only honors line anchors on Markdown files in plain view.

## Spec files we target

Core and transport (all tests):

- `specs/x402-specification-v2.md`: types, facilitator API, error codes, replay protection
- `specs/transports-v2/http.md`: headers, base64 encoding, HTTP status mapping

Schemes (EVM only for v1):

- `specs/schemes/exact/scheme_exact.md`: scheme-wide rules (transfer correctness, replay, duplicate delivery)
- `specs/schemes/exact/scheme_exact_evm.md`: EIP-3009 and Permit2 payloads and verification steps
- `specs/schemes/upto/scheme_upto.md`: scheme-wide rules for usage-based payments
- `specs/schemes/upto/scheme_upto_evm.md`: Permit2 payload, settle-time verification, `settlement_exceeds_amount`

Extensions:

- `specs/extensions/payment_identifier.md`: used by SRV-19

Read for context, not targeted in v1:

- `specs/extensions/` (bazaar, builder_code, eip2612_gas_sponsoring, erc20_gas_sponsoring, extension-auth-hints, extension-offer-and-receipt, http-message-signatures, sign-in-with-x)
- `specs/transports-v2/mcp.md`, `specs/transports-v2/a2a.md` (stretch goals)
- `specs/schemes/batch-settlement/`, `specs/schemes/auth-capture/` (stretch goals)
- Non-EVM `exact` bindings (Solana, Stellar, XRPL and others)

Out of scope: `specs/x402-specification-v1.md` and `specs/transports-v1/` (V1 is a non-goal).

## Changing the pin

1. Open an issue titled `Bump spec pin to <short sha>`.
2. Diff `specs/` between the old and new commits: `git diff <old>..<new> -- specs/`.
3. For each changed section, find the tests that link to it (`grep -r "<file>" tests/catalog`) and update their `specRef` line ranges and behavior.
4. Update this file and `docs/SPEC_AUDIT.md` in the same PR.
