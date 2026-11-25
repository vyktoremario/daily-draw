import { describe, expect, it } from 'vitest';
import { chainClockOffset, drawTime, formatCountdown, formatWatDate, formatWatTime } from './time';

// 2026-11-25 19:45 UTC = 8:45pm WAT (UTC+1).
const CUTOFF = 1_795_635_900n;

describe('time', () => {
  it('formats the countdown to the cutoff', () => {
    expect(formatCountdown(0)).toBe('Closed');
    expect(formatCountdown(-5)).toBe('Closed');
    expect(formatCountdown(65)).toBe('1m 05s left');
    expect(formatCountdown(2 * 3600 + 14 * 60 + 59)).toBe('2h 14m left');
    expect(formatCountdown(26 * 3600)).toBe('1d 2h left');
  });

  it('shows cutoff and draw times in Lagos time', () => {
    expect(formatWatTime(CUTOFF)).toBe('8:45pm');
    expect(formatWatTime(drawTime(CUTOFF))).toBe('9:00pm');
    expect(formatWatDate(CUTOFF)).toBe('Wed 25 Nov');
  });

  it('follows a chain clock that runs ahead, ignoring small drift', () => {
    const now = 1_795_600_000_000;
    expect(chainClockOffset(1_795_600_000n + 3600n, now)).toBe(3600);
    expect(chainClockOffset(1_795_600_000n - 12n, now)).toBe(0);
    expect(chainClockOffset(1_795_600_000n + 30n, now)).toBe(0);
  });
});
