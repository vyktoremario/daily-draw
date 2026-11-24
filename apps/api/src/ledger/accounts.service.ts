import { Injectable } from '@nestjs/common';
import type { AccountKind, Database } from '@daily-draw/db';
import type { Kysely, Transaction } from 'kysely';

type Executor = Kysely<Database> | Transaction<Database>;
type SystemAccountKind = Extract<AccountKind, 'rollover' | 'operator_revenue' | 'tax_payable'>;

export interface PlayerAccounts {
  walletId: string;
  withdrawalPendingId: string;
}

/**
 * Finds or creates ledger accounts. Every method is safe to call repeatedly and concurrently:
 * creation uses INSERT … ON CONFLICT DO NOTHING against the partial unique indexes from
 * migration 0001, then reads the row back.
 */
@Injectable()
export class AccountsService {
  async ensurePlayerAccounts(db: Executor, userId: string): Promise<PlayerAccounts> {
    await db
      .insertInto('accounts')
      .values([
        { kind: 'player_wallet', user_id: userId, balance_kobo: 0n },
        { kind: 'player_withdrawal_pending', user_id: userId, balance_kobo: 0n },
      ])
      .onConflict((oc) =>
        oc.columns(['kind', 'user_id']).where('user_id', 'is not', null).doNothing(),
      )
      .execute();

    const rows = await db
      .selectFrom('accounts')
      .select(['id', 'kind'])
      .where('user_id', '=', userId)
      .execute();
    const walletId = rows.find((r) => r.kind === 'player_wallet')?.id;
    const withdrawalPendingId = rows.find((r) => r.kind === 'player_withdrawal_pending')?.id;
    if (!walletId || !withdrawalPendingId)
      throw new Error(`Player accounts missing for user ${userId}`);
    return { walletId, withdrawalPendingId };
  }

  async drawPool(db: Executor, drawId: string): Promise<string> {
    await db
      .insertInto('accounts')
      .values({ kind: 'draw_pool', draw_id: drawId })
      .onConflict((oc) => oc.column('draw_id').where('kind', '=', 'draw_pool').doNothing())
      .execute();
    const row = await db
      .selectFrom('accounts')
      .select('id')
      .where('kind', '=', 'draw_pool')
      .where('draw_id', '=', drawId)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  async providerClearing(db: Executor, provider: string): Promise<string> {
    await db
      .insertInto('accounts')
      .values({ kind: 'provider_clearing', provider })
      .onConflict((oc) => oc.column('provider').where('kind', '=', 'provider_clearing').doNothing())
      .execute();
    const row = await db
      .selectFrom('accounts')
      .select('id')
      .where('kind', '=', 'provider_clearing')
      .where('provider', '=', provider)
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** Rollover, operator revenue and tax payable exist once each (seeded by migration 0001). */
  async system(db: Executor, kind: SystemAccountKind): Promise<string> {
    const row = await db
      .selectFrom('accounts')
      .select('id')
      .where('kind', '=', kind)
      .executeTakeFirstOrThrow(
        () => new Error(`System account "${kind}" is missing; run migrations`),
      );
    return row.id;
  }
}
