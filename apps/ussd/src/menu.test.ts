import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES } from '@daily-draw/shared';
import { handleUssd, MAX_SCREEN_CHARS, type UssdContext } from './menu.js';

const ctx: UssdContext = {
  rules: DEFAULT_RULES,
  poolLabel: '₦612,400',
  lastResult: 'Last number: 42. 31 winners, ₦27,419 each.',
};

describe('handleUssd', () => {
  it('shows the main menu with the pool', () => {
    const r = handleUssd('', ctx);
    expect(r.type).toBe('CON');
    expect(r.message).toContain('₦612,400');
    expect(r.message).toContain('1 Play today (₦100)');
  });

  it('walks the pick-a-number flow', () => {
    expect(handleUssd('1*1', ctx).message).toContain('00-99');
    expect(handleUssd('1*1*42', ctx).message).toContain('How many tickets on 42');
    expect(handleUssd('1*1*42*2', ctx).message).toContain('2 tickets on 42 for ₦200');
    const done = handleUssd('1*1*42*2*1', ctx);
    expect(done.type).toBe('END');
    expect(done.message).toContain('2 tickets on 42');
    expect(handleUssd('1*1*42*2*2', ctx).message).toContain('Nothing was charged');
  });

  it('keeps leading zeros and rejects bad numbers', () => {
    expect(handleUssd('1*1*07', ctx).message).toContain('on 07');
    expect(handleUssd('1*1*7', ctx).type).toBe('END');
    expect(handleUssd('1*1*100', ctx).type).toBe('END');
  });

  it('enforces the per-day ticket limit', () => {
    expect(handleUssd('1*1*42*21', ctx).message).toContain('Invalid');
    expect(handleUssd('1*1*42*0', ctx).message).toContain('Invalid');
    expect(handleUssd('1*2*20', ctx).type).toBe('CON');
  });

  it('ends on unknown options', () => {
    expect(handleUssd('9', ctx)).toEqual({
      type: 'END',
      message: 'Invalid choice. Please dial again.',
    });
  });

  it('keeps every screen within the telco limit', () => {
    const paths = [
      '',
      '1',
      '1*1',
      '1*1*42',
      '1*1*42*20',
      '1*1*42*20*1',
      '1*2',
      '1*2*20',
      '1*2*20*1',
      '2',
      '3',
      '4',
      '0',
    ];
    for (const p of paths) {
      expect(handleUssd(p, ctx).message.length, p).toBeLessThanOrEqual(MAX_SCREEN_CHARS);
    }
  });
});
