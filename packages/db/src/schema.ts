import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

/**
 * Hand-written to match migrations. Regenerate with kysely-codegen once the schema settles.
 * bigint columns come back from `pg` as strings unless a type parser is set; see client.ts.
 */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Kobo = ColumnType<bigint, bigint | string, bigint | string>;

export type UserStatus = 'active' | 'frozen' | 'excluded';
export type AccountKind =
  | 'player_wallet'
  | 'player_withdrawal_pending'
  | 'draw_pool'
  | 'rollover'
  | 'operator_revenue'
  | 'tax_payable'
  | 'provider_clearing';
export type DrawStatus = 'scheduled' | 'open' | 'closed' | 'drawn' | 'settled' | 'voided';
export type LedgerTxKind =
  'deposit' | 'ticket' | 'settle' | 'prize' | 'withdrawal' | 'refund' | 'adjustment';
export type Channel = 'web' | 'ussd' | 'whatsapp' | 'onchain';

export interface UsersTable {
  id: Generated<string>;
  phone: string;
  status: Generated<UserStatus>;
  language: Generated<string>;
  created_at: Generated<Timestamp>;
}

export interface AccountsTable {
  id: Generated<string>;
  kind: AccountKind;
  user_id: string | null;
  draw_id: string | null;
  provider: string | null;
  currency: Generated<string>;
  /** Cached balance, player accounts only. System accounts are summed from entries. */
  balance_kobo: Kobo | null;
  created_at: Generated<Timestamp>;
}

export interface DrawsTable {
  id: Generated<string>;
  draw_number: number;
  draw_date: ColumnType<string, string, string>;
  status: Generated<DrawStatus>;
  number_range: number;
  ticket_price_kobo: Kobo;
  operator_cut_bps: number;
  cutoff_at: Timestamp;
  draw_at: Timestamp;
  commitment: string | null;
  drand_round: Kobo | null;
  merkle_root: string | null;
  anchor_tx: string | null;
  drand_randomness: string | null;
  revealed_seed: string | null;
  winning_number: number | null;
  ticket_count: number | null;
  sales_kobo: Kobo | null;
  pool_kobo: Kobo | null;
  prize_per_ticket_kobo: Kobo | null;
  void_reason: string | null;
  created_at: Generated<Timestamp>;
  settled_at: Timestamp | null;
}

export interface LedgerTransactionsTable {
  id: Generated<string>;
  kind: LedgerTxKind;
  idempotency_key: string;
  draw_id: string | null;
  metadata: Generated<unknown>;
  created_at: Generated<Timestamp>;
}

export interface LedgerEntriesTable {
  id: Generated<string>;
  transaction_id: string;
  account_id: string;
  amount_kobo: Kobo;
  created_at: Generated<Timestamp>;
}

export interface TicketsTable {
  id: Generated<string>;
  code: string;
  draw_id: string;
  user_id: string;
  number: number;
  price_kobo: Kobo;
  channel: Channel;
  ledger_transaction_id: string;
  purchased_at: Generated<Timestamp>;
}

export interface WebhookEventsTable {
  id: Generated<string>;
  provider: string;
  event_id: string;
  payload: unknown;
  received_at: Generated<Timestamp>;
  processed_at: Timestamp | null;
}

export interface AuditLogTable {
  id: Generated<string>;
  actor: string;
  action: string;
  entity: string;
  entity_id: string | null;
  details: Generated<unknown>;
  prev_hash: string | null;
  hash: string;
  created_at: Generated<Timestamp>;
}

export interface OutboxTable {
  id: Generated<string>;
  channel: 'sms' | 'whatsapp' | 'email';
  recipient: string;
  template: string;
  payload: Generated<unknown>;
  attempts: Generated<number>;
  created_at: Generated<Timestamp>;
  sent_at: Timestamp | null;
}

export interface Database {
  users: UsersTable;
  accounts: AccountsTable;
  draws: DrawsTable;
  ledger_transactions: LedgerTransactionsTable;
  ledger_entries: LedgerEntriesTable;
  tickets: TicketsTable;
  webhook_events: WebhookEventsTable;
  audit_log: AuditLogTable;
  outbox: OutboxTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type Draw = Selectable<DrawsTable>;
export type Ticket = Selectable<TicketsTable>;
