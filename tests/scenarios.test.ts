import test from "node:test";
import assert from "node:assert/strict";
import { runBacktest } from "../lib/backtest";
import { SCENARIOS, SCENARIO_HOURS, WARMUP_HOURS, buildScenario } from "../app/_lib/scenarios";
import type { ScenarioId } from "../app/_lib/scenarios";

const ids = Object.keys(SCENARIOS) as ScenarioId[];
const config = { market: "BTC-USD", style: "momentum" as const, takeProfitPct: null, stopLossPct: null };
const limits = (daily: number) => ({ maxPositionNotionalUsd: 1000, dailyLossLimitUsd: daily, maxTotalExposureUsd: 3000, maxOpenPositions: 2, pauseAtDailyLoss: true as const });

test("scenarios are repeatable and start from the real price", () => {
  const now = Date.UTC(2026, 9, 24, 13, 0, 0);
  for (const id of ids) {
    const first = buildScenario(id, 80_000, now);
    assert.equal(first.length, WARMUP_HOURS + SCENARIO_HOURS);
    assert.deepEqual(first, buildScenario(id, 80_000, now));
    assert.ok(Math.abs(first[0].open - 80_000) < 1e-6);
    assert.ok(first.every((c) => c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close)));
  }
});

test("the crash really falls about twelve percent and the rally really climbs", () => {
  const crash = buildScenario("crash", 100);
  assert.ok(Math.min(...crash.map((c) => c.low)) < 90);
  const rally = buildScenario("rally", 100);
  assert.ok(rally[rally.length - 1].close > 107);
});

test("a daily loss limit never makes the crash worse than having none", () => {
  const candles = buildScenario("crash", 80_000);
  const guarded = runBacktest(candles, { config, limits: limits(100), notionalUsd: 1000 });
  const open = runBacktest(candles, { config, limits: limits(1e12), notionalUsd: 1000 });
  assert.ok(guarded.endingEquityUsd >= open.endingEquityUsd - 1e-6);
});
