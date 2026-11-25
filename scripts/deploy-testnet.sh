#!/usr/bin/env bash
# `pnpm testnet:deploy`: deploy Daily Draw to the public testnet configured in the repo's .env
# (Base Sepolia by default) and verify the contracts on the block explorer.
# Step-by-step guide: docs/testnet-runbook.md.
#
#   pnpm testnet:deploy --dry-run  check .env and simulate the deployment; sends nothing
#   pnpm testnet:deploy            deploy, verify, write packages/contracts/deployments/<network>.json
#   pnpm testnet:deploy --resume   retry the last deployment's unsent transactions and verification
#   pnpm testnet:deploy --force    deploy again although a deployment file already exists
#
# Keys are read from .env by forge itself; they are never printed or put on a command line.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mode=deploy
force=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) mode=dry-run ;;
    --resume) mode=resume ;;
    --force) force=true ;;
    *) echo "Unknown option: $arg (use --dry-run, --resume or --force)" >&2; exit 2 ;;
  esac
done

if [[ ! -f .env ]]; then
  echo "No .env file. Run: cp .env.example .env   then fill it in (docs/testnet-runbook.md, step 3)." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

# Optional settings left empty in .env mean "use the default": forge would read an empty value as
# an invalid address or number, so drop them.
for name in TREASURY_ADDRESS BUYBACK_ADDRESS VRF_COORDINATOR VRF_KEY_HASH VRF_CALLBACK_GAS_LIMIT \
  VRF_REQUEST_CONFIRMATIONS VRF_NATIVE_PAYMENT TIMELOCK_DELAY FIRST_CUTOFF SEED_WALLETS; do
  if [[ -z "${!name:-}" ]]; then unset "$name"; fi
done

missing=()
required=(TESTNET_RPC_URL DEPLOYER_PRIVATE_KEY ADMIN_ADDRESS KEEPER_ADDRESS VRF_SUBSCRIPTION_ID)
if [[ "$mode" != dry-run ]]; then required+=(ETHERSCAN_API_KEY); fi
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then missing+=("$name"); fi
done
if (( ${#missing[@]} )); then
  echo "Missing in .env: ${missing[*]}" >&2
  exit 1
fi

# MetaMask exports private keys without the 0x prefix; forge wants it.
if [[ "$DEPLOYER_PRIVATE_KEY" != 0x* ]]; then export DEPLOYER_PRIVATE_KEY="0x$DEPLOYER_PRIVATE_KEY"; fi
if [[ ! "$DEPLOYER_PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
  echo "DEPLOYER_PRIVATE_KEY in .env doesn't look like a private key (64 hex characters)." >&2
  exit 1
fi

network="${TESTNET_NETWORK:-base-sepolia}"
export TESTNET_NETWORK="$network"
deployment="packages/contracts/deployments/$network.json"
if [[ "$mode" == deploy && -f "$deployment" && "$force" != true ]]; then
  echo "$deployment already exists: Daily Draw is already deployed on $network." >&2
  echo "To deploy a fresh copy anyway (new addresses, new VRF consumer to add): pnpm testnet:deploy --force" >&2
  exit 1
fi

if [[ "$mode" == dry-run ]]; then
  # Simulate against the live chain under a throwaway name, so the real file isn't created.
  export TESTNET_NETWORK="$network-dry-run"
  echo "Simulating the deployment on $network via $TESTNET_RPC_URL (nothing is sent) ..."
  "$ROOT/scripts/forge.sh" script script/DeployTestnet.s.sol --rpc-url "$TESTNET_RPC_URL"
  rm -f "packages/contracts/deployments/$network-dry-run.json"
  echo
  echo "Dry run OK: .env is complete and the deployment simulates cleanly."
  echo "The 'Estimated amount required' above is the ETH the deployer wallet needs."
  echo "Deploy for real with: pnpm testnet:deploy"
  exit 0
fi

args=(script script/DeployTestnet.s.sol --rpc-url "$TESTNET_RPC_URL" --broadcast --slow
  --verify --retries 10 --delay 15)
if [[ "$mode" == resume ]]; then args+=(--resume); fi

echo "Deploying to $network via $TESTNET_RPC_URL ..."
"$ROOT/scripts/forge.sh" "${args[@]}"

echo
echo "Done. Addresses: $deployment"
echo "Next: pnpm testnet:info   (what to paste into vrf.chain.link, GitHub and Vercel)"
