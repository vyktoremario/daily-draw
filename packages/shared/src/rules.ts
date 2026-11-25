import { applyBps, formatNaira, formatUsdc, naira, usdc } from './money.js';

export type NumberRange = 100 | 1000;
export type Currency = 'USDC' | 'NGN';

/**
 * How a won pool is shared, in basis points (10000 = 100%). Requirements v0.2:
 * 65% winners, 15% company (10% team + 5% token buy-back and burn), 20% referrers.
 */
export interface PoolSplit {
  winnersBps: number;
  teamBps: number;
  buybackBps: number;
  referrersBps: number;
}

export const DEFAULT_SPLIT: PoolSplit = {
  winnersBps: 6500,
  teamBps: 1000,
  buybackBps: 500,
  referrersBps: 2000,
};

/**
 * Game settings. A draw copies these in when it is created, so later changes only affect
 * future draws. Amounts are integers in the currency's smallest unit: USDC has 6 decimals
 * (1 USDC = 1_000_000), naira is counted in kobo (₦1 = 100).
 */
export interface GameRules {
  currency: Currency;
  ticketPrice: bigint;
  /** Fee added on top of each ticket, in basis points (200 = 2%). Not part of the pool. */
  ticketFeeBps: number;
  /** Allowed ticket counts in one purchase. */
  bundleSizes: readonly number[];
  /** 100 → numbers 00–99, 1000 → 000–999. */
  numberRange: NumberRange;
  split: PoolSplit;
  /** A referrer earns only if they bought a ticket within this many days of the draw. */
  referrerActiveDays: number;
  maxTicketsPerPlayerPerDay: number;
  /** Local time in WAT, HH:mm. */
  cutoffTime: string;
  drawTime: string;
  timeZone: 'Africa/Lagos';
  /** After this many consecutive rollovers, the last-digit rule shares the pool. */
  rolloverLimit: number;
  /** On-chain prizes not claimed within this many days go into the next pool. */
  unclaimedPrizeDays: number;
}

const COMMON = {
  ticketFeeBps: 200,
  bundleSizes: [1, 2, 5, 10],
  numberRange: 100,
  split: DEFAULT_SPLIT,
  referrerActiveDays: 30,
  maxTicketsPerPlayerPerDay: 20,
  cutoffTime: '20:45',
  drawTime: '21:00',
  timeZone: 'Africa/Lagos',
  rolloverLimit: 7,
  unclaimedPrizeDays: 30,
} as const satisfies Omit<GameRules, 'currency' | 'ticketPrice'>;

/** The on-chain game (R1, R2): $1 tickets in USDC. */
export const ONCHAIN_RULES: GameRules = { ...COMMON, currency: 'USDC', ticketPrice: usdc(1) };

/** The naira game (R3): ₦100 tickets. */
export const NAIRA_RULES: GameRules = { ...COMMON, currency: 'NGN', ticketPrice: naira(100) };

export function assertValidSplit(split: PoolSplit): void {
  const parts = [split.winnersBps, split.teamBps, split.buybackBps, split.referrersBps];
  if (parts.some((p) => !Number.isInteger(p) || p < 0)) {
    throw new Error('Split parts must be non-negative integers (basis points)');
  }
  const total = parts.reduce((a, b) => a + b, 0);
  if (total !== 10_000) throw new Error(`Split must add up to 10000 bps, got ${total}`);
}

export interface TicketCost {
  /** Goes into the draw's pool. */
  price: bigint;
  /** Goes to the company, never into the pool. */
  fee: bigint;
  total: bigint;
}

/** What a player pays for `count` tickets. `count` must be one of the bundle sizes. */
export function ticketCost(rules: GameRules, count: number): TicketCost {
  if (!rules.bundleSizes.includes(count)) {
    throw new Error(`Tickets come in bundles of ${rules.bundleSizes.join(', ')}; got ${count}`);
  }
  const price = rules.ticketPrice * BigInt(count);
  const fee = applyBps(price, rules.ticketFeeBps);
  return { price, fee, total: price + fee };
}

/** Format an amount in the rules' currency, e.g. "$1.02" or "₦102". */
export function formatAmount(amount: bigint, rules: Pick<GameRules, 'currency'>): string {
  return rules.currency === 'USDC' ? formatUsdc(amount) : formatNaira(amount);
}

export function digitsFor(range: NumberRange): number {
  return range === 100 ? 2 : 3;
}

/** Format a drawn or picked number with leading zeros: 7 → "07". */
export function formatDrawNumber(value: number, range: NumberRange): string {
  assertValidNumber(value, range);
  return value.toString().padStart(digitsFor(range), '0');
}

/** Parse "07" → 7, rejecting anything outside the range or with the wrong number of digits. */
export function parseDrawNumber(input: string, range: NumberRange): number {
  const digits = digitsFor(range);
  if (!new RegExp(`^\\d{${digits}}$`).test(input)) {
    throw new Error(`Expected ${digits} digits, got "${input}"`);
  }
  const value = Number(input);
  assertValidNumber(value, range);
  return value;
}

export function assertValidNumber(value: number, range: NumberRange): void {
  if (!Number.isInteger(value) || value < 0 || value >= range) {
    throw new Error(`Number ${value} is outside 0–${range - 1}`);
  }
}
