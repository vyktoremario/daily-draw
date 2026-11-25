// Chunked eth_getLogs scanning. RPCs cap the block range of one request (sepolia.base.org: 200
// blocks); the scanner retries a refused range in the size the error states, or half.

/**
 * The block range to retry with after `err`, or null to give up (the error isn't about the
 * range). Same rules as the keeper's (apps/keeper/src/decide.ts).
 */
export function smallerLogRange(current: bigint, err: unknown): bigint | null {
  const text = errorText(err);
  const stated =
    /limited to an? (\d+)/i.exec(text) ??
    /maximum block range:? (\d+)/i.exec(text) ??
    /ranges over (\d+) blocks/i.exec(text) ??
    /requested blocks is (\d+)/i.exec(text) ??
    /block range (?:is )?(?:too large|exceeds?)[^\d]*(\d+)/i.exec(text);
  if (stated) {
    const limit = BigInt(stated[1]!);
    if (limit > 0n && limit < current) return limit;
  }
  // Halve only for errors that look like a size limit; a network error should surface.
  if (!/range|block|limit|results|too (many|large)|exceed/i.test(text)) return null;
  const next = current / 2n;
  return next >= 10n ? next : null;
}

function errorText(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let depth = 0; e && depth < 5; depth++) {
    if (typeof e === 'object') {
      const o = e as {
        message?: unknown;
        details?: unknown;
        shortMessage?: unknown;
        cause?: unknown;
      };
      for (const v of [o.message, o.details, o.shortMessage])
        if (typeof v === 'string') parts.push(v);
      e = o.cause;
    } else {
      parts.push(String(e));
      break;
    }
  }
  return parts.join(' | ');
}

/**
 * Fetches `fromBlock..toBlock` (inclusive) in chunks of at most `chunk` blocks, shrinking the chunk
 * when the RPC refuses. Results come back in block order.
 */
export async function scanLogs<T>(
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
  fromBlock: bigint,
  toBlock: bigint,
  chunk: bigint,
): Promise<T[]> {
  const out: T[] = [];
  let size = chunk;
  let from = fromBlock;
  while (from <= toBlock) {
    const to = from + size - 1n < toBlock ? from + size - 1n : toBlock;
    try {
      out.push(...(await fetchRange(from, to)));
      from = to + 1n;
    } catch (err) {
      const next = smallerLogRange(size, err);
      if (next === null) throw err;
      size = next;
    }
  }
  return out;
}
