import { Pool } from "pg";

let pool: Pool | undefined;
let schemaReady: Promise<void> | undefined;

/** pg treats prefer/require/verify-ca as verify-full today; say so explicitly to keep behavior and drop the warning. */
export function normalizeConnectionString(raw: string) {
  try {
    const url = new URL(raw);
    const mode = url.searchParams.get("sslmode");
    if (mode && ["prefer", "require", "verify-ca"].includes(mode) && !url.searchParams.has("uselibpqcompat")) {
      url.searchParams.set("sslmode", "verify-full");
      return url.toString();
    }
  } catch {
    // Leave unusual connection strings untouched; pg reports its own error.
  }
  return raw;
}

export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  pool ??= new Pool({ connectionString: normalizeConnectionString(process.env.DATABASE_URL), max: 5 });
  return pool;
}

/** Test hook: drop the pool so a different DATABASE_URL can be used. Schema state is intentionally untouched. */
export async function resetPoolForTests() {
  const old = pool;
  pool = undefined;
  await old?.end().catch(() => undefined);
}

const schema = `
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
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_kind text NOT NULL DEFAULT 'proposal';
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS limits_snapshot jsonb;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS portfolio_snapshot jsonb;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS decision_snapshot jsonb;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS execution_snapshot jsonb;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS event_hash text;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS prev_hash text;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS hash_version integer NOT NULL DEFAULT 1;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS seq bigserial;
    ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS live_order_key text;
    ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS opened_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE strategies ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS take_profit_price numeric;
    ALTER TABLE paper_positions ADD COLUMN IF NOT EXISTS stop_loss_price numeric;
    ALTER TABLE paper_ledger ADD COLUMN IF NOT EXISTS daily_amount numeric;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS ip_hash text;
    CREATE INDEX IF NOT EXISTS audit_events_strategy_time ON audit_events(strategy_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS audit_events_chain ON audit_events(strategy_id, user_id, seq);
    CREATE UNIQUE INDEX IF NOT EXISTS audit_events_live_order ON audit_events(live_order_key) WHERE live_order_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS strategy_events_strategy_time ON strategy_events(strategy_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS paper_ledger_user_time ON paper_ledger(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS paper_ledger_reference ON paper_ledger(reference_id, event_type);
    CREATE INDEX IF NOT EXISTS users_ip_time ON users(ip_hash, created_at);
    CREATE TABLE IF NOT EXISTS job_runs (name text PRIMARY KEY, last_run timestamptz NOT NULL);
`;

/**
 * Creates the schema once per process. A failed attempt is not remembered, so a database that was
 * briefly unreachable at cold start recovers on the next request. The advisory lock keeps
 * simultaneous cold starts from racing each other through the migration.
 */
export function initializeDatabase() {
  schemaReady ??= (async () => {
    const client = await db().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(7311001)");
      await client.query(schema);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}
