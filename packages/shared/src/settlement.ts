import { applyBps } from './money.js';
import { assertValidSplit, type PoolSplit } from './rules.js';

/**
 * Settlement of one draw (Requirements v0.2, Game rules; Design v0.2, Settling a draw).
 *
 * Works in integer base units of any currency: USDC (6 decimals) on-chain, kobo for naira.
 * It is the reference the smart contract and the naira worker must match exactly; shared test
 * vectors in test-vectors/settlement.json pin the results.
 *
 * Rules:
 * - Pool = ticket sales (fees excluded; fees go to the company at purchase) + rollover brought in.
 * - No winning ticket: the whole pool rolls over and nothing else is taken.
 * - Otherwise: winners share 65% equally per winning ticket; the company takes 15% (10% team,
 *   5% token buy-back); 20% is a referral share per winning ticket. A ticket's referral share goes
 *   to its owner's referrer if that referrer is active, otherwise to the team (company revenue).
 * - Every rounding leftover rolls over, so nothing is lost:
 *     pool = prizesTotal + referralsPaid + team + buyback + rolloverOut
 *
 * Not covered here: the last-digit rule after the rollover limit, and tax (naira only; taken from
 * the team and referral amounts by the ledger, never from winners).
 */
export interface SettlementInput {
  /** Ticket sales for the draw, fees excluded. */
  sales: bigint;
  /** Pool carried in from earlier unwon draws and swept prizes. */
  rolloverIn: bigint;
  split: PoolSplit;
  /** Tickets on the winning number. */
  winningTickets: number;
  /** Of those, tickets whose owner has an active referrer. */
  winningTicketsWithActiveReferrer: number;
}

export interface Settlement {
  pool: bigint;
  won: boolean;
  prizePerTicket: bigint;
  /** Referral share attached to each winning ticket. */
  referralSharePerTicket: bigint;
  prizesTotal: bigint;
  /** Referral shares going to active referrers. */
  referralsPaid: bigint;
  /** Team share plus the referral shares of tickets without an active referrer. */
  team: bigint;
  /** Reserved to buy back and burn the project's token. */
  buyback: bigint;
  /** Carried to the next draw: the whole pool if nobody won, otherwise rounding leftovers. */
  rolloverOut: bigint;
}

export function settleDraw(input: SettlementInput): Settlement {
  const { sales, rolloverIn, split, winningTickets, winningTicketsWithActiveReferrer } = input;
  assertValidSplit(split);
  if (sales < 0n || rolloverIn < 0n) throw new Error('Amounts must not be negative');
  if (!Number.isInteger(winningTickets) || winningTickets < 0) {
    throw new Error(`winningTickets must be a non-negative integer, got ${winningTickets}`);
  }
  if (
    !Number.isInteger(winningTicketsWithActiveReferrer) ||
    winningTicketsWithActiveReferrer < 0 ||
    winningTicketsWithActiveReferrer > winningTickets
  ) {
    throw new Error(
      `winningTicketsWithActiveReferrer must be between 0 and ${winningTickets}, got ${winningTicketsWithActiveReferrer}`,
    );
  }

  const pool = sales + rolloverIn;
  if (winningTickets === 0) {
    return {
      pool,
      won: false,
      prizePerTicket: 0n,
      referralSharePerTicket: 0n,
      prizesTotal: 0n,
      referralsPaid: 0n,
      team: 0n,
      buyback: 0n,
      rolloverOut: pool,
    };
  }

  const w = BigInt(winningTickets);
  const referred = BigInt(winningTicketsWithActiveReferrer);

  const prizePerTicket = applyBps(pool, split.winnersBps) / w;
  const referralSharePerTicket = applyBps(pool, split.referrersBps) / w;
  const prizesTotal = prizePerTicket * w;
  const referralsPaid = referralSharePerTicket * referred;
  const unreferred = referralSharePerTicket * (w - referred);
  const team = applyBps(pool, split.teamBps) + unreferred;
  const buyback = applyBps(pool, split.buybackBps);
  const rolloverOut = pool - prizesTotal - referralsPaid - team - buyback;

  return {
    pool,
    won: true,
    prizePerTicket,
    referralSharePerTicket,
    prizesTotal,
    referralsPaid,
    team,
    buyback,
    rolloverOut,
  };
}
