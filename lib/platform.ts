import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { db, initializeDatabase } from "./db";
import { UserError } from "./errors";
import { evaluateExit, loadPriceBands, rangeSince } from "./exits";
import { checkLimits } from "./limit-checker";
import { computeEventHash, PROOF_VERSION, verifyChain, type ChainRow, type ProofFields } from "./proof";
import {
  getStrikeDayOpen,
  getStrikeMarket,
  getStrikePrice,
  getStrikePublicAccount,
  getStrikePublicFills,
  getStrikePublicOrder,
  getStrikePublicPositions,
} from "./strike/client";
import type { HardLimits, PortfolioState, StrategyConfig, TradeProposal } from "./types";

export type StrategyRow = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  mode: "paper" | "live";
  config: StrategyConfig;
  limits: HardLimits;
  paused: boolean;
  created_at: string;
};

const utcDayStart = () => new Date().setUTCHours(0, 0, 0, 0);
const sign = (side: string) => (side === "long" ? 1 : -1);

/** Memoizes Strike quotes for one operation so network calls happen once, outside database locks where possible. */
class Quotes {
  private marks = new Map<string, Promise<number>>();
  private opens = new Map<string, Promise<number>>();
  seed(symbol: string, price: number) {
    this.marks.set(symbol, Promise.resolve(price));
  }
  mark(symbol: string) {
    if (!this.marks.has(symbol)) this.marks.set(symbol, getStrikePrice(symbol));
    return this.marks.get(symbol)!;
  }
  dayOpen(symbol: string) {
    if (!this.opens.has(symbol)) this.opens.set(symbol, getStrikeDayOpen(symbol));
    return this.opens.get(symbol)!;
  }
  async prefetch(markets: string[], dayOpens: string[] = []) {
    await Promise.all([
      ...[...new Set(markets)].map((symbol) => this.mark(symbol)),
      ...[...new Set(dayOpens)].map((symbol) => this.dayOpen(symbol)),
    ]);
  }
}

/* ---------------------------------------------------------------------------------------------
 * Audit events: every decision is stored with a hash that commits to its contents and, for the
 * strategy owner's public record, to the event before it. Callers hold the strategy row lock.
 * ------------------------------------------------------------------------------------------- */

type AuditInput = {
  strategyId: string;
  ownerId: string;
  userId: string;
  kind: "proposal" | "close";
  mode: "paper" | "live";
  market: string;
  side: string;
  notionalUsd: number;
  price: number | null;
  reason: string;
  allowed: boolean;
  reasons: string[];
  limits: unknown;
  portfolio: unknown;
  decision: unknown;
};

async function insertAuditEvent(client: PoolClient, input: AuditInput) {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  let previousHash: string | null = null;
  if (input.userId === input.ownerId) {
    const previous = await client.query(
      "SELECT event_hash FROM audit_events WHERE strategy_id=$1 AND user_id=$2 AND hash_version=$3 ORDER BY seq DESC LIMIT 1",
      [input.strategyId, input.userId, PROOF_VERSION],
    );
    previousHash = (previous.rows[0]?.event_hash as string | undefined) ?? null;
  }
  const fields: ProofFields = {
    id,
    strategyId: input.strategyId,
    userId: input.userId,
    kind: input.kind,
    mode: input.mode,
    market: input.market,
    side: input.side,
    notionalUsd: input.notionalUsd,
    price: input.price,
    reason: input.reason,
    allowed: input.allowed,
    reasons: input.reasons,
    limits: input.limits,
    portfolio: input.portfolio,
    decision: input.decision,
    createdAt,
  };
  const eventHash = computeEventHash(fields, previousHash);
  await client.query(
    `INSERT INTO audit_events(id,strategy_id,user_id,market,side,notional_usd,price,allowed,reasons,reason,mode,
       event_kind,limits_snapshot,portfolio_snapshot,decision_snapshot,event_hash,prev_hash,hash_version,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::timestamptz)`,
    [
      id, input.strategyId, input.userId, input.market, input.side, input.notionalUsd, input.price, input.allowed,
      JSON.stringify(input.reasons), input.reason, input.mode, input.kind, JSON.stringify(input.limits),
      JSON.stringify(input.portfolio), JSON.stringify(input.decision), eventHash, previousHash, PROOF_VERSION, createdAt,
    ],
  );
  return { id, eventHash };
}

async function lockStrategy(client: PoolClient, strategyId: string) {
  const found = await client.query("SELECT * FROM strategies WHERE id=$1 FOR UPDATE", [strategyId]);
  if (!found.rowCount) throw new UserError("Strategy not found.", 404);
  return found.rows[0] as StrategyRow;
}

/* ------------------------------------------------------------------------------------------- *
 * Strategies and the league
 * ------------------------------------------------------------------------------------------- */

