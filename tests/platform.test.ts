import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertWorkspaceBudget, ensurePaperAccount } from "../lib/auth";
import { db, initializeDatabase } from "../lib/db";
import { UserError } from "../lib/errors";
import {
  closePaperPosition,
  createStrategy,
  followStrategy,
  getAuditEvent,
  listAudit,
  listStrategies,
  proposeTrade,
  settleExits,
  unfollowStrategy,
  updateStrategy,
  verifyStrategyChain,
} from "../lib/platform";
import { getStrikeDayOpen } from "../lib/strike/client";
import type { HardLimits, StrategyConfig } from "../lib/types";

const skip = !process.env.DATABASE_URL;
test.after(async () => {
  if (process.env.DATABASE_URL) await db().end();
});

const limits: HardLimits = { maxPositionNotionalUsd: 1000, dailyLossLimitUsd: 500, maxTotalExposureUsd: 2000, maxOpenPositions: 3, pauseAtDailyLoss: true };
const btc: StrategyConfig = { market: "BTC-USD", style: "momentum", takeProfitPct: null, stopLossPct: null };

async function makeUser() {
  await initializeDatabase();
  const id = randomUUID();
  await db().query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'test')", [id, `${id}@example.test`]);
  await ensurePaperAccount(id);
  return id;
}
const makeStrategy = (owner: string, overrides: { limits?: Partial<HardLimits>; config?: Partial<StrategyConfig> } = {}) =>
  createStrategy(owner, `Test ${randomUUID().slice(0, 8)}`, "integration", { ...limits, ...overrides.limits }, { ...btc, ...overrides.config });
const propose = (owner: string, strategyId: string, notionalUsd: number, side: "long" | "short" = "long") =>
  proposeTrade(owner, { strategyId, market: "BTC-USD", side, notionalUsd, reason: "integration" });
const standing = async (strategyId: string) => (await listStrategies()).find((item) => item.id === strategyId)!;

test("a paper proposal is checked, copied to followers, and audited", { skip }, async () => {
  const owner = await makeUser();
  const follower = await makeUser();
  const strategy = await createStrategy(owner, "Integration Strategy", "Test", { ...limits, maxPositionNotionalUsd: 200, dailyLossLimitUsd: 50, maxTotalExposureUsd: 300, maxOpenPositions: 1 }, btc);
  await followStrategy(follower, strategy.id);
  const allowed = await propose(owner, strategy.id, 100);
  assert.equal(allowed.ownerDecision?.decision.allowed, true);
  assert.equal(allowed.followerCount, 1);
  const blocked = await propose(owner, strategy.id, 150);
  assert.equal(blocked.ownerDecision?.decision.allowed, false);
  const { audit } = await listAudit({ strategyId: strategy.id });
  assert.ok(audit.some((event) => event.allowed === true));
  assert.ok(audit.some((event) => event.allowed === false));
  await assert.rejects(() => updateStrategy(owner, strategy.id, { limits: { ...strategy.limits, maxTotalExposureUsd: 400 } }), /never relaxed/);
  await updateStrategy(owner, strategy.id, { paused: true });
  const paused = await propose(owner, strategy.id, 10);
  assert.equal(paused.ownerDecision?.decision.allowed, false);
  assert.ok((await listAudit({ strategyId: strategy.id })).audit.some((event) => event.action === "Strategy paused"));
});

test("only the strategy owner's own results define its standing, never a follower's", { skip }, async () => {
  const owner = await makeUser();
  const follower = await makeUser();
  const strategy = await makeStrategy(owner);
  await followStrategy(follower, strategy.id);
  await propose(owner, strategy.id, 500);
  // The follower's copy entered at half price, so closing it books a large realized gain.
  await db().query("UPDATE paper_positions SET entry_price=entry_price*0.5 WHERE user_id=$1 AND strategy_id=$2", [follower, strategy.id]);
  const closed = await closePaperPosition(follower, { strategyId: strategy.id, market: "BTC-USD", side: "long" });
  assert.ok(closed.realizedPnlUsd > 200, `follower realized ${closed.realizedPnlUsd}`);
  const row = await standing(strategy.id);
  assert.ok(Math.abs(row.pnlUsd) < 20, `strategy pnl ${row.pnlUsd} must not include the follower's ${closed.realizedPnlUsd}`);
});

