#!/usr/bin/env bash
# Creates the labels, milestones, and one GitHub issue per test in the v1 catalog (30 tests).
#
# Usage:
#   scripts/create-issues.sh --dry-run            # print everything, touch nothing (gh not needed)
#   scripts/create-issues.sh --repo owner/name    # create for real (needs gh auth login)
#
# Safe to re-run: existing labels are updated, existing milestones and issues
# (matched by the "<ID>:" title prefix) are skipped.
set -euo pipefail

DRY_RUN=0
REPO=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --repo) REPO="$2"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

SPEC_COMMIT="e95b06661e1a2a8a9a21fce34cc28b9934834650"
SPEC_BASE="https://github.com/x402-foundation/x402/blob/${SPEC_COMMIT}/specs"

if [[ $DRY_RUN -eq 0 ]]; then
  command -v gh >/dev/null || { echo "gh CLI not found. Install it or use --dry-run." >&2; exit 1; }
  gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first." >&2; exit 1; }
  if [[ -z "$REPO" ]]; then
    REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
  fi
fi
REPO_FLAG=()
[[ -n "$REPO" ]] && REPO_FLAG=(--repo "$REPO")

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    printf '[dry-run]'; printf ' %q' "$@"; echo
  else
    "$@"
  fi
}

# ---------------------------------------------------------------- labels
# name|color|description
LABELS=$(cat <<'EOF'
role:server|1d76db|Tests a resource server
role:facilitator|5319e7|Tests a facilitator
role:client|0e8a16|Tests a client
severity:critical|b60205|Funds lost or paid data given away
severity:high|d93f0b|Breaks interoperability
severity:medium|fbca04|Wrong error code or SHOULD-level rule
severity:low|c5def5|Minor or cosmetic
priority:P0|000000|Required for alpha
priority:P1|555555|Required by end of semester
priority:P2|aaaaaa|Optional for v1.0
advisory|f9d0c4|Spec is ambiguous here, see docs/SPEC_AUDIT.md
test-definition|bfdadc|Write or update a catalog test
EOF
)

echo "== Labels"
while IFS='|' read -r name color desc; do
  run gh label create "$name" --color "$color" --description "$desc" --force "${REPO_FLAG[@]}"
done <<< "$LABELS"

# ------------------------------------------------------------ milestones
# title|description
MILESTONES=$(cat <<'EOF'
Alpha|All 16 P0 tests. Run against the official TypeScript, Python, and Go implementations. Weeks 7 to 10.
Beta|All 11 P1 tests, client tests, public testnet mode. Weeks 11 to 14.
v1.0|P2 tests, docs, final compatibility grid. Weeks 15 to 16.
EOF
)

echo
echo "== Milestones"
existing_milestones=""
if [[ $DRY_RUN -eq 0 ]]; then
  existing_milestones="$(gh api "repos/${REPO}/milestones?state=all&per_page=100" --jq '.[].title')"
fi
while IFS='|' read -r title desc; do
  if grep -qxF "$title" <<< "$existing_milestones"; then
    echo "Milestone '$title' exists, skipping"
  else
    run gh api "repos/${REPO:-OWNER/REPO}/milestones" -f "title=$title" -f "description=$desc" --silent
  fi
done <<< "$MILESTONES"

