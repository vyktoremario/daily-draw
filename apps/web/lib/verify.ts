import { applyBps, formatUsdc, settleDraw, type PoolSplit } from '@daily-draw/shared';
import {
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from 'viem';

/**
 * "Verify this draw" maths (#13). Pure functions over public chain data, so the page can redo
 * in the player's browser what the contracts did on-chain:
 *
 * 1. Randomness. DailyDraw asks its Chainlink VRF v2.5 adapter for one random word when a draw
 *    closes. The coordinator checks the oracle's proof on-chain and passes the word on. Here we
 *    check the links around that proof: the proving key is the one the request named, the proof
 *    answers this request, and the delivered word is the proof's output.
 * 2. Winning number = word mod numberRange, as in `DailyDraw.fulfillRandomness`.
 * 3. Tickets and payout: recount the draw's tickets from `TicketsBought` events, rebuild the pool
 *    (sales + rollover brought in) and redo the 65/20/10/5 split with `settleDraw` from
 *    packages/shared, then compare with what `DrawSettled` recorded.
 */

/** Chainlink VRF v2.5 coordinator events and fulfilment calls (direct and batched). */
export const vrfCoordinatorAbi = parseAbi([
  'event RandomWordsRequested(bytes32 indexed keyHash, uint256 requestId, uint256 preSeed, uint256 indexed subId, uint16 minimumRequestConfirmations, uint32 callbackGasLimit, uint32 numWords, bytes extraArgs, address indexed sender)',
  'event RandomWordsFulfilled(uint256 indexed requestId, uint256 outputSeed, uint256 indexed subId, uint96 payment, bool nativePayment, bool success, bool onlyPremium)',
  'struct Proof { uint256[2] pk; uint256[2] gamma; uint256 c; uint256 s; uint256 seed; address uWitness; uint256[2] cGammaWitness; uint256[2] sHashWitness; uint256 zInv; }',
  'struct RequestCommitment { uint64 blockNum; uint256 subId; uint32 callbackGasLimit; uint32 numWords; address sender; bytes extraArgs; }',
  'function fulfillRandomWords(Proof proof, RequestCommitment rc, bool onlyPremium) returns (uint96)',
  'function fulfillRandomWords(Proof[] proofs, RequestCommitment[] rcs)',
]);

/** Events of `ChainlinkVrfProvider` (and `DevRandomness` on Anvil). */
export const randomnessProviderAbi = parseAbi([
  'event RandomnessRequested(uint256 indexed requestId)',
  'event RandomnessFulfilled(uint256 indexed requestId, uint256 value)',
]);

/** `VRF.sol`: output = keccak256(abi.encode(3, gamma)). */
const VRF_RANDOM_OUTPUT_HASH_PREFIX = 3n;
const BPS = 10_000n;

// -------------------------------------------------------------------------------------------------
// Randomness
// -------------------------------------------------------------------------------------------------

export interface VrfProof {
  pk: readonly [bigint, bigint];
  gamma: readonly [bigint, bigint];
  seed: bigint;
}

/** The VRF proofs in a fulfilment transaction (a direct coordinator call or the batch helper). */
export function proofsFromInput(input: Hex): VrfProof[] {
  try {
    const { args } = decodeFunctionData({ abi: vrfCoordinatorAbi, data: input });
    const proofs = args.length === 3 ? [args[0]] : args[0];
    return proofs.map((p) => ({ pk: p.pk, gamma: p.gamma, seed: p.seed }));
  } catch {
    return [];
  }
}

/** The gas lane id: keccak256(abi.encode(publicKey)). */
export function keyHashOf(pk: readonly [bigint, bigint]): Hash {
  return keccak256(encodeAbiParameters([{ type: 'uint256[2]' }], [pk]));
}

/** Coordinator request id: keccak256(abi.encode(keyHash, preSeed)). */
export function requestIdOf(keyHash: Hash, preSeed: bigint): bigint {
  return BigInt(
    keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [keyHash, preSeed])),
  );
}

/** The proof's random output: keccak256(abi.encode(3, gamma)). */
export function vrfOutput(gamma: readonly [bigint, bigint]): bigint {
  return BigInt(
    keccak256(
      encodeAbiParameters(
        [{ type: 'uint256' }, { type: 'uint256[2]' }],
        [VRF_RANDOM_OUTPUT_HASH_PREFIX, gamma],
      ),
    ),
  );
}

/** Random word `index` of a request: keccak256(abi.encode(output, index)). */
export function randomWordOf(output: bigint, index = 0n): bigint {
  return BigInt(
    keccak256(encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [output, index])),
  );
}

