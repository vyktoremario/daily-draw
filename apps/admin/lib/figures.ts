// The dashboard's arithmetic, kept free of I/O so it can be unit tested. Amounts are USDC base
// units (6 decimals) unless named otherwise; times are unix seconds.
import type { Address } from 'viem';

/** `DailyDraw.Status` */
export const Status = {
  None: 0,
  Open: 1,
  Closed: 2,
  Drawn: 3,
  Settled: 4,
  Voided: 5,
  Swept: 6,
} as const;

export const STATUS_NAMES = ['None', 'Open', 'Closed', 'Drawn', 'Settled', 'Voided', 'Swept'];

const BPS = 10_000n;
const DAY = 86_400;

/** `DailyDraw.Params` (the subset of the ABI's return type the dashboard uses). */
export interface DrawParams {
  ticketPrice: bigint;
  feeBps: number;
  numberRange: number;
  winnersBps: number;
  teamBps: number;
  buybackBps: number;
  referrersBps: number;
  maxTicketsPerWallet: number;
  drawInterval: number;
  referrerActiveDays: number;
  unclaimedPrizeDays: number;
}

/** `DailyDraw.Draw`, as `getDraw` returns it. */
export interface DrawData {
  params: DrawParams;
  cutoff: bigint;
  status: number;
  winningNumber: number;
  ticketCount: number;
  winningTickets: number;
  sales: bigint;
  fees: bigint;
  pool: bigint;
  prizePerTicket: bigint;
  referralSharePerTicket: bigint;
  settledAt: bigint;
  claimedTickets: number;
  closedAt: bigint;
  refunded: bigint;
}

export interface NumberedDraw {
  id: bigint;
  draw: DrawData;
}

// ---------------------------------------------------------------------------------------------
// Money: what the contract owes against what it holds
// ---------------------------------------------------------------------------------------------

/** The contract's own running totals. */
export interface ContractBalances {
  rollover: bigint;
  unclaimedWinnings: bigint;
  totalReferralBalances: bigint;
  treasuryBalance: bigint;
  buybackBalance: bigint;
}

export interface Obligations {
  /** Sales and fees of draws not yet settled (open, closed, drawn): the next pools and fees. */
  unsettledDraws: bigint;
  /** Price + fee still to be refunded to players of voided draws. */
  refundsOwed: bigint;
  rollover: bigint;
  /** Prizes and their referral shares not yet claimed. */
  unclaimedWinnings: bigint;
  /** Referral shares credited to referrers and not yet withdrawn. */
  referralBalances: bigint;
  treasury: bigint;
  buyback: bigint;
  total: bigint;
}

/** Everything the contract must be able to pay out, from its storage. */
export function obligations(draws: readonly NumberedDraw[], b: ContractBalances): Obligations {
  let unsettledDraws = 0n;
  let refundsOwed = 0n;
  for (const { draw } of draws) {
    if (
      draw.status === Status.Open ||
      draw.status === Status.Closed ||
      draw.status === Status.Drawn
    ) {
      unsettledDraws += draw.sales + draw.fees;
    } else if (draw.status === Status.Voided) {
      refundsOwed += draw.sales + draw.fees - draw.refunded;
    }
  }
  const total =
    unsettledDraws +
    refundsOwed +
    b.rollover +
    b.unclaimedWinnings +
    b.totalReferralBalances +
    b.treasuryBalance +
    b.buybackBalance;
  return {
    unsettledDraws,
    refundsOwed,
    rollover: b.rollover,
    unclaimedWinnings: b.unclaimedWinnings,
    referralBalances: b.totalReferralBalances,
    treasury: b.treasuryBalance,
    buyback: b.buybackBalance,
    total,
  };
}

export interface Solvency {
  held: bigint;
  owed: bigint;
  /** held - owed: zero normally; positive if someone sent USDC straight to the contract. */
  surplus: bigint;
  covered: boolean;
}

export function solvency(held: bigint, owed: bigint): Solvency {
  return { held, owed, surplus: held - owed, covered: held >= owed };
}

// ---------------------------------------------------------------------------------------------
// Draws
// ---------------------------------------------------------------------------------------------