# ---------------------------------------------------------------- issues
# One line per test:
# ID|role|severity|priority|advisory(yes/no)|title|what it checks|spec refs (space separated, relative to specs/)|audit note|acceptance criteria (;; separated)
TESTS=$(cat <<'EOF'
SRV-01|server|high|P0|no|Unpaid request returns 402 with payment requirements|A request with no PAYMENT-SIGNATURE header gets HTTP 402 and a PAYMENT-REQUIRED header that decodes to a valid V2 PaymentRequired object.|transports-v2/http.md#L7-L53 x402-specification-v2.md#L70-L130|OK. Definition already in tests/catalog/server/SRV-01.json.|Status is 402;;PAYMENT-REQUIRED is present and base64-decodes to JSON matching the PaymentRequired schema;;Paid content is not in the body;;Passes against the local mock server;;Run against the official TypeScript example server and record the result
SRV-02|server|high|P0|no|Payment requirements are correctly formatted|Every accepts[] entry has the required fields, a CAIP-2 network, and an amount in atomic units. Scheme-specific extra fields are present (name and version for exact with EIP-3009, facilitatorAddress for upto).|x402-specification-v2.md#L120-L130 x402-specification-v2.md#L627-L642 schemes/exact/scheme_exact_evm.md#L69-L73|Corrected. The RFC says whole token units. The spec uses atomic units as an integer string.|amount is checked as a base-10 integer string, not a decimal;;network is CAIP-2 and is one the config says the server supports;;extra.name and extra.version are required for exact/eip3009 entries;;extra.facilitatorAddress is required for upto entries;;A unit test with amount "0.01" makes the test FAIL
SRV-03|server|critical|P0|no|Valid payment returns 200 and a settlement receipt|A correctly signed payment for the offered requirements gets HTTP 200, the paid content, and a PAYMENT-RESPONSE header with success true.|transports-v2/http.md#L111-L140 x402-specification-v2.md#L225-L252|OK.|Status is 200 and paid content is present;;PAYMENT-RESPONSE decodes to success true with a non-empty transaction and the right network;;On chain, payTo goes up by exactly amount and payer goes down by exactly amount;;Runs on local Anvil
SRV-04|server|high|P0|yes|Malformed payment returns 400 and no data|A PAYMENT-SIGNATURE header that is not valid base64 JSON, or is missing required PaymentPayload fields, is rejected without returning data.|transports-v2/http.md#L176-L186 x402-specification-v2.md#L600|Advisory on status. The transport spec says 400 but the reference TypeScript server returns 402. No data is a hard requirement.|At least 3 malformed variants: not base64, base64 of non-JSON, JSON missing accepted or payload;;must: not 2xx, no paid content, no successful PAYMENT-RESPONSE;;should: status 400;;The question to the maintainers is linked from the definition
SRV-05|server|high|P1|yes|Payment with an unsupported protocol version is rejected|A payment with an undefined x402Version is rejected.|x402-specification-v2.md#L114 x402-specification-v2.md#L604|Corrected and advisory. Use an undefined version such as 3, not 1, because dual-stack V1/V2 servers are allowed. Status code is advisory.|Sends x402Version 3 and 0 with an otherwise valid payload;;Does not send version 1;;must: not 2xx and no paid content;;should: status 400
SRV-06|server|critical|P0|no|Underpayment is rejected|A payment signed for 1 atomic unit less than the price is rejected.|schemes/exact/scheme_exact_evm.md#L75-L81 x402-specification-v2.md#L596|OK. Definition already in tests/catalog/server/SRV-06.json.|Runner supports modified payments with re-signing;;Both variants run (claimed and hidden underpayment);;must: no success status, no successful PAYMENT-RESPONSE, no paid content, payTo balance unchanged;;should: status 402
SRV-07|server|high|P1|yes|Overpayment is rejected|A payment signed for 1 atomic unit more than the price is rejected, since the exact scheme requires the exact amount.|x402-specification-v2.md#L596 schemes/exact/scheme_exact_evm.md#L75-L81 schemes/exact/scheme_exact_evm.md#L174-L201|Advisory. Core says "exactly match" and the reference enforces equality, but the EVM scheme text says "meet" and "covers".|Variants for eip3009 and permit2;;must: payTo balance unchanged (no overcharge);;advisoryReason links the upstream question;;Report lists it apart from hard failures
SRV-08|server|critical|P0|no|Payment to the wrong wallet is rejected|A payment whose authorization sends funds to an address other than payTo is rejected.|schemes/exact/scheme_exact_evm.md#L75-L81 x402-specification-v2.md#L598 schemes/exact/scheme_exact.md#L39|OK.|authorization.to is a different funded wallet and the signature is valid;;must: not 2xx and no paid content;;must: neither payTo nor the other wallet's balance changes;;should: status 402
SRV-09|server|critical|P0|no|Payment in the wrong token or on the wrong chain is rejected|A payment in a different asset or on a different network than offered is rejected.|schemes/exact/scheme_exact_evm.md#L75-L81 x402-specification-v2.md#L599|OK.|Two steps: wrong asset (a second test token on Anvil) and wrong network (different chain ID in accepted and the EIP-712 domain);;must: not 2xx, no paid content, no balance change;;should: status 402
SRV-10|server|critical|P0|no|Payment with an invalid or altered signature is rejected|A payment whose signature does not recover to authorization.from, or whose authorization was changed after signing, is rejected.|schemes/exact/scheme_exact_evm.md#L75-L81 x402-specification-v2.md#L597|OK.|Variants: flipped byte in the signature, signature from a different key, authorization changed after signing;;must: not 2xx, no paid content, no balance change;;should: status 402
SRV-11|server|high|P0|no|Expired payment is rejected|A payment whose validBefore is in the past is rejected.|x402-specification-v2.md#L214-L223 x402-specification-v2.md#L594-L595|OK.|validBefore is chain time minus 60 seconds and the signature is valid;;Uses Anvil block time, not wall-clock time;;must: not 2xx, no paid content, no balance change
SRV-12|server|high|P1|no|Payment that is not valid yet is rejected|A payment whose validAfter is in the future is rejected.|x402-specification-v2.md#L214-L223 x402-specification-v2.md#L594-L595|OK.|validAfter is chain time plus 300 seconds and the signature is valid;;Uses Anvil block time, not wall-clock time;;must: not 2xx, no paid content, no balance change
SRV-13|server|critical|P0|no|Replaying a settled payment is rejected|Resending the exact PAYMENT-SIGNATURE header of a payment that already settled is rejected.|schemes/exact/scheme_exact.md#L41-L42 x402-specification-v2.md#L612-L619|OK. Definition already in tests/catalog/server/SRV-13.json.|Runner supports replay mode;;Precondition: the first payment succeeds, otherwise ERROR;;must: replay is not 2xx, has no successful PAYMENT-RESPONSE, and returns no paid content;;must: payTo balance does not change during the replay
SRV-14|server|critical|P1|no|Concurrent duplicate payments succeed at most once|Sending the same payment several times at once gets paid content at most once.|schemes/exact/scheme_exact.md#L41-L42|OK.|Sends at least 5 identical requests at the same time;;must: at most one 2xx with paid content;;must: payTo balance goes up by exactly amount, once;;Run 10 times in CI to catch flaky races
SRV-15|server|critical|P0|no|No data when the facilitator says the payment is invalid|When the facilitator's /verify returns isValid false, the server returns no paid data.|x402-specification-v2.md#L36-L45 x402-specification-v2.md#L283-L299|OK.|Mock facilitator returns isValid false with an invalidReason;;Requires feature flag facilitator:configurable;;must: not 2xx and no paid content;;should: status 402
SRV-16|server|high|P0|no|Settlement failure returns 402 with a failure receipt|When /settle fails, the server returns 402 with a PAYMENT-RESPONSE where success is false.|transports-v2/http.md#L142-L162 x402-specification-v2.md#L225-L252|OK.|Mock facilitator: verify valid, settle returns success false with an errorReason;;must: status 402 and no paid content;;must: PAYMENT-RESPONSE is present and decodes to success false
SRV-17|server|high|P1|yes|No data when the facilitator is down or times out|If the facilitator is unreachable or slow, the server never returns paid data.|transports-v2/http.md#L176-L186|OK for no data. Advisory on status, which the spec maps to 500 for server errors.|Variants: connection refused on verify, timeout on verify, timeout on settle;;must: no paid content in any variant;;should: 5xx;;Our own timeout is configurable so a slow server gives ERROR, not FAIL
SRV-18|server|medium|P1|yes|Pending settlement is not reported as success|A settlement_pending result from the facilitator is not passed to the client as a successful payment.|x402-specification-v2.md#L608 x402-specification-v2.md#L225-L252|Advisory. The spec does not say what the server should send the client here.|Mock facilitator: settle returns success false, errorReason settlement_pending, non-empty transaction;;must: no PAYMENT-RESPONSE with success true;;Record what the server actually returned so we can bring data to the maintainers
SRV-19|server|medium|P2|yes|Reused payment ID with different details is rejected|With the payment-identifier extension, reusing an id with a different payment returns 409 Conflict.|extensions/payment_identifier.md#L80-L111|Advisory. The extension uses "should" for request binding.|requires ext:payment-identifier, SKIP otherwise;;Second request reuses the id with a different amount or payTo;;must: second request is not 2xx and has no paid content;;should: status 409
FAC-01|facilitator|high|P0|no|/supported reports the schemes and networks it supports|GET /supported returns kinds, extensions, and signers, and the kinds match what the facilitator accepts.|x402-specification-v2.md#L439-L492|OK.|Response matches the SupportedResponse schema (kinds, extensions, signers are all required);;Every scheme and network declared in the config appears in kinds;;V2 kinds have x402Version 2
FAC-02|facilitator|high|P0|no|/verify approves a valid payment and identifies the payer|POST /verify with a valid payment returns isValid true. If payer is present, it equals the signer.|x402-specification-v2.md#L305-L391 x402-specification-v2.md#L254-L269|Corrected. payer is optional in the spec, so its presence is should-level.|must: isValid true;;must: if payer is present it equals authorization.from (case-insensitive);;should: payer is present;;Response matches the VerifyResponse schema
FAC-03|facilitator|medium|P1|yes|/verify rejects invalid payments with the right error code|POST /verify rejects each kind of invalid payment with the matching error code from the spec.|x402-specification-v2.md#L589-L608|OK for error codes. Advisory for HTTP status, which the spec does not define for an invalid /verify.|Covers value_mismatch, recipient_mismatch, invalid signature, valid_before, valid_after, insufficient_funds;;must: isValid false in every case;;should: invalidReason equals the expected code
FAC-04|facilitator|high|P1|no|Verifying a payment does not consume it|Calling /verify does not use up the payment, so it can still be settled afterward.|x402-specification-v2.md#L305-L307|OK. /verify is read-only (MUST).|Calls /verify twice, then /settle;;must: both verifies return isValid true;;must: settle succeeds;;must: no on-chain change after the verifies (nonce unused, balances unchanged)
FAC-05|facilitator|critical|P0|no|Settlement moves exactly the right amount to exactly the right wallet|After /settle, payTo received exactly amount of asset and nothing else moved.|schemes/exact/scheme_exact.md#L39 schemes/exact/scheme_exact_evm.md#L83-L87|OK.|must: success true with a transaction hash that exists on chain;;must: payTo up by exactly amount and payer down by exactly amount;;must: no other account's balance in that asset changes
FAC-06|facilitator|critical|P0|no|Settling the same payment twice fails the second time|A second /settle call for an already settled payment does not succeed.|schemes/exact/scheme_exact.md#L41-L42 x402-specification-v2.md#L612-L619|OK.|Precondition: the first settle succeeds;;must: the second response does not have success true;;must: no second transfer on chain;;Record whether the facilitator returns settlement_pending on the retry
FAC-07|facilitator|medium|P1|no|Failure responses are correctly formatted|Failure responses from /verify and /settle have every field the spec requires.|x402-specification-v2.md#L225-L269 x402-specification-v2.md#L393-L424|OK.|Settle failure has success false, errorReason, transaction (may be empty), network;;Verify failure has isValid false and invalidReason;;Checked with the x402 JSON Schemas in schemas/x402
FAC-08|facilitator|medium|P2|yes|Unsupported schemes or networks return the right error|Requests for a scheme or network the facilitator does not support are rejected with the right error code.|x402-specification-v2.md#L599-L603|Advisory. invalid_scheme and unsupported_scheme overlap and the spec does not say which to use.|Variants for an unsupported network and an unsupported scheme;;must: isValid false or success false;;should: invalid_network for networks, invalid_scheme or unsupported_scheme for schemes
CLI-01|client|high|P1|no|Client pays the right amount to the right wallet with a fresh payment|The client picks one of the offered options, its payment matches it exactly, and it uses a new nonce every time.|x402-specification-v2.md#L152-L223 transports-v2/http.md#L55-L60|OK.|Mock server issues a 402 and records the PAYMENT-SIGNATURE it receives;;must: accepted deep-equals one offered accepts[] entry;;must: authorization.to equals payTo and value equals amount;;must: nonce is 32 bytes and differs across 3 payments;;Config format supports a command that drives the client
CLI-02|client|medium|P1|no|Client passes through server extension data|The client echoes the server's extension info, keeping at least what the server sent.|x402-specification-v2.md#L143-L150|Corrected. The spec lets clients append info, so the check is superset, not unmodified.|Mock server advertises an extension with nested info;;must: every key and value the server sent is present unchanged in the payload's extensions;;Appended keys are allowed
CLI-03|client|medium|P2|yes|Client skips options it does not support|The client ignores payment options it cannot handle and picks one it can.|x402-specification-v2.md#L283-L299|Advisory. MUST for an unknown paymentFlow, but the spec says nothing explicit about unknown schemes or networks.|accepts[] lists an unknown scheme first and a supported one second;;must: client does not pay with an unrecognized paymentFlow;;should: client picks the supported entry
EOF
)

