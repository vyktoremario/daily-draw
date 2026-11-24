import { usdc } from './money.js';
import { DEFAULT_SPLIT } from './rules.js';
import { settleDraw, type SettlementInput } from './settlement.js';

/**
 * Settlement test vectors shared with the Solidity tests (packages/contracts), so the contract
 * and this reference implementation must agree to the unit. Amounts are decimal strings in base
 * units (USDC has 6 decimals). Regenerate with `pnpm --filter @daily-draw/shared vectors`;
 * a test fails if the committed file is out of date.
 */
export interface SettlementVector {
  name: string;
  input: {
    sales: string;
    rolloverIn: string;
    winningTickets: number;
    winningTicketsWithActiveReferrer: number;
  };
  expected: {
    pool: string;
    prizePerTicket: string;
    referralSharePerTicket: string;
    prizesTotal: string;
    referralsPaid: string;
    team: string;
    buyback: string;
    rolloverOut: string;
  };
}

const CASES: Array<[string, Omit<SettlementInput, 'split'>]> = [
  [
    'worked example: $1,000 pool, 10 winners, 7 referred',
    { sales: usdc(1_000), rolloverIn: 0n, winningTickets: 10, winningTicketsWithActiveReferrer: 7 },
  ],
  [
    'no winner rolls everything over',
    {
      sales: usdc(1_000),
      rolloverIn: usdc(250),
      winningTickets: 0,
      winningTicketsWithActiveReferrer: 0,
    },
  ],
  [
    'single winner, referred',
    { sales: usdc(37), rolloverIn: 0n, winningTickets: 1, winningTicketsWithActiveReferrer: 1 },
  ],
  [
    'single winner, no referrer',
    { sales: usdc(37), rolloverIn: 0n, winningTickets: 1, winningTicketsWithActiveReferrer: 0 },
  ],
  [
    'rollover brought in, nobody referred',
    {
      sales: usdc(1_000),
      rolloverIn: usdc(1_000),
      winningTickets: 4,
      winningTicketsWithActiveReferrer: 0,
    },
  ],
  [
    'awkward amounts leave rounding dust',
    { sales: 1_000_003n, rolloverIn: 7n, winningTickets: 7, winningTicketsWithActiveReferrer: 3 },
  ],
  [
    'every ticket on the winning number',
    { sales: usdc(20), rolloverIn: 0n, winningTickets: 20, winningTicketsWithActiveReferrer: 13 },
  ],
  [
    'tiny pool smaller than the winners',
    { sales: 9n, rolloverIn: 0n, winningTickets: 10, winningTicketsWithActiveReferrer: 5 },
  ],
  [
    'large pool after rollovers',
    {
      sales: usdc(48_211),
      rolloverIn: 912_345_678_901n,
      winningTickets: 133,
      winningTicketsWithActiveReferrer: 98,
    },
  ],
];

export function settlementVectors(): { split: typeof DEFAULT_SPLIT; cases: SettlementVector[] } {
  return {
    split: DEFAULT_SPLIT,
    cases: CASES.map(([name, input]) => {
      const s = settleDraw({ ...input, split: DEFAULT_SPLIT });
      return {
        name,
        input: {
          sales: input.sales.toString(),
          rolloverIn: input.rolloverIn.toString(),
          winningTickets: input.winningTickets,
          winningTicketsWithActiveReferrer: input.winningTicketsWithActiveReferrer,
        },
        expected: {
          pool: s.pool.toString(),
          prizePerTicket: s.prizePerTicket.toString(),
          referralSharePerTicket: s.referralSharePerTicket.toString(),
          prizesTotal: s.prizesTotal.toString(),
          referralsPaid: s.referralsPaid.toString(),
          team: s.team.toString(),
          buyback: s.buyback.toString(),
          rolloverOut: s.rolloverOut.toString(),
        },
      };
    }),
  };
}
