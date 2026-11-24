/**
 * All money is stored and computed as integer kobo (1 naira = 100 kobo) using bigint.
 * Never use floating point for money.
 */
export type Kobo = bigint;

export const KOBO_PER_NAIRA = 100n;

/** Convert whole naira to kobo. */
export function naira(amount: number | bigint): Kobo {
  if (typeof amount === 'number' && !Number.isInteger(amount)) {
    throw new Error(`naira() expects whole naira, got ${amount}`);
  }
  return BigInt(amount) * KOBO_PER_NAIRA;
}

/** Format kobo as a naira string, e.g. 85000000n -> "₦850,000". Shows kobo only when non-zero. */
export function formatNaira(kobo: Kobo): string {
  const negative = kobo < 0n;
  const abs = negative ? -kobo : kobo;
  const whole = abs / KOBO_PER_NAIRA;
  const frac = abs % KOBO_PER_NAIRA;
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fracStr = frac === 0n ? '' : `.${frac.toString().padStart(2, '0')}`;
  return `${negative ? '−' : ''}₦${wholeStr}${fracStr}`;
}

/** Basis points: 2500 bps = 25%. */
export function applyBps(amount: Kobo, bps: number): Kobo {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`bps must be an integer between 0 and 10000, got ${bps}`);
  }
  return (amount * BigInt(bps)) / 10_000n;
}

/** USDC has 6 decimals: 1 USDC = 1_000_000 units. */
export const USDC_UNITS = 1_000_000n;

/** Convert whole dollars of USDC to base units. */
export function usdc(amount: number | bigint): bigint {
  if (typeof amount === 'number' && !Number.isInteger(amount)) {
    throw new Error(`usdc() expects whole dollars, got ${amount}`);
  }
  return BigInt(amount) * USDC_UNITS;
}

/** Format USDC base units as dollars: 1_100_000n -> "$1.10", 1_234_567n -> "$1.234567". */
export function formatUsdc(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = (abs / USDC_UNITS).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let frac = (abs % USDC_UNITS).toString().padStart(6, '0').replace(/0+$/, '');
  if (frac.length < 2) frac = frac.padEnd(2, '0');
  return `${negative ? '−' : ''}$${whole}.${frac}`;
}
