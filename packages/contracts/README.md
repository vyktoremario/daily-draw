# packages/contracts

Foundry project. Run from the repo root with `pnpm contracts:test` (uses `./scripts/forge.sh`,
which picks a local Foundry install or falls back to Docker).

## Contracts

- `DailyDraw.sol`: the on-chain game (R1). Upgradeable (UUPS) behind an ERC-1967 proxy.
  - Done (#25): daily draws with their own copy of the params, ticket bundles of 1, 2, 5 or 10,
    10% fee held with the draw, per-wallet limit, referrer set once on first play, cutoff,
    `closeDraw` (anyone, after the cutoff) and `fulfillRandomness` (randomness provider only).
  - Done (#26): settlement in the randomness callback. Pool = sales (fees excluded) + the
    contract-level `rollover`. No winner: the whole pool rolls over. Otherwise each winning ticket
    gets 65% / winners as its prize and 20% / winners as its referral share; 10% plus the draw's
    fees are credited to `treasuryBalance`, 5% to `buybackBalance`, rounding dust to `rollover`.
    Settlement moves no tokens, so a frozen or misconfigured treasury can't make the randomness
    callback revert (a VRF provider won't redeliver). `withdrawTreasury()` / `withdrawBuyback()`
    (anyone may call; money only to the current `treasury` / `buybackReserve`) pay them out.
    `claim(drawId, numbers)` pays the prize and credits each ticket's referral share to the
    winner's referrer if they bought a ticket within `referrerActiveDays` (30) before the draw's
    cutoff, otherwise to `treasuryBalance`. `claimFor(player, drawId)` (keeper, 24 hours after
    settlement, money to the player only) and `claimReferral()`. Players' purchase history is kept
    per draw (OpenZeppelin `Checkpoints`) so activity is checked as of the draw's cutoff, without
    loops.
  - Next: void, refund, unclaimed-prize sweep, pause and the 48-hour timelock (#27); invariant
    suite (#28).
- `interfaces/IRandomnessProvider.sol`: randomness behind an adapter, so Chainlink VRF or another
  verifiable random function can be plugged in per chain (#24 decides the first chain).
- `DrawAnchor.sol`: anchors naira draws' commitments and ticket Merkle roots (R3).

## Tests

- `test/DailyDraw.t.sol`: buying, limits, referrer registration, closing and randomness.
- `test/Settlement.t.sol`: settlement, rollover, claims, keeper claims, referral credits, and a
  fuzz test that the contract's USDC balance always equals what it owes.
- `test/SettlementVectors.t.sol`: runs every case in `packages/shared/test-vectors/settlement.json`
  through settlement and claims (via `test/harness/DailyDrawHarness.sol`, which seeds draw state),
  so the contract matches the TypeScript reference exactly.

## Libraries

Git submodules in `lib/`, pinned to OpenZeppelin v5.7.0: `openzeppelin-contracts` and
`openzeppelin-contracts-upgradeable`, plus `forge-std`. After cloning:

```bash
git submodule update --init
```
