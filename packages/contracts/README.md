# packages/contracts

Foundry project. Run from the repo root with `pnpm contracts:test` (uses `./scripts/forge.sh`,
which picks a local Foundry install or falls back to Docker).

## Contracts

- `DailyDraw.sol`: the on-chain game (R1). Upgradeable (UUPS) behind an ERC-1967 proxy.
  - Done (#25): daily draws with their own copy of the params, ticket bundles of 1, 2, 5 or 10,
    10% fee held with the draw, per-wallet limit, referrer set once on first play, cutoff,
    `closeDraw` (anyone, after the cutoff) and `fulfillRandomness` (randomness provider only).
  - Next: settlement with the 65/15/20 split, referral credits and claims (#26); void, refund,
    sweep, pause and the 48-hour timelock (#27); invariant suite (#28).
- `interfaces/IRandomnessProvider.sol`: randomness behind an adapter, so Chainlink VRF or another
  verifiable random function can be plugged in per chain (#24 decides the first chain).
- `DrawAnchor.sol`: anchors naira draws' commitments and ticket Merkle roots (R3).

## Libraries

Git submodules in `lib/`, pinned to OpenZeppelin v5.7.0: `openzeppelin-contracts` and
`openzeppelin-contracts-upgradeable`, plus `forge-std`. After cloning:

```bash
git submodule update --init
```
