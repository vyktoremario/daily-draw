/**
 * Scheduled jobs (design: "Draw and fairness protocol", "Settling a draw").
 * Times are WAT (Africa/Lagos). Handlers are stubs in the scaffold; each will move money
 * only through ledger transactions keyed by draw ID, so a retry can never pay twice.
 */
export interface JobDefinition {
  name: string;
  /** Cron in Africa/Lagos time, or null for jobs that are only triggered. */
  cron: string | null;
  description: string;
}

export const JOBS = {
  openDraw: {
    name: 'draw.open',
    cron: '5 21 * * *',
    description:
      "Create tomorrow's draw, generate and commit the secret seed, name the drand round",
  },
  cutoff: {
    name: 'draw.cutoff',
    cron: '45 20 * * *',
    description: 'Lock sales, build the ticket Merkle tree, anchor it on Base',
  },
  runDraw: {
    name: 'draw.run',
    cron: '0 21 * * *',
    description: 'Fetch the drand round, compute the winning number, reveal the seed',
  },
  settle: {
    name: 'draw.settle',
    cron: null,
    description: 'Split the pool, credit winners, roll over leftovers (triggered by draw.run)',
  },
  sendOutbox: {
    name: 'outbox.send',
    cron: '* * * * *',
    description: 'Send pending SMS and WhatsApp messages',
  },
} as const satisfies Record<string, JobDefinition>;

export type JobName = (typeof JOBS)[keyof typeof JOBS]['name'];
