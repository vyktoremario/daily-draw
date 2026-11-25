// The keeper's decisions, as pure functions of on-chain state, so they can be tested without a
// chain. Times are unix seconds from the chain's latest block, never the machine's clock.

/** DailyDraw.Status, in contract order. */
export const STATUS = ['None', 'Open', 'Closed', 'Drawn', 'Settled', 'Voided', 'Swept'] as const;
export type StatusName = (typeof STATUS)[number];

export const Status = {
  None: 0,
  Open: 1,
  Closed: 2,
  Drawn: 3,
  Settled: 4,
  Voided: 5,
  Swept: 6,
} as const;

/** DailyDraw.KEEPER_CLAIM_DELAY: the keeper may claim for a winner 24 hours after settlement. */
export const KEEPER_CLAIM_DELAY = 24n * 3600n;
/** DailyDraw.VOID_DELAY: anyone may void a draw whose randomness hasn't arrived after 24 hours. */
export const VOID_DELAY = 24n * 3600n;
/** Chainlink VRF normally answers within a few minutes; warn after this long. */
export const RANDOMNESS_WARN_AFTER = 3600n;

/** The parts of DailyDraw.getDraw the keeper looks at. */
export interface DrawState {
  id: bigint;
  status: number;
  cutoff: bigint;
  winningNumber: number;
  winningTickets: number;
  claimedTickets: number;
  settledAt: bigint;
  closedAt: bigint;
}

export type CloseDecision =
  { action: 'close'; drawId: bigint } | { action: 'none'; reason: string };

/** Close the current draw once its cutoff has passed (DailyDraw.closeDraw's own conditions). */
export function decideClose(draw: DrawState, now: bigint, paused: boolean): CloseDecision {
  if (draw.status !== Status.Open) {
    return { action: 'none', reason: `draw #${draw.id} is ${statusName(draw.status)}, not Open` };
  }
  if (now < draw.cutoff) {
    return {
      action: 'none',
      reason: `draw #${draw.id} is open until its cutoff, ${describeWait(draw.cutoff - now)} from now`,
    };
  }
  if (paused) {
    return {
      action: 'none',
      reason: `draw #${draw.id} is past its cutoff, but the game is paused`,
    };
  }
  return { action: 'close', drawId: draw.id };
}

/**
 * Settled draws with winning tickets nobody has claimed, at least 24 hours after settlement:
 * the keeper claims those for their winners (prizes always go to the winner).
 */
export function drawsToClaimFor(draws: readonly DrawState[], now: bigint): DrawState[] {
  return draws.filter(
    (d) =>
      d.status === Status.Settled &&
      d.claimedTickets < d.winningTickets &&
      now >= d.settledAt + KEEPER_CLAIM_DELAY,
  );
}

export interface Warning {
  drawId: bigint;
  message: string;
}

/** Closed draws still waiting for their random number: a VRF subscription or consumer problem. */
export function stuckDraws(draws: readonly DrawState[], now: bigint): Warning[] {
  return draws
    .filter((d) => d.status === Status.Closed && now >= d.closedAt + RANDOMNESS_WARN_AFTER)
    .map((d) => {
      const waited = now - d.closedAt;
      const hint =
        waited >= VOID_DELAY
          ? 'it can now be voided so players get refunds (voidDraw)'
          : 'check the VRF subscription has LINK and lists the adapter as a consumer';
      return {
        drawId: d.id,
        message: `draw #${d.id} has waited ${describeWait(waited)} for its random number: ${hint}`,
      };
    });
}

/** Ids of the draws worth checking for claims: the claim window is 30 days, so 35 is enough. */
export function recentDrawIds(currentDrawId: bigint, lookback = 35n): bigint[] {
  const ids: bigint[] = [];
  const first = currentDrawId > lookback ? currentDrawId - lookback : 1n;
  for (let id = first; id < currentDrawId; id++) ids.push(id);
  return ids;
}

export interface TicketPurchase {
  player: `0x${string}`;
  numbers: readonly number[];
}

/** Wallets that bought the winning number, once each, in purchase order. */
export function winnersOf(
  purchases: readonly TicketPurchase[],
  winningNumber: number,
): `0x${string}`[] {
  const seen = new Set<string>();
  const out: `0x${string}`[] = [];
  for (const p of purchases) {
    const key = p.player.toLowerCase();
    if (!seen.has(key) && p.numbers.includes(winningNumber)) {
      seen.add(key);
      out.push(p.player);
    }
  }
  return out;
}

/**
 * The highest block at or before `timestamp`, given `lo` at or before it. Interpolates on block
 * times and falls back to halving, so it takes a handful of lookups on a chain with steady blocks.
 */
export async function blockAtOrBefore(
  timestamp: bigint,
  lo: bigint,
  hi: bigint,
  timestampOf: (block: bigint) => Promise<bigint>,
): Promise<bigint> {
  let loTs = await timestampOf(lo);
  if (loTs > timestamp) return lo;
  let hiTs = await timestampOf(hi);
  if (hiTs <= timestamp) return hi;
  // Invariant: ts(lo) <= timestamp < ts(hi).
  for (let step = 0; hi - lo > 1n; step++) {
    let guess: bigint;
    if (step % 2 === 0 && hiTs > loTs) {
      guess = lo + ((timestamp - loTs) * (hi - lo)) / (hiTs - loTs);
    } else {
      guess = lo + (hi - lo) / 2n;
    }
    if (guess <= lo) guess = lo + 1n;
    if (guess >= hi) guess = hi - 1n;
    const ts = await timestampOf(guess);
    if (ts <= timestamp) {
      lo = guess;
      loTs = ts;
    } else {
      hi = guess;
      hiTs = ts;
    }
  }
  return lo;
}

export function statusName(status: number): StatusName | `Unknown(${number})` {
  return STATUS[status] ?? `Unknown(${status})`;
}

export function describeWait(seconds: bigint): string {
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * The block range to retry an eth_getLogs request with after `err`. RPCs say their limit in the
 * error ("limited to a 200 range", "maximum block range: 50000", "ranges over 100 blocks",
 * "requested blocks is 1000"); otherwise halve. Null: give up (the error isn't about the range).
 */
export function smallerLogRange(current: bigint, err: unknown): bigint | null {
  const text = errorText(err);
  const stated =
    /limited to an? (\d+)/i.exec(text) ??
    /maximum block range:? (\d+)/i.exec(text) ??
    /ranges over (\d+) blocks/i.exec(text) ??
    /requested blocks is (\d+)/i.exec(text) ??
    /block range (?:is )?(?:too large|exceeds?)[^\d]*(\d+)/i.exec(text);
  if (stated) {
    const limit = BigInt(stated[1]!);
    if (limit > 0n && limit < current) return limit;
  }
  const next = current / 2n;
  return next >= 10n ? next : null;
}

function errorText(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    if (typeof e === 'object') {
      const o = e as {
        message?: unknown;
        details?: unknown;
        shortMessage?: unknown;
        cause?: unknown;
      };
      for (const v of [o.shortMessage, o.message, o.details])
        if (typeof v === 'string') parts.push(v);
      e = o.cause;
    } else {
      parts.push(String(e));
      break;
    }
  }
  return parts.join(' | ');
}
