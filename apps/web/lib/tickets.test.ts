import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PRICING,
  availableBundles,
  bundleCost,
  limitLine,
  walletLimitOf,
  withinLimit,
  formatFee,
  priceLine,
  pricingOf,
  groupNumbers,
  isComplete,
  luckyDip,
  placeNumber,
  resizeSlip,
} from './tickets';

describe('bundles and fee', () => {
  it('defaults to $1 a ticket plus a 2% fee', () => {
    expect(DEFAULT_PRICING).toEqual({ ticketPrice: 1_000_000n, feeBps: 200 });
    expect(bundleCost(1)).toEqual({ price: 1_000_000n, fee: 20_000n, total: 1_020_000n });
    expect(bundleCost(2).total).toBe(2_040_000n);
    expect(bundleCost(5).total).toBe(5_100_000n);
    expect(bundleCost(10)).toEqual({ price: 10_000_000n, fee: 200_000n, total: 10_200_000n });
  });

  it("charges the open draw's own price and fee", () => {
    // A draw opened before the fee change (#44) keeps 10%.
    const tenPct = { params: { ticketPrice: 1_000_000n, feeBps: 1000, numberRange: 100 } };
    expect(pricingOf(tenPct)).toEqual({ ticketPrice: 1_000_000n, feeBps: 1000 });
    expect(bundleCost(1, pricingOf(tenPct)).total).toBe(1_100_000n);
    expect(bundleCost(10, pricingOf(tenPct)).total).toBe(11_000_000n);
    expect(bundleCost(5, { ticketPrice: 2_000_000n, feeBps: 250 })).toEqual({
      price: 10_000_000n,
      fee: 250_000n,
      total: 10_250_000n,
    });
    expect(pricingOf(undefined)).toBe(DEFAULT_PRICING); // still loading
  });

  it('describes the price', () => {
    expect(priceLine(DEFAULT_PRICING)).toBe('$1 a ticket + 2% fee');
    expect(priceLine({ ticketPrice: 1_000_000n, feeBps: 1000 })).toBe('$1 a ticket + 10% fee');
    expect(priceLine({ ticketPrice: 1_500_000n, feeBps: 250 })).toBe('$1.50 a ticket + 2.5% fee');
    expect(formatFee(0)).toBe('0%');
  });

  it('rejects sizes that are not bundles', () => {
    expect(() => bundleCost(3)).toThrow(/bundles of 1, 2, 5, 10/);
  });

  it('offers only bundles that fit under the 20-ticket wallet limit', () => {
    expect(availableBundles(0)).toEqual([1, 2, 5, 10]);
    expect(availableBundles(10)).toEqual([1, 2, 5, 10]);
    expect(availableBundles(11)).toEqual([1, 2, 5]);
    expect(availableBundles(16)).toEqual([1, 2]);
    expect(availableBundles(19)).toEqual([1]);
    expect(availableBundles(20)).toEqual([]);
  });

  it("uses the open draw's own wallet limit", () => {
    expect(walletLimitOf(undefined)).toBe(20); // still loading
    expect(walletLimitOf({ params: { maxTicketsPerWallet: 10 } })).toBe(10);
    expect(availableBundles(0, 10)).toEqual([1, 2, 5, 10]);
    expect(availableBundles(5, 10)).toEqual([1, 2, 5]);
    expect(availableBundles(10, 10)).toEqual([]);
    expect(availableBundles(30, 50)).toEqual([1, 2, 5, 10]);
  });

  it('blocks a purchase that would go over the limit', () => {
    expect(withinLimit(10, 10, 20)).toBe(true);
    expect(withinLimit(11, 10, 20)).toBe(false);
    expect(withinLimit(20, 1, 20)).toBe(false);
    expect(limitLine(3, 20)).toBe('3 of 20 tickets today');
  });
});

describe('ticket slip', () => {
  it('keeps picks when the bundle size changes', () => {
    expect(resizeSlip([7, 42], 5)).toEqual([7, 42, null, null, null]);
    expect(resizeSlip([7, 42, 3], 1)).toEqual([7]);
  });

  it('fills the first empty slot, or the selected one', () => {
    expect(placeNumber([null, null], 42)).toEqual([42, null]);
    expect(placeNumber([42, null], 7)).toEqual([42, 7]);
    expect(placeNumber([42, 7], 9, 0)).toEqual([9, 7]);
    expect(placeNumber([42, 7], 9)).toEqual([42, 7]); // full and nothing selected
  });

  it('lucky dip fills only the empty slots, within 00-99', () => {
    const values = [0, 0.999999, 0.5];
    let i = 0;
    const random = () => values[i++ % values.length]!;
    expect(luckyDip([null, 42, null, null], 100, random)).toEqual([0, 42, 99, 50]);
    const dipped = luckyDip(Array(10).fill(null));
    expect(dipped.every((n) => Number.isInteger(n) && n >= 0 && n <= 99)).toBe(true);
  });

  it('knows when every ticket has a number', () => {
    expect(isComplete([1, 2])).toBe(true);
    expect(isComplete([1, null])).toBe(false);
  });

  it('groups repeated numbers in order of first appearance', () => {
    expect(groupNumbers([42, 7, 42, 42])).toEqual([
      { number: 42, count: 3 },
      { number: 7, count: 1 },
    ]);
  });
});