export interface Settlement {
  pool: bigint;
  /** Rollover the draw brought in: pool - its own sales. */
  rolloverIn: bigint;
  winners: number;
  prizePerTicket: bigint;
  referralSharePerTicket: bigint;
  winnersTotal: bigint;
  referralTotal: bigint;
  team: bigint;
  buyback: bigint;
  /** Rolled over to the next draw (the whole pool when nobody won, else rounding dust). */
  rolloverOut: bigint;
  /** Fees, credited to the treasury at settlement. */
  fees: bigint;
  unclaimedTickets: number;
  /** Prizes plus their referral shares still unclaimed. */
  unclaimedAmount: bigint;
}

/**
 * How a settled (or swept) draw's pool was split. Recomputed from the draw's stored figures with
 * the contract's own rounding, so it matches its `DrawSettled` event; null for other draws.
 */
export function settlement(d: DrawData): Settlement | null {
  if (d.status !== Status.Settled && d.status !== Status.Swept) return null;
  const w = d.winningTickets;
  const team = w === 0 ? 0n : (d.pool * BigInt(d.params.teamBps)) / BPS;
  const buyback = w === 0 ? 0n : (d.pool * BigInt(d.params.buybackBps)) / BPS;
  const winnersTotal = d.prizePerTicket * BigInt(w);
  const referralTotal = d.referralSharePerTicket * BigInt(w);
  const unclaimedTickets = d.status === Status.Swept ? 0 : w - d.claimedTickets;
  return {
    pool: d.pool,
    rolloverIn: d.pool - d.sales,
    winners: w,
    prizePerTicket: d.prizePerTicket,
    referralSharePerTicket: d.referralSharePerTicket,
    winnersTotal,
    referralTotal,
    team,
    buyback,
    rolloverOut: d.pool - winnersTotal - referralTotal - team - buyback,
    fees: d.fees,
    unclaimedTickets,
    unclaimedAmount: BigInt(unclaimedTickets) * (d.prizePerTicket + d.referralSharePerTicket),
  };
}

export interface SweepItem {
  id: bigint;
  unclaimedTickets: number;
  unclaimedAmount: bigint;
  /** When `sweepUnclaimed` becomes callable. */
  sweepableAt: number;
  /** Whole days left (negative once due). */
  daysLeft: number;
  state: 'ok' | 'soon' | 'due';
}

/** Settled draws with unclaimed prizes, soonest sweep first. */
export function sweepSchedule(
  draws: readonly NumberedDraw[],
  now: number,
  warnDays: number,
): SweepItem[] {
  const items: SweepItem[] = [];
  for (const { id, draw } of draws) {
    const s = settlement(draw);
    if (!s || s.unclaimedTickets === 0 || draw.status !== Status.Settled) continue;
    const sweepableAt = Number(draw.settledAt) + draw.params.unclaimedPrizeDays * DAY;
    const left = sweepableAt - now;
    items.push({
      id,
      unclaimedTickets: s.unclaimedTickets,
      unclaimedAmount: s.unclaimedAmount,
      sweepableAt,
      daysLeft: Math.floor(left / DAY),
      state: left <= 0 ? 'due' : left <= warnDays * DAY ? 'soon' : 'ok',
    });
  }
  return items.sort((a, b) => a.sweepableAt - b.sweepableAt);
}

/** A draw that hasn't settled, as of now: what its pool would be if it settled now. */
export function openDrawFigures(d: DrawData, rollover: bigint, now: number) {
  return {
    sales: d.sales,
    fees: d.fees,
    tickets: d.ticketCount,
    /** Sales plus the rollover waiting for the next draw that settles. */
    pool: d.sales + rollover,
    rollover,
    secondsToCutoff: Number(d.cutoff) - now,
  };
}

// ---------------------------------------------------------------------------------------------
// Tickets and players (from events)
// ---------------------------------------------------------------------------------------------

export interface Purchase {
  drawId: bigint;
  player: Address;
  numbers: readonly number[];
}

export interface ReferrerLink {
  player: Address;
  referrer: Address;
}

export interface ReferralCredit {
  referrer: Address;
  amount: bigint;
}

/** Tickets on each number in one draw. Repeats count: two tickets on 07 → 2. */
export function ticketsPerNumber(
  purchases: readonly Purchase[],
  drawId: bigint,
  range: number,
): number[] {
  const counts = new Array<number>(range).fill(0);
  for (const p of purchases) {
    if (p.drawId !== drawId) continue;
    for (const n of p.numbers) if (n < range) counts[n]! += 1;
  }
  return counts;
}

export interface DrawActivity {
  drawId: bigint;
  tickets: number;
  /** Distinct wallets that bought in this draw. */
  buyers: number;
  /** Wallets whose first ever purchase was in this draw. */
  newPlayers: number;
}

