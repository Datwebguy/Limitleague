import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { db, initializeDatabase } from "./db";
import { checkLimits } from "./limit-checker";
import { getStrikeDayOpen, getStrikePrice } from "./strike/client";
import type { HardLimits, PortfolioState, TradeProposal } from "./types";

export type StrategyRow = {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  mode: "paper" | "live";
  limits: HardLimits;
  paused: boolean;
  created_at: string;
};

export async function listStrategies(userId?: string) {
  await initializeDatabase();
  const result = await db().query(
    `SELECT s.*, (SELECT count(*)::int FROM follows f WHERE f.strategy_id=s.id) AS followers,
    (SELECT count(*)::int FROM audit_events a WHERE a.strategy_id=s.id) AS audit_count,
    ($1::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM follows mine WHERE mine.strategy_id=s.id AND mine.user_id=$1::uuid)) AS following
    FROM strategies s ORDER BY s.created_at DESC`,
    [userId ?? null],
  );
  const strategies = result.rows as Array<
    StrategyRow & { followers: number; audit_count: number; following: boolean }
  >;
  const positions = await db()
    .query(`SELECT p.strategy_id,p.market,p.side,p.size::float,p.entry_price::float
    FROM paper_positions p JOIN strategies s ON s.id=p.strategy_id AND s.owner_id=p.user_id`);
  const prices = new Map<string, number>();
  await Promise.all(
    [...new Set(positions.rows.map((row) => row.market as string))].map(
      async (market) => prices.set(market, await getStrikePrice(market)),
    ),
  );
  return strategies
    .map((strategy) => {
      const ownPositions = positions.rows.filter(
        (row) => row.strategy_id === strategy.id,
      );
      const pnlUsd = ownPositions.reduce(
        (sum, row) =>
          sum +
          (row.side === "long" ? 1 : -1) *
            row.size *
            (prices.get(row.market)! - row.entry_price),
        0,
      );
      const returnPct = ownPositions.length
        ? (100 * pnlUsd) / strategy.limits.maxTotalExposureUsd
        : null;
      const score =
        returnPct === null
          ? null
          : returnPct * (1 + Math.log1p(strategy.audit_count) * 0.05);
      return { ...strategy, pnlUsd, returnPct, score };
    })
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
}

export async function createStrategy(
  ownerId: string,
  name: string,
  description: string,
  limits: HardLimits,
) {
  await initializeDatabase();
  const id = randomUUID();
  const result = await db().query(
    "INSERT INTO strategies(id,owner_id,name,description,limits) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [id, ownerId, name, description, JSON.stringify(limits)],
  );
  return result.rows[0] as StrategyRow;
}

export async function listAudit() {
  await initializeDatabase();
  const [proposals, changes] = await Promise.all([
    db()
      .query(`SELECT a.id,a.strategy_id,a.market,a.side,a.reason,a.notional_usd::float AS notional_usd,
    a.price::float AS price,a.allowed,a.reasons,a.mode,a.created_at,s.name AS strategy_name
    FROM audit_events a JOIN strategies s ON s.id=a.strategy_id WHERE a.user_id=s.owner_id
    ORDER BY a.created_at DESC LIMIT 100`),
    db()
      .query(`SELECT e.id,e.strategy_id,e.action,e.limits,e.paused,e.created_at,s.name AS strategy_name
    FROM strategy_events e JOIN strategies s ON s.id=e.strategy_id
    ORDER BY e.created_at DESC LIMIT 100`),
  ]);
  return [
    ...proposals.rows.map((row) => ({ ...row, event_type: "proposal" })),
    ...changes.rows.map((row) => ({ ...row, event_type: "rules" })),
  ]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, 100);
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
    const found = await client.query(
      "SELECT * FROM strategies WHERE id=$1 FOR UPDATE",
      [strategyId],
    );
    if (!found.rowCount || found.rows[0].owner_id !== userId)
      throw new Error("Strategy not found.");
    const strategy = found.rows[0] as StrategyRow;
    const limits = requested.limits ?? strategy.limits;
    for (const key of [
      "maxPositionNotionalUsd",
      "dailyLossLimitUsd",
      "maxTotalExposureUsd",
      "maxOpenPositions",
    ] as const) {
      if (limits[key] > strategy.limits[key])
        throw new Error("Published limits can only be tightened.");
    }
    const paused = requested.paused ?? strategy.paused;
    const action = requested.limits
      ? "Limits tightened"
      : paused
        ? "Strategy paused"
        : "Strategy resumed";
    await client.query(
      "UPDATE strategies SET limits=$2,paused=$3 WHERE id=$1",
      [strategyId, JSON.stringify(limits), paused],
    );
    await client.query(
      "INSERT INTO strategy_events(id,strategy_id,actor_id,action,limits,paused) VALUES($1,$2,$3,$4,$5,$6)",
      [
        randomUUID(),
        strategyId,
        userId,
        action,
        JSON.stringify(limits),
        paused,
      ],
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
  const strategy = await db().query("SELECT id FROM strategies WHERE id=$1", [
    strategyId,
  ]);
  if (!strategy.rowCount) throw new Error("Strategy not found.");
  await db().query(
    "INSERT INTO follows(user_id,strategy_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [userId, strategyId],
  );
}

