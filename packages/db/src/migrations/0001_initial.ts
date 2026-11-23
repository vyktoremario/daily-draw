import { sql, type Kysely } from 'kysely';

/**
 * Core schema for R1 (design: "Data model and ledger").
 * Money rules enforced by the database itself, not just the app:
 *  - every ledger transaction sums to zero (checked at commit)
 *  - ledger and audit rows can never be updated or deleted
 *  - player balances are cached by trigger and can never go negative
 */
const upStatements: string[] = [
  `CREATE TYPE user_status AS ENUM ('active', 'frozen', 'excluded')`,
  `CREATE TYPE account_kind AS ENUM ('player_wallet', 'player_withdrawal_pending', 'draw_pool', 'rollover', 'operator_revenue', 'tax_payable', 'provider_clearing')`,
  `CREATE TYPE draw_status AS ENUM ('scheduled', 'open', 'closed', 'drawn', 'settled', 'voided')`,
  `CREATE TYPE ledger_tx_kind AS ENUM ('deposit', 'ticket', 'settle', 'prize', 'withdrawal', 'refund', 'adjustment')`,
  `CREATE TYPE channel AS ENUM ('web', 'ussd', 'whatsapp', 'onchain')`,

  `CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone text NOT NULL UNIQUE,
    status user_status NOT NULL DEFAULT 'active',
    language text NOT NULL DEFAULT 'en',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE draws (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draw_number integer NOT NULL UNIQUE,
    draw_date date NOT NULL UNIQUE,
    status draw_status NOT NULL DEFAULT 'scheduled',
    number_range integer NOT NULL CHECK (number_range IN (100, 1000)),
    ticket_price_kobo bigint NOT NULL CHECK (ticket_price_kobo > 0),
    operator_cut_bps integer NOT NULL CHECK (operator_cut_bps BETWEEN 0 AND 10000),
    cutoff_at timestamptz NOT NULL,
    draw_at timestamptz NOT NULL CHECK (draw_at > cutoff_at),
    commitment text,
    drand_round bigint,
    merkle_root text,
    anchor_tx text,
    drand_randomness text,
    revealed_seed text,
    winning_number integer CHECK (winning_number >= 0 AND winning_number < number_range),
    ticket_count integer,
    sales_kobo bigint,
    pool_kobo bigint,
    prize_per_ticket_kobo bigint,
    void_reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz,
    CHECK (status <> 'open' OR commitment IS NOT NULL),
    CHECK (status <> 'voided' OR void_reason IS NOT NULL)
  )`,

  `CREATE TABLE accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind account_kind NOT NULL,
    user_id uuid REFERENCES users(id),
    draw_id uuid REFERENCES draws(id),
    provider text,
    currency char(3) NOT NULL DEFAULT 'NGN',
    balance_kobo bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind IN ('player_wallet', 'player_withdrawal_pending')) = (user_id IS NOT NULL)),
    CHECK ((kind IN ('player_wallet', 'player_withdrawal_pending')) = (balance_kobo IS NOT NULL)),
    CHECK ((kind = 'draw_pool') = (draw_id IS NOT NULL)),
    CHECK ((kind = 'provider_clearing') = (provider IS NOT NULL)),
    CHECK (balance_kobo IS NULL OR balance_kobo >= 0)
  )`,
  `CREATE UNIQUE INDEX accounts_player_unique ON accounts (kind, user_id) WHERE user_id IS NOT NULL`,
  `CREATE UNIQUE INDEX accounts_draw_pool_unique ON accounts (draw_id) WHERE kind = 'draw_pool'`,
  `CREATE UNIQUE INDEX accounts_provider_unique ON accounts (provider) WHERE kind = 'provider_clearing'`,
  `CREATE UNIQUE INDEX accounts_singleton_unique ON accounts (kind) WHERE kind IN ('rollover', 'operator_revenue', 'tax_payable')`,

  `CREATE TABLE ledger_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind ledger_tx_kind NOT NULL,
    idempotency_key text NOT NULL UNIQUE,
    draw_id uuid REFERENCES draws(id),
    metadata jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE TABLE ledger_entries (
    id bigserial PRIMARY KEY,
    transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
    account_id uuid NOT NULL REFERENCES accounts(id),
    amount_kobo bigint NOT NULL CHECK (amount_kobo <> 0),
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX ledger_entries_account_idx ON ledger_entries (account_id, id)`,
  `CREATE INDEX ledger_entries_transaction_idx ON ledger_entries (transaction_id)`,

  `CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
  DECLARE total bigint;
  BEGIN
    SELECT COALESCE(SUM(amount_kobo), 0) INTO total FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
    IF total <> 0 THEN
      RAISE EXCEPTION 'ledger transaction % does not balance (sum % kobo)', NEW.transaction_id, total;
    END IF;
    RETURN NULL;
  END $$`,
  `CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced()`,

  `CREATE FUNCTION ledger_update_cached_balance() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    UPDATE accounts SET balance_kobo = balance_kobo + NEW.amount_kobo
      WHERE id = NEW.account_id AND balance_kobo IS NOT NULL;
    RETURN NEW;
  END $$`,
  `CREATE TRIGGER ledger_entries_cached_balance AFTER INSERT ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION ledger_update_cached_balance()`,

  `CREATE FUNCTION forbid_update_delete() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
  END $$`,
  `CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW EXECUTE FUNCTION forbid_update_delete()`,
  `CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
    FOR EACH ROW EXECUTE FUNCTION forbid_update_delete()`,

  `CREATE TABLE tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code text NOT NULL UNIQUE,
    draw_id uuid NOT NULL REFERENCES draws(id),
    user_id uuid NOT NULL REFERENCES users(id),
    number integer NOT NULL CHECK (number >= 0 AND number < 1000),
    price_kobo bigint NOT NULL CHECK (price_kobo > 0),
    channel channel NOT NULL,
    ledger_transaction_id uuid NOT NULL REFERENCES ledger_transactions(id),
    purchased_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX tickets_draw_number_idx ON tickets (draw_id, number)`,
  `CREATE INDEX tickets_user_draw_idx ON tickets (user_id, draw_id)`,

  `CREATE TABLE webhook_events (
    id bigserial PRIMARY KEY,
    provider text NOT NULL,
    event_id text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    UNIQUE (provider, event_id)
  )`,

  `CREATE TABLE audit_log (
    id bigserial PRIMARY KEY,
    actor text NOT NULL,
    action text NOT NULL,
    entity text NOT NULL,
    entity_id text,
    details jsonb NOT NULL DEFAULT '{}',
    prev_hash text,
    hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION forbid_update_delete()`,

  `CREATE TABLE outbox (
    id bigserial PRIMARY KEY,
    channel text NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email')),
    recipient text NOT NULL,
    template text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}',
    attempts integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz
  )`,
  `CREATE INDEX outbox_unsent_idx ON outbox (id) WHERE sent_at IS NULL`,

  `INSERT INTO accounts (kind) VALUES ('rollover'), ('operator_revenue'), ('tax_payable')`,
];

const downStatements: string[] = [
  'DROP TABLE IF EXISTS outbox, audit_log, webhook_events, tickets, ledger_entries, ledger_transactions, accounts, draws, users CASCADE',
  'DROP FUNCTION IF EXISTS forbid_update_delete, ledger_update_cached_balance, ledger_check_balanced CASCADE',
  'DROP TYPE IF EXISTS channel, ledger_tx_kind, draw_status, account_kind, user_status',
];

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of upStatements) await sql.raw(statement).execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const statement of downStatements) await sql.raw(statement).execute(db);
}
