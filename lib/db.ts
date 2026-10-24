import { Pool } from "pg";

let pool: Pool | undefined;
let schemaReady: Promise<void> | undefined;
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return pool;
}

export async function initializeDatabase() {
  schemaReady ??= db().query(`
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), expires_at timestamptz NOT NULL
    );
    CREATE TABLE IF NOT EXISTS strategies (
      id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
      description text NOT NULL DEFAULT '', mode text NOT NULL DEFAULT 'paper', config jsonb NOT NULL DEFAULT '{}'::jsonb,
      limits jsonb NOT NULL, paused boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (mode IN ('paper','live'))
    );
    CREATE TABLE IF NOT EXISTS follows (
      user_id uuid NOT NULL REFERENCES users(id), strategy_id uuid NOT NULL REFERENCES strategies(id),
      created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,strategy_id)
    );
    CREATE TABLE IF NOT EXISTS paper_positions (
      user_id uuid NOT NULL REFERENCES users(id), strategy_id uuid NOT NULL REFERENCES strategies(id),
      market text NOT NULL, side text NOT NULL, size numeric NOT NULL, entry_price numeric NOT NULL,
      take_profit_price numeric, stop_loss_price numeric,
      opened_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(user_id,strategy_id,market,side)
    );
    CREATE TABLE IF NOT EXISTS paper_accounts (
      user_id uuid PRIMARY KEY REFERENCES users(id),
      starting_balance numeric NOT NULL,
      cash_balance numeric NOT NULL,
      currency text NOT NULL DEFAULT 'pUSD',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS paper_ledger (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
      event_type text NOT NULL, amount numeric NOT NULL, balance_after numeric NOT NULL,
      description text NOT NULL, reference_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS paper_risk_state (
      user_id uuid NOT NULL REFERENCES users(id), strategy_id uuid NOT NULL REFERENCES strategies(id),
      day date NOT NULL, peak_pnl numeric NOT NULL DEFAULT 0, realized_pnl numeric NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id,strategy_id)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id uuid PRIMARY KEY, strategy_id uuid NOT NULL REFERENCES strategies(id), user_id uuid NOT NULL REFERENCES users(id),
      market text NOT NULL, side text NOT NULL, notional_usd numeric NOT NULL, price numeric, reason text NOT NULL DEFAULT '',
      allowed boolean NOT NULL, reasons jsonb NOT NULL, mode text NOT NULL,
      event_kind text NOT NULL DEFAULT 'proposal',
      limits_snapshot jsonb,
      portfolio_snapshot jsonb,
      decision_snapshot jsonb,
      execution_snapshot jsonb,
      event_hash text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS strategy_events (
      id uuid PRIMARY KEY, strategy_id uuid NOT NULL REFERENCES strategies(id),
      actor_id uuid NOT NULL REFERENCES users(id), action text NOT NULL,
      limits jsonb NOT NULL, paused boolean NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS audit_events_strategy_time ON audit_events(strategy_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS strategy_events_strategy_time ON strategy_events(strategy_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS paper_ledger_user_time ON paper_ledger(user_id, created_at DESC);
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_kind text NOT NULL DEFAULT 'proposal';
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS limits_snapshot jsonb;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS portfolio_snapshot jsonb;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS decision_snapshot jsonb;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS execution_snapshot jsonb;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_hash text;
    ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS opened_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE strategies ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS take_profit_price numeric;
    ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS stop_loss_price numeric;
  `).then(() => undefined);
  return schemaReady;
}
