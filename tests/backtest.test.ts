import test from "node:test";
import assert from "node:assert/strict";
import { runBacktest } from "../lib/backtest";
import type { StrikeCandle } from "../lib/strike/client";
import type { HardLimits, StrategyConfig } from "../lib/types";

const limits: HardLimits = { maxPositionNotionalUsd: 2000, dailyLossLimitUsd: 500, maxTotalExposureUsd: 5000, maxOpenPositions: 1, pauseAtDailyLoss: true };
const config: StrategyConfig = { market: "BTC-USD", style: "momentum", takeProfitPct: null, stopLossPct: null };
const DAY = Math.floor(Date.UTC(2026, 0, 5) / 86_400_000) * 86_400_000;

/** One-minute candles so a whole scenario stays inside a single UTC day. */
function candlesFromCloses(closes: number[], start = DAY): StrikeCandle[] {
  return closes.map((close, index) => {
    const open = index === 0 ? close : closes[index - 1];
    return { timestamp: start + index * 60_000, open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1 };
  });
}
const flat = (n: number, price = 100) => Array.from({ length: n }, () => price);

test("a flat market opens nothing and ends where it began", () => {
  const result = runBacktest(candlesFromCloses(flat(60)), { config, limits, notionalUsd: 1000 });
  assert.equal(result.trades, 0);
  assert.equal(result.endingEquityUsd, 10_000);
  assert.equal(result.compliancePct, 100);
});

test("fees are charged on entry and on exit", () => {
  const closes = [...flat(20), 101, 102, 103, 102, 100, 98, 99];
  const result = runBacktest(candlesFromCloses(closes), { config, limits, notionalUsd: 1000 });
  assert.ok(result.trades >= 1);
  assert.equal(result.feesUsd, Number((result.trades * 2 * 1000 * 0.0005).toFixed(2)));
});

test("an oversized order is blocked and reported as a size breach", () => {
  const closes = [...flat(20), 101, 102, 103];
  const result = runBacktest(candlesFromCloses(closes), { config, limits, notionalUsd: 3000 });
  assert.equal(result.trades, 0);
  assert.ok(result.blockedBySize > 0);
  assert.equal(result.compliancePct, 0);
});

test("the daily loss limit pauses new entries for the rest of the UTC day", () => {
  // Long near 101, a crash loses far more than the $50 limit, then a rebound flips the signal and wants a new entry.
  const closes = [...flat(20), 101, 90, 80, 79, 78, 77, 76, 75, 120];
  const tight = { ...limits, dailyLossLimitUsd: 50 };
  const result = runBacktest(candlesFromCloses(closes), { config, limits: tight, notionalUsd: 1000 });
  assert.ok(result.blockedByDailyLoss > 0, "entries after the loss are blocked");
  const loose = runBacktest(candlesFromCloses(closes), { config, limits: { ...limits, dailyLossLimitUsd: 1_000_000 }, notionalUsd: 1000 });
  assert.equal(loose.blockedByDailyLoss, 0);
});

test("drawdown includes losses on a position that is still open", () => {
  // A slow slide that stays above the average keeps the long open the whole time; only mark-to-market sees the loss.
  const closes = [...flat(20), 110, 108, 106, 104, 102];
  const wide = { ...limits, maxPositionNotionalUsd: 10_000, maxTotalExposureUsd: 10_000, dailyLossLimitUsd: 1_000_000 };
  const result = runBacktest(candlesFromCloses(closes), { config, limits: wide, notionalUsd: 8000 });
  assert.ok(result.maxDrawdownPct > 5, `drawdown ${result.maxDrawdownPct}`);
});

test("a stop-loss fills at its level, not at the candle extreme", () => {
  const withStop: StrategyConfig = { ...config, stopLossPct: 2 };
  const closes = [...flat(20), 101, 101, 90, 90];
  const result = runBacktest(candlesFromCloses(closes), { config: withStop, limits, notionalUsd: 1000 });
  const loss = result.startingEquityUsd - result.endingEquityUsd;
  // 2% of $1000 plus two fees of $0.50, never the ~11% the candle low would imply.
  assert.ok(loss > 20 && loss < 23, `loss ${loss}`);
});
