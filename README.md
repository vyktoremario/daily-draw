# Daily Draw

Working name for a daily number draw that anyone can verify. **Crypto first:** an on-chain game
paid in USDC launches first (testnet demo for grant applications, then mainnet). A licensed naira
product for Nigerian players follows later.

## The game

- One pool and one draw a day at 9:00pm WAT. Tickets cost $1 in USDC (₦100 for the later naira
  product), bought singly or in bundles of 2, 5 or 10. Players pick numbers from 00 to 99.
- A 2% fee is added on top of each ticket: players pay $1.02 (₦102); the full $1 goes into the
  pool and the 2c fee to the company.
- When someone wins, the pool is split **65% to winners**, **15% to the company** (10% team,
  5% to buy back and burn the project's token) and **20% to the winners' referrers**. A winner's
  referral share goes to the company if they had no active referrer.
- If nobody wins, the whole pool rolls over to the next draw.

## Documents (source of truth)

- [Requirements v0.2](https://docs.google.com/document/d/1ouSypXFgJxaIzD_uEvJussHTLsEnl1A_i55PVPDoC1Q/edit)
- [Design v0.2](https://docs.google.com/document/d/1pFn8AYeB3D-pX897zMvx9iNSKvbVz0u6S4uBBhXrnUs/edit)
- [Player app mockups (canvas)](https://claude.ai/artifact/LyzCSxALf65p8PSZADmdxi), source in
  `design/mockups/` (naira version; the crypto app reuses the screens with a connected wallet)
- [Tickets and milestones](https://github.com/vyktoremario/daily-draw/milestones)

## Releases

1. **R1, testnet demo:** `DailyDraw.sol` on a testnet with test USDC, connect-wallet web app,
   referrals, verifiable draws.
2. **R2, on-chain launch:** mainnet on the first chain (chosen for grant support) after the
   contract audit and legal advice on blocked countries.
3. **R3, naira launch:** API, ledger, bank-transfer wallets and automated withdrawals, after a
   state gaming licence.
4. **R4, wider reach:** USSD, WhatsApp and SMS; more chains, each with its own pools.

## Repository layout

```text
apps/
  api/        NestJS (Fastify) API for the naira product: the only code that moves naira (R3)
  worker/     pg-boss jobs: draw open, cutoff, draw, settle, outbox (R3)
  ussd/       Africa's Talking USSD handler, menus only (R4)
  web/        Next.js player app: connect wallet, USDC, referrals (R1); naira later (R3)
  admin/      Next.js admin console
  indexer/    Ponder indexer for contract events (R2, not started)
packages/
  shared/     Money, game rules, settlement, fairness protocol: pure, tested
  db/         Postgres migrations and typed Kysely client (naira ledger)
  contracts/  Foundry: DailyDraw.sol (the on-chain game), DrawAnchor.sol (naira draw anchors),
              typed ABIs for TypeScript, local-chain dev scripts
  ui/         Design tokens from the mockups
  api-client/ Generated API client (later)
  config/     TypeScript presets
docs/decisions/  Decision records
```

## Getting started

Requirements: Node 22, pnpm 10, Docker. Foundry is optional (the contract scripts fall back to
Docker). Note: Laravel Herd also ships a `forge` command; `./scripts/forge.sh` picks the right one.

```bash
pnpm install
cp .env.example .env
pnpm services:up          # Postgres, Redis, Anvil
pnpm db:migrate
pnpm build
pnpm test
pnpm contracts:test
```

Run the apps:

```bash
pnpm --filter @daily-draw/api dev      # http://localhost:4000/v1/health
pnpm --filter @daily-draw/worker dev
pnpm --filter @daily-draw/ussd dev     # POST http://localhost:4100/ussd
pnpm --filter @daily-draw/web dev      # http://localhost:3000
pnpm --filter @daily-draw/admin dev    # http://localhost:3001
```

## Local on-chain demo (R1)

The whole crypto loop (connect, buy, draw, claim, refer) runs on a local Anvil chain with test
USDC. Nothing here has real value.

```bash
pnpm install && pnpm build
pnpm dev:chain                         # starts Anvil (docker compose) if needed, deploys, writes apps/web/.env.local
pnpm --filter @daily-draw/web dev      # http://localhost:3000
```

`pnpm dev:chain` deploys `DevUSDC` (test USDC with a public faucet), `DevRandomness` (the operator
chooses the number by hand) and `DailyDraw` behind its proxy, gives Anvil accounts 1 to 5 $1,000
test USDC each, and writes the addresses to `packages/contracts/deployments/31337.json` and
`apps/web/.env.local`. Run it again after restarting Anvil, which forgets everything.

In the app, **Connect wallet** offers MetaMask (add the network: RPC `http://127.0.0.1:8545`, chain
id 31337, and import an Anvil test key) and, on Anvil only, **Dev wallet 1-5**: Anvil's unlocked
accounts, no extension needed. WalletConnect appears when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is
set (see `apps/web/.env.example`).

Drive the draw from a terminal (signs as Anvil account 0, the operator):

```bash
pnpm chain status                      # open draw, chain clock, rollover
pnpm chain draw 42                     # move the clock to 8:45pm WAT, close sales, draw 42
pnpm chain draw                        # same, with a random number
pnpm chain close                       # only close sales (the app shows "number on its way")
pnpm chain faucet 0xYourAddress 500    # mint test USDC
pnpm chain warp 2                      # move the chain clock 2 hours on
```

A demo script: open `http://localhost:3000/?ref=<Dev wallet 1 address>`, connect **Dev wallet 2**,
buy a bundle with 42 in it, switch to **Dev wallet 1** and buy a ticket (a referrer must have
played in the last 30 days to earn), then `pnpm chain draw 42`. Dev wallet 2 sees "You won" on Home
and claims on the reveal screen; Dev wallet 1 claims its referral share on Referrals.

Smoke test against the running chain: `pnpm --filter @daily-draw/web test:e2e` (Playwright; run
`pnpm --filter @daily-draw/web exec playwright install chromium` once).

Adding a chain (Base Sepolia, Celo Sepolia, …) is configuration: deploy, then set
`NEXT_PUBLIC_CHAIN` and the addresses in `apps/web/.env.local` (or the host's env). Chains the app
knows are listed in `apps/web/lib/config.ts`.

## Rules of the road

- Money is integers everywhere: kobo (`bigint`) for naira, USDC base units on-chain. Never floats.
- Only `apps/api` and `apps/worker` write to the naira database. Every money movement is a balanced
  ledger transaction with an idempotency key; the database rejects anything else.
- On-chain, no function loops over tickets, winners or referrers, and every money rule is covered
  by an invariant test.
- Play money and testnets only outside production.

## SDLC status

1. Planning: done
2. Requirements: v0.2 (crypto first, 65/15/20 split), a few rules still to confirm
3. Design: v0.2 and player mockups
4. Build: CI, naira ledger service, settlement with the 65/15/20 split and referrals (#23),
   `DailyDraw.sol` (core, settlement and claims, safety and timelock, invariant suite: #25-#28)
   and the crypto player app (#12) done; next is the testnet deployment (#29)