export async function listStrategies(userId?: string) {
  await initializeDatabase();
  const result = await db().query(
    `SELECT s.*,
       (SELECT count(*)::int FROM follows f WHERE f.strategy_id=s.id) AS followers,
       COALESCE(c.allowed_count,0) AS allowed_count,
       COALESCE(c.blocked_count,0) AS blocked_count,
       COALESCE(c.close_count,0) AS close_count,
       COALESCE(c.markets, ARRAY[]::text[]) AS markets,
       ($1::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM follows mine WHERE mine.strategy_id=s.id AND mine.user_id=$1::uuid)) AS following
     FROM strategies s
     LEFT JOIN LATERAL (
       SELECT count(*) FILTER (WHERE a.event_kind='proposal' AND a.allowed)::int AS allowed_count,
              count(*) FILTER (WHERE a.event_kind='proposal' AND NOT a.allowed)::int AS blocked_count,
              count(*) FILTER (WHERE a.event_kind='close')::int AS close_count,
              array_agg(DISTINCT a.market) AS markets
       FROM audit_events a WHERE a.strategy_id=s.id AND a.user_id=s.owner_id
     ) c ON true
     ORDER BY s.created_at DESC LIMIT 500`,
    [userId ?? null],
  );
  const strategies = result.rows as Array<
    StrategyRow & {
      followers: number;
      allowed_count: number;
      blocked_count: number;
      close_count: number;
      markets: string[];
      following: boolean;
    }
  >;
  // Only the strategy owner's own positions and realized results define the strategy's record.
  const [positions, realized] = await Promise.all([
    db().query(`SELECT p.strategy_id,p.market,p.side,p.size::float,p.entry_price::float
      FROM paper_positions p JOIN strategies s ON s.id=p.strategy_id AND s.owner_id=p.user_id`),
    db().query(`SELECT l.reference_id AS strategy_id,COALESCE(sum(l.amount),0)::float AS pnl
      FROM paper_ledger l JOIN strategies s ON s.id=l.reference_id AND s.owner_id=l.user_id
      WHERE l.event_type='realized_pnl' GROUP BY l.reference_id`),
  ]);
  const realizedByStrategy = new Map(realized.rows.map((row) => [row.strategy_id as string, Number(row.pnl)]));
  const quotes = new Quotes();
  const priced = new Map<string, number>();
  await Promise.allSettled(
    [...new Set(positions.rows.map((row) => row.market as string))].map(async (market) => {
      priced.set(market, await quotes.mark(market));
    }),
  );
  return strategies
    .map((strategy) => {
      const own = positions.rows.filter((row) => row.strategy_id === strategy.id);
      let priceStale = false;
      const unrealized = own.reduce((sum, row) => {
        const mark = priced.get(row.market);
        if (mark === undefined) {
          priceStale = true;
          return sum;
        }
        return sum + sign(row.side) * row.size * (mark - row.entry_price);
      }, 0);
      const pnlUsd = (realizedByStrategy.get(strategy.id) ?? 0) + unrealized;
      const hasTrackRecord = own.length > 0 || realizedByStrategy.has(strategy.id);
      const returnPct = hasTrackRecord ? (100 * pnlUsd) / strategy.limits.maxTotalExposureUsd : null;
      const decisions = strategy.allowed_count + strategy.blocked_count;
      const compliancePct = decisions ? (100 * strategy.allowed_count) / decisions : null;
      // Discipline scales gains. Losses are never softened, so breaking your own limits cannot help a rank.
      const score =
        returnPct === null ? null : returnPct >= 0 ? (returnPct * (compliancePct ?? 100)) / 100 : returnPct;
      return {
        ...strategy,
        audit_count: strategy.allowed_count + strategy.blocked_count + strategy.close_count,
        allowedCount: strategy.allowed_count,
        blockedCount: strategy.blocked_count,
        compliancePct,
        pnlUsd,
        returnPct,
        score,
        priceStale,
      };
    })
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
}

export async function createStrategy(
  ownerId: string,
  name: string,
  description: string,
  limits: HardLimits,
  config: StrategyConfig,
) {
  await initializeDatabase();
  if (!(await getStrikeMarket(config.market)))
    throw new UserError(`${config.market} is not a market currently trading on Strike.`);
  const id = randomUUID();
  const result = await db().query(
    "INSERT INTO strategies(id,owner_id,name,description,limits,config) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [id, ownerId, name, description, JSON.stringify(limits), JSON.stringify(config)],
  );
  return result.rows[0] as StrategyRow;
}

