import { describe, expect, it } from 'vitest';
import { Status, type DrawState, type TicketPurchase } from './decide.js';
import { runKeeper, type KeeperChain, type Logger, type RunOptions } from './run.js';

const H = 3600n;
const GENESIS = 1_800_000_000n;
const ALICE = '0x000000000000000000000000000000000000a11c' as const;
const BOB = '0x0000000000000000000000000000000000000b0b' as const;
const CAROL = '0x00000000000000000000000000000000000ca201' as const;

/** An in-memory DailyDraw on a chain with a block every 2 seconds. */
class FakeChain implements KeeperChain {
  keeperAddress = '0x9032f538d36fD201D019d11361FDBb1EE72D1034' as const;
  now = GENESIS;
  draws = new Map<bigint, DrawState>();
  currentId = 1n;
  isPaused = false;
  isKeeper = true;
  balance = 10n ** 17n;
  purchases: (TicketPurchase & { drawId: bigint; block: bigint })[] = [];
  claimed = new Set<string>();
  sent: string[] = [];
  /** Make the next send fail, after optionally changing state (another keeper got there first). */
  failNextSend: (() => void) | null = null;

  blockAt(ts: bigint) {
    return (ts - GENESIS) / 2n;
  }
  async latestBlock() {
    return { number: this.blockAt(this.now), timestamp: this.now };
  }
  async blockTimestamp(block: bigint) {
    return GENESIS + block * 2n;
  }
  async currentDrawId() {
    return this.currentId;
  }
  async getDraw(id: bigint) {
    return { ...(this.draws.get(id) ?? blank(id)) };
  }
  async paused() {
    return this.isPaused;
  }
  async hasKeeperRole() {
    return this.isKeeper;
  }
  async keeperBalance() {
    return this.balance;
  }
  async ticketPurchases(drawId: bigint, fromBlock: bigint, toBlock: bigint) {
    return this.purchases.filter(
      (p) => p.drawId === drawId && p.block >= fromBlock && p.block <= toBlock,
    );
  }
  async claimableTickets(drawId: bigint, player: `0x${string}`) {
    const d = this.draws.get(drawId);
    if (!d || d.status !== Status.Settled || this.claimed.has(`${drawId}:${player}`)) return 0n;
    return BigInt(
      this.purchases
        .filter((p) => p.drawId === drawId && p.player === player)
        .flatMap((p) => p.numbers)
        .filter((n) => n === d.winningNumber).length,
    );
  }
  private maybeFail() {
    if (this.failNextSend) {
      const f = this.failNextSend;
      this.failNextSend = null;
      f();
      throw new Error('execution reverted');
    }
  }
  async closeDraw(drawId: bigint) {
    this.maybeFail();
    const d = this.draws.get(drawId)!;
    if (d.status !== Status.Open || this.now < d.cutoff) throw new Error('would revert');
    d.status = Status.Closed;
    d.closedAt = this.now;
    this.openDraw(drawId + 1n, d.cutoff + 24n * H);
    this.sent.push(`close ${drawId}`);
    return '0xc105e' as const;
  }
  async claimFor(player: `0x${string}`, drawId: bigint) {
    this.maybeFail();
    const tickets = await this.claimableTickets(drawId, player);
    if (tickets === 0n) throw new Error('would revert');
    this.claimed.add(`${drawId}:${player}`);
    this.draws.get(drawId)!.claimedTickets += Number(tickets);
    this.sent.push(`claim ${drawId} ${player}`);
    return '0xc1a1' as const;
  }

  openDraw(id: bigint, cutoff: bigint) {
    this.draws.set(id, { ...blank(id), status: Status.Open, cutoff });
    this.currentId = id;
  }
  buy(player: `0x${string}`, numbers: number[]) {
    this.purchases.push({ player, numbers, drawId: this.currentId, block: this.blockAt(this.now) });
  }
  settle(drawId: bigint, winningNumber: number) {
    const d = this.draws.get(drawId)!;
    d.status = Status.Settled;
    d.winningNumber = winningNumber;
    d.settledAt = this.now;
    d.winningTickets = this.purchases
      .filter((p) => p.drawId === drawId)
      .flatMap((p) => p.numbers)
      .filter((n) => n === winningNumber).length;
  }
}

function blank(id: bigint): DrawState {
  return {
    id,
    status: Status.None,
    cutoff: 0n,
    winningNumber: 0,
    winningTickets: 0,
    claimedTickets: 0,
    settledAt: 0n,
    closedAt: 0n,
  };
}

function logger() {
  const lines: string[] = [];
  const log: Logger = {
    info: (m) => lines.push(`INFO ${m}`),
    warn: (m) => lines.push(`WARN ${m}`),
    error: (m) => lines.push(`ERROR ${m}`),
  };
  return { log, lines };
}

const options: RunOptions = { close: true, claim: true, dryRun: false, startBlock: 0n };

