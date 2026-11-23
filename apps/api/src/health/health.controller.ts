import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '@daily-draw/db';
import { sql, type Kysely } from 'kysely';
import { DB } from '../db/db.module.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  @Get()
  async check(): Promise<{ status: 'ok'; db: 'ok' }> {
    try {
      await sql`select 1`.execute(this.db);
    } catch {
      throw new ServiceUnavailableException({ status: 'error', db: 'unreachable' });
    }
    return { status: 'ok', db: 'ok' };
  }
}
