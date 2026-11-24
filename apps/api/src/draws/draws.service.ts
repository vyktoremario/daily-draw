import { Inject, Injectable } from '@nestjs/common';
import type { Database, Draw } from '@daily-draw/db';
import { NAIRA_RULES, formatAmount } from '@daily-draw/shared';
import type { Kysely } from 'kysely';
import { DB } from '../db/db.module.js';

/** API amounts are integers in kobo sent as strings (JSON has no bigint). */
export interface CurrentDrawDto {
  id: string;
  drawNumber: number;
  status: Draw['status'];
  numberRange: number;
  ticketPriceKobo: string;
  cutoffAt: string;
  drawAt: string;
  commitment: string | null;
  drandRound: string | null;
}

@Injectable()
export class DrawsService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  /** The naira game's rules (this API serves the naira product, R3). */
  rules() {
    const r = NAIRA_RULES;
    return {
      currency: r.currency,
      ticketPrice: r.ticketPrice.toString(),
      ticketPriceLabel: formatAmount(r.ticketPrice, r),
      ticketFeeBps: r.ticketFeeBps,
      bundleSizes: r.bundleSizes,
      numberRange: r.numberRange,
      split: r.split,
      maxTicketsPerPlayerPerDay: r.maxTicketsPerPlayerPerDay,
      cutoffTime: r.cutoffTime,
      drawTime: r.drawTime,
      timeZone: r.timeZone,
    };
  }

  async current(): Promise<CurrentDrawDto | null> {
    const draw = await this.db
      .selectFrom('draws')
      .selectAll()
      .where('status', 'in', ['open', 'closed', 'drawn'])
      .orderBy('draw_number', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!draw) return null;
    return {
      id: draw.id,
      drawNumber: draw.draw_number,
      status: draw.status,
      numberRange: draw.number_range,
      ticketPriceKobo: draw.ticket_price_kobo.toString(),
      cutoffAt: new Date(draw.cutoff_at).toISOString(),
      drawAt: new Date(draw.draw_at).toISOString(),
      commitment: draw.commitment,
      drandRound: draw.drand_round?.toString() ?? null,
    };
  }
}
