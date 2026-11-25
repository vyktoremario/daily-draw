# Incident: draw #1 closed 28 minutes late (2026-11-25)

|               |                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------ |
| Date          | 2026-11-25, the first live night on Base Sepolia                                           |
| Duration      | Sales closed 19:45 UTC; the draw closed 20:13 UTC (28 minutes late)                        |
| Impact        | Draw #1's number came 13 minutes after the advertised 9:00pm WAT draw                      |
| Money at risk | None (test USDC on a testnet; nothing half-sent)                                           |
| Status        | Resolved. Alerting still open: [#51](https://github.com/vyktoremario/daily-draw/issues/51) |

Times are UTC with West Africa Time (WAT, UTC+1) in brackets.

## Summary

Each night the keeper bot calls `closeDraw` two minutes after sales close at 19:45 UTC (8:45pm
WAT), which asks Chainlink VRF for the winning number. On the first live night it didn't. Two
things went wrong at once: GitHub started one scheduled keeper run 10 hours late and never started
the two evening runs that mattered, and when the keeper was then started by hand, its RPC provider
refused to send the transaction. After switching RPC, the draw closed at 20:13 UTC and settled 20 seconds
later. No money was at risk and nothing was left half-done.

## Timeline

| UTC (WAT)          | What happened                                                                                                                                                                                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 08:17 (9:17am)     | Scheduled time of the morning keeper run. GitHub doesn't start it.                                                                                                                                                                                                               |
| 18:40 (7:40pm)     | The morning run finally starts, 10h23m late. Draw #1 is still selling, so it correctly does nothing.                                                                                                                                                                             |
| 19:45 (8:45pm)     | Sales close for draw #1; the contract refuses tickets from now on. Anyone may call `closeDraw`.                                                                                                                                                                                  |
| 19:47 (8:47pm)     | Scheduled close run. GitHub never starts it.                                                                                                                                                                                                                                     |
| 20:09 (9:09pm)     | Keeper started by hand (`workflow_dispatch`). It reads the draw and decides to close it, then fails: `Close: closing draw #1 failed: Request exceeds defined limit.` Nothing is sent; the draw stays closed to sales and waiting.                                                |
| 20:09–20:12        | Diagnosis: reads and gas estimates work against the configured RPC, the free Tenderly public gateway (`base-sepolia.gateway.tenderly.co`); only `eth_sendRawTransaction` is refused. The `TESTNET_RPC_URL` repository variable is switched to `https://sepolia.base.org`.        |
| 20:12:54 (9:12pm)  | Keeper started by hand again.                                                                                                                                                                                                                                                    |
| 20:13:21 (9:13pm)  | Draw #1 closed: [tx `0x28386f…1bac1`](https://sepolia.basescan.org/tx/0x28386fc6c702f6019c16215f90459019694326255bcbc2396686dce895c1bac1) (block 63578664). Chainlink VRF request sent.                                                                                          |
| ~20:13:41 (9:13pm) | Chainlink fulfils 10 blocks later and the contract settles in the same transaction ([tx `0x7189d3…`](https://sepolia.basescan.org/tx/0x7189d314ffa5e9da9e03e8c719b55134536f0a04c03b974ec10e729247020345)): winning number **26**, 159 tickets, 2 winning tickets. Draw #2 opens. |
| 20:17 (9:17pm)     | Scheduled retry run. GitHub doesn't start this one either.                                                                                                                                                                                                                       |
| 20:41 and 20:47    | Two more API-started runs while the cron-job.org trigger is set up. Both find draw #2 open until tomorrow and do nothing, as designed.                                                                                                                                           |

Run times are from the GitHub Actions run history and logs; the close and settlement times are
from the chain.

## Impact

- Draw #1 closed 28 minutes after its cutoff instead of 2 minutes. The app advertises the draw
  at 9:00pm WAT; the number arrived at 9:13pm. Until then the home screen said "Sales closed.
  Draw at 9:00pm" with nothing happening.
- **No funds were at risk.** The contract had already stopped selling at 19:45 by itself (the
  cutoff is enforced on-chain, not by the keeper), so nobody could buy a ticket after sales closed
  or after anyone could know the number. The money sat in the contract the whole time.
- **Nothing was half-sent.** The failed run sent no transaction. Closing and settling are each a
  single transaction, so there was no partial state to clean up.
- Had the draw never closed, the design's fallback was still there: anyone may call `closeDraw`
  after the cutoff, and a draw without a random number can be voided after 24 hours with full
  refunds. Neither was needed.
- This was a testnet with test USDC; nobody lost anything of value.

## Root causes

1. **Best-effort scheduling for a time-critical job.** GitHub Actions' `schedule` trigger is
   documented as best effort: runs can be delayed, especially at busy times like the top of the
   hour, and sometimes dropped. The workflow had three runs a day (19:47, 20:17 and 08:17 UTC) as
   retries of each other, but nothing guaranteed any of them would run near 19:47. That day, one
   ran 10 hours late and the two evening runs never ran.
2. **An RPC chosen for reads was used for writes, and only reads were tested.** The keeper was
   pointed at Tenderly's free public gateway because it accepts very wide `eth_getLogs` ranges,
   which makes finding winners fast. Every test of the keeper on Base Sepolia before launch day
   was a dry run (`--dry-run`), which reads, decides and simulates but never sends. The gateway
   serves reads and `eth_estimateGas` but refuses `eth_sendRawTransaction` with `Request exceeds
defined limit`, so the first real send was also the first time the write path met that RPC.

## What we changed

- **RPC:** `TESTNET_RPC_URL` for the keeper is now `https://sepolia.base.org`, Base's public RPC,
  which accepts transactions. It allows only 200 blocks per `eth_getLogs` call, but the keeper
  already shrinks its scan range to whatever the RPC states (or halves it) and retries, so it only
  costs scan time ([`apps/keeper/src/chain.ts`](../../apps/keeper/src/chain.ts)).
- **Scheduling:** a [cron-job.org](https://cron-job.org) job starts the keeper workflow through
  GitHub's `workflow_dispatch` API at 8:47pm WAT every day, with retries if the call fails. GitHub's
  own schedule stays in [`keeper.yml`](../../.github/workflows/keeper.yml) as a backup. Because the
  keeper is idempotent (every decision comes from fresh on-chain state, every transaction is
  simulated first, and runs never overlap), a second start finds nothing to do.
- **Draw #1:** closed and settled as above; the verify page confirms it.

## Lessons

- **Test the write path, not just reads.** A dry run that simulates a transaction proves the
  contract would accept it, not that the RPC will carry it. Before trusting a new RPC or key,
  send one real, harmless transaction through it (on a testnet, a 0-value self-transfer will do).
- **Don't rely on best-effort cron for time-critical jobs.** Use a scheduler with timing
  guarantees and retries to start the job, keep the best-effort one as a backup, and make the job
  safe to run more than once so extra starts are harmless.
- **Alerting would have caught it within minutes.** The admin dashboard shows a draw still open
  after its cutoff, but only to someone looking at it. An alert when a draw is open more than
  ~10 minutes after its cutoff, and when keeper or drip wallets run low, is tracked in
  [#51](https://github.com/vyktoremario/daily-draw/issues/51).
- **What went right:** putting the cutoff in the contract rather than in the keeper meant a late
  keeper could only delay the draw, never make it unfair, and the keeper's simulate-first design
  meant the failed run left nothing to clean up.