test("compliance scales gains, and losses are never softened", { skip }, async () => {
  const winner = await makeUser();
  const gain = await makeStrategy(winner);
  await propose(winner, gain.id, 500);
  await propose(winner, gain.id, 5000); // blocked: breaches the position cap
  await db().query("UPDATE paper_positions SET entry_price=entry_price*0.5 WHERE user_id=$1 AND strategy_id=$2", [winner, gain.id]);
  const won = await standing(gain.id);
  assert.equal(won.allowedCount, 1);
  assert.equal(won.blockedCount, 1);
  assert.equal(won.compliancePct, 50);
  assert.ok(won.returnPct! > 5);
  assert.ok(Math.abs(won.score! - won.returnPct! / 2) < 1e-6, "positive return is halved by 50% compliance");

  const loser = await makeUser();
  const loss = await makeStrategy(loser);
  await propose(loser, loss.id, 500);
  await propose(loser, loss.id, 5000);
  await db().query("UPDATE paper_positions SET entry_price=entry_price*2 WHERE user_id=$1 AND strategy_id=$2", [loser, loss.id]);
  const lost = await standing(loss.id);
  assert.ok(lost.returnPct! < 0);
  assert.equal(lost.score, lost.returnPct);
});

test("blocked spam and follower activity cannot lift a score", { skip }, async () => {
  const owner = await makeUser();
  const strategy = await makeStrategy(owner);
  await propose(owner, strategy.id, 500);
  await db().query("UPDATE paper_positions SET entry_price=entry_price*0.9 WHERE user_id=$1 AND strategy_id=$2", [owner, strategy.id]);
  const before = await standing(strategy.id);
  for (let i = 0; i < 5; i += 1) await propose(owner, strategy.id, 5000);
  const after = await standing(strategy.id);
  assert.ok(after.score! < before.score!, `spam must lower the score (${before.score} -> ${after.score})`);
});

test("the public audit pages per strategy and hides followers' records", { skip }, async () => {
  const owner = await makeUser();
  const follower = await makeUser();
  const strategy = await makeStrategy(owner);
  const other = await makeStrategy(await makeUser());
  await followStrategy(follower, strategy.id);
  await propose(other.owner_id, other.id, 20);
  for (let i = 0; i < 3; i += 1) await propose(owner, strategy.id, 20);
  const first = await listAudit({ strategyId: strategy.id, limit: 2 });
  assert.equal(first.audit.length, 2);
  assert.ok(first.nextCursor);
  const second = await listAudit({ strategyId: strategy.id, limit: 2, before: first.nextCursor! });
  assert.equal(second.audit.length, 1);
  assert.equal(second.nextCursor, null);
  const seen = [...first.audit, ...second.audit];
  assert.ok(seen.every((event) => event.strategy_id === strategy.id));
  assert.equal(new Set(seen.map((event) => event.id)).size, 3);

  const followerEvent = (await db().query("SELECT id FROM audit_events WHERE strategy_id=$1 AND user_id=$2", [strategy.id, follower])).rows[0].id;
  await assert.rejects(() => getAuditEvent(followerEvent), UserError);
  assert.equal((await getAuditEvent(followerEvent, follower)).id, followerEvent);
  assert.equal((await getAuditEvent(seen[0].id)).id, seen[0].id);
});

