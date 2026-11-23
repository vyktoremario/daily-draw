import { describe, expect, it } from 'vitest';
import { formatDrawNumber, parseDrawNumber } from './rules.js';

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
