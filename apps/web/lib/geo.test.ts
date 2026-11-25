import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOCKED_COUNTRIES, blockedCountriesFromEnv, isBlocked } from './geo';

describe('blocked countries list', () => {
  it('uses the placeholder default when BLOCKED_COUNTRIES is unset or blank', () => {
    expect(blockedCountriesFromEnv({})).toBe(DEFAULT_BLOCKED_COUNTRIES);
    expect(blockedCountriesFromEnv({ BLOCKED_COUNTRIES: '  ' })).toBe(DEFAULT_BLOCKED_COUNTRIES);
    expect(DEFAULT_BLOCKED_COUNTRIES).toEqual(
      expect.arrayContaining(['CU', 'IR', 'KP', 'SY', 'UA-43']),
    );
  });

  it('parses an override, case-insensitive, comma or space separated', () => {
    expect(blockedCountriesFromEnv({ BLOCKED_COUNTRIES: 'us, ir ua-43,,kp' })).toEqual([
      'US',
      'IR',
      'UA-43',
      'KP',
    ]);
  });

  it('drops entries that are not country or region codes', () => {
    expect(blockedCountriesFromEnv({ BLOCKED_COUNTRIES: 'US,USA,1,IR-' })).toEqual(['US']);
  });

  it('"none" blocks nobody', () => {
    expect(blockedCountriesFromEnv({ BLOCKED_COUNTRIES: 'None' })).toEqual([]);
  });
});

describe('isBlocked', () => {
  const list = ['IR', 'UA-43'];

  it('blocks a listed country', () => {
    expect(isBlocked('IR', null, list)).toBe(true);
    expect(isBlocked('ir', undefined, list)).toBe(true);
  });

  it('allows other countries', () => {
    expect(isBlocked('NG', null, list)).toBe(false);
    expect(isBlocked('UA', null, list)).toBe(false);
  });

  it('blocks a listed region but not the rest of its country', () => {
    expect(isBlocked('UA', '43', list)).toBe(true);
    expect(isBlocked('UA', '30', list)).toBe(false);
  });

  it('allows visitors without a country header (local dev)', () => {
    expect(isBlocked(null, null, list)).toBe(false);
    expect(isBlocked('', '43', list)).toBe(false);
  });

  it('allows everyone with an empty list', () => {
    expect(isBlocked('IR', null, [])).toBe(false);
  });
});
