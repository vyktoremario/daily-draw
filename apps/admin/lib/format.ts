import { formatUnits } from 'viem';

const WAT = 'Africa/Lagos';

function group(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** USDC base units → "$1,234.50". Sub-cent dust is shown rather than rounded away: "$0.000001". */
export function usd(units: bigint): string {
  const sign = units < 0n ? '-' : '';
  const [whole, frac = ''] = formatUnits(units < 0n ? -units : units, 6).split('.');
  const decimals = frac.replace(/0+$/, '').padEnd(2, '0');
  return `${sign}$${group(whole!)}.${decimals}`;
}

/** An 18-decimal amount → "0.0123 ETH" (at most `maxDecimals`, trailing zeros dropped). */
export function token18(value: bigint, symbol: string, maxDecimals = 4): string {
  const [whole, frac = ''] = formatUnits(value, 18).split('.');
  const cut = frac.slice(0, maxDecimals).replace(/0+$/, '');
  const shown = cut ? `${group(whole!)}.${cut}` : group(whole!);
  return `${value > 0n && shown === '0' ? '<0.' + '0'.repeat(maxDecimals - 1) + '1' : shown} ${symbol}`;
}

/** "Wed 25 Nov" in Lagos time. */
export function watDate(unixSeconds: number | bigint): string {
  return new Date(Number(unixSeconds) * 1000)
    .toLocaleDateString('en-GB', {
      timeZone: WAT,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    .replace(',', '');
}

/** "8:45pm" in Lagos time. */
export function watTime(unixSeconds: number | bigint): string {
  return new Date(Number(unixSeconds) * 1000)
    .toLocaleTimeString('en-GB', {
      timeZone: WAT,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
    .replace(/\s/g, '')
    .toLowerCase();
}

/** "Wed 25 Nov, 8:45pm" in Lagos time. */
export function watDateTime(unixSeconds: number | bigint): string {
  return `${watDate(unixSeconds)}, ${watTime(unixSeconds)}`;
}

/** 7 → "07". */
export function number2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 1000 bps → "10%"; 250 → "2.5%". */
export function percent(bps: number): string {
  return `${bps / 100}%`;
}

/** "0x1234…abcd" */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
