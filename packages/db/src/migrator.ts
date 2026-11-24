import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { FileMigrationProvider, Migrator, type MigrationResult } from 'kysely/migration';

const migrationFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

function migrator<DB>(db: Kysely<DB>): Migrator {
  return new Migrator({ db, provider: new FileMigrationProvider({ fs, path, migrationFolder }) });
}

export interface MigrationOutcome {
  results: MigrationResult[];
  error: unknown;
}

/** Apply all pending migrations. Used by the CLI and by integration tests. */
export async function migrateToLatest<DB>(db: Kysely<DB>): Promise<MigrationOutcome> {
  const { error, results } = await migrator(db).migrateToLatest();
  return { error, results: results ?? [] };
}

export async function migrateDown<DB>(db: Kysely<DB>): Promise<MigrationOutcome> {
  const { error, results } = await migrator(db).migrateDown();
  return { error, results: results ?? [] };
}
