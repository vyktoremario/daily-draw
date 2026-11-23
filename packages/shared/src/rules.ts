import { naira, type Kobo } from './money.js';

export type NumberRange = 100 | 1000;

/**
 * Game settings. A draw copies these in when it is created, so later changes
 * only affect future draws (requirements N-53).
 */
export interface GameRules {
  ticketPriceKobo: Kobo;
  /** 100 → numbers 00–99, 1000 → 000–999. */
  numberRange: NumberRange;
  /** Operator cut of ticket sales, in basis points (2500 = 25%). */
  operatorCutBps: number;
  maxTicketsPerPlayerPerDay: number;
  /** Local time in WAT, HH:mm. */
  cutoffTime: string;
  drawTime: string;
  timeZone: 'Africa/Lagos';
  /** After this many consecutive rollovers, the last-digit rule shares the pool. */
  rolloverLimit: number;
}

export const DEFAULT_RULES: GameRules = {
  ticketPriceKobo: naira(100),
  numberRange: 100,
  operatorCutBps: 2500,
  maxTicketsPerPlayerPerDay: 20,
  cutoffTime: '20:45',
  drawTime: '21:00',
  timeZone: 'Africa/Lagos',
  rolloverLimit: 7,
};

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
