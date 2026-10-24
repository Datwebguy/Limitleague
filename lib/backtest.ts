import { evaluateExit } from "./exits";
import type { HardLimits, StrategyConfig } from "./types";
import type { StrikeCandle } from "../app/_lib/types-candle";

const FEE_RATE = 0.0005; // charged on entry and again on exit
const STARTING_EQUITY = 10_000;
const DAY_MS = 86_400_000;
const WARMUP = 20;

type Side = "long" | "short";
type Open = { side: Side; entry: number; takeProfit: number | null; stopLoss: number | null };

function signalAt(candles: StrikeCandle[], index: number, style: StrategyConfig["style"]): Side | null {
  if (index < WARMUP) return null;
  const window = candles.slice(index - WARMUP, index);
  const price = candles[index].close;
  const average = window.reduce((sum, candle) => sum + candle.close, 0) / WARMUP;
  if (style === "momentum") return price > average ? "long" : price < average ? "short" : null;
  if (style === "mean_reversion") return price < average * 0.995 ? "long" : price > average * 1.005 ? "short" : null;
  const high = Math.max(...window.map((candle) => candle.high));
  const low = Math.min(...window.map((candle) => candle.low));
  return price > high ? "long" : price < low ? "short" : null;
}

/**
 * Replays a strategy over historical candles under the same rules the live checker applies:
 * the position size caps, and the daily loss limit that pauses new entries until the next UTC day.
 * Equity is marked to market every candle, and fees are charged on both entry and exit.
 */
export function runBacktest(
  candles: StrikeCandle[],
  input: { config: StrategyConfig; limits: HardLimits; notionalUsd: number },
) {
  const { config, limits, notionalUsd } = input;
  const takeProfit = config.takeProfitPct ? config.takeProfitPct / 100 : null;
  const stopLoss = config.stopLossPct ? config.stopLossPct / 100 : null;
  const tooLarge = notionalUsd > limits.maxPositionNotionalUsd || notionalUsd > limits.maxTotalExposureUsd;

  let cash = STARTING_EQUITY;
  let position: Open | null = null;
  let tradePnl = 0;
  let peak = STARTING_EQUITY;
  let maxDrawdown = 0;
  let entries = 0;
  let trades = 0;
  let wins = 0;
  let blockedBySize = 0;
  let blockedByDailyLoss = 0;
  let feesUsd = 0;
  let day = -1;
  let dayStartEquity = STARTING_EQUITY;
  let pausedForDay = false;
  const curve: Array<{ timestamp: number; equity: number }> = [];

  const equityAt = (price: number) =>
    cash + (position ? (position.side === "long" ? 1 : -1) * notionalUsd * ((price - position.entry) / position.entry) : 0);

  const close = (price: number) => {
    if (!position) return;
    const gross = (position.side === "long" ? 1 : -1) * notionalUsd * ((price - position.entry) / position.entry);
    const fee = notionalUsd * FEE_RATE;
    cash += gross - fee;
    feesUsd += fee;
    tradePnl += gross - fee;
    trades += 1;
    if (tradePnl > 0) wins += 1;
    tradePnl = 0;
    position = null;
  };

  const open = (side: Side, price: number) => {
    const fee = notionalUsd * FEE_RATE;
    cash -= fee;
    feesUsd += fee;
    tradePnl = -fee;
    entries += 1;
    position = {
      side,
      entry: price,
      takeProfit: takeProfit === null ? null : price * (side === "long" ? 1 + takeProfit : 1 - takeProfit),
      stopLoss: stopLoss === null ? null : price * (side === "long" ? 1 - stopLoss : 1 + stopLoss),
    };
  };

  candles.forEach((candle, index) => {
    const candleDay = Math.floor(candle.timestamp / DAY_MS);
    if (candleDay !== day) {
      day = candleDay;
      dayStartEquity = equityAt(candle.open);
      pausedForDay = false;
    }
    if (position) {
      const exit = evaluateExit(position.side, position.takeProfit, position.stopLoss, candle.high, candle.low);
      if (exit) close(exit.price);
    }
    const next = signalAt(candles, index, config.style);
    if (next && position && (position as Open).side !== next) close(candle.close);
    if (next && !position) {
      if (tooLarge) blockedBySize += 1;
      else if (pausedForDay) blockedByDailyLoss += 1;
      else open(next, candle.close);
    }
    const equity = equityAt(candle.close);
    if (dayStartEquity - equity >= limits.dailyLossLimitUsd) pausedForDay = true;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, ((peak - equity) / peak) * 100);
    curve.push({ timestamp: candle.timestamp, equity: Number(equity.toFixed(2)) });
  });
  if (position && candles.length) close(candles[candles.length - 1].close);

  const blockedSignals = blockedBySize + blockedByDailyLoss;
  return {
    startingEquityUsd: STARTING_EQUITY,
    endingEquityUsd: Number(cash.toFixed(2)),
    returnPct: Number((((cash - STARTING_EQUITY) / STARTING_EQUITY) * 100).toFixed(2)),
    maxDrawdownPct: Number(maxDrawdown.toFixed(2)),
    winRatePct: trades ? Number(((wins / trades) * 100).toFixed(1)) : 0,
    trades,
    wins,
    blockedSignals,
    blockedBySize,
    blockedByDailyLoss,
    feesUsd: Number(feesUsd.toFixed(2)),
    compliancePct: entries + blockedSignals ? Number(((entries / (entries + blockedSignals)) * 100).toFixed(1)) : 100,
    equityCurve: curve,
  };
}
