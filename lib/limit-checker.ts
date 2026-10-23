import { HardLimits, LimitDecision, PortfolioState, TradeProposal } from "@/lib/types";

/** Deterministic source of truth: invoke before an order can reach Strike. */
export function checkLimits(
  proposal: TradeProposal,
  limits: HardLimits,
  portfolio: PortfolioState
): LimitDecision {
  const currentMarket = portfolio.openPositions
    .filter((position) => position.market === proposal.market)
    .reduce((sum, position) => sum + position.notionalUsd, 0);
  const totalExposure = portfolio.openPositions.reduce((sum, position) => sum + position.notionalUsd, 0);
  const opensNewMarket = !portfolio.openPositions.some((position) => position.market === proposal.market);
  const dailyLossUsd = Math.max(0, -portfolio.dailyPnlUsd);
  const after = {
    positionNotionalUsd: currentMarket + proposal.notionalUsd,
    totalExposureUsd: totalExposure + proposal.notionalUsd,
    openPositionCount: portfolio.openPositions.length + (opensNewMarket ? 1 : 0),
    dailyLossUsd
  };
  const reasons: string[] = [];
  if (proposal.notionalUsd <= 0) reasons.push("Notional must be greater than zero.");
  if (after.positionNotionalUsd > limits.maxPositionNotionalUsd) reasons.push("Max position size would be exceeded.");
  if (after.totalExposureUsd > limits.maxTotalExposureUsd) reasons.push("Max total exposure would be exceeded.");
  if (after.openPositionCount > limits.maxOpenPositions) reasons.push("Max open positions would be exceeded.");
  if (limits.pauseAtDailyLoss && dailyLossUsd >= limits.dailyLossLimitUsd) reasons.push("Strategy is paused because the daily loss limit has been reached.");
  return { allowed: reasons.length === 0, reasons, after };
}
