#!/usr/bin/env bash
# Runs Foundry's forge inside packages/contracts.
# Uses a local Foundry install if there is one; otherwise falls back to Foundry's Docker image.
# (Watch out: Laravel Herd ships an unrelated `forge` command.)
set -euo pipefail
cd "$(dirname "$0")/../packages/contracts"
if command -v forge >/dev/null 2>&1 && forge --version 2>/dev/null | grep -qi 'forge version'; then
  exec forge "$@"
fi
exec docker run --rm -v "$PWD":/work -w /work --entrypoint forge ghcr.io/foundry-rs/foundry:latest "$@"
