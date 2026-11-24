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
  - Done (#27): `voidDraw(drawId, reason)` for a draw that closed but got no random number (the
    admin at any time, anyone after 24 hours); its sales and fees never reach the pool or the
    treasury, and a late random number for it is ignored. `refund(drawId, numbers)` returns price
    plus fee for each of the caller's tickets, once per number (params must give a whole fee per
    ticket, so refunds are exact). `sweepUnclaimed(drawId)` (anyone, `unclaimedPrizeDays` = 30
    after settlement) moves unclaimed prizes and their referral shares into the rollover; the draw
    becomes `Swept` and its claims revert. `pause()` / `unpause()` (`PAUSER_ROLE`) stop buying and
    closing only; claims, referral claims, voiding, refunds, sweeps, withdrawals and the randomness
    callback keep working.
  - Roles: the 2-of-3 Safe holds `DEFAULT_ADMIN_ROLE` (treasury/buy-back addresses, keepers,
    voiding) and `PAUSER_ROLE`. A 48-hour `TimelockController` (Safe = proposer, canceller and
    executor) holds `PARAMS_ROLE` (`setParams`, `setRandomnessProvider`) and `UPGRADER_ROLE`.
    `UPGRADER_ROLE` administers both timelocked roles, so the Safe can't grant them to itself.
  - Next: invariant suite (#28).
- `interfaces/IRandomnessProvider.sol`: randomness behind an adapter, so Chainlink VRF or another
  verifiable random function can be plugged in per chain (#24 decides the first chain).
- `script/DeployDailyDraw.s.sol`: deploys the implementation, the ERC-1967 proxy and the
  timelock, with the roles above; the deployer keeps nothing. Env: `MULTISIG`, `USDC`,
  `RANDOMNESS`, `TREASURY`, `BUYBACK_RESERVE`, `FIRST_CUTOFF`.
- `DrawAnchor.sol`: anchors naira draws' commitments and ticket Merkle roots (R3).

## Tests

- `test/DailyDraw.t.sol`: buying, limits, referrer registration, closing and randomness.
- `test/Settlement.t.sol`: settlement, rollover, claims, keeper claims, referral credits, and a
  fuzz test that the contract's USDC balance always equals what it owes.
- `test/Safety.t.sol`: void and refund, sweep, pause and the timelocked roles.
- `test/Deploy.t.sol`: runs the deploy script against mocks; params changes and upgrades only go
  through the timelock, and only after 48 hours.
- Every test checks that the contract's USDC balance equals what it owes (`assertSolvent`).
- `test/SettlementVectors.t.sol`: runs every case in `packages/shared/test-vectors/settlement.json`
  through settlement and claims (via `test/harness/DailyDrawHarness.sol`, which seeds draw state),
  so the contract matches the TypeScript reference exactly.

## Libraries

Git submodules in `lib/`, pinned to OpenZeppelin v5.7.0: `openzeppelin-contracts` and
`openzeppelin-contracts-upgradeable`, plus `forge-std`. After cloning:

```bash
git submodule update --init
```
