# Testnet runbook: Daily Draw on Base Sepolia

This guide puts Daily Draw on **Base Sepolia** (a public test network, chain ID 84532) so you can
demo it with real Chainlink randomness, test USDC from a faucet, a keeper bot that closes each
draw, and the web app hosted on Vercel. Nothing here uses real money.

Follow the steps in order. Commands are run in a terminal from the repository folder
(`daily-draw`). Copy them exactly.

> **Keys stay private.** A private key controls a wallet. Put private keys only in the `.env`
> file on your computer (git ignores it) and in GitHub's encrypted secrets. Never paste one into
> a chat, an issue, a commit, Slack or email, and never use these testnet wallets on a mainnet.

## What you already have

- MetaMask with three accounts: **Admin** `0xECfeb88A1fFcce1d7dec2Dbc9Ef53dc4301D109f`,
  **Deployer** `0xAd8651F021315e25fd73ED6f7957b9e9ed362162`, **Keeper**
  `0x9032f538d36fD201D019d11361FDBb1EE72D1034`.
- Base Sepolia added to MetaMask, with test ETH in all three accounts.
- A Chainlink VRF v2.5 subscription on Base Sepolia, funded with 10 LINK from the Admin wallet.

## What each wallet does

| Wallet   | Role after deployment                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Admin    | Pauses the game, voids a stuck draw, proposes setting changes and upgrades (they wait 1 hour in the timelock), owns the VRF adapter. |
| Deployer | Pays for the deployment. Holds **no** role afterwards.                                                                               |
| Keeper   | Closes each draw after 8:45pm WAT and claims prizes for winners who haven't claimed after 24 hours (prizes always go to the winner). |

## What gets deployed

| Contract                             | What it is                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Test USDC (`DevUSDC`)                | A USDC look-alike (6 decimals) with a public faucet: anyone can get $100 at a time.         |
| VRF adapter (`ChainlinkVrfProvider`) | Asks Chainlink VRF v2.5 for the random number and passes it to the game.                    |
| Timelock                             | Delays setting changes and upgrades by `TIMELOCK_DELAY` (1 hour here, 48 hours on mainnet). |
| DailyDraw (proxy + implementation)   | The game. Everyone uses the proxy address.                                                  |

