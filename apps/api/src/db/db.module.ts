import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDb, type Database } from '@daily-draw/db';
import type { Kysely } from 'kysely';

/** Injection token for the Kysely client. Inject with @Inject(DB). */
export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      useFactory: (): Kysely<Database> => {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error('DATABASE_URL is not set (see .env.example)');
        return createDb(url);
      },
    },
  ],
  exports: [DB],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