test("the proof chain verifies, survives concurrent proposals, and exposes tampering", { skip }, async () => {
  const owner = await makeUser();
  const strategy = await makeStrategy(owner);
  await Promise.all([propose(owner, strategy.id, 20), propose(owner, strategy.id, 20), propose(owner, strategy.id, 20)]);
  await propose(owner, strategy.id, 5000);
  await closePaperPosition(owner, { strategyId: strategy.id, market: "BTC-USD", side: "long" });
  const intact = await verifyStrategyChain(strategy.id);
  assert.equal(intact.valid, true, intact.problem ?? "");
  assert.equal(intact.checked, 5);

  const victim = (await db().query("SELECT id FROM audit_events WHERE strategy_id=$1 AND user_id=$2 ORDER BY seq OFFSET 1 LIMIT 1", [strategy.id, owner])).rows[0].id;
  await db().query("UPDATE audit_events SET notional_usd=notional_usd+1 WHERE id=$1", [victim]);
  const edited = await verifyStrategyChain(strategy.id);
  assert.equal(edited.valid, false);
  assert.equal(edited.brokenAt, victim);
  await db().query("UPDATE audit_events SET notional_usd=notional_usd-1 WHERE id=$1", [victim]);
  assert.equal((await verifyStrategyChain(strategy.id)).valid, true);

  await db().query("DELETE FROM audit_events WHERE id=$1", [victim]);
  assert.equal((await verifyStrategyChain(strategy.id)).valid, false);
});

