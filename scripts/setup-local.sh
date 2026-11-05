#!/usr/bin/env bash
# Deploys TestUSDC to a running Anvil, gives the payer 1000 test USDC, and writes .env.local.
# Usage: start `anvil` in another terminal, then: npm run chain:setup
set -euo pipefail

RPC=http://127.0.0.1:8545

# Anvil's default accounts. These keys are public: local use only.
DEPLOYER_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80    # account 0
PAYER_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d       # account 1
FACILITATOR_KEY=0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6 # account 3
PAYER=$(cast wallet address --private-key "$PAYER_KEY")
PAY_TO=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC # account 2 (only receives, so no key needed)
FACILITATOR=$(cast wallet address --private-key "$FACILITATOR_KEY")

# 1. Deploy the token (forge compiles it first if needed).
TOKEN=$(forge create contracts/src/TestUSDC.sol:TestUSDC \
  --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" --broadcast | awk '/Deployed to:/ {print $3}')
if [ -z "$TOKEN" ]; then echo "Deploy failed. Is anvil running?" >&2; exit 1; fi

# 2. Fund the payer: 1000 USDC = 1000000000 atomic units (6 decimals).
cast send "$TOKEN" "mint(address,uint256)" "$PAYER" 1000000000 \
  --rpc-url "$RPC" --private-key "$DEPLOYER_KEY" > /dev/null

# 3. Save everything for the facilitator and tests.
cat > .env.local <<ENV
X402_LOCAL_RPC_URL=$RPC
X402_LOCAL_NETWORK=eip155:31337
X402_LOCAL_TOKEN=$TOKEN
X402_LOCAL_PAYER=$PAYER
X402_LOCAL_PAY_TO=$PAY_TO
X402_LOCAL_FACILITATOR=$FACILITATOR
X402_TEST_PRIVATE_KEY=$PAYER_KEY
X402_FACILITATOR_PRIVATE_KEY=$FACILITATOR_KEY
ENV

echo "Token:  $TOKEN"
echo "Payer:  $PAYER ($(cast call "$TOKEN" "balanceOf(address)(uint256)" "$PAYER" --rpc-url "$RPC") atomic units)"
echo "Wrote .env.local"