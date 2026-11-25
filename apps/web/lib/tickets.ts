import { ONCHAIN_RULES, ticketCost, type GameRules } from '@daily-draw/shared';

/** A ticket slip: one slot per ticket in the bundle, `null` until a number is picked. */
export type Slip = (number | null)[];

export const RULES: GameRules = ONCHAIN_RULES;
export const BUNDLES = RULES.bundleSizes;

/** Bundle sizes a wallet can still buy in a draw, given how many tickets it already holds. */
export function availableBundles(bought: number, rules: GameRules = RULES): number[] {
  return rules.bundleSizes.filter((size) => bought + size <= rules.maxTicketsPerPlayerPerDay);
}

/** Change the bundle size, keeping the numbers already picked (from the start). */
export function resizeSlip(slip: Slip, size: number): Slip {
  return Array.from({ length: size }, (_, i) => slip[i] ?? null);
}

/** Put `value` in the first empty slot; if the slip is full, replace the selected one. */
export function placeNumber(slip: Slip, value: number, selected?: number): Slip {
  const next = [...slip];
  const empty = next.indexOf(null);
  const at = selected !== undefined && selected < next.length ? selected : empty;
  if (at < 0) return next;
  next[at] = value;
  return next;
}

/** Lucky dip: fill every empty slot with a random number in range. */
export function luckyDip(
  slip: Slip,
  range: number = RULES.numberRange,
  random: () => number = Math.random,
): number[] {
  return slip.map((n) => n ?? Math.min(range - 1, Math.floor(random() * range)));
}

export function isComplete(slip: Slip): slip is number[] {
  return slip.every((n) => n !== null);
}

/** Group a list of numbers into `{ number, count }`, in order of first appearance. */
export function groupNumbers(numbers: readonly number[]): { number: number; count: number }[] {
  const groups = new Map<number, number>();
  for (const n of numbers) groups.set(n, (groups.get(n) ?? 0) + 1);
  return [...groups].map(([number, count]) => ({ number, count }));
}

/** Price, fee and total for a bundle, in USDC base units. */
export function bundleCost(count: number, rules: GameRules = RULES) {
  return ticketCost(rules, count);
}
