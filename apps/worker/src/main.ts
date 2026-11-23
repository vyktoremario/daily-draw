import { PgBoss } from 'pg-boss';
import { JOBS } from './jobs.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set (see .env.example)');
  process.exit(1);
}

// pg-boss keeps its job tables in their own schema, in the same database as the ledger,
// so a job and the data it writes can commit together.
const boss = new PgBoss({ connectionString: url, schema: 'pgboss' });
boss.on('error', (err: unknown) => console.error('[pg-boss]', err));
await boss.start();

for (const job of Object.values(JOBS)) {
  await boss.createQueue(job.name);
  if (job.cron) await boss.schedule(job.name, job.cron, null, { tz: 'Africa/Lagos' });

  await boss.work(job.name, async (jobs) => {
    for (const j of jobs) {
      // TODO(R1): implement each job. See docs/ and the design doc for the steps.
      console.log(`[${job.name}] ${job.description} (job ${j.id}) — not implemented yet`);
    }
  });
}

console.log(`worker started with ${Object.keys(JOBS).length} queues`);

const shutdown = async () => {
  await boss.stop({ graceful: true });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
