# Contributing

Thanks for helping. Most contributions are new tests or fixes to existing ones. Those need no TypeScript, just a JSON file and a spec reference.

## Setup

```bash
npm install
npm run check   # lint, format, typecheck, unit tests, catalog validation
```

Node.js 20 or later.

## Adding a test

1. **Pick the test.** Every test in the v1 catalog has a GitHub issue (labels `role:*`, `severity:*`, `priority:*`). Assign yourself before you start so two people don't write the same one.

2. **Find the spec text.** Read the row for your test in [docs/SPEC_AUDIT.md](docs/SPEC_AUDIT.md). It already names the spec file and section, and says whether the test is advisory.

3. **Write the definition.** Create `tests/catalog/<role>/<ID>.json`. Copy an existing file as a starting point:
   - `SRV-01.json` for a single request with no payment
   - `SRV-06.json` for a modified payment checked on chain
   - `SRV-13.json` for a multi-step test with a precondition

   [docs/TEST_FORMAT.md](docs/TEST_FORMAT.md) explains every field.

4. **Validate.**

   ```bash
   npm run validate:catalog
   ```

5. **Open a PR** using the checklist below.

## Mapping a test to the spec

Every test needs a `specRef` that points at the exact lines it checks, at the pinned commit:

```
https://github.com/x402-foundation/x402/blob/e95b06661e1a2a8a9a21fce34cc28b9934834650/specs/<file>.md?plain=1#L<start>-L<end>
```

- Use the commit in [docs/SPEC_VERSION.md](docs/SPEC_VERSION.md), never `main`. `main` changes under us.
- Keep `?plain=1`. Without it GitHub ignores the line anchor on Markdown files.
- Point at the narrowest range that contains the requirement. If the test depends on more than one section, put the main one in `specRef` and the rest in `additionalSpecRefs`.
- Amounts in the spec are **atomic units** (`"10000"` is 0.01 USDC). Write `input` values the same way.
- Headers are `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, and `PAYMENT-RESPONSE`, all base64-encoded JSON.

### When the spec is unclear

Don't guess. If the spec says SHOULD, contradicts itself, or doesn't say:

1. Set `"advisory": true` and explain in `advisoryReason`.
2. Or, if only part of the test is unclear, keep the test non-advisory and set `"level": "should"` on the unclear assertions. Usually that's the exact status code. Keep the security property (no data, no funds moved) as `must`.
3. Add the question to the "Questions to raise with the maintainers" list in `docs/SPEC_AUDIT.md`.

### Picking assertion levels

- `must`: the spec says MUST, or failing it loses funds or leaks paid data.
- `should`: the spec says SHOULD, or the requirement is real but ambiguous.
- `precondition: true`: an earlier step has to work for the test to mean anything. Failure gives ERROR, not FAIL.

## PR checklist

Copy this into your PR description:

```
- [ ] `npm run check` passes locally
- [ ] File is `tests/catalog/<role>/<ID>.json` and `id` matches the file name
- [ ] `specRef` is a permalink to the pinned commit with a line range
- [ ] I read the linked spec lines and the assertions match what they say
- [ ] Severity and priority match the RFC (or the PR explains why not)
- [ ] Advisory tests have `advisoryReason`, and the question is listed in SPEC_AUDIT.md
- [ ] Amounts are atomic-unit strings
- [ ] Security properties (no paid data, no funds moved) are `must`
- [ ] Closes #<issue>
```

## Code changes

For changes to the runner, CLI, mocks, or reports:

- Add or update a vitest test in `tests/unit/`.
- Keep `src/runner/types.ts` in sync with the JSON Schemas. The schemas are the source of truth.
- Run `npm run format` before pushing.

## Code of conduct

Be kind and assume good faith. If an implementation fails a test, the report is about the code, not the people who wrote it. We tell maintainers privately before publishing any failure.
