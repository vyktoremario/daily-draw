import { randomBytes } from 'node:crypto';
import { createDb, migrateToLatest, type Database } from '@daily-draw/db';
import { sql, type Kysely } from 'kysely';

export interface TestDatabase {
  db: Kysely<Database>;
  drop(): Promise<void>;
}

/**
 * Creates a fresh, fully migrated database next to the one in DATABASE_URL, so integration
 * tests never touch development data and can run in parallel. Call drop() in afterAll.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set; start Postgres with `pnpm services:up`');

  const name = `dd_test_${randomBytes(6).toString('hex')}`;
  const admin = createDb(url, 1);
  await sql.raw(`CREATE DATABASE ${name}`).execute(admin);

  const testUrl = new URL(url);
  testUrl.pathname = `/${name}`;
  const db = createDb(testUrl.toString(), 25);
  const { error } = await migrateToLatest(db);
  if (error) throw error;

  return {
    db,
    async drop() {
      await db.destroy();
      await sql.raw(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).execute(admin);
      await admin.destroy();
    },
  };
}

export const hasDatabase = Boolean(process.env.DATABASE_URL);
