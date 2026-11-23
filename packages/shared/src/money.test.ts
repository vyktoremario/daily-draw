import { describe, expect, it } from 'vitest';
import { applyBps, formatNaira, naira } from './money.js';

describe('money', () => {
  it('converts naira to kobo', () => {
    expect(naira(100)).toBe(10_000n);
    expect(() => naira(1.5)).toThrow();
  });

  it('formats naira', () => {
    expect(formatNaira(85_000_000n)).toBe('₦850,000');
    expect(formatNaira(2_741_935n)).toBe('₦27,419.35');
    expect(formatNaira(0n)).toBe('₦0');
    expect(formatNaira(-20_000n)).toBe('−₦200');
  });

  it('applies basis points rounding down', () => {
    expect(applyBps(naira(800_000), 2500)).toBe(naira(200_000));
    expect(applyBps(3n, 2500)).toBe(0n);
    expect(() => applyBps(100n, 10_001)).toThrow();
  });
});
