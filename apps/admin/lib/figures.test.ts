import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import {
  balanceCheck,
  drawChecks,
  duration,
  obligations,
  openDrawFigures,
  pendingCalls,
  playerStats,
  settlement,
  solvency,
  sortChecks,
  Status,
  sweepSchedule,
  ticketsPerNumber,
  vrfChecks,
  type DrawData,
  type NumberedDraw,
} from './figures';

const $ = (dollars: number) => BigInt(Math.round(dollars * 1_000_000));
const DAY = 86_400;
const A = '0x00000000000000000000000000000000000000aa' as Address;
const B = '0x00000000000000000000000000000000000000bb' as Address;
const C = '0x00000000000000000000000000000000000000cc' as Address;

function draw(over: Partial<DrawData> = {}): DrawData {
  return {
    params: {
      ticketPrice: $(1),
      feeBps: 1_000,
      numberRange: 100,
      winnersBps: 6_500,
      teamBps: 1_000,
      buybackBps: 500,
      referrersBps: 2_000,
      maxTicketsPerWallet: 20,
      drawInterval: DAY,
      referrerActiveDays: 30,
      unclaimedPrizeDays: 30,
    },
    cutoff: 1_000_000n,
    status: Status.Open,
    winningNumber: 0,
    ticketCount: 0,
    winningTickets: 0,
    sales: 0n,
    fees: 0n,
    pool: 0n,
    prizePerTicket: 0n,
    referralSharePerTicket: 0n,
    settledAt: 0n,
    claimedTickets: 0,
    closedAt: 0n,
    refunded: 0n,
    ...over,
  };
}

/** A settled draw split the way `DailyDraw._settle` does it. */
function settled(sales: bigint, rolloverIn: bigint, winners: number, over: Partial<DrawData> = {}) {
  const pool = sales + rolloverIn;
  const w = BigInt(winners);
  return draw({
    status: Status.Settled,
    sales,
    fees: sales / 10n,
    pool,
    winningTickets: winners,
    prizePerTicket: w ? (pool * 6_500n) / 10_000n / w : 0n,
    referralSharePerTicket: w ? (pool * 2_000n) / 10_000n / w : 0n,
    settledAt: 1_000_900n,
    closedAt: 1_000_060n,
    ...over,
  });
}

const zeroBalances = {
  rollover: 0n,
  unclaimedWinnings: 0n,
  totalReferralBalances: 0n,
  treasuryBalance: 0n,
  buybackBalance: 0n,
};

describe('obligations and solvency', () => {
  it('owes the sales and fees of unsettled draws, unrefunded voided money and every balance', () => {
    const draws: NumberedDraw[] = [
      { id: 1n, draw: settled($(100), 0n, 3) },
      { id: 2n, draw: draw({ status: Status.Voided, sales: $(10), fees: $(1), refunded: $(2.2) }) },
      { id: 3n, draw: draw({ status: Status.Closed, sales: $(5), fees: $(0.5) }) },
      { id: 4n, draw: draw({ status: Status.Open, sales: $(18), fees: $(1.8) }) },
    ];
    const o = obligations(draws, {
      rollover: $(1),
      unclaimedWinnings: $(50),
      totalReferralBalances: $(3),
      treasuryBalance: $(20),
      buybackBalance: $(5),
    });
    expect(o.unsettledDraws).toBe($(25.3));
    expect(o.refundsOwed).toBe($(8.8));
    expect(o.total).toBe($(25.3) + $(8.8) + $(1) + $(50) + $(3) + $(20) + $(5));
  });

  it('matches what the live testnet showed: one open draw, 18 tickets at 10%', () => {
    const o = obligations(
      [{ id: 1n, draw: draw({ sales: $(18), fees: $(1.8), ticketCount: 18 }) }],
      zeroBalances,
    );
    expect(solvency($(19.8), o.total)).toEqual({
      held: $(19.8),
      owed: $(19.8),
      surplus: 0n,
      covered: true,
    });
  });

  it('flags a shortfall and reports a surplus', () => {
    expect(solvency($(10), $(11)).covered).toBe(false);
    expect(solvency($(10), $(11)).surplus).toBe(-$(1));
    expect(solvency($(12), $(11)).surplus).toBe($(1));
  });

  it('ignores settled and swept draws (their money is already in the balances)', () => {
    const o = obligations(
      [
        { id: 1n, draw: settled($(100), 0n, 1) },
        { id: 2n, draw: settled($(100), 0n, 1, { status: Status.Swept }) },
      ],
      zeroBalances,
    );
    expect(o.total).toBe(0n);
  });
});