async function paperState(
  client: PoolClient,
  userId: string,
  strategyId: string,
  market: string,
  price: number,
) {
  const positions = await client.query(
    "SELECT market,side,size::float,entry_price::float FROM paper_positions WHERE user_id=$1 AND strategy_id=$2",
    [userId, strategyId],
  );
  const markets = [
    ...new Set(positions.rows.map((row) => row.market as string)),
  ];
  const prices = new Map<string, number>();
  await Promise.all(
    markets.map(async (symbol) =>
      prices.set(
        symbol,
        symbol === market ? price : await getStrikePrice(symbol),
      ),
    ),
  );
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  const dayOpens = new Map<string, number>();
  await Promise.all(
    markets.map(async (symbol) =>
      dayOpens.set(symbol, await getStrikeDayOpen(symbol)),
    ),
  );
  const fills = await client.query(
    `SELECT market,side,notional_usd::float,price::float,created_at
    FROM audit_events WHERE user_id=$1 AND strategy_id=$2 AND allowed=true AND mode='paper'`,
    [userId, strategyId],
  );
  const pnl = fills.rows.reduce((sum, row) => {
    const mark = prices.get(row.market);
    const dayOpen = dayOpens.get(row.market);
    if (!mark || !dayOpen || !row.price)
      throw new Error("Paper portfolio price is incomplete.");
    const reference =
      new Date(row.created_at).getTime() < dayStart ? dayOpen : row.price;
    return (
      sum +
      (((row.side === "long" ? 1 : -1) * row.notional_usd) / row.price) *
        (mark - reference)
    );
  }, 0);
  const portfolio: PortfolioState = {
    openPositions: positions.rows.map((row) => ({
      market: row.market,
      side: row.side,
      notionalUsd: row.size * prices.get(row.market)!,
    })),
    dailyPnlUsd: pnl,
  };
  return portfolio;
}

export async function proposeTrade(userId: string, proposal: TradeProposal) {
  await initializeDatabase();
  const price = await getStrikePrice(proposal.market);
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      "SELECT * FROM strategies WHERE id=$1 FOR UPDATE",
      [proposal.strategyId],
    );
    if (!found.rowCount) throw new Error("Strategy not found.");
    const strategy = found.rows[0] as StrategyRow;
    if (strategy.owner_id !== userId)
      throw new Error("Only the strategy owner can propose a trade.");
    if (strategy.mode !== "paper")
      throw new Error(
        "Live trading is not available until the Strike wallet is configured.",
      );
    const recipients = await client.query(
      "SELECT user_id FROM follows WHERE strategy_id=$1 UNION SELECT $2::uuid AS user_id",
      [strategy.id, userId],
    );
    const decisions = [];
    for (const recipient of recipients.rows) {
      const accountId = recipient.user_id as string;
      const portfolio = await paperState(
        client,
        accountId,
        strategy.id,
        proposal.market,
        price,
      );
      const decision = checkLimits(proposal, strategy.limits, portfolio);
      if (strategy.paused) {
        decision.allowed = false;
        decision.reasons.push("Strategy is paused.");
      }
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO audit_events(id,strategy_id,user_id,market,side,notional_usd,price,allowed,reasons,reason,mode)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'paper')`,
        [
          auditId,
          strategy.id,
          accountId,
          proposal.market,
          proposal.side,
          proposal.notionalUsd,
          price,
          decision.allowed,
          JSON.stringify(decision.reasons),
          proposal.reason,
        ],
      );
      if (decision.allowed) {
        const size = proposal.notionalUsd / price;
        await client.query(
          `INSERT INTO paper_positions(user_id,strategy_id,market,side,size,entry_price)
          VALUES($1,$2,$3,$4,$5,$6)
          ON CONFLICT(user_id,strategy_id,market,side) DO UPDATE SET
          entry_price=(paper_positions.size*paper_positions.entry_price+EXCLUDED.size*EXCLUDED.entry_price)/(paper_positions.size+EXCLUDED.size),
          size=paper_positions.size+EXCLUDED.size`,
          [accountId, strategy.id, proposal.market, proposal.side, size, price],
        );
      }
      decisions.push({ userId: accountId, auditId, decision });
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
