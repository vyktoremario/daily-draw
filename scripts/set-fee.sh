#!/usr/bin/env bash
# `pnpm testnet:set-fee`: change the ticket fee on the deployed testnet game through its timelock
# (#44: 10% -> 2%). Reads the repo's .env and the addresses in
# packages/contracts/deployments/<TESTNET_NETWORK>.json. Step by step: docs/testnet-runbook.md.
#
#   pnpm testnet:set-fee status               live fee and where the change stands; sends nothing
#   pnpm testnet:set-fee schedule --dry-run   simulate scheduling against the live chain
#   pnpm testnet:set-fee schedule             schedule the change (Admin wallet)
#   pnpm testnet:set-fee execute --dry-run    simulate executing it
#   pnpm testnet:set-fee execute              execute it, once the timelock delay (1 hour) has passed
#
# Add --fee=<bps> for a fee other than 200 (2%). Only `feeBps` changes; every other setting is
# read from the live contract and kept. The draw that's open keeps its fee; the next one uses the
# new fee. Keys are read from .env by forge itself; they are never printed or put on a command line.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mode=""
dry_run=false
fee=""
for arg in "$@"; do
  case "$arg" in
    status | schedule | execute) mode="$arg" ;;
    --dry-run) dry_run=true ;;
    --fee=*) fee="${arg#--fee=}" ;;
    *) echo "Unknown option: $arg (use status, schedule or execute; --dry-run; --fee=<bps>)" >&2; exit 2 ;;
  esac
done
if [[ -z "$mode" ]]; then
  echo "Say what to do: pnpm testnet:set-fee status | schedule | execute  [--dry-run] [--fee=<bps>]" >&2
  exit 2
fi
if [[ -n "$fee" && ! "$fee" =~ ^[0-9]+$ ]]; then
  echo "--fee takes basis points, e.g. --fee=200 for 2%." >&2
  exit 2
fi

if [[ ! -f .env ]]; then
  echo "No .env file. Run: cp .env.example .env   then fill it in (docs/testnet-runbook.md, step 4)." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env
set +a
if [[ -n "$fee" ]]; then export FEE_BPS="$fee"; fi
if [[ -z "${FEE_BPS:-}" ]]; then unset FEE_BPS; fi
export TESTNET_NETWORK="${TESTNET_NETWORK:-base-sepolia}"

if [[ -z "${TESTNET_RPC_URL:-}" ]]; then
  echo "Missing in .env: TESTNET_RPC_URL" >&2
  exit 1
fi
if [[ ! -f "packages/contracts/deployments/$TESTNET_NETWORK.json" ]]; then
  echo "No deployment file packages/contracts/deployments/$TESTNET_NETWORK.json." >&2
  exit 1
fi

args=(script script/SetFee.s.sol --sig "$mode()" --rpc-url "$TESTNET_RPC_URL")
if [[ "$mode" == status ]]; then
  unset ADMIN_PRIVATE_KEY
elif [[ "$dry_run" == true ]]; then
  # Simulate as the Admin address; the key isn't needed for that.
  unset ADMIN_PRIVATE_KEY
  if [[ -z "${ADMIN_ADDRESS:-}" ]]; then
    echo "Missing in .env: ADMIN_ADDRESS" >&2
    exit 1
  fi
  args+=(--sender "$ADMIN_ADDRESS")
else
  if [[ -z "${ADMIN_PRIVATE_KEY:-}" ]]; then
    echo "Missing in .env: ADMIN_PRIVATE_KEY (the Admin wallet's key; docs/testnet-runbook.md)." >&2
    exit 1
  fi
  # MetaMask exports private keys without the 0x prefix; forge wants it.
  if [[ "$ADMIN_PRIVATE_KEY" != 0x* ]]; then export ADMIN_PRIVATE_KEY="0x$ADMIN_PRIVATE_KEY"; fi
  if [[ ! "$ADMIN_PRIVATE_KEY" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
    echo "ADMIN_PRIVATE_KEY in .env doesn't look like a private key (64 hex characters)." >&2
    exit 1
  fi
  args+=(--broadcast --slow)
fi

echo "Fee change on $TESTNET_NETWORK via $TESTNET_RPC_URL: $mode$([[ "$dry_run" == true ]] && echo ' (dry run, nothing is sent)')"
"$ROOT/scripts/forge.sh" "${args[@]}"
