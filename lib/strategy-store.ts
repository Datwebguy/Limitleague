import { checkLimits } from "@/lib/limit-checker";
import { HardLimits, PortfolioState, TradeProposal } from "@/lib/types";

export type Strategy = {
  id: string; name: string; mode: "paper" | "live"; limits: HardLimits; portfolio: PortfolioState;
  audit: Array<{ id: string; proposal: TradeProposal; allowed: boolean; reasons: string[]; createdAt: string }>;
};

/**
 * Replace this development adapter with the configured database adapter before
 * production use. The limit checker remains the shared execution gate.
 */
const strategies = new Map<string, Strategy>([
  ["northstar", {
    id: "northstar", name: "Northstar BTC", mode: "paper",
    limits: { maxPositionNotionalUsd: 2000, dailyLossLimitUsd: 300, maxTotalExposureUsd: 5000, maxOpenPositions: 2, pauseAtDailyLoss: true },
    portfolio: { openPositions: [{ market: "ETH-USD", side: "long", notionalUsd: 1200 }], dailyPnlUsd: 84 },
    audit: []
  }]
]);

export function listStrategies() {
  return [...strategies.values()].map(({ portfolio, audit, ...strategy }) => ({ ...strategy, auditCount: audit.length }));
}

export function proposeTrade(proposal: TradeProposal) {
  const strategy = strategies.get(proposal.strategyId);
  if (!strategy) throw new Error("Strategy not found.");
  const decision = checkLimits(proposal, strategy.limits, strategy.portfolio);
  strategy.audit.unshift({
    id: crypto.randomUUID(), proposal, allowed: decision.allowed, reasons: decision.reasons, createdAt: new Date().toISOString()
  });
  return { strategy: strategy.id, decision };
}

export function listAuditEntries() {
  return [...strategies.values()]
    .flatMap((strategy) => strategy.audit.map((entry) => ({ strategyId: strategy.id, strategyName: strategy.name, ...entry })))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
