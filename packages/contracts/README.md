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
  - Done (#28): invariant and fuzz suite (see Tests below); 100% line, statement, branch and
    function coverage on `DailyDraw.sol`.
- `interfaces/IRandomnessProvider.sol`: randomness behind an adapter, so Chainlink VRF or another
  verifiable random function can be plugged in per chain (#24 decides the first chain).
- `script/DeployDailyDraw.s.sol`: deploys the implementation, the ERC-1967 proxy and the
  timelock, with the roles above; the deployer keeps nothing. Env: `MULTISIG`, `USDC`,
  `RANDOMNESS`, `TREASURY`, `BUYBACK_RESERVE`, `FIRST_CUTOFF`.
- `DrawAnchor.sol`: anchors naira draws' commitments and ticket Merkle roots (R3).
- `dev/DevUSDC.sol` and `dev/DevRandomness.sol`: local chain and testnet demo only. Test USDC with a
  public `faucet()` ($100) and `mint` (up to $10,000 a call); a randomness provider whose answer the
  operator sends by hand (`fulfill(requestId, value)`). Not random: never deploy it for real money.
- `script/DeployLocal.s.sol`: DevUSDC + DevRandomness + `DeployDailyDraw` with the deployer in every
  role, first cutoff the next 8:45pm WAT, $1,000 test USDC to Anvil accounts 1-5. Writes
  `deployments/<chainId>.json` (git-ignored). Run through `pnpm dev:chain` (root README).

## TypeScript

`ts/abi.ts` holds the ABIs as `as const` exports (`dailyDrawAbi`, `devUsdcAbi`,
`devRandomnessAbi`) for viem and wagmi; the package is `@daily-draw/contracts`. It is generated
from `forge build` output and checked in, so TypeScript builds don't need Foundry. After changing a
contract:

```bash
pnpm contracts:build && pnpm contracts:abi
```

CI fails if the file is stale (`node scripts/abi.mjs --check` in the contracts job).

`scripts/dev-chain.ts` (`pnpm dev:chain`) and `scripts/chain.ts` (`pnpm chain status | close | draw
[NN] | faucet <address> [$] | warp <hours>`) drive a local Anvil chain. `./scripts/forge.sh` points
`localhost` RPC URLs at the host when it falls back to Docker.

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

- `test/DevDeploy.t.sol`: the local demo setup: cutoff time, faucet, and a full buy, close,
  hand-triggered draw and claim.
- `test/EdgeCases.t.sol`: input checks not covered elsewhere (zero addresses, past first cutoff,
  closing a draw that isn't open), for full coverage.

### Invariant suite (`test/invariant/`)

`DailyDrawHandler.sol` plays random sequences of bounded actions by five players, a referrer who
never plays, the keeper and the multisig: buying (bundles of 1/2/5/10, numbers in range and out,
referrers that are another player, the outsider, the player themselves or none, and buys at or
after the cutoff), closing, fulfilling through the mock provider (pending, duplicate and late
fulfilments), fulfilling as a stranger, `claim`, keeper `claimFor`, `claimReferral`,
`withdrawTreasury` / `withdrawBuyback`, `voidDraw` (admin, or anyone after 24 hours), `refund`,
`sweepUnclaimed`, `pause` / `unpause`, `setParams` (valid variations and invalid sets), time jumps,
and stray USDC sent straight to the contract. Every game call is wrapped in try/catch; after each
accepted action the handler checks exact amounts and recipients and records any breach. Ghost
variables keep an independent record of every token in and out, every ticket, every payment per
ticket and every referrer change.

`DailyDraw.invariants.t.sol` checks, after every call:

1. The USDC balance covers everything owed (`owed()`), and equals it plus stray tokens.
2. Per settled draw: pool = sales + rollover in; prizes + referral shares + company share
   never exceed the pool, and the leftover is exactly what rolled over.
3. No ticket accepted at or after a draw's cutoff (or beyond the wallet limit), and no ticket
   added once a draw has closed.
4. A draw's winning number is set at most once, only by the provider's callback, and never
   changes; duplicate and late fulfilments change nothing.
5. Every ticket is paid at most once (prize or refund, never both) and its referral share
   credited at most once.
6. A player's referrer is set at most once, on their first play, and never to themselves.
7. Nobody moves money outside the rules: USDC in = USDC out (per category) + balance; treasury
   and buy-back receive exactly what was withdrawn; every token sits with a known party; the
   referral and unclaimed-winnings totals match their parts.

At the end of each run `afterInvariant` settles every pending draw, claims every prize, refunds
every voided ticket and withdraws every balance, then checks that only the rollover, open draws'
money and stray tokens remain.

Settings in `foundry.toml`: 256 runs of depth 100 (25,600 calls), `fail_on_revert = false`. About
40 seconds in the Docker fallback on a Mac. Run just the suite, or a deeper search:

```bash
./scripts/forge.sh test --match-path 'test/invariant/*'
FOUNDRY_INVARIANT_RUNS=2000 ./scripts/forge.sh test --match-path 'test/invariant/*'
```

Coverage (unit tests alone reach 100% on `DailyDraw.sol`; leaving the invariant suite out keeps
it quick):

```bash
./scripts/forge.sh coverage --report summary --no-match-contract DailyDrawInvariants
```

## Libraries

Git submodules in `lib/`, pinned to OpenZeppelin v5.7.0: `openzeppelin-contracts` and
`openzeppelin-contracts-upgradeable`, plus `forge-std`. After cloning:

```bash
git submodule update --init
```
