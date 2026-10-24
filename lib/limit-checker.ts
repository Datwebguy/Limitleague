import type { HardLimits, LimitDecision, PortfolioState, TradeProposal } from "./types";

/** Deterministic source of truth: invoke before an order can reach Strike. */
export function checkLimits(
  proposal: TradeProposal,
  limits: HardLimits,
  portfolio: PortfolioState
): LimitDecision {
  const validSize = Number.isFinite(proposal.notionalUsd) && proposal.notionalUsd > 0;
  const currentMarket = portfolio.openPositions
    .filter((position) => position.market === proposal.market)
    .reduce((sum, position) => sum + position.notionalUsd, 0);
  const totalExposure = portfolio.openPositions.reduce((sum, position) => sum + position.notionalUsd, 0);
  const opensNewMarket = !portfolio.openPositions.some((position) => position.market === proposal.market && position.side === proposal.side);
  const dailyLossUsd = Math.max(0, -portfolio.dailyPnlUsd);
  const after = {
    positionNotionalUsd: currentMarket + (validSize ? proposal.notionalUsd : 0),
    totalExposureUsd: totalExposure + (validSize ? proposal.notionalUsd : 0),
    openPositionCount: portfolio.openPositions.length + (opensNewMarket ? 1 : 0),
    dailyLossUsd
  };
  const reasons: string[] = [];
  if (!validSize) reasons.push("The trade size must be more than zero.");
  if (!Number.isFinite(portfolio.dailyPnlUsd) || portfolio.openPositions.some((position) => !Number.isFinite(position.notionalUsd) || position.notionalUsd < 0)) reasons.push("Account figures could not be read, so the trade was stopped to be safe.");
  if (after.positionNotionalUsd > limits.maxPositionNotionalUsd) reasons.push("This trade would take the position above the strategy's size limit.");
  if (after.totalExposureUsd > limits.maxTotalExposureUsd) reasons.push("This trade would put more money in the market than the strategy allows.");
  if (after.openPositionCount > limits.maxOpenPositions) reasons.push("This trade would open more positions than the strategy allows.");
  if (dailyLossUsd >= limits.dailyLossLimitUsd) reasons.push("The daily loss limit has been reached, so the strategy is paused for today.");
  return { allowed: reasons.length === 0, reasons, after };
}
