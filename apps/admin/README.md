# Admin dashboard (`@daily-draw/admin`)

A read-only dashboard for the founders (issue #14). It reads the `DailyDraw` contract and its
events straight from the chain: no wallet, no transactions, no buttons that move money or change
settings. Those go through the Admin wallet and the timelock (see `docs/testnet-runbook.md`).

One page, refreshed every 60 seconds:

- **Health**: is last night's draw closed and drawn (flags a draw still open after its cutoff, or
  closed without a random number), contract paused, USDC held vs owed, keeper ETH and
  `KEEPER_ROLE`, LINK (or ETH) left in the VRF subscription and whether the randomness adapter is a
  consumer, drip wallet ETH (#46) when configured, pending timelock changes, failed reads.
- **Today's draw**: status, time to cutoff, tickets and players, sales, fees, pool (with the
  rollover it would bring in), tickets per number.
- **Money**: what the contract holds against everything it owes (unsettled draws, rollover,
  unclaimed prizes, referral balances, treasury and buy-back balances, refunds); treasury and
  buy-back waiting to be withdrawn; draws with unclaimed prizes and when they can be swept.
- **Past draws**: winning number, winners, prize and referral share per ticket, team, buy-back,
  rollover in and out, claims, voided draws and their refunds.
- **Settings**: the current params and any call scheduled on the timelock against the game
  (decoded; `setParams` shows the new values) that hasn't been executed or cancelled.
- **Players**: players, tickets, new players and tickets per draw (one draw a day), players with a
  referrer, top referrers.

Not yet: naira ledger figures (R3), SSO and 2FA (R3; basic auth for now).

## How it works

- `lib/config.ts`: settings from server-side env vars, defaulting from
  `packages/contracts/deployments/<DEPLOYMENT>.json` (Base Sepolia by default).
- `lib/chain.ts`: one snapshot per request with viem's public client. The VRF coordinator and
  subscription id come from the randomness adapter itself when not set. Events are scanned from
  the deployment block in chunks (`lib/logs.ts`, shrinking when the RPC refuses a range);
  scanned blocks older than 30 are cached in memory between requests. No indexer yet, which is
  fine at testnet scale.
- `lib/figures.ts`: all the arithmetic (owed vs held, settlement split, sweep dates, per-draw
  aggregates, health thresholds) as pure functions with unit tests. `lib/health.ts` assembles the
  checks.
- `proxy.ts` (Next.js 16's name for middleware): HTTP basic auth on every page.

## Run it locally

Against Base Sepolia, with no setup (all defaults come from the committed deployment file):

```bash
pnpm --filter @daily-draw/admin dev
```

Open http://localhost:3001. Without `ADMIN_USER` / `ADMIN_PASSWORD` the dev server lets you in;
to try the password prompt, copy `.env.example` to `.env.local` and fill them in.

Against the local Anvil chain (`pnpm dev:chain`), put in `apps/admin/.env.local`:

```
DEPLOYMENT=none
CHAIN_ID=31337
DAILY_DRAW_ADDRESS=<from apps/web/.env.local>
TIMELOCK_ADDRESS=<from packages/contracts/deployments/31337.json>
```

(The local chain uses a dev randomness provider, so the VRF check shows "could not read".)

Checks:

```bash
pnpm --filter @daily-draw/admin test
```

```bash
pnpm --filter @daily-draw/admin typecheck
```

## Deploy (a second Vercel project)

1. [vercel.com/new](https://vercel.com/new) → import the `daily-draw` repository again (a new
   project next to the player app).
2. **Root Directory**: `apps/admin`. Framework: Next.js. Leave the build and install commands:
   `apps/admin/vercel.json` sets them.
3. **Environment Variables** (Production, and Preview if you use preview deployments):

   ```
   ADMIN_USER=<a user name>
   ADMIN_PASSWORD=<a long random password>
   DEPLOYMENT=base-sepolia
   ```

   Add `DRIP_WALLET_ADDRESS=0x…` once the gas drip (#46) has a wallet. Everything else is
   optional; see `.env.example`. Generate a password with `openssl rand -base64 24` and share it
   through a password manager.

4. **Deploy**. The site asks for the user name and password. Without them set it answers
   "503: Set ADMIN_USER and ADMIN_PASSWORD".
5. Optional: **Settings → Deployment Protection** → Vercel Authentication, to also require a
   Vercel login from your team.

Changing a variable: **Settings → Environment Variables**, then redeploy. A new deployment file
(e.g. after `pnpm testnet:deploy --force`) is picked up on the next deploy from `main`.

## Notes

- Basic auth sends the password with every request; it is only safe over HTTPS (Vercel always
  uses HTTPS). Use a password nobody uses elsewhere.
- `RPC_URL` must accept long `eth_getLogs` ranges. `sepolia.base.org` caps them at 200 blocks; the
  dashboard copes by chunking but a cold start then takes many requests. The default on Base
  Sepolia is Tenderly's public gateway.
- The figures are only as fresh as the latest block; each page load reads them again.
