import { DEFAULT_SPLIT, usdc } from '@daily-draw/shared';
import { describe, expect, it } from 'vitest';
import type { Address } from 'viem';
import { LIVE_FULFILMENT } from './verify.fixture';
import {
  keyHashOf,
  proofsFromInput,
  randomWordOf,
  requestIdOf,
  rolloverBefore,
  tallyTickets,
  verifyDraw,
  vrfOutput,
  walletTickets,
  winningNumberOf,
  type DrawFacts,
  type PurchaseEvent,
} from './verify';

const ALICE: Address = '0x00000000000000000000000000000000000A11cE';
const BOB: Address = '0x0000000000000000000000000000000000000B0b';
const PROVIDER: Address = '0x5d73306B320DF9784d8B2c40Af9E744c974a16Ef';
const $1 = usdc(1);

function buy(player: Address, numbers: number[], feeBps = 200): PurchaseEvent {
  const price = $1 * BigInt(numbers.length);
  return { player, numbers, price, fee: (price * BigInt(feeBps)) / 10_000n };
}

/** Find a random word whose winning number is `target` (keccak outputs, so any target works). */
function outputFor(target: number): bigint {
  for (let i = 1n; ; i++) {
    if (winningNumberOf(randomWordOf(i), 100) === target) return i;
  }
}

/** Facts for a draw whose contract records match a correct settlement. */
function facts(
  purchases: PurchaseEvent[],
  winning: number,
  rolloverIn: bigint,
  recorded: Partial<DrawFacts['recorded']> = {},
): DrawFacts {
  const output = outputFor(winning);
  const word = randomWordOf(output);
  // A provider without VRF (as on Anvil): the proof links are tested with the live fixture.
  const tally = tallyTickets(purchases, $1, 200);
  const w = BigInt(tally.perNumber.get(winning) ?? 0);
  const pool = tally.sales + rolloverIn;
  const prize = w ? (pool * 6500n) / 10_000n / w : 0n;
  const share = w ? (pool * 2000n) / 10_000n / w : 0n;
  const team = w ? (pool * 1000n) / 10_000n : 0n;
  const buyback = w ? (pool * 500n) / 10_000n : 0n;
  return {
    numberRange: 100,
    ticketPrice: $1,
    feeBps: 200,
    split: DEFAULT_SPLIT,
    rolloverIn,
    purchases,
    vrf: {
      requestId: 1n,
      delivered: word,
      provider: PROVIDER,
      proofs: [],
    },
    recorded: {
      winningNumber: winning,
      winningTickets: Number(w),
      ticketCount: tally.tickets,
      sales: tally.sales,
      fees: tally.fees,
      pool,
      prizePerTicket: prize,
      referralSharePerTicket: share,
      team,
      buyback,
      rolloverOut: pool - (prize + share) * w - team - buyback,
      ...recorded,
    },
  };
}

const failed = (f: DrawFacts) =>
  verifyDraw(f)
    .checks.filter((c) => !c.pass)
    .map((c) => c.id);

describe('Chainlink VRF proof links (live Base Sepolia fulfilment)', () => {
  const proofs = proofsFromInput(LIVE_FULFILMENT.input);
  const keyHash = keyHashOf([1n, 2n]);
  const requestId = requestIdOf(keyHash, 77n);

  it('decodes the proof from a batched fulfilment', () => {
    expect(proofs).toHaveLength(1);
  });

  it('hashes the proving key to the gas lane the game uses', () => {
    expect(keyHashOf(proofs[0]!.pk)).toBe(LIVE_FULFILMENT.keyHash);
  });

  it('recomputes the request id from the key hash and the proof seed', () => {
    expect(requestIdOf(LIVE_FULFILMENT.keyHash, proofs[0]!.seed)).toBe(LIVE_FULFILMENT.requestId);
  });

  it('recomputes the output the coordinator recorded', () => {
    expect(vrfOutput(proofs[0]!.gamma)).toBe(LIVE_FULFILMENT.outputSeed);
  });

  it('returns no proofs for calldata it does not know', () => {
    expect(proofsFromInput('0xdeadbeef')).toEqual([]);
  });

  it('passes every randomness check for a matching draw', () => {
    const proof = proofs[0]!;
    const result = verifyDraw({
      ...facts([buy(ALICE, [1])], 0, 0n),
      vrf: {
        requestId: LIVE_FULFILMENT.requestId,
        delivered: randomWordOf(LIVE_FULFILMENT.outputSeed),
        request: {
          requestId: LIVE_FULFILMENT.requestId,
          keyHash: LIVE_FULFILMENT.keyHash,
          preSeed: proof.seed,
          sender: PROVIDER,
        },
        fulfilled: { outputSeed: LIVE_FULFILMENT.outputSeed, success: true },
        provider: PROVIDER,
        proofs,
      },
      recorded: {
        ...facts([buy(ALICE, [1])], 0, 0n).recorded,
        winningNumber: winningNumberOf(randomWordOf(LIVE_FULFILMENT.outputSeed), 100),
      },
    });
    const randomness = result.checks.filter((c) => c.group === 'randomness');
    expect(randomness.map((c) => c.id)).toEqual([
      'request-id',
      'requester',
      'key-hash',
      'proof-request',
      'output',
      'word',
      'winning-number',
    ]);
    expect(randomness.every((c) => c.pass)).toBe(true);
    expect(result.proof).toBe(proof);
  });

  it('fails when the delivered word is not the proof output', () => {
    const proof = proofs[0]!;
    const f = facts([buy(ALICE, [1])], 0, 0n);
    const ids = failed({
      ...f,
      vrf: {
        ...f.vrf,
        requestId: LIVE_FULFILMENT.requestId,
        request: {
          requestId: LIVE_FULFILMENT.requestId,
          keyHash: LIVE_FULFILMENT.keyHash,
          preSeed: proof.seed,
          sender: PROVIDER,
        },
        fulfilled: { outputSeed: LIVE_FULFILMENT.outputSeed, success: true },
        proofs,
      },
    });
    expect(ids).toContain('word');
  });

  it('flags a fulfilment with no proof for the request', () => {
    const f = facts([buy(ALICE, [1])], 1, 0n);
    const request = { requestId, keyHash, preSeed: 77n, sender: PROVIDER };
    expect(
      failed({
        ...f,
        vrf: { ...f.vrf, requestId, request, proofs: proofsFromInput(LIVE_FULFILMENT.input) },
      }),
    ).toEqual(['proof-found']);
  });
});