export interface TopReferrer {
  referrer: Address;
  referred: number;
  /** Referral shares credited (claimed or not). */
  earned: bigint;
}

export interface PlayerStats {
  players: number;
  tickets: number;
  /** One entry per draw (one draw a day) that sold tickets, oldest first. */
  perDraw: DrawActivity[];
  withReferrer: number;
  referrers: number;
  topReferrers: TopReferrer[];
}

/** Player and referral counts. Purchases must be in chain order (as the logs arrive). */
export function playerStats(
  purchases: readonly Purchase[],
  links: readonly ReferrerLink[],
  credits: readonly ReferralCredit[],
  topCount = 10,
): PlayerStats {
  const firstDraw = new Map<string, bigint>();
  const perDraw = new Map<bigint, { tickets: number; buyers: Set<string>; newPlayers: number }>();
  let tickets = 0;
  for (const p of purchases) {
    const key = p.player.toLowerCase();
    let day = perDraw.get(p.drawId);
    if (!day) perDraw.set(p.drawId, (day = { tickets: 0, buyers: new Set(), newPlayers: 0 }));
    day.tickets += p.numbers.length;
    day.buyers.add(key);
    if (!firstDraw.has(key)) {
      firstDraw.set(key, p.drawId);
      day.newPlayers += 1;
    }
    tickets += p.numbers.length;
  }

  const referred = new Map<string, { referrer: Address; referred: number; earned: bigint }>();
  const entry = (referrer: Address) => {
    const key = referrer.toLowerCase();
    let r = referred.get(key);
    if (!r) referred.set(key, (r = { referrer, referred: 0, earned: 0n }));
    return r;
  };
  const withReferrer = new Set<string>();
  for (const l of links) {
    withReferrer.add(l.player.toLowerCase());
    entry(l.referrer).referred += 1;
  }
  for (const c of credits) entry(c.referrer).earned += c.amount;

  const topReferrers = [...referred.values()]
    .sort((a, b) =>
      b.referred !== a.referred ? b.referred - a.referred : a.earned < b.earned ? 1 : -1,
    )
    .slice(0, topCount);

  return {
    players: firstDraw.size,
    tickets,
    perDraw: [...perDraw.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([drawId, d]) => ({
        drawId,
        tickets: d.tickets,
        buyers: d.buyers.size,
        newPlayers: d.newPlayers,
      })),
    withReferrer: withReferrer.size,
    referrers: referred.size,
    topReferrers,
  };
}

// ---------------------------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------------------------

export type Level = 'ok' | 'warn' | 'alert';

export interface Check {
  level: Level;
  title: string;
  detail: string;
}

/** "3h 05m", "2d 4h", "12m". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / DAY);
  const h = Math.floor((s % DAY) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/**
 * Did the keeper close each draw after its cutoff, and did the randomness arrive? Flags a draw
 * still open, or closed without a number, past its grace period. Also reports the latest draw
 * whose cutoff has passed ("last night's draw") when nothing is wrong with it.
 */
export function drawChecks(
  draws: readonly NumberedDraw[],
  now: number,
  closeGrace: number,
  randomnessGrace: number,
): Check[] {
  const checks: Check[] = [];
  for (const { id, draw } of draws) {
    const cutoff = Number(draw.cutoff);
    if (draw.status === Status.Open && now > cutoff + closeGrace) {
      checks.push({
        level: 'alert',
        title: `Draw #${id} still open`,
        detail: `Its cutoff passed ${duration(now - cutoff)} ago and the keeper hasn't closed it. Anyone can call closeDraw(${id}).`,
      });
    } else if (draw.status === Status.Closed) {
      const waited = now - Number(draw.closedAt);
      if (waited > randomnessGrace) {
        const voidable =
          waited >= DAY
            ? 'it can be voided now'
            : `anyone can void it in ${duration(DAY - waited)}; the admin can void it now`;
        checks.push({
          level: 'alert',
          title: `Draw #${id}: no random number`,
          detail: `Closed ${duration(waited)} ago and still waiting for VRF (check the subscription's LINK and consumer). If it never arrives, ${voidable}.`,
        });
      }
    }
  }

  const past = draws
    .filter(({ draw }) => Number(draw.cutoff) <= now && draw.status !== Status.None)
    .sort((a, b) => (a.id < b.id ? 1 : -1))[0];
  if (past && !checks.some((c) => c.title.startsWith(`Draw #${past.id}`))) {
    const { id, draw } = past;
    const status = STATUS_NAMES[draw.status] ?? `status ${draw.status}`;
    if (draw.status === Status.Settled || draw.status === Status.Swept) {
      const late = Number(draw.settledAt) - Number(draw.cutoff);
      checks.push({
        level: 'ok',
        title: `Draw #${id} drawn`,
        detail: `Closed and settled ${duration(late)} after its cutoff; winning number ${String(draw.winningNumber).padStart(2, '0')}.`,
      });
    } else if (draw.status === Status.Voided) {
      checks.push({
        level: 'warn',
        title: `Draw #${id} voided`,
        detail: 'Its players can claim refunds.',
      });
    } else {
      checks.push({
        level: 'ok',
        title: `Draw #${id} ${status.toLowerCase()}`,
        detail: 'Within its grace period.',
      });
    }
  }
  return checks;
}

