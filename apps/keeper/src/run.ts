// One keeper pass: close the current draw if its cutoff has passed, then claim for winners who
// haven't claimed 24 hours after settlement. Safe to run as often as you like: every action is
// decided from fresh on-chain state and simulated before it is sent, so a second run (or another
// keeper) finds nothing left to do instead of acting twice.
import {
  blockAtOrBefore,
  decideClose,
  drawsToClaimFor,
  recentDrawIds,
  stuckDraws,
  winnersOf,
  type DrawState,
  type TicketPurchase,
} from './decide.js';

/** What the keeper needs from the chain; `chain.ts` implements it with viem, tests with a fake. */
export interface KeeperChain {
  keeperAddress: `0x${string}`;
  latestBlock(): Promise<{ number: bigint; timestamp: bigint }>;
  blockTimestamp(block: bigint): Promise<bigint>;
  currentDrawId(): Promise<bigint>;
  getDraw(id: bigint): Promise<DrawState>;
  paused(): Promise<boolean>;
  hasKeeperRole(): Promise<boolean>;
  keeperBalance(): Promise<bigint>;
  ticketPurchases(drawId: bigint, fromBlock: bigint, toBlock: bigint): Promise<TicketPurchase[]>;
  /** Unclaimed winning tickets `player` holds in `drawId` (DailyDraw.claimable). */
  claimableTickets(drawId: bigint, player: `0x${string}`): Promise<bigint>;
  /** Simulate, send, wait for the receipt. Throws if the simulation or the transaction fails. */
  closeDraw(drawId: bigint): Promise<`0x${string}`>;
  claimFor(player: `0x${string}`, drawId: bigint): Promise<`0x${string}`>;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface RunOptions {
  close: boolean;
  claim: boolean;
  /** Decide and log, but send nothing. */
  dryRun: boolean;
  /** The deployment block: event scans start here. */
  startBlock: bigint;
}

export interface RunSummary {
  closed: bigint[];
  claimed: { drawId: bigint; player: `0x${string}`; tickets: bigint }[];
  warnings: string[];
  failures: string[];
}

/** Below this the keeper may soon be unable to pay for gas (0.001 ETH). */
export const LOW_BALANCE_WEI = 10n ** 15n;

export async function runKeeper(
  chain: KeeperChain,
  options: RunOptions,
  log: Logger,
): Promise<RunSummary> {
  const summary: RunSummary = { closed: [], claimed: [], warnings: [], failures: [] };
  const warn = (message: string) => {
    summary.warnings.push(message);
    log.warn(message);
  };
  const fail = (message: string) => {
    summary.failures.push(message);
    log.error(message);
  };

  const latest = await chain.latestBlock();
  const now = latest.timestamp;
  log.info(
    `Keeper ${chain.keeperAddress}, block ${latest.number}, chain time ${iso(now)}` +
      (options.dryRun ? ' (dry run: nothing will be sent)' : ''),
  );

  if (!(await chain.hasKeeperRole())) {
    fail(`${chain.keeperAddress} doesn't hold KEEPER_ROLE on DailyDraw: check KEEPER_PRIVATE_KEY`);
  }
  const balance = await chain.keeperBalance();
  if (balance < LOW_BALANCE_WEI) {
    warn(`keeper balance is low (${formatEth(balance)} ETH): send it some testnet ETH`);
  }

  const currentId = await chain.currentDrawId();

  // 1. Close the current draw.
  if (options.close) {
    const current = await chain.getDraw(currentId);
    const decision = decideClose(current, now, await chain.paused());
    if (decision.action === 'none') {
      log.info(`Close: nothing to do; ${decision.reason}.`);
    } else if (options.dryRun) {
      log.info(`Close: would close draw #${decision.drawId} (dry run).`);
    } else {
      try {
        const hash = await chain.closeDraw(decision.drawId);
        summary.closed.push(decision.drawId);
        log.info(`Close: closed draw #${decision.drawId} and requested randomness, tx ${hash}.`);
      } catch (err) {
        const after = await chain.getDraw(decision.drawId);
        if (after.status !== current.status) {
          log.info(`Close: draw #${decision.drawId} was closed by someone else meanwhile.`);
        } else {
          fail(`Close: closing draw #${decision.drawId} failed: ${errorMessage(err)}`);
        }
      }
    }
  }

  // 2. Draws stuck waiting for randomness, and claims.
  const ids = recentDrawIds(currentId);
  const draws = await Promise.all(ids.map((id) => chain.getDraw(id)));
  for (const w of stuckDraws(draws, now)) warn(w.message);

  if (options.claim) {
    const due = drawsToClaimFor(draws, now);
    if (due.length === 0) log.info('Claims: nothing to do; no winners waiting over 24 hours.');
    const byId = new Map(draws.map((d) => [d.id, d]));
    for (const draw of due) {
      await claimForDraw(chain, draw, byId.get(draw.id - 1n), latest.number, options, log, summary);
    }
  }

  log.info(
    `Done: ${summary.closed.length} closed, ${summary.claimed.length} claimed, ` +
      `${summary.warnings.length} warning(s), ${summary.failures.length} failure(s).`,
  );
  return summary;
}

async function claimForDraw(
  chain: KeeperChain,
  draw: DrawState,
  previous: DrawState | undefined,
  latestBlock: bigint,
  options: RunOptions,
  log: Logger,
  summary: RunSummary,
) {
  const unclaimed = draw.winningTickets - draw.claimedTickets;
  const n = String(draw.winningNumber).padStart(2, '0');
  log.info(`Claims: draw #${draw.id} (number ${n}) has ${unclaimed} unclaimed winning ticket(s).`);

  // Sales for draw N run from draw N-1's close to draw N's close; scan just that stretch.
  const lookup = (b: bigint) => chain.blockTimestamp(b);
  let fromBlock = options.startBlock;
  if (previous && previous.closedAt > 0n) {
    const b = await blockAtOrBefore(previous.closedAt, options.startBlock, latestBlock, lookup);
    fromBlock = b > options.startBlock + 2n ? b - 2n : options.startBlock;
  }
  const closeBlock = await blockAtOrBefore(draw.closedAt, options.startBlock, latestBlock, lookup);
  const toBlock = closeBlock + 2n < latestBlock ? closeBlock + 2n : latestBlock;

  const purchases = await chain.ticketPurchases(draw.id, fromBlock, toBlock);
  for (const player of winnersOf(purchases, draw.winningNumber)) {
    const tickets = await chain.claimableTickets(draw.id, player);
    if (tickets === 0n) continue; // claimed already
    if (options.dryRun) {
      log.info(`Claims: would claim ${tickets} ticket(s) for ${player} in draw #${draw.id}.`);
      continue;
    }
    try {
      const hash = await chain.claimFor(player, draw.id);
      summary.claimed.push({ drawId: draw.id, player, tickets });
      log.info(
        `Claims: claimed ${tickets} ticket(s) for ${player} in draw #${draw.id}, tx ${hash}.`,
      );
    } catch (err) {
      if ((await chain.claimableTickets(draw.id, player)) === 0n) {
        log.info(`Claims: ${player} claimed draw #${draw.id} meanwhile.`);
      } else {
        const msg = `claiming for ${player} in draw #${draw.id} failed: ${errorMessage(err)}`;
        summary.failures.push(msg);
        log.error(`Claims: ${msg}`);
      }
    }
  }
}

function iso(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString().replace('.000Z', 'Z');
}

function formatEth(wei: bigint): string {
  return (Number(wei) / 1e18).toFixed(6);
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'shortMessage' in err) {
    return String((err as { shortMessage: unknown }).shortMessage);
  }
  return err instanceof Error ? err.message.split('\n')[0]! : String(err);
}
