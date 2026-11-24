import { describe, expect, it } from 'vitest';
import { formatNaira, formatUsdc, naira, usdc } from './money.js';
import {
  DEFAULT_SPLIT,
  NAIRA_RULES,
  ONCHAIN_RULES,
  assertValidSplit,
  formatAmount,
  formatDrawNumber,
  parseDrawNumber,
  ticketCost,
} from './rules.js';

describe('draw numbers', () => {
  it('pads with leading zeros', () => {
    expect(formatDrawNumber(7, 100)).toBe('07');
    expect(formatDrawNumber(7, 1000)).toBe('007');
  });

  it('parses only exact-width numbers in range', () => {
    expect(parseDrawNumber('07', 100)).toBe(7);
    expect(() => parseDrawNumber('7', 100)).toThrow();
    expect(() => parseDrawNumber('100', 100)).toThrow();
    expect(() => parseDrawNumber('ab', 100)).toThrow();
    expect(parseDrawNumber('999', 1000)).toBe(999);
  });
});

describe('rules', () => {
  it('uses the agreed 65/15/20 split, 10% fee and 00-99', () => {
    expect(DEFAULT_SPLIT).toEqual({
      winnersBps: 6500,
      teamBps: 1000,
      buybackBps: 500,
      referrersBps: 2000,
    });
    expect(() => assertValidSplit(DEFAULT_SPLIT)).not.toThrow();
    for (const rules of [ONCHAIN_RULES, NAIRA_RULES]) {
      expect(rules.ticketFeeBps).toBe(1000);
      expect(rules.numberRange).toBe(100);
      expect(rules.bundleSizes).toEqual([1, 2, 5, 10]);
    }
    expect(ONCHAIN_RULES.ticketPrice).toBe(usdc(1));
    expect(NAIRA_RULES.ticketPrice).toBe(naira(100));
  });

  it('rejects splits that do not add up to 100%', () => {
    expect(() => assertValidSplit({ ...DEFAULT_SPLIT, winnersBps: 6400 })).toThrow();
    expect(() => assertValidSplit({ ...DEFAULT_SPLIT, teamBps: -1, buybackBps: 1501 })).toThrow();
  });
});

describe('ticketCost', () => {
  it('adds the 10% fee on top of the price', () => {
    expect(ticketCost(ONCHAIN_RULES, 1)).toEqual({
      price: usdc(1),
      fee: 100_000n,
      total: 1_100_000n,
    });
    expect(ticketCost(NAIRA_RULES, 10)).toEqual({
      price: naira(1_000),
      fee: naira(100),
      total: naira(1_100),
    });
  });

  it('only sells the agreed bundles', () => {
    for (const n of [2, 5]) expect(() => ticketCost(ONCHAIN_RULES, n)).not.toThrow();
    for (const n of [0, 3, 11, 20]) expect(() => ticketCost(ONCHAIN_RULES, n)).toThrow();
  });
});

describe('formatting', () => {
  it('formats USDC and naira', () => {
    expect(formatUsdc(1_100_000n)).toBe('$1.10');
    expect(formatUsdc(usdc(1_234))).toBe('$1,234.00');
    expect(formatUsdc(1_234_567n)).toBe('$1.234567');
    expect(formatAmount(usdc(65), ONCHAIN_RULES)).toBe('$65.00');
    expect(formatAmount(naira(110), NAIRA_RULES)).toBe(formatNaira(naira(110)));
  });
});