export async function updateStrategy(
  userId: string,
  strategyId: string,
  requested: { limits?: HardLimits; paused?: boolean },
) {
  await initializeDatabase();
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM strategies WHERE id=$1 FOR UPDATE", [strategyId]);
    if (!found.rowCount || found.rows[0].owner_id !== userId) throw new UserError("Strategy not found.", 404);
    const strategy = found.rows[0] as StrategyRow;
    const limits = requested.limits ?? strategy.limits;
    for (const key of ["maxPositionNotionalUsd", "dailyLossLimitUsd", "maxTotalExposureUsd", "maxOpenPositions"] as const) {
      if (limits[key] > strategy.limits[key]) throw new UserError("Limits can be made stricter but never relaxed.");
    }
    const paused = requested.paused ?? strategy.paused;
    const action = requested.limits ? "Limits tightened" : paused ? "Strategy paused" : "Strategy resumed";
    await client.query("UPDATE strategies SET limits=$2,paused=$3 WHERE id=$1", [strategyId, JSON.stringify(limits), paused]);
    await client.query(
      "INSERT INTO strategy_events(id,strategy_id,actor_id,action,limits,paused) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), strategyId, userId, action, JSON.stringify(limits), paused],
    );
    await client.query("COMMIT");
    return { limits, paused };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function followStrategy(userId: string, strategyId: string) {
  await initializeDatabase();
  const strategy = await db().query("SELECT id FROM strategies WHERE id=$1", [strategyId]);
  if (!strategy.rowCount) throw new UserError("Strategy not found.", 404);
  await db().query("INSERT INTO follows(user_id,strategy_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [userId, strategyId]);
}

/** Stops future copies. Positions already open stay with the follower, who can close them at any time. */
export async function unfollowStrategy(userId: string, strategyId: string) {
  await initializeDatabase();
  await db().query("DELETE FROM follows WHERE user_id=$1 AND strategy_id=$2", [userId, strategyId]);
}

/* ------------------------------------------------------------------------------------------- *
 * Audit trail
 * ------------------------------------------------------------------------------------------- */

const auditColumns = `a.id,a.strategy_id,a.market,a.side,a.reason,a.notional_usd::float AS notional_usd,
  a.price::float AS price,a.allowed,a.reasons,a.mode,a.event_kind,a.limits_snapshot,a.portfolio_snapshot,
  a.decision_snapshot,a.execution_snapshot,a.event_hash,a.prev_hash,a.hash_version,a.created_at,
  to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS page_cursor,s.name AS strategy_name`;

/** The public record: the strategy owner's own decisions and rule changes, newest first, with cursor paging. */
export async function listAudit(options: { strategyId?: string; limit?: number; before?: string } = {}) {
  await initializeDatabase();
  const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 50)));
  const params = [options.strategyId ?? null, options.before ?? null, limit + 1];
  const [proposals, changes] = await Promise.all([
    db().query(
      `SELECT ${auditColumns} FROM audit_events a JOIN strategies s ON s.id=a.strategy_id
       WHERE a.user_id=s.owner_id AND ($1::uuid IS NULL OR a.strategy_id=$1::uuid) AND ($2::timestamptz IS NULL OR a.created_at < $2::timestamptz)
       ORDER BY a.created_at DESC LIMIT $3`,
      params,
    ),
    db().query(
      `SELECT e.id,e.strategy_id,e.action,e.limits,e.paused,e.created_at,
         to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS page_cursor,s.name AS strategy_name
       FROM strategy_events e JOIN strategies s ON s.id=e.strategy_id
       WHERE ($1::uuid IS NULL OR e.strategy_id=$1::uuid) AND ($2::timestamptz IS NULL OR e.created_at < $2::timestamptz)
       ORDER BY e.created_at DESC LIMIT $3`,
      params,
    ),
  ]);
  const merged = [
    ...proposals.rows.map((row) => ({ ...row, event_type: row.event_kind ?? "proposal" })),
    ...changes.rows.map((row) => ({ ...row, event_type: "rules" })),
  ].sort((a, b) => (a.page_cursor < b.page_cursor ? 1 : a.page_cursor > b.page_cursor ? -1 : 0));
  const page = merged.slice(0, limit);
  return { audit: page, nextCursor: merged.length > limit ? (page[page.length - 1]?.page_cursor as string) : null };
}

/** Owner decisions are public. A participant can also read their own records, such as a follower's copy. */
export async function getAuditEvent(id: string, viewerId?: string) {
  await initializeDatabase();
  const result = await db().query(
    `SELECT ${auditColumns} FROM audit_events a JOIN strategies s ON s.id=a.strategy_id
     WHERE a.id=$1 AND (a.user_id=s.owner_id OR a.user_id=$2::uuid)`,
    [id, viewerId ?? null],
  );
  if (!result.rowCount) throw new UserError("Record not found.", 404);
  return result.rows[0];
}