/** `DailyDraw.fulfillRandomness`: uint16(value % numberRange). */
export function winningNumberOf(word: bigint, numberRange: number): number {
  return Number(word % BigInt(numberRange));
}

// -------------------------------------------------------------------------------------------------
// Tickets and rollover
// -------------------------------------------------------------------------------------------------

/** One `TicketsBought` event. */
export interface PurchaseEvent {
  player: Address;
  numbers: readonly number[];
  price: bigint;
  fee: bigint;
  txHash?: Hash;
}

export interface TicketTally {
  tickets: number;
  sales: bigint;
  fees: bigint;
  /** Tickets per number. */
  perNumber: Map<number, number>;
  /** Purchases whose price or fee isn't what the draw's settings say. */
  mispriced: number;
}

export function tallyTickets(
  purchases: readonly PurchaseEvent[],
  ticketPrice: bigint,
  feeBps: number,
): TicketTally {
  const perNumber = new Map<number, number>();
  let tickets = 0;
  let sales = 0n;
  let fees = 0n;
  let mispriced = 0;
  for (const p of purchases) {
    tickets += p.numbers.length;
    sales += p.price;
    fees += p.fee;
    const price = ticketPrice * BigInt(p.numbers.length);
    if (p.price !== price || p.fee !== (price * BigInt(feeBps)) / BPS) mispriced++;
    for (const n of p.numbers) perNumber.set(n, (perNumber.get(n) ?? 0) + 1);
  }
  return { tickets, sales, fees, perNumber, mispriced };
}

/** Events that move the contract-level rollover, in chain order. */
export type RolloverEvent =
  | { kind: 'settled'; drawId: bigint; rolloverOut: bigint }
  | { kind: 'swept'; drawId: bigint; amount: bigint };

/**
 * The rollover a draw brought in: replay every settlement (sets it) and sweep (adds to it) that
 * happened before the draw's own settlement. `events` must be in chain order.
 */
export function rolloverBefore(events: readonly RolloverEvent[], drawId: bigint): bigint {
  let rollover = 0n;
  for (const e of events) {
    if (e.kind === 'settled') {
      if (e.drawId === drawId) return rollover;
      rollover = e.rolloverOut;
    } else {
      rollover += e.amount;
    }
  }
  return rollover;
}

// -------------------------------------------------------------------------------------------------
// The whole draw
// -------------------------------------------------------------------------------------------------

/** What `DrawSettled` (and `getDraw`) recorded. */
export interface RecordedSettlement {
  winningNumber: number;
  winningTickets: number;
  ticketCount: number;
  sales: bigint;
  fees: bigint;
  pool: bigint;
  prizePerTicket: bigint;
  referralSharePerTicket: bigint;
  team: bigint;
  buyback: bigint;
  rolloverOut: bigint;
}

export interface VrfEvidence {
  /** `getDraw(drawId).requestId` */
  requestId: bigint;
  /** The word the provider handed DailyDraw (`RandomnessFulfilled.value`). */
  delivered: bigint;
  /** Coordinator `RandomWordsRequested`; absent for a provider without VRF (Anvil). */
  request?: { requestId: bigint; keyHash: Hash; preSeed: bigint; sender: Address };
  /** Coordinator `RandomWordsFulfilled`. */
  fulfilled?: { outputSeed: bigint; success: boolean };
  /** The provider that requested for the game (`RandomnessFulfilled` emitter). */
  provider?: Address;
  /** Proofs found in the fulfilment transaction. */
  proofs: readonly VrfProof[];
}

export interface DrawFacts {
  numberRange: number;
  ticketPrice: bigint;
  feeBps: number;
  split: PoolSplit;
  recorded: RecordedSettlement;
  vrf: VrfEvidence;
  purchases: readonly PurchaseEvent[];
  rolloverIn: bigint;
}

export type CheckGroup = 'randomness' | 'tickets' | 'payout';

export interface Check {
  id: string;
  group: CheckGroup;
  label: string;
  pass: boolean;
  /** What we worked out. */
  expected: string;
  /** What the chain recorded. */
  actual: string;
}

/** One line of "See the full maths". */
export interface MathStep {
  label: string;
  formula: string;
  value: string;
}

export interface Verification {
  ok: boolean;
  checks: Check[];
  steps: MathStep[];
  winningNumber: number;
  /** The proof that answers this draw's request, if one was found. */
  proof?: VrfProof;
}

const usd = formatUsdc;

function check(
  group: CheckGroup,
  id: string,
  label: string,
  expected: string | number | bigint,
  actual: string | number | bigint,
): Check {
  const e = String(expected);
  const a = String(actual);
  return { id, group, label, pass: e === a, expected: e, actual: a };
}

function pad(n: number, range: number): string {
  return String(n).padStart(String(range - 1).length, '0');
}

