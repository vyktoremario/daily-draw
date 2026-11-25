import { describe, expect, it } from 'vitest';
import {
  blockAtOrBefore,
  decideClose,
  drawsToClaimFor,
  recentDrawIds,
  smallerLogRange,
  Status,
  stuckDraws,
  winnersOf,
  type DrawState,
} from './decide.js';

const H = 3600n;
const draw = (over: Partial<DrawState>): DrawState => ({
  id: 1n,
  status: Status.Open,
  cutoff: 1_000_000n,
  winningNumber: 0,
  winningTickets: 0,
  claimedTickets: 0,
  settledAt: 0n,
  closedAt: 0n,
  ...over,
});

describe('decideClose', () => {
  it('waits before the cutoff', () => {
    const d = decideClose(draw({}), 1_000_000n - 2n * H, false);
    expect(d).toEqual({
      action: 'none',
      reason: 'draw #1 is open until its cutoff, 2h 0m from now',
    });
  });

  it('closes at and after the cutoff', () => {
    expect(decideClose(draw({}), 1_000_000n, false)).toEqual({ action: 'close', drawId: 1n });
    expect(decideClose(draw({ id: 7n }), 1_000_000n + 5n, false)).toEqual({
      action: 'close',
      drawId: 7n,
    });
  });

  it('does nothing for a draw that is no longer open, or while paused', () => {
    expect(decideClose(draw({ status: Status.Closed }), 2_000_000n, false).action).toBe('none');
    const paused = decideClose(draw({}), 2_000_000n, true);
    expect(paused).toEqual({
      action: 'none',
      reason: 'draw #1 is past its cutoff, but the game is paused',
    });
  });
});

describe('drawsToClaimFor', () => {
  const settled = draw({
    status: Status.Settled,
    winningTickets: 3,
    claimedTickets: 1,
    settledAt: 100n * H,
  });

  it('picks settled draws with unclaimed winners from 24 hours after settlement', () => {
    expect(drawsToClaimFor([settled], 124n * H - 1n)).toEqual([]);
    expect(drawsToClaimFor([settled], 124n * H)).toEqual([settled]);
  });

  it('skips fully claimed, unsettled, voided and swept draws', () => {
    const now = 1_000n * H;
    expect(
      drawsToClaimFor(
        [
          { ...settled, claimedTickets: 3 },
          { ...settled, winningTickets: 0, claimedTickets: 0 },
          { ...settled, status: Status.Closed },
          { ...settled, status: Status.Voided },
          { ...settled, status: Status.Swept },
        ],
        now,
      ),
    ).toEqual([]);
  });
});

describe('stuckDraws', () => {
  it('warns about a closed draw without randomness after an hour, and says when it can be voided', () => {
    const closed = draw({ id: 4n, status: Status.Closed, closedAt: 10n * H });
    expect(stuckDraws([closed], 10n * H + 59n * 60n)).toEqual([]);
    expect(stuckDraws([closed], 12n * H)[0]!.message).toMatch(/waited 2h 0m.*VRF subscription/);
    expect(stuckDraws([closed], 34n * H)[0]!.message).toMatch(/can now be voided/);
    expect(stuckDraws([{ ...closed, status: Status.Settled }], 34n * H)).toEqual([]);
  });
});

describe('recentDrawIds', () => {
  it('lists the draws before the current one, at most 35 back', () => {
    expect(recentDrawIds(1n)).toEqual([]);
    expect(recentDrawIds(4n)).toEqual([1n, 2n, 3n]);
    const ids = recentDrawIds(100n);
    expect(ids).toHaveLength(35);
    expect(ids[0]).toBe(65n);
    expect(ids.at(-1)).toBe(99n);
  });
});

describe('winnersOf', () => {
  it('lists each wallet that bought the winning number once', () => {
    const a = '0x000000000000000000000000000000000000000A' as const;
    const b = '0x000000000000000000000000000000000000000b' as const;
    expect(
      winnersOf(
        [
          { player: a, numbers: [1, 42] },
          { player: b, numbers: [7] },
          { player: a, numbers: [42] },
          { player: '0x000000000000000000000000000000000000000a', numbers: [42, 42] },
        ],
        42,
      ),
    ).toEqual([a]);
    expect(winnersOf([{ player: b, numbers: [7] }], 42)).toEqual([]);
  });
});

describe('blockAtOrBefore', () => {
  // Blocks every 2 seconds from t=1000, with a 60-second gap after block 500.
  const ts = (b: bigint) => 1_000n + 2n * b + (b > 500n ? 60n : 0n);

  it('finds the last block at or before a time in a few lookups', async () => {
    let lookups = 0;
    const lookup = async (b: bigint) => {
      lookups++;
      return ts(b);
    };
    expect(await blockAtOrBefore(ts(321n), 0n, 10_000n, lookup)).toBe(321n);
    expect(lookups).toBeLessThan(10);
    expect(await blockAtOrBefore(ts(321n) + 1n, 0n, 10_000n, lookup)).toBe(321n);
    // Inside the gap: block 500 is the last one before.
    expect(await blockAtOrBefore(ts(500n) + 30n, 0n, 10_000n, lookup)).toBe(500n);
    expect(await blockAtOrBefore(ts(9_000n), 0n, 10_000n, lookup)).toBe(9_000n);
  });

  it('clamps to the range', async () => {
    const lookup = async (b: bigint) => ts(b);
    expect(await blockAtOrBefore(0n, 10n, 100n, lookup)).toBe(10n);
    expect(await blockAtOrBefore(10n ** 12n, 10n, 100n, lookup)).toBe(100n);
  });
});

describe('smallerLogRange', () => {
  it('uses the limit the RPC states, else halves, and gives up at 10 blocks', () => {
    const rpc = (message: string) => ({ shortMessage: 'RPC Request failed.', cause: { message } });
    expect(smallerLogRange(9000n, rpc('eth_getLogs is limited to a 200 range'))).toBe(200n);
    expect(smallerLogRange(90_000n, rpc('exceed maximum block range: 50000'))).toBe(50_000n);
    expect(
      smallerLogRange(9000n, rpc('ranges over 100 blocks are not supported on free plan')),
    ).toBe(100n);
    expect(smallerLogRange(9000n, rpc('Maximum allowed number of requested blocks is 1000'))).toBe(
      1000n,
    );
    expect(smallerLogRange(9000n, new Error('timeout'))).toBe(4500n);
    // A stated limit no smaller than what failed: halve instead.
    expect(smallerLogRange(200n, rpc('eth_getLogs is limited to a 200 range'))).toBe(100n);
    expect(smallerLogRange(19n, new Error('timeout'))).toBeNull();
  });
});
