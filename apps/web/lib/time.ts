const WAT = 'Africa/Lagos';

/** "2h 14m left", "3m 05s left", "Closed". */
export function formatCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'Closed';
  const s = Math.floor(secondsLeft);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m ${String(sec).padStart(2, '0')}s left`;
}

/** "8:45pm" in Lagos time. */
export function formatWatTime(unixSeconds: number | bigint): string {
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

/** "Wed 25 Nov" in Lagos time. */
export function formatWatDate(unixSeconds: number | bigint): string {
  return new Date(Number(unixSeconds) * 1000)
    .toLocaleDateString('en-GB', {
      timeZone: WAT,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
    .replace(',', '');
}

/**
 * Seconds to add to the device clock to get chain time. Only a chain clock that runs ahead
 * counts (a local Anvil chain moved forward with `pnpm chain warp`); real chains' latest block is
 * a few seconds behind, which is noise.
 */
export function chainClockOffset(latestBlockTimestamp: bigint, nowMs: number): number {
  const ahead = Number(latestBlockTimestamp) - Math.floor(nowMs / 1000);
  return ahead > 120 ? ahead : 0;
}

/** The draw happens at 9:00pm WAT, 15 minutes after sales close at 8:45pm. */
export const DRAW_DELAY_SECONDS = 15 * 60;

export function drawTime(cutoff: bigint): bigint {
  return cutoff + BigInt(DRAW_DELAY_SECONDS);
}