/** Recomputes the strategy owner's hash chain from the stored data. */
export async function verifyStrategyChain(strategyId: string) {
  await initializeDatabase();
  const strategy = await db().query("SELECT id,name FROM strategies WHERE id=$1", [strategyId]);
  if (!strategy.rowCount) throw new UserError("Strategy not found.", 404);
  const events = await db().query(
    `SELECT a.id,a.strategy_id,a.user_id,a.event_kind,a.mode,a.market,a.side,a.notional_usd::text AS notional_usd,
       a.price::text AS price,a.reason,a.allowed,a.reasons,a.limits_snapshot,a.portfolio_snapshot,a.decision_snapshot,
       a.event_hash,a.prev_hash,a.created_at
     FROM audit_events a JOIN strategies s ON s.id=a.strategy_id
     WHERE a.strategy_id=$1 AND a.user_id=s.owner_id AND a.hash_version=$2 ORDER BY a.seq ASC`,
    [strategyId, PROOF_VERSION],
  );
  const legacy = await db().query(
    `SELECT count(*)::int AS n FROM audit_events a JOIN strategies s ON s.id=a.strategy_id
     WHERE a.strategy_id=$1 AND a.user_id=s.owner_id AND a.hash_version<>$2`,
    [strategyId, PROOF_VERSION],
  );
  const rows: ChainRow[] = events.rows.map((row) => ({
    previousHash: row.prev_hash,
    eventHash: row.event_hash,
    fields: {
      id: row.id,
      strategyId: row.strategy_id,
      userId: row.user_id,
      kind: row.event_kind,
      mode: row.mode,
      market: row.market,
      side: row.side,
      notionalUsd: Number(row.notional_usd),
      price: row.price === null ? null : Number(row.price),
      reason: row.reason,
      allowed: row.allowed,
      reasons: row.reasons,
      limits: row.limits_snapshot,
      portfolio: row.portfolio_snapshot,
      decision: row.decision_snapshot,
      createdAt: new Date(row.created_at).toISOString(),
    },
  }));
  return {
    strategyId,
    strategyName: strategy.rows[0].name as string,
    ...verifyChain(rows),
    unchainedLegacyEvents: legacy.rows[0].n as number,
  };
}

/* ------------------------------------------------------------------------------------------- *
 * Paper accounts
 * ------------------------------------------------------------------------------------------- */

async function paperState(client: PoolClient, userId: string, strategyId: string, quotes: Quotes) {
  const positions = await client.query(
    "SELECT market,side,size::float,entry_price::float,opened_at FROM paper_positions WHERE user_id=$1 AND strategy_id=$2",
    [userId, strategyId],
  );
  const dayStart = utcDayStart();
  const carried = positions.rows.filter((row) => new Date(row.opened_at).getTime() < dayStart).map((row) => row.market as string);
  await quotes.prefetch(positions.rows.map((row) => row.market as string), carried);
  const realized = await client.query(
    `SELECT COALESCE(sum(COALESCE(daily_amount,amount)),0)::float AS pnl FROM paper_ledger
     WHERE user_id=$1 AND reference_id=$2 AND event_type='realized_pnl' AND created_at >= $3`,
    [userId, strategyId, new Date(dayStart)],
  );
  let pnl = Number(realized.rows[0]?.pnl ?? 0);
  const openPositions: PortfolioState["openPositions"] = [];
  for (const row of positions.rows) {
    const mark = await quotes.mark(row.market);
    const reference = new Date(row.opened_at).getTime() < dayStart ? await quotes.dayOpen(row.market) : row.entry_price;
    pnl += sign(row.side) * row.size * (mark - reference);
    openPositions.push({ market: row.market, side: row.side, notionalUsd: row.size * mark });
  }
  return { openPositions, dailyPnlUsd: pnl } satisfies PortfolioState;
}

/**
 * Closes one paper position and records the ledger entry and the public audit event together.
 * `dailyAmount` is the part of the result earned today, which is what the daily loss limit watches.
 */
async function realizePosition(
  client: PoolClient,
  input: {
    userId: string;
    strategyId: string;
    market: string;
    side: "long" | "short";
    exitPrice: number;
    markPrice: number;
    label: string;
    dayOpen: number | null;
  },
) {
  const strategy = await lockStrategy(client, input.strategyId);
  const found = await client.query(
    `SELECT size::float,entry_price::float,opened_at FROM paper_positions
     WHERE user_id=$1 AND strategy_id=$2 AND market=$3 AND side=$4 FOR UPDATE`,
    [input.userId, input.strategyId, input.market, input.side],
  );
  if (!found.rowCount) return null;
  const position = found.rows[0] as { size: number; entry_price: number; opened_at: string };
  const pnl = sign(input.side) * position.size * (input.exitPrice - position.entry_price);
  const carried = new Date(position.opened_at).getTime() < utcDayStart();
  const dailyAmount = carried && input.dayOpen !== null ? sign(input.side) * position.size * (input.exitPrice - input.dayOpen) : pnl;
  const account = await client.query(
    "UPDATE paper_accounts SET cash_balance=cash_balance+$2,updated_at=now() WHERE user_id=$1 RETURNING cash_balance::float",
    [input.userId, pnl],
  );
  await client.query(
    "DELETE FROM paper_positions WHERE user_id=$1 AND strategy_id=$2 AND market=$3 AND side=$4",
    [input.userId, input.strategyId, input.market, input.side],
  );
  const ledgerId = randomUUID();
  await client.query(
    `INSERT INTO paper_ledger(id,user_id,event_type,amount,daily_amount,balance_after,description,reference_id)
     VALUES($1,$2,'realized_pnl',$3,$4,$5,$6,$7)`,
    [ledgerId, input.userId, pnl, dailyAmount, account.rows[0].cash_balance, `${input.label}: closed ${input.side} ${input.market} at $${input.exitPrice.toLocaleString("en-US", { maximumFractionDigits: 4 })}`, input.strategyId],
  );
  await insertAuditEvent(client, {
    strategyId: input.strategyId,
    ownerId: strategy.owner_id,
    userId: input.userId,
    kind: "close",
    mode: "paper",
    market: input.market,
    side: input.side,
    notionalUsd: position.size * input.exitPrice,
    price: input.exitPrice,
    reason: input.label === "Manual close" ? "Position closed manually" : `${input.label} triggered`,
    allowed: true,
    reasons: [],
    limits: strategy.limits,
    portfolio: { realizedPnlUsd: pnl, dailyRealizedPnlUsd: dailyAmount, markPrice: input.markPrice, close: input.label },
    decision: { allowed: true },
  });
  return { pnl, ledgerId };
}

