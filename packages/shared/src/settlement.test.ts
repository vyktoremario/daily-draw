import { describe, expect, it } from 'vitest';
import { usdc } from './money.js';
import { DEFAULT_SPLIT } from './rules.js';
import { settleDraw, type SettlementInput } from './settlement.js';

const base: SettlementInput = {
  sales: usdc(1_000),
  rolloverIn: 0n,
  split: DEFAULT_SPLIT,
  winningTickets: 10,
  winningTicketsWithActiveReferrer: 10,
};

function total(s: ReturnType<typeof settleDraw>): bigint {
  return s.prizesTotal + s.referralsPaid + s.team + s.buyback + s.rolloverOut;
}

describe('settleDraw (65/15/20)', () => {
  it('matches the worked example in Requirements v0.2', () => {
    // $1,000 pool, 10 winning tickets, 3 of them without a referrer.
    const s = settleDraw({ ...base, winningTicketsWithActiveReferrer: 7 });
    expect(s.prizePerTicket).toBe(usdc(65));
    expect(s.prizesTotal).toBe(usdc(650));
    expect(s.referralSharePerTicket).toBe(usdc(20));
    expect(s.referralsPaid).toBe(usdc(140));
    expect(s.team).toBe(usdc(100) + usdc(60));
    expect(s.buyback).toBe(usdc(50));
    expect(s.rolloverOut).toBe(0n);
  });

  it('rolls the whole pool over when nobody wins, taking nothing', () => {
    const s = settleDraw({
      ...base,
      rolloverIn: usdc(250),
      winningTickets: 0,
      winningTicketsWithActiveReferrer: 0,
    });
    expect(s.won).toBe(false);
    expect(s.rolloverOut).toBe(usdc(1_250));
    expect(s.team + s.buyback + s.prizesTotal + s.referralsPaid).toBe(0n);
  });

  it('includes rollover in the pool and gives every referral share to the team when nobody was referred', () => {
    const s = settleDraw({
      ...base,
      rolloverIn: usdc(1_000),
      winningTickets: 4,
      winningTicketsWithActiveReferrer: 0,
    });
    expect(s.pool).toBe(usdc(2_000));
    expect(s.prizePerTicket).toBe(usdc(325));
    expect(s.referralsPaid).toBe(0n);
    expect(s.team).toBe(usdc(200) + usdc(400));
    expect(total(s)).toBe(s.pool);
  });

  it('sends rounding leftovers to rollover', () => {
    const s = settleDraw({
      ...base,
      sales: 1_000_003n,
      winningTickets: 7,
      winningTicketsWithActiveReferrer: 3,
    });
    expect(total(s)).toBe(s.pool);
    expect(s.rolloverOut).toBeGreaterThan(0n);
    expect(s.rolloverOut).toBeLessThan(20n);
  });

  it('accounts for every unit across many random draws', () => {
    let seed = 7;
    const rand = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % max;
    };
    for (let i = 0; i < 5_000; i++) {
      const winningTickets = rand(300);
      const s = settleDraw({
        sales: BigInt(rand(2_000_000_000)) * 7n + BigInt(rand(1_000)),
        rolloverIn: BigInt(rand(1_000_000_000)),
        split: DEFAULT_SPLIT,
        winningTickets,
        winningTicketsWithActiveReferrer: winningTickets === 0 ? 0 : rand(winningTickets + 1),
      });
      expect(total(s)).toBe(s.pool);
      for (const v of [s.prizePerTicket, s.referralsPaid, s.team, s.buyback, s.rolloverOut]) {
        expect(v).toBeGreaterThanOrEqual(0n);
      }
      if (winningTickets > 0) expect(s.rolloverOut).toBeLessThan(BigInt(winningTickets) * 2n + 4n);
    }
  });

  it('rejects bad input', () => {
    expect(() => settleDraw({ ...base, winningTickets: -1 })).toThrow();
    expect(() => settleDraw({ ...base, winningTicketsWithActiveReferrer: 11 })).toThrow();
    expect(() => settleDraw({ ...base, sales: -1n })).toThrow();
    expect(() => settleDraw({ ...base, split: { ...DEFAULT_SPLIT, teamBps: 1001 } })).toThrow();
  });
});
