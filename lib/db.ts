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
      description text NOT NULL DEFAULT '', mode text NOT NULL DEFAULT 'paper',
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
      PRIMARY KEY(user_id,strategy_id,market,side)
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
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS audit_events_strategy_time ON audit_events(strategy_id, created_at DESC);
  `).then(() => undefined);
  return schemaReady;
}
