import { baseOf, money } from "./format";
import type { ActivityItem, Limits, StrategyStyle } from "./types";

export const LIMIT_INFO: Record<keyof Omit<Limits, "pauseAtDailyLoss">, { name: string; short: string; help: string }> = {
  maxPositionNotionalUsd: {
    name: "Largest position",
    short: "per market",
    help: "The most money the strategy can have in a single market at once.",
  },
  dailyLossLimitUsd: {
    name: "Daily loss limit",
    short: "per day",
    help: "If the strategy loses this much in one day, it stops placing trades until tomorrow.",
  },
  maxTotalExposureUsd: {
    name: "Most in the market",
    short: "in total",
    help: "The most money the strategy can have in open trades at the same time, across every market.",
  },
  maxOpenPositions: {
    name: "Most open trades",
    short: "at once",
    help: "How many trades the strategy can hold open at the same time.",
  },
};

export const STYLE_INFO: Record<StrategyStyle, { name: string; blurb: string }> = {
  momentum: { name: "Follow the trend", blurb: "Buys when the price is climbing above its recent average and sells when it falls below." },
  mean_reversion: { name: "Bet on a bounce back", blurb: "Buys after sharp dips and sells after sharp jumps, expecting the price to return to normal." },
  breakout: { name: "Catch breakouts", blurb: "Buys when the price pushes past its recent high and sells when it drops below its recent low." },
};

export const sideName = (side?: string) => (side === "short" ? "short" : "long");
export const SIDE_HELP = {
  long: "A long trade makes money when the price goes up.",
  short: "A short trade makes money when the price goes down.",
};

export type Verdict = { label: string; tone: "good" | "bad" | "muted" | "brand" };

export function verdictOf(item: ActivityItem): Verdict {
  if (item.event_type === "rules") return { label: "Rules", tone: "brand" };
  if (item.event_type === "close") return { label: "Closed", tone: "muted" };
  return item.allowed ? { label: "Placed", tone: "good" } : { label: "Stopped", tone: "bad" };
}

/** One readable sentence for each public record. */
export function sentenceOf(item: ActivityItem): string {
  const market = item.market ? baseOf(item.market) : "";
  if (item.event_type === "rules") {
    if (item.action === "Limits tightened") return "Made its risk limits stricter";
    if (item.action === "Strategy paused") return "Paused the strategy";
    if (item.action === "Strategy resumed") return "Resumed the strategy";
    return item.action ?? "Changed its rules";
  }
  if (item.event_type === "close") {
    if (item.reason?.startsWith("Stop loss")) return `Stop loss closed the ${market} trade`;
    if (item.reason?.startsWith("Take profit")) return `Take profit closed the ${market} trade`;
    return `Closed the ${market} trade`;
  }
  const size = money(item.notional_usd ?? 0);
  return item.allowed
    ? `Placed a ${sideName(item.side)} trade in ${market} for ${size}`
    : `Tried a ${sideName(item.side)} trade in ${market} for ${size}, but a limit stopped it`;
}

export function marketOf(item: ActivityItem) {
  return item.market ?? null;
}
