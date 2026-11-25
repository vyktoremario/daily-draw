# Demo video: shot list (60–90 seconds)

A screen recording of the live testnet app with a voice-over. Aim for about 80 seconds; the
times below add up to 85.

## Before recording

- Browser at a phone-like width (about 400px; Chrome DevTools device mode works) or a real phone
  through screen mirroring. Hide bookmarks and other tabs.
- A **fresh MetaMask account** with no ETH and no USDC, on Base Sepolia, so the gas drip and the
  faucet both show. Check that `/api/drip` says `"available": true` first.
- Record **before 8:45pm WAT** so the draw is still selling.
- Open in tabs, ready to switch to: the home page, `/verify/1` (draw #1 is settled and passes all
  checks), and the admin dashboard already logged in (don't record the password prompt).
- Wallet pop-ups take a few seconds each: cut the waits in editing rather than talking over them.

## Shots

| #   | Time      | On screen                                                                                                                                | What to say                                                                                                                                                                                                                                                 |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 0:00–0:08 | Home page. Pan over the pool, the countdown and the "Portfolio demo · test money only" strip at the top.                                 | "This is Daily Draw: a daily pick-a-number draw where anyone can check the randomness and the payouts. It's a portfolio project on the Base Sepolia testnet, with test money only."                                                                         |
| 2   | 0:08–0:18 | **Connect wallet** → MetaMask → connected. Open **Wallet**: the gas drip sends test ETH, then **Get $100 test USDC** → confirm.          | "A brand-new wallet has no gas, so a small API sends it test ETH, with limits per wallet, per IP and per day. Then a faucet gives it test USDC."                                                                                                            |
| 3   | 0:18–0:32 | **Play**: pick 3 numbers, choose the bundle of 5, tick the 18+ box, **Approve and buy** → two MetaMask confirmations → "Tickets bought". | "Pick numbers from 00 to 99 and buy. A ticket is a dollar plus a 2% fee. That fee used to be 10%; I lowered it on the live contract through a one-hour timelock, so no rule can change without warning."                                                    |
| 4   | 0:32–0:45 | **Results** → draw #1 → the reveal screen: number 26, winning tickets, prize each.                                                       | "At 8:45 sales close in the contract itself. A keeper bot closes the draw and Chainlink VRF sends a random number. The contract computes the winner and splits the pool: 65% to winners, 20% to their referrers, 15% to the project, or it all rolls over." |
| 5   | 0:45–1:05 | **Verify this draw** → `/verify/1`. Scroll slowly through the green checks: randomness, winning number, tickets, the split.              | "And you don't have to trust me. This page redoes the draw in your browser from public chain data: it checks Chainlink's proof answers this request, recomputes the number, recounts all 159 tickets and reruns the split."                                 |
| 6   | 1:05–1:20 | Admin dashboard: health checks, tonight's draw, "Money: held vs owed" showing they match, keeper and VRF balances.                       | "Behind it there's a read-only dashboard: money held against money owed, which an invariant test suite checks after every possible action, plus keeper, randomness and timelock health."                                                                    |
| 7   | 1:20–1:25 | Back to the home page, or the GitHub README.                                                                                             | "Solidity with Foundry, Next.js, viem and a keeper on GitHub Actions. Links to the code and an incident write-up are in the README."                                                                                                                        |

## Notes

- Don't show private keys, the admin password, MetaMask's seed phrase screens or the Vercel and
  GitHub settings pages.
- Shot 4 shows draw #1 because it has winners. Any later settled draw works too; if it had no
  winner, say "nobody picked it, so the whole pool rolls over to tomorrow".
- Keep it honest: no talk of players, revenue or an audit. It's a testnet demo.
- If the video goes on a site or LinkedIn, add captions; many people watch without sound.
