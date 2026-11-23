import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { createDb } from './client.js';

const direction = process.argv[2] ?? 'latest';
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const db = createDb(url, 1);
const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations'),
  }),
});

const { error, results } =
  direction === 'down' ? await migrator.migrateDown() : await migrator.migrateToLatest();

for (const r of results ?? []) {
  console.log(`${r.status === 'Success' ? 'ok  ' : 'FAIL'} ${r.direction} ${r.migrationName}`);
}
await db.destroy();
if (error) {
  console.error(error);
  process.exit(1);
}
