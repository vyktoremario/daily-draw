import { describe, expect, it } from 'vitest';
import {
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  consentRecord,
  hasConsent,
  readConsent,
  saveConsent,
} from './consent';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe('18+ confirmation', () => {
  it('is missing until saved, then remembered', () => {
    const storage = memoryStorage();
    expect(readConsent(storage)).toBe(false);
    saveConsent(storage);
    expect(readConsent(storage)).toBe(true);
    expect(JSON.parse(storage.getItem(CONSENT_STORAGE_KEY)!)).toMatchObject({
      version: CONSENT_VERSION,
    });
  });

  it('asks again after the version changes or for junk values', () => {
    expect(hasConsent(consentRecord(1))).toBe(true);
    expect(hasConsent(JSON.stringify({ version: CONSENT_VERSION - 1, at: 1 }))).toBe(false);
    expect(hasConsent('yes')).toBe(false);
    expect(hasConsent('null')).toBe(false);
    expect(hasConsent(null)).toBe(false);
  });

  it('treats unavailable storage as not confirmed, without throwing', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readConsent(broken)).toBe(false);
    expect(() => saveConsent(broken)).not.toThrow();
    expect(readConsent(undefined)).toBe(false);
  });
});