describe('settlement', () => {
  it('splits a won pool 65/10/5/20 with dust rolling over', () => {
    const s = settlement(settled($(100), $(7), 3))!;
    expect(s.pool).toBe($(107));
    expect(s.rolloverIn).toBe($(7));
    expect(s.team).toBe($(10.7));
    expect(s.buyback).toBe($(5.35));
    // 69.55 / 3 and 21.4 / 3 round down to the micro-dollar.
    expect(s.prizePerTicket).toBe(23_183_333n);
    expect(s.referralSharePerTicket).toBe(7_133_333n);
    expect(s.rolloverOut).toBe($(107) - 3n * (23_183_333n + 7_133_333n) - $(10.7) - $(5.35));
    expect(s.rolloverOut).toBe(2n);
    expect(s.unclaimedTickets).toBe(3);
    expect(s.unclaimedAmount).toBe(3n * (23_183_333n + 7_133_333n));
  });

  it('rolls the whole pool over when nobody won, with nothing to team or buy-back', () => {
    const s = settlement(settled($(40), $(10), 0))!;
    expect(s).toMatchObject({ team: 0n, buyback: 0n, rolloverOut: $(50), winnersTotal: 0n });
  });

  it('counts nothing unclaimed once swept, and nothing for unsettled draws', () => {
    expect(settlement(settled($(10), 0n, 2, { status: Status.Swept }))!.unclaimedAmount).toBe(0n);
    expect(settlement(draw({ status: Status.Closed }))).toBeNull();
    expect(settlement(draw({ status: Status.Voided }))).toBeNull();
  });
});

describe('sweepSchedule', () => {
  const settledAt = 1_000_000n;
  const draws: NumberedDraw[] = [
    { id: 1n, draw: settled($(10), 0n, 2, { settledAt, claimedTickets: 1 }) },
    { id: 2n, draw: settled($(10), 0n, 1, { settledAt: settledAt + 20n * BigInt(DAY) }) },
    { id: 3n, draw: settled($(10), 0n, 1, { settledAt, claimedTickets: 1 }) },
    { id: 4n, draw: settled($(10), 0n, 0, { settledAt }) },
  ];

  it('lists draws with unclaimed prizes, soonest first, with their state', () => {
    const now = Number(settledAt) + 25 * DAY;
    const items = sweepSchedule(draws, now, 7);
    expect(items.map((i) => i.id)).toEqual([1n, 2n]);
    expect(items[0]).toMatchObject({ unclaimedTickets: 1, daysLeft: 5, state: 'soon' });
    expect(items[1]).toMatchObject({ daysLeft: 25, state: 'ok' });
  });

  it('marks a draw due once its window has passed', () => {
    const items = sweepSchedule(draws, Number(settledAt) + 31 * DAY, 7);
    expect(items[0]!.state).toBe('due');
  });
});

describe('openDrawFigures', () => {
  it('adds the waiting rollover to the pool and counts down to the cutoff', () => {
    const f = openDrawFigures(draw({ sales: $(18), fees: $(1.8), cutoff: 2_000n }), $(5), 1_000);
    expect(f.pool).toBe($(23));
    expect(f.secondsToCutoff).toBe(1_000);
  });
});

