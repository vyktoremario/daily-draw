import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@daily-draw/db';
import type { Kysely } from 'kysely';
import { createTestDatabase, hasDatabase, type TestDatabase } from '../../test/test-database.js';
import { AccountsService } from './accounts.service.js';
import {
  IdempotencyConflictError,
  InsufficientFundsError,
  InvalidLedgerEntryError,
  UnbalancedTransactionError,
} from './ledger.errors.js';
import { LedgerService } from './ledger.service.js';

describe.skipIf(!hasDatabase)('LedgerService (Postgres)', () => {
  let testDb: TestDatabase;
  let db: Kysely<Database>;
  let clearing: string;
  const ledger = new LedgerService();
  const accounts = new AccountsService();

  beforeAll(async () => {
    testDb = await createTestDatabase();
    db = testDb.db;
    clearing = await accounts.providerClearing(db, 'play_money');
  });

  afterAll(async () => {
    await testDb?.drop();
  });

  async function newPlayer() {
    const user = await db
      .insertInto('users')
      .values({ phone: `+234${Math.floor(Math.random() * 1e10)}` })
      .returning('id')
      .executeTakeFirstOrThrow();
    return accounts.ensurePlayerAccounts(db, user.id);
  }

  function deposit(walletId: string, amountKobo: bigint, key = `deposit:${randomUUID()}`) {
    return ledger.postNow(db, {
      kind: 'deposit',
      idempotencyKey: key,
      entries: [
        { accountId: clearing, amountKobo: -amountKobo },
        { accountId: walletId, amountKobo },
      ],
    });
  }

  function spend(walletId: string, amountKobo: bigint) {
    return ledger.postNow(db, {
      kind: 'adjustment',
      idempotencyKey: `spend:${randomUUID()}`,
      entries: [
        { accountId: walletId, amountKobo: -amountKobo },
        { accountId: clearing, amountKobo },
      ],
    });
  }

  it('credits a wallet and keeps system balances in step', async () => {
    const { walletId } = await newPlayer();
    const before = await ledger.balance(db, clearing);
    const result = await deposit(walletId, 100_000n);
    expect(result.replayed).toBe(false);
    expect(await ledger.balance(db, walletId)).toBe(100_000n);
    expect(await ledger.balance(db, clearing)).toBe(before - 100_000n);
  });

  it('returns the original transaction when a key is replayed', async () => {
    const { walletId } = await newPlayer();
    const first = await deposit(walletId, 50_000n, 'deposit:paystack:ref-1');
    const again = await deposit(walletId, 50_000n, 'deposit:paystack:ref-1');
    expect(again).toEqual({ transactionId: first.transactionId, replayed: true });
    expect(await ledger.balance(db, walletId)).toBe(50_000n);
  });

  it('refuses to reuse a key for a different transaction', async () => {
    const { walletId } = await newPlayer();
    await deposit(walletId, 50_000n, 'deposit:paystack:ref-2');
    await expect(deposit(walletId, 60_000n, 'deposit:paystack:ref-2')).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
    expect(await ledger.balance(db, walletId)).toBe(50_000n);
  });

  it('rejects unbalanced and malformed transactions before writing anything', async () => {
    const { walletId } = await newPlayer();
    const count = async () =>
      (
        await db
          .selectFrom('ledger_transactions')
          .select(db.fn.countAll<string>().as('n'))
          .executeTakeFirstOrThrow()
      ).n;
    const before = await count();

    await expect(
      ledger.postNow(db, {
        kind: 'deposit',
        idempotencyKey: `bad:${randomUUID()}`,
        entries: [
          { accountId: clearing, amountKobo: -100n },
          { accountId: walletId, amountKobo: 99n },
        ],
      }),
    ).rejects.toBeInstanceOf(UnbalancedTransactionError);

    for (const entries of [
      [
        { accountId: walletId, amountKobo: 0n },
        { accountId: clearing, amountKobo: 0n },
      ],
      [{ accountId: walletId, amountKobo: 100n }],
      [
        { accountId: walletId, amountKobo: 100n },
        { accountId: walletId, amountKobo: -100n },
      ],
    ]) {
      await expect(
        ledger.postNow(db, { kind: 'deposit', idempotencyKey: `bad:${randomUUID()}`, entries }),
      ).rejects.toBeInstanceOf(InvalidLedgerEntryError);
    }
    expect(await count()).toBe(before);
  });

  it('refuses overdrafts and writes nothing', async () => {
    const { walletId } = await newPlayer();
    await deposit(walletId, 10_000n);
    await expect(spend(walletId, 10_001n)).rejects.toBeInstanceOf(InsufficientFundsError);
    expect(await ledger.balance(db, walletId)).toBe(10_000n);
  });

  it('never overdraws under concurrent debits', async () => {
    const { walletId } = await newPlayer();
    await deposit(walletId, 1_000n);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => spend(walletId, 300n)),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failures = results
      .filter((r) => r.status === 'rejected')
      .map((r) => (r as PromiseRejectedResult).reason);

    expect(succeeded).toBe(3);
    expect(failures.every((e) => e instanceof InsufficientFundsError)).toBe(true);
    expect(await ledger.balance(db, walletId)).toBe(100n);
  });

  it('applies a concurrently repeated deposit exactly once', async () => {
    const { walletId } = await newPlayer();
    const key = `deposit:paystack:${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => deposit(walletId, 5_000n, key)),
    );

    expect(new Set(results.map((r) => r.transactionId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await ledger.balance(db, walletId)).toBe(5_000n);
  });

  it('rolls back the money movement with the rest of the caller transaction', async () => {
    const { walletId } = await newPlayer();
    await expect(
      db.transaction().execute(async (trx) => {
        await ledger.post(trx, {
          kind: 'deposit',
          idempotencyKey: `deposit:${randomUUID()}`,
          entries: [
            { accountId: clearing, amountKobo: -7_000n },
            { accountId: walletId, amountKobo: 7_000n },
          ],
        });
        throw new Error('ticket insert failed');
      }),
    ).rejects.toThrow('ticket insert failed');
    expect(await ledger.balance(db, walletId)).toBe(0n);
  });

  it('keeps the books balanced across everything above', async () => {
    const row = await db
      .selectFrom('ledger_entries')
      .select(db.fn.sum<string>('amount_kobo').as('total'))
      .executeTakeFirstOrThrow();
    expect(BigInt(row.total ?? 0)).toBe(0n);
  });
});

describe('AccountsService (Postgres)', () => {
  it.skipIf(!hasDatabase)('creates each account once, even when called concurrently', async () => {
    const testDb = await createTestDatabase();
    try {
      const accounts = new AccountsService();
      const user = await testDb.db
        .insertInto('users')
        .values({ phone: '+2348000000009' })
        .returning('id')
        .executeTakeFirstOrThrow();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => accounts.ensurePlayerAccounts(testDb.db, user.id)),
      );
      expect(new Set(results.map((r) => r.walletId)).size).toBe(1);
      const pools = await Promise.all(
        Array.from({ length: 3 }, () => accounts.providerClearing(testDb.db, 'paystack')),
      );
      expect(new Set(pools).size).toBe(1);
      expect(await accounts.system(testDb.db, 'rollover')).toBeTruthy();
    } finally {
      await testDb.drop();
    }
  });
});
