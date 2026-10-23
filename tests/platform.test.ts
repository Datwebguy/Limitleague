import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, initializeDatabase } from "../lib/db";
import { createStrategy, followStrategy, listAudit, proposeTrade } from "../lib/platform";

test.after(async () => { if (process.env.DATABASE_URL) await db().end(); });

test("a real paper proposal is checked, copied to followers, and audited", { skip: !process.env.DATABASE_URL }, async () => {
  await initializeDatabase();
  const owner = randomUUID();
  const follower = randomUUID();
  await db().query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'test'),($3,$4,'test')",
    [owner, owner+"@example.test", follower, follower+"@example.test"]);
  const strategy = await createStrategy(owner, "Integration Strategy", "Test", {
    maxPositionNotionalUsd: 200,
    dailyLossLimitUsd: 50,
    maxTotalExposureUsd: 300,
    maxOpenPositions: 1,
    pauseAtDailyLoss: true
  });
  await followStrategy(follower, strategy.id);
  const allowed = await proposeTrade(owner, {
    strategyId: strategy.id, market: "BTC-USD", side: "long", notionalUsd: 100, reason: "Signal"
  });
  assert.equal(allowed.ownerDecision?.decision.allowed, true);
  assert.equal(allowed.followerCount, 1);
  const blocked = await proposeTrade(owner, {
    strategyId: strategy.id, market: "BTC-USD", side: "long", notionalUsd: 150, reason: "Too large"
  });
  assert.equal(blocked.ownerDecision?.decision.allowed, false);
  const audit = await listAudit();
  assert.ok(audit.some(event => event.strategy_id === strategy.id && event.allowed));
  assert.ok(audit.some(event => event.strategy_id === strategy.id && !event.allowed));
});
