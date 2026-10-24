import type { HardLimits, StrategyConfig } from "./types";
import type { StrikeCandle } from "./strike/client";

export function runBacktest(candles: StrikeCandle[], input: { config: StrategyConfig; limits: HardLimits; notionalUsd: number }) {
  const feeRate = 0.0005;
  let equity = 10000, peak = equity, maxDrawdown = 0, wins = 0, trades = 0, blockedSignals = 0;
  let position: { side: "long" | "short"; entry: number; entryTime: number } | null = null;
  const curve: Array<{ timestamp: number; equity: number }> = [];
  const close = (price: number) => { if (!position) return; const pnl = (position.side === "long" ? 1 : -1) * input.notionalUsd * (price - position.entry) / position.entry - input.notionalUsd * feeRate; equity += pnl; trades++; if (pnl > 0) wins++; position = null; };
  const signal = (i: number): "long" | "short" | null => {
    if (i < 20) return null;
    const window = candles.slice(i - 20, i).map(c => c.close);
    const sma = window.reduce((a,b) => a+b, 0) / window.length;
    if (input.config.style === "momentum") return candles[i].close > sma ? "long" : candles[i].close < sma ? "short" : null;
    if (input.config.style === "mean_reversion") return candles[i].close < sma * .995 ? "long" : candles[i].close > sma * 1.005 ? "short" : null;
    const high = Math.max(...candles.slice(i - 20, i).map(c => c.high)); const low = Math.min(...candles.slice(i - 20, i).map(c => c.low));
    return candles[i].close > high ? "long" : candles[i].close < low ? "short" : null;
  };
  candles.forEach((c, i) => {
    if (position) {
      const tp = input.config.takeProfitPct ? input.config.takeProfitPct / 100 : null;
      const sl = input.config.stopLossPct ? input.config.stopLossPct / 100 : null;
      const hitTp = tp !== null && (position.side === "long" ? c.high >= position.entry * (1 + tp) : c.low <= position.entry * (1 - tp));
      const hitSl = sl !== null && (position.side === "long" ? c.low <= position.entry * (1 - sl) : c.high >= position.entry * (1 + sl));
      if (hitTp || hitSl) close(hitSl ? (position.side === "long" ? position.entry * (1 - (sl ?? 0)) : position.entry * (1 + (sl ?? 0))) : (position.side === "long" ? position.entry * (1 + (tp ?? 0)) : position.entry * (1 - (tp ?? 0))));
    }
    const next = signal(i);
    if (next && position && position.side !== next) close(c.close);
    if (next && !position) {
      if (input.notionalUsd > input.limits.maxPositionNotionalUsd || input.notionalUsd > input.limits.maxTotalExposureUsd) blockedSignals++;
      else position = { side: next, entry: c.close, entryTime: c.timestamp };
    }
    const drawdown = ((peak - equity) / peak) * 100; maxDrawdown = Math.max(maxDrawdown, drawdown); peak = Math.max(peak, equity); curve.push({ timestamp: c.timestamp, equity: Number(equity.toFixed(2)) });
  });
  if (position) close(candles.at(-1)!.close);
  const returnPct = ((equity - 10000) / 10000) * 100;
  return { startingEquityUsd: 10000, endingEquityUsd: Number(equity.toFixed(2)), returnPct: Number(returnPct.toFixed(2)), maxDrawdownPct: Number(maxDrawdown.toFixed(2)), winRatePct: trades ? Number((wins / trades * 100).toFixed(1)) : 0, trades, wins, blockedSignals, compliancePct: trades + blockedSignals ? Number((trades / (trades + blockedSignals) * 100).toFixed(1)) : 100, equityCurve: curve };
}