function setup() {
  const chain = new FakeChain();
  chain.now = GENESIS + 10n * H;
  chain.openDraw(1n, GENESIS + 12n * H);
  return chain;
}

describe('runKeeper', () => {
  it('does nothing before the cutoff', async () => {
    const chain = setup();
    const { log, lines } = logger();
    const s = await runKeeper(chain, options, log);
    expect(chain.sent).toEqual([]);
    expect(s.failures).toEqual([]);
    expect(lines.join('\n')).toMatch(/draw #1 is open until its cutoff, 2h 0m from now/);
  });

  it('closes after the cutoff, exactly once over repeated runs', async () => {
    const chain = setup();
    chain.buy(ALICE, [42]);
    chain.now = GENESIS + 12n * H + 120n;
    const first = await runKeeper(chain, options, logger().log);
    expect(first.closed).toEqual([1n]);
    const second = await runKeeper(chain, options, logger().log);
    expect(second.closed).toEqual([]);
    expect(chain.sent).toEqual(['close 1']);
    expect(chain.currentId).toBe(2n);
  });

  it("treats another keeper's close as success, not failure", async () => {
    const chain = setup();
    chain.now = GENESIS + 13n * H;
    chain.failNextSend = () => {
      chain.draws.get(1n)!.status = Status.Closed;
    };
    const { log, lines } = logger();
    const s = await runKeeper(chain, options, log);
    expect(s.failures).toEqual([]);
    expect(lines.join('\n')).toMatch(/closed by someone else/);
  });

  it('reports a real failure', async () => {
    const chain = setup();
    chain.now = GENESIS + 13n * H;
    chain.failNextSend = () => {};
    const s = await runKeeper(chain, options, logger().log);
    expect(s.failures[0]).toMatch(/closing draw #1 failed: execution reverted/);
  });

  it('claims for unclaimed winners 24 hours after settlement, once each', async () => {
    const chain = setup();
    chain.buy(ALICE, [42, 7]);
    chain.buy(BOB, [42]);
    chain.buy(CAROL, [3]);
    chain.now = GENESIS + 12n * H;
    await runKeeper(chain, options, logger().log); // closes draw 1
    chain.now += 120n;
    chain.settle(1n, 42);
    // Bob claims himself.
    chain.claimed.add(`1:${BOB}`);
    chain.draws.get(1n)!.claimedTickets = 1;

    chain.now += 23n * H;
    expect((await runKeeper(chain, options, logger().log)).claimed).toEqual([]);

    chain.now += 1n * H;
    const s = await runKeeper(chain, options, logger().log);
    expect(s.claimed).toEqual([{ drawId: 1n, player: ALICE, tickets: 1n }]);
    expect((await runKeeper(chain, options, logger().log)).claimed).toEqual([]);
    // Draw 2's cutoff passed meanwhile, so it was closed too; one claim only.
    expect(chain.sent).toEqual(['close 1', 'close 2', `claim 1 ${ALICE}`]);
  });

  it('only scans the sales window of the draw, so it ignores other draws', async () => {
    const chain = setup();
    chain.now = GENESIS + 12n * H;
    await runKeeper(chain, options, logger().log); // close 1, open 2
    chain.settle(1n, 42); // nobody played
    chain.now += 2n * H;
    chain.buy(ALICE, [42]); // draw 2
    chain.now = GENESIS + 36n * H;
    await runKeeper(chain, options, logger().log); // close 2
    chain.settle(2n, 42);
    chain.now += 25n * H;
    const s = await runKeeper(chain, options, logger().log);
    expect(s.claimed).toEqual([{ drawId: 2n, player: ALICE, tickets: 1n }]);
  });

  it('dry run decides but sends nothing', async () => {
    const chain = setup();
    chain.now = GENESIS + 13n * H;
    const { log, lines } = logger();
    await runKeeper(chain, { ...options, dryRun: true }, log);
    expect(chain.sent).toEqual([]);
    expect(lines.join('\n')).toMatch(/would close draw #1/);
  });

  it('respects --only', async () => {
    const chain = setup();
    chain.now = GENESIS + 13n * H;
    await runKeeper(chain, { ...options, close: false }, logger().log);
    expect(chain.sent).toEqual([]);
  });

  it('warns about stuck randomness, a missing role and a low balance', async () => {
    const chain = setup();
    chain.now = GENESIS + 12n * H;
    await runKeeper(chain, options, logger().log); // closes 1; VRF never answers
    chain.now += 2n * H;
    chain.isKeeper = false;
    chain.balance = 10n ** 14n;
    const s = await runKeeper(chain, options, logger().log);
    expect(s.failures[0]).toMatch(/doesn't hold KEEPER_ROLE/);
    expect(s.warnings.join('\n')).toMatch(/balance is low/);
    expect(s.warnings.join('\n')).toMatch(/draw #1 has waited 2h 0m for its random number/);
  });
});
