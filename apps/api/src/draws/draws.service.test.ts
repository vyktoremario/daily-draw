import { describe, expect, it } from 'vitest';
import type { Database } from '@daily-draw/db';
import type { Kysely } from 'kysely';
import { DrawsService } from './draws.service.js';

describe('DrawsService.rules', () => {
  it('serialises kobo amounts as strings, not floats', () => {
    const service = new DrawsService({} as Kysely<Database>);
    const rules = service.rules();
    expect(rules.currency).toBe('NGN');
    expect(rules.ticketPrice).toBe('10000');
    expect(rules.ticketPriceLabel).toBe('₦100');
    expect(rules.ticketFeeBps).toBe(200);
    expect(rules.split).toEqual({
      winnersBps: 6500,
      teamBps: 1000,
      buybackBps: 500,
      referrersBps: 2000,
    });
    expect(rules.numberRange).toBe(100);
    expect(rules.cutoffTime).toBe('20:45');
    expect(() => JSON.stringify(rules)).not.toThrow();
  });
});