milestone_for() {
  case "$1" in
    P0) echo "Alpha" ;;
    P1) echo "Beta" ;;
    P2) echo "v1.0" ;;
  esac
}

# Settlement and replay tests go to the blockchain infrastructure owner, per RFC section 7.
owner_for() {
  case "$1" in
    SRV-03|SRV-13|SRV-14|SRV-16|SRV-18|FAC-05|FAC-06) echo "Blockchain Infrastructure Engineer (settlement and replay)" ;;
    *) echo "Test Engineer" ;;
  esac
}

existing_titles=""
if [[ $DRY_RUN -eq 0 ]]; then
  existing_titles="$(gh issue list "${REPO_FLAG[@]}" --state all --limit 500 --json title --jq '.[].title')"
fi

echo
echo "== Issues"
count=0
while IFS='|' read -r id role severity priority advisory title checks refs note criteria; do
  [[ -z "$id" ]] && continue
  count=$((count + 1))
  full_title="${id}: ${title}"
  milestone="$(milestone_for "$priority")"
  labels="test-definition,role:${role},severity:${severity},priority:${priority}"
  [[ "$advisory" == "yes" ]] && labels="${labels},advisory"
  owner="$(owner_for "$id")"

  ref_lines=""
  for ref in $refs; do
    file="${ref%%#*}"
    anchor="${ref#*#}"
    ref_lines+="- [\`${file}\` ${anchor}](${SPEC_BASE}/${file}?plain=1#${anchor})"$'\n'
  done

  criteria_lines="- [ ] Definition at \`tests/catalog/${role}/${id}.json\` passes \`npm run validate:catalog\`"$'\n'
  criteria_lines+="- [ ] \`specRef\` links to the first spec reference above"$'\n'
  while IFS= read -r c; do
    [[ -n "$c" ]] && criteria_lines+="- [ ] ${c}"$'\n'
  done <<< "${criteria//;;/$'\n'}"

  body="## What it checks

${checks}

| Severity | Priority | Role | Advisory |
| --- | --- | --- | --- |
| ${severity} | ${priority} | ${role} | ${advisory} |

## Spec reference (pinned to \`${SPEC_COMMIT:0:7}\`)

${ref_lines}
**Spec audit:** ${note} See [docs/SPEC_AUDIT.md](../blob/main/docs/SPEC_AUDIT.md).

## Acceptance criteria

${criteria_lines}
Suggested owner: ${owner}. Format guide: [docs/TEST_FORMAT.md](../blob/main/docs/TEST_FORMAT.md)."

  if grep -q "^${id}:" <<< "$existing_titles"; then
    echo "Issue for ${id} exists, skipping"
    continue
  fi

  if [[ $DRY_RUN -eq 1 ]]; then
    echo "----------------------------------------------------------------"
    echo "TITLE:     ${full_title}"
    echo "LABELS:    ${labels}"
    echo "MILESTONE: ${milestone}"
    echo
    echo "$body"
  else
    gh issue create "${REPO_FLAG[@]}" --title "$full_title" --label "$labels" --milestone "$milestone" --body "$body"
  fi
done <<< "$TESTS"

echo
echo "== ${count} issues processed"