test("unknown markets and sub-minimum orders are refused up front", { skip }, async () => {
  const owner = await makeUser();
  await assert.rejects(() => makeStrategy(owner, { config: { market: "NOPE-ZZZ" } }), /not a market currently trading/);
  const strategy = await makeStrategy(owner);
  await assert.rejects(() => propose(owner, strategy.id, 0.0001), /minimum order/);
  await assert.rejects(() => proposeTrade(owner, { strategyId: strategy.id, market: "NOPE-ZZZ", side: "long", notionalUsd: 100, reason: "x" }), /not a market currently trading/);
  const stranger = await makeUser();
  await assert.rejects(() => propose(stranger, strategy.id, 100), /strategy's owner/);
});

test("adding to a position keeps its exit percentages", { skip }, async () => {
  const owner = await makeUser();
  const strategy = await makeStrategy(owner, { config: { takeProfitPct: 4, stopLossPct: 2 } });
  await propose(owner, strategy.id, 100);
  await propose(owner, strategy.id, 100);
  const position = (await db().query("SELECT size::float,entry_price::float,take_profit_price::float,stop_loss_price::float FROM paper_positions WHERE user_id=$1", [owner])).rows[0];
  assert.ok(Math.abs(position.stop_loss_price / position.entry_price - 0.98) < 1e-9);
  assert.ok(Math.abs(position.take_profit_price / position.entry_price - 1.04) < 1e-9);
});

test("an exit that was reached closes at its level and frees exposure before the next check", { skip }, async () => {
  const owner = await makeUser();
  const strategy = await makeStrategy(owner, { limits: { maxPositionNotionalUsd: 200, maxTotalExposureUsd: 400 } });
  await propose(owner, strategy.id, 150);
  await db().query("UPDATE paper_positions SET stop_loss_price=entry_price*2 WHERE user_id=$1", [owner]);
  const next = await propose(owner, strategy.id, 100);
  assert.equal(next.ownerDecision?.decision.allowed, true, next.ownerDecision?.decision.reasons.join(" "));
  const exitRow = (await db().query(
    "SELECT amount::float,description FROM paper_ledger WHERE user_id=$1 AND description LIKE 'Stop loss%'", [owner])).rows[0];
  assert.ok(exitRow, "the stop settled");
  assert.ok(exitRow.amount > 100, `filled at the 2x level, not at market: ${exitRow.amount}`);
  const close = (await db().query("SELECT reason FROM audit_events WHERE strategy_id=$1 AND event_kind='close'", [strategy.id])).rows[0];
  assert.equal(close.reason, "Stop loss triggered");
  assert.equal((await verifyStrategyChain(strategy.id)).valid, true);

  await db().query("UPDATE paper_positions SET take_profit_price=entry_price*0.5 WHERE user_id=$1", [owner]);
  assert.equal(await settleExits([owner]), 1);
  assert.equal(await settleExits([owner]), 0);
});

test("a day-old position books only today's part of its result against the daily limit", { skip }, async () => {
  const owner = await makeUser();
  const strategy = await makeStrategy(owner);
  await propose(owner, strategy.id, 500);
  const dayOpen = await getStrikeDayOpen("BTC-USD");
  await db().query("UPDATE paper_positions SET entry_price=$3, opened_at=now()-interval '2 days' WHERE user_id=$1 AND strategy_id=$2", [owner, strategy.id, dayOpen * 0.9]);
  const closed = await closePaperPosition(owner, { strategyId: strategy.id, market: "BTC-USD", side: "long" });
  const row = (await db().query("SELECT amount::float,daily_amount::float FROM paper_ledger WHERE id=$1", [closed.ledgerId])).rows[0];
  assert.ok(row.daily_amount < row.amount, "yesterday's gain is excluded from today's figure");
  const size = (500 / (closed.price));
  assert.ok(Math.abs(row.daily_amount - size * (closed.price - dayOpen)) / 500 < 0.02);
});

test("unfollowing stops copies but keeps the follower's own positions", { skip }, async () => {
  const owner = await makeUser();
  const follower = await makeUser();
  const strategy = await makeStrategy(owner);
  await followStrategy(follower, strategy.id);
  assert.equal((await propose(owner, strategy.id, 50)).followerCount, 1);
  await unfollowStrategy(follower, strategy.id);
  assert.equal((await propose(owner, strategy.id, 50)).followerCount, 0);
  const held = await db().query("SELECT count(*)::int AS n FROM paper_positions WHERE user_id=$1", [follower]);
  assert.equal(held.rows[0].n, 1);
});

test("one unpriceable market cannot take the league down", { skip }, async () => {
  const owner = await makeUser();
  const strategy = await makeStrategy(owner);
  await db().query("INSERT INTO paper_positions(user_id,strategy_id,market,side,size,entry_price) VALUES($1,$2,'NOPE-ZZZ','long',1,1)", [owner, strategy.id]);
  try {
    const row = await standing(strategy.id);
    assert.equal(row.priceStale, true);
  } finally {
    await db().query("DELETE FROM paper_positions WHERE market='NOPE-ZZZ'");
  }
});

test("workspace creation is capped per network, and a live order id attaches to one audit record only", { skip }, async () => {
  await initializeDatabase();
  const network = randomUUID();
  process.env.PAPER_WORKSPACES_PER_NETWORK_PER_HOUR = "2";
  try {
    for (let i = 0; i < 2; i += 1) {
      const id = randomUUID();
      await db().query("INSERT INTO users(id,email,password_hash,ip_hash) VALUES($1,$2,'t',$3)", [id, `${id}@example.test`, network]);
    }
    await assert.rejects(() => assertWorkspaceBudget(network), (error) => error instanceof UserError && error.status === 429);
    await assertWorkspaceBudget(randomUUID());
  } finally {
    delete process.env.PAPER_WORKSPACES_PER_NETWORK_PER_HOUR;
  }

  const owner = await makeUser();
  const strategy = await makeStrategy(owner);
  await propose(owner, strategy.id, 20);
  await propose(owner, strategy.id, 20);
  const ids = (await db().query("SELECT id FROM audit_events WHERE strategy_id=$1 AND user_id=$2", [strategy.id, owner])).rows.map((row) => row.id);
  const orderKey = `acct:${randomUUID()}`;
  await db().query("UPDATE audit_events SET live_order_key=$2 WHERE id=$1", [ids[0], orderKey]);
  await assert.rejects(() => db().query("UPDATE audit_events SET live_order_key=$2 WHERE id=$1", [ids[1], orderKey]), { code: "23505" });
});
