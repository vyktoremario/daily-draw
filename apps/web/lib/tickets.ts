import {
  ONCHAIN_RULES,
  formatUsdc,
  ticketCost,
  type GameRules,
  type TicketCost,
} from '@daily-draw/shared';

/** A ticket slip: one slot per ticket in the bundle, `null` until a number is picked. */
export type Slip = (number | null)[];

export const RULES: GameRules = ONCHAIN_RULES;
export const BUNDLES = RULES.bundleSizes;

/**
 * Tickets one wallet may buy in a draw (one draw a day). Each draw copies the contract's
 * `maxTicketsPerWallet` when it opens, and `buyTickets` reverts above it; the product default
 * (20) is used only while the open draw loads. Raised over time through the timelock (#33).
 */
export function walletLimitOf(
  draw: { params: { maxTicketsPerWallet: number } } | undefined,
): number {
  return draw ? draw.params.maxTicketsPerWallet : RULES.maxTicketsPerPlayerPerDay;
}

/** Bundle sizes a wallet can still buy in a draw, given how many tickets it already holds. */
export function availableBundles(
  bought: number,
  limit: number = RULES.maxTicketsPerPlayerPerDay,
  rules: GameRules = RULES,
): number[] {
  return rules.bundleSizes.filter((size) => bought + size <= limit);
}

/** Whether buying `count` more keeps the wallet within the draw's limit. */
export function withinLimit(bought: number, count: number, limit: number): boolean {
  return bought + count <= limit;
}

/** "3 of 20 tickets today" */
export function limitLine(bought: number, limit: number): string {
  return `${bought} of ${limit} tickets today`;
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

/**
 * What a draw charges per ticket. Each draw copies the contract's params when it opens, so the
 * open draw's `params` (from `getDraw`) are what `buyTickets` will pull for it.
 */
export interface Pricing {
  ticketPrice: bigint;
  feeBps: number;
}

/** The product rules ($1 + 2%), used only until the open draw has loaded. */
export const DEFAULT_PRICING: Pricing = {
  ticketPrice: RULES.ticketPrice,
  feeBps: RULES.ticketFeeBps,
};

/** The open draw's pricing, or the default while it loads. */
export function pricingOf(draw: { params: Pricing } | undefined): Pricing {
  return draw
    ? { ticketPrice: draw.params.ticketPrice, feeBps: draw.params.feeBps }
    : DEFAULT_PRICING;
}

/**
 * Price, fee and total for a bundle, in USDC base units. Same maths as `DailyDraw.quote`:
 * price = ticket price × count, fee = price × feeBps / 10000.
 */
export function bundleCost(count: number, pricing: Pricing = DEFAULT_PRICING): TicketCost {
  return ticketCost(
    { ...RULES, ticketPrice: pricing.ticketPrice, ticketFeeBps: pricing.feeBps },
    count,
  );
}

/** Basis points as a percentage: 200 -> "2%", 250 -> "2.5%". */
export function formatFee(feeBps: number): string {
  return `${feeBps / 100}%`;
}

/** "$1 a ticket + 2% fee" (whole dollars without cents). */
export function priceLine(pricing: Pricing): string {
  const price = formatUsdc(pricing.ticketPrice).replace(/\.00$/, '');
  return `${price} a ticket + ${formatFee(pricing.feeBps)} fee`;
}