async function safeDayOpen(symbol: string) {
  return getStrikeDayOpen(symbol).catch(() => null);
}

/**
 * Closes any position whose take-profit or stop-loss was reached since it opened. The price path is read from
 * mark-price candles, so a level touched and recovered between visits is still honored, and the fill is at the level.
 */
export async function settleExits(userIds: string[]) {
  if (!userIds.length) return 0;
  await initializeDatabase();
  const pending = await db().query(
    `SELECT user_id,strategy_id,market,side,take_profit_price::float,stop_loss_price::float,opened_at
     FROM paper_positions WHERE user_id = ANY($1::uuid[]) AND (take_profit_price IS NOT NULL OR stop_loss_price IS NOT NULL)`,
    [userIds],
  );
  if (!pending.rowCount) return 0;
  const markets = [...new Set(pending.rows.map((row) => row.market as string))];
  const loaded = await Promise.all(
    markets.map(async (market) => {
      try {
        const [mark, bands] = await Promise.all([getStrikePrice(market), loadPriceBands(market)]);
        return [market, { mark, bands }] as const;
      } catch (error) {
        console.error(`Exit check skipped for ${market}`, error);
        return null;
      }
    }),
  );
  const data = new Map(loaded.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
  const triggered = pending.rows.flatMap((row) => {
    const market = data.get(row.market);
    if (!market) return [];
    const { high, low } = rangeSince(market.bands, new Date(row.opened_at).getTime(), market.mark);
    const hit = evaluateExit(row.side, row.take_profit_price, row.stop_loss_price, high, low);
    return hit ? [{ row, hit, mark: market.mark }] : [];
  });
  let closed = 0;
  for (const { row, hit, mark } of triggered) {
    const dayOpen = new Date(row.opened_at).getTime() < utcDayStart() ? await safeDayOpen(row.market) : null;
    const client = await db().connect();
    try {
      await client.query("BEGIN");
      const done = await realizePosition(client, {
        userId: row.user_id,
        strategyId: row.strategy_id,
        market: row.market,
        side: row.side,
        exitPrice: hit.price,
        markPrice: mark,
        label: hit.kind,
        dayOpen,
      });
      await client.query("COMMIT");
      if (done) closed += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  return closed;
}

/** Lets a background job run at most once per window, across every server instance. */
export async function claimJob(name: string, minutes: number) {
  await initializeDatabase();
  const claimed = await db().query(
    `INSERT INTO job_runs(name,last_run) VALUES($1,now())
     ON CONFLICT(name) DO UPDATE SET last_run=now() WHERE job_runs.last_run < now() - make_interval(mins => $2)
     RETURNING name`,
    [name, minutes],
  );
  return (claimed.rowCount ?? 0) > 0;
}

/** Scheduled sweep: settles exits for every account that holds a position with a take-profit or stop-loss. */
export async function settleAllExits() {
  await initializeDatabase();
  const users = await db().query(
    "SELECT DISTINCT user_id FROM paper_positions WHERE take_profit_price IS NOT NULL OR stop_loss_price IS NOT NULL",
  );
  const ids = users.rows.map((row) => row.user_id as string);
  let closed = 0;
  for (let index = 0; index < ids.length; index += 25) closed += await settleExits(ids.slice(index, index + 25));
  return { accounts: ids.length, closed };
}

export async function getPaperPortfolio(userId: string) {
  await initializeDatabase();
  await settleExits([userId]).catch((error) => console.error("Exit settlement failed", error));
  const [account, positions, ledger] = await Promise.all([
    db().query("SELECT starting_balance::float,cash_balance::float,currency,created_at FROM paper_accounts WHERE user_id=$1", [userId]),
    db().query(
      `SELECT p.strategy_id,p.market,p.side,p.size::float,p.entry_price::float,
       p.take_profit_price::float,p.stop_loss_price::float,s.name AS strategy_name
       FROM paper_positions p JOIN strategies s ON s.id=p.strategy_id
       WHERE p.user_id=$1 ORDER BY p.market`,
      [userId],
    ),
    db().query(
      `SELECT id,event_type,amount::float,balance_after::float,description,reference_id,created_at
       FROM paper_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30`,
      [userId],
    ),
  ]);
  if (!account.rowCount) throw new UserError("Your practice account is unavailable right now.", 503);
  const quotes = new Quotes();
  await quotes.prefetch(positions.rows.map((row) => row.market as string));
  const enriched = await Promise.all(
    positions.rows.map(async (row) => {
      const markPrice = await quotes.mark(row.market);
      const notionalUsd = row.size * markPrice;
      const unrealizedPnlUsd = sign(row.side) * row.size * (markPrice - row.entry_price);
      return { ...row, markPrice, notionalUsd, unrealizedPnlUsd };
    }),
  );
  const cashBalance = account.rows[0].cash_balance as number;
  const exposureUsd = enriched.reduce((sum, row) => sum + row.notionalUsd, 0);
  const unrealizedPnlUsd = enriched.reduce((sum, row) => sum + row.unrealizedPnlUsd, 0);
  const equityUsd = cashBalance + unrealizedPnlUsd;
  return {
    currency: account.rows[0].currency,
    startingBalanceUsd: account.rows[0].starting_balance,
    cashBalanceUsd: cashBalance,
    equityUsd,
    availableUsd: Math.max(0, equityUsd - exposureUsd),
    exposureUsd,
    unrealizedPnlUsd,
    positions: enriched,
    ledger: ledger.rows,
    priceSource: "Strike Finance live mark prices",
  };
}

export async function closePaperPosition(
  userId: string,
  input: { strategyId: string; market: string; side: "long" | "short" },
) {
  await initializeDatabase();
  const price = await getStrikePrice(input.market);
  const opened = await db().query(
    "SELECT opened_at FROM paper_positions WHERE user_id=$1 AND strategy_id=$2 AND market=$3 AND side=$4",
    [userId, input.strategyId, input.market, input.side],
  );
  if (!opened.rowCount) throw new UserError("That open trade was not found.", 404);
  const dayOpen = new Date(opened.rows[0].opened_at).getTime() < utcDayStart() ? await safeDayOpen(input.market) : null;
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const done = await realizePosition(client, { ...input, userId, exitPrice: price, markPrice: price, label: "Manual close", dayOpen });
    if (!done) throw new UserError("That open trade was not found.", 404);
    await client.query("COMMIT");
    return { price, realizedPnlUsd: done.pnl, ledgerId: done.ledgerId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------------------------------- *
 * Proposals
 * ------------------------------------------------------------------------------------------- */

export async function proposeTrade(userId: string, proposal: TradeProposal) {
  await initializeDatabase();
  const head = await db().query("SELECT id,owner_id,mode,config FROM strategies WHERE id=$1", [proposal.strategyId]);
  if (!head.rowCount) throw new UserError("Strategy not found.", 404);
  if (head.rows[0].owner_id !== userId) throw new UserError("Only the strategy's owner can place trades for it.", 403);
  if (head.rows[0].mode !== "paper")
    throw new UserError("Real-money trading is not available for this strategy.");
  const venue = await getStrikeMarket(proposal.market);
  if (!venue) throw new UserError(`${proposal.market} is not a market currently trading on Strike.`);
  if (proposal.notionalUsd < venue.minNotionalUsd)
    throw new UserError(`Strike's minimum order for ${venue.symbol} is $${venue.minNotionalUsd}.`);

  const recipients = await db().query(
    "SELECT user_id FROM follows WHERE strategy_id=$1 UNION SELECT $2::uuid AS user_id ORDER BY user_id",
    [proposal.strategyId, userId],
  );
  const recipientIds = recipients.rows.map((row) => row.user_id as string);
  // Exits that were already reached must free their exposure before this proposal is judged.
  await settleExits(recipientIds).catch((error) => console.error("Exit settlement failed", error));

  const quotes = new Quotes();
  const held = await db().query(
    `SELECT DISTINCT market, (opened_at < $2) AS carried FROM paper_positions WHERE user_id = ANY($1::uuid[])`,
    [recipientIds, new Date(utcDayStart())],
  );
  await quotes.prefetch(
    [proposal.market, ...held.rows.map((row) => row.market as string)],
    held.rows.filter((row) => row.carried).map((row) => row.market as string),
  );
  const price = await quotes.mark(proposal.market);

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const strategy = await lockStrategy(client, proposal.strategyId);
    const config = (strategy.config ?? {}) as Partial<StrategyConfig>;
    const configuredMarket = config.market || proposal.market;
    const takeProfitPct = configuredMarket === proposal.market ? Number(config.takeProfitPct) : NaN;
    const stopLossPct = configuredMarket === proposal.market ? Number(config.stopLossPct) : NaN;
    const takeProfitPrice = Number.isFinite(takeProfitPct) && takeProfitPct > 0
      ? price * (proposal.side === "long" ? 1 + takeProfitPct / 100 : 1 - takeProfitPct / 100)
      : undefined;
    const stopLossPrice = Number.isFinite(stopLossPct) && stopLossPct > 0
      ? price * (proposal.side === "long" ? 1 - stopLossPct / 100 : 1 + stopLossPct / 100)
      : undefined;
    const decisions = [];
    for (const accountId of recipientIds) {
      const portfolio = await paperState(client, accountId, strategy.id, quotes);
      const decision = checkLimits(proposal, strategy.limits, portfolio);
      if (configuredMarket !== proposal.market) {
        decision.allowed = false;
        decision.reasons.push(`This strategy only trades ${configuredMarket}.`);
      }
      const account = await client.query("SELECT cash_balance::float FROM paper_accounts WHERE user_id=$1 FOR UPDATE", [accountId]);
      if (!account.rowCount) throw new UserError("Your practice account is unavailable right now.", 503);
      const allPositions = await client.query("SELECT market,size::float FROM paper_positions WHERE user_id=$1", [accountId]);
      let usedBuyingPower = 0;
      for (const row of allPositions.rows) usedBuyingPower += row.size * (await quotes.mark(row.market));
      const availableBuyingPower = account.rows[0].cash_balance - usedBuyingPower;
      if (proposal.notionalUsd > availableBuyingPower) {
        decision.allowed = false;
        decision.reasons.push("There is not enough practice cash for this trade.");
      }
      if (strategy.paused) {
        decision.allowed = false;
        decision.reasons.push("The owner has paused this strategy.");
      }
      const audit = await insertAuditEvent(client, {
        strategyId: strategy.id,
        ownerId: strategy.owner_id,
        userId: accountId,
        kind: "proposal",
        mode: "paper",
        market: proposal.market,
        side: proposal.side,
        notionalUsd: proposal.notionalUsd,
        price,
        reason: proposal.reason,
        allowed: decision.allowed,
        reasons: decision.reasons,
        limits: strategy.limits,
        portfolio: {
          openPositions: portfolio.openPositions,
          dailyPnlUsd: portfolio.dailyPnlUsd,
          availableBuyingPowerUsd: availableBuyingPower,
        },
        decision,
      });
      if (decision.allowed) {
        const size = proposal.notionalUsd / price;
        // Adding to a position keeps its exit percentages: levels are re-based on the new average entry.
        const average = "(paper_positions.size*paper_positions.entry_price+EXCLUDED.size*EXCLUDED.entry_price)/(paper_positions.size+EXCLUDED.size)";
        await client.query(
          `INSERT INTO paper_positions(user_id,strategy_id,market,side,size,entry_price,take_profit_price,stop_loss_price)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(user_id,strategy_id,market,side) DO UPDATE SET
             entry_price=${average},
             size=paper_positions.size+EXCLUDED.size,
             take_profit_price=CASE WHEN EXCLUDED.take_profit_price IS NULL THEN NULL
               ELSE ${average}*EXCLUDED.take_profit_price/EXCLUDED.entry_price END,
             stop_loss_price=CASE WHEN EXCLUDED.stop_loss_price IS NULL THEN NULL
               ELSE ${average}*EXCLUDED.stop_loss_price/EXCLUDED.entry_price END`,
          [accountId, strategy.id, proposal.market, proposal.side, size, price, takeProfitPrice ?? null, stopLossPrice ?? null],
        );
      }
      decisions.push({ userId: accountId, auditId: audit.id, decision });
    }
    await client.query("COMMIT");
    return {
      price,
      ownerDecision: decisions.find((item) => item.userId === userId),
      followerCount: decisions.length - 1,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------------------------------- *
 * Live path: the server checks and records; the browser signs and submits the order itself.
 * ------------------------------------------------------------------------------------------- */

export async function checkLiveTrade(userId: string, proposal: TradeProposal, strikeAccountId: string) {
  await initializeDatabase();
  const venue = await getStrikeMarket(proposal.market);
  if (!venue) throw new UserError(`${proposal.market} is not a market currently trading on Strike.`);
  if (proposal.notionalUsd < venue.minNotionalUsd)
    throw new UserError(`Strike's minimum order for ${venue.symbol} is $${venue.minNotionalUsd}.`);
  const dayStart = utcDayStart();
  const [price, account, positions, fills] = await Promise.all([
    getStrikePrice(proposal.market),
    getStrikePublicAccount(strikeAccountId),
    getStrikePublicPositions(strikeAccountId),
    getStrikePublicFills(strikeAccountId, dayStart),
  ]);
  if (account.account_id !== strikeAccountId) throw new UserError("Strike account verification failed.");

  const quotes = new Quotes();
  quotes.seed(proposal.market, price);
  const carried = positions.filter((position) => Number(position.create_timestamp) < dayStart).map((position) => position.symbol);
  await quotes.prefetch(positions.map((position) => position.symbol), carried);

  const openPositions: PortfolioState["openPositions"] = [];
  let dailyUnrealized = 0;
  for (const position of positions) {
    const signedSize = Number(position.size);
    const mark = await quotes.mark(position.symbol);
    if (!Number.isFinite(signedSize) || signedSize === 0) continue;
    openPositions.push({ market: position.symbol, side: signedSize > 0 ? "long" : "short", notionalUsd: Math.abs(signedSize) * mark });
    const reference = Number(position.create_timestamp) < dayStart ? await quotes.dayOpen(position.symbol) : Number(position.entry_price);
    if (!Number.isFinite(reference) || reference <= 0) throw new UserError("Strike portfolio state is incomplete.", 502);
    dailyUnrealized += signedSize * (mark - reference);
  }
  const realizedPnl = fills.reduce((sum, fill) => {
    const pnl = Number(fill.realized_pnl);
    const fee = Math.abs(Number(fill.fee));
    return sum + (Number.isFinite(pnl) ? pnl : 0) - (Number.isFinite(fee) ? fee : 0);
  }, 0);
  const portfolio: PortfolioState = { openPositions, dailyPnlUsd: realizedPnl + dailyUnrealized };

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const strategy = await lockStrategy(client, proposal.strategyId);
    if (strategy.owner_id !== userId) throw new UserError("Only the strategy's owner can place real orders for it.", 403);
    const decision = checkLimits(proposal, strategy.limits, portfolio);
    const configuredMarket = (strategy.config as Partial<StrategyConfig> | undefined)?.market;
    if (configuredMarket && configuredMarket !== proposal.market) {
      decision.allowed = false;
      decision.reasons.push(`This strategy only trades ${configuredMarket}.`);
    }
    const availableMarginUsd = Number(account.available_balance);
    if (!Number.isFinite(availableMarginUsd) || availableMarginUsd <= 0) {
      decision.allowed = false;
      decision.reasons.push("Your Strike account has no available funds.");
    }
    if (strategy.paused) {
      decision.allowed = false;
      decision.reasons.push("The owner has paused this strategy.");
    }
    const audit = await insertAuditEvent(client, {
      strategyId: strategy.id,
      ownerId: strategy.owner_id,
      userId,
      kind: "proposal",
      mode: "live",
      market: proposal.market,
      side: proposal.side,
      notionalUsd: proposal.notionalUsd,
      price,
      reason: proposal.reason,
      allowed: decision.allowed,
      reasons: decision.reasons,
      limits: strategy.limits,
      portfolio: { accountId: strikeAccountId, openPositions: portfolio.openPositions, dailyPnlUsd: portfolio.dailyPnlUsd, availableMarginUsd },
      decision,
    });
    await client.query("COMMIT");
    return { auditId: audit.id, price, decision };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordLiveExecution(userId: string, auditId: string, accepted: boolean, strikeResponse: unknown) {
  await initializeDatabase();
  const found = await db().query(
    `SELECT id,market,side,notional_usd::float AS notional_usd,price::float AS price,portfolio_snapshot
     FROM audit_events WHERE id=$1 AND user_id=$2 AND mode='live' AND execution_snapshot IS NULL`,
    [auditId, userId],
  );
  if (!found.rowCount) throw new UserError("This real-money record was not found or is already complete.");
  const event = found.rows[0];
  let verifiedResponse = strikeResponse;
  let orderKey: string | null = null;
  if (accepted) {
    const supplied = (strikeResponse && typeof strikeResponse === "object" ? strikeResponse : {}) as Record<string, unknown>;
    const orderId = Number(supplied.ID ?? supplied.id ?? supplied.order_id);
    const accountId = String(event.portfolio_snapshot?.accountId ?? "");
    if (!Number.isSafeInteger(orderId) || !accountId) throw new UserError("Strike did not return enough detail to confirm the order.");
    const order = await getStrikePublicOrder(accountId, event.market, orderId);
    const symbol = order.Symbol ?? order.symbol;
    const side = order.Side ?? order.side;
    const status = String(order.Status ?? order.status ?? "");
    const size = Number(order.Size ?? order.size);
    const expectedSide = event.side === "long" ? "buy" : "sell";
    if (symbol !== event.market || side !== expectedSide || !Number.isFinite(size) || size <= 0)
      throw new UserError("The Strike order does not match the trade that was checked.");
    if (/reject|cancel|expire|fail/i.test(status)) throw new UserError(`Strike reports this order as ${status.toLowerCase()}.`);
    if (size * event.price > event.notional_usd * 1.001) throw new UserError("The Strike order is larger than the trade that was checked.");
    verifiedResponse = order;
    orderKey = `${accountId}:${orderId}`;
  }
  const snapshot = { accepted, strikeResponse: verifiedResponse, verifiedByStrike: accepted, recordedAt: new Date().toISOString() };
  try {
    const result = await db().query(
      `UPDATE audit_events SET execution_snapshot=$3,live_order_key=$4
       WHERE id=$1 AND user_id=$2 AND mode='live' AND execution_snapshot IS NULL RETURNING id`,
      [auditId, userId, JSON.stringify(snapshot), orderKey],
    );
    if (!result.rowCount) throw new UserError("This real-money record is already complete.");
  } catch (error) {
    if ((error as { code?: string }).code === "23505")
      throw new UserError("This Strike order is already attached to another record.");
    throw error;
  }
  return snapshot;
}
