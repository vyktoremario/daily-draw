import { describe, expect, it } from 'vitest';
import { naira } from './money.js';
import { settleDraw, type SettlementInput } from './settlement.js';

const base: SettlementInput = {
  salesKobo: naira(800_000),
  rolloverInKobo: 0n,
  operatorCutBps: 2500,
  taxKobo: 0n,
  winningTickets: 80,
};

function conserved(input: SettlementInput) {
  const s = settleDraw(input);
  const out =
    s.operatorCutKobo +
    s.taxKobo +
    s.prizePerTicketKobo * BigInt(input.winningTickets) +
    s.rolloverOutKobo;
  return out === input.salesKobo + input.rolloverInKobo;
}

describe('settleDraw', () => {
  it('matches the worked example in the requirements', () => {
    const s = settleDraw(base);
    expect(s.operatorCutKobo).toBe(naira(200_000));
    expect(s.poolKobo).toBe(naira(600_000));
    expect(s.prizePerTicketKobo).toBe(naira(7_500));
    expect(s.rolloverOutKobo).toBe(0n);
  });

  it('rolls the whole pool over when nobody wins', () => {
    const s = settleDraw({ ...base, winningTickets: 0 });
    expect(s.prizePerTicketKobo).toBe(0n);
    expect(s.rolloverOutKobo).toBe(naira(600_000));
  });

  it('takes no cut from rollover and sends leftover kobo to rollover', () => {
    const s = settleDraw({ ...base, rolloverInKobo: naira(1_000), winningTickets: 7 });
    expect(s.operatorCutKobo).toBe(naira(200_000));
    expect(s.poolKobo).toBe(naira(601_000));
    expect(s.prizePerTicketKobo * 7n + s.rolloverOutKobo).toBe(s.poolKobo);
    expect(s.rolloverOutKobo).toBeLessThan(7n);
  });

  it('accounts for every kobo across many random draws', () => {
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % max;
    };
    for (let i = 0; i < 2_000; i++) {
      const input: SettlementInput = {
        salesKobo: BigInt(rand(10_000_000)) * 100n + BigInt(rand(100)),
        rolloverInKobo: BigInt(rand(5_000_000)),
        operatorCutBps: rand(10_001),
        taxKobo: 0n,
        winningTickets: rand(200),
      };
      expect(conserved(input)).toBe(true);
    }
  });

  it('rejects bad input', () => {
    expect(() => settleDraw({ ...base, winningTickets: -1 })).toThrow();
    expect(() => settleDraw({ ...base, taxKobo: naira(10_000_000) })).toThrow();
  });
});
