import type { PoolClient } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { db, initializeDatabase } from "./db";
import { checkLimits } from "./limit-checker";
import { getStrikeDayOpen, getStrikePrice, getStrikePublicAccount, getStrikePublicFills, getStrikePublicOrder, getStrikePublicPositions } from "./strike/client";
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

export async function listStrategies(userId?: string) {
  await initializeDatabase();
  const result = await db().query(
    `SELECT s.*, (SELECT count(*)::int FROM follows f WHERE f.strategy_id=s.id) AS followers,
    (SELECT count(*)::int FROM audit_events a WHERE a.strategy_id=s.id) AS audit_count,
    (SELECT COALESCE(array_agg(DISTINCT a.market ORDER BY a.market), ARRAY[]::text[]) FROM audit_events a WHERE a.strategy_id=s.id) AS markets,
    ($1::uuid IS NOT NULL AND EXISTS(SELECT 1 FROM follows mine WHERE mine.strategy_id=s.id AND mine.user_id=$1::uuid)) AS following
    FROM strategies s ORDER BY s.created_at DESC`,
    [userId ?? null],
  );
  const strategies = result.rows as Array<
    StrategyRow & { followers: number; audit_count: number; following: boolean }
  >;
  const [positions, realized] = await Promise.all([
    db().query(`SELECT p.strategy_id,p.market,p.side,p.size::float,p.entry_price::float
      FROM paper_positions p JOIN strategies s ON s.id=p.strategy_id AND s.owner_id=p.user_id`),
    db().query(`SELECT reference_id AS strategy_id,COALESCE(sum(amount),0)::float AS pnl
      FROM paper_ledger WHERE event_type='realized_pnl' AND reference_id IS NOT NULL GROUP BY reference_id`),
  ]);
  const realizedByStrategy = new Map(
    realized.rows.map((row) => [row.strategy_id as string, Number(row.pnl)]),
  );
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
      const pnlUsd = (realizedByStrategy.get(strategy.id) ?? 0) + ownPositions.reduce(
        (sum, row) =>
          sum +
          (row.side === "long" ? 1 : -1) *
            row.size *
            (prices.get(row.market)! - row.entry_price),
        0,
      );
      const hasTrackRecord = ownPositions.length > 0 || realizedByStrategy.has(strategy.id);
      const returnPct = hasTrackRecord
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
  config: StrategyConfig = { market: "BTC-USD", style: "momentum", takeProfitPct: null, stopLossPct: null },
) {
  await initializeDatabase();
  const id = randomUUID();
  const result = await db().query(
    "INSERT INTO strategies(id,owner_id,name,description,limits,config) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
    [id, ownerId, name, description, JSON.stringify(limits), JSON.stringify(config)],
  );
  return result.rows[0] as StrategyRow;
}

export async function listAudit() {
  await initializeDatabase();
  const [proposals, changes] = await Promise.all([
    db()
      .query(`SELECT a.id,a.strategy_id,a.market,a.side,a.reason,a.notional_usd::float AS notional_usd,
    a.price::float AS price,a.allowed,a.reasons,a.mode,a.event_kind,a.limits_snapshot,
    a.portfolio_snapshot,a.decision_snapshot,a.execution_snapshot,a.event_hash,a.created_at,s.name AS strategy_name
    FROM audit_events a JOIN strategies s ON s.id=a.strategy_id WHERE a.user_id=s.owner_id
    ORDER BY a.created_at DESC LIMIT 100`),
    db()
      .query(`SELECT e.id,e.strategy_id,e.action,e.limits,e.paused,e.created_at,s.name AS strategy_name
    FROM strategy_events e JOIN strategies s ON s.id=e.strategy_id
    ORDER BY e.created_at DESC LIMIT 100`),
  ]);
  return [
    ...proposals.rows.map((row) => ({ ...row, event_type: row.event_kind ?? "proposal" })),
    ...changes.rows.map((row) => ({ ...row, event_type: "rules" })),
  ]
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
    .slice(0, 100);
}

