import { applyBps, type Kobo } from './money.js';

export interface SettlementInput {
  /** Total ticket sales for the draw. */
  salesKobo: Kobo;
  /** Pool carried in from earlier unwon draws. */
  rolloverInKobo: Kobo;
  operatorCutBps: number;
  /** Tax withheld as the license requires; computed elsewhere. */
  taxKobo: Kobo;
  /** Number of tickets on the winning number. */
  winningTickets: number;
}

export interface Settlement {
  operatorCutKobo: Kobo;
  taxKobo: Kobo;
  /** Money shared among winners (or rolled over if none). */
  poolKobo: Kobo;
  prizePerTicketKobo: Kobo;
  /** Carried to the next draw: the whole pool if nobody won, else the leftover kobo. */
  rolloverOutKobo: Kobo;
}

/**
 * Pooled-prize settlement (design: "Settling a draw").
 * The operator cut comes from sales only, never from rollover, so the operator never
 * takes a second cut of money already cut once. Leftover kobo from rounding roll over,
 * so every kobo is accounted for:
 *   sales + rolloverIn = operatorCut + tax + prizePerTicket × winners + rolloverOut
 */
export function settleDraw(input: SettlementInput): Settlement {
  const { salesKobo, rolloverInKobo, operatorCutBps, taxKobo, winningTickets } = input;
  if (salesKobo < 0n || rolloverInKobo < 0n || taxKobo < 0n) {
    throw new Error('Amounts must not be negative');
  }
  if (!Number.isInteger(winningTickets) || winningTickets < 0) {
    throw new Error(`winningTickets must be a non-negative integer, got ${winningTickets}`);
  }

  const operatorCutKobo = applyBps(salesKobo, operatorCutBps);
  const poolKobo = salesKobo - operatorCutKobo - taxKobo + rolloverInKobo;
  if (poolKobo < 0n) {
    throw new Error('Tax and operator cut exceed sales plus rollover');
  }

  if (winningTickets === 0) {
    return {
      operatorCutKobo,
      taxKobo,
      poolKobo,
      prizePerTicketKobo: 0n,
      rolloverOutKobo: poolKobo,
    };
  }

  const winners = BigInt(winningTickets);
  const prizePerTicketKobo = poolKobo / winners;
  const rolloverOutKobo = poolKobo - prizePerTicketKobo * winners;
  return { operatorCutKobo, taxKobo, poolKobo, prizePerTicketKobo, rolloverOutKobo };
}
