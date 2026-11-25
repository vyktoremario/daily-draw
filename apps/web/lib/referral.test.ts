import { describe, expect, it } from 'vitest';
import {
  REFERRAL_STORAGE_KEY,
  parseReferrer,
  referralLink,
  referrerForPurchase,
  rememberReferrer,
  shortAddress,
} from './referral';

const ALICE = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const BOB = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const ZERO = '0x0000000000000000000000000000000000000000';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('parseReferrer', () => {
  it('accepts an address in any case and returns it checksummed', () => {
    expect(parseReferrer(ALICE.toLowerCase())).toBe(ALICE);
    expect(parseReferrer(` ${ALICE} `)).toBe(ALICE);
  });

  it('rejects junk, the zero address and the player themselves', () => {
    expect(parseReferrer(null)).toBeNull();
    expect(parseReferrer('')).toBeNull();
    expect(parseReferrer('friend123')).toBeNull();
    expect(parseReferrer('0x1234')).toBeNull();
    expect(parseReferrer(ZERO)).toBeNull();
    expect(parseReferrer(ALICE, ALICE.toLowerCase())).toBeNull();
    expect(parseReferrer(ALICE, BOB)).toBe(ALICE);
  });
});

describe('referral links', () => {
  it('builds a home-page link with the address as ref', () => {
    expect(referralLink('https://dailydraw.app', ALICE)).toBe(
      `https://dailydraw.app/?ref=${ALICE}`,
    );
  });

  it('round-trips through URL parsing', () => {
    const url = new URL(referralLink('http://localhost:3000', BOB));
    expect(parseReferrer(url.searchParams.get('ref'))).toBe(BOB);
  });

  it('remembers the first valid link and ignores later ones', () => {
    const storage = memoryStorage();
    expect(rememberReferrer(storage, 'nonsense')).toBeNull();
    expect(storage.data.size).toBe(0);
    expect(rememberReferrer(storage, ALICE.toLowerCase())).toBe(ALICE);
    expect(storage.data.get(REFERRAL_STORAGE_KEY)).toBe(ALICE);
    expect(rememberReferrer(storage, BOB)).toBe(ALICE);
  });

  it('replaces a corrupted saved value', () => {
    const storage = memoryStorage({ [REFERRAL_STORAGE_KEY]: 'garbage' });
    expect(rememberReferrer(storage, BOB)).toBe(BOB);
  });
});

describe('referrerForPurchase', () => {
  it('sends the saved referrer only on a first purchase, never yourself', () => {
    expect(referrerForPurchase(ALICE, BOB, false)).toBe(ALICE);
    expect(referrerForPurchase(ALICE, BOB, true)).toBe(ZERO);
    expect(referrerForPurchase(ALICE, ALICE, false)).toBe(ZERO);
    expect(referrerForPurchase(null, BOB, false)).toBe(ZERO);
  });
});

it('shortens addresses', () => {
  expect(shortAddress(ALICE)).toBe('0x7099…79C8');
});