export async function getAuditEvent(id: string) {
  await initializeDatabase();
  const result = await db().query(
    `SELECT a.id,a.strategy_id,a.market,a.side,a.reason,a.notional_usd::float AS notional_usd,
     a.price::float AS price,a.allowed,a.reasons,a.mode,a.event_kind,a.limits_snapshot,
     a.portfolio_snapshot,a.decision_snapshot,a.execution_snapshot,a.event_hash,a.created_at,s.name AS strategy_name
     FROM audit_events a JOIN strategies s ON s.id=a.strategy_id WHERE a.id=$1`,
    [id],
  );
  if (!result.rowCount) throw new Error("Audit record not found.");
  return result.rows[0];
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
    "SELECT market,side,size::float,entry_price::float,opened_at FROM paper_positions WHERE user_id=$1 AND strategy_id=$2",
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
  const realized = await client.query(
    `SELECT COALESCE(sum(amount),0)::float AS pnl FROM paper_ledger
     WHERE user_id=$1 AND reference_id=$2 AND event_type='realized_pnl' AND created_at >= $3`,
    [userId, strategyId, new Date(dayStart)],
  );
  const pnl = positions.rows.reduce((sum, row) => {
    const mark = prices.get(row.market);
    const dayOpen = dayOpens.get(row.market);
    if (!mark || !dayOpen) throw new Error("Paper portfolio price is incomplete.");
    const reference = new Date(row.opened_at).getTime() < dayStart ? dayOpen : row.entry_price;
    return sum + (row.side === "long" ? 1 : -1) * row.size * (mark - reference);
  }, Number(realized.rows[0]?.pnl ?? 0));
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

export async function getPaperPortfolio(userId: string) {
  await initializeDatabase();
  await settleTriggeredPaperPositions(userId);
  const [account, positions, ledger] = await Promise.all([
    db().query(
      `SELECT starting_balance::float,cash_balance::float,currency,created_at
       FROM paper_accounts WHERE user_id=$1`,
      [userId],
    ),
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
  if (!account.rowCount) throw new Error("Paper account is unavailable.");
  const prices = new Map<string, number>();
  await Promise.all(
    [...new Set(positions.rows.map((row) => row.market as string))].map(async (market) =>
      prices.set(market, await getStrikePrice(market)),
    ),
  );
  const enriched = positions.rows.map((row) => {
    const markPrice = prices.get(row.market)!;
    const notionalUsd = row.size * markPrice;
    const unrealizedPnlUsd = (row.side === "long" ? 1 : -1) * row.size * (markPrice - row.entry_price);
    return { ...row, markPrice, notionalUsd, unrealizedPnlUsd };
  });
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

async function settleTriggeredPaperPositions(userId: string) {
  const pending = await db().query(
    `SELECT p.strategy_id,p.market,p.side,p.size::float,p.entry_price::float,
            p.take_profit_price::float,p.stop_loss_price::float
     FROM paper_positions p
     WHERE p.user_id=$1 AND (p.take_profit_price IS NOT NULL OR p.stop_loss_price IS NOT NULL)`,
    [userId],
  );
  if (!pending.rowCount) return;
  const prices = new Map<string, number>();
  await Promise.all([...new Set(pending.rows.map((row) => row.market as string))].map(async (market) => prices.set(market, await getStrikePrice(market))));
  const triggered = pending.rows.filter((row) => {
    const mark = prices.get(row.market as string)!;
    const takeProfit = row.take_profit_price as number | null;
    const stopLoss = row.stop_loss_price as number | null;
    return row.side === "long"
      ? (takeProfit !== null && mark >= takeProfit) || (stopLoss !== null && mark <= stopLoss)
      : (takeProfit !== null && mark <= takeProfit) || (stopLoss !== null && mark >= stopLoss);
  });
  if (!triggered.length) return;
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    for (const row of triggered) {
      const found = await client.query(
        `SELECT p.size::float,p.entry_price::float,p.take_profit_price::float,p.stop_loss_price::float,
                s.limits,s.name AS strategy_name
         FROM paper_positions p JOIN strategies s ON s.id=p.strategy_id
         WHERE p.user_id=$1 AND p.strategy_id=$2 AND p.market=$3 AND p.side=$4 FOR UPDATE`,
        [userId, row.strategy_id, row.market, row.side],
      );
      if (!found.rowCount) continue;
      const position = found.rows[0];
      const mark = prices.get(row.market as string)!;
      const pnl = (row.side === "long" ? 1 : -1) * position.size * (mark - position.entry_price);
      const target = row.side === "long"
        ? (position.take_profit_price !== null && mark >= position.take_profit_price ? "Take profit" : "Stop loss")
        : (position.take_profit_price !== null && mark <= position.take_profit_price ? "Take profit" : "Stop loss");
      const account = await client.query(
        `UPDATE paper_accounts SET cash_balance=cash_balance+$2,updated_at=now() WHERE user_id=$1 RETURNING cash_balance::float`,
        [userId, pnl],
      );
      await client.query(
        `DELETE FROM paper_positions WHERE user_id=$1 AND strategy_id=$2 AND market=$3 AND side=$4`,
        [userId, row.strategy_id, row.market, row.side],
      );
      await client.query(
        `INSERT INTO paper_ledger(id,user_id,event_type,amount,balance_after,description,reference_id)
         VALUES($1,$2,'realized_pnl',$3,$4,$5,$6)`,
        [randomUUID(), userId, pnl, account.rows[0].cash_balance, `${target}: ${row.side.toUpperCase()} ${row.market} closed at Strike mark`, row.strategy_id],
      );
      const auditId = randomUUID();
      await client.query(
        `INSERT INTO audit_events(id,strategy_id,user_id,market,side,notional_usd,price,allowed,reasons,reason,mode,event_kind,limits_snapshot,portfolio_snapshot,decision_snapshot,event_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,true,'[]',$8,'paper','close',$9,$10,$11,$12)`,
        [auditId, row.strategy_id, userId, row.market, row.side, position.size * mark, mark, `${target} triggered`, JSON.stringify(found.rows[0].limits), JSON.stringify({ trigger: target, realizedPnlUsd: pnl }), JSON.stringify({ allowed: true }), hashAudit({ auditId, target, market: row.market, mark, pnl })],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function hashAudit(payload: object) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function closePaperPosition(
  userId: string,
  input: { strategyId: string; market: string; side: "long" | "short" },
) {
  await initializeDatabase();
  const price = await getStrikePrice(input.market);
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT p.size::float,p.entry_price::float,s.name AS strategy_name,s.limits
       FROM paper_positions p JOIN strategies s ON s.id=p.strategy_id
       WHERE p.user_id=$1 AND p.strategy_id=$2 AND p.market=$3 AND p.side=$4 FOR UPDATE`,
      [userId, input.strategyId, input.market, input.side],
    );
    if (!found.rowCount) throw new Error("Paper position not found.");
    const position = found.rows[0];
    const pnl = (input.side === "long" ? 1 : -1) * position.size * (price - position.entry_price);
    const account = await client.query(
      `UPDATE paper_accounts SET cash_balance=cash_balance+$2,updated_at=now()
       WHERE user_id=$1 RETURNING cash_balance::float`,
      [userId, pnl],
    );
    await client.query(
          `DELETE FROM paper_positions WHERE user_id=$1 AND strategy_id=$2 AND market=$3 AND side=$4`,
      [userId, input.strategyId, input.market, input.side],
    );
    const ledgerId = randomUUID();
    await client.query(
      `INSERT INTO paper_ledger(id,user_id,event_type,amount,balance_after,description,reference_id)
       VALUES($1,$2,'realized_pnl',$3,$4,$5,$6)`,
      [ledgerId, userId, pnl, account.rows[0].cash_balance, `${input.side.toUpperCase()} ${input.market} closed at Strike mark`, input.strategyId],
    );
    const auditId = randomUUID();
    await client.query(
      `INSERT INTO audit_events(id,strategy_id,user_id,market,side,notional_usd,price,allowed,reasons,reason,mode,event_kind,limits_snapshot,portfolio_snapshot,decision_snapshot,event_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,true,'[]',$8,'paper','close',$9,$10,$11,$12)`,
      [auditId, input.strategyId, userId, input.market, input.side, position.size * price, price, "Position closed manually", JSON.stringify(position.limits), JSON.stringify({ realizedPnlUsd: pnl, close: "manual" }), JSON.stringify({ allowed: true }), hashAudit({ auditId, market: input.market, price, pnl })],
    );
    await client.query("COMMIT");
    return { price, realizedPnlUsd: pnl, ledgerId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
      const account = await client.query(
        "SELECT cash_balance::float FROM paper_accounts WHERE user_id=$1 FOR UPDATE",
        [accountId],
      );
      if (!account.rowCount) throw new Error("Paper account is unavailable.");
      const allPositions = await client.query(
        "SELECT market,size::float FROM paper_positions WHERE user_id=$1",
        [accountId],
      );
      const accountMarkets = [...new Set(allPositions.rows.map((row) => row.market as string))];
      const accountPrices = new Map<string, number>();
      await Promise.all(accountMarkets.map(async (symbol) => accountPrices.set(symbol, symbol === proposal.market ? price : await getStrikePrice(symbol))));
      const usedBuyingPower = allPositions.rows.reduce(
        (sum, row) => sum + row.size * (accountPrices.get(row.market) ?? 0),
        0,
      );
      const availableBuyingPower = account.rows[0].cash_balance - usedBuyingPower;
      if (proposal.notionalUsd > availableBuyingPower) {
        decision.allowed = false;
        decision.reasons.push("Paper buying power would be exceeded.");
      }
      if (strategy.paused) {
        decision.allowed = false;
        decision.reasons.push("Strategy is paused.");
      }
      const auditId = randomUUID();
      const portfolioSnapshot = {
        openPositions: portfolio.openPositions,
        dailyPnlUsd: portfolio.dailyPnlUsd,
        availableBuyingPowerUsd: availableBuyingPower,
      };
      const proofPayload = {
        id: auditId,
        strategyId: strategy.id,
        proposal,
        strikePrice: price,
        limits: strategy.limits,
        portfolio: portfolioSnapshot,
        decision,
        mode: "paper",
      };
      const eventHash = hashAudit(proofPayload);
      await client.query(
        `INSERT INTO audit_events(id,strategy_id,user_id,market,side,notional_usd,price,allowed,reasons,reason,mode,
         event_kind,limits_snapshot,portfolio_snapshot,decision_snapshot,event_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'paper','proposal',$11,$12,$13,$14)`,
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
          JSON.stringify(strategy.limits),
          JSON.stringify(portfolioSnapshot),
          JSON.stringify(decision),
          eventHash,
        ],
      );
      if (decision.allowed) {
        const size = proposal.notionalUsd / price;
        await client.query(
          `INSERT INTO paper_positions(user_id,strategy_id,market,side,size,entry_price,take_profit_price,stop_loss_price)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT(user_id,strategy_id,market,side) DO UPDATE SET
          entry_price=(paper_positions.size*paper_positions.entry_price+EXCLUDED.size*EXCLUDED.entry_price)/(paper_positions.size+EXCLUDED.size),
          size=paper_positions.size+EXCLUDED.size,
          take_profit_price=EXCLUDED.take_profit_price,
          stop_loss_price=EXCLUDED.stop_loss_price`,
          [accountId, strategy.id, proposal.market, proposal.side, size, price, takeProfitPrice ?? null, stopLossPrice ?? null],
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

export async function checkLiveTrade(
  userId: string,
  proposal: TradeProposal,
  strikeAccountId: string,
) {
  await initializeDatabase();
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  const [price, account, positions, fills] = await Promise.all([
    getStrikePrice(proposal.market),
    getStrikePublicAccount(strikeAccountId),
    getStrikePublicPositions(strikeAccountId),
    getStrikePublicFills(strikeAccountId, dayStart),
  ]);
  if (account.account_id !== strikeAccountId) throw new Error("Strike account verification failed.");

  const symbols = [...new Set(positions.map((position) => position.symbol))];
  const marks = new Map<string, number>();
  await Promise.all(symbols.map(async (symbol) => marks.set(symbol, symbol === proposal.market ? price : await getStrikePrice(symbol))));
  const dayOpens = new Map<string, number>();
  await Promise.all(
    positions
      .filter((position) => Number(position.create_timestamp) < dayStart)
      .map(async (position) => dayOpens.set(position.symbol, await getStrikeDayOpen(position.symbol))),
  );

  const openPositions = positions.flatMap((position) => {
    const signedSize = Number(position.size);
    const mark = marks.get(position.symbol);
    if (!Number.isFinite(signedSize) || !mark || signedSize === 0) return [];
    return [{
      market: position.symbol,
      side: (signedSize > 0 ? "long" : "short") as "long" | "short",
      notionalUsd: Math.abs(signedSize) * mark,
    }];
  });
  const realizedPnl = fills.reduce((sum, fill) => {
    const pnl = Number(fill.realized_pnl);
    const fee = Math.abs(Number(fill.fee));
    return sum + (Number.isFinite(pnl) ? pnl : 0) - (Number.isFinite(fee) ? fee : 0);
  }, 0);
  const dailyUnrealized = positions.reduce((sum, position) => {
    const signedSize = Number(position.size);
    const mark = marks.get(position.symbol);
    const entry = Number(position.entry_price);
    const reference = Number(position.create_timestamp) < dayStart ? dayOpens.get(position.symbol) : entry;
    if (!Number.isFinite(signedSize) || !mark || !reference) throw new Error("Strike portfolio state is incomplete.");
    return sum + signedSize * (mark - reference);
  }, 0);
  const portfolio: PortfolioState = { openPositions, dailyPnlUsd: realizedPnl + dailyUnrealized };

  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query("SELECT * FROM strategies WHERE id=$1 FOR UPDATE", [proposal.strategyId]);
    if (!found.rowCount || found.rows[0].owner_id !== userId) throw new Error("Only the strategy owner can place a live order.");
    const strategy = found.rows[0] as StrategyRow;
    const decision = checkLimits(proposal, strategy.limits, portfolio);
    const availableMarginUsd = Number(account.available_balance);
    if (!Number.isFinite(availableMarginUsd) || availableMarginUsd <= 0) {
      decision.allowed = false;
      decision.reasons.push("Strike account has no available margin.");
    }
    if (strategy.paused) {
      decision.allowed = false;
      decision.reasons.push("Strategy is paused.");
    }
    const auditId = randomUUID();
    const portfolioSnapshot = {
      accountId: strikeAccountId,
      openPositions: portfolio.openPositions,
      dailyPnlUsd: portfolio.dailyPnlUsd,
      availableMarginUsd,
    };
    const proofPayload = {
      id: auditId,
      strategyId: strategy.id,
      proposal,
      strikePrice: price,
      limits: strategy.limits,
      portfolio: portfolioSnapshot,
      decision,
      mode: "live",
    };
    await client.query(
      `INSERT INTO audit_events(id,strategy_id,user_id,market,side,notional_usd,price,allowed,reasons,reason,mode,
       event_kind,limits_snapshot,portfolio_snapshot,decision_snapshot,event_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'live','proposal',$11,$12,$13,$14)`,
      [
        auditId, strategy.id, userId, proposal.market, proposal.side, proposal.notionalUsd, price,
        decision.allowed, JSON.stringify(decision.reasons), proposal.reason, JSON.stringify(strategy.limits),
        JSON.stringify(portfolioSnapshot), JSON.stringify(decision), hashAudit(proofPayload),
      ],
    );
    await client.query("COMMIT");
    return { auditId, price, decision };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordLiveExecution(
  userId: string,
  auditId: string,
  accepted: boolean,
  strikeResponse: unknown,
) {
  await initializeDatabase();
  const found = await db().query(
    `SELECT id,market,side,notional_usd::float AS notional_usd,price::float AS price,portfolio_snapshot
     FROM audit_events WHERE id=$1 AND user_id=$2 AND mode='live' AND execution_snapshot IS NULL`,
    [auditId, userId],
  );
  if (!found.rowCount) throw new Error("Live audit record was not found or already finalized.");
  const event = found.rows[0];
  let verifiedResponse = strikeResponse;
  if (accepted) {
    const supplied = (strikeResponse && typeof strikeResponse === "object" ? strikeResponse : {}) as Record<string, unknown>;
    const orderId = Number(supplied.ID ?? supplied.id ?? supplied.order_id);
    const accountId = String(event.portfolio_snapshot?.accountId ?? "");
    if (!Number.isSafeInteger(orderId) || !accountId) throw new Error("Strike order confirmation is incomplete.");
    const order = await getStrikePublicOrder(accountId, event.market, orderId);
    const symbol = order.Symbol ?? order.symbol;
    const side = order.Side ?? order.side;
    const size = Number(order.Size ?? order.size);
    const expectedSide = event.side === "long" ? "buy" : "sell";
    if (symbol !== event.market || side !== expectedSide || !Number.isFinite(size) || size <= 0)
      throw new Error("Strike order does not match the checked proposal.");
    const executedNotional = size * event.price;
    if (executedNotional > event.notional_usd * 1.001)
      throw new Error("Strike order size exceeds the checked proposal.");
    verifiedResponse = order;
  }
  const snapshot = { accepted, strikeResponse: verifiedResponse, verifiedByStrike: accepted, recordedAt: new Date().toISOString() };
  const result = await db().query(
    `UPDATE audit_events SET execution_snapshot=$3
     WHERE id=$1 AND user_id=$2 AND mode='live' AND execution_snapshot IS NULL
     RETURNING id`,
    [auditId, userId, JSON.stringify(snapshot)],
  );
  if (!result.rowCount) throw new Error("Live audit record was already finalized.");
  return snapshot;
}