describe('tickets and players', () => {
  const purchases = [
    { drawId: 1n, player: A, numbers: [7, 7, 42] },
    { drawId: 1n, player: B, numbers: [7] },
    { drawId: 2n, player: A, numbers: [1, 2] },
    { drawId: 2n, player: C, numbers: [99] },
  ];

  it('counts tickets per number in one draw, repeats included', () => {
    const counts = ticketsPerNumber(purchases, 1n, 100);
    expect(counts).toHaveLength(100);
    expect(counts[7]).toBe(3);
    expect(counts[42]).toBe(1);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('counts players, tickets and new players per draw', () => {
    const stats = playerStats(purchases, [], []);
    expect(stats.players).toBe(3);
    expect(stats.tickets).toBe(7);
    expect(stats.perDraw).toEqual([
      { drawId: 1n, tickets: 4, buyers: 2, newPlayers: 2 },
      { drawId: 2n, tickets: 3, buyers: 2, newPlayers: 1 },
    ]);
  });

  it('ranks referrers by players referred, then by earnings', () => {
    const stats = playerStats(
      purchases,
      [
        { player: B, referrer: A },
        { player: C, referrer: A },
        { player: A, referrer: C },
      ],
      [
        { referrer: C, amount: $(2) },
        { referrer: A, amount: $(0.5) },
        { referrer: A, amount: $(0.25) },
      ],
    );
    expect(stats.withReferrer).toBe(3);
    expect(stats.referrers).toBe(2);
    expect(stats.topReferrers).toEqual([
      { referrer: A, referred: 2, earned: $(0.75) },
      { referrer: C, referred: 1, earned: $(2) },
    ]);
  });

  it('treats addresses case-insensitively', () => {
    const stats = playerStats(
      [
        { drawId: 1n, player: A, numbers: [1] },
        { drawId: 1n, player: A.toUpperCase().replace('0X', '0x') as Address, numbers: [2] },
      ],
      [],
      [],
    );
    expect(stats.players).toBe(1);
  });
});

describe('health', () => {
  const cutoff = 1_000_000;
  const grace = 45 * 60;
  const vrfGrace = 30 * 60;

  it('flags an open draw past its cutoff and grace', () => {
    const draws = [{ id: 1n, draw: draw({ cutoff: BigInt(cutoff) }) }];
    expect(drawChecks(draws, cutoff + grace - 1, grace, vrfGrace)[0]!.level).toBe('ok');
    const late = drawChecks(draws, cutoff + grace + 60, grace, vrfGrace);
    expect(late[0]).toMatchObject({ level: 'alert', title: 'Draw #1 still open' });
  });

  it('flags a closed draw whose randomness has not arrived', () => {
    const closedAt = BigInt(cutoff + 120);
    const draws = [
      { id: 4n, draw: draw({ status: Status.Closed, cutoff: BigInt(cutoff), closedAt }) },
    ];
    expect(drawChecks(draws, cutoff + 600, grace, vrfGrace)[0]!.level).toBe('ok');
    const stuck = drawChecks(draws, cutoff + 2 * 3600, grace, vrfGrace);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]).toMatchObject({ level: 'alert', title: 'Draw #4: no random number' });
    expect(stuck[0]!.detail).toContain('admin can void it now');
    expect(drawChecks(draws, cutoff + 2 * DAY, grace, vrfGrace)[0]!.detail).toContain(
      'can be voided now',
    );
  });

  it("reports last night's draw as drawn, ignoring tonight's open draw", () => {
    const draws = [
      {
        id: 1n,
        draw: settled($(10), 0n, 1, {
          cutoff: BigInt(cutoff),
          settledAt: BigInt(cutoff + 150),
          winningNumber: 7,
        }),
      },
      { id: 2n, draw: draw({ cutoff: BigInt(cutoff + DAY) }) },
    ];
    const checks = drawChecks(draws, cutoff + 3600, grace, vrfGrace);
    expect(checks).toEqual([
      {
        level: 'ok',
        title: 'Draw #1 drawn',
        detail: 'Closed and settled 2m after its cutoff; winning number 07.',
      },
    ]);
  });

  it('warns on low balances and alerts on empty ones', () => {
    const fmt = (v: bigint) => `${v}`;
    expect(balanceCheck('Keeper', 10n, 5n, fmt, '').level).toBe('ok');
    expect(balanceCheck('Keeper', 4n, 5n, fmt, 'Top up.')).toEqual({
      level: 'warn',
      title: 'Keeper',
      detail: '4: below 5. Top up.',
    });
    expect(balanceCheck('Keeper', 0n, 5n, fmt, '').level).toBe('alert');
    expect(balanceCheck('Keeper', null, 5n, fmt, '').level).toBe('warn');
  });

  it('checks the VRF currency in use and that the adapter is a consumer', () => {
    const fmt = (v: bigint) => `${v}`;
    const sub = { link: 1n, native: 100n, consumers: [A] };
    expect(vrfChecks(sub, false, A, 5n, 5n, fmt, fmt).map((c) => c.level)).toEqual(['warn']);
    expect(vrfChecks(sub, true, A, 5n, 5n, fmt, fmt).map((c) => c.level)).toEqual(['ok']);
    const missing = vrfChecks(sub, true, B, 5n, 5n, fmt, fmt);
    expect(missing[1]).toMatchObject({ level: 'alert', title: 'VRF consumer missing' });
    expect(vrfChecks(null, false, A, 5n, 5n, fmt, fmt)[0]!.level).toBe('warn');
  });

  it('sorts alerts first', () => {
    const sorted = sortChecks([
      { level: 'ok', title: 'a', detail: '' },
      { level: 'alert', title: 'b', detail: '' },
      { level: 'warn', title: 'c', detail: '' },
    ]);
    expect(sorted.map((c) => c.title)).toEqual(['b', 'c', 'a']);
  });

  it('formats durations', () => {
    expect(duration(59)).toBe('0m');
    expect(duration(3 * 3600 + 5 * 60)).toBe('3h 05m');
    expect(duration(2 * DAY + 4 * 3600)).toBe('2d 4h');
  });
});

describe('pendingCalls', () => {
  const game = '0x5f953504743B7Da528A78A2CA4C3941cFda62ED9' as Address;
  const call = (id: string, target: Address = game) => ({
    id: id as `0x${string}`,
    index: 0n,
    target,
    data: '0x' as `0x${string}`,
    delay: 3600n,
  });

  it('keeps calls on the game that are neither done nor cancelled', () => {
    const scheduled = [call('0x01'), call('0x02'), call('0x03'), call('0x04', A), call('0x05')];
    const stamps = new Map<string, bigint>([
      ['0x01', 0n], // cancelled
      ['0x02', 1n], // executed
      ['0x03', 5_000n],
      ['0x04', 5_000n],
      ['0x05', 2_000n],
    ]);
    const pending = pendingCalls(scheduled, stamps, game.toLowerCase() as Address, 3_000);
    expect(pending.map((p) => [p.id, p.state])).toEqual([
      ['0x05', 'ready'],
      ['0x03', 'waiting'],
    ]);
  });
});
