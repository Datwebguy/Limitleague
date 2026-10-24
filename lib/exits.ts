import { getStrikeCandles, type StrikeCandle } from "./strike/client";

export type ExitKind = "Take profit" | "Stop loss";

/**
 * Decides whether a position's exit levels were reached inside a price range.
 * When one range touches both levels the stop wins, because the order of touches is unknown
 * and assuming the worse outcome keeps the paper record honest.
 */
export function evaluateExit(
  side: "long" | "short",
  takeProfit: number | null,
  stopLoss: number | null,
  high: number,
  low: number,
): { kind: ExitKind; price: number } | null {
  const stopHit = stopLoss !== null && (side === "long" ? low <= stopLoss : high >= stopLoss);
  if (stopHit) return { kind: "Stop loss", price: stopLoss! };
  const targetHit = takeProfit !== null && (side === "long" ? high >= takeProfit : low <= takeProfit);
  if (targetHit) return { kind: "Take profit", price: takeProfit! };
  return null;
}

export type PriceBands = { minutes: StrikeCandle[]; hours: StrikeCandle[] };

const MINUTE = 60_000;
const HOUR = 3_600_000;

/** Mark-price candles that cover the last 12 hours by the minute and about 30 days by the hour. */
export async function loadPriceBands(symbol: string): Promise<PriceBands> {
  const [minutes, hours] = await Promise.all([
    getStrikeCandles(symbol, "1m", 720, "mark"),
    getStrikeCandles(symbol, "1h", 720, "mark"),
  ]);
  return { minutes, hours };
}

/**
 * High and low of the mark price after a position was opened. The candle that contained the entry is skipped
 * because part of it happened before the position existed; the current mark covers the most recent moments.
 */
export function rangeSince(bands: PriceBands, openedAtMs: number, currentMark: number) {
  let high = currentMark;
  let low = currentMark;
  const firstMinute = Math.ceil(openedAtMs / MINUTE) * MINUTE;
  const firstHour = Math.ceil(openedAtMs / HOUR) * HOUR;
  const oldestMinute = bands.minutes.length ? Math.min(...bands.minutes.map((c) => c.timestamp)) : Infinity;
  for (const candle of bands.minutes) {
    if (candle.timestamp < firstMinute) continue;
    high = Math.max(high, candle.high);
    low = Math.min(low, candle.low);
  }
  for (const candle of bands.hours) {
    if (candle.timestamp < firstHour || candle.timestamp + HOUR > oldestMinute) continue;
    high = Math.max(high, candle.high);
    low = Math.min(low, candle.low);
  }
  return { high, low };
}
