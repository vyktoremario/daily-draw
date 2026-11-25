#!/usr/bin/env bash
# Runs Foundry's forge inside packages/contracts.
# Uses a local Foundry install if there is one; otherwise falls back to Foundry's Docker image.
# (Watch out: Laravel Herd ships an unrelated `forge` command.)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/packages/contracts"
if command -v forge >/dev/null 2>&1 && forge --version 2>/dev/null | grep -qi 'forge version'; then
  exec forge "$@"
fi
# Mount the whole repo so the contract tests can read packages/shared/test-vectors, and pass
# FOUNDRY_* settings through (e.g. FOUNDRY_INVARIANT_RUNS=1000).
env_args=()
while IFS= read -r name; do env_args+=(-e "$name"); done < <(env | sed -n 's/^\(FOUNDRY_[A-Z0-9_]*\)=.*/\1/p')
# and the deploy scripts' settings (names only: values never appear on the command line).
for name in FIRST_CUTOFF SEED_WALLETS MULTISIG USDC RANDOMNESS TREASURY BUYBACK_RESERVE ANCHORER \
  TIMELOCK_DELAY DEPLOYER_PRIVATE_KEY ADMIN_ADDRESS KEEPER_ADDRESS TREASURY_ADDRESS BUYBACK_ADDRESS \
  TESTNET_NETWORK VRF_SUBSCRIPTION_ID VRF_COORDINATOR VRF_KEY_HASH VRF_CALLBACK_GAS_LIMIT \
  VRF_REQUEST_CONFIRMATIONS VRF_NATIVE_PAYMENT ETHERSCAN_API_KEY; do
  if [[ -n "${!name:-}" ]]; then env_args+=(-e "$name"); fi
done
# Inside the container, localhost is the container itself: point RPC URLs for a chain on this
# machine (e.g. Anvil from docker-compose on :8545) at the host instead.
args=()
for a in "$@"; do
  a="${a//:\/\/localhost:/://host.docker.internal:}"
  args+=("${a//:\/\/127.0.0.1:/://host.docker.internal:}")
done
exec docker run --rm ${env_args[@]+"${env_args[@]}"} --add-host=host.docker.internal:host-gateway \
  -v "$ROOT":/repo -w /repo/packages/contracts \
  --entrypoint forge ghcr.io/foundry-rs/foundry:latest ${args[@]+"${args[@]}"}