Chainlink's Base Sepolia values, from
[docs.chain.link/vrf/v2-5/supported-networks](https://docs.chain.link/vrf/v2-5/supported-networks)
(read 25 November 2026) and built into the deploy script:

- VRF coordinator: `0x5C210eF41CD1a72de73bF76eC39637bB0d3d7BEE`
- Key hash (30 gwei lane): `0x9e1344a1247c8a1785d0a4681a27152bffdb43666ae5bf7d14d24a5efd44bf71`
- LINK token: `0xE4aB69C077896252FAFBD49EFD26B5D171A32410`

---

## Step 1. Get the code ready

You need Node 22, pnpm and Docker Desktop (running). Then:

```bash
git checkout main
```

```bash
git pull
```

```bash
git submodule update --init
```

```bash
pnpm install
```

The contract tools (Foundry) run inside Docker through `./scripts/forge.sh`; you don't install
anything else. (The `forge` command that Laravel Herd installs is a different program; the
scripts avoid it.)

## Step 2. Get an Etherscan API key (for verified contracts on BaseScan)

Verified contracts show their source code on BaseScan, so anyone can read what they do.

1. Go to [etherscan.io/register](https://etherscan.io/register) and create a free account.
2. Open [etherscan.io/apidashboard](https://etherscan.io/apidashboard) and click **Add** to create
   an API key. One Etherscan key works for BaseScan too.
3. Keep the tab open; you paste the key in step 4.

## Step 3 (optional). Get a WalletConnect project ID

Without it the web app still works with browser wallets (MetaMask in the browser or MetaMask's
in-app browser on a phone). With it, players can also connect a phone wallet by QR code.

1. Go to [cloud.reown.com](https://cloud.reown.com) (WalletConnect is now called Reown) and sign up.
2. Create a project (type: **AppKit**, any name, e.g. "Daily Draw testnet").
3. Copy the **Project ID**. After you have the Vercel address (step 9), add it under the
   project's allowed domains.

## Step 4. Fill in `.env`

```bash
cp .env.example .env
```

Open `.env` in your editor and fill in the testnet section near the bottom:

| Variable                               | What to put                                                                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TESTNET_RPC_URL`                      | Leave `https://sepolia.base.org`.                                                                                                                                                                                                            |
| `DEPLOYER_PRIVATE_KEY`                 | MetaMask → switch to **Deployer** → account menu (⋮) → **Account details** → **Show private key** → enter your MetaMask password → copy. Paste it after the `=` (with or without `0x`).                                                      |
| `KEEPER_PRIVATE_KEY`                   | The same for the **Keeper** account. (Only needed to run the keeper from your computer; GitHub gets its own copy in step 7.)                                                                                                                 |
| `ADMIN_ADDRESS`, `KEEPER_ADDRESS`      | Already filled in with the addresses above.                                                                                                                                                                                                  |
| `VRF_SUBSCRIPTION_ID`                  | At [vrf.chain.link](https://vrf.chain.link) (network **Base Sepolia**, Admin wallet connected) open your subscription and copy the **full** ID with its copy button. It's a long number (the list shows it shortened, like `551545...2655`). |
| `ETHERSCAN_API_KEY`                    | The key from step 2.                                                                                                                                                                                                                         |
| `TIMELOCK_DELAY`                       | Leave `3600` (1 hour).                                                                                                                                                                                                                       |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | The ID from step 3, or leave empty.                                                                                                                                                                                                          |

Leave everything else as it is. Empty optional values mean "use the default": the team (10%) and
buy-back (5%) shares go to the Admin address, and the first draw closes at the next 8:45pm WAT.

Save the file. Check that git ignores it (this must print `.env`):

```bash
git check-ignore .env
```

## Step 5. Deploy

First a dry run. It checks `.env`, simulates the whole deployment against Base Sepolia and sends
nothing:

```bash
pnpm testnet:deploy --dry-run
```

It ends with `Dry run OK`, and above that `Estimated amount required: 0.0001... ETH`, which is
what the Deployer needs (about 0.0001 ETH; you have more). If it says something is missing, fix
`.env` and run it again.

Then deploy for real:

```bash
pnpm testnet:deploy
```

This takes a few minutes: about a dozen transactions, then verification on BaseScan. Success
looks like `ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`, then a verification message for each contract,
and finally:

```
Done. Addresses: packages/contracts/deployments/base-sepolia.json
```

- **If verification fails** (BaseScan is sometimes slow) but the deployment succeeded, retry just
  the verification: `pnpm testnet:deploy --resume`
- **If the deployment stopped halfway** (network error), run `pnpm testnet:deploy --resume`; it
  sends the transactions that are missing.
- Running `pnpm testnet:deploy` again refuses, because `base-sepolia.json` exists; that protects
  you from deploying a second copy by accident. Only if you really want a fresh copy (new
  addresses): `pnpm testnet:deploy --force`, and then redo steps 6 to 9.

## Step 6. Print what to paste where

```bash
pnpm testnet:info
```

It prints the BaseScan links, the VRF adapter address for the next step, and the Vercel
environment variables for step 9. Run it again whenever you need them.

## Step 7. Add the VRF adapter as a consumer of your subscription

The subscription only pays for randomness requested by its consumers. Until you do this, closing
a draw fails (the draw stays open; nothing is lost).

1. Go to [vrf.chain.link](https://vrf.chain.link), network **Base Sepolia**, and connect the
   **Admin** wallet (the subscription's owner).
2. Open your subscription → **Add consumer**.
3. Paste the **VRF adapter** address from `pnpm testnet:info` (the `randomness` address in
   `base-sepolia.json`), not the DailyDraw address.
4. Confirm the transaction in MetaMask. The subscription page now shows **Consumers: 1**.
5. While you're there, check the balance shows your 10 LINK. Each draw's random number costs a
   small amount of LINK; check the balance about once a week and top it up from the
   [Chainlink faucet](https://faucets.chain.link/base-sepolia) when it gets low.

## Step 8. Commit the deployment file and set up the keeper on GitHub

The keeper and the team read the addresses from
`packages/contracts/deployments/base-sepolia.json`, so commit it (it holds addresses only, no
secrets) and get it onto `main` the usual way (branch and pull request). GitHub only runs scheduled
workflows from `main`, so the keeper starts once this work and that file are merged.

Then add the keeper's key as an encrypted secret:

1. GitHub → the `daily-draw` repository → **Settings** → **Secrets and variables** → **Actions**.
2. **Secrets** tab → **New repository secret**. Name: `KEEPER_PRIVATE_KEY`. Value: the Keeper
   account's private key (from MetaMask, as in step 4). **Add secret**. GitHub never shows it again
   and hides it in logs.
3. Recommended: **Variables** tab → **New repository variable**. Name: `TESTNET_RPC_URL`. Value:
   `https://base-sepolia.gateway.tenderly.co`. (The default `https://sepolia.base.org` works too,
   but it only lets the keeper look 200 blocks (about 7 minutes) at a time, so finding winners
   takes about 90 seconds per day of sales instead of a second or two.)

Check it works: **Actions** tab → **Keeper** → **Run workflow** → tick **Only look and log** →
**Run workflow**. Open the run; the "Run the keeper" step should end with
`Done: 0 closed, 0 claimed, 0 warning(s), 0 failure(s)`.

What the schedule does (all times WAT):

| When   | What                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| 8:47pm | Closes the draw (sales closed at 8:45pm) and asks Chainlink for the number. It arrives in a minute or two.   |
| 9:17pm | Retries anything missed (GitHub sometimes delays scheduled runs) and claims for winners from the day before. |
| 9:17am | Claims, and a late close if both evening runs were missed.                                                   |

Every run does everything that is due and nothing that isn't, so extra runs (scheduled, manual or
local) are harmless. A failure shows as a red run, and GitHub emails whoever last changed the workflow's schedule.

To run the keeper from your computer (uses `KEEPER_PRIVATE_KEY` from `.env`):

```bash
pnpm keeper
```

To only look:

```bash
pnpm keeper --dry-run
```

## Step 9. Host the web app on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the `daily-draw` GitHub repository
   (give Vercel access to it if asked).
2. **Root Directory**: click **Edit** and choose `apps/web`. Framework: **Next.js** (detected).
   Leave the build and install commands alone: `apps/web/vercel.json` sets them.
3. Open **Environment Variables** and add the lines `pnpm testnet:info` printed under
   "Vercel". You can copy the whole block and paste it into the first **Key** box; Vercel splits
   it into variables. It looks like this, with your addresses:

   ```
   NEXT_PUBLIC_CHAIN=baseSepolia
   NEXT_PUBLIC_RPC_URL=https://base-sepolia.gateway.tenderly.co
   NEXT_PUBLIC_DAILY_DRAW_ADDRESS=0x...
   NEXT_PUBLIC_USDC_ADDRESS=0x...
   NEXT_PUBLIC_START_BLOCK=12345678
   NEXT_PUBLIC_FAUCET=true
   NEXT_PUBLIC_DEV_WALLETS=false
   NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
   ```

   `NEXT_PUBLIC_RPC_URL` matters: the app reads ticket and referral history in one request from
   the deployment block onwards, and the default public endpoint (`sepolia.base.org`) refuses
   anything over 200 blocks, so history would stop loading minutes after deployment. Tenderly's
   free public endpoint accepted ranges of 10 million blocks (months of history) when we tested
   it. A proper indexer replaces this later.

4. Click **Deploy**. After a few minutes Vercel shows the site address, e.g.
   `https://daily-draw-xyz.vercel.app`.
5. If you set a WalletConnect ID, add that address to the project's allowed domains at
   cloud.reown.com.

Changing a variable later: Vercel → Project → **Settings** → **Environment Variables**, then
**Deployments** → ⋯ on the latest → **Redeploy** (the values are built into the site).

To try the testnet app on your computer instead:

```bash
pnpm testnet:info --write-web-env
```

```bash
pnpm --filter @daily-draw/web dev
```

and open http://localhost:3000. (This replaces `apps/web/.env.local`; run `pnpm dev:chain` to go
back to the local chain.)

## Step 10. Smoke test

Use a separate MetaMask account as a "player" (not Admin, Deployer or Keeper) with a little Base
Sepolia ETH for fees. Free test ETH:
[Coinbase faucet](https://portal.cdp.coinbase.com/products/faucet) or
[Alchemy faucet](https://www.alchemy.com/faucets/base-sepolia).

1. Open the Vercel site on your phone or computer and **Connect wallet**. If MetaMask asks to
   switch to Base Sepolia, accept.
2. **Wallet** → **Get $100 test USDC** → confirm in MetaMask. The balance shows $100.
3. **Play**: pick a number, choose a bundle, and buy. MetaMask asks twice: first to allow the game
   to take the exact amount of USDC, then the purchase. The ticket appears on the home screen.
   To see a win in the demo, spread tickets over many numbers (up to 20 per wallet per draw, and
   you can use more wallets).
4. Try a referral: copy your link from **Referrals**, open it with another wallet, and buy there.
5. Wait for **8:45pm WAT**: sales close. At about 8:47pm the keeper closes the draw (watch the
   **Actions** tab), and Chainlink delivers the number a minute or two later. Can't wait for the
   schedule? Right after 8:45pm run `pnpm keeper`, or **Actions** → **Keeper** → **Run workflow**.
6. **Results** shows the winning number. A winner claims straight away from the app.
7. If a winner doesn't claim, the keeper claims for them after 24 hours (around 9:17pm the next
   day) and the prize lands in their wallet.
8. Check everything on BaseScan from the links `pnpm testnet:info` prints: the contracts show a
   green ✓ "Contract Source Code Verified", and the DailyDraw page lists `closeDraw` and
   `fulfillRandomness` calls each day.

---

## Day-to-day

- **Nothing to do daily**: the keeper closes draws and Chainlink answers.
- **Weekly**: check the LINK balance at vrf.chain.link and the Keeper's ETH (the keeper warns in
  its log when it drops below 0.001 ETH).
- **Changing a setting or upgrading** goes through the timelock: the Admin wallet schedules it,
  waits `TIMELOCK_DELAY` (1 hour), then executes it. The ticket fee has its own command (next
  section). Pausing is immediate: BaseScan → DailyDraw → **Contract** → **Write as Proxy** →
  connect Admin → `pause`.

## Changing the ticket fee (10% → 2%)

The fee is 2% on top of the $1 price: players pay **$1.02** a ticket and the whole $1 goes into
the pool. Deployments from now on start at 2%. The game deployed before that change charges 10%
($1.10) until the Admin changes its `feeBps` setting from 1000 to 200, which goes through the
timelock: schedule it, wait 1 hour, execute it. No redeploy, and nothing else changes.

Each draw copies the settings when it opens, so **the draw that is open when the change executes
keeps $1.10** (its players paid $1.10 and refunds return exactly that). The first draw to charge
$1.02 is the one that opens after the next 8:45pm WAT close.

Order: change the contract first, then deploy the web app with the 2% code. The web app reads the
price and fee from the open draw itself, so it shows $1.10 until that draw closes and $1.02 after,
whichever is deployed first; but the contract change has to happen for the price to drop.

**1. Put the Admin key in `.env` (only for this).** MetaMask → switch to **Admin** → account menu
(⋮) → **Account details** → **Show private key** → copy, and paste it after `ADMIN_PRIVATE_KEY=`
in `.env` (add the line if your `.env` is older than this section). Never paste it anywhere else.

**2. Look first (sends nothing):**

```bash
pnpm testnet:set-fee status
```

It shows the open draw's fee (`1000 bps`), the live setting (`1000 bps -> new fee: 200 bps`) and
`Not scheduled yet`.

**3. Rehearse, then schedule.** The dry run simulates against Base Sepolia and sends nothing:

```bash
pnpm testnet:set-fee schedule --dry-run
```

```bash
pnpm testnet:set-fee schedule
```

Success looks like `Scheduled: setParams with feeBps 200`, then
`ONCHAIN EXECUTION COMPLETE & SUCCESSFUL`. Nothing changes for players yet.

**4. Wait 1 hour.** `pnpm testnet:set-fee status` says `Scheduled, waiting: executable from unix
time ...` until then, and `Scheduled and ready` after. Running `execute` too early fails with
`NotReadyYet` and changes nothing; just run it again later.

**5. Execute:**

```bash
pnpm testnet:set-fee execute
```

Success looks like `Executed: the live feeBps is now 200.` Then remove the key from `.env` again
(leave `ADMIN_PRIVATE_KEY=` empty).

**6. Check.** `pnpm testnet:set-fee status` now says `The live fee is already 200 bps`. Then:

- Before the next 8:45pm WAT: the open draw still charges $1.10 (home button "Play for $1.10").
- After the keeper closes that draw, the new draw charges $1.02. On
  https://daily-draw-lake.vercel.app the home button says **Play for $1.02** and the line under it
  **$1 a ticket + 2% fee**. Buy 1, 2, 5 and 10 tickets with a player wallet: MetaMask's approval
  asks for $1.02, $2.04, $5.10 and $10.20, and **Wallet** → Ticket purchases lists the same.
- On BaseScan → DailyDraw → **Read as Proxy**: `params` shows `feeBps` 200, and
  `quote(<new draw id>, 1)` returns `1000000` and `20000`.

Messages you might see: `FeeAlreadySet(200)` (already done: nothing to do), `AlreadyScheduled`
(step 3 already ran: wait and execute), `NotScheduled` (run step 3 first),
`NotTheTimelockAdmin` (`ADMIN_PRIVATE_KEY` is another wallet's key). For a different fee add
`--fee=<bps>` to every command, e.g. `--fee=250` for 2.5% (at most 2000, and it must give a whole
number of USDC units per ticket).

## When something goes wrong

| What you see                                                   | What it means and what to do                                                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keeper: `closing draw #N failed`                               | Almost always the subscription: the VRF adapter isn't listed as a consumer (step 7) or the subscription is out of LINK. Fix it at vrf.chain.link and rerun the keeper; the draw waits, still open.                                                                     |
| Keeper warning: `draw #N has waited ... for its random number` | Chainlink hasn't answered. Check the subscription (LINK balance, consumer listed, any "pending" request). After 24 hours anyone can void the draw so players get refunds: BaseScan → **Write as Proxy** → `voidDraw(N, "reason")` from Admin (Admin can do it sooner). |
| Keeper: `doesn't hold KEEPER_ROLE`                             | The `KEEPER_PRIVATE_KEY` secret is a different wallet's key. Replace it with the Keeper account's key.                                                                                                                                                                 |
| Keeper warning: `keeper balance is low`                        | Send the Keeper some Base Sepolia ETH.                                                                                                                                                                                                                                 |
| Keeper run says `No base-sepolia deployment committed yet`     | `packages/contracts/deployments/base-sepolia.json` isn't on `main` yet (step 8).                                                                                                                                                                                       |
| Web app: tickets or referrals don't load                       | Check `NEXT_PUBLIC_RPC_URL` in Vercel (step 9) and redeploy.                                                                                                                                                                                                           |
| `pnpm testnet:deploy`: `Missing in .env: ...`                  | Fill in the named variables.                                                                                                                                                                                                                                           |
| `pnpm testnet:deploy`: insufficient funds                      | The Deployer needs more Base Sepolia ETH.                                                                                                                                                                                                                              |

## Moving to another chain later (e.g. Celo)

Nothing is tied to Base Sepolia except configuration:

- `.env`: `TESTNET_RPC_URL`, a new `TESTNET_NETWORK` name (the deployment file's name), and
  `VRF_COORDINATOR` / `VRF_KEY_HASH` from Chainlink's supported-networks page (or a different
  `IRandomnessProvider` adapter where Chainlink VRF isn't available).
- GitHub: the `TESTNET_NETWORK` and `TESTNET_RPC_URL` repository variables.
- Vercel: `NEXT_PUBLIC_CHAIN` (`celoSepolia`, `celo`, ...) and the new addresses.
- The deploy script refuses Ethereum, Base and Celo mainnets, because its test USDC can be minted
  by anyone. Mainnet uses real USDC, a Safe multisig as admin and the 48-hour timelock
  (`script/DeployDailyDraw.s.sol`).

## Reference

| Command                                     | What it does                                                  |
| ------------------------------------------- | ------------------------------------------------------------- |
| `pnpm testnet:deploy --dry-run`             | Check `.env` and simulate the deployment. Sends nothing.      |
| `pnpm testnet:deploy`                       | Deploy, verify, write `deployments/base-sepolia.json`.        |
| `pnpm testnet:deploy --resume`              | Finish an interrupted deployment or retry verification.       |
| `pnpm testnet:info`                         | Addresses, the VRF consumer to add, and the Vercel variables. |
| `pnpm keeper` / `pnpm keeper --dry-run`     | One keeper pass from your computer (or just look).            |
| `pnpm keeper --only=close` / `--only=claim` | Just one of the two tasks.                                    |
| `pnpm testnet:set-fee status`               | The live ticket fee and any scheduled change. Sends nothing.  |
| `pnpm testnet:set-fee schedule` / `execute` | Change the ticket fee through the timelock (Admin key).       |

Files: `packages/contracts/script/DeployTestnet.s.sol` (deployment),
`packages/contracts/src/randomness/ChainlinkVrfProvider.sol` (VRF adapter; the two Chainlink
files it needs are copied into `src/vendor/chainlink/` rather than adding Chainlink's whole
contracts package), `apps/keeper` (keeper bot), `.github/workflows/keeper.yml` (its schedule),
`apps/web/vercel.json` (Vercel build settings).
