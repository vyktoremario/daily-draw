import { getAddress, isAddress, type Address } from 'viem';

/** Where the referrer from a `?ref=` link is remembered until the player's first purchase. */
export const REFERRAL_STORAGE_KEY = 'dailydraw.ref';

/**
 * Read a referrer from a `?ref=` value. Referral codes are the referrer's wallet address, because
 * that is what the contract records. Returns null for anything invalid, or for the player's own
 * address (the contract ignores self-referrals anyway).
 */
export function parseReferrer(value: string | null | undefined, self?: string): Address | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!isAddress(trimmed, { strict: false })) return null;
  const address = getAddress(trimmed);
  if (address === '0x0000000000000000000000000000000000000000') return null;
  if (self && isAddress(self, { strict: false }) && getAddress(self) === address) return null;
  return address;
}

/** The link a player shares: the app's home page with their address as `ref`. */
export function referralLink(origin: string, referrer: Address): string {
  const url = new URL('/', origin);
  url.searchParams.set('ref', referrer);
  return url.toString();
}

/** First link wins: keep a saved referrer, otherwise save the one from this link. */
export function rememberReferrer(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  fromLink: string | null | undefined,
): Address | null {
  const saved = parseReferrer(storage.getItem(REFERRAL_STORAGE_KEY));
  if (saved) return saved;
  const parsed = parseReferrer(fromLink);
  if (parsed) storage.setItem(REFERRAL_STORAGE_KEY, parsed);
  return parsed;
}

/**
 * The referrer to pass to `buyTickets`: the saved one on a player's first purchase, never
 * themselves. After the first purchase the contract ignores it, so send none.
 */
export function referrerForPurchase(
  saved: string | null | undefined,
  player: string,
  hasPlayed: boolean,
): Address {
  const zero = '0x0000000000000000000000000000000000000000';
  if (hasPlayed) return zero;
  return parseReferrer(saved, player) ?? zero;
}

/** 0x1234…abcd */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