describe('winning number', () => {
  it('is the random word mod the number range', () => {
    expect(winningNumberOf(12_345n, 100)).toBe(45);
    expect(winningNumberOf(2n ** 256n - 1n, 100)).toBe(35);
    expect(winningNumberOf(7n, 1000)).toBe(7);
  });

  it('fails when the recorded number is not the word mod range', () => {
    expect(failed(facts([buy(ALICE, [3])], 3, 0n, { winningNumber: 4 }))).toContain(
      'winning-number',
    );
  });
});

describe('tickets', () => {
  it('counts tickets, sales and fees per draw settings', () => {
    const t = tallyTickets([buy(ALICE, [7, 7, 8]), buy(BOB, [7], 200)], $1, 200);
    expect(t.tickets).toBe(4);
    expect(t.sales).toBe(4_000_000n);
    expect(t.fees).toBe(80_000n);
    expect(t.perNumber.get(7)).toBe(3);
    expect(t.mispriced).toBe(0);
  });

  it('uses the fee the draw opened with (draw #1 charged 10%)', () => {
    const t = tallyTickets([buy(ALICE, [1, 2], 1000)], $1, 1000);
    expect(t.fees).toBe(200_000n);
    expect(t.mispriced).toBe(0);
    expect(tallyTickets([buy(ALICE, [1, 2], 1000)], $1, 200).mispriced).toBe(1);
  });
});

describe('rollover brought in', () => {
  it('is the last settlement’s rollover plus sweeps since', () => {
    const events = [
      { kind: 'settled', drawId: 1n, rolloverOut: 100n },
      { kind: 'settled', drawId: 2n, rolloverOut: 3n },
      { kind: 'swept', drawId: 1n, amount: 50n },
      { kind: 'settled', drawId: 3n, rolloverOut: 0n },
    ] as const;
    expect(rolloverBefore(events, 1n)).toBe(0n);
    expect(rolloverBefore(events, 2n)).toBe(100n);
    expect(rolloverBefore(events, 3n)).toBe(53n);
  });
});

describe('payout split', () => {
  it('rolls the whole pool over when nobody wins', () => {
    const f = facts([buy(ALICE, [1, 2]), buy(BOB, [3])], 50, usdc(10));
    const result = verifyDraw(f);
    expect(result.ok).toBe(true);
    expect(f.recorded.rolloverOut).toBe(usdc(13));
    expect(result.steps.find((s) => s.label === 'No winning ticket')?.value).toBe('$13.00');
  });

  it('shares between several winning tickets, rounding into the rollover', () => {
    // 3 winning tickets of 7 on a $7 pool: 65% = $4.55 → $1.516666 each.
    const f = facts([buy(ALICE, [5, 5, 1, 2]), buy(BOB, [5, 3, 4])], 5, 0n);
    const result = verifyDraw(f);
    expect(result.ok).toBe(true);
    expect(f.recorded.prizePerTicket).toBe(1_516_666n);
    expect(f.recorded.referralSharePerTicket).toBe(466_666n);
    expect(f.recorded.team).toBe(700_000n);
    expect(f.recorded.buyback).toBe(350_000n);
    expect(f.recorded.rolloverOut).toBe(4n);
    expect(result.steps.find((s) => s.label === 'Winners 65%')?.value).toBe('$1.516666 each');
  });

  it('catches a recorded figure that does not match', () => {
    const f = facts([buy(ALICE, [5]), buy(BOB, [5])], 5, usdc(1));
    expect(failed({ ...f, recorded: { ...f.recorded, team: f.recorded.team + 1n } })).toEqual([
      'team',
      'adds-up',
    ]);
  });

  it('catches a pool that ignored the rollover', () => {
    const f = facts([buy(ALICE, [5])], 5, usdc(2));
    expect(failed({ ...f, rolloverIn: 0n })).toContain('pool');
  });

  it('catches a ticket missing from the count', () => {
    const f = facts([buy(ALICE, [5]), buy(BOB, [6])], 5, 0n);
    expect(failed({ ...f, purchases: f.purchases.slice(0, 1) })).toEqual(
      expect.arrayContaining(['ticket-count', 'sales', 'fees']),
    );
  });
});

describe('wallet tickets', () => {
  const purchases = [buy(ALICE, [5, 9]), buy(BOB, [5]), buy(ALICE, [5])];

  it('lists a wallet’s tickets and its winning ones', () => {
    const r = walletTickets(purchases, ALICE.toLowerCase() as Address, 5, 1_000_000n);
    expect(r.tickets).toBe(3);
    expect(r.numbers).toEqual([
      { number: 5, count: 2 },
      { number: 9, count: 1 },
    ]);
    expect(r.winningTickets).toBe(2);
    expect(r.prize).toBe(2_000_000n);
  });

  it('shows no win before the number is drawn', () => {
    expect(walletTickets(purchases, BOB, undefined, 0n).winningTickets).toBe(0);
  });
});