/** A balance against its low-water mark. */
export function balanceCheck(
  title: string,
  balance: bigint | null,
  minimum: bigint,
  format: (v: bigint) => string,
  lowAdvice: string,
): Check {
  if (balance === null) return { level: 'warn', title, detail: 'Could not read the balance.' };
  if (balance < minimum) {
    return {
      level: balance === 0n ? 'alert' : 'warn',
      title,
      detail: `${format(balance)}: below ${format(minimum)}. ${lowAdvice}`,
    };
  }
  return { level: 'ok', title, detail: format(balance) };
}

export interface Subscription {
  link: bigint;
  native: bigint;
  consumers: readonly Address[];
}

/** VRF subscription funds (in the currency the adapter pays with) and consumer registration. */
export function vrfChecks(
  sub: Subscription | null,
  nativePayment: boolean,
  adapter: Address | null,
  minLink: bigint,
  minNative: bigint,
  formatLink: (v: bigint) => string,
  formatNative: (v: bigint) => string,
): Check[] {
  if (!sub) {
    return [
      { level: 'warn', title: 'VRF subscription', detail: 'Could not read the subscription.' },
    ];
  }
  const checks = [
    nativePayment
      ? balanceCheck(
          'VRF subscription (pays in ETH)',
          sub.native,
          minNative,
          formatNative,
          'Fund it at vrf.chain.link.',
        )
      : balanceCheck(
          'VRF subscription LINK',
          sub.link,
          minLink,
          formatLink,
          'Fund it at vrf.chain.link.',
        ),
  ];
  if (adapter && !sub.consumers.some((c) => c.toLowerCase() === adapter.toLowerCase())) {
    checks.push({
      level: 'alert',
      title: 'VRF consumer missing',
      detail: `The randomness adapter ${adapter} is not a consumer of the subscription: requests will fail.`,
    });
  }
  return checks;
}

/** Most serious level first. */
export function sortChecks(checks: readonly Check[]): Check[] {
  const rank: Record<Level, number> = { alert: 0, warn: 1, ok: 2 };
  return [...checks].sort((a, b) => rank[a.level] - rank[b.level]);
}

// ---------------------------------------------------------------------------------------------
// Timelock
// ---------------------------------------------------------------------------------------------

export interface ScheduledCall {
  id: `0x${string}`;
  index: bigint;
  target: Address;
  data: `0x${string}`;
  delay: bigint;
}

export interface PendingCall extends ScheduledCall {
  /** When it may be executed. */
  readyAt: number;
  state: 'waiting' | 'ready';
}

/**
 * Scheduled timelock calls on `target` that are neither executed nor cancelled.
 * `timestamps` is the timelock's `getTimestamp(id)`: 0 = cancelled/unknown, 1 = done, else ready-at.
 */
export function pendingCalls(
  scheduled: readonly ScheduledCall[],
  timestamps: ReadonlyMap<string, bigint>,
  target: Address,
  now: number,
): PendingCall[] {
  const out: PendingCall[] = [];
  for (const call of scheduled) {
    if (call.target.toLowerCase() !== target.toLowerCase()) continue;
    const ts = timestamps.get(call.id) ?? 0n;
    if (ts <= 1n) continue;
    const readyAt = Number(ts);
    out.push({ ...call, readyAt, state: readyAt <= now ? 'ready' : 'waiting' });
  }
  return out.sort((a, b) => a.readyAt - b.readyAt);
}
