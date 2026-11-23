import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Database } from './schema.js';

// Return Postgres bigint (int8) columns as JS bigint, never as lossy numbers or strings.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => BigInt(value));

export function createDb(connectionString: string, maxConnections = 10): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString, max: maxConnections }),
    }),
  });
}