export function verifyDraw(f: DrawFacts): Verification {
  const checks: Check[] = [];
  const steps: MathStep[] = [];
  const { recorded: r, vrf } = f;

  // Randomness -----------------------------------------------------------------------------------
  let proof: VrfProof | undefined;
  if (vrf.request) {
    checks.push(
      check(
        'randomness',
        'request-id',
        'The VRF request is the one the draw stored',
        vrf.requestId,
        vrf.request.requestId,
      ),
    );
    if (vrf.provider) {
      checks.push(
        check(
          'randomness',
          'requester',
          "The request came from the game's randomness provider",
          vrf.provider.toLowerCase(),
          vrf.request.sender.toLowerCase(),
        ),
      );
    }
    proof = vrf.proofs.find(
      (p) =>
        requestIdOf(keyHashOf(p.pk), p.seed) === vrf.request!.requestId ||
        p.seed === vrf.request!.preSeed,
    );
    if (!proof) {
      checks.push({
        id: 'proof-found',
        group: 'randomness',
        label: 'The fulfilment carries a proof for this request',
        pass: false,
        expected: 'a proof',
        actual: 'none found',
      });
    } else {
      const keyHash = keyHashOf(proof.pk);
      checks.push(
        check(
          'randomness',
          'key-hash',
          'The proof was made with the key the request named',
          vrf.request.keyHash,
          keyHash,
        ),
        check(
          'randomness',
          'proof-request',
          'The proof answers this request',
          requestIdOf(keyHash, proof.seed),
          vrf.request.requestId,
        ),
      );
      const output = vrfOutput(proof.gamma);
      steps.push(
        {
          label: 'Proving key hash',
          formula: 'keccak256(abi.encode(publicKey))',
          value: keyHash,
        },
        {
          label: 'Request id',
          formula: 'keccak256(abi.encode(keyHash, seed))',
          value: requestIdOf(keyHash, proof.seed).toString(),
        },
        {
          label: 'VRF output',
          formula: 'keccak256(abi.encode(3, gamma))',
          value: output.toString(),
        },
      );
      if (vrf.fulfilled) {
        checks.push(
          check(
            'randomness',
            'output',
            'The coordinator recorded the proof’s output',
            output,
            vrf.fulfilled.outputSeed,
          ),
        );
      }
      const word = randomWordOf(output);
      steps.push({
        label: 'Random word',
        formula: 'keccak256(abi.encode(output, 0))',
        value: word.toString(),
      });
      checks.push(
        check(
          'randomness',
          'word',
          'The game received the proof’s random word',
          word,
          vrf.delivered,
        ),
      );
    }
  }

  const winningNumber = winningNumberOf(vrf.delivered, f.numberRange);
  steps.push({
    label: 'Winning number',
    formula: `random word mod ${f.numberRange}`,
    value: `${vrf.delivered} mod ${f.numberRange} = ${pad(winningNumber, f.numberRange)}`,
  });
  checks.push(
    check(
      'randomness',
      'winning-number',
      'Winning number = random word mod ' + f.numberRange,
      pad(winningNumber, f.numberRange),
      pad(r.winningNumber, f.numberRange),
    ),
  );

  // Tickets --------------------------------------------------------------------------------------
  const tally = tallyTickets(f.purchases, f.ticketPrice, f.feeBps);
  const onWinning = tally.perNumber.get(winningNumber) ?? 0;
  checks.push(
    check('tickets', 'ticket-count', 'Tickets sold', tally.tickets, r.ticketCount),
    check(
      'tickets',
      'sales',
      'Ticket sales (the pool before rollover)',
      usd(tally.sales),
      usd(r.sales),
    ),
    check('tickets', 'fees', 'Fees (kept out of the pool)', usd(tally.fees), usd(r.fees)),
    check(
      'tickets',
      'pricing',
      'Every purchase paid the draw’s price and fee',
      `${f.purchases.length} of ${f.purchases.length} purchases`,
      `${f.purchases.length - tally.mispriced} of ${f.purchases.length} purchases`,
    ),
    check(
      'tickets',
      'winning-tickets',
      `Tickets on ${pad(winningNumber, f.numberRange)}`,
      onWinning,
      r.winningTickets,
    ),
  );
  steps.push(
    {
      label: 'Tickets',
      formula: `numbers picked, counted from TicketsBought events`,
      value: String(tally.tickets),
    },
    {
      label: 'Sales',
      formula: `${tally.tickets} × ${usd(f.ticketPrice)}`,
      value: usd(tally.sales),
    },
    {
      label: 'Fees',
      formula: `sales × ${f.feeBps} / 10000`,
      value: usd(tally.fees),
    },
  );

  // Payout ---------------------------------------------------------------------------------------
  // The contract can't see referrers at settlement, so every winning ticket carries a referral
  // share; the claim later sends it to an active referrer or to the team.
  const s = settleDraw({
    sales: tally.sales,
    rolloverIn: f.rolloverIn,
    split: f.split,
    winningTickets: onWinning,
    winningTicketsWithActiveReferrer: onWinning,
  });
  const w = BigInt(onWinning);
  checks.push(
    check('payout', 'pool', 'Pool = sales + rollover brought in', usd(s.pool), usd(r.pool)),
    check(
      'payout',
      'prize',
      'Prize per winning ticket',
      usd(s.prizePerTicket),
      usd(r.prizePerTicket),
    ),
    check(
      'payout',
      'referral',
      'Referral share per winning ticket',
      usd(s.referralSharePerTicket),
      usd(r.referralSharePerTicket),
    ),
    check('payout', 'team', 'Team', usd(s.team), usd(r.team)),
    check('payout', 'buyback', 'Token buy-back', usd(s.buyback), usd(r.buyback)),
    check(
      'payout',
      'rollover',
      'Rolled over to the next draw',
      usd(s.rolloverOut),
      usd(r.rolloverOut),
    ),
    check(
      'payout',
      'adds-up',
      'Nothing lost: winners + referrers + team + buy-back + rollover = pool',
      usd(r.pool),
      usd(
        (r.prizePerTicket + r.referralSharePerTicket) * BigInt(r.winningTickets) +
          r.team +
          r.buyback +
          r.rolloverOut,
      ),
    ),
  );

  const pct = (bps: number) => `${bps / 100}%`;
  steps.push({
    label: 'Pool',
    formula: `sales ${usd(tally.sales)} + rollover in ${usd(f.rolloverIn)}`,
    value: usd(s.pool),
  });
  if (onWinning === 0) {
    steps.push({
      label: 'No winning ticket',
      formula: 'the whole pool rolls over',
      value: usd(s.rolloverOut),
    });
  } else {
    steps.push(
      {
        label: `Winners ${pct(f.split.winnersBps)}`,
        formula: `floor(pool × ${f.split.winnersBps} / 10000) = ${usd(applyBps(s.pool, f.split.winnersBps))}, ÷ ${onWinning} ticket${onWinning === 1 ? '' : 's'}`,
        value: `${usd(s.prizePerTicket)} each`,
      },
      {
        label: `Referrers ${pct(f.split.referrersBps)}`,
        formula: `floor(pool × ${f.split.referrersBps} / 10000) = ${usd(applyBps(s.pool, f.split.referrersBps))}, ÷ ${onWinning}`,
        value: `${usd(s.referralSharePerTicket)} each`,
      },
      {
        label: `Team ${pct(f.split.teamBps)}`,
        formula: `floor(pool × ${f.split.teamBps} / 10000)`,
        value: usd(s.team),
      },
      {
        label: `Buy-back ${pct(f.split.buybackBps)}`,
        formula: `floor(pool × ${f.split.buybackBps} / 10000)`,
        value: usd(s.buyback),
      },
      {
        label: 'Rounding left over',
        formula: `pool − (prize + referral share) × ${onWinning} − team − buy-back`,
        value: usd(s.pool - (s.prizePerTicket + s.referralSharePerTicket) * w - s.team - s.buyback),
      },
    );
  }

  return { ok: checks.every((c) => c.pass), checks, steps, winningNumber, proof };
}

// -------------------------------------------------------------------------------------------------
// One wallet's tickets
// -------------------------------------------------------------------------------------------------

export interface WalletResult {
  tickets: number;
  /** Tickets per number, in order of first purchase. */
  numbers: { number: number; count: number }[];
  winningTickets: number;
  /** Prize for the winning tickets (the referral share goes to the referrer or team). */
  prize: bigint;
  purchases: PurchaseEvent[];
}

export function walletTickets(
  purchases: readonly PurchaseEvent[],
  player: Address,
  winningNumber: number | undefined,
  prizePerTicket: bigint,
): WalletResult {
  const mine = purchases.filter((p) => p.player.toLowerCase() === player.toLowerCase());
  const counts = new Map<number, number>();
  for (const p of mine) for (const n of p.numbers) counts.set(n, (counts.get(n) ?? 0) + 1);
  const winningTickets = winningNumber === undefined ? 0 : (counts.get(winningNumber) ?? 0);
  return {
    tickets: [...counts.values()].reduce((a, b) => a + b, 0),
    numbers: [...counts].map(([number, count]) => ({ number, count })),
    winningTickets,
    prize: prizePerTicket * BigInt(winningTickets),
    purchases: mine,
  };
}
