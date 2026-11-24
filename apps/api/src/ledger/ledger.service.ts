import { Injectable } from '@nestjs/common';
import type { Database, LedgerTxKind } from '@daily-draw/db';
import { sql, type Kysely, type Transaction } from 'kysely';
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  InvalidLedgerEntryError,
  UnbalancedTransactionError,
} from './ledger.errors.js';

type Executor = Kysely<Database> | Transaction<Database>;

export interface LedgerEntryInput {
  accountId: string;
  /** Positive = credit to the account, negative = debit. Never zero. */
  amountKobo: bigint;
}

export interface PostInput {
  kind: LedgerTxKind;
  /** Unique per real-world event, e.g. `deposit:paystack:<reference>` or `settle:<drawId>`. */
  idempotencyKey: string;
  drawId?: string;
  metadata?: Record<string, unknown>;
  entries: LedgerEntryInput[];
}

export interface PostResult {
  transactionId: string;
  /** True when this idempotency key had already been posted; nothing new was written. */
  replayed: boolean;
}

/**
 * The single way money moves (design: "Data model and ledger", requirement N-14).
 * The database enforces the same rules again (zero-sum at commit, no negative player
 * balances, append-only rows), so a bug here fails loudly instead of losing money.
 */
@Injectable()
export class LedgerService {
  /**
   * Post a transaction inside the caller's database transaction, so the money movement
   * commits or rolls back together with the caller's other writes (tickets, draw status…).
   */
  async post(trx: Transaction<Database>, input: PostInput): Promise<PostResult> {
    const entries = normaliseEntries(input.entries);

    const inserted = await trx
      .insertInto('ledger_transactions')
      .values({
        kind: input.kind,
        idempotency_key: input.idempotencyKey,
        draw_id: input.drawId ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
      })
      .onConflict((oc) => oc.column('idempotency_key').doNothing())
      .returning('id')
      .executeTakeFirst();

    if (!inserted) return this.replay(trx, input, entries);

    try {
      await trx
        .insertInto('ledger_entries')
        .values(
          entries.map((e) => ({
            transaction_id: inserted.id,
            account_id: e.accountId,
            amount_kobo: e.amountKobo,
          })),
        )
        .execute();
    } catch (err) {
      if (isConstraintViolation(err, 'accounts_balance_kobo_check'))
        throw new InsufficientFundsError();
      throw err;
    }
    return { transactionId: inserted.id, replayed: false };
  }

  /** Post in a transaction of its own. */
  postNow(db: Kysely<Database>, input: PostInput): Promise<PostResult> {
    return db.transaction().execute((trx) => this.post(trx, input));
  }

  /** Player accounts use the cached balance; system accounts are summed from entries. */
  async balance(db: Executor, accountId: string): Promise<bigint> {
    const account = await db
      .selectFrom('accounts')
      .select('balance_kobo')
      .where('id', '=', accountId)
      .executeTakeFirstOrThrow(() => new Error(`Unknown account ${accountId}`));
    if (account.balance_kobo !== null) return BigInt(account.balance_kobo);

    const row = await db
      .selectFrom('ledger_entries')
      .select(sql<bigint>`coalesce(sum(amount_kobo), 0)::bigint`.as('total'))
      .where('account_id', '=', accountId)
      .executeTakeFirstOrThrow();
    return BigInt(row.total);
  }

  /** The key was used before: same transaction → return it; different → refuse. */
  private async replay(
    trx: Transaction<Database>,
    input: PostInput,
    entries: LedgerEntryInput[],
  ): Promise<PostResult> {
    const existing = await trx
      .selectFrom('ledger_transactions')
      .select(['id', 'kind'])
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirstOrThrow();
    const stored = await trx
      .selectFrom('ledger_entries')
      .select(['account_id', 'amount_kobo'])
      .where('transaction_id', '=', existing.id)
      .execute();

    const same =
      existing.kind === input.kind &&
      fingerprint(
        stored.map((s) => ({ accountId: s.account_id, amountKobo: BigInt(s.amount_kobo) })),
      ) === fingerprint(entries);
    if (!same) throw new IdempotencyConflictError(input.idempotencyKey);
    return { transactionId: existing.id, replayed: true };
  }
}

function normaliseEntries(entries: LedgerEntryInput[]): LedgerEntryInput[] {
  if (entries.length < 2)
    throw new InvalidLedgerEntryError('A transaction needs at least two entries');
  const seen = new Set<string>();
  let sum = 0n;
  for (const e of entries) {
    if (typeof e.amountKobo !== 'bigint')
      throw new InvalidLedgerEntryError('Amounts must be bigint kobo');
    if (e.amountKobo === 0n) throw new InvalidLedgerEntryError('Entry amounts must not be zero');
    if (seen.has(e.accountId)) {
      throw new InvalidLedgerEntryError(
        `Account ${e.accountId} appears twice; combine the entries`,
      );
    }
    seen.add(e.accountId);
    sum += e.amountKobo;
  }
  if (sum !== 0n) throw new UnbalancedTransactionError(sum);
  return entries;
}

function fingerprint(entries: LedgerEntryInput[]): string {
  return entries
    .map((e) => `${e.accountId}:${e.amountKobo}`)
    .sort()
    .join('|');
}

function isConstraintViolation(err: unknown, constraint: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === '23514' &&
    (err as { constraint?: string }).constraint === constraint
  );
}
