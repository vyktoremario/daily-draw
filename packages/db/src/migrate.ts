import { createDb } from './client.js';
import { migrateDown, migrateToLatest } from './migrator.js';

const direction = process.argv[2] ?? 'latest';
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

const db = createDb(url, 1);
const { error, results } = direction === 'down' ? await migrateDown(db) : await migrateToLatest(db);

for (const r of results) {
  console.log(`${r.status === 'Success' ? 'ok  ' : 'FAIL'} ${r.direction} ${r.migrationName}`);
}
await db.destroy();
if (error) {
  console.error(error);
  process.exit(1);
}
