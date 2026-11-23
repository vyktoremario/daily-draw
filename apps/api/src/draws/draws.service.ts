import { Inject, Injectable } from '@nestjs/common';
import type { Database, Draw } from '@daily-draw/db';
import { DEFAULT_RULES, formatNaira } from '@daily-draw/shared';
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

  rules() {
    return {
      ticketPriceKobo: DEFAULT_RULES.ticketPriceKobo.toString(),
      ticketPriceLabel: formatNaira(DEFAULT_RULES.ticketPriceKobo),
      numberRange: DEFAULT_RULES.numberRange,
      operatorCutBps: DEFAULT_RULES.operatorCutBps,
      maxTicketsPerPlayerPerDay: DEFAULT_RULES.maxTicketsPerPlayerPerDay,
      cutoffTime: DEFAULT_RULES.cutoffTime,
      drawTime: DEFAULT_RULES.drawTime,
      timeZone: DEFAULT_RULES.timeZone,
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
