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
exec docker run --rm ${env_args[@]+"${env_args[@]}"} -v "$ROOT":/repo -w /repo/packages/contracts \
  --entrypoint forge ghcr.io/foundry-rs/foundry:latest "$@"
